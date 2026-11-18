import {fail,uuid,revision} from './validation.mjs';
import {ownerMatrix,checkItems,OWNER_ROLES,AREA_SECTION,queueNeedsMe,recordNeedsMe,roleLabel} from './settings-owner-rules.mjs';
import {present,buildOverview} from './settings-state-rules.mjs';
import {settingsHubAction,openOwners} from './settings-hub-actions.ts';
import {taxConfigAction} from './tax-config-actions.ts';
import {accountingAction} from './accounting-actions.ts';
import {statementMapAction} from './annual-pack.ts';
import {testRate,rateApprovalIssue} from './tax-registry.mjs';

// Settings owners and the approval task board. Owners only describe responsibility; the typed settings handlers remain the final authority for every approval.
const READERS=['PARTNER','MANAGER'];
const today=()=>new Date(Date.now()+3*3600*1000).toISOString().slice(0,10);
const iso=(v:any)=>v?new Date(v).toISOString():null;
const BULK_TYPES=Object.freeze({approve_tax_rates:'TAX_RATE',approve_chart:'CHART_ACCOUNT',approve_statement_lines:'STATEMENT_MAP'});
async function requireBulkRight(tx:any,a:any,right:string){
 const denied=await tx`select 1 from erp_private.staff_right_restrictions where staff_id=${a.staff_id} and right_code=${right}`;
 if(denied.length)fail(403,'Your access to the underlying approval path has been switched off. Ask a Manager or Partner to restore it.');
}
function taxBlock(r:any,staffId:string){
 if(!['Draft','Testing'].includes(r.status))return 'This rate is no longer waiting for approval.';
 if(testRate(r))return 'Test-only rates cannot be approved for client computations.';
 return rateApprovalIssue(r,staffId)||'';
}
async function approvalGroups(tx:any,a:any,canTax:boolean,details=false){
 const restrictions=await tx`select right_code from erp_private.staff_right_restrictions where staff_id=${a.staff_id} and right_code=any(${tx.array(['acct.setup','fs.map'])}::text[])`;
 const denied=new Set(restrictions.map((x:any)=>x.right_code));
 const rates=await tx`select rate_id,rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,legal_citation,legal_review_status,legal_review_reference,created_by,erp_private.staff_name(created_by) prepared_by,revision,status,is_test from erp_private.tax_rates where deleted_at is null and status in ('Draft','Testing') order by tax_type,rate_key,effective_from`;
 const chart=await tx`select code,name,account_group,route,category_code,statement,tax_note,evidence,notes,status,proposed_by,erp_private.staff_name(proposed_by) prepared_by,revision from erp_private.account_catalog where status='Draft' order by code`;
 const review=await statementMapAction(tx,a,{action:'ledger_statement_map_review_read'});
 const allMapIds=review.groups.flatMap((g:any)=>g.accounts.map((x:any)=>x.map_id));
 const proposers=allMapIds.length?await tx`select map_id,proposed_by from erp_private.account_statement_map where map_id=any(${tx.array(allMapIds)}::uuid[])`:[];
 const proposerById=new Map(proposers.map((x:any)=>[String(x.map_id),x.proposed_by?String(x.proposed_by):null]));
 const ownConsistentCount=review.groups.reduce((n:number,g:any)=>n+g.accounts.filter((x:any)=>proposerById.get(String(x.map_id))===String(a.staff_id)).length,0);
 const cards:any[]=[
  {key:'approve_tax_rates',title:'Tax rates awaiting legal approval',type:'tax_rate',waiting_count:rates.length,items:rates.map((r:any)=>{const reason=!canTax?'Only the assigned Tax Manager or an Engagement Partner can approve tax rules.':taxBlock(r,a.staff_id);return {id:String(r.rate_id),revision:r.revision,label:r.label,code:r.rate_key,kind:r.tax_type,effective_from:iso(r.effective_from)?.slice(0,10),effective_to:iso(r.effective_to)?.slice(0,10),parameters:r.parameters||{},source_url:r.source_url||'',source_note:r.source_note||'',legal_citation:r.legal_citation||'',legal_review_status:r.legal_review_status||'',legal_review_reference:r.legal_review_reference||'',prepared_by:r.prepared_by||'Starter rule',eligible:!reason,reason};})},
  {key:'approve_chart',title:'Chart of accounts additions',type:'chart_account',waiting_count:chart.length,items:chart.map((r:any)=>{const reason=denied.has('acct.setup')?'Your chart-account approval right is switched off.':a.category_code!=='PARTNER'?'Partner approval is required.':!r.proposed_by?'The proposer could not be identified for this draft. Record a new proposal before approval.':String(r.proposed_by)===String(a.staff_id)?'The person who proposed this account cannot approve it.':'';return {id:r.code,revision:r.revision,label:r.name,code:r.code,kind:r.account_group,route:r.route,category_code:r.category_code,statement:r.statement,tax_note:r.tax_note||'',evidence:r.evidence||'',notes:r.notes||'',prepared_by:r.prepared_by||'Unknown proposer',eligible:!reason,reason};})},
  {key:'approve_statement_lines',title:'Consistent statement-line mappings',type:'statement_map',waiting_count:Number(review.summary?.total||0),review_actionable_count:a.category_code==='PARTNER'&&!denied.has('fs.map')?Math.max(0,Number(review.summary?.total||0)-ownConsistentCount):0,blocked_note:denied.has('fs.map')?'Your statement-line mapping approval right is switched off.':a.category_code!=='PARTNER'?'Only a Partner may approve statement-line mappings.':'Exceptions, unchanged mappings and mappings you proposed are outside the grouped approval path.',items:review.groups.map((g:any)=>{const own=g.accounts.some((x:any)=>proposerById.get(String(x.map_id))===String(a.staff_id));const reason=denied.has('fs.map')?'Your statement-line mapping approval right is switched off.':a.category_code!=='PARTNER'?'Only a Partner may approve statement-line mappings.':own?'A Partner cannot approve mappings they proposed.':'';return {group_id:g.line_code,label:g.label,kind:g.statement,eligible:!reason,reason,items:g.accounts.map((x:any)=>({id:String(x.map_id),label:x.account_name,code:x.account_code,effective_from:x.effective_from,origin:x.seeded?'Starter mapping':'Proposed mapping',revision:null}))};})}
 ];
 for(const c of cards){
  if(c.key==='approve_statement_lines')c.actionable_count=c.items.filter((g:any)=>g.eligible).reduce((n:number,g:any)=>n+g.items.length,0);
  else c.actionable_count=c.items.filter((i:any)=>i.eligible).length;
  c.blocked_count=c.waiting_count-c.actionable_count;
 }
 return details?cards:cards.map(({items,...card}:any)=>({...card,items:[]}));
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
 if(count>500)fail(400,'Approve at most 500 items in one batch.');
 out.sort((x:any,y:any)=>x.queue_key.localeCompare(y.queue_key));
 return out;
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
  return {groups:all.filter((g:any)=>keys.includes(g.key)),max_batch:500};
 }
 if(act==='settings_approval_batch_approve'){
  if(p.review_confirmed!==true)fail(400,'Confirm that you reviewed every selected item before approving.');
  const selections=cleanSelections(p.selections),counts:any={},auditRows:any[]=[];
  for(const group of selections){
   if(group.queue_key==='approve_tax_rates'){
    const ids=[];
    for(const item of group.items){const rateId=uuid(item.id);await taxConfigAction(tx,a,{action:'rate_approve',rate_id:rateId,revision:revision(item.revision),confirm_legal_basis:true});ids.push(rateId);}
    counts[group.queue_key]=ids.length;auditRows.push({record_type:BULK_TYPES[group.queue_key],ids});
   }else if(group.queue_key==='approve_chart'){
    await requireBulkRight(tx,a,'acct.setup');
    const ids=[];
    for(const item of group.items){const code=String(item.id);if(!/^\d{5}$/.test(code))fail(400,'A chart code is invalid. Refresh the dashboard.');await accountingAction(tx,a,{action:'accounting_account_approve',code,revision:revision(item.revision)});ids.push(code);}
    counts[group.queue_key]=ids.length;auditRows.push({record_type:BULK_TYPES[group.queue_key],ids});
   }else{
    await requireBulkRight(tx,a,'fs.map');
    const ids=group.items.map((x:any)=>uuid(x.id));
    const result=await statementMapAction(tx,a,{action:'ledger_statement_map_review_approve',scope:'group',map_ids:ids,review_note:''});
    counts[group.queue_key]=Number(result.reviewed||0);auditRows.push({record_type:BULK_TYPES[group.queue_key],ids});
   }
  }
  const batchId=crypto.randomUUID();
  for(const row of auditRows)await tx`insert into erp_private.approval_batches(batch_id,user_id,record_type,items_approved,item_ids,review_confirmed) values(${batchId},${a.staff_id},${row.record_type},${row.ids.length},${tx.json(row.ids)},true)`;
  return {ok:true,batch_id:batchId,counts,total:Object.values(counts).reduce((n:number,x:any)=>n+Number(x||0),0)};
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
 const actionableTotal=actionGroups.reduce((n:number,g:any)=>n+(g.key==='approve_statement_lines'?Number(g.review_actionable_count||0):Number(g.actionable_count||0)),0)+queues.filter((q:any)=>q.needs_my_action&&!BULK_TYPES[q.key]).reduce((n:number,q:any)=>n+Number(q.count||0),0)+records.filter((r:any)=>r.needs_my_action&&r.area!=='tax_rate').length;
 return {queues,records,renewals,scopes,actionGroups,actionableTotal,roles:OWNER_ROLES.map(([code,label]:any)=>({code,label})),me,note:'Each approval uses its existing typed review path. Items that fail a permission, source or maker-checker check stay out of the bulk selection.'};
}
