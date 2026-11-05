// Client chart of accounts (Step 2 of the entity / industry chart design).
// A client's chart = core accounts + the entity layer for its legal type + the industry packs of
// its activities + any extra accounts a Manager adds with a reason. A Manager or Partner proposes a
// dated version; a different Manager or Partner approves it. Once a version is approved, account
// choices and postings for that client are limited to it from its effective date.
import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {chosenReviewer,mustBeAskedReviewer,reviewCandidates,notifyReviewers,notifyOutcome} from './review-queue.ts';

const one=(r:any[])=>{if(!r.length)fail(403,'Record unavailable to this account.');return r[0];};
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must maintain the client chart of accounts.');};
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);

export function chartLayer(account:any){
 if(account.entity_types?.length)return 'Entity';
 if(account.industry_packs?.length)return 'Industry';
 return 'Core';
}

// Accounts the ERP proposes for an entity type and set of packs (pure, used by the server and tests).
export function proposeAccounts(accounts:any[],entityType:string,packs:string[]){
 return accounts.filter((x:any)=>x.status==='Active'&&!x.is_legacy
  &&(!x.entity_types?.length||x.entity_types.includes(entityType))
  &&(!x.industry_packs?.length||x.industry_packs.some((p:string)=>packs.includes(p))));
}

async function clientPacks(tx:any,clientId:string,from:string){
 const rows=await tx`select distinct pack_code from erp_private.client_activities where client_id=${clientId} and (effective_to is null or effective_to>=${from}) order by pack_code`;
 return rows.map((r:any)=>r.pack_code);
}

// Accounts this client already uses (mappings, mapped import rows, journal lines) on or after a date.
async function usedAccounts(tx:any,clientId:string,from:string){
 const rows=await tx`
  select erp_account_code code,'Client account mapping' source from erp_private.client_account_mappings
   where client_id=${clientId} and status in ('Draft','Active') and (effective_to is null or effective_to>=${from})
  union
  select r.account_code,'Mapped import row' from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
   where r.client_id=${clientId} and b.archived_at is null and r.account_code is not null
  union
  select x.account_code,'Journal line' from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) join erp_private.ledger_periods l using(period_id)
   where l.client_id=${clientId} and x.account_code is not null and j.status<>'Returned' and l.ends_on>=${from}`;
 const by=new Map<string,string[]>();
 for(const r of rows){if(!r.code)continue;const list=by.get(r.code)||[];if(!list.includes(r.source))list.push(r.source);by.set(r.code,list);}
 return by;
}

// The approved chart in force for a client on a date, or null when none applies yet.
export async function approvedChart(tx:any,clientId:string,at:string){
 const r=(await tx`select version_id,effective_from,accounts from erp_private.client_chart_versions
  where client_id=${clientId} and status='Approved' and effective_from<=${at} order by effective_from desc,reviewed_at desc limit 1`)[0];
 return r?{version_id:r.version_id,effective_from:day(r.effective_from),codes:new Set<string>(r.accounts)}:null;
}

// All approved versions for a client, resolved by date without further queries (used in bulk mapping).
export async function chartResolver(tx:any,clientId:string){
 const versions=(await tx`select effective_from,accounts from erp_private.client_chart_versions where client_id=${clientId} and status='Approved' order by effective_from desc,reviewed_at desc`).map((r:any)=>({from:day(r.effective_from),codes:new Set<string>(r.accounts)}));
 return (at:string)=>versions.find((v:any)=>v.from<=at)||null;
}
export const chartMessage=(code:string)=>`ERP account ${code} is not in this client's approved chart of accounts. Choose a chart account, or a Manager adds it in a new chart version.`;

// Mark catalogue rows for one client and date. in_client_chart is left undefined when no chart applies.
export async function chartCatalogue(tx:any,accounts:any[],clientId:string|null,at:string){
 const chart=clientId?await approvedChart(tx,clientId,at):null;
 if(!chart)return accounts;
 return accounts.map((x:any)=>({...x,in_client_chart:chart.codes.has(x.code)}));
}

export async function requireChartAccount(tx:any,clientId:string,code:string,at:string){
 const chart=await approvedChart(tx,clientId,at);
 if(chart&&!chart.codes.has(code))fail(400,chartMessage(code));
}

async function proposal(tx:any,clientId:string,from:string){
 const c=one(await tx`select client_id,company_name,legal_entity_type from erp_private.clients where client_id=${clientId} and deleted_at is null`);
 const packs=await clientPacks(tx,clientId,from);
 const catalog=await tx`select code,name,account_group,category_code,status,is_legacy,entity_types,industry_packs from erp_private.account_catalog order by code`;
 const proposed=proposeAccounts(catalog,c.legal_entity_type||'',packs);
 const codes=new Set(proposed.map((x:any)=>x.code)),used=await usedAccounts(tx,clientId,from);
 const exceptions=[...used.entries()].filter(([code])=>!codes.has(code)).map(([code,sources])=>{const x=catalog.find((y:any)=>y.code===code);return {code,name:x?.name||'Unknown account',sources,reason:x?(x.entity_types?.length&&!x.entity_types.includes(c.legal_entity_type)?`For ${x.entity_types.join(', ')} only`:x.industry_packs?.length?`Industry pack ${x.industry_packs.join(', ')} not among the client's activities`:x.status!=='Active'?'Account is not active':'Outside the proposal'):'Not in the master chart'};});
 const draftsForPacks=catalog.filter((x:any)=>x.status==='Draft'&&x.industry_packs?.some((p:string)=>packs.includes(p))).map((x:any)=>({code:x.code,name:x.name}));
 return {client:c,packs,accounts:proposed.map((x:any)=>({code:x.code,name:x.name,account_group:x.account_group,layer:chartLayer(x),entity_types:x.entity_types,industry_packs:x.industry_packs})),exceptions,awaiting_partner_approval:draftsForPacks,catalog};
}

export async function clientChartAction(tx:any,a:any,p:any){
 if(!['v3_client_chart_read','v3_client_chart_propose','v3_client_chart_review'].includes(p.action))return undefined;
 if(p.action==='v3_client_chart_read'){
  const cid=uuid(p.client_id),versions=await tx`select version_id,effective_from,entity_type,packs,cardinality(accounts) account_count,extra_accounts,status,prepared_by,prepared_at,reviewed_by,reviewed_at,review_note,revision,requested_reviewer_id,erp_private.reviewer_label(requested_reviewer_id) requested_reviewer_name from erp_private.client_chart_versions where client_id=${cid} order by created_at desc limit 20`;
  const firstPeriod=(await tx`select min(starts_on) d from erp_private.ledger_periods where client_id=${cid}`)[0]?.d;
  const from=date(p.effective_from)||day(firstPeriod)||`${new Date().getUTCFullYear()}-01-01`;
  const {catalog,...prop}=await proposal(tx,cid,from);
  const current=versions.find((v:any)=>v.status==='Approved');
  const stale=current?prop.packs.filter((x:string)=>!(current.packs||[]).includes(x)):[];
  return {...prop,reviewers:await reviewCandidates(tx,cid),effective_from:from,versions,draft:versions.find((v:any)=>v.status==='Draft')||null,current:current||null,
   status:current?(stale.length?'Out of date':'Approved'):versions.some((v:any)=>v.status==='Draft')?'Pending review':'Not approved',
   stale_packs:stale,extra_choices:catalog.filter((x:any)=>x.status==='Active'&&!x.is_legacy&&!prop.accounts.some((y:any)=>y.code===x.code)).map((x:any)=>({code:x.code,name:x.name}))};
 }
 if(p.action==='v3_client_chart_propose'){
  leader(a);const cid=uuid(p.client_id),from=date(p.effective_from);if(!from)fail(400,'Choose the date the client chart applies from.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-chart'},0))`;
  if((await tx`select 1 from erp_private.client_chart_versions where client_id=${cid} and status='Draft'`).length)fail(409,'A client chart version is already waiting for review. Review or return it first.');
  const prop=await proposal(tx,cid,from);
  if(!['Limited company','Partnership','Sole proprietor','Other legal entity'].includes(prop.client.legal_entity_type))fail(400,'Confirm the legal entity type before proposing the client chart.');
  if(!prop.packs.length)fail(400,'Approve at least one business activity before proposing the client chart.');
  const extras:any[]=[],seen=new Set<string>();
  for(const x of Array.isArray(p.extra_accounts)?p.extra_accounts.slice(0,200):[]){
   const code=text(x?.code,5),reason=text(x?.reason,500);if(seen.has(code))continue;seen.add(code);
   const acct=prop.catalog.find((y:any)=>y.code===code);
   if(!acct||acct.status!=='Active'||acct.is_legacy)fail(400,`Extra account ${code} must be an active master-chart account.`);
   if(acct.entity_types?.length&&!acct.entity_types.includes(prop.client.legal_entity_type))fail(400,`Account ${code} is for ${acct.entity_types.join(', ')} only and cannot be added for a ${prop.client.legal_entity_type}.`);
   if(reason.length<10)fail(400,`Give a reason of at least 10 characters for extra account ${code}.`);
   if(!prop.accounts.some((y:any)=>y.code===code))extras.push({code,reason});
  }
  const missing=prop.exceptions.filter((e:any)=>!extras.some((x:any)=>x.code===e.code));
  if(missing.length)fail(400,`These accounts are already used by the client but are outside the proposed chart: ${missing.slice(0,8).map((e:any)=>`${e.code} ${e.name} (${e.reason})`).join('; ')}${missing.length>8?` and ${missing.length-8} more`:''}. Add each as an extra account with a reason, or correct the mapping first.`);
  const codes=[...prop.accounts.map((x:any)=>x.code),...extras.map((x:any)=>x.code)].sort();
  const made=one(await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,extra_accounts,prepared_by,note,requested_reviewer_id)
   values(${cid},${from},${prop.client.legal_entity_type},${tx.array?tx.array(prop.packs):prop.packs},${tx.array?tx.array(codes):codes},${tx.json(extras)},${a.staff_id},${text(p.note||'',2000,false)||null},${await chosenReviewer(tx,a,cid,p.requested_reviewer_id)}) returning version_id,status,requested_reviewer_id`);
  await notifyReviewers(tx,cid,`client chart of accounts effective ${from}`,'review:chart:'+made.version_id,made.requested_reviewer_id);
  return {version_id:made.version_id,status:made.status};
 }
 // v3_client_chart_review
 leader(a);const v=one(await tx`select * from erp_private.client_chart_versions where version_id=${uuid(p.version_id)} for update`);
 if(String(v.revision)!==revision(p.revision))fail(409,'This chart version changed. Refresh before reviewing.');
 if(v.status!=='Draft')fail(400,'Only a chart version waiting for review can be approved or returned.');
 if(v.prepared_by===a.staff_id)fail(403,'A different Manager or Partner must review this client chart.');await mustBeAskedReviewer(tx,a,v.requested_reviewer_id);
 const status=choice(p.status,['Approved','Returned']),note=text(p.review_note,2000);if(note.length<10)fail(400,'Enter a review note of at least 10 characters.');
 if(status==='Approved'){
  const prop=await proposal(tx,v.client_id,day(v.effective_from)),codes=new Set(v.accounts);
  const missing=prop.exceptions.filter((e:any)=>!codes.has(e.code));
  if(missing.length)fail(409,`The client has started using accounts outside this version since it was proposed (${missing.slice(0,5).map((e:any)=>e.code).join(', ')}). Return it and propose a new version.`);
 }
 await tx`update erp_private.client_chart_versions set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where version_id=${v.version_id}`;
 await notifyOutcome(tx,v.prepared_by,v.client_id,'client chart of accounts',status,note,'outcome:chart:'+v.version_id+':'+status);
 return {ok:true,status};
}
