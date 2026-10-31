import {automaticBreakMinutes,lateClockIn} from './attendance-rules.mjs';
import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {number,amount,day,range,safeUrl,rateParameters,invoiceLines,busySeason,weekdays,round,recurringFeePeriods} from './suite-rules.mjs';
export const one=(rows:any[])=>{if(!rows.length)fail(403,'This record is not available to your account.');return rows[0];};
export const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must perform this action.');};
const partner=(a:any)=>{if(a.category_code!=='PARTNER')fail(403,'Engagement Partner approval is required.');};
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const current=(old:any,p:any)=>{if(String(old.revision)!==revision(p.revision))fail(409,'This record changed. Refresh it before saving.');};
async function financial(tx:any,pid:string,write=false){one(await tx`select project_id from erp_private.projects where project_id=${pid} and erp_private.finance_allowed(project_id,${write})`);}
export async function nextNumber(tx:any,firm:string,kind:string,date:string){const year=Number(date.slice(0,4));const f=one(await tx`select firm_code,invoice_prefix from erp_private.firms where firm_id=${firm}`);
 const n=one(await tx`insert into erp_private.number_sequences(firm_id,kind,year,last_value) values(${firm},${kind},${year},1) on conflict(firm_id,kind,year) do update set last_value=number_sequences.last_value+1 returning last_value`);
 return `${kind==='INV'&&f.invoice_prefix?f.invoice_prefix.replace(/\/+$/,''):kind+'/'+f.firm_code}/${year}/${String(n.last_value).padStart(5,'0')}`;
}
export async function suiteRead(tx:any){const [r]=await tx`select jsonb_build_object(
 'leads',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.leads where deleted_at is null order by created_at desc)x),
 'rates',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.tax_rates where deleted_at is null order by effective_from desc limit 300)x),
 'tax_profiles',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.client_tax_profiles where deleted_at is null order by effective_from desc)x),
 'staff_rates',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.staff_rates order by effective_from desc limit 1000)x),
 'budgets',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.project_budgets order by effective_from desc limit 1000)x),
 'recurring_fees',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.recurring_fee_schedules order by starts_on desc limit 1000)x),
 'invoices',(select coalesce(jsonb_agg(x),'[]') from (select i.*,coalesce((select sum(p.amount) from erp_private.payments p where p.invoice_id=i.invoice_id),0) as paid_amount from erp_private.invoices i where deleted_at is null order by invoice_date desc limit 1000)x),
 'payments',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.payments order by payment_date desc limit 1000)x),
 'communications',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.communications where deleted_at is null order by communication_date desc limit 500)x),
 'contacts',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.client_contacts where deleted_at is null)x),
 'compliance',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.client_compliance where deleted_at is null)x),
 'owners',(select coalesce(jsonb_agg(x),'[]') from (select * from erp_private.beneficial_owners where deleted_at is null)x),
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
  const vat=Number(choice(String(p.vat_rate??''),['0','8','16'])),description=text(`${project.service_name} · ${project.project_name}`,300);
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
  const todayDate=today(),periods=recurringFeePeriods(day(schedule.starts_on),schedule.ends_on?day(schedule.ends_on):null,schedule.frequency,todayDate,12);
  if(!periods.length)return {generated:0,already_created:0,more_due:false};
  const known=await tx`select recurring_period_start from erp_private.invoices where recurring_fee_schedule_id=${schedule.fee_schedule_id} and deleted_at is null`;
  const have=new Set(known.map((x:any)=>day(x.recurring_period_start))),dueDate=new Date(Date.parse(todayDate+'T00:00:00Z')+14*86400000).toISOString().slice(0,10);let generated=0,already=0;
  for(const period of periods){if(have.has(period.period_start)){already++;continue;}
   const periodLabel=`${period.period_start} to ${period.period_end}`,lineDescription=`${schedule.description} · ${periodLabel}`;
   const lines=invoiceLines([{description:lineDescription,quantity:1,unit_price:schedule.amount_ex_vat,vat_rate:schedule.vat_rate}]);
   const inserted=await tx`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,recurring_fee_schedule_id,recurring_period_start,created_by)
    values(${crypto.randomUUID()},${schedule.project_id},${project.client_id},${project.handling_firm_id},${lineDescription},${todayDate},${dueDate},${tx.json(lines)},${lines[0].net},${lines[0].vat},${schedule.fee_schedule_id},${period.period_start},${a.staff_id})
    on conflict do nothing returning invoice_id`;
   if(inserted.length){generated++;have.add(period.period_start);}else already++;
  }
  const moreDue=periods.length===12&&recurringFeePeriods(day(schedule.starts_on),schedule.ends_on?day(schedule.ends_on):null,schedule.frequency,todayDate,13).length>12;
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
  return one(await tx`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,external_reference,created_by)
   values(${rid},${pid},${project.client_id},${project.handling_firm_id},${text(p.description,500)},${issued},${due},${tx.json(lines)},${round(lines.reduce((s,l)=>s+l.net,0))},${round(lines.reduce((s,l)=>s+l.vat,0))},${text(p.external_reference||'',100,false)||null},${a.staff_id}) returning invoice_id`);
 }
 if(p.action==='invoice_post'||p.action==='invoice_void'){
  const i=one(await tx`select * from erp_private.invoices where invoice_id=${uuid(p.invoice_id)} for update`);await financial(tx,i.project_id,true);current(i,p);
  if(p.action==='invoice_post'){if(i.status!=='Draft')fail(400,'Only draft invoices can be posted.');if(one(await tx`select status from erp_private.projects where project_id=${i.project_id}`).status!=='Active')fail(400,'Activate the verified engagement before posting its invoice.');const ref=await nextNumber(tx,i.firm_id,'INV',i.invoice_date.toISOString().slice(0,10));await tx`update erp_private.invoices set status='Posted',invoice_number=${ref},posted_by=${a.staff_id},posted_at=now() where invoice_id=${i.invoice_id}`;return {ok:true,invoice_number:ref};}
  if(i.status==='Void')fail(400,'This invoice is already void.');const total=one(await tx`select coalesce(sum(amount),0) paid from erp_private.payments where invoice_id=${i.invoice_id}`);if(Number(total.paid)!==0)fail(400,'Reverse allocated payments before voiding this invoice.');
  await tx`update erp_private.invoices set status='Void',void_reason=${text(p.reason,1000)} where invoice_id=${i.invoice_id}`;return {ok:true};
 }
 if(p.action==='payment_add'||p.action==='payment_reverse'){
  const request=uuid(p.request_id);const exists=await tx`select payment_id from erp_private.payments where request_id=${request}`;if(exists.length)return exists[0];
  const old=p.action==='payment_reverse'?one(await tx`select * from erp_private.payments where payment_id=${uuid(p.payment_id)}`):null;
  const i=one(await tx`select * from erp_private.invoices where invoice_id=${old?.invoice_id||uuid(p.invoice_id)} for update`);await financial(tx,i.project_id,true);
  if(i.status!=='Posted')fail(400,'Record payments against a posted invoice.');const when=day(p.payment_date);if(when>today()||when<i.invoice_date.toISOString().slice(0,10))fail(400,'Payment date must be on or after invoice date and not in the future.');
  const value=old?-Number(old.amount):amount(p.amount),paid=Number(one(await tx`select coalesce(sum(amount),0) paid from erp_private.payments where invoice_id=${i.invoice_id}`).paid);
  if(old&&old.reverses_id)fail(400,'A reversal cannot be reversed. Record a new payment instead.');if(!old&&(value<=0||value>round(Number(i.total_amount)-paid)))fail(400,'Payment exceeds the invoice balance or is zero.');
  if(old&&(await tx`select payment_id from erp_private.payments where reverses_id=${old.payment_id}`).length)fail(400,'This payment was already reversed.');
  const receipt=i.invoice_number+'/'+(old?'REV':'PAY')+'/'+(await nextNumber(tx,i.firm_id,'REC',when)).split('/').slice(-1)[0];
  return one(await tx`insert into erp_private.payments(request_id,invoice_id,project_id,client_id,firm_id,receipt_number,payment_date,method,reference,amount,reverses_id,reason,created_by)
   values(${request},${i.invoice_id},${i.project_id},${i.client_id},${i.firm_id},${receipt},${when},${old?.method||choice(p.method,['Cash','M-Pesa','Bank','Cheque'])},${old?.reference||text(p.reference,200)},${value},${old?.payment_id||null},${old?text(p.reason,1000):null},${a.staff_id}) returning payment_id,receipt_number`);
 }
 if(p.action==='statement'){
  leader(a);const cid=uuid(p.client_id),[from,to]=range(p.starts_on,p.ends_on),firm=p.firm_id?uuid(p.firm_id):null;one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
  const invoices=await tx`select invoice_date as date,invoice_number as reference,firm_id,description,total_amount as debit,0::numeric as credit from erp_private.invoices where client_id=${cid} and status='Posted' and invoice_date<=${to} and (${firm}::uuid is null or firm_id=${firm})`,payments=await tx`select p.payment_date as date,p.receipt_number as reference,p.firm_id,p.method||' / '||p.reference as description,0::numeric as debit,p.amount as credit from erp_private.payments p join erp_private.invoices i using(invoice_id) where p.client_id=${cid} and i.status='Posted' and p.payment_date<=${to} and (${firm}::uuid is null or p.firm_id=${firm})`;
  const all=[...invoices,...payments].sort((a,b)=>String(a.date).localeCompare(String(b.date))||a.reference.localeCompare(b.reference));let balance=round(all.filter(r=>r.date.toISOString().slice(0,10)<from).reduce((s,r)=>s+Number(r.debit)-Number(r.credit),0));const opening=balance;
  const rows=all.filter(r=>r.date.toISOString().slice(0,10)>=from).map(r=>{balance=round(balance+Number(r.debit)-Number(r.credit));return {...r,balance};});return {opening,closing:balance,rows,currency:'KES'};
 }
 if(p.action==='wip_report'){
  leader(a);return {rows:await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,b.agreed_fee,b.budgeted_hours,b.budgeted_cost,
   coalesce(t.hours,0) actual_hours,case when coalesce(t.missing_rates,0)=0 then coalesce(t.cost,0) end actual_cost,coalesce(t.missing_rates,0) missing_rates,coalesce(i.billed,0) total_billed,coalesce(pay.paid,0) total_paid
   from erp_private.projects p left join lateral (select * from erp_private.project_budgets b where b.project_id=p.project_id and effective_from<=current_date order by effective_from desc limit 1)b on true
   left join lateral (select sum(t.hours) hours,sum(t.hours*r.cost_rate) cost,count(*) filter(where r.rate_id is null) missing_rates from erp_private.timesheets t left join erp_private.staff_rates r on r.staff_id=t.staff_id and t.work_date between r.effective_from and r.effective_to where t.project_id=p.project_id and t.status='Approved')t on true
   left join lateral(select sum(net_amount) billed from erp_private.invoices i where i.project_id=p.project_id and i.status='Posted')i on true
   left join lateral(select sum(amount) paid from erp_private.payments x where x.project_id=p.project_id)pay on true where erp_private.finance_allowed(p.project_id) order by p.project_name`};
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
 if(p.action==='communication_save'){
  const cid=uuid(p.client_id),firm=uuid(p.firm_id),pid=p.project_id?uuid(p.project_id):null;one(await tx`select client_id from erp_private.clients where client_id=${cid}`);one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm}`);
  if(pid)one(await tx`select project_id from erp_private.projects where project_id=${pid} and client_id=${cid} and handling_firm_id=${firm}`);
  const contact=p.contact_id?uuid(p.contact_id):null;if(contact)one(await tx`select contact_id from erp_private.client_contacts where contact_id=${contact} and client_id=${cid}`);
  const signatory=uuid(p.signatory_id);if(signatory!==a.staff_id)one(await tx`select staff_id from erp_private.assignment_candidates() where staff_id=${signatory} and firm_id=${firm}`);
  const when=day(p.communication_date);if(when>today()&&p.channel!=='Meeting')fail(400,'Use today or a past date for a recorded communication.');
  const vals={subject:text(p.subject,200),purpose:text(p.purpose,1000),details:text(p.details,8000),channel:choice(p.channel,['Letter','Email','Call','Meeting','Visit','Internal note']),followup:date(p.followup_date),link:safeUrl(p.meeting_link,true),status:choice(p.status||'Open',['Open','Waiting','Closed'])};
  if(p.communication_id){const old=one(await tx`select * from erp_private.communications where communication_id=${uuid(p.communication_id)} for update`);current(old,p);if(old.client_id!==cid||old.firm_id!==firm||old.project_id!==pid)fail(400,'Create another communication to change its client or firm.');
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
  one(await tx`update erp_private.firms set vat_registered=${p.vat_registered===true},payment_instructions=${text(p.payment_instructions||'',2000,false)},legal_name=${text(p.legal_name,200)},kra_pin=${pin||null},email=${text(p.email||'',200,false)},phone=${text(p.phone||'',40,false)},physical_address=${text(p.physical_address||'',500,false)},invoice_prefix=${prefix||null} where firm_id=${uuid(p.firm_id)} returning firm_id`);return {ok:true};
 }
 if(p.action==='leave_request'){
  const [from,to]=range(p.starts_on,p.ends_on),days=weekdays(from,to);if(!days.length)fail(400,'The request contains no working days.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':attendance'},0))`;
  if((await tx`select leave_id from erp_private.leave_requests where staff_id=${a.staff_id} and status in ('Pending','Approved') and starts_on<=${to} and ends_on>=${from}`).length)fail(400,'A leave request already overlaps these dates.');
  return one(await tx`insert into erp_private.leave_requests(staff_id,leave_type,starts_on,ends_on,working_days,reason,busy_season) values(${a.staff_id},${choice(p.leave_type,['Annual','Sick','Study','Maternity / Paternity'])},${from},${to},${days.length},${text(p.reason,1000)},${busySeason(from,to)}) returning leave_id`);
 }
 if(p.action==='leave_review'){
  leader(a);const l=one(await tx`select * from erp_private.leave_requests where leave_id=${uuid(p.leave_id)} for update`);current(l,p);if(l.staff_id===a.staff_id)fail(403,'Another authorised reviewer must review your leave.');if(l.status!=='Pending')fail(400,'Only pending requests can be reviewed.');if(l.busy_season)partner(a);
  const status=choice(p.status,['Approved','Rejected']),note=text(p.review_note,1000);await tx`select pg_advisory_xact_lock(hashtextextended(${l.staff_id+':attendance'},0))`;
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
