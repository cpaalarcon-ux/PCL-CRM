import {fail,text,uuid,choice,date,revision} from './validation.mjs';

// Step 7: the KRA notice log, its document requests, the verification task and the non-compliance flags.
// The database repeats every rule below (see 20261109264000_kra_notices.sql); these checks give friendly messages and keep the order of writes.
// The system never creates the KRA project: staff create it from the template and link it to the case.
// Rights are not in the staff rights catalogue: who may do what is decided here and in the database triggers.
const ACTIONS=['kra_form_options','kra_list','kra_read','kra_log','kra_edit','kra_link_project','kra_respond','kra_return','kra_close','kra_cancel',
 'kra_request_add','kra_request_attach','kra_request_na','kra_request_reopen','kra_flags','kra_check_now','kra_settings_read','kra_setting_set','kra_setting_confirm'];
const TYPES=['Audit notice','Assessment','Demand','Objection decision','Other'];
const HEADS=['Income tax','VAT','PAYE','Withholding tax','Excise','Other'];
const STATUSES=['Open','Responded','Closed','Cancelled'];
const SEVERITIES=['CRITICAL','HIGH','MEDIUM'];
const one=(r:any[],m='This record is not available to your account.')=>{if(!r.length)fail(403,m);return r[0];};
const staffOnly=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code))fail(403,'Your account cannot use the KRA notice log.');};
const leaderOf=(a:any,m='A Manager or Partner must do this.')=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,m);};
const partnerOf=(a:any,m:string)=>{if(a.category_code!=='PARTNER')fail(403,m);};
const same=(row:any,p:any,m='This record changed. Refresh first.')=>{if(String(row.revision)!==revision(p.revision))fail(409,m);};

async function caseOf(tx:any,id:string){
 return one(await tx`select * from erp_private.kra_cases where case_id=${id} for update`,'This KRA case is not available to your account.');
}
function details(p:any){
 const ref=text(p.notice_reference,80);if(ref.length<3)fail(400,'Enter the reference printed on the KRA notice.');
 const summary=text(p.summary,2000);if(summary.length<10)fail(400,'Summarise what the notice asks for, in at least 10 characters.');
 const ps=date(String(p.period_start||'')),pe=date(String(p.period_end||'')),nd=date(String(p.notice_date||'')),dl=date(String(p.deadline_date||''));
 if(!ps||!pe||!nd||!dl)fail(400,'Enter the period, the notice date and the deadline.');
 if(pe<ps)fail(400,'The period must end on or after the day it starts.');
 if(dl<nd)fail(400,'The deadline cannot be before the notice date.');
 return {ref,type:choice(p.notice_type,TYPES),head:choice(p.tax_head,HEADS),ps,pe,nd,dl,summary,
  doc:p.notice_document_id?uuid(p.notice_document_id):null,project:p.project_id?uuid(p.project_id):null};
}
async function projectRef(tx:any,pid:string|null,clientId:string){
 if(!pid)return;
 one(await tx`select 1 from erp_private.projects p where p.project_id=${pid} and p.client_id=${clientId} and p.deleted_at is null and erp_private.project_allowed(p.project_id)`,'That project is not a project of this client that you can see.');
}
const lines=(v:any)=>String(v||'').split('\n').map(x=>x.trim()).filter(Boolean);

export async function kraAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 staffOnly(a);

 if(p.action==='kra_form_options'){
  const clients=await tx`select c.client_id,c.company_name,array(select f.firm_id from erp_private.firms f where erp_private.kra_firm_handles(c.client_id,f.firm_id) order by f.firm_code) as firm_ids
   from erp_private.clients c where c.deleted_at is null and erp_private.client_allowed(c.client_id) order by c.company_name limit 500`;
  const firms=await tx`select f.firm_id,f.firm_code,f.legal_name from erp_private.firms f order by f.firm_code`;
  return {clients,firms,types:TYPES,tax_heads:HEADS};
 }

 if(p.action==='kra_list'){
  const status=p.status?choice(p.status,STATUSES):null,client=p.client_id?uuid(p.client_id):null;
  const cases=await tx`select c.case_id,c.client_id,cl.company_name as client_name,c.handling_firm_id,c.notice_reference,c.notice_type,c.tax_head,c.period_start,c.period_end,c.notice_date,c.received_on,c.deadline_date,
    c.status,c.responded_on,c.project_id,pr.project_name,c.verification_task_id,c.task_owner_id,c.task_due_on,c.task_urgent,c.task_basis,c.revision,
    (c.deadline_date-(now() at time zone 'Africa/Nairobi')::date) as days_left,
    t.status as task_status,t.assigned_to as task_assignee,
    (select m.full_name from erp_private.staff_members m where m.staff_id=t.assigned_to) as task_assignee_name,
    (select count(*) from erp_private.kra_case_requests r where r.case_id=c.case_id and r.status='MISSING')::int as missing_requests,
    (select count(*) from erp_private.kra_case_requests r where r.case_id=c.case_id)::int as total_requests,
    coalesce((select string_agg(f.flag_code,'' order by f.flag_code) from erp_private.kra_compliance_flags f where f.case_id=c.case_id and f.status='Open'),'') as open_flags
   from erp_private.kra_cases c join erp_private.clients cl on cl.client_id=c.client_id
    left join erp_private.projects pr on pr.project_id=c.project_id left join erp_private.tasks t on t.task_id=c.verification_task_id
   where (${status}::text is null or c.status=${status}) and (${client}::uuid is null or c.client_id=${client})
   order by (c.status='Open') desc,(c.status='Responded') desc,c.deadline_date,c.notice_reference limit 300`;
  const counts=(await tx`select erp_private.kra_flag_counts() as c`)[0].c;
  return {cases,counts};
 }

 if(p.action==='kra_flags'){
  const severity=p.severity?choice(p.severity,SEVERITIES):null;
  const counts=(await tx`select erp_private.kra_flag_counts() as c`)[0].c;
  const flags=await tx`select * from erp_private.kra_flag_list(${severity}::text)`;
  return {counts,flags};
 }

 if(p.action==='kra_read'){
  const c=one(await tx`select c.*,cl.company_name as client_name,pr.project_name,
    (c.deadline_date-(now() at time zone 'Africa/Nairobi')::date) as days_left,
    (select d.file_name from erp_private.documents d where d.document_id=c.notice_document_id) as notice_file,
    (select m.full_name from erp_private.staff_members m where m.staff_id=c.logged_by) as logged_by_name,
    (select m.full_name from erp_private.staff_members m where m.staff_id=c.responded_by) as responded_by_name,
    (select m.full_name from erp_private.staff_members m where m.staff_id=c.closed_by) as closed_by_name,
    (select m.full_name from erp_private.staff_members m where m.staff_id=c.task_owner_id) as task_owner_name
   from erp_private.kra_cases c join erp_private.clients cl on cl.client_id=c.client_id left join erp_private.projects pr on pr.project_id=c.project_id
   where c.case_id=${uuid(p.case_id)}`,'This KRA case is not available to your account.');
  const task=c.verification_task_id?(await tx`select t.task_id,t.task_name,t.status,t.due_at,t.assigned_to,(select m.full_name from erp_private.staff_members m where m.staff_id=t.assigned_to) as assignee_name
   from erp_private.tasks t where t.task_id=${c.verification_task_id}`)[0]||null:null;
  const requests=await tx`select r.request_id,r.description,r.needed_by,r.status,r.document_id,r.received_on,r.na_reason,r.revision,
    (select d.file_name from erp_private.documents d where d.document_id=r.document_id) as file_name
   from erp_private.kra_case_requests r where r.case_id=${c.case_id} order by r.created_at`;
  const flags=await tx`select f.flag_id,f.flag_code,f.severity,f.detail,f.action_needed,f.raised_on,f.status,f.resolved_at,f.resolved_how,
    (select m.full_name from erp_private.staff_members m where m.staff_id=f.resolved_by) as resolved_by_name
   from erp_private.kra_compliance_flags f where f.case_id=${c.case_id} order by (f.status='Open') desc,f.raised_on desc,f.flag_code`;
  const documents=c.status==='Open'||c.status==='Responded'?await tx`select document_id,file_name,category from erp_private.kra_client_documents(${c.client_id}::uuid)`:[];
  const projects=c.status==='Open'||c.status==='Responded'?await tx`select p.project_id,p.project_name,p.service_code,p.status from erp_private.projects p
   where p.client_id=${c.client_id} and p.deleted_at is null and p.status<>'Archived' and erp_private.project_allowed(p.project_id) order by p.project_name`:[];
  const tickets=await tx`select t.ticket_id,t.ticket_number,sv.service_name,t.status,t.priority,t.response_due_on,t.resolution_due_on,coalesce(s.full_name,'A colleague') assigned_name
   from erp_private.client_support_tickets t join erp_private.client_support_services sv on sv.service_code=t.service_code left join erp_private.staff_members s on s.staff_id=t.assigned_to
   where t.kra_case_id=${c.case_id} order by t.opened_at desc limit 50`;
  return {case:c,task,requests,flags,documents,projects,tickets};
 }

 if(p.action==='kra_settings_read'){
  return {settings:await tx`select setting_key,label,int_value,text_value,rule_status,source_note,confirmed_at,revision from erp_private.kra_check_settings order by setting_key`};
 }

 if(p.action==='kra_check_now'){
  leaderOf(a,'Only a Manager or Partner can run the KRA checks.');
  return {ok:true,...(await tx`select erp_private.kra_run_checks() as r`)[0].r};
 }

 if(p.action==='kra_setting_set'){
  partnerOf(a,'Only a Partner can change a KRA check setting.');
  const row=one(await tx`select * from erp_private.kra_check_settings where setting_key=${text(p.setting_key,40)} for update`);same(row,p);
  if(row.int_value!==null){
   const n=Number(p.value);if(!Number.isInteger(n))fail(400,'Enter a whole number of days.');
   await tx`update erp_private.kra_check_settings set int_value=${n} where setting_key=${row.setting_key}`;
  }else{
   const v=text(String(p.value??''),20);
   await tx`update erp_private.kra_check_settings set text_value=${v} where setting_key=${row.setting_key}`;
  }
  return {ok:true};
 }
 if(p.action==='kra_setting_confirm'){
  partnerOf(a,'Only a Partner can record the Tax Lead\'s confirmation.');
  const row=one(await tx`select * from erp_private.kra_check_settings where setting_key=${text(p.setting_key,40)} for update`);same(row,p);
  if(row.rule_status==='Confirmed')fail(400,'This setting is already confirmed.');
  const source=text(p.source_note,1000);if(source.length<10)fail(400,'Record who confirmed this and where it is written (for example an email and its date), at least 10 characters.');
  await tx`update erp_private.kra_check_settings set rule_status='Confirmed',source_note=${source},confirmed_by=${a.staff_id} where setting_key=${row.setting_key}`;
  return {ok:true};
 }

 if(p.action==='kra_log'){
  const d=details(p),clientId=uuid(p.client_id);
  one(await tx`select 1 from erp_private.clients c where c.client_id=${clientId} and c.deleted_at is null and erp_private.client_allowed(c.client_id)`,'This client is not available to your account.');
  let firm:string|null=p.handling_firm_id?uuid(p.handling_firm_id):null;
  if(!firm){
   const f=await tx`select f.firm_id from erp_private.firms f where erp_private.kra_firm_handles(${clientId}::uuid,f.firm_id)`;
   if(f.length!==1)fail(400,'Choose the firm that handles this notice.');
   firm=f[0].firm_id;
  }
  await projectRef(tx,d.project,clientId);
  const received=p.received_on?date(String(p.received_on)):null;
  const reqs=lines(p.requests);if(reqs.length>20)fail(400,'List at most 20 requested documents; add the rest on the case.');
  for(const r of reqs)if(r.length<5||r.length>300)fail(400,'Each requested document needs 5 to 300 characters.');
  const [row]=await tx`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,notice_document_id,project_id,logged_by)
   values(${clientId},${firm},${d.ref},${d.type},${d.head},${d.ps},${d.pe},${d.nd},${received},${d.dl},${d.summary},${d.doc},${d.project},${a.staff_id}) returning case_id`;
  for(const r of reqs)await tx`insert into erp_private.kra_case_requests(case_id,description,created_by) values(${row.case_id},${r},${a.staff_id})`;
  const c=(await tx`select verification_task_id,task_urgent,task_due_on,task_basis from erp_private.kra_cases where case_id=${row.case_id}`)[0];
  return {ok:true,case_id:row.case_id,task_created:!!c.verification_task_id,task_urgent:c.task_urgent,task_due_on:c.task_due_on,task_basis:c.task_basis,
   open_flags:(await tx`select flag_code from erp_private.kra_compliance_flags where case_id=${row.case_id} and status='Open' order by flag_code`).map((f:any)=>f.flag_code)};
 }

 const c=await caseOf(tx,uuid(p.case_id||(p.request_id?(await tx`select case_id from erp_private.kra_case_requests where request_id=${uuid(p.request_id)}`)[0]?.case_id:null)));

 if(p.action==='kra_edit'){
  same(c,p);if(c.status!=='Open')fail(400,'Only an open case can be edited.');
  const d=details(p);await projectRef(tx,d.project,c.client_id);
  await tx`update erp_private.kra_cases set notice_reference=${d.ref},notice_type=${d.type},tax_head=${d.head},period_start=${d.ps},period_end=${d.pe},notice_date=${d.nd},deadline_date=${d.dl},summary=${d.summary},notice_document_id=${d.doc},project_id=${d.project} where case_id=${c.case_id}`;
  return {ok:true};
 }
 if(p.action==='kra_link_project'){
  same(c,p);if(!['Open','Responded'].includes(c.status))fail(400,'This case is closed.');
  const pid=uuid(p.project_id);await projectRef(tx,pid,c.client_id);
  await tx`update erp_private.kra_cases set project_id=${pid} where case_id=${c.case_id}`;
  const after=(await tx`select verification_task_id from erp_private.kra_cases where case_id=${c.case_id}`)[0];
  return {ok:true,task_created:!!after.verification_task_id};
 }
 if(p.action==='kra_respond'){
  same(c,p);if(c.status!=='Open')fail(400,'Only an open case can be marked as responded.');
  const on=date(String(p.responded_on||''));if(!on)fail(400,'Enter the date the response was sent to KRA.');
  await tx`update erp_private.kra_cases set status='Responded',responded_on=${on} where case_id=${c.case_id}`;
  return {ok:true};
 }
 if(p.action==='kra_return'){
  leaderOf(a,'Only a Manager or Partner can return a responded case to Open.');same(c,p);if(c.status!=='Responded')fail(400,'Only a responded case can be returned to Open.');
  const note=text(p.note,500);if(note.length<10)fail(400,'Say why the case is returned to Open, in at least 10 characters.');
  await tx`update erp_private.kra_cases set status='Open',return_note=${note} where case_id=${c.case_id}`;
  return {ok:true};
 }
 if(p.action==='kra_close'){
  partnerOf(a,'Only a Partner can approve and close a KRA case.');same(c,p);
  if(c.status!=='Responded')fail(400,'The case must be marked as responded before a Partner approves and closes it.');
  await tx`update erp_private.kra_cases set status='Closed' where case_id=${c.case_id}`;
  return {ok:true};
 }
 if(p.action==='kra_cancel'){
  leaderOf(a,'Only a Manager or Partner can cancel a case logged in error.');same(c,p);
  if(!['Open','Responded'].includes(c.status))fail(400,'This case is already closed.');
  const note=text(p.note,500);if(note.length<10)fail(400,'Say why the case is cancelled, in at least 10 characters.');
  await tx`update erp_private.kra_cases set status='Cancelled',close_note=${note} where case_id=${c.case_id}`;
  return {ok:true};
 }

 if(p.action==='kra_request_add'){
  if(c.status!=='Open')fail(400,'Documents can be requested only while the case is open.');
  const desc=text(p.description,300);if(desc.length<5)fail(400,'Describe the document the notice asks for, in at least 5 characters.');
  const by=p.needed_by?date(String(p.needed_by)):null;
  await tx`insert into erp_private.kra_case_requests(case_id,description,needed_by,created_by) values(${c.case_id},${desc},${by},${a.staff_id})`;
  return {ok:true};
 }
 const rq=async()=>{const r=one(await tx`select * from erp_private.kra_case_requests where request_id=${uuid(p.request_id)} and case_id=${c.case_id} for update`);same(r,p);return r;};
 if(p.action==='kra_request_attach'){
  const r=await rq();if(r.status!=='MISSING')fail(400,'This request already has an answer.');
  const doc=uuid(p.document_id);
  await tx`update erp_private.kra_case_requests set status='RECEIVED',document_id=${doc} where request_id=${r.request_id}`;
  return {ok:true};
 }
 if(p.action==='kra_request_na'){
  leaderOf(a,'Only a Manager or Partner can mark a requested document not applicable.');
  const r=await rq();if(r.status!=='MISSING')fail(400,'This request already has an answer.');
  const reason=text(p.reason,500);if(reason.length<10)fail(400,'Say why it is not applicable, in at least 10 characters.');
  await tx`update erp_private.kra_case_requests set status='NOT_APPLICABLE',na_reason=${reason} where request_id=${r.request_id}`;
  return {ok:true};
 }
 if(p.action==='kra_request_reopen'){
  const r=await rq();if(r.status==='MISSING')fail(400,'This request is already missing.');
  await tx`update erp_private.kra_case_requests set status='MISSING' where request_id=${r.request_id}`;
  return {ok:true};
 }
 return undefined;
}
