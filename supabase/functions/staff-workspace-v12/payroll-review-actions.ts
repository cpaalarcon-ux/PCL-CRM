import {fail,text,uuid,revision} from './validation.mjs';
import {reviewSummary,approvalNote,reopenNote} from './payroll-review-rules.mjs';
import {monthBounds,previousMonth} from './payroll-register-rules.mjs';
import {confirmPeriodImport} from './period-import-actions.ts';

// The supervisor's one-screen review of a payroll month (build 2805): totals, changes, exceptions, mapping, journal balance and register comparison together.
// A clean run is approved in one step. A run with anything to decide is not: the usual review (confirm with a note, or return) stays. A submitted month that the
// register has since changed is returned with the reason, so a new version is prepared from the register; the returned version stays in the history.
// Approving confirms the payroll summary only. The accounting entry is still prepared from approved mappings and posted by a different authorised reviewer.
const ACTIONS=['payroll_review_summary','payroll_review_approve','payroll_review_reopen'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const isReviewer=(a:any)=>['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code);

async function gather(tx:any,project:any,r:any){
 const month=day(r.starts_on).slice(0,7),b=monthBounds(month);
 const maps=await tx`select routing_id,version,module,routing_code,item_code,erp_account_code,side,effective_from,effective_to,status from erp_private.client_routing_map where client_id=${project.client_id} and module='Payroll' and status='Active'`;
 const prior=(await tx`select payload from erp_private.period_imports where client_id=${project.client_id} and kind='Payroll' and status in ('Submitted','Confirmed') and ends_on<${b!.start} order by ends_on desc limit 1`)[0];
 const people=(await tx`select person_id,name,kra_pin,national_id,started_on,left_on from erp_private.client_payroll_people where client_id=${project.client_id}`).map((x:any)=>({...x,started_on:day(x.started_on),left_on:x.left_on?day(x.left_on):null}));
 const pays=(await tx`select person_id,gross,effective_from,reason,created_at from erp_private.client_payroll_pay where client_id=${project.client_id}`).map((x:any)=>({...x,gross:Number(x.gross),effective_from:day(x.effective_from)}));
 return reviewSummary({payload:r.payload,prior:prior?.payload,month,maps,people,pays,savedAt:r.created_at});
}

export async function payrollReviewAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
 const pid=uuid(p.project_id),project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${pid} and deleted_at is null`);
 const iid=uuid(p.import_id);
 const r=one(p.action==='payroll_review_summary'
  ?await tx`select * from erp_private.period_imports where import_id=${iid} and project_id=${pid} and kind='Payroll'`
  :await tx`select * from erp_private.period_imports where import_id=${iid} and project_id=${pid} and kind='Payroll' for update`);
 if(p.action==='payroll_review_summary')return {import_id:r.import_id,status:r.status,revision:String(r.revision),can_review:r.status==='Submitted'&&isReviewer(a)&&r.prepared_by!==a.staff_id,...(await gather(tx,project,r))};
 if(project.status==='Archived')fail(400,'Archived projects retain read-only accounting history.');
 if(r.status!=='Submitted')fail(409,'Only a submitted payroll can be reviewed.');
 if(!isReviewer(a)||r.prepared_by===a.staff_id)fail(403,'A different Supervisor, Manager or Partner must review this payroll.');
 if(String(r.revision)!==revision(p.revision))fail(409,'This payroll changed. Refresh first.');
 const s=await gather(tx,project,r);
 if(p.action==='payroll_review_approve'){
  if(!s.clean)fail(409,'This run is not clean, so it needs the usual review: '+s.blockers.join(' '));
  await confirmPeriodImport(tx,a,project,r,approvalNote(s));
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'period_imports','PAYROLL_CLEAN_RUN_APPROVED',${String(r.import_id)},${tx.json({month:s.month,employees:s.employees,totals:s.totals})})`;
  return {ok:true,status:'Confirmed',month:s.month};
 }
 // payroll_review_reopen
 const why=text(p.reason||'',1000,false).trim();
 if(why.length<10&&!s.drift.late_changes.length)fail(400,'Say why the payroll is being returned (at least 10 characters).');
 if(!(await tx`select erp_private.tax_period_open(${pid}::uuid,${r.starts_on}::date,${r.ends_on}::date) open`)[0].open)fail(409,'This summary is in submitted or locked tax work. Return the tax case first.');
 if((await tx`select 1 from erp_private.ledger_sources where source_kind='Period import' and source_key=${r.import_id}::text limit 1`).length)fail(409,'An accounting entry was prepared from this payroll. Return or reverse that entry first.');
 const note=reopenNote(s,why);
 await tx`update erp_private.period_imports set status='Returned',reviewed_by=${a.staff_id},review_note=${note.slice(0,4000)} where import_id=${r.import_id}`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'period_imports','PAYROLL_REOPENED_NEW_VERSION',${String(r.import_id)},${tx.json({month:s.month,late_changes:s.drift.late_changes,reason:why})})`;
 return {ok:true,status:'Returned',month:s.month,note:'Prepare the month again from the payroll register. The new run replaces this one when it is confirmed, and this version stays in the history.'};
}
