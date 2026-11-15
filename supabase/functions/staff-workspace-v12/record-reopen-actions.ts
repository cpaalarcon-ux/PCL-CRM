import {fail,text,uuid} from './validation.mjs';
import {notifyOutcome} from './review-queue.ts';
import {reasonProblem,reopenBlockers,reopenNote,priorTotals,afterReopenAdvice} from './record-reopen-rules.mjs';
// Partner exceptional reopen (build 2823). Only a Partner. Only a confirmed sales or payroll summary with nothing built from it.
// The summary goes back to Returned with the reason and the Partner's name, its coverage days are released, and an insert-only record is kept.
// An independent reviewer must confirm it again. Posted entries are never touched here: they go through an amendment.
const ACTIONS=['record_reopen_check','record_reopen_apply','record_reopen_list'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const LIVE=['Requested','Approved','Reversing','Ready','Replacement saved'];

async function facts(tx:any,project:any,r:any){
 const entries=(await tx`select count(distinct s.journal_id)::int n from erp_private.ledger_sources s where s.source_kind='Period import' and (s.source_key=${String(r.import_id)} or s.source_key like ${String(r.import_id)+':%'})`)[0].n;
 const live=(await tx`select count(*)::int n from erp_private.import_amendments where import_id=${r.import_id} and status=any(${tx.array(LIVE)}::text[])`)[0].n;
 const recon=(await tx`select 1 from erp_private.sales_reconciliations x where x.project_id=${project.project_id} and x.review_type='Monthly' and x.status in ('Submitted','Locked') and x.starts_on<=${r.ends_on} and x.ends_on>=${r.starts_on} limit 1`).length;
 const open=(await tx`select erp_private.tax_period_open(${project.project_id}::uuid,${r.starts_on}::date,${r.ends_on}::date) open`)[0].open&&!recon;
 return {status:r.status,kind:r.kind,tax_open:!!open,entries,live_amendments:live,archived:project.status==='Archived'};
}
const present=(x:any)=>({reopen_id:x.reopen_id,record_id:x.record_id,summary_kind:x.summary_kind,starts_on:day(x.starts_on),ends_on:day(x.ends_on),reason:x.reason,reopened_by:x.reopened_by,reopened_by_name:x.reopened_by_name,reopened_at:x.reopened_at,sole_partner:x.sole_partner,prior_totals:x.prior_totals,prior_review_note:x.prior_review_note});

export async function recordReopenAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
 const pid=uuid(p.project_id),project=(await tx`select project_id,client_id,status from erp_private.projects where project_id=${pid} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is unavailable to your account.');
 if(p.action==='record_reopen_list'){
  const rows=p.import_id
   ?await tx`select x.*,erp_private.staff_name(x.reopened_by) reopened_by_name from erp_private.record_reopens x where x.project_id=${pid} and x.record_id=${uuid(p.import_id)} order by x.reopened_at desc limit 200`
   :await tx`select x.*,erp_private.staff_name(x.reopened_by) reopened_by_name from erp_private.record_reopens x where x.project_id=${pid} order by x.reopened_at desc limit 200`;
  return {reopens:rows.map(present)};
 }
 const iid=uuid(p.import_id);
 const r=(p.action==='record_reopen_apply'
  ?await tx`select * from erp_private.period_imports where import_id=${iid} and project_id=${pid} for update`
  :await tx`select * from erp_private.period_imports where import_id=${iid} and project_id=${pid}`)[0];
 if(!r)fail(403,'This is unavailable to your account.');
 const isPartner=a.category_code==='PARTNER';
 if(p.action==='record_reopen_check'){
  const blockers=reopenBlockers(await facts(tx,project,r));
  return {import_id:r.import_id,status:r.status,can_reopen:isPartner&&!blockers.length,partner_only:!isPartner,blockers};
 }
 // record_reopen_apply
 if(!isPartner)fail(403,'Only a Partner can reopen a confirmed summary.');
 if(String(r.revision)!==String(p.revision))fail(409,'This summary changed. Refresh first.');
 const why=text(p.reason||'',2000,false).trim(),problem=reasonProblem(why);if(problem)fail(400,problem);
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':period-import'},0))`;
 const blockers=reopenBlockers(await facts(tx,project,r));if(blockers.length)fail(409,blockers.join(' '));
 const sole=(await tx`select erp_private.sole_active_partner() as sole`)[0]?.sole===true;
 const who=(await tx`select erp_private.staff_name(${a.staff_id}::uuid) n`)[0]?.n||null;
 const note=reopenNote(why,who),totals=priorTotals(r.kind,r.payload);
 await tx`select set_config('erp.partner_reopen','period_import',true)`;
 await tx`update erp_private.period_imports set status='Returned',reviewed_by=${a.staff_id},review_note=${note} where import_id=${r.import_id}`;
 const made=(await tx`insert into erp_private.record_reopens(client_id,project_id,record_kind,record_id,summary_kind,starts_on,ends_on,prior_status,prior_reviewed_by,prior_review_note,prior_totals,reason,reopened_by,sole_partner)
  values(${project.client_id},${pid},'Period import',${r.import_id},${r.kind},${r.starts_on},${r.ends_on},'Confirmed',${r.reviewed_by||null},${r.review_note||null},${tx.json(totals)},${why},${a.staff_id},${sole}) returning reopen_id`)[0];
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'period_imports','PARTNER_EXCEPTIONAL_REOPEN',${String(r.import_id)},${tx.json({reopen_id:made.reopen_id,kind:r.kind,starts_on:day(r.starts_on),ends_on:day(r.ends_on),reason:why,sole_partner:sole,prior_totals:totals})})`;
 await notifyOutcome(tx,r.prepared_by,project.client_id,`confirmed ${r.kind==='Payroll'?'payroll':'sales'} summary (${day(r.starts_on)} to ${day(r.ends_on)})`,'Returned',why,'outcome:partner-reopen:'+made.reopen_id);
 return {ok:true,status:'Returned',reopen_id:made.reopen_id,sole_partner:sole,note:afterReopenAdvice((r.replaces_ids||[]).length)};
}
