import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {nextProcedureStage,profiles} from './procedure-rules.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'This task or procedure is unavailable.');return r[0];};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export async function procedureAction(tx:any,a:any,p:any,taxAction:any){
 if(!['procedure_read','procedure_action'].includes(p.action))return undefined;
 const t=one(await tx`select * from erp_private.tasks where task_id=${uuid(p.task_id)} and deleted_at is null`),project=one(await tx`select * from erp_private.projects where project_id=${t.project_id} and deleted_at is null`),w=one(await tx`select * from erp_private.task_procedures where task_id=${t.task_id} for update`);
 if(p.action==='procedure_read')return {record:a.category_code==='INTERN'?{...w,contact_id:null,approval_document_id:null,filing_document_id:null,payment_document_id:null,details:{query:w.profile==='Supporting task'?w.details.query:null}}:w,events:await tx`select * from erp_private.procedure_events where task_id=${t.task_id} order by created_at desc limit 100`};
 if(a.category_code==='INTERN'&&(w.profile!=='Supporting task'||p.operation==='setup'))fail(403,'A staff preparer must handle client approvals and filing.');
 if(String(w.revision)!==revision(p.revision))fail(409,'This workflow changed. Refresh the task workspace first.');
 if(['Completed','Cancelled'].includes(t.status)||w.stage==='Closed')fail(400,'Closed or cancelled work cannot change.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${t.project_id+':tax'},0))`;
 const op=text(p.operation,40),note=text(p.message||'',2000);if(note.length<3)fail(400,'Add a work note or reason.');
 const own=t.assigned_to===a.staff_id,manager=['PARTNER','MANAGER'].includes(a.category_code),editor=['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code);let details={...w.details},target=w.stage;
 if(op==='note'){if(!own&&!editor)fail(403,'Only assigned staff or the project reviewer may comment.');await tx`insert into erp_private.procedure_events(task_id,actor_id,action,from_stage,to_stage,message) values(${t.task_id},${a.staff_id},'comment',${w.stage},${w.stage},${note})`;return {ok:true,stage:w.stage};}
 if(op==='setup'){
  if(!own&&!editor)fail(403,'Only the preparer or project reviewer can set up this workflow.');if(!['Pending preparer','Pending client documents'].includes(w.stage))fail(400,'Return work before changing its setup.');
  const profile=choice(p.profile,profiles);if(profile!==w.profile&&!editor)fail(403,'A Supervisor or Manager must change the service procedure.');
  const reviewer=p.reviewer_id?uuid(p.reviewer_id):null;if(profile!=='Supporting task'){
   if(!reviewer||reviewer===t.assigned_to)fail(400,'Choose another Supervisor, Manager or Partner.');
   one(await tx`select staff_id from erp_private.assignment_candidates() where staff_id=${reviewer} and firm_id=${project.handling_firm_id} and category_code in('PARTNER','MANAGER','SUPERVISOR')`);
  }
  const cid=p.case_id?uuid(p.case_id):null;if(profile==='Tax filing'){if(!project.service_code.startsWith('TAX-'))fail(400,'Use a tax engagement for a statutory tax filing.');if(!cid)fail(400,'Link this period’s tax computation.');one(await tx`select case_id from erp_private.tax_cases where case_id=${cid} and project_id=${t.project_id} and deleted_at is null`);}else if(cid)fail(400,'Only a tax filing procedure links a tax computation.');
  const contact=p.contact_id?uuid(p.contact_id):null;if(contact)one(await tx`select contact_id from erp_private.client_contacts where contact_id=${contact} and client_id=${project.client_id} and deleted_at is null`);
  const protocol=choice(p.protocol||'Secure email',['Secure email','Encrypted ZIP via email','Secure file transfer','Physical delivery']),cutoff=date(p.cutoff_on),statutory=date(p.statutory_due_on),requested=date(p.requested_on),received=date(p.received_on);
  if(requested&&requested>today()||received&&received>today()||requested&&received&&received<requested)fail(400,'Check the actual document request and receipt dates.');
  if(cutoff&&statutory&&cutoff>statutory)fail(400,'The agreed cutoff cannot follow the recorded statutory deadline.');
  details={...details,protocol,protocol_note:text(p.protocol_note||'',2000,false),authority_reference:text(p.authority_reference||'',1000,false),cutoff_on:cutoff,statutory_due_on:statutory,requested_on:requested,received_on:received,setup_note:note};
  await tx`update erp_private.task_procedures set profile=${profile},case_id=${cid},reviewer_id=${reviewer},contact_id=${contact},details=${tx.json(details)} where task_id=${t.task_id}`;
 }else{
  target=nextProcedureStage(w,op,a,t.assigned_to);
  const evidence=async(value:any,pdf=false)=>{const id=uuid(value),d=one(await tx`select * from erp_private.documents where document_id=${id} and project_id=${t.project_id} and client_id=${project.client_id} and handling_firm_id=${project.handling_firm_id} and deleted_at is null`);if(pdf&&d.mime_type!=='application/pdf')fail(400,'Save the written approval or acknowledgment as PDF evidence.');if(!d.is_locked)await tx`update erp_private.documents set is_locked=true where document_id=${id}`;return id;};
  const c=w.case_id?(await tx`select * from erp_private.tax_cases where case_id=${w.case_id} and project_id=${t.project_id} for update`)[0]:null;
  if(op==='submit'){
   if(!w.reviewer_id||w.reviewer_id===a.staff_id)fail(400,'Choose an independent reviewer first.');
   if(t.requires_document&&!one(await tx`select exists(select 1 from erp_private.documents where task_id=${t.task_id} and deleted_at is null) ok`).ok)fail(400,'Upload the required task documents.');
   if(!details.received_on)fail(400,'Record when the agreed client records were received.');
   if(w.profile==='Tax filing'){if(!c)fail(400,'Link the correct tax computation.');if(['Draft','Returned'].includes(c.status))await taxAction(tx,a,{action:'tax_submit',case_id:c.case_id,revision:c.revision});else if(!['Submitted','Locked'].includes(c.status))fail(400,'Choose a draft or submitted tax period.');}
   details.submission_note=note;await tx`update erp_private.task_procedures set prepared_by=${a.staff_id} where task_id=${t.task_id}`;
  }
  if(op==='approve'||op==='return'){
   if(w.profile==='Tax filing'&&c?.status==='Submitted')await taxAction(tx,a,{action:'tax_review',case_id:c.case_id,revision:c.revision,status:op==='return'?'Returned':'Locked',review_note:note});
   else if(w.profile==='Tax filing'&&(op==='return'||c?.status!=='Locked'))fail(400,'The tax computation must be reviewed through its maker-checker controls.');
   details.internal_review={reviewer_id:a.staff_id,at:new Date().toISOString(),note};
   if(op==='return')details.submission_note=null;
  }
  if(op==='client-approval'){
   if(!w.contact_id||!details.authority_reference||!details.cutoff_on||!details.protocol||w.profile==='Tax filing'&&!details.statutory_due_on)fail(400,'Record the authorised representative, authority basis, secure protocol, agreed cutoff and verified filing deadline.');
   const approved=date(p.approved_on);if(!approved||approved>today()||approved<day(details.internal_review?.at))fail(400,'Approval must follow internal review and cannot be future-dated.');
   if(approved>details.cutoff_on&&(!manager||note.length<10))fail(403,'Late approval needs Manager acknowledgment and a written exception note. No automatic waiver of liability is recorded.');
   if(w.profile==='Tax filing'&&c?.status!=='Locked')fail(400,'The tax computation must be independently locked.');
   const doc=await evidence(p.approval_document_id,true);details.approval={approved_on:approved,logged_by:a.staff_id,logged_at:new Date().toISOString(),note,contact_id:w.contact_id,authority_reference:details.authority_reference};await tx`update erp_private.task_procedures set approval_document_id=${doc} where task_id=${t.task_id}`;
  }
  if(op==='file'){
   if(c?.result?.testing_only&&p.testing_simulation_confirmed!==true)fail(400,'Testing rates require an explicitly confirmed simulated filing. Do not file these figures with KRA.');
   if(project.status!=='Active')fail(400,'Activate the engagement with verified onboarding and signed EL before recording a filing.');
   if(!c||c.status!=='Locked'||!w.approval_document_id)fail(400,'Independent review and written client approval are required.');
   const filed=date(p.filing_date);if(!filed||filed>today()||filed<day(c.ends_on)||filed<details.approval?.approved_on)fail(400,'Check the actual filing date against the period and client approval.');
   const doc=await evidence(p.filing_document_id,true),prn=text(p.prn||'',100,false),noPrn=text(p.no_prn_reason||'',1000,false);if(!prn&&noPrn.length<10)fail(400,'Enter the PRN, or explain a nil return/no PRN issued.');
   details.filing={test_only:c.result.testing_only===true,filing_date:filed,prn:prn||null,no_prn_reason:noPrn||null,recorded_by:a.staff_id,at:new Date().toISOString(),note};
   await tx`update erp_private.task_procedures set filing_document_id=${doc},details=${tx.json(details)} where task_id=${t.task_id}`;
   await tx`update erp_private.tax_cases set status='Filed',filing_date=${filed} where case_id=${c.case_id}`;
  }
  if(op==='deliver'){if(project.status!=='Active')fail(400,'Activate the engagement before recording external delivery.');const doc=await evidence(p.deliverable_document_id);details.delivery={at:new Date().toISOString(),note,delivered_on:today()};await tx`update erp_private.task_procedures set deliverable_document_id=${doc} where task_id=${t.task_id}`;}
  if(op==='close'){
   if(p.evidence_verified!==true)fail(400,'Confirm that you reviewed the filing/delivery evidence and payment position.');
   if(w.profile==='Tax filing'){
    const outcome=choice(p.payment_outcome,['Paid','Not payable']);if(outcome==='Paid'){const doc=await evidence(p.payment_document_id);await tx`update erp_private.task_procedures set payment_document_id=${doc} where task_id=${t.task_id}`;}else if(note.length<10)fail(400,'Document why no payment is payable against the approved computation.');details.payment_outcome=outcome;
   }
   details.closure={at:new Date().toISOString(),note,verified_by:a.staff_id};
  }
  if(op==='capture'&&t.requires_document&&!one(await tx`select exists(select 1 from erp_private.documents where task_id=${t.task_id} and deleted_at is null) ok`).ok)fail(400,'Upload the required document before completing capture.');
  if(op==='query')details.query=note;
  if(op==='resume')details.received_on=date(p.received_on)||today();
  await tx`update erp_private.task_procedures set stage=${target},details=${tx.json(details)},closed_by=${target==='Closed'?a.staff_id:null},closed_at=${target==='Closed'?new Date():null} where task_id=${t.task_id}`;
  const status=target==='Closed'?'Completed':target==='Pending client documents'?'Blocked':target==='Pending preparer'?'In Progress':'In Review';
  await tx`update erp_private.tasks set status=${status},blocked_reason=${target==='Pending client documents'?note:null},filing_date=coalesce(${details.filing?.filing_date||null}::date,filing_date) where task_id=${t.task_id}`;
  const recipient=op==='submit'?w.reviewer_id:['return','approve'].includes(op)?t.assigned_to:null;
  if(recipient)await tx`insert into erp_private.notifications(recipient_id,task_id,message,event_key) values(${recipient},${t.task_id},${t.task_name+': '+target+'. '+note},${crypto.randomUUID()})`;
 }
 await tx`insert into erp_private.procedure_events(task_id,actor_id,action,from_stage,to_stage,message) values(${t.task_id},${a.staff_id},${op},${w.stage},${target},${note})`;
 return {ok:true,stage:target};
}
