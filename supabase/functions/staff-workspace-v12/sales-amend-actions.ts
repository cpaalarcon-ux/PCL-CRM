import {fail,text,uuid,choice} from './validation.mjs';
import {ledgerAction} from './ledger-actions.ts';
import {notifyReviewers,notifyOutcome} from './review-queue.ts';
// Amend a confirmed sales summary. A confirmed summary is never edited: someone asks, a different Manager or Partner approves, the posted
// entries built from it are reversed (reviewed and posted by yet another approver through the normal journal flow), and then either a corrected
// summary replaces it (confirmed by an independent reviewer as usual) or it is withdrawn. Nothing is deleted.
const LEADERS=['PARTNER','MANAGER'];
const leader=(a:any)=>{if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner must do this step.');};
const REASONS=['Wrong month','Wrong amounts','Wrong file','Wrong client','Other'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const money=(v:any)=>Math.round((Number(v)||0)*100)/100;
const LIVE=['Requested','Approved','Reversing','Ready','Replacement saved'];

async function journalsFor(tx:any,importId:string){
 return await tx`select distinct j.journal_id,j.period_id,j.status,j.reference,j.journal_date,
  (select v.journal_id from erp_private.ledger_journals v where v.reversal_of=j.journal_id order by case v.status when 'Posted' then 0 else 1 end limit 1) reversal_id,
  (select v.status from erp_private.ledger_journals v where v.reversal_of=j.journal_id order by case v.status when 'Posted' then 0 else 1 end limit 1) reversal_status
  from erp_private.ledger_sources s join erp_private.ledger_journals j using(journal_id)
  where s.source_kind='Period import' and (s.source_key=${importId} or s.source_key like ${importId+':%'}) and j.kind<>'Reversal' order by j.journal_date,j.reference`;
}
function plan(journals:any[]){
 const open=journals.filter(j=>j.status!=='Posted'),need=journals.filter(j=>j.status==='Posted'&&!j.reversal_id),waiting=journals.filter(j=>j.status==='Posted'&&j.reversal_id&&j.reversal_status!=='Posted');
 return {open,need,waiting,done:!open.length&&!need.length&&!waiting.length};
}
const totalsOf=(payload:any)=>{
 const groups=Array.isArray(payload?.groups)?payload.groups:[],net=money(groups.reduce((n:number,g:any)=>n+(Number(g.net)||0),0)),vat=money(groups.reduce((n:number,g:any)=>n+(Number(g.vat)||0),0));
 return {net,vat,gross:money(net+vat),categories:groups.length};
};
async function taxOpen(tx:any,pid:string,start:string,end:string){return !!(await tx`select erp_private.tax_period_open(${pid}::uuid,${start}::date,${end}::date) open`)[0].open;}
async function audit(tx:any,a:any,action:string,key:string,after:any){await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'import_amendments',${action},${key},${tx.json(after)})`;}

// Moves Reversing to Ready once every reversal is posted. Safe to repeat.
async function refresh(tx:any,am:any){
 if(am.status!=='Reversing')return am;
 const p=plan(await journalsFor(tx,am.import_id));
 if(!p.done)return am;
 const next=(await tx`update erp_private.import_amendments set status='Ready' where amendment_id=${am.amendment_id} and status='Reversing' returning *`)[0];
 return next||am;
}
async function view(tx:any,a:any,am:any){
 const imp=(await tx`select import_id,kind,source_type,coverage_mode,status,starts_on,ends_on,payload,revision from erp_private.period_imports where import_id=${am.import_id}`)[0];
 const journals=(await journalsFor(tx,am.import_id)).map((j:any)=>({journal_id:j.journal_id,period_id:j.period_id,reference:j.reference,journal_date:day(j.journal_date),status:j.status,reversal_id:j.reversal_id,reversal_status:j.reversal_status}));
 const names=await tx`select staff_id,full_name from erp_private.staff_members where staff_id=any(${tx.array([am.requested_by,am.decided_by,am.prepared_by,am.completed_by].filter(Boolean))}::uuid[])`;
 const who=(id:any)=>names.find((n:any)=>n.staff_id===id)?.full_name||null;
 const mine=a.staff_id===am.requested_by,isLeader=LEADERS.includes(a.category_code);
 const next:any={Requested:isLeader&&!mine?'Decide: a different Manager or Partner must approve or reject this request.':'Waiting for a different Manager or Partner to decide.',
  Approved:isLeader?'Prepare the reversal of the posted entries. A different Manager or Partner then reviews and posts each one.':'Waiting for a Manager or Partner to prepare the reversals.',
  Reversing:'Waiting for a different Manager or Partner to review and post the reversal entries in Client accounting → Entry register.',
  Ready:am.outcome==='Replace'?'The posted entries are reversed. Upload the corrected sales summary and choose Replace; it is confirmed by an independent reviewer as usual.':(isLeader?'The posted entries are reversed. Withdraw the old summary to finish.':'Waiting for a Manager or Partner to withdraw the old summary.'),
  'Replacement saved':'The corrected summary is waiting for independent review. The amendment completes when it is confirmed.',
  Complete:'Finished.',Rejected:'Rejected.',Cancelled:'Cancelled.'}[am.status as string];
 return {amendment:{...am,requested_by_name:who(am.requested_by),decided_by_name:who(am.decided_by),prepared_by_name:who(am.prepared_by),completed_by_name:who(am.completed_by)},
  summary:imp?{import_id:imp.import_id,status:imp.status,starts_on:day(imp.starts_on),ends_on:day(imp.ends_on),totals:totalsOf(imp.payload)}:null,journals,next,
  can:{decide:am.status==='Requested'&&isLeader&&!mine,prepare:am.status==='Approved'&&isLeader,complete:am.status==='Ready'&&am.outcome==='Withdraw'&&isLeader,cancel:['Requested','Approved'].includes(am.status)&&(mine||isLeader)}};
}

export async function salesAmendAction(tx:any,a:any,p:any){
 if(!String(p.action||'').startsWith('sales_amend_'))return undefined;
 if(!['sales_amend_read','sales_amend_request','sales_amend_decide','sales_amend_prepare','sales_amend_complete','sales_amend_cancel'].includes(p.action))fail(400,'Unknown amendment action.');
 if(a.category_code==='INTERN')fail(403,'Interns can access assigned tasks, not sales sources.');
 const pid=uuid(p.project_id),project=(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is unavailable to your account.');
 if(project.status==='Archived')fail(400,'Archived projects cannot change client working papers.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':period-import'},0))`;
 const get=async()=>{const am=(await tx`select * from erp_private.import_amendments where amendment_id=${uuid(p.amendment_id)} and project_id=${pid} for update`)[0];if(!am)fail(404,'This amendment is unavailable.');if(String(am.revision)!==String(p.revision))fail(409,'The amendment changed. Refresh first.');return am;};

 if(p.action==='sales_amend_read'){
  const importId=uuid(p.import_id);
  const rows=await tx`select * from erp_private.import_amendments where import_id=${importId} and project_id=${pid} order by requested_at desc`;
  const out=[];for(const r of rows)out.push(await view(tx,a,await refresh(tx,r)));
  const imp=(await tx`select status,kind,starts_on,ends_on,payload from erp_private.period_imports where import_id=${importId} and project_id=${pid}`)[0];
  return {import_status:imp?.status||null,can_request:imp?.status==='Confirmed'&&imp?.kind==='Sales'&&!rows.some((r:any)=>LIVE.includes(r.status)),amendments:out};
 }

 if(p.action==='sales_amend_request'){
  const imp=(await tx`select * from erp_private.period_imports where import_id=${uuid(p.import_id)} and project_id=${pid} for update`)[0];
  if(!imp)fail(404,'This summary is unavailable.');
  if(imp.kind!=='Sales')fail(400,'Only sales summaries can be amended here.');
  if(imp.status!=='Confirmed')fail(409,imp.status==='Superseded'||imp.status==='Discarded'?'This summary is already replaced or discarded.':'Only a confirmed summary needs an amendment. Draft, returned or submitted summaries can be discarded or withdrawn.');
  const outcome=choice(p.outcome,['Replace','Withdraw']),type=choice(p.reason_type,REASONS),reason=text(p.reason,2000);
  if(reason.length<10)fail(400,'Explain what is wrong in at least 10 characters.');
  if((await tx`select amendment_id from erp_private.import_amendments where import_id=${imp.import_id} and status=any(${tx.array(LIVE)}::text[])`).length)fail(409,'An amendment is already open for this summary.');
  if(!await taxOpen(tx,pid,day(imp.starts_on),day(imp.ends_on)))fail(409,'The tax period is submitted, locked or filed. Return that work before amending its sources.');
  const made=(await tx`insert into erp_private.import_amendments(project_id,client_id,import_id,kind,outcome,reason_type,reason,starts_on,ends_on,original_totals,requested_by) values(${pid},${project.client_id},${imp.import_id},'Sales',${outcome},${type},${reason},${day(imp.starts_on)},${day(imp.ends_on)},${tx.json(totalsOf(imp.payload))},${a.staff_id}) returning *`)[0];
  await audit(tx,a,'SALES_AMENDMENT_REQUESTED',made.amendment_id,{import_id:imp.import_id,outcome,reason_type:type,totals:totalsOf(imp.payload)});
  await notifyReviewers(tx,project.client_id,`amendment of a confirmed sales summary (${day(imp.starts_on)} to ${day(imp.ends_on)})`,'review:sales-amend:'+made.amendment_id);
  return await view(tx,a,made);
 }

 if(p.action==='sales_amend_decide'){
  leader(a);const am=await get();
  if(am.status!=='Requested')fail(409,'This amendment has already been decided.');
  if(am.requested_by===a.staff_id)fail(403,'A different Manager or Partner must decide this amendment.');
  const decision=choice(p.decision,['Approved','Rejected']),note=text(p.note,2000);
  if(note.length<10)fail(400,'Record the reason for your decision (at least 10 characters).');
  if(decision==='Approved'&&!await taxOpen(tx,pid,day(am.starts_on),day(am.ends_on)))fail(409,'The tax period is now submitted, locked or filed. Return that work before approving.');
  const next=(await tx`update erp_private.import_amendments set status=${decision},decided_by=${a.staff_id},decided_at=now(),decision_note=${note} where amendment_id=${am.amendment_id} returning *`)[0];
  await audit(tx,a,'SALES_AMENDMENT_'+decision.toUpperCase(),am.amendment_id,{note});
  await notifyOutcome(tx,am.requested_by,project.client_id,'amendment of a confirmed sales summary',decision,note,'outcome:sales-amend:'+am.amendment_id);
  return await view(tx,a,next);
 }

 if(p.action==='sales_amend_prepare'){
  leader(a);const am=await get();
  if(am.status!=='Approved')fail(409,'Only an approved amendment can have its reversals prepared.');
  if(!await taxOpen(tx,pid,day(am.starts_on),day(am.ends_on)))fail(409,'The tax period is submitted, locked or filed. Return that work first.');
  const imp=(await tx`select status from erp_private.period_imports where import_id=${am.import_id}`)[0];
  if(imp?.status!=='Confirmed')fail(409,'The summary is no longer confirmed.');
  const pl=plan(await journalsFor(tx,am.import_id));
  if(pl.open.length)fail(409,`${pl.open.length} entr${pl.open.length===1?'y':'ies'} built from this summary ${pl.open.length===1?'is':'are'} not posted yet (${pl.open.map((j:any)=>j.reference).slice(0,3).join(', ')}). Post or return and withdraw ${pl.open.length===1?'it':'them'} first.`);
  const made:any[]=[];
  for(const j of pl.need){
   const reversal=await ledgerAction(tx,a,{action:'ledger_reverse',project_id:pid,period_id:j.period_id,journal_id:j.journal_id,journal_date:day(j.journal_date),reference:('REV-'+j.reference).slice(0,100),description:'Reversal for approved amendment of a confirmed sales summary',evidence:am.reason},null);
   made.push({journal_id:j.journal_id,reversal_id:reversal.journal_id});
  }
  const status=made.length||pl.waiting.length?'Reversing':'Ready';
  const next=(await tx`update erp_private.import_amendments set status=${status},prepared_by=${a.staff_id},prepared_at=now(),reversals=${tx.json(made)} where amendment_id=${am.amendment_id} returning *`)[0];
  await audit(tx,a,'SALES_AMENDMENT_REVERSALS_PREPARED',am.amendment_id,{reversals:made.length});
  return {...await view(tx,a,next),reversals:made};
 }

 if(p.action==='sales_amend_complete'){
  leader(a);const am=await refresh(tx,await get());
  if(am.outcome!=='Withdraw')fail(409,'A replacement completes when the corrected summary is confirmed.');
  if(am.status==='Reversing')fail(409,'The reversal entries are not posted yet. A different Manager or Partner must review and post them first.');
  if(am.status!=='Ready')fail(409,'The amendment is not ready to complete.');
  if(!await taxOpen(tx,pid,day(am.starts_on),day(am.ends_on)))fail(409,'The tax period is submitted, locked or filed. Return that work first.');
  await tx`select set_config('erp.period_import_replacement','confirmed',true)`;
  await tx`update erp_private.period_imports set status='Superseded' where import_id=${am.import_id} and status='Confirmed'`;
  const next=(await tx`update erp_private.import_amendments set status='Complete',completed_by=${a.staff_id},completed_at=now() where amendment_id=${am.amendment_id} returning *`)[0];
  await audit(tx,a,'SALES_AMENDMENT_COMPLETED',am.amendment_id,{outcome:'Withdraw'});
  return await view(tx,a,next);
 }

 // sales_amend_cancel
 const am=await get();
 if(!['Requested','Approved'].includes(am.status))fail(409,'Once reversals are prepared the amendment cannot be cancelled. Finish it, or ask a Partner.');
 if(am.requested_by!==a.staff_id&&!LEADERS.includes(a.category_code))fail(403,'Only the requester, a Manager or a Partner can cancel.');
 const next=(await tx`update erp_private.import_amendments set status='Cancelled' where amendment_id=${am.amendment_id} returning *`)[0];
 await audit(tx,a,'SALES_AMENDMENT_CANCELLED',am.amendment_id,{});
 return await view(tx,a,next);
}
