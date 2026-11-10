import {fail,uuid,text,choice,revision} from './validation.mjs';
import {invoiceLines} from './suite-rules.mjs';

// Client support services: requests a CLIENT makes of the firm (KRA notice lifting, compliance certificates, ledger reconciliation, compounding, obligation changes, queries).
// This is separate from the internal staff help desk (support_tickets / ticket_* actions), which bills nobody and is not touched here.
// A ticket for a billable service gets a DRAFT invoice when, and only when, it is closed. The rules live in the database (20261110278000_client_support_services.sql);
// the invoice lines go through the same invoiceLines() as every other invoice, so the firm's 16% VAT rule applies. The fee is a person's entry; no rate is stored.
const ACTIONS=['client_support_services','client_support_service_set','client_support_list','client_support_open','client_support_update','client_support_close','client_support_cancel'];
const WORKING=['Open','In progress','Waiting on client','Work done'];
const one=(r:any[],m='That ticket is unavailable to your account.')=>{if(!r.length)fail(404,m);return r[0];};
const money=(v:any)=>{const n=Number(v);if(v===''||v===null||v===undefined||!Number.isFinite(n)||n<=0||n>1e10)fail(400,'Enter the fee before VAT as an amount above zero.');return Math.round(n*100)/100;};

export async function clientSupportAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Your role does not handle client support tickets.');

 if(p.action==='client_support_services')return {services:await tx`select service_code,service_name,is_billable,is_active,source_note,changed_at,revision from erp_private.client_support_services order by sort_order`};
 if(p.action==='client_support_service_set'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner decides which client services are billed.');
  const s=one(await tx`select * from erp_private.client_support_services where service_code=${text(p.service_code,60)} for update`,'That service is unavailable.');
  if(String(s.revision)!==revision(p.revision))fail(409,'This service changed. Refresh first.');
  const note=text(p.source_note,500);if(note.trim().length<10)fail(400,'Record where the Partner\'s decision is written (at least 10 characters).');
  const billable=p.is_billable===undefined?s.is_billable:p.is_billable===true,active=p.is_active===undefined?s.is_active:p.is_active===true;
  if(billable===s.is_billable&&active===s.is_active)fail(400,'Nothing was changed.');
  await tx`update erp_private.client_support_services set is_billable=${billable},is_active=${active},source_note=${note.trim()} where service_code=${s.service_code}`;return {ok:true};
 }
 if(p.action==='client_support_list'){
  const cid=p.client_id?uuid(p.client_id):null;
  return {tickets:await tx`select t.ticket_id,t.ticket_number,t.client_id,t.firm_id,t.project_id,t.service_code,sv.service_name,sv.is_billable,t.subject,t.details,t.status,t.opened_by,t.assigned_to,t.opened_at,t.fee_amount,t.invoice_id,i.invoice_number,i.status invoice_status,t.resolution,t.closed_at,t.revision,c.company_name,s.full_name assigned_name
    from erp_private.client_support_tickets t join erp_private.client_support_services sv on sv.service_code=t.service_code join erp_private.clients c on c.client_id=t.client_id join erp_private.staff_members s on s.staff_id=t.assigned_to
    left join erp_private.invoices i on i.invoice_id=t.invoice_id
    where (${cid}::uuid is null or t.client_id=${cid}) order by (t.status in('Closed','Cancelled')),t.opened_at desc limit 300`};
 }
 if(p.action==='client_support_open'){
  const cid=uuid(p.client_id),sv=one(await tx`select * from erp_private.client_support_services where service_code=${text(p.service_code,60)}`,'Choose a service from the list.');
  if(!sv.is_active)fail(400,'That service is switched off.');
  let firm=p.firm_id?uuid(p.firm_id):null,pid=p.project_id?uuid(p.project_id):null;
  if(pid){const pr=one(await tx`select client_id,handling_firm_id from erp_private.projects where project_id=${pid} and deleted_at is null`,'That engagement is unavailable.');if(pr.client_id!==cid)fail(400,'That engagement belongs to another client.');firm=pr.handling_firm_id;}
  if(!firm)fail(400,'Choose the firm handling this request, or an engagement.');
  one(await tx`select 1 from erp_private.client_firm_links where client_id=${cid} and handling_firm_id=${firm}`.catch(()=>[]),'That client is not linked to the chosen firm.');
  const to=p.assigned_to?uuid(p.assigned_to):a.staff_id;
  const r=await tx`insert into erp_private.client_support_tickets(client_id,firm_id,project_id,service_code,subject,details,opened_by,assigned_to) values(${cid},${firm},${pid},${sv.service_code},${text(p.subject,200)},${text(p.details,4000)},${a.staff_id},${to}) returning ticket_id,ticket_number`;
  return {ok:true,ticket_id:r[0].ticket_id,ticket_number:r[0].ticket_number,billable:sv.is_billable};
 }
 const t=one(await tx`select * from erp_private.client_support_tickets where ticket_id=${uuid(p.ticket_id)} for update`);
 if(String(t.revision)!==revision(p.revision))fail(409,'This ticket changed. Refresh first.');
 if(['Closed','Cancelled'].includes(t.status))fail(400,'A closed or cancelled ticket cannot be changed.');
 if(p.action==='client_support_update'){
  const status=p.status?choice(p.status,WORKING):t.status,to=p.assigned_to?uuid(p.assigned_to):t.assigned_to;
  let pid=t.project_id;if(p.project_id){pid=uuid(p.project_id);const pr=one(await tx`select client_id,handling_firm_id from erp_private.projects where project_id=${pid} and deleted_at is null`,'That engagement is unavailable.');if(pr.client_id!==t.client_id||pr.handling_firm_id!==t.firm_id)fail(400,'Choose an engagement of this client and firm.');}
  await tx`update erp_private.client_support_tickets set status=${status},assigned_to=${to},project_id=${pid} where ticket_id=${t.ticket_id}`;return {ok:true};
 }
 if(p.action==='client_support_cancel'){
  const reason=text(p.reason,2000);if(reason.trim().length<10)fail(400,'Say why the ticket is cancelled (at least 10 characters).');
  await tx`update erp_private.client_support_tickets set status='Cancelled',resolution=${reason.trim()} where ticket_id=${t.ticket_id}`;return {ok:true};
 }
 // client_support_close
 const resolution=text(p.resolution,2000);if(resolution.trim().length<10)fail(400,'Write what was done and the outcome (at least 10 characters).');
 const sv=one(await tx`select * from erp_private.client_support_services where service_code=${t.service_code}`);
 if(!sv.is_billable){
  await tx`update erp_private.client_support_tickets set status='Closed',resolution=${resolution.trim()} where ticket_id=${t.ticket_id}`;
  return {ok:true,invoice_id:null,billable:false};
 }
 const fee=money(p.fee_amount),pid=p.project_id?uuid(p.project_id):t.project_id;
 if(!pid)fail(400,'Choose the engagement this service is billed under.');
 const pr=one(await tx`select client_id,handling_firm_id from erp_private.projects where project_id=${pid} and deleted_at is null`,'That engagement is unavailable.');
 if(pr.client_id!==t.client_id||pr.handling_firm_id!==t.firm_id)fail(400,'Choose an engagement of this client and firm.');
 if(!(await tx`select 1 from erp_private.projects where project_id=${pid} and erp_private.finance_allowed(project_id,true)`).length)fail(403,'Closing a billable ticket creates a draft invoice, which needs billing rights on the engagement. Mark it "Work done" and ask someone with billing rights to close it.');
 const lines=invoiceLines([{description:`${sv.service_name}: ${text(t.subject,200)}`,quantity:1,unit_price:fee}]);
 const dates=(await tx`select (now() at time zone 'Africa/Nairobi')::date issued,((now() at time zone 'Africa/Nairobi')::date+14) due`)[0];
 const inv=await tx`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,external_reference,created_by)
  values(${crypto.randomUUID()},${pid},${t.client_id},${t.firm_id},${text(`${sv.service_name}: ${t.subject}`,500)},${dates.issued},${dates.due},${tx.json(lines)},${lines[0].net},${lines[0].vat},${'CST-'+t.ticket_number},${a.staff_id}) returning invoice_id`;
 await tx`update erp_private.client_support_tickets set status='Closed',resolution=${resolution.trim()},fee_amount=${fee},project_id=${pid},invoice_id=${inv[0].invoice_id} where ticket_id=${t.ticket_id}`;
 return {ok:true,invoice_id:inv[0].invoice_id,billable:true};
}
