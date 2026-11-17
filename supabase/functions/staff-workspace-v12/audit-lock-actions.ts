import {fail,text,uuid,date,choice} from './validation.mjs';
import {digestOf} from './statement-version-rules.mjs';
import {ARRANGEMENTS,MODES,OPINIONS,DONE_FILE,figuresInput,auditState,auditCheck,auditWording} from './audit-lock-rules.mjs';
import {noteStateFor} from './notes-actions.ts';
// Build 2875: the audit lock. A Manager or Partner locks the annual pack once the Partner has approved the notes and the audit is complete: in-house (a completed, approved audit file that the locker did not prepare)
// or external (the signed auditor's PDF in the client's document vault). The lock records digests of the figures and the notes. Only a Partner ends a lock, with a reason. Rules are in audit-lock-rules.mjs;
// the table rules are in 20261123100000_period_audit_lock.sql.
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const figuresDigest=async(statements:any)=>await digestOf(figuresInput(statements));

export async function loadAudit(tx:any,l:any){
 const arrangement=(await tx`select mode,note,set_at,revision,erp_private.reviewer_label(set_by) set_by_name from erp_private.period_audit_arrangements where period_id=${l.period_id}`)[0]||null;
 const files=await tx`select f.audit_file_id,f.file_status,f.reporting_framework,f.starts_on,f.ends_on,f.created_by,f.is_demonstration,erp_private.reviewer_label(f.created_by) prepared_name from erp_private.audit_files f where f.client_id=${l.client_id} and f.file_status<>'Archived' and f.starts_on<=${day(l.ends_on)}::date and f.ends_on>=${day(l.starts_on)}::date order by f.starts_on desc`;
 const lock=(await tx`select lock_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,document_id,document_sha256,auditor_name,report_reference,report_date,opinion,locked_by,locked_at,sole_partner_approval,erp_private.reviewer_label(locked_by) locked_name from erp_private.period_audit_locks where period_id=${l.period_id} and ended_at is null`)[0]||null;
 const history=await tx`select lock_id,mode,report_reference,report_date,opinion,locked_at,ended_at,end_reason,erp_private.reviewer_label(locked_by) locked_name,erp_private.reviewer_label(ended_by) ended_name from erp_private.period_audit_locks where period_id=${l.period_id} order by locked_at desc`;
 return {arrangement,files,lock,history,file:files.find((f:any)=>!f.is_demonstration)||null};
}
// The state against the figures and notes now. Used by the pack readiness and by the screen.
export async function auditStateFor(tx:any,l:any,figuresNow:string,notesNow:string){
 const au=await loadAudit(tx,l);
 return {...auditState({arrangement:au.arrangement,file:au.file,lock:au.lock,figuresNow,notesNow}),loaded:au};
}
const lockView=(k:any)=>k&&{lock_id:k.lock_id,mode:k.mode,report_reference:k.report_reference,report_date:day(k.report_date),opinion:k.opinion,auditor_name:k.auditor_name,locked_name:k.locked_name,locked_at:k.locked_at,sole_partner_approval:k.sole_partner_approval,audit_file_id:k.audit_file_id,document_id:k.document_id};

export async function auditLockAction(tx:any,a:any,l:any,p:any,getStatements:(asOf:string)=>Promise<any>,asOf:string){
 if(p.action==='ledger_audit_read'){
  const st=await getStatements(asOf),S=st.statements,fd=await figuresDigest(S),nd=S.notes.digest,ns=await noteStateFor(tx,l.period_id,nd);
  const au=await loadAudit(tx,l),state=auditState({arrangement:au.arrangement,file:au.file,lock:au.lock,figuresNow:fd,notesNow:nd}),chk=auditCheck(state);
  const docs=await tx`select document_id,file_name,category,uploaded_at,sha256 from erp_private.documents where client_id=${l.client_id} and deleted_at is null and mime_type='application/pdf' order by uploaded_at desc limit 200`;
  const approved=ns.sets.approved,notesOk=ns.status==='approved';
  return {state:{status:state.status,label:state.label,required:state.required,locked:state.locked,stale:state.stale,mode:state.mode},check:chk,wording:auditWording(state),
   arrangement:au.arrangement&&{mode:au.arrangement.mode,note:au.arrangement.note,set_by_name:au.arrangement.set_by_name},lock:lockView(au.lock),history:au.history.map((h:any)=>({...h,report_date:day(h.report_date)})),
   notes:{status:ns.status,approved_name:approved?.reviewed_name||null,approved_at:approved?.reviewed_at||null,ok:notesOk},
   candidates:{audit_files:au.files.filter((f:any)=>!f.is_demonstration).map((f:any)=>({audit_file_id:f.audit_file_id,file_status:f.file_status,reporting_framework:f.reporting_framework,starts_on:day(f.starts_on),ends_on:day(f.ends_on),prepared_name:f.prepared_name,complete:DONE_FILE.includes(f.file_status),prepared_by_me:f.created_by===a.staff_id})),
    documents:docs.map((d:any)=>({document_id:d.document_id,file_name:d.file_name,category:d.category,uploaded_at:day(d.uploaded_at)}))},
   opinions:OPINIONS,arrangements:ARRANGEMENTS,
   can_declare:isLeader(a)&&l.status==='Open'&&!au.lock,can_lock:isLeader(a)&&l.status==='Open'&&!au.lock&&state.status!=='not_audited'&&notesOk&&!S.problems.length,can_end:a.category_code==='PARTNER'&&l.status==='Open'&&!!au.lock,
   problems:S.problems.slice(0,5),client:st.client};
 }
 if(p.action==='ledger_audit_declare'){
  if(!isLeader(a))fail(403,'A Manager or Partner records how the year is audited.');
  if(l.status!=='Open')fail(409,'This ledger year is closed.');
  const mode=choice(p.mode,ARRANGEMENTS),note=text(p.note??'',500,false).trim()||null;
  if(mode==='Not audited'&&a.category_code!=='PARTNER')fail(403,'Only a Partner records that a year is not audited.');
  const au=await loadAudit(tx,l);
  if(au.lock)fail(409,'The pack is locked by an audit. A Partner ends the lock before the arrangement is changed.');
  if(au.arrangement&&au.arrangement.mode==='Not audited'&&a.category_code!=='PARTNER')fail(403,'Only a Partner changes a year recorded as not audited.');
  try{
   if(au.arrangement)await tx`update erp_private.period_audit_arrangements set mode=${mode},note=${note},set_by=${a.staff_id} where period_id=${l.period_id}`;
   else await tx`insert into erp_private.period_audit_arrangements(period_id,project_id,client_id,mode,note,set_by) values(${l.period_id},${l.project_id},${l.client_id},${mode},${note},${a.staff_id})`;
  }catch(e:any){if(e?.code==='23514')fail(409,String(e.message));throw e;}
  return {mode};
 }
 if(p.action==='ledger_audit_lock'){
  if(!isLeader(a))fail(403,'A Manager or Partner locks the pack.');
  if(l.status!=='Open')fail(409,'This ledger year is closed.');
  const mode=choice(p.mode,MODES),opinion=choice(p.opinion,OPINIONS),ref=text(p.report_reference??'',200,false).trim(),reportDate=date(p.report_date);
  if(ref.length<3)fail(400,'Enter the report reference (at least 3 characters).');
  if(!reportDate)fail(400,'Enter the report date.');
  if(reportDate>new Date().toISOString().slice(0,10))fail(400,'The report date cannot be in the future.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':audit'},0))`;
  const au=await loadAudit(tx,l);
  if(au.lock)fail(409,'The pack is already locked.');
  const st=await getStatements(asOf),S=st.statements,ns=await noteStateFor(tx,l.period_id,S.notes.digest);
  if(S.checks.unmapped.length||S.checks.excluded.length||!S.checks.balanced||S.problems.length)fail(409,'The statements are not complete: '+(S.problems[0]||'fix the trial balance mapping first')+' Fix them before locking.');
  if(ns.status!=='approved')fail(409,'A Partner must approve the notes before the pack is locked'+(ns.status==='stale'?' (the figures changed since they were approved).':ns.status==='draft'?' (they are prepared and waiting for a Partner).':' (they have not been prepared).'));
  const fd=await figuresDigest(S),approved=ns.sets.approved;
  let audit_file_id:string|null=null,document_id:string|null=null,sha:string|null=null,auditor:string|null=null,sole=false;
  if(mode==='In-house audit'){
   audit_file_id=uuid(p.audit_file_id);
   const f=au.files.find((x:any)=>x.audit_file_id===audit_file_id&&!x.is_demonstration);
   if(!f)fail(400,'Choose this client’s audit file that covers the financial year.');
   if(!DONE_FILE.includes(f.file_status))fail(409,'The audit file must be completed and approved before it locks the pack.');
   if(f.created_by===a.staff_id){
    if(!(a.category_code==='PARTNER'&&p.sole_partner_approval===true))fail(403,'A Manager or Partner who did not prepare the audit file locks the pack. If you are your firm’s only Partner, confirm that when you lock.');
    sole=true;
   }
  }else{
   document_id=uuid(p.document_id);auditor=text(p.auditor_name??'',160,false).trim();
   if(auditor.length<2)fail(400,'Enter the name of the auditor or audit firm.');
   const d=(await tx`select document_id,sha256,mime_type from erp_private.documents where document_id=${document_id} and client_id=${l.client_id} and deleted_at is null`)[0];
   if(!d)fail(400,'The signed audit report must be a document in this client’s vault.');
   if(d.mime_type!=='application/pdf')fail(400,'The signed audit report must be a PDF.');
   sha=d.sha256;
  }
  try{
   const k=(await tx`insert into erp_private.period_audit_locks(period_id,project_id,client_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,document_id,document_sha256,auditor_name,report_reference,report_date,opinion,locked_by,sole_partner_approval)
    values(${l.period_id},${l.project_id},${l.client_id},${mode},${approved.set_id},${approved.digest},${fd},${audit_file_id},${document_id},${sha},${auditor},${ref},${reportDate},${opinion},${a.staff_id},${sole}) returning lock_id`)[0];
   return {lock_id:k.lock_id,mode,sole_partner_approval:sole};
  }catch(e:any){if(e?.code==='23514'||e?.code==='23505')fail(409,e?.code==='23505'?'The pack is already locked.':String(e.message));throw e;}
 }
 if(p.action==='ledger_audit_end'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner ends an audit lock.');
  if(l.status!=='Open')fail(409,'This ledger year is closed.');
  const reason=text(p.reason??'',500,false).trim();if(reason.length<10)fail(400,'Say why the lock is ended (at least 10 characters).');
  const au=await loadAudit(tx,l);if(!au.lock||au.lock.lock_id!==uuid(p.lock_id))fail(409,'That lock is no longer live. Refresh.');
  try{await tx`update erp_private.period_audit_locks set ended_at=now(),ended_by=${a.staff_id},end_reason=${reason} where lock_id=${au.lock.lock_id}`;}
  catch(e:any){if(e?.code==='23514')fail(409,String(e.message));throw e;}
  return {ended:true};
 }
 return undefined;
}
