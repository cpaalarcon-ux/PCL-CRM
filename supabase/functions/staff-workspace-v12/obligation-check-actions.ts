import {fail,text,uuid,date,choice,revision} from './validation.mjs';
import {obligations as ALL_OBLIGATIONS,frequencies} from './workspace-rules.mjs';
import {checkObligations,withExceptions,blockedMessage,reasonProblem,EXCEPTION_STATES} from './obligation-check-rules.mjs';
// Obligation check and exceptions (build 2814). The check compares each selected obligation with the client's verified tax profile; an obligation that is not
// Confirmed can only produce tax work under an approved exception (reason, requested by one person, approved by a different Manager or Partner).
// The table rules are repeated in 20261115170000_obligation_task_exceptions.sql.
const ACTIONS=['obligation_check','obligation_exception_request','obligation_exception_decide','obligation_exception_end','obligation_exception_list'];
const EDITORS=['PARTNER','MANAGER','SUPERVISOR'],LEADERS=['PARTNER','MANAGER'];
const TAX_CODES=ALL_OBLIGATIONS.filter((c:string)=>c!=='Payroll');
const day=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';

// The shared check, used by the preview, the exception request and the project save, so all three give the same answer.
export async function scheduleObligationRows(tx:any,cid:string,codes:string[],ctx:{start:string,end:string,frequency?:string|null}){
 const wanted=(codes||[]).filter(c=>c!=='Payroll');
 if(!wanted.length)return [];
 const profiles=await tx`select * from erp_private.client_tax_profiles where client_id=${cid} and status='Verified' and deleted_at is null and effective_from<=${ctx.end} and effective_to>=${ctx.start} order by effective_from desc limit 2`;
 // A profile must cover the whole schedule on its own; a schedule spanning two profiles is checked against neither.
 const covering=profiles.filter((p:any)=>day(p.effective_from)<=ctx.start&&day(p.effective_to)>=ctx.end);
 const rows=profiles.length===0?checkObligations([],wanted,ctx)
  :profiles.length===1&&covering.length===1?checkObligations(covering,wanted,ctx)
  :wanted.map(code=>({code,state:'Needs verification',reason:'A single verified tax profile must cover the full schedule. Align the schedule with one profile, or verify a profile for the whole period.'}));
 const exceptions=await tx`select * from erp_private.obligation_task_exceptions where client_id=${cid} and status in('Requested','Approved') and obligation_code=any(${tx.array(wanted)}) order by requested_at desc`;
 return withExceptions(rows,exceptions,ctx);
}
// Used when a schedule is saved: nothing is made for an obligation that is neither Confirmed nor covered by an approved exception.
export async function requireObligationsAllowed(tx:any,cid:string,s:{obligations:string[],starts_on:string,ends_on:string,frequency:string}){
 const rows=await scheduleObligationRows(tx,cid,s.obligations||[],{start:s.starts_on,end:s.ends_on,frequency:s.frequency});
 const message=blockedMessage(rows);if(message)fail(400,message);
 return rows;
}
// Obligations a client's engagement set-up may use: confirmed ones plus those under an approved exception for the period.
export async function allowedObligations(tx:any,cid:string,start:string,end:string,frequency:string|null=null){
 const rows=await scheduleObligationRows(tx,cid,TAX_CODES,{start,end,frequency});
 return new Set<string>(rows.filter((r:any)=>r.allowed).map((r:any)=>r.code));
}
function context(p:any){
 const start=date(p.starts_on),end=date(p.ends_on);
 if(!start||!end||end<start)fail(400,'Choose the first and last day of the schedule.');
 const frequency=p.frequency?choice(p.frequency,frequencies):null;
 return {start,end,frequency};
}
const present=(r:any)=>({exception_id:r.exception_id,client_id:r.client_id,company_name:r.company_name,obligation_code:r.obligation_code,period_start:day(r.period_start),period_end:day(r.period_end),state_at_request:r.state_at_request,state_detail:r.state_detail,reason:r.reason,status:r.status,requested_by:r.requested_by,requested_by_name:r.requested_by_name,requested_at:r.requested_at,decided_by:r.decided_by,decided_by_name:r.decided_by_name,decided_at:r.decided_at,decision_note:r.decision_note,ended_reason:r.ended_reason,revision:String(r.revision)});
export async function obligationCheckAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!EDITORS.includes(a.category_code))fail(403,'A Supervisor, Manager or Partner works with the obligation check.');

 if(p.action==='obligation_check'){
  const cid=uuid(p.client_id),ctx=context(p);
  const codes=[...new Set((Array.isArray(p.obligations)?p.obligations:[]).map((c:any)=>choice(c,TAX_CODES)))] as string[];
  one(await tx`select client_id from erp_private.clients where client_id=${cid} and deleted_at is null`);
  const rows=await scheduleObligationRows(tx,cid,codes,ctx);
  return {rows,can_decide:LEADERS.includes(a.category_code),me:a.staff_id,blocked:blockedMessage(rows)};
 }
 if(p.action==='obligation_exception_list'){
  const cid=p.client_id?uuid(p.client_id):null;
  const rows=cid?await tx`select e.*,c.company_name,rb.full_name requested_by_name,db.full_name decided_by_name from erp_private.obligation_task_exceptions e join erp_private.clients c using(client_id)
   left join erp_private.staff_members rb on rb.staff_id=e.requested_by left join erp_private.staff_members db on db.staff_id=e.decided_by where e.client_id=${cid} and e.status in('Requested','Approved') order by e.requested_at desc limit 300`
   :await tx`select e.*,c.company_name,rb.full_name requested_by_name,db.full_name decided_by_name from erp_private.obligation_task_exceptions e join erp_private.clients c using(client_id)
   left join erp_private.staff_members rb on rb.staff_id=e.requested_by left join erp_private.staff_members db on db.staff_id=e.decided_by where e.status in('Requested','Approved') order by e.requested_at desc limit 300`;
  return {exceptions:rows.slice(0,300).map(present),can_decide:LEADERS.includes(a.category_code),me:a.staff_id};
 }
 if(p.action==='obligation_exception_request'){
  const cid=uuid(p.client_id),code=choice(p.obligation_code,TAX_CODES),ctx=context(p),reason=text(p.reason,1000,false);
  const problem=reasonProblem(reason);if(problem)fail(400,problem);
  one(await tx`select client_id from erp_private.clients where client_id=${cid} and deleted_at is null`);
  // The state is worked out here, not taken from the screen.
  const [row]=await scheduleObligationRows(tx,cid,[code],ctx);
  if(row.state==='Confirmed')fail(400,`${code} is confirmed on the client's tax profile. No exception is needed.`);
  if(!EXCEPTION_STATES.includes(row.state))fail(400,'That state does not take an exception.');
  if(row.exception_status)fail(409,`An exception for ${code} over this period is already ${row.exception_status==='Approved'?'approved':'awaiting approval'}.`);
  const [made]=await tx`insert into erp_private.obligation_task_exceptions(client_id,obligation_code,period_start,period_end,state_at_request,state_detail,reason,requested_by)
   values(${cid},${code},${ctx.start},${ctx.end},${row.state},${String(row.reason||'').slice(0,600)},${reason},${a.staff_id}) returning exception_id`;
  return {ok:true,exception_id:made.exception_id,state:row.state};
 }
 if(p.action==='obligation_exception_decide'||p.action==='obligation_exception_end'){
  if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner decides an obligation exception.');
  const id=uuid(p.exception_id);
  const ex=one(await tx`select * from erp_private.obligation_task_exceptions where exception_id=${id} for update`);
  if(p.revision!==undefined&&String(ex.revision)!==revision(p.revision))fail(409,'The exception changed. Refresh before deciding.');
  if(p.action==='obligation_exception_end'){
   if(ex.status!=='Approved')fail(400,'Only an approved exception is ended.');
   const why=text(p.reason,1000,false);if(String(why).trim().length<5)fail(400,'Give the reason for ending the exception.');
   await tx`update erp_private.obligation_task_exceptions set status='Ended',ended_by=${a.staff_id},ended_at=now(),ended_reason=${why} where exception_id=${id}`;
   return {ok:true};
  }
  const decision=choice(p.decision,['Approve','Reject']);
  if(ex.status!=='Requested')fail(400,'This exception has already been decided.');
  if(ex.requested_by===a.staff_id)fail(403,'A different Manager or Partner decides an exception you requested.');
  const note=text(p.note||'',1000,false);
  if(decision==='Reject'&&String(note).trim().length<5)fail(400,'Give the reason for rejecting the exception.');
  await tx`update erp_private.obligation_task_exceptions set status=${decision==='Approve'?'Approved':'Rejected'},decided_by=${a.staff_id},decided_at=now(),decision_note=${note||null} where exception_id=${id}`;
  return {ok:true,status:decision==='Approve'?'Approved':'Rejected'};
 }
}
function one(r:any[]){if(!r.length)fail(403,'This record is not available to your account.');return r[0];}
