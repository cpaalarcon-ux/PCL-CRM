import {fail,text,uuid,choice} from './validation.mjs';
import {assetIssues,registerYear,reconcileRegister,noteSchedule,registerReadiness,rateGapFill,ORIGINS,DISPOSAL_KINDS,POLICY} from './ppe-register-rules.mjs';
// The PPE register (build 2881). Staff declare an asset or a disposal; a Manager or Partner who did not declare it approves it (a sole Partner may approve their own, and it is recorded). Approved
// records are never edited: a correction is a new version, and a record made in error is ended with a reason. The register works out each year from the approved records and the reviewed
// class rates, and is checked against the trial balance. Nothing here posts a journal or changes a rate. The server owns every rule; the screen draws what it returns.
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const canDeclare=(a:any)=>['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code);
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const dateOf=(v:any,label:string)=>{const d=day(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||Number.isNaN(Date.parse(d+'T00:00:00Z')))fail(400,`Enter a valid ${label}.`);return d;};
const num=(v:any,label:string,min=0)=>{if(v===''||v==null||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<min)fail(400,`Enter a valid ${label}.`);return Number(v);};
const ACTIONS=['ledger_ppe_read','ledger_ppe_asset_declare','ledger_ppe_asset_review','ledger_ppe_asset_end','ledger_ppe_disposal_declare','ledger_ppe_disposal_review','ledger_ppe_disposal_end'];
export const PPE_CHECK_NOTE='The register is built from approved records and the reviewed class rates. It is a working schedule: it never posts a journal and never changes the trial balance.';

async function loadClassRates(tx:any){return await tx`select class_code,name,first_rate,annual_rate,later_basis_percentage,expense_account,contra_account,tax_cost_cap,effective_from,effective_to,scope,source_reference,source_checked_on from erp_private.asset_class_rates order by class_code,effective_from`;}
async function loadAccounts(tx:any){return await tx`select code,name,status,is_legacy,route from erp_private.account_catalog where route=3 order by code`;}
async function loadRecords(tx:any,clientId:string){
 const assets=await tx`select record_id,asset_key,version,client_id,asset_name,asset_account,class_code,acquired_on,first_use_on,cost,business_percentage,noncommercial_vehicle,origin,bf_as_of,bf_accumulated_depreciation,bf_tax_wdv,source_row_id,evidence,status,prepared_by,prepared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(prepared_by) prepared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.ppe_assets where client_id=${clientId} and status in ('Draft','Approved','Returned') order by asset_name,version desc`;
 const disposals=await tx`select record_id,asset_key,version,client_id,disposed_on,proceeds,kind,evidence,status,prepared_by,prepared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(prepared_by) prepared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.ppe_disposals where client_id=${clientId} and status in ('Draft','Approved','Returned') order by disposed_on,version desc`;
 return {assets,disposals};
}
const approvedOf=(rows:any[])=>rows.filter((r:any)=>r.status==='Approved');
const plain=(r:any)=>({...r,cost:Number(r.cost),business_percentage:Number(r.business_percentage),bf_accumulated_depreciation:r.bf_accumulated_depreciation==null?null:Number(r.bf_accumulated_depreciation),bf_tax_wdv:r.bf_tax_wdv==null?null:Number(r.bf_tax_wdv),acquired_on:day(r.acquired_on),first_use_on:day(r.first_use_on),bf_as_of:r.bf_as_of?day(r.bf_as_of):null});

// The register for a year and its check against the trial balance. Shared by the screen and by the annual pack, so both always show the same figures.
export async function ppeRegisterFor(tx:any,l:any,tb:any[]){
 const {assets,disposals}=await loadRecords(tx,l.client_id),rates=await loadClassRates(tx),accounts=await loadAccounts(tx);
 const ap=approvedOf(assets).map(plain),dp=approvedOf(disposals).map((d:any)=>({...d,proceeds:Number(d.proceeds),disposed_on:day(d.disposed_on)}));
 const register=registerYear({assets:ap,disposals:dp,rates:rates.map((r:any)=>({...r,effective_from:day(r.effective_from),effective_to:day(r.effective_to)})),start:day(l.starts_on),end:day(l.ends_on)});
 const ppeCodes=accounts.filter((x:any)=>x.status==='Active'&&!x.is_legacy).map((x:any)=>x.code);
 const reconciliation=reconcileRegister({register,tb,ppeCodes,rates});
 const balances=(tb||[]).some((x:any)=>(ppeCodes.includes(String(x.code))||rates.some((r:any)=>r.contra_account===String(x.code)))&&Math.round(Number(x.net||0)*100)!==0);
 const drafts=assets.filter((r:any)=>r.status==='Draft').length+disposals.filter((r:any)=>r.status==='Draft').length;
 const readiness=registerReadiness({register,reconciliation,drafts,hasPpeBalances:balances,hasAssets:ap.length>0});
 const names=new Map(accounts.map((x:any)=>[x.code,x.name]));
 return {register,reconciliation,readiness,schedule:ap.length?noteSchedule(register,names):null,drafts};
}

async function refuseIfLocked(tx:any,clientId:string,effective:string){
 if((await tx`select erp_private.ppe_date_locked(${clientId}::uuid,${effective}::date) as locked`)[0].locked)fail(409,'The pack is locked by an audit, so the register cannot change. A Partner ends the lock first.');
 const closed=await tx`select ends_on from erp_private.ledger_periods where client_id=${clientId} and status='Closed' and ends_on>=${effective}::date limit 1`;
 if(closed.length)fail(409,`The year ending ${day(closed[0].ends_on)} is closed, so a record that affects it cannot be added. A closed year is corrected by a controlled adjustment.`);
}
const effectiveDate=(r:any)=>r.bf_as_of?new Date(Date.parse(day(r.bf_as_of)+'T00:00:00Z')+86400000).toISOString().slice(0,10):day(r.acquired_on);

export async function ppeAction(tx:any,a:any,l:any,p:any,getTb:(asOf:string)=>Promise<any>,asOf:string){
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The PPE register is for staff who prepare or review statements.');
 const cid=l.client_id as string;
 if(p.action==='ledger_ppe_read'){
  const data=await getTb(asOf),state=await ppeRegisterFor(tx,l,data.tb||[]),{assets,disposals}=await loadRecords(tx,cid),rates=await loadClassRates(tx),accounts=await loadAccounts(tx);
  const locked=(await tx`select erp_private.ppe_date_locked(${cid}::uuid,${day(l.starts_on)}::date) as locked`)[0].locked,open=l.status==='Open'&&!locked;
  const byKey=new Map<string,any>();
  for(const r of assets){const g=byKey.get(r.asset_key)||{asset_key:r.asset_key,approved:null,draft:null,returned:null};
   if(r.status==='Approved')g.approved=r;else if(r.status==='Draft')g.draft=r;else if(r.status==='Returned'&&(!g.returned||r.version>g.returned.version))g.returned=r;byKey.set(r.asset_key,g);}
  const dBy=new Map<string,any>();
  for(const d of disposals){const g=dBy.get(d.asset_key)||{approved:null,draft:null,returned:null};if(d.status==='Approved')g.approved=d;else if(d.status==='Draft')g.draft=d;else if(!g.returned||d.version>g.returned.version)g.returned=d;dBy.set(d.asset_key,g);}
  const view=(r:any)=>r&&{...plain(r),record_id:r.record_id,version:r.version,status:r.status,prepared_name:r.prepared_name,prepared_at:r.prepared_at,reviewed_name:r.reviewed_name,reviewed_at:r.reviewed_at,review_note:r.review_note,sole_partner_approval:r.sole_partner_approval,declared_by_me:r.prepared_by===a.staff_id};
  const dview=(d:any)=>d&&{record_id:d.record_id,version:d.version,status:d.status,disposed_on:day(d.disposed_on),proceeds:Number(d.proceeds),kind:d.kind,evidence:d.evidence,prepared_name:d.prepared_name,reviewed_name:d.reviewed_name,review_note:d.review_note,declared_by_me:d.prepared_by===a.staff_id,sole_partner_approval:d.sole_partner_approval};
  const list=[...byKey.values()].map((g:any)=>{const shown=g.approved||g.draft||g.returned,dd=dBy.get(g.asset_key)||{approved:null,draft:null,returned:null};
   return {asset_key:g.asset_key,state:g.draft?'Waiting for approval':g.approved?'Approved':'Returned',approved:view(g.approved),draft:view(g.draft),returned:view(g.returned),name:shown.asset_name,
    disposal:{state:dd.draft?'Waiting for approval':dd.approved?'Approved':dd.returned?'Returned':'None',approved:dview(dd.approved),draft:dview(dd.draft),returned:dview(dd.returned)},
    can_review:isLeader(a)&&open&&!!g.draft&&(g.draft.prepared_by!==a.staff_id||a.category_code==='PARTNER'),
    can_dispose:canDeclare(a)&&open&&!!g.approved&&!dd.draft&&!dd.approved,can_end:isLeader(a)&&open&&!!g.approved&&!dd.draft&&!dd.approved,
    can_review_disposal:isLeader(a)&&open&&!!dd.draft&&(dd.draft.prepared_by!==a.staff_id||a.category_code==='PARTNER'),can_end_disposal:isLeader(a)&&open&&!!dd.approved&&!dd.draft};});
  // Purchases already mapped to a property, plant and equipment account in this year and not yet in the register, so an asset is not typed twice.
  const used=new Set(assets.map((r:any)=>r.source_row_id).filter(Boolean));
  const rows=await tx`select r.row_id,r.account_code,r.narration,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.client_id=${cid} and b.archived_at is null and r.route=3 and r.account_code is not null and r.parent_row_id is null and not r.is_split_parent
    and coalesce(r.normalized->>'date',b.period_start::text)>=${day(l.starts_on)} and coalesce(r.normalized->>'date',b.period_start::text)<=${day(l.ends_on)} order by r.normalized->>'date' limit 200`;
  const candidates=rows.filter((r:any)=>!used.has(r.row_id)).map((r:any)=>({source_row_id:r.row_id,asset_account:r.account_code,asset_name:String(r.narration||r.normalized?.description||'').slice(0,160),acquired_on:day(r.normalized?.date),cost:Number(r.normalized?.amount||0),supplier:r.normalized?.party||''}));
  const classes=[...new Map(rates.map((r:any)=>[r.class_code,r.name])).entries()].map(([code,name])=>({code,name}));
  const dated=rates.map((r:any)=>({...r,effective_from:day(r.effective_from),effective_to:day(r.effective_to),source_checked_on:r.source_checked_on?day(r.source_checked_on):null}));
  // Classes with no reviewed rate for a year the register needs (build 2883). A Partner may add the rate; the prefill carries the nearest row's percentages and accounts and leaves the authority blank.
  const rateGaps=(state.register.rate_gaps||[]).map((g:any)=>({...g,fill:rateGapFill(dated,g.class_code,g.start,g.end)}));
  return {year:{start:day(l.starts_on),end:day(l.ends_on),open},locked,register:{rate_gaps:rateGaps,rows:state.register.rows,totals:state.register.totals,issues:state.register.issues,policy:POLICY},reconciliation:state.reconciliation,readiness:state.readiness,schedule:state.schedule,
   assets:list,candidates,classes,accounts:accounts.filter((x:any)=>x.status==='Active'&&!x.is_legacy).map((x:any)=>({code:x.code,name:x.name})),origins:ORIGINS,kinds:DISPOSAL_KINDS,
   can_declare:canDeclare(a)&&open,can_add_rate:a.category_code==='PARTNER',note:PPE_CHECK_NOTE};
 }
 // ---- changes ----
 if(p.action==='ledger_ppe_asset_declare'){
  if(!canDeclare(a))fail(403,'Staff who prepare the statements declare assets.');
  const rates=await loadClassRates(tx),accounts=await loadAccounts(tx);
  const key=p.asset_key?uuid(p.asset_key):crypto.randomUUID(),origin=choice(p.origin,ORIGINS),bf=origin==='Brought forward';
  const v:any={asset_name:text(p.asset_name,160,true),asset_account:text(p.asset_account,10,true),class_code:text(p.class_code,30,true),acquired_on:dateOf(p.acquired_on,'acquisition date'),first_use_on:dateOf(p.first_use_on,'first-use date'),cost:num(p.cost,'cost'),
   business_percentage:p.business_percentage===''||p.business_percentage==null?100:num(p.business_percentage,'business use'),noncommercial_vehicle:p.noncommercial_vehicle===true||p.noncommercial_vehicle==='true',origin,
   bf_as_of:bf?dateOf(p.bf_as_of,'brought-forward date'):null,bf_accumulated_depreciation:bf?num(p.bf_accumulated_depreciation,'accumulated depreciation brought forward'):null,bf_tax_wdv:bf?num(p.bf_tax_wdv,'tax written-down value brought forward'):null,evidence:text(p.evidence??'',500,false)};
  const bad=assetIssues(v,{accounts,rates});if(bad.length)fail(400,bad.join(' '));
  let source:string|null=null;
  if(p.source_row_id){
   const r=(await tx`select row_id,client_id,route,account_code from erp_private.workbook_rows where row_id=${uuid(p.source_row_id)}`)[0];
   if(!r||r.client_id!==cid||Number(r.route)!==3||r.account_code!==v.asset_account)fail(400,'The purchase must belong to this client and be mapped to the same property, plant and equipment account.');
   source=r.row_id;
  }
  await refuseIfLocked(tx,cid,effectiveDate(v));
  await tx`select pg_advisory_xact_lock(hashtextextended(${'ppe:'+key},0))`;
  if(p.asset_key){
   const cur=await tx`select record_id,status,client_id from erp_private.ppe_assets where asset_key=${key} and status in ('Draft','Approved')`;
   if(!cur.length||cur.some((r:any)=>r.client_id!==cid))fail(404,'That asset is not in this client’s register.');
   if((await tx`select 1 from erp_private.ppe_disposals where asset_key=${key} and status in ('Draft','Approved')`).length)fail(409,'This asset has a disposal. End the disposal before changing the asset.');
  }
  await tx`update erp_private.ppe_assets set status='Superseded' where asset_key=${key} and status='Draft'`;
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.ppe_assets where asset_key=${key}`)[0].v);
  return (await tx`insert into erp_private.ppe_assets(asset_key,version,client_id,asset_name,asset_account,class_code,acquired_on,first_use_on,cost,business_percentage,noncommercial_vehicle,origin,bf_as_of,bf_accumulated_depreciation,bf_tax_wdv,source_row_id,evidence,prepared_by)
   values(${key},${ver},${cid},${v.asset_name},${v.asset_account},${v.class_code},${v.acquired_on},${v.first_use_on},${v.cost},${v.business_percentage},${v.noncommercial_vehicle},${v.origin},${v.bf_as_of},${v.bf_accumulated_depreciation},${v.bf_tax_wdv},${source},${v.evidence},${a.staff_id}) returning record_id,asset_key,version,status`)[0];
 }
 if(p.action==='ledger_ppe_asset_review'){
  if(!isLeader(a))fail(403,'A Manager or Partner approves or returns an asset.');
  const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false);
  const r=(await tx`select record_id,asset_key,status,prepared_by,client_id,acquired_on,bf_as_of from erp_private.ppe_assets where record_id=${uuid(p.record_id)}`)[0];
  if(!r||r.client_id!==cid||r.status!=='Draft')fail(409,'This asset record has changed. Refresh and review the latest one.');
  await refuseIfLocked(tx,cid,effectiveDate(r));
  await tx`select pg_advisory_xact_lock(hashtextextended(${'ppe:'+r.asset_key},0))`;
  if(decision==='Returned'){
   if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
   await tx`update erp_private.ppe_assets set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where record_id=${r.record_id}`;return {status:'Returned'};
  }
  const own=r.prepared_by===a.staff_id;
  if(own&&(a.category_code!=='PARTNER'||p.sole_partner_approval!==true))fail(403,'Someone else approves an asset you declared. If you are your firm’s only Partner, confirm that when you approve.');
  await tx`update erp_private.ppe_assets set status='Superseded' where asset_key=${r.asset_key} and status='Approved'`;
  await tx`update erp_private.ppe_assets set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where record_id=${r.record_id}`;
  return {status:'Approved',sole_partner_approval:own};
 }
 if(p.action==='ledger_ppe_asset_end'){
  if(!isLeader(a))fail(403,'A Manager or Partner ends an asset record.');
  const reason=text(p.reason??'',500,false);if(reason.trim().length<10)fail(400,'Say why (at least 10 characters).');
  const r=(await tx`select record_id,asset_key,status,client_id,acquired_on,bf_as_of from erp_private.ppe_assets where asset_key=${uuid(p.asset_key)} and status='Approved'`)[0];
  if(!r||r.client_id!==cid)fail(409,'There is no approved record of that asset to end.');
  await refuseIfLocked(tx,cid,effectiveDate(r));
  await tx`update erp_private.ppe_assets set status='Ended',ended_by=${a.staff_id},ended_at=now(),ended_reason=${reason} where record_id=${r.record_id}`;
  return {status:'Ended'};
 }
 if(p.action==='ledger_ppe_disposal_declare'){
  if(!canDeclare(a))fail(403,'Staff who prepare the statements declare disposals.');
  const key=uuid(p.asset_key),kind=choice(p.kind,DISPOSAL_KINDS),on=dateOf(p.disposed_on,'disposal date'),proceeds=num(p.proceeds??0,'proceeds'),evidence=text(p.evidence??'',500,false);
  if(evidence.trim().length<10)fail(400,'Say what supports the disposal (a sale invoice, a scrap certificate or a police abstract), at least 10 characters.');
  if(!['Sold','Scrapped','Lost or stolen'].includes(kind)&&proceeds!==0)fail(400,'A donated asset has no proceeds.');
  const asset=(await tx`select record_id,client_id,first_use_on,origin,bf_as_of from erp_private.ppe_assets where asset_key=${key} and status='Approved'`)[0];
  if(!asset||asset.client_id!==cid)fail(404,'Dispose only of an approved asset in this client’s register.');
  await refuseIfLocked(tx,cid,on);
  await tx`select pg_advisory_xact_lock(hashtextextended(${'ppe-d:'+key},0))`;
  await tx`update erp_private.ppe_disposals set status='Superseded' where asset_key=${key} and status='Draft'`;
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.ppe_disposals where asset_key=${key}`)[0].v);
  return (await tx`insert into erp_private.ppe_disposals(asset_key,version,client_id,disposed_on,proceeds,kind,evidence,prepared_by) values(${key},${ver},${cid},${on},${proceeds},${kind},${evidence},${a.staff_id}) returning record_id,asset_key,version,status`)[0];
 }
 if(p.action==='ledger_ppe_disposal_review'){
  if(!isLeader(a))fail(403,'A Manager or Partner approves or returns a disposal.');
  const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false);
  const r=(await tx`select record_id,asset_key,status,prepared_by,client_id,disposed_on from erp_private.ppe_disposals where record_id=${uuid(p.record_id)}`)[0];
  if(!r||r.client_id!==cid||r.status!=='Draft')fail(409,'This disposal has changed. Refresh and review the latest one.');
  await refuseIfLocked(tx,cid,day(r.disposed_on));
  await tx`select pg_advisory_xact_lock(hashtextextended(${'ppe-d:'+r.asset_key},0))`;
  if(decision==='Returned'){
   if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
   await tx`update erp_private.ppe_disposals set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where record_id=${r.record_id}`;return {status:'Returned'};
  }
  const own=r.prepared_by===a.staff_id;
  if(own&&(a.category_code!=='PARTNER'||p.sole_partner_approval!==true))fail(403,'Someone else approves a disposal you declared. If you are your firm’s only Partner, confirm that when you approve.');
  await tx`update erp_private.ppe_disposals set status='Superseded' where asset_key=${r.asset_key} and status='Approved'`;
  await tx`update erp_private.ppe_disposals set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where record_id=${r.record_id}`;
  return {status:'Approved',sole_partner_approval:own};
 }
 // ledger_ppe_disposal_end
 if(!isLeader(a))fail(403,'A Manager or Partner ends a disposal record.');
 const reason=text(p.reason??'',500,false);if(reason.trim().length<10)fail(400,'Say why (at least 10 characters).');
 const r=(await tx`select record_id,client_id,disposed_on from erp_private.ppe_disposals where asset_key=${uuid(p.asset_key)} and status='Approved'`)[0];
 if(!r||r.client_id!==cid)fail(409,'There is no approved disposal of that asset to end.');
 await refuseIfLocked(tx,cid,day(r.disposed_on));
 await tx`update erp_private.ppe_disposals set status='Ended',ended_by=${a.staff_id},ended_at=now(),ended_reason=${reason} where record_id=${r.record_id}`;
 return {status:'Ended'};
}
