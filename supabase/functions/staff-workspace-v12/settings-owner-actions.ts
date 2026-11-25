import {fail,uuid,revision} from './validation.mjs';
import {ownerMatrix,checkItems,OWNER_ROLES,AREA_SECTION,queueNeedsMe,recordNeedsMe,roleLabel} from './settings-owner-rules.mjs';
import {present,buildOverview} from './settings-state-rules.mjs';
import {settingsHubAction,openOwners} from './settings-hub-actions.ts';
import {taxConfigAction} from './tax-config-actions.ts';
import {accountingAction} from './accounting-actions.ts';
import {statementMapAction} from './annual-pack.ts';
import {testRate,rateApprovalIssue,taxSourceIssue,validateCanonicalRate,registryParameters} from './tax-registry.mjs';
import {rateParameters} from './suite-rules.mjs';
import {MAX_BATCH} from './statement-review-rules.mjs';

// Settings owners and the approval task board. Owners only describe responsibility; the typed settings handlers remain the final authority for every approval.
const READERS=['PARTNER','MANAGER'];
const today=()=>new Date(Date.now()+3*3600*1000).toISOString().slice(0,10);
const iso=(v:any)=>v?new Date(v).toISOString():null;
const BULK_TYPES=Object.freeze({approve_tax_rates:'TAX_RATE',approve_chart:'CHART_ACCOUNT',approve_statement_lines:'STATEMENT_MAP'});
async function requireBulkRight(tx:any,a:any,right:string){
 const denied=await tx`select 1 from erp_private.staff_right_restrictions where staff_id=${a.staff_id} and right_code=${right}`;
 if(denied.length)fail(403,'Your access to the underlying approval path has been switched off. Ask a Manager or Partner to restore it.');
}
const day=(v:any)=>iso(v)?.slice(0,10)||'';
const overlaps=(a:any,b:any)=>a.effective_from<=b.effective_to&&b.effective_from<=a.effective_to;
const taxPeriod=(r:any)=>({effective_from:day(r.effective_from),effective_to:day(r.effective_to)});
function taxBlock(r:any,staffId:string,approved:any[],totReady:boolean){
 if(testRate(r))return 'Test-only rates cannot be approved for client computations.';
 const issue=rateApprovalIssue(r,staffId);if(issue)return issue;
 if(r.rate_key==='KE_TOT'&&!totReady)return 'The evidence-backed TOT/VAT acceptance check must be marked Passed before approval.';
 const overlapping=approved.find(x=>overlaps(taxPeriod(r),x));
 if(overlapping)return `Approved coverage overlaps ${overlapping.effective_from} to ${overlapping.effective_to}. Review the proposed dates.`;
 try{
  validateCanonicalRate(r.rate_key,r.tax_type,r.parameters);
  registryParameters(r.tax_type,r.parameters);
  if(['PAYE','Individual income tax'].includes(r.tax_type))rateParameters(r.tax_type,r.parameters);
 }catch(error:any){if(error?.status===400)return error.message;throw error;}
 return '';
}
async function approvalGroups(tx:any,a:any,canTax:boolean,details=false){
 const [permissions,rates,chart,review,tot]=await Promise.all([
  tx`select right_code from erp_private.staff_right_restrictions where staff_id=${a.staff_id} and right_code=any(${tx.array(['settings.approve','acct.setup','fs.map'])}::text[])`,
  tx`select rate_id,rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,legal_citation,legal_review_status,legal_review_reference,created_by,erp_private.staff_name(created_by) prepared_by,revision,status,is_test from erp_private.tax_rates where deleted_at is null and status in ('Draft','Testing') order by tax_type,rate_key,effective_from`,
  tx`select code,name,account_group,route,category_code,statement,tax_note,evidence,notes,status,proposed_by,erp_private.staff_name(proposed_by) prepared_by,revision from erp_private.account_catalog where status='Draft' order by code`,
  statementMapAction(tx,a,{action:'ledger_statement_map_review_read'}),
  tx`select status,evidence from erp_private.release_checks where check_code='TOTVAT'`
 ]);
 const denied=new Set(permissions.map((x:any)=>x.right_code));
 const boardIssue=denied.has('settings.approve')?'Your Settings approval right is switched off.':'';
 const approved=await tx`select rate_key,effective_from,effective_to,parameters
  from erp_private.tax_rates where status='Approved' and deleted_at is null
   and rate_key=any(${tx.array([...new Set(rates.map((r:any)=>r.rate_key))])}::text[])
  order by effective_from desc, rate_id`;
 const approvedByKey=new Map<string,any[]>();
 for(const rate of approved){
  if(!approvedByKey.has(rate.rate_key))approvedByKey.set(rate.rate_key,[]);
  approvedByKey.get(rate.rate_key)!.push({...taxPeriod(rate),parameters:rate.parameters||{}});
 }
 const dateToday=today(),totReady=tot[0]?.status==='Passed'&&String(tot[0]?.evidence||'').trim().length>=21;
 const chartIssue=boardIssue||(denied.has('acct.setup')?'Your chart-account approval right is switched off.':a.category_code!=='PARTNER'?'Partner approval is required.':'');
 const mapIssue=boardIssue||(denied.has('fs.map')?'Your statement-line mapping approval right is switched off.':a.category_code!=='PARTNER'?'Only a Partner may approve statement-line mappings.':'');
 const cards:any[]=[
  {key:'approve_tax_rates',title:'Tax rates awaiting legal approval',type:'tax_rate',waiting_count:rates.length,items:rates.map((r:any)=>{
   const versions=approvedByKey.get(r.rate_key)||[],period=taxPeriod(r);
   const current=versions.find(x=>x.effective_from<=dateToday&&x.effective_to>=dateToday);
   const previous=versions.find(x=>x.effective_to<period.effective_from);
   const reason=boardIssue||(!canTax?'Only the assigned Tax Manager or an Engagement Partner can approve tax rules.':taxBlock(r,a.staff_id,versions,totReady));
   return {id:String(r.rate_id),revision:r.revision,label:r.label,code:r.rate_key,kind:r.tax_type,...period,parameters:r.parameters||{},
    comparison:current||previous||null,comparison_label:current?'Current approved figures':'Previous approved figures',
    source_url:r.source_url||'',source_note:r.source_note||'',source_issue:taxSourceIssue(r.source_url,r.source_note),legal_citation:r.legal_citation||'',
    legal_review_status:r.legal_review_status||'',legal_review_reference:r.legal_review_reference||'',prepared_by:r.prepared_by||'Starter rule',eligible:!reason,reason};
  })},
  {key:'approve_chart',title:'Chart of accounts additions',type:'chart_account',waiting_count:chart.length,items:chart.map((r:any)=>{
   const reason=chartIssue||(!r.proposed_by?'The proposer could not be identified for this draft. Record a new proposal before approval.':
    String(r.proposed_by)===String(a.staff_id)?'The person who proposed this account cannot approve it.':'');
   return {id:r.code,revision:r.revision,label:r.name,code:r.code,kind:r.account_group,route:r.route,category_code:r.category_code,statement:r.statement,
    tax_note:r.tax_note||'',evidence:r.evidence||'',notes:r.notes||'',prepared_by:r.prepared_by||'Unknown proposer',eligible:!reason,reason};
  })},
  {key:'approve_statement_lines',title:'Consistent statement-line mappings',type:'statement_map',waiting_count:Number(review.summary?.total||0),
   blocked_note:mapIssue||'Open individual review for replacements, statement mismatches and other exceptions.',
   exceptions:review.exceptions.map((x:any)=>({id:x.map_id,code:x.account_code,label:x.account_name,line:x.line_label,statement:x.line_statement,
    prepared_by:x.proposed_by||'Starter mapping',effective_from:x.effective_from,replaces:x.replaces,reasons:x.reasons.map((r:any)=>r.text)})),
   unchanged_count:review.unchanged.length,
   items:review.groups.map((g:any)=>{
    const groupReason=mapIssue||(g.accounts.some((x:any)=>String(x.proposed_by_id||'')===String(a.staff_id))?'A Partner cannot approve mappings they proposed.':'');
    return {group_id:g.line_code,label:g.label,kind:g.statement,eligible:!groupReason,reason:groupReason,items:g.accounts.map((x:any)=>{
    const reason=mapIssue||(String(x.proposed_by_id||'')===String(a.staff_id)?'A Partner cannot approve a mapping they proposed.':'');
    return {id:String(x.map_id),label:x.account_name,code:x.account_code,effective_from:x.effective_from,revision:x.revision,
     prepared_by:x.proposed_by||'Starter mapping',origin:x.seeded?'Starter mapping':'Proposed mapping',eligible:!reason,reason};
    })};
   })}
 ];
 for(const c of cards){
  const items=c.key==='approve_statement_lines'?c.items.flatMap((g:any)=>g.items):c.items;
  c.actionable_count=items.filter((i:any)=>i.eligible).length;
  c.blocked_count=c.waiting_count-c.actionable_count;
 }
 return details?cards:cards.map(({items,exceptions,...card}:any)=>({...card,items:[]}));
}
function cleanSelections(raw:any){
 if(!Array.isArray(raw)||!raw.length)fail(400,'Select at least one approval item.');
 if(raw.length>3)fail(400,'Choose at most three approval types at once.');
 const seen=new Set(),out=[];let count=0;
 for(const g of raw){
  const key=String(g?.queue_key||'');if(!Object.hasOwn(BULK_TYPES,key)||seen.has(key))fail(400,'One approval type is unavailable or listed twice. Refresh the dashboard.');seen.add(key);
  if(!Array.isArray(g.items)||!g.items.length)fail(400,'Each selected approval type must include at least one item.');
  const local=new Set(),items=[];
  for(const item of g.items){const id=String(item?.id||'');if(!id||local.has(id))fail(400,'A selected item is missing an ID or is listed twice.');local.add(id);items.push({id,revision:item.revision});count++;}
  items.sort((x:any,y:any)=>x.id.localeCompare(y.id));out.push({queue_key:key,items});
 }
 if(count>MAX_BATCH)fail(400,`Approve at most ${MAX_BATCH} items in one batch.`);
 out.sort((x:any,y:any)=>x.queue_key.localeCompare(y.queue_key));
 return out;
}
function approvalItems(card:any){
 if(card.key!=='approve_statement_lines')return card.items;
 return card.items.flatMap((g:any)=>g.items.map((x:any)=>({...x,statement_line:g.label,statement:g.kind})));
}
function itemFailure(status:number,message:string,queue_key:string,id:string){
 try{fail(status,message);}catch(error:any){throw Object.assign(error,{approval_item:{queue_key,id}});}
}
async function prepareBatch(tx:any,a:any,selections:any[]){
 const canTax=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
 const cards=await approvalGroups(tx,a,canTax,true);
 return selections.map(selection=>{
  const card=cards.find(c=>c.key===selection.queue_key);
  const byId=new Map<string,any>(approvalItems(card).map((item:any)=>[item.id,item]));
  const selectedRates=new Map<string,any[]>();
  const items=selection.items.map((selectionItem:any)=>{
   const {id}=selectionItem,item=byId.get(id);
   if(!item)return itemFailure(409,`Record ${id} is no longer waiting in this group. Reload Quick review.`,card.key,id);
   const label=[item.code,item.label].filter(Boolean).join(' · ');
   if(String(item.revision??'')!==String(selectionItem.revision??''))
    return itemFailure(409,`${label} changed after you opened it. Reload Quick review and check the changes.`,card.key,id);
   if(!item.eligible)return itemFailure(409,item.reason,card.key,id);
   if(card.key==='approve_tax_rates'){
    const prior=selectedRates.get(item.code)||[];
    if(prior.some(other=>overlaps(other,item)))return itemFailure(400,`Selected periods overlap for ${item.code}. Review these proposals individually.`,card.key,id);
    selectedRates.set(item.code,[...prior,item]);
   }
   return item;
  });
  return {key:card.key,title:card.title,items};
 });
}
async function reviewVersion(groups:any[]){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(groups)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function settingsOwnerAction(tx:any,a:any,p:any):Promise<any>{
 const act=String(p.action||'');
 if(!['settings_owners_read','settings_owners_confirm','settings_approvals_read','settings_approval_items_read','settings_approval_batch_approve'].includes(act))return undefined;
 if(!READERS.includes(a.category_code))fail(403,'Settings owners and approvals are for Managers and Partners.');
 if(act==='settings_owners_read'){
  const rows=ownerMatrix((await openOwners(tx)).map((o:any)=>({...o,confirmed_at:iso(o.confirmed_at)})));
  const staff=await tx`select staff_id,full_name,category_code from erp_private.staff_members where deleted_at is null and access_status='Active' and category_code<>'INTERN' order by full_name`;
  return {roles:OWNER_ROLES.map(([code,label]:any)=>({code,label})),rows,confirmed:rows.filter((r:any)=>r.confirmed).length,can_confirm:a.category_code==='PARTNER',staff:staff.map((s:any)=>({staff_id:s.staff_id,name:s.full_name,category:s.category_code}))};
 }
 if(act==='settings_owners_confirm'){
  if(a.category_code!=='PARTNER')fail(403,'A Partner confirms who owns each settings section.');
  const active=new Set((await tx`select staff_id from erp_private.staff_members where deleted_at is null and access_status='Active'`).map((r:any)=>String(r.staff_id)));
  const c=checkItems(p.items,(id:string)=>{try{return active.has(uuid(id));}catch{return false;}});if(!c.ok)fail(400,c.message);
  await tx`select pg_advisory_xact_lock(hashtextextended('settings-owners',0))`;
  let confirmed=0,unchanged=0;
  for(const i of c.items){
   const open=(await tx`select owner_id,owner_role,owner_staff_id from erp_private.settings_section_owners where section_key=${i.section_key} and ended_at is null for update`)[0];
   const same=open&&open.owner_role===i.owner_role&&String(open.owner_staff_id||'')===String(i.staff_id||'');
   if(same){unchanged++;continue;}
   if(open)await tx`update erp_private.settings_section_owners set ended_by=${a.staff_id},ended_at=now() where owner_id=${open.owner_id}`;
   await tx`insert into erp_private.settings_section_owners(section_key,owner_role,owner_staff_id,note,confirmed_by) values(${i.section_key},${i.owner_role},${i.staff_id},${i.note},${a.staff_id})`;
   confirmed++;
  }
  return {confirmed,unchanged};
 }
 if(act==='settings_approval_items_read'){
  const keys=Array.isArray(p.queue_keys)?[...new Set(p.queue_keys.map((x:any)=>String(x)))]:[];
  if(!keys.length||keys.length>3||keys.some((k:string)=>!Object.hasOwn(BULK_TYPES,k)))fail(400,'Choose one or more supported approval groups. Refresh the dashboard.');
  const canTax=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
  const all=await approvalGroups(tx,a,canTax,true);
  return {groups:all.filter((g:any)=>keys.includes(g.key)),max_batch:MAX_BATCH};
 }
 if(act==='settings_approval_batch_approve'){
  const preview=p.preview_only===true;
  if(!preview&&p.review_confirmed!==true)fail(400,'Confirm that you reviewed every selected item before approving.');
  const selections=cleanSelections(p.selections),counts:any={},auditRows:any[]=[];
  if(!preview&&selections.some((g:any)=>g.queue_key==='approve_tax_rates')&&p.tax_source_review_confirmed!==true)fail(400,'Tax rule approval requires an official Kenya Law, KRA, Gazette or competent regulator source URL. Confirm that you opened and checked the source for every selected tax rule.');
  const checked=preview||p.review_version?await prepareBatch(tx,a,selections):null;
  const version=checked?await reviewVersion(checked):null;
  if(preview)return {groups:checked,review_version:version};
  if(checked&&p.review_version!==version)fail(409,'The details changed after the batch was previewed. Reload Quick review and review the current records.');

  for(const group of selections){
   if(group.queue_key==='approve_tax_rates'){
    const ids=[];
    for(const item of group.items){
     const rateId=uuid(item.id);
     try{await taxConfigAction(tx,a,{action:'rate_approve',rate_id:rateId,revision:revision(item.revision),confirm_legal_basis:true});}
     catch(error){throw Object.assign(error,{approval_item:{queue_key:group.queue_key,id:rateId}});}
     ids.push(rateId);
    }
    counts[group.queue_key]=ids.length;auditRows.push({record_type:BULK_TYPES[group.queue_key],ids});
   }else if(group.queue_key==='approve_chart'){
    await requireBulkRight(tx,a,'acct.setup');
    const ids=[];
    for(const item of group.items){
     const code=String(item.id);if(!/^\d{5}$/.test(code))fail(400,'A chart code is invalid. Refresh the dashboard.');
     try{await accountingAction(tx,a,{action:'accounting_account_approve',code,revision:revision(item.revision)});}
     catch(error){throw Object.assign(error,{approval_item:{queue_key:group.queue_key,id:code}});}
     ids.push(code);
    }
    counts[group.queue_key]=ids.length;auditRows.push({record_type:BULK_TYPES[group.queue_key],ids});
   }else{
    await requireBulkRight(tx,a,'fs.map');
    const ids=group.items.map((x:any)=>uuid(x.id));
    const result=await statementMapAction(tx,a,{action:'ledger_statement_map_review_approve',scope:'group',map_ids:ids,map_revisions:checked?group.items.map((x:any)=>x.revision):null,review_note:''});
    counts[group.queue_key]=Number(result.reviewed||0);auditRows.push({record_type:BULK_TYPES[group.queue_key],ids});
   }
  }
  const batchId=crypto.randomUUID();
  let approvedAt:any=null;
  for(const row of auditRows){
   const [saved]=await tx`insert into erp_private.approval_batches(batch_id,user_id,record_type,items_approved,item_ids,review_confirmed) values(${batchId},${a.staff_id},${row.record_type},${row.ids.length},${tx.json(row.ids)},true) returning approved_at`;
   approvedAt=saved.approved_at;
  }
  const reviewer=(await tx`select erp_private.staff_name(${a.staff_id}) as name`)[0]?.name||'';
  return {ok:true,batch_id:batchId,counts,total:Object.values(counts).reduce((n:number,x:any)=>n+Number(x||0),0),
   approved_at:iso(approvedAt),approved_by:reviewer,groups:checked};

 }
 // settings_approvals_read: what waits, by action type and for this user. The setting's own handlers still decide the final approval.
 const hub=await settingsHubAction(tx,a,{action:'settings_hub_read'});
 const canTax=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
 const me=(await tx`select erp_private.staff_name(${a.staff_id}) as n`)[0]?.n||null;
 const reg=(await tx`select erp_private.settings_register() as r`)[0]?.r,t=today();
 const ownerBy=new Map((await openOwners(tx)).map((o:any)=>[o.section_key,o.owner_role]));
 const suggested=new Map(hub.sections.map((s:any)=>[s.key,s.role||null]));
 const ownerRole=(key:string)=>ownerBy.get(key)||null;
 const queues=hub.waiting.map((s:any)=>({key:s.key,title:s.title,count:s.pending,verb:s.needs,where:s.where,go:s.go||null,
  owner_role:ownerRole(s.key),owner_confirmed:!!ownerRole(s.key),owner_label:ownerRole(s.key)?roleLabel(ownerRole(s.key)):(suggested.get(s.key)?roleLabel(suggested.get(s.key))+' (suggested)':''),
  needs_my_action:queueNeedsMe(s.key,a.category_code,canTax)}));
 const records=(Array.isArray(reg)?reg:[]).map((r:any)=>present(r,t)).map((r:any)=>{const key=(AREA_SECTION as any)[r.area]||null,role=key?ownerRole(key):null;
  return {area:r.area,area_label:r.area_label,record_id:r.record_id,label:r.label,state:r.state,native_status:r.native_status,effective_from:r.effective_from,effective_to:r.effective_to,expires_on:r.expires_on,
   prepared_by:r.prepared_by,approver:r.approver,tab:r.tab,scope:r.extra?.client_name||'Firm-wide',owner_role:role,owner_label:role?roleLabel(role):'',
   needs_my_action:recordNeedsMe(r,a.category_code,me,canTax)};});
 // Renewals: authorisations, policy reviews and rule periods that end within 60 days or have already lapsed, oldest first, each with its owner and the record to open.
 const renewals=buildOverview(Array.isArray(reg)?reg:[],[],t).expiring.map((e:any)=>{const key=(AREA_SECTION as any)[e.area]||null,role=key?ownerRole(key):null;return {...e,owner_label:role?roleLabel(role):''};});
 const scopes=[...new Set(records.map((r:any)=>r.scope).filter((s:string)=>s!=='Firm-wide'))].sort();
 const actionGroups=await approvalGroups(tx,a,canTax);
 const otherQueues=queues.filter((q:any)=>q.needs_my_action&&!Object.hasOwn(BULK_TYPES,q.key));
 const counted=new Set([...Object.keys(BULK_TYPES),...otherQueues.map((q:any)=>q.key)]);
 const actionableTotal=actionGroups.reduce((n:number,g:any)=>n+Number(g.actionable_count||0),0)
  +otherQueues.reduce((n:number,q:any)=>n+Number(q.count||0),0)
  +records.filter((r:any)=>r.needs_my_action&&!counted.has((AREA_SECTION as any)[r.area])).length;
 return {queues,records,renewals,scopes,actionGroups,actionableTotal,roles:OWNER_ROLES.map(([code,label]:any)=>({code,label})),me,note:'Each approval uses its existing typed review path. Items that fail a permission, source or maker-checker check stay out of the bulk selection.'};
}
