// Request Documents. Assistants pick a pre-approved template and tick items; a Supervisor, Manager or Partner sends it and records how.
// Manager or Partner writes and approves the templates. The rules live in the database (erp_private.doc_request_*); this validates input.
import {fail,text,uuid,choice,date} from './validation.mjs';
export async function documentRequestAction(tx:any,a:any,p:any){
 if(!String(p.action||'').startsWith('doc_request_'))return undefined;
 if(p.action==='doc_request_template_list')return {templates:await tx`select template_id,title,body,items,status,created_by,approved_by,approved_at,revision from erp_private.doc_request_templates order by (status='Approved') desc,title`};
 if(p.action==='doc_request_template_save'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can change request templates.');
  const items=Array.isArray(p.items)?p.items.map((x:any)=>text(x,120).trim()):String(p.items_text||'').split('\n').map(x=>x.trim()).filter(Boolean);
  if(!items.length||items.length>20)fail(400,'List between 1 and 20 documents.');
  const [r]=await tx`select erp_private.doc_request_template_save(${p.template_id?uuid(p.template_id):null}::uuid,${text(p.title,100).trim()},${text(p.body,1500).trim()},${tx.array(items)}::text[]) id`;
  return {ok:true,template_id:r.id};
 }
 if(p.action==='doc_request_template_decide'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can approve request templates.');
  await tx`select erp_private.doc_request_template_decide(${uuid(p.template_id)}::uuid,${choice(p.decision,['Approve','Retire'])})`;return {ok:true};
 }
 if(p.action==='doc_request_create'){
  if(!['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code))fail(403,'Your role cannot request documents.');
  const items=Array.isArray(p.items)?p.items.map((x:any)=>text(x,120).trim()):[];if(!items.length)fail(400,'Tick at least one item.');
  const start=date(p.period_start),end=date(p.period_end);if(!start||!end)fail(400,'Choose the period the documents cover.');
  const [r]=await tx`select erp_private.doc_request_create(${uuid(p.client_id)}::uuid,${p.project_id?uuid(p.project_id):null}::uuid,${uuid(p.template_id)}::uuid,${tx.array(items)}::text[],${start}::date,${end}::date) id`;
  return {ok:true,request_id:r.id};
 }
 if(p.action==='doc_request_list')return {requests:await tx`select r.request_id,r.client_id,r.project_id,r.title,r.items,r.period_start,r.period_end,r.status,r.requested_by,s.full_name requester_name,r.decided_by,d.full_name decider_name,r.decided_at,r.sent_via,r.decision_note,r.created_at,r.revision,
   case when erp_private.comm_external_allowed(r.client_id) or r.requested_by=${a.staff_id} then r.message_text else null end message_text,
   c.full_name contact_name,c.email_address contact_email,c.phone_number contact_phone
   from erp_private.document_requests r join erp_private.staff_members s on s.staff_id=r.requested_by left join erp_private.staff_members d on d.staff_id=r.decided_by left join erp_private.client_contacts c on c.contact_id=r.contact_id
   where r.client_id=${uuid(p.client_id)}::uuid order by (r.status='Awaiting sending') desc,r.created_at desc limit 100`};
 if(p.action==='doc_request_decide'){
  if(!['SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Supervisor, Manager or Partner can send a document request to a client.');
  const decision=choice(p.decision,['Sent','Cancel']);
  await tx`select erp_private.doc_request_decide(${uuid(p.request_id)}::uuid,${decision},${decision==='Sent'?choice(p.sent_via,['Email','WhatsApp','Phone','In person','Client portal']):null},${text(p.note||'',1000,false).trim()})`;return {ok:true};
 }
 fail(400,'Unknown document request action.');
}
