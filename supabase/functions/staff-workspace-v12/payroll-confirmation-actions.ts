import {logPayrollRead} from './payroll-access-log.ts';
import {fail,text,uuid,date,choice,revision} from './validation.mjs';
import {confirmationSnapshot,digestInput,confirmationState,answerIssues,CONFIRM_DECISIONS} from './payroll-confirmation-rules.mjs';
import {confirmationPdf} from './payroll-confirmation-pdf.mjs';
import {registerChanges,monthBounds} from './payroll-register-rules.mjs';
import {pdfLib} from './suite-actions.ts';

// Client confirmation of a payroll month (build 2820). A report is issued from the saved run as a numbered version; the client's answer is recorded with who answered,
// when, and the evidence. A run cannot be submitted for review once a report has been issued unless the latest version is confirmed and still matches the run.
// Issuing a report, recording an answer and downloading it never submit, approve or post anything. Table rules are in 20261116110000_payroll_client_confirmations.sql.
const ACTIONS=['payroll_confirmation_read','payroll_confirmation_issue','payroll_confirmation_record','payroll_confirmation_pdf'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const hex=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const todayNairobi=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());

async function build(tx:any,project:any,r:any){
 const month=day(r.starts_on).slice(0,7),b=monthBounds(month);
 const client=(await tx`select company_name,trading_name from erp_private.clients where client_id=${project.client_id}`)[0]||{};
 const prior=(await tx`select payload from erp_private.period_imports where client_id=${project.client_id} and kind='Payroll' and status in ('Submitted','Confirmed') and ends_on<${b!.start} order by ends_on desc limit 1`)[0];
 const people=(await tx`select person_id,name,started_on,left_on,left_reason,status from erp_private.client_payroll_people where client_id=${project.client_id}`).map((x:any)=>({...x,started_on:day(x.started_on),left_on:x.left_on?day(x.left_on):null}));
 const changes=(await tx`select change_id,person_id,kind,starts_on,ends_on,reason,status from erp_private.client_payroll_status_changes where client_id=${project.client_id}`).map((c:any)=>({...c,starts_on:day(c.starts_on),ends_on:c.ends_on?day(c.ends_on):null}));
 const inactive=registerChanges(people,[],month,{changes}).inactive;
 const snapshot=confirmationSnapshot({payload:r.payload,prior:prior?.payload,month,inactive,clientName:client.company_name||'',tradingName:client.trading_name||''});
 return {snapshot,digest:await hex(digestInput(snapshot))};
}
const present=(x:any)=>({confirmation_id:x.confirmation_id,version:x.version,status:x.status,digest:x.digest,issued_at:x.issued_at,issued_by_name:x.issued_by_name,responder_name:x.responder_name,responded_on:x.responded_on?day(x.responded_on):null,response_note:x.response_note,evidence_document_id:x.evidence_document_id,evidence_file_name:x.evidence_file_name||null,recorded_by_name:x.recorded_by_name,recorded_at:x.recorded_at,totals:x.snapshot?.totals,revision:String(x.revision)});
async function versions(tx:any,importId:string){
 return await tx`select c.*,erp_private.staff_name(c.issued_by) as issued_by_name,erp_private.staff_name(c.recorded_by) as recorded_by_name,d.file_name as evidence_file_name from erp_private.payroll_client_confirmations c left join erp_private.documents d on d.document_id=c.evidence_document_id where c.import_id=${importId} order by c.version desc`;
}
// Used by the submit step and the review summary: does this run still match what the client confirmed?
export async function payrollConfirmationGate(tx:any,project:any,r:any){
 if(r.kind!=='Payroll')return {state:'Not requested',blocks:false,message:'',latest:null,matches:null};
 const rows=await tx`select version,status,digest from erp_private.payroll_client_confirmations where import_id=${r.import_id}`;
 if(!rows.length)return confirmationState([],'');
 const {digest}=await build(tx,project,r);
 return confirmationState(rows,digest);
}

export async function payrollConfirmationAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The client confirmation is handled by staff with client access.');
 const pid=uuid(p.project_id),project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${pid} and deleted_at is null`);
 const r=one(await tx`select * from erp_private.period_imports where import_id=${uuid(p.import_id)} and project_id=${pid} and kind='Payroll'`);
 const LEADERS=['PARTNER','MANAGER','SUPERVISOR'];
 const mayWork=r.prepared_by===a.staff_id||LEADERS.includes(a.category_code);
 if(p.action==='payroll_confirmation_read'){
  await logPayrollRead(tx,a,{client_id:project.client_id,project_id:project.project_id,import_id:r.import_id,surface:'Client confirmation'});
  const rows=await versions(tx,r.import_id),cur=await build(tx,project,r);
  return {import_id:r.import_id,run_status:r.status,month:day(r.starts_on).slice(0,7),versions:rows.map(present),gate:{...confirmationState(rows,cur.digest),latest:undefined},current_digest:cur.digest,current_totals:cur.snapshot.totals,can_issue:mayWork&&['Draft','Returned'].includes(r.status),can_record:mayWork&&['Draft','Returned'].includes(r.status),run_editable:['Draft','Returned'].includes(r.status),documents:await tx`select document_id,file_name from erp_private.documents where project_id=${pid} and deleted_at is null and archived_at is null order by uploaded_at desc limit 200`};
 }
 if(project.status==='Archived')fail(400,'Archived projects retain read-only history.');
 if(p.action==='payroll_confirmation_pdf'){
  await logPayrollRead(tx,a,{client_id:project.client_id,project_id:project.project_id,import_id:r.import_id,surface:'Confirmation PDF'});
  const row=one(await tx`select c.*,erp_private.staff_name(c.issued_by) as issued_by_name from erp_private.payroll_client_confirmations c where c.confirmation_id=${uuid(p.confirmation_id)} and c.import_id=${r.import_id}`);
  const firm=one(await tx`select f.legal_name,f.physical_address,f.phone,f.email,f.kra_pin from erp_private.firms f join erp_private.projects pr on pr.handling_firm_id=f.firm_id where pr.project_id=${pid}`);
  const lib=pdfLib();if(!lib)fail(500,'PDF generation is not available.');
  const issuedAt=new Date(row.issued_at);
  const bytes=await confirmationPdf({...row,firm,issued_at:issuedAt.toISOString(),issued_on:new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(issuedAt)},lib);
  let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return {file_name:`Payroll_confirmation_${day(r.starts_on).slice(0,7)}_v${row.version}.pdf`,mime_type:'application/pdf',base64:btoa(s),sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join(''),version:row.version};
 }
 if(!mayWork)fail(403,'The preparer, or a Supervisor, Manager or Partner, handles the client confirmation.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${String(r.import_id)+':confirm'},0))`;
 if(p.action==='payroll_confirmation_issue'){
  if(!['Draft','Returned'].includes(r.status))fail(409,'A confirmation report is issued while the payroll is still being prepared. This run is '+String(r.status).toLowerCase()+'.');
  const {snapshot,digest}=await build(tx,project,r);
  if(!snapshot.lines.length)fail(400,'The run has nobody on it, so there is nothing for the client to confirm.');
  const rows=await versions(tx,r.import_id),open=rows.find((x:any)=>x.status!=='Superseded');
  if(open&&open.digest===digest&&open.status==='Issued')fail(409,`Version ${open.version} already shows these figures and is waiting for the client. Download it, or record the client's answer.`);
  if(open&&open.digest===digest&&open.status==='Confirmed')fail(409,`The client has already confirmed these figures (version ${open.version}).`);
  if(open)await tx`update erp_private.payroll_client_confirmations set status='Superseded',superseded_at=now() where confirmation_id=${open.confirmation_id}`;
  const version=(rows[0]?.version||0)+1;
  const [made]=await tx`insert into erp_private.payroll_client_confirmations(client_id,project_id,import_id,version,digest,snapshot,issued_by) values(${project.client_id},${pid},${r.import_id},${version},${digest},${tx.json(snapshot)},${a.staff_id}) returning confirmation_id`;
  return {ok:true,confirmation_id:made.confirmation_id,version,digest};
 }
 // payroll_confirmation_record
 const row=one(await tx`select * from erp_private.payroll_client_confirmations where confirmation_id=${uuid(p.confirmation_id)} and import_id=${r.import_id} for update`);
 if(row.status!=='Issued')fail(409,row.status==='Superseded'?'This version was replaced by a newer one.':'The client answer for this version is already recorded.');
 if(p.revision!==undefined&&String(row.revision)!==revision(p.revision))fail(409,'This report changed. Refresh first.');
 const decision=choice(p.decision,CONFIRM_DECISIONS),note=text(p.note||'',1000,false).trim(),responder=text(p.responder_name||'',120,false).trim(),on=date(p.responded_on)||'';
 let evidence:string|null=null;if(p.evidence_document_id){evidence=uuid(p.evidence_document_id);one(await tx`select document_id from erp_private.documents where document_id=${evidence} and project_id=${pid} and deleted_at is null`);}
 const problems=answerIssues({decision,responder,on,note,evidence,today:todayNairobi()});if(problems.length)fail(400,problems.join(' '));
 const cur=await build(tx,project,r);
 if(cur.digest!==row.digest)fail(409,'The run changed after this version was issued, so the client did not see these figures. Issue a new version.');
 if(!['Draft','Returned'].includes(r.status))fail(409,'The run is no longer being prepared.');
 await tx`update erp_private.payroll_client_confirmations set status=${decision},responder_name=${responder},responded_on=${on},response_note=${note||null},evidence_document_id=${evidence},recorded_by=${a.staff_id},recorded_at=now() where confirmation_id=${row.confirmation_id}`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'payroll_client_confirmations','PAYROLL_CLIENT_ANSWER_RECORDED',${String(row.confirmation_id)},${tx.json({month:day(r.starts_on).slice(0,7),version:row.version,decision,responder})})`;
 return {ok:true,status:decision};
}
