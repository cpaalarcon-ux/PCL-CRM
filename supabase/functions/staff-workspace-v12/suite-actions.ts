import {letterPdf,letterDetails} from './letter-pdf.mjs';
import {invoicePdf,invoiceTotals} from './invoice-pdf.mjs';
import {automaticBreakMinutes,lateClockIn} from './attendance-rules.mjs';
import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {number,amount,day,range,safeUrl,rateParameters,invoiceLines,FIRM_VAT_RATE,VAT_POLICY,busySeason,weekdays,round,recurringFeePeriods,servicePeriod,serviceNarration,formatDay} from './suite-rules.mjs';
// pdf-lib is supplied by index.ts so modules loaded in tests do not need it.
let PDFLib:any=null;export function setPdfLib(lib:any){PDFLib=lib;}
const roleLabels:any={PARTNER:'Engagement Partner',MANAGER:'Manager',SUPERVISOR:'Supervisor',ASSISTANT:'Assistant',INTERN:'Intern'};
async function issuedLetter(tx:any,c:any){
 const firm=(await tx`select legal_name,physical_address,phone,email,kra_pin from erp_private.firms where firm_id=${c.firm_id}`)[0];
 const client=(await tx`select company_name from erp_private.clients where client_id=${c.client_id}`)[0],contact=c.contact_id?(await tx`select full_name,job_title from erp_private.client_contacts where contact_id=${c.contact_id}`)[0]:null;
 const signer=(await tx`select full_name,category_code from erp_private.letter_signatory(${c.communication_id})`)[0];
 if(!firm||!client||!signer)fail(400,'The letter needs its firm, client and signatory records.');
 const letterDate=String(c.communication_date instanceof Date?c.communication_date.toISOString():c.communication_date).slice(0,10),issuedAt=new Date(c.issued_at);
 const attention=contact?[contact.full_name,contact.job_title].filter(Boolean).join(', '):'';
 const qr_text=letterDetails({reference:c.reference,subject:c.subject||c.purpose,issuedBy:firm.legal_name,addressedTo:client.company_name,attention:contact?.full_name,signatory:signer.full_name,letterDate});
 if(!PDFLib)fail(500,'Letter PDF generation is not available.');
 const bytes=await letterPdf({reference:c.reference,subject:c.subject,purpose:c.purpose,details:c.details,firm,addressed_to:client.company_name,attention,letter_date_text:new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(letterDate+'T00:00:00Z')),signatory_name:signer.full_name,signatory_role:roleLabels[signer.category_code]||'',issued_at:issuedAt.toISOString(),issued_on:new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(issuedAt),qr_text},PDFLib);
 const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
 let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
 return {file_name:String(c.reference).replace(/[^A-Za-z0-9]+/g,'_')+'_letter.pdf',mime_type:'application/pdf',base64:btoa(s),sha256,qr_text};
}
export const one=(rows:any[])=>{if(!rows.length)fail(403,'This record is not available to your account.');return rows[0];};
export const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must perform this action.');};
const partner=(a:any)=>{if(a.category_code!=='PARTNER')fail(403,'Engagement Partner approval is required.');};
// The database driver returns date columns as Date objects; the date rules want YYYY-MM-DD text.
const dayOf=(v:any)=>day(v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10));
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const current=(old:any,p:any)=>{if(String(old.revision)!==revision(p.revision))fail(409,'This record changed. Refresh it before saving.');};
async function financial(tx:any,pid:string,write=false){one(await tx`select project_id from erp_private.projects where project_id=${pid} and erp_private.finance_allowed(project_id,${write})`);}
export async function nextNumber(tx:any,firm:string,kind:string,date:string){const year=Number(date.slice(0,4));const f=one(await tx`select firm_code,invoice_prefix,invoice_numbering from erp_private.firms where firm_id=${firm}`);
 // A firm numbered continuously (INV/ACL/00323) keeps one running sequence, stored under year 0; otherwise the count restarts each year.
 const continuous=kind==='INV'&&f.invoice_numbering==='continuous',seq=continuous?0:year;
 const n=one(await tx`insert into erp_private.number_sequences(firm_id,kind,year,last_value) values(${firm},${kind},${seq},1) on conflict(firm_id,kind,year) do update set last_value=number_sequences.last_value+1 returning last_value`);
 const prefix=kind==='INV'&&f.invoice_prefix?f.invoice_prefix.replace(/\/+$/,''):kind+'/'+f.firm_code;
 return continuous?`${prefix}/${String(n.last_value).padStart(5,'0')}`:`${prefix}/${year}/${String(n.last_value).padStart(5,'0')}`;
}
// Unpaid balance of the client's earlier posted invoices from the same firm: the "balance brought forward" on a new invoice.
export async function broughtForward(tx:any,i:any){
 const r=(await tx`select coalesce(sum(greatest(x.total_amount-coalesce((select sum(p.amount) from erp_private.payments p where p.invoice_id=x.invoice_id),0),0)),0) as bf
  from erp_private.invoices x where x.client_id=${i.client_id} and x.firm_id=${i.firm_id} and x.status='Posted' and x.deleted_at is null and x.invoice_id<>${i.invoice_id}`)[0];
 return round(Number(r?.bf||0));
}
export async function suiteRead(tx:any){const [r]=await tx`select jsonb_build_object(
 'leads',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.leads where deleted_at is null order by created_at desc)x),
 'rates',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.tax_rates where deleted_at is null order by effective_from desc limit 300)x),
 'tax_profiles',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.client_tax_profiles where deleted_at is null order by effective_from desc)x),
 'staff_rates',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.staff_rates order by effective_from desc limit 1000)x),
 'budgets',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.project_budgets order by effective_from desc limit 1000)x),
 'recurring_fees',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.recurring_fee_schedules order by starts_on desc limit 1000)x),
 'invoices',(select coalesce(jsonb_agg(x),'[]') from (select i.*,coalesce((select sum(p.amount) from erp_private.payments p where p.invoice_id=i.invoice_id),0) as paid_amount,(select to_jsonb(e)-'project_id'-'firm_id' from erp_private.invoice_etims e where e.invoice_id=i.invoice_id) as etims from erp_private.invoices i where deleted_at is null order by invoice_date desc limit 1000)x),
 'payments',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.payments order by payment_date desc limit 1000)x),
 'advance_movements',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.advance_movements order by movement_date desc,created_at desc limit 1000)x),
 'advances',(select coalesce(jsonb_agg(x),'[]') from (select a.*,erp_private.advance_balance(a.advance_id) as balance from erp_private.client_advances a order by a.received_date desc,a.created_at desc limit 1000)x),
 'communications',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.communications where deleted_at is null order by communication_date desc limit 500)x),
 'contacts',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.client_contacts where deleted_at is null)x),
 'compliance',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.client_compliance where deleted_at is null)x),
 'owners',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.beneficial_owners where deleted_at is null)x),
 'kyc_evidence',(select coalesce(jsonb_agg(x),'[]') from (select evidence_id,client_id,document_type,evidence_form,covered_items,document_id,document_reference,evidence_date,expires_on,physical_location,copy_type,sighted_by,sighted_at,online_source,online_reference,checked_by,checked_at,recorded_by,created_at,revision from erp_private.client_kyc_evidence where deleted_at is null)x),
 'kyc_rules',(select coalesce(jsonb_agg(x),'[]') from (select rule_code,label,accepted_forms,renewal_days,required_for_entities,rule_status from erp_private.kyc_evidence_rules where rule_status<>'Retired' order by rule_code)x),
 'legal_structure_requirements',(select coalesce(jsonb_agg(x),'[]') from (select r.structure,r.subtype,r.rule_code,r.requirement,r.note,r.sort_order from erp_private.legal_structure_requirements r order by r.structure,r.subtype,r.sort_order)x),
 'legal_structure_tax_defaults',(select coalesce(jsonb_agg(x),'[]') from (select structure,subtype,taxpayer_class,profile_entity_type,suggested_obligations,note,rule_status from erp_private.legal_structure_tax_defaults order by structure,subtype)x),
 'kyc_changes',(select coalesce(jsonb_agg(x),'[]') from (select version_id,client_id,version_number,changed_items,change_reason,recorded_by,recorded_at,status,reviewed_by,reviewed_at from erp_private.client_kyc_change_versions order by recorded_at desc limit 1000)x),
 'engagements',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.engagement_controls where deleted_at is null)x),
 'tax_cases',(select coalesce(jsonb_agg(x),'[]') from (select case_id,project_id,kind,starts_on,ends_on,status,prepared_by,reviewed_by,filing_date,revision from erp_private.tax_cases where deleted_at is null order by ends_on desc limit 500)x),
 'leave',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.leave_requests where deleted_at is null order by starts_on desc limit 500)x),
 'attendance',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.attendance where deleted_at is null order by work_date desc limit 1000)x),
 'credentials',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.staff_credentials where deleted_at is null order by expiry_date limit 1000)x),
 'reviews',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.performance_reviews order by created_at desc limit 300)x),
 'tickets',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.support_tickets where deleted_at is null order by created_at desc limit 300)x)
 ) as suite`;return r.suite;}

export async function suiteAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action==='fee_schedule_add'){
  partner(a);const pid=uuid(p.project_id);await financial(tx,pid,true);
  const project=one(await tx`select p.project_id,p.project_name,p.status,s.service_name from erp_private.projects p join erp_private.services s using(service_code) where p.project_id=${pid} and p.deleted_at is null`);
  if(project.status==='Archived')fail(400,'Create the fee schedule from an open project.');
  const frequency=choice(p.frequency,['Monthly','Quarterly','Annually']),starts=day(p.starts_on),ends=p.ends_on?day(p.ends_on):null;
  if(ends&&ends<starts)fail(400,'The end date must be on or after the start date.');
  const net=amount(p.amount_ex_vat);if(net<=0)fail(400,'Enter a recurring fee greater than zero before VAT.');
  if(p.vat_rate!==undefined&&p.vat_rate!==null&&p.vat_rate!==''&&Number(p.vat_rate)!==FIRM_VAT_RATE)fail(400,VAT_POLICY);const vat=FIRM_VAT_RATE,description=text(String(p.description||'').trim()||project.service_name,250);
  const result=await tx`insert into erp_private.recurring_fee_schedules(project_id,frequency,amount_ex_vat,vat_rate,description,starts_on,ends_on,created_by,updated_by)
   values(${pid},${frequency},${net},${vat},${description},${starts},${ends},${a.staff_id},${a.staff_id}) returning fee_schedule_id`;
  return {...one(result),description};
 }
 if(p.action==='fee_schedule_state'){
  leader(a);const schedule=one(await tx`select * from erp_private.recurring_fee_schedules where fee_schedule_id=${uuid(p.fee_schedule_id)} for update`);await financial(tx,schedule.project_id,true);current(schedule,p);
  const operation=choice(p.operation,['Pause','Resume','Cancel']);let status=schedule.status,reason=schedule.status_reason||null;
  if(schedule.status==='Cancelled'||schedule.status==='Ended')fail(400,'This recurring fee schedule has ended. Create a new schedule to restart fees.');
  if(operation==='Pause'){if(schedule.status==='Active')status='Paused';reason=text(p.reason||'Paused by authorised staff.',500);}
  if(operation==='Resume'){if(schedule.status==='Paused')status='Active';if(schedule.ends_on&&day(schedule.ends_on)<today())fail(400,'This fee schedule has passed its end date. Create a new schedule to restart fees.');reason=null;}
  if(operation==='Cancel'){reason=text(p.reason||'',1000);if(reason.length<3)fail(400,'Explain why future recurring fees are being cancelled.');status='Cancelled';}
  await tx`update erp_private.recurring_fee_schedules set status=${status},status_reason=${reason},updated_by=${a.staff_id} where fee_schedule_id=${schedule.fee_schedule_id}`;
  return {ok:true,status};
 }
 if(p.action==='fee_schedule_generate_due'){
  leader(a);const schedule=one(await tx`select * from erp_private.recurring_fee_schedules where fee_schedule_id=${uuid(p.fee_schedule_id)} for update`);await financial(tx,schedule.project_id,true);
  if(schedule.status!=='Active')fail(400,'Resume this recurring fee schedule before creating drafts.');
  const project=one(await tx`select * from erp_private.projects where project_id=${schedule.project_id} and deleted_at is null`);
  if(project.status!=='Active')fail(400,'Activate the verified project before creating recurring invoice drafts.');
  const todayDate=today(),periods=recurringFeePeriods(dayOf(schedule.starts_on),schedule.ends_on?dayOf(schedule.ends_on):null,schedule.frequency,todayDate,12);
  if(!periods.length)return {generated:0,already_created:0,more_due:false};
  const known=await tx`select recurring_period_start from erp_private.invoices where recurring_fee_schedule_id=${schedule.fee_schedule_id} and deleted_at is null`;
  const have=new Set(known.map((x:any)=>dayOf(x.recurring_period_start)));let generated=0,already=0;
  for(const period of periods){if(have.has(period.period_start)){already++;continue;}
   const lineDescription=serviceNarration(schedule.description,period.period_start,period.period_end),span=servicePeriod(period.period_start,period.period_end),monthStart=todayDate.slice(0,8)+'01',issueOn=period.period_start>=monthStart?period.period_start:todayDate,dueOn=new Date(Date.parse(issueOn+'T00:00:00Z')+14*86400000).toISOString().slice(0,10);
   const lines=invoiceLines([{description:lineDescription,quantity:1,unit_price:schedule.amount_ex_vat}]);
   const inserted=await tx`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,recurring_fee_schedule_id,recurring_period_start,service_from,service_to,service_months,created_by)
    values(${crypto.randomUUID()},${schedule.project_id},${project.client_id},${project.handling_firm_id},${lineDescription},${issueOn},${dueOn},${tx.json(lines)},${lines[0].net},${lines[0].vat},${schedule.fee_schedule_id},${period.period_start},${span.service_from},${span.service_to},${span.service_months},${a.staff_id})
    on conflict do nothing returning invoice_id`;
   if(inserted.length){generated++;have.add(period.period_start);}else already++;
  }
  const moreDue=periods.length===12&&recurringFeePeriods(dayOf(schedule.starts_on),schedule.ends_on?dayOf(schedule.ends_on):null,schedule.frequency,todayDate,13).length>12;
  return {generated,already_created:already,more_due:moreDue};
 }
 if(p.action==='staff_rate_add'){
  partner(a);const sid=uuid(p.staff_id),[from,to]=range(p.effective_from,p.effective_to);one(await tx`select staff_id from erp_private.staff_members where staff_id=${sid}`);
  await tx`select pg_advisory_xact_lock(hashtextextended(${sid+':rates'},0))`;
  if((await tx`select rate_id from erp_private.staff_rates where staff_id=${sid} and effective_from<=${to} and effective_to>=${from}`).length)fail(400,'Staff rate dates overlap.');
  await tx`insert into erp_private.staff_rates(staff_id,effective_from,effective_to,cost_rate,billable_rate,created_by) values(${sid},${from},${to},${amount(p.cost_rate)},${amount(p.billable_rate)},${a.staff_id})`;return {ok:true};
 }
 if(p.action==='budget_add'){
  const pid=uuid(p.project_id);await financial(tx,pid,true);
  await tx`insert into erp_private.project_budgets(project_id,agreed_fee,budgeted_hours,budgeted_cost,effective_from,reason,created_by) values(${pid},${amount(p.agreed_fee)},${number(p.budgeted_hours)},${amount(p.budgeted_cost)},${day(p.effective_from)},${text(p.reason,1000)},${a.staff_id})`;return {ok:true};
 }
 if(p.action==='invoice_save'){
  const pid=uuid(p.project_id),rid=uuid(p.request_id);await financial(tx,pid,true);const exists=await tx`select invoice_id from erp_private.invoices where request_id=${rid}`;if(exists.length)return exists[0];
  const project=one(await tx`select * from erp_private.projects where project_id=${pid}`),lines=invoiceLines(p.lines),[issued,due]=range(p.invoice_date,p.due_date);
  if(issued>today())fail(400,'Invoice date cannot be in the future.');
  const taskIds=[...new Set(lines.filter((l:any)=>l.task_id).map((l:any)=>l.task_id))];
  if(taskIds.length&&(await tx`select task_id from erp_private.tasks where project_id=${pid} and task_id=any(${tx.array(taskIds)}::uuid[])`).length!==taskIds.length)fail(400,'Each invoice line task must belong to the invoice project.');
  const period=servicePeriod(p.service_from||null,p.service_to||null);
  if(period.service_from&&p.confirm_not_duplicate!==true){
   const clash=await tx`select invoice_number,service_from,service_to,status from erp_private.invoices where client_id=${project.client_id} and firm_id=${project.handling_firm_id} and project_id=${pid} and status<>'Void' and deleted_at is null and service_from is not null and service_from<=${period.service_to} and service_to>=${period.service_from} limit 1`;
   if(clash.length)fail(409,`Another ${clash[0].status==='Draft'?'draft':'invoice '+clash[0].invoice_number} already covers ${formatDay(clash[0].service_from)} to ${formatDay(clash[0].service_to)} for this client and project. If this is a different charge, tick "Not a duplicate" and save again.`);
  }
  return one(await tx`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,external_reference,service_from,service_to,service_months,created_by)
   values(${rid},${pid},${project.client_id},${project.handling_firm_id},${text(p.description,500)},${issued},${due},${tx.json(lines)},${round(lines.reduce((s,l)=>s+l.net,0))},${round(lines.reduce((s,l)=>s+l.vat,0))},${text(p.external_reference||'',100,false)||null},${period.service_from},${period.service_to},${period.service_months},${a.staff_id}) returning invoice_id`);
 }
 if(p.action==='invoice_post'||p.action==='invoice_void'){
  const i=one(await tx`select * from erp_private.invoices where invoice_id=${uuid(p.invoice_id)} for update`);await financial(tx,i.project_id,true);current(i,p);
  if(p.action==='invoice_post'){if(i.status!=='Draft')fail(400,'Only draft invoices can be posted.');if(one(await tx`select status from erp_private.projects where project_id=${i.project_id}`).status!=='Active')fail(400,'Activate the verified engagement before posting its invoice.');const ref=await nextNumber(tx,i.firm_id,'INV',i.invoice_date.toISOString().slice(0,10));const bf=await broughtForward(tx,i);await tx`update erp_private.invoices set status='Posted',invoice_number=${ref},brought_forward=${bf},posted_by=${a.staff_id},posted_at=now() where invoice_id=${i.invoice_id}`;return {ok:true,invoice_number:ref,brought_forward:bf};}
  if(i.status==='Void')fail(400,'This invoice is already void.');const total=one(await tx`select coalesce(sum(amount),0) paid from erp_private.payments where invoice_id=${i.invoice_id}`);if(Number(total.paid)!==0)fail(400,'Reverse allocated payments before voiding this invoice.');
  await tx`update erp_private.invoices set status='Void',void_reason=${text(p.reason,1000)} where invoice_id=${i.invoice_id}`;return {ok:true};
 }
 if(p.action==='advance_receive'){
  const rid=uuid(p.request_id);const dup=await tx`select advance_id,receipt_number from erp_private.client_advances where request_id=${rid}`;if(dup.length)return dup[0];
  if(!(await tx`select erp_private.has_capability('FINANCE') as ok`)[0].ok)fail(403,'Only finance staff can record client advances.');
  const cid=uuid(p.client_id);let firm=p.firm_id?uuid(p.firm_id):null;const pid=p.project_id?uuid(p.project_id):null;
  if(pid){await financial(tx,pid,true);const pr=one(await tx`select client_id,handling_firm_id from erp_private.projects where project_id=${pid}`);if(pr.client_id!==cid)fail(400,'The project belongs to a different client.');if(firm&&firm!==pr.handling_firm_id)fail(400,'The project is handled by a different firm.');firm=pr.handling_firm_id;}
  if(!firm)fail(400,'Choose the firm that received the money.');
  one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm}`);
  const when=day(p.received_date);if(when>today())fail(400,'The received date cannot be in the future.');const value=amount(p.amount);if(value<=0)fail(400,'Enter the amount received.');
  const receipt=await nextNumber(tx,firm,'ADV',when);
  return one(await tx`insert into erp_private.client_advances(request_id,client_id,firm_id,project_id,receipt_number,received_date,method,reference,amount,purpose,created_by)
   values(${rid},${cid},${firm},${pid},${receipt},${when},${choice(p.method,['Cash','M-Pesa','Bank','Cheque'])},${text(p.reference,200)},${value},${text(p.purpose||'',300,false)||null},${a.staff_id}) returning advance_id,receipt_number`);
 }

 if(p.action==='advance_refund'||p.action==='advance_transfer'){
  const rid=uuid(p.request_id),dup=await tx`select movement_id,voucher_number,to_advance_id from erp_private.advance_movements where request_id=${rid}`;if(dup.length)return dup[0];
  leader(a);
  const adv=one(await tx`select * from erp_private.client_advances where advance_id=${uuid(p.advance_id)}`),when=day(p.movement_date||today());
  if(when>today())fail(400,'The date cannot be in the future.');
  const value=amount(p.amount);if(value<=0)fail(400,'Enter the amount.');
  const left=Number(one(await tx`select erp_private.advance_balance(${adv.advance_id}) as b`).b);if(value>left)fail(400,`Only KES ${left.toFixed(2)} of this advance is left.`);
  const reason=text(p.reason,500).trim();if(reason.length<10)fail(400,'Give the reason (at least 10 characters).');
  const reference=text(p.reference,200).trim();if(!reference)fail(400,'Record how the money moved (bank, M-Pesa or cheque reference, or the signed voucher).');
  if(p.action==='advance_refund'){
   const voucher=await nextNumber(tx,adv.firm_id,'RFD',when);
   return one(await tx`insert into erp_private.advance_movements(request_id,advance_id,client_id,firm_id,kind,amount,movement_date,voucher_number,method,reference,reason,created_by)
    values(${rid},${adv.advance_id},${adv.client_id},${adv.firm_id},'Refund',${value},${when},${voucher},${choice(p.method,['Cash','M-Pesa','Bank','Cheque'])},${reference},${reason},${a.staff_id}) returning movement_id,voucher_number`);
  }
  const toFirm=uuid(p.to_firm_id);if(toFirm===adv.firm_id)fail(400,'Choose a different firm from the one holding the advance.');
  if(!(await tx`select 1 from erp_private.client_firm_links where client_id=${adv.client_id} and firm_id=${toFirm}`).length)fail(400,'The client is not linked to that firm. Link the client to the firm first.');
  let toProject=null;if(p.to_project_id){toProject=uuid(p.to_project_id);await financial(tx,toProject,true);const pr=one(await tx`select client_id,handling_firm_id from erp_private.projects where project_id=${toProject}`);if(pr.client_id!==adv.client_id||pr.handling_firm_id!==toFirm)fail(400,'That project is not the client’s project in the receiving firm.');}
  const receipt=await nextNumber(tx,toFirm,'ADV',when),voucher=await nextNumber(tx,adv.firm_id,'TRF',when);
  const next=one(await tx`insert into erp_private.client_advances(request_id,client_id,firm_id,project_id,receipt_number,received_date,method,reference,amount,purpose,created_by)
   values(${crypto.randomUUID()},${adv.client_id},${toFirm},${toProject},${receipt},${when},'Transfer',${text('Transfer from '+adv.receipt_number+' · '+reference,200)},${value},${text(reason,300,false)||null},${a.staff_id}) returning advance_id,receipt_number`);
  const mv=one(await tx`insert into erp_private.advance_movements(request_id,advance_id,client_id,firm_id,kind,amount,movement_date,voucher_number,reference,reason,to_advance_id,created_by)
   values(${rid},${adv.advance_id},${adv.client_id},${adv.firm_id},'Transfer',${value},${when},${voucher},${reference},${reason},${next.advance_id},${a.staff_id}) returning movement_id,voucher_number`);
  return {...mv,to_advance_id:next.advance_id,to_receipt_number:next.receipt_number};
 }
 if(p.action==='invoice_pdf'){
  const i=one(await tx`select * from erp_private.invoices where invoice_id=${uuid(p.invoice_id)} and deleted_at is null`);await financial(tx,i.project_id,false);
  if(i.status==='Void')fail(400,'A void invoice has no PDF.');
  if(!PDFLib)fail(500,'Invoice PDF generation is not available.');
  const firm=one(await tx`select legal_name,kra_pin,phone,email,physical_address,payment_instructions from erp_private.firms where firm_id=${i.firm_id}`),client=one(await tx`select company_name,kra_pin from erp_private.clients where client_id=${i.client_id}`);
  const contact=(await tx`select full_name from erp_private.client_contacts where client_id=${i.client_id} and role_in_decision='Billing Contact' order by created_at limit 1`)[0],logoRow=(await tx`select mime_type,data_base64 from erp_private.firm_logos where firm_id=${i.firm_id}`)[0];
  const etims=(await tx`select etims_invoice_no,qr_url,etims_issued_on from erp_private.invoice_etims where invoice_id=${i.invoice_id}`)[0]||null;
  const paid=Number((await tx`select coalesce(sum(amount),0) paid from erp_private.payments where invoice_id=${i.invoice_id}`)[0].paid);
  // An issued invoice shows the balance fixed when it was posted; a draft shows today's balance as a preview.
  const bf=i.status==='Posted'&&i.brought_forward!=null?Number(i.brought_forward):await broughtForward(tx,i);
  const bytes=await invoicePdf({firm,client:{name:client.company_name,pin:client.kra_pin,attention:contact?.full_name?'Attn: '+contact.full_name:''},etims,logo:logoRow?{mime_type:logoRow.mime_type,bytes:Uint8Array.from(atob(logoRow.data_base64),c=>c.charCodeAt(0))}:null,invoice:{...i,paid_amount:paid,brought_forward:bf}},PDFLib);
  let b='';for(let k=0;k<bytes.length;k+=16384)b+=String.fromCharCode(...bytes.subarray(k,k+16384));
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'invoices','INVOICE_PDF',${i.invoice_id},${tx.json({status:i.status,invoice_number:i.invoice_number})})`;
  return {file_name:(i.invoice_number?String(i.invoice_number).replace(/[^A-Za-z0-9]+/g,'_'):'Draft_invoice_'+String(i.invoice_id).slice(0,8))+'.pdf',mime_type:'application/pdf',base64:btoa(b),totals:invoiceTotals({...i,paid_amount:paid,brought_forward:bf})};
 }
 if(p.action==='firm_logo_set'){
  partner(a);const fid=uuid(p.firm_id);one(await tx`select firm_id from erp_private.firms where firm_id=${fid} and deleted_at is null`);
  const mime=choice(p.mime_type,['image/png','image/jpeg']),b64=String(p.data_base64||'').replace(/\s+/g,'');
  if(!/^[A-Za-z0-9+/]+={0,2}$/.test(b64))fail(400,'The logo file could not be read.');
  const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));if(bytes.length>250000)fail(400,'The logo must be 250 KB or smaller.');
  const sig=mime==='image/png'?[0x89,0x50,0x4e,0x47]:[0xff,0xd8,0xff];if(!sig.every((x,k)=>bytes[k]===x))fail(400,'The file is not a real '+(mime==='image/png'?'PNG':'JPEG')+' image.');
  // A logo is replaced, never deleted: the old image stays only in the audit event's size record, and invoices always use the current one.
  await tx`insert into erp_private.firm_logos(firm_id,mime_type,data_base64,updated_by) values(${fid},${mime},${b64},${a.staff_id}) on conflict(firm_id) do update set mime_type=excluded.mime_type,data_base64=excluded.data_base64,updated_by=excluded.updated_by,updated_at=now()`;
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'firm_logos','FIRM_LOGO_SET',${fid},${tx.json({mime_type:mime,bytes:bytes.length})})`;
  return {ok:true,bytes:bytes.length};
 }
 if(p.action==='invoice_etims_record'){
  const i=one(await tx`select * from erp_private.invoices where invoice_id=${uuid(p.invoice_id)} for update`);await financial(tx,i.project_id,true);
  if(i.status!=='Posted')fail(400,'Record the eTIMS reference on a posted invoice.');
  if((await tx`select 1 from erp_private.invoice_etims where invoice_id=${i.invoice_id}`).length)fail(400,'An eTIMS reference is already recorded for this invoice. It cannot be changed; correct a mistake with a credit note in eTIMS and record that.');
  const no=text(p.etims_invoice_no,100).trim();if(!no)fail(400,'Enter the invoice number shown on eTIMS.');
  const url=text(p.qr_url||'',500,false).trim();if(url&&!/^https:\/\/\S+$/.test(url))fail(400,'The QR / verification link must start with https://.');
  const issued=day(p.etims_issued_on);if(issued>today())fail(400,'The eTIMS issue date cannot be in the future.');
  if((await tx`select 1 from erp_private.invoice_etims where firm_id=${i.firm_id} and etims_invoice_no=${no}`).length)fail(400,'That eTIMS invoice number is already recorded against another invoice of this firm.');
  return one(await tx`insert into erp_private.invoice_etims(invoice_id,project_id,firm_id,etims_invoice_no,qr_url,etims_issued_on,recorded_by) values(${i.invoice_id},${i.project_id},${i.firm_id},${no},${url||null},${issued},${a.staff_id}) returning invoice_id`);
 }
 if(p.action==='payment_add'||p.action==='payment_reverse'||p.action==='advance_apply'){
  const request=uuid(p.request_id);const exists=await tx`select payment_id from erp_private.payments where request_id=${request}`;if(exists.length)return exists[0];
  const old=p.action==='payment_reverse'?one(await tx`select * from erp_private.payments where payment_id=${uuid(p.payment_id)}`):null;
  const adv=p.action==='advance_apply'?one(await tx`select * from erp_private.client_advances where advance_id=${uuid(p.advance_id)}`):null;
  const i=one(await tx`select * from erp_private.invoices where invoice_id=${old?.invoice_id||uuid(p.invoice_id)} for update`);await financial(tx,i.project_id,true);
  if(i.status!=='Posted')fail(400,'Record payments against a posted invoice.');const when=day(p.payment_date||(adv?today():''));if(when>today()||when<i.invoice_date.toISOString().slice(0,10))fail(400,'Payment date must be on or after invoice date and not in the future.');
  const paid=Number(one(await tx`select coalesce(sum(amount),0) paid from erp_private.payments where invoice_id=${i.invoice_id}`).paid),balance=round(Number(i.total_amount)-paid);
  let left=0;
  if(adv){
   if(adv.client_id!==i.client_id||adv.firm_id!==i.firm_id)fail(400,'An advance can only be applied to an invoice issued by the firm that received it.');
   if(adv.project_id&&adv.project_id!==i.project_id)fail(400,'This advance is earmarked for another project.');
   if(when<adv.received_date.toISOString().slice(0,10))fail(400,'An advance cannot be applied before the date it was received.');
   left=Number(one(await tx`select erp_private.advance_balance(${adv.advance_id}) as b`).b);
   if(left<=0)fail(400,'This advance has no credit left.');
  }
  const value=old?-Number(old.amount):adv?((p.amount===undefined||p.amount===null||p.amount==='')?Math.min(left,balance):amount(p.amount)):amount(p.amount);
  if(old&&old.reverses_id)fail(400,'A reversal cannot be reversed. Record a new payment instead.');if(!old&&(value<=0||value>balance))fail(400,'Payment exceeds the invoice balance or is zero.');
  if(adv&&value>left)fail(400,'The advance credit is not enough for this amount.');
  if(old&&(await tx`select payment_id from erp_private.payments where reverses_id=${old.payment_id}`).length)fail(400,'This payment was already reversed.');
  const receipt=i.invoice_number+'/'+(old?'REV':'PAY')+'/'+(await nextNumber(tx,i.firm_id,'REC',when)).split('/').slice(-1)[0];
  return one(await tx`insert into erp_private.payments(request_id,invoice_id,project_id,client_id,firm_id,receipt_number,payment_date,method,reference,amount,reverses_id,reason,advance_id,created_by)
   values(${request},${i.invoice_id},${i.project_id},${i.client_id},${i.firm_id},${receipt},${when},${old?.method||(adv?'Advance':choice(p.method,['Cash','M-Pesa','Bank','Cheque']))},${old?.reference||(adv?adv.receipt_number:text(p.reference,200))},${value},${old?.payment_id||null},${old?text(p.reason,1000):null},${old?.advance_id||adv?.advance_id||null},${a.staff_id}) returning payment_id,receipt_number`);
 }
 if(p.action==='statement'){
  leader(a);const cid=uuid(p.client_id),[from,to]=range(p.starts_on,p.ends_on),combine=p.combine===true||p.combine==='true',firm=!combine&&p.firm_id?uuid(p.firm_id):null;one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
  const names=new Map((await tx`select firm_id,firm_code,legal_name from erp_private.firms`).map((f:any)=>[f.firm_id,f]));
  const invoices=await tx`select invoice_date as date,invoice_number as reference,firm_id,description,total_amount as debit,0::numeric as credit from erp_private.invoices where client_id=${cid} and status='Posted' and invoice_date<=${to} and (${firm}::uuid is null or firm_id=${firm})`,payments=await tx`select p.payment_date as date,p.receipt_number as reference,p.firm_id,p.method||' / '||p.reference as description,0::numeric as debit,p.amount as credit from erp_private.payments p join erp_private.invoices i using(invoice_id) where p.client_id=${cid} and i.status='Posted' and p.payment_date<=${to} and (${firm}::uuid is null or p.firm_id=${firm})`;
  const advances=(await tx`select a.advance_id,a.firm_id,a.project_id,a.receipt_number,a.received_date,a.method,a.reference,a.amount,a.purpose,round(a.amount-coalesce((select sum(p.amount) from erp_private.payments p where p.advance_id=a.advance_id and p.payment_date<=${to}),0)-coalesce((select sum(m.amount) from erp_private.advance_movements m where m.advance_id=a.advance_id and m.movement_date<=${to}),0),2) as balance from erp_private.client_advances a where a.client_id=${cid} and a.received_date<=${to} and (${firm}::uuid is null or a.firm_id=${firm}) order by a.received_date,a.receipt_number`).map((x:any)=>({...x,firm_code:names.get(x.firm_id)?.firm_code||''}));
  const iso=(d:any)=>d instanceof Date?d.toISOString().slice(0,10):String(d).slice(0,10);
  const all=[...invoices,...payments].map((r:any)=>({...r,firm_code:names.get(r.firm_id)?.firm_code||''})).sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date))||a.reference.localeCompare(b.reference));
  const section=(list:any[])=>{let bal=round(list.filter(r=>iso(r.date)<from).reduce((s,r)=>s+Number(r.debit)-Number(r.credit),0));const opening=bal;const rows=list.filter(r=>iso(r.date)>=from).map(r=>{bal=round(bal+Number(r.debit)-Number(r.credit));return {...r,balance:bal};});return {opening,closing:bal,rows,invoiced:round(rows.reduce((s,r)=>s+Number(r.debit),0)),paid:round(rows.reduce((s,r)=>s+Number(r.credit),0))};};
  const whole=section(all),firmIds=[...new Set([...all.map((r:any)=>r.firm_id),...advances.map((x:any)=>x.firm_id)])];
  const firms=combine?firmIds.map((id:any)=>{const f=names.get(id),sec=section(all.filter((r:any)=>r.firm_id===id)),held=round(advances.filter((x:any)=>x.firm_id===id).reduce((s:number,x:any)=>s+Number(x.balance),0));return {firm_id:id,firm_code:f?.firm_code||'',legal_name:f?.legal_name||'',opening:sec.opening,invoiced:sec.invoiced,paid:sec.paid,closing:sec.closing,advances_held:held,net_after_advances:round(sec.closing-held)};}).sort((x:any,y:any)=>x.firm_code.localeCompare(y.firm_code)):[];
  const advancesHeld=round(advances.reduce((s:number,x:any)=>s+Number(x.balance),0));
  return {opening:whole.opening,closing:whole.closing,rows:whole.rows,currency:'KES',combined:combine,firms,advances,advances_held:advancesHeld,net_after_advances:round(whole.closing-advancesHeld)};
 }
 if(p.action==='wip_report'){
  leader(a);return {rows:await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,b.agreed_fee,b.budgeted_hours,b.budgeted_cost,
   coalesce(t.hours,0) actual_hours,case when coalesce(t.missing_rates,0)=0 then coalesce(t.cost,0) end actual_cost,coalesce(t.missing_rates,0) missing_rates,coalesce(i.billed,0) total_billed,coalesce(pay.paid,0) total_paid,coalesce(adv.held,0) advance_held
   from erp_private.projects p left join lateral (select * from erp_private.project_budgets b where b.project_id=p.project_id and effective_from<=current_date order by effective_from desc limit 1)b on true
   left join lateral (select sum(t.hours) hours,sum(t.hours*r.cost_rate) cost,count(*) filter(where r.rate_id is null) missing_rates from erp_private.timesheets t left join erp_private.staff_rates r on r.staff_id=t.staff_id and t.work_date between r.effective_from and r.effective_to where t.project_id=p.project_id and t.status='Approved')t on true
   left join lateral(select sum(net_amount) billed from erp_private.invoices i where i.project_id=p.project_id and i.status='Posted')i on true
   left join lateral(select sum(amount) paid from erp_private.payments x where x.project_id=p.project_id)pay on true
   left join lateral(select sum(erp_private.advance_balance(a.advance_id)) held from erp_private.client_advances a where a.project_id=p.project_id)adv on true where erp_private.finance_allowed(p.project_id) order by p.project_name`};
 }
 if(p.action==='billing_by_task'){
  const pid=uuid(p.project_id);await financial(tx,pid);
  const linked=await tx`select t.task_id,t.task_name,round(sum((l->>'net')::numeric),2) billed,count(*)::int line_count from erp_private.invoices i cross join lateral jsonb_array_elements(i.lines) l join erp_private.tasks t on t.task_id=(l->>'task_id')::uuid and t.project_id=i.project_id where i.project_id=${pid} and i.status='Posted' and l->>'task_id' is not null group by t.task_id,t.task_name order by t.task_name`;
  const other=one(await tx`select coalesce(round(sum((l->>'net')::numeric),2),0) billed from erp_private.invoices i cross join lateral jsonb_array_elements(i.lines) l where i.project_id=${pid} and i.status='Posted' and l->>'task_id' is null`);
  return {rows:linked,not_linked:Number(other.billed)};
 }
 if(p.action==='communication_resolve'){
  const c=one(await tx`select * from erp_private.communications where opaque_reference=${uuid(p.opaque_reference)} and deleted_at is null`);
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'communications','QR_ACCESS',${c.communication_id},'{}')`;
  return {communication:c};
 }
 if(p.action==='communication_qr'){
  const c=one(await tx`select communication_id,opaque_reference,reference,channel from erp_private.communications where communication_id=${uuid(p.communication_id)} and deleted_at is null`);
  if(c.channel!=='Letter')fail(400,'Staff QR codes are available for letters only.');
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'communications','QR_GENERATE',${c.communication_id},'{}')`;
  return c;
 }
 if(p.action==='communication_issue'||p.action==='communication_letter_pdf'){
  const c=one(await tx`select * from erp_private.communications where communication_id=${uuid(p.communication_id)} and deleted_at is null for update`);
  if(c.channel!=='Letter')fail(400,'Only letters are issued on the letterhead.');
  if(p.action==='communication_issue'){
   current(c,p);if(c.issued_at)fail(409,'This letter is already issued. Download the issued PDF.');
   if(a.staff_id!==c.signatory_id&&a.category_code!=='PARTNER')fail(403,'Only the named signatory or an Engagement Partner can issue this letter.');
   if(!String(c.details||'').trim()||!String(c.subject||'').trim())fail(400,'Complete the subject and letter body before issuing.');
   const issuedAt=(await tx`select date_trunc('second',now()) t`)[0].t,file=await issuedLetter(tx,{...c,issued_at:issuedAt});
   await tx`update erp_private.communications set issued_at=${issuedAt},issued_by=${a.staff_id},issued_sha256=${file.sha256},status=case when status='Open' then 'Waiting' else status end where communication_id=${c.communication_id}`;
   await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'communications','LETTER_ISSUED',${c.communication_id},${tx.json({reference:c.reference,sha256:file.sha256})})`;
   return file;
  }
  if(!c.issued_at)fail(400,'Issue the letter before downloading the letterhead PDF.');
  const file=await issuedLetter(tx,c);if(file.sha256!==c.issued_sha256)fail(409,'The issued letter could not be reproduced exactly. Do not send a new copy; ask the Engagement Partner to review the record history.');
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'communications','LETTER_DOWNLOADED',${c.communication_id},${tx.json({sha256:file.sha256})})`;
  return file;
 }
 if(p.action==='communication_save'){
  const cid=uuid(p.client_id),firm=uuid(p.firm_id),pid=p.project_id?uuid(p.project_id):null;one(await tx`select client_id from erp_private.clients where client_id=${cid}`);one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm}`);
  if(pid)one(await tx`select project_id from erp_private.projects where project_id=${pid} and client_id=${cid} and handling_firm_id=${firm}`);
  const contact=p.contact_id?uuid(p.contact_id):null;if(contact)one(await tx`select contact_id from erp_private.client_contacts where contact_id=${contact} and client_id=${cid}`);
  const signatory=uuid(p.signatory_id);if(signatory!==a.staff_id)one(await tx`select staff_id from erp_private.assignment_candidates() where staff_id=${signatory} and firm_id=${firm}`);
  const when=day(p.communication_date);if(when>today()&&p.channel!=='Meeting')fail(400,'Use today or a past date for a recorded communication.');
  const vals={subject:text(p.subject,200),purpose:text(p.purpose,1000),details:text(p.details,8000),channel:choice(p.channel,['Letter','Email','Call','Meeting','Visit','Internal note']),followup:date(p.followup_date),link:safeUrl(p.meeting_link,true),status:choice(p.status||'Open',['Open','Waiting','Closed'])};
  if(vals.channel!=='Internal note'){const [g]=await tx`select erp_private.comm_external_allowed(${cid}::uuid) ok`;if(!g.ok)fail(403,'External client communications are locked for you on this client. You can record an internal note instead, or ask a Supervisor, Manager or Partner.');}
  if(p.communication_id){const old=one(await tx`select * from erp_private.communications where communication_id=${uuid(p.communication_id)} for update`);current(old,p);if(old.issued_at)fail(409,'This letter has been issued and is locked. Record a new letter for any change.');if(old.client_id!==cid||old.firm_id!==firm||old.project_id!==pid)fail(400,'Create another communication to change its client or firm.');
   await tx`update erp_private.communications set subject=${vals.subject},purpose=${vals.purpose},details=${vals.details},channel=${vals.channel},communication_date=${when},followup_date=${vals.followup},meeting_link=${vals.link},status=${vals.status},signatory_id=${signatory},contact_id=${contact} where communication_id=${old.communication_id}`;return {ok:true};}
  const rid=uuid(p.request_id),exists=await tx`select communication_id from erp_private.communications where request_id=${rid}`;if(exists.length)return exists[0];
  const ref=await nextNumber(tx,firm,'COM',when);return one(await tx`insert into erp_private.communications(request_id,reference,client_id,firm_id,project_id,contact_id,channel,subject,purpose,details,communication_date,followup_date,meeting_link,signatory_id,owner_id,status)
   values(${rid},${ref},${cid},${firm},${pid},${contact},${vals.channel},${vals.subject},${vals.purpose},${vals.details},${when},${vals.followup},${vals.link},${signatory},${a.staff_id},${vals.status}) returning communication_id,reference`);
 }
 if(p.action==='contact_save'){
  leader(a);const cid=uuid(p.client_id),email=text(p.email_address||'',200,false),role=p.role_in_decision?choice(p.role_in_decision,['Decision Maker','Influencer','Billing Contact','Day-to-Day Contact']):null;if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Check the contact email.');
  if(p.contact_id)one(await tx`update erp_private.client_contacts set full_name=${text(p.full_name,160)},email_address=${email},phone_number=${text(p.phone_number||'',40,false)},job_title=${text(p.job_title||'',100,false)},role_in_decision=${role} where contact_id=${uuid(p.contact_id)} and client_id=${cid} and revision=${revision(p.revision)} returning contact_id`);
  else await tx`insert into erp_private.client_contacts(client_id,full_name,email_address,phone_number,job_title,role_in_decision) values(${cid},${text(p.full_name,160)},${email},${text(p.phone_number||'',40,false)},${text(p.job_title||'',100,false)},${role})`;return {ok:true};
 }
 if(p.action==='firm_details'){
  partner(a);if(typeof p.vat_registered!=='boolean')fail(400,'Confirm whether this firm is VAT registered.');const pin=text(p.kra_pin||'',11,false);if(pin&&!/^[A-Z][0-9]{9}[A-Z]$/.test(pin))fail(400,'Check the firm KRA PIN.');const prefix=text(p.invoice_prefix||'',40,false);if(prefix&&!/^[A-Z0-9/-]+$/.test(prefix))fail(400,'Use a prefix such as INV/PCL.');
  one(await tx`update erp_private.firms set vat_registered=${p.vat_registered===true},payment_instructions=${text(p.payment_instructions||'',2000,false)},legal_name=${text(p.legal_name,200)},kra_pin=${pin||null},email=${text(p.email||'',200,false)},phone=${text(p.phone||'',40,false)},physical_address=${text(p.physical_address||'',500,false)},invoice_prefix=${prefix||null},invoice_numbering=${choice(p.invoice_numbering||'yearly',['yearly','continuous'])} where firm_id=${uuid(p.firm_id)} returning firm_id`);
  // Continue from the old system: the last number already used (for example 322) so the next invoice is 323. It can only be raised.
  if(p.invoice_last_number!==undefined&&p.invoice_last_number!==''&&p.invoice_last_number!==null){const last=Math.trunc(number(p.invoice_last_number,0,99999999));if(last>0){if(String(p.invoice_numbering)!=='continuous')fail(400,'Set the numbering to continuous to start from a given number.');await tx`insert into erp_private.number_sequences(firm_id,kind,year,last_value) values(${uuid(p.firm_id)},'INV',0,${last}) on conflict(firm_id,kind,year) do update set last_value=greatest(number_sequences.last_value,excluded.last_value)`;}}
  return {ok:true};
 }
 if(p.action==='leave_request'){
  const [from,to]=range(p.starts_on,p.ends_on),days=weekdays(from,to);if(!days.length)fail(400,'The request contains no working days.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':attendance'},0))`;
  if((await tx`select leave_id from erp_private.leave_requests where staff_id=${a.staff_id} and status in ('Pending','Approved') and starts_on<=${to} and ends_on>=${from}`).length)fail(400,'A leave request already overlaps these dates.');
  return one(await tx`insert into erp_private.leave_requests(staff_id,leave_type,starts_on,ends_on,working_days,reason,busy_season) values(${a.staff_id},${choice(p.leave_type,['Annual','Sick','Study','Maternity / Paternity'])},${from},${to},${days.length},${text(p.reason,1000)},${busySeason(from,to)}) returning leave_id`);
 }
 if(p.action==='leave_review'){
  leader(a);const l=one(await tx`select * from erp_private.leave_requests where leave_id=${uuid(p.leave_id)} for update`);current(l,p);if(l.staff_id===a.staff_id)fail(403,'Another authorised reviewer must review your leave.');if(l.status!=='Pending')fail(400,'Only pending requests can be reviewed.');if(l.busy_season)partner(a);
  const status=choice(p.status,['Approved','Rejected']),note=text(p.review_note,1000);if(note.length<10)fail(400,'Record a review note of at least 10 characters.');await tx`select pg_advisory_xact_lock(hashtextextended(${l.staff_id+':attendance'},0))`;
  if(status==='Approved'){
   if((await tx`select attendance_id from erp_private.attendance where staff_id=${l.staff_id} and work_date between ${l.starts_on} and ${l.ends_on}`).length)fail(400,'Attendance already exists for these dates. Review it before approving leave.');
   const assignments=await tx`select project_id from erp_private.project_assignments where staff_id=${l.staff_id} and deleted_at is null and start_date<=${l.ends_on} and end_date>=${l.starts_on}`;
   if(assignments.length&&!p.capacity_acknowledged)fail(400,'This leave overlaps scheduled fieldwork. Confirm that cover has been arranged.');
   for(const d of weekdays(l.starts_on.toISOString().slice(0,10),l.ends_on.toISOString().slice(0,10)))await tx`insert into erp_private.attendance(staff_id,work_date,location,status,leave_id,reason,reviewed_by) values(${l.staff_id},${d},'Leave','On leave',${l.leave_id},${l.leave_type},${a.staff_id})`;
  }
  await tx`update erp_private.leave_requests set status=${status},reviewed_by=${a.staff_id},review_note=${note} where leave_id=${l.leave_id}`;return {ok:true};
 }
 if(p.action==='clock'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':attendance'},0))`;const when=today(),old=(await tx`select * from erp_private.attendance where staff_id=${a.staff_id} and work_date=${when} for update`)[0];
  if(p.operation==='in'){
   if(old)fail(400,'Attendance or approved leave already exists for today.');const late=lateClockIn();
   const added=one(await tx`insert into erp_private.attendance(staff_id,work_date,clock_in,location,status,reason) values(${a.staff_id},${when},now(),${choice(p.location,['Nairobi office','Bungoma office','Kisii office','Client site','Remote'])},${late?'Late':'Present'},${text(p.reason||'',1000,late)}) returning attendance_id,clock_in,clock_out,break_minutes`);
   await tx`update erp_private.staff_presence set manual_status='Auto',break_started_at=null where staff_id=${a.staff_id}`;return added;
  }
  if(p.operation!=='out'||!old||!old.clock_in||old.clock_out||old.status==='On leave')fail(400,'No open clock-in exists for today.');const presence=(await tx`select break_started_at from erp_private.staff_presence where staff_id=${a.staff_id}`)[0],breaks=automaticBreakMinutes(old,presence);
  await tx`update erp_private.attendance set clock_out=now(),break_minutes=${breaks} where attendance_id=${old.attendance_id}`;
  await tx`update erp_private.staff_presence set manual_status='Auto',break_started_at=null where staff_id=${a.staff_id}`;return {ok:true};
 }
 if(p.action==='attendance_correct'){
  leader(a);const t=one(await tx`select * from erp_private.attendance where attendance_id=${uuid(p.attendance_id)} for update`);current(t,p);if(t.staff_id===a.staff_id)fail(403,'Another Manager must approve your correction.');if(t.status==='On leave')fail(400,'Leave records cannot be changed to working attendance.');
  const out=new Date(p.clock_out);if(!Number.isFinite(out.getTime())||out>new Date()||out<new Date(t.clock_in)||out.getTime()-new Date(t.clock_in).getTime()>24*3600000)fail(400,'Choose a valid clock-out within 24 hours of clock-in.');
  await tx`update erp_private.attendance set clock_out=${out},reason=${text(p.reason,1000)},reviewed_by=${a.staff_id},review_required=false where attendance_id=${t.attendance_id}`;return {ok:true};
 }
 if(p.action==='credential_add'){
  return one(await tx`insert into erp_private.staff_credentials(staff_id,credential_type,description,status,issue_date,expiry_date,cpd_hours,evidence_reference) values(${a.staff_id},${choice(p.credential_type,['CPA paper','ICPAK membership','CPD','Degree','Induction'])},${text(p.description,500)},${choice(p.status,['In progress','Passed','Expired'])},${day(p.issue_date)},${date(p.expiry_date)},${number(p.cpd_hours||0,0,1000)},${text(p.evidence_reference,1000)}) returning credential_id`);
 }
 if(p.action==='credential_verify'){
  leader(a);const c=one(await tx`select * from erp_private.staff_credentials where credential_id=${uuid(p.credential_id)}`);if(c.staff_id===a.staff_id)fail(403,'Another reviewer must verify your credential.');current(c,p);
  await tx`update erp_private.staff_credentials set verified_by=${a.staff_id} where credential_id=${c.credential_id}`;return {ok:true};
 }
 if(p.action==='roster_save'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A project reviewer must schedule fieldwork.');const pid=uuid(p.project_id),sid=uuid(p.staff_id),[from,to]=range(p.starts_on,p.ends_on),allocation=number(p.allocation_percentage,1,100);
  one(await tx`select project_id from erp_private.project_assignments where project_id=${pid} and staff_id=${sid} and deleted_at is null`);
  await tx`select pg_advisory_xact_lock(hashtextextended(${sid+':roster'},0))`;
  if((await tx`select leave_id from erp_private.leave_requests where staff_id=${sid} and status='Approved' and starts_on<=${to} and ends_on>=${from}`).length)fail(400,'The staff member has approved leave in this period.');
  const rows=await tx`select start_date,end_date,allocation_percentage from erp_private.project_assignments where staff_id=${sid} and project_id<>${pid} and deleted_at is null and start_date<=${to} and end_date>=${from}`;
  for(const day0 of weekdays(from,to))if(allocation+rows.filter((r:any)=>r.start_date.toISOString().slice(0,10)<=day0&&r.end_date.toISOString().slice(0,10)>=day0).reduce((s:number,r:any)=>s+Number(r.allocation_percentage),0)>100)fail(400,'Allocation exceeds 100% on an overlapping working day.');
  await tx`update erp_private.project_assignments set start_date=${from},end_date=${to},allocation_percentage=${allocation} where project_id=${pid} and staff_id=${sid}`;return {ok:true};
 }
 if(p.action==='performance_add'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A project reviewer must give engagement feedback.');const pid=uuid(p.project_id),sid=uuid(p.staff_id);one(await tx`select project_id from erp_private.project_assignments where project_id=${pid} and staff_id=${sid}`);
  await tx`insert into erp_private.performance_reviews(project_id,staff_id,technical_score,punctuality_score,workpaper_score,comments,reviewed_by) values(${pid},${sid},${number(p.technical_score,1,5)},${number(p.punctuality_score,1,5)},${number(p.workpaper_score,1,5)},${text(p.comments,2000)},${a.staff_id})`;return {ok:true};
 }
 if(p.action==='ticket_add'){
  const pid=p.project_id?uuid(p.project_id):null;if(pid)one(await tx`select project_id from erp_private.projects where project_id=${pid}`);const sid=uuid(p.assigned_to);one(await tx`select staff_id from erp_private.assignment_candidates() where staff_id=${sid} and category_code in ('PARTNER','MANAGER','SUPERVISOR')`);
  const priority=choice(p.priority,['Low','Medium','High','Critical']),hours=({Low:48,Medium:24,High:4,Critical:1} as any)[priority];
  return one(await tx`insert into erp_private.support_tickets(requester_id,assigned_to,project_id,subject,description,category,priority,sla_due_at) values(${a.staff_id},${sid},${pid},${text(p.subject,200)},${text(p.description,4000)},${choice(p.category,['IT','Audit software','Tax','Billing','Client documents','Attendance'])},${priority},now()+${hours}*interval '1 hour') returning ticket_id,ticket_number`);
 }
 if(p.action==='ticket_read')return {ticket:one(await tx`select * from erp_private.support_tickets where ticket_id=${uuid(p.ticket_id)}`),replies:await tx`select * from erp_private.ticket_replies where ticket_id=${uuid(p.ticket_id)} order by created_at`};
 if(p.action==='ticket_reply'){
  const t=one(await tx`select * from erp_private.support_tickets where ticket_id=${uuid(p.ticket_id)} for update`);current(t,p);const status=choice(p.status,['Open','In progress','Pending requester','Resolved','Closed']);
  if(![t.assigned_to].includes(a.staff_id)&&a.category_code!=='PARTNER'&&!['Open','Closed'].includes(status))fail(403,'Only the assigned support reviewer can change this status.');
  await tx`insert into erp_private.ticket_replies(ticket_id,staff_id,message) values(${t.ticket_id},${a.staff_id},${text(p.message,4000)})`;
  await tx`update erp_private.support_tickets set status=${status},first_response_at=case when ${a.staff_id}<>requester_id then coalesce(first_response_at,now()) else first_response_at end,resolved_at=case when ${status} in ('Resolved','Closed') then coalesce(resolved_at,now()) else null end where ticket_id=${t.ticket_id}`;return {ok:true};
 }
 return undefined;
}
