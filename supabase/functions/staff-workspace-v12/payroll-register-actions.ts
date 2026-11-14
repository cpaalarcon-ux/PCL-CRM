import {fail,text,uuid,date,revision} from './validation.mjs';
import {personIssues,payIssues,draftLines,registerChanges,affectedMonths,monthBounds,previousMonth,PAY_FIELDS,REGISTER_RELATIONSHIPS} from './payroll-register-rules.mjs';
import {relationshipIssues} from './payroll-lines.mjs';

// The payroll register (build 2804): people on a client's payroll and their effective-dated recurring pay, kept apart from each month's run.
// A month starts as a draft taken from the register; the draft goes through the same preview, review and posting path as any typed payroll.
// Nothing here saves, submits or posts a payroll. Rules for the tables are in 20261115100000_payroll_register.sql.
const ACTIONS=['payroll_register_read','payroll_register_add','payroll_register_pay','payroll_register_leave','payroll_register_draft'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const num=(v:any)=>v==null||v===''?0:Number(String(v).replace(/,/g,''));

async function context(tx:any,p:any){
 const project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`);
 const owner=(await tx`select legal_entity_type from erp_private.clients where client_id=${project.client_id}`)[0];
 return {project,entityType:owner?.legal_entity_type||''};
}
async function load(tx:any,clientId:string){
 const people=await tx`select person_id,name,kra_pin,national_id,employment_type,relationship,resident,phone,approval_reference,related_basis,started_on,left_on,left_reason,status,revision,created_at from erp_private.client_payroll_people where client_id=${clientId} order by name`;
 const pays=await tx`select pay_id,person_id,gross,taxable_benefits,other_pension,mortgage_interest,postretirement_medical,effective_from,reason,created_at from erp_private.client_payroll_pay where client_id=${clientId} order by person_id,effective_from desc`;
 return {people:people.map((x:any)=>({...x,started_on:day(x.started_on),left_on:x.left_on?day(x.left_on):null})),pays:pays.map((x:any)=>({...x,gross:Number(x.gross),taxable_benefits:Number(x.taxable_benefits),other_pension:Number(x.other_pension),mortgage_interest:Number(x.mortgage_interest),postretirement_medical:Number(x.postretirement_medical),effective_from:day(x.effective_from)}))};
}
async function affected(tx:any,clientId:string,eff:string){
 const imports=await tx`select import_id,status,starts_on,ends_on from erp_private.period_imports where client_id=${clientId} and kind='Payroll' and status in('Submitted','Confirmed')`;
 return affectedMonths(imports,eff);
}

export async function payrollRegisterAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The payroll register is kept by staff with client access.');
 const {project,entityType}=await context(tx,p),cid=project.client_id;
 if(p.action==='payroll_register_read'){
  const d=await load(tx,cid);
  return {...d,relationships:REGISTER_RELATIONSHIPS,client_id:cid};
 }
 if(project.status==='Archived')fail(400,'Archived projects retain read-only history.');
 if(p.action==='payroll_register_draft'){
  const ym=String(p.month||''),b=monthBounds(ym);if(!b)fail(400,'Choose the payroll month.');
  const d=await load(tx,cid),built=draftLines(d.people,d.pays,ym),changes=registerChanges(d.people,d.pays,ym);
  if(!built.lines.length&&!built.skipped.length)fail(400,'The register has nobody on the payroll for '+ym+'. Add people first, or type the lines.');
  const prev=(await tx`select import_id,status from erp_private.period_imports where client_id=${cid} and kind='Payroll' and starts_on=${monthBounds(previousMonth(ym))!.start} and status in('Submitted','Confirmed') limit 1`)[0]||null;
  const existing=(await tx`select import_id,status from erp_private.period_imports where client_id=${cid} and kind='Payroll' and starts_on=${b.start} and status in('Draft','Submitted','Confirmed') limit 1`)[0]||null;
  const returned=(await tx`select import_id,status from erp_private.period_imports where client_id=${cid} and kind='Payroll' and starts_on=${b.start} and status='Returned' limit 1`)[0]||null;
  const issues=relationshipIssues({entityType,lines:built.lines.map((l:any,i:number)=>({...l,source_row:i+1,approval_reference:l.approval_reference}))}).filter((x:string)=>!/evidence/i.test(x));
  const missing=built.lines.flatMap((l:any)=>{const m=[];if(!l.pin&&l.employment_type!=='Casual')m.push('KRA PIN');if(!l.employee_id&&l.employment_type==='Casual')m.push('ID number');return m.length?[{name:l.name,missing:m}]:[];});
  return {month:ym,starts_on:b.start,ends_on:b.end,lines:built.lines,skipped:built.skipped,changes,issues,missing,previous_month_approved:!!prev,existing_run:existing,returned_run:returned,
   note:'Recurring pay is taken from the register. Overtime, bonuses, other deductions, the date a casual worker is paid and the evidence for the month are entered new. Nothing is saved or submitted.'};
 }
 if(p.action==='payroll_register_add'){
  const x=p.person||{},issues=personIssues(x,{entityType});
  const started=date(x.started_on);if(!started)issues.push('Say the date the person started.');
  const pay=payIssues({...p.pay,effective_from:p.pay?.effective_from||started,reason:p.pay?.reason});
  issues.push(...pay.issues);
  if(issues.length)fail(400,issues.join(' '));
  const pin=String(x.kra_pin||'').toUpperCase().replace(/\s+/g,'')||null,type=String(x.employment_type||'Permanent');
  const dup=(await tx`select name from erp_private.client_payroll_people where client_id=${cid} and status='Active' and ((${pin}::text is not null and kra_pin=${pin}) or (${x.national_id||null}::text is not null and national_id=${x.national_id||null})) limit 1`)[0];
  if(dup)fail(409,dup.name+' is already on this client\'s payroll register with the same KRA PIN or ID number.');
  const person=one(await tx`insert into erp_private.client_payroll_people(client_id,name,kra_pin,national_id,employment_type,relationship,resident,phone,approval_reference,related_basis,started_on,created_by)
   values(${cid},${text(x.name,160)},${pin},${x.national_id?text(String(x.national_id),30):null},${type},${String(x.relationship||'Employee')},${x.resident||null},${x.phone?String(x.phone).replace(/[\s-]/g,''):null},${x.approval_reference?text(String(x.approval_reference),300):null},${x.related_basis?text(String(x.related_basis),500):null},${started},${a.staff_id}) returning person_id`);
  const eff=date(p.pay?.effective_from||started)!;
  await tx`insert into erp_private.client_payroll_pay(person_id,client_id,gross,taxable_benefits,other_pension,mortgage_interest,postretirement_medical,effective_from,reason,created_by)
   values(${person.person_id},${cid},${pay.values.gross},${pay.values.taxable_benefits},${pay.values.other_pension},${pay.values.mortgage_interest},${pay.values.postretirement_medical},${eff},${text(p.pay.reason,500)},${a.staff_id})`;
  return {person_id:person.person_id,affected_months:await affected(tx,cid,eff)};
 }
 if(p.action==='payroll_register_pay'){
  const person=one(await tx`select * from erp_private.client_payroll_people where person_id=${uuid(p.person_id)} and client_id=${cid} for update`);
  if(person.status!=='Active')fail(409,'This person has left the payroll.');
  const eff=date(p.effective_from);
  const pay=payIssues({...p,effective_from:eff||''});
  if(pay.issues.length)fail(400,pay.issues.join(' '));
  if(await tx`select 1 from erp_private.client_payroll_pay where person_id=${person.person_id} and effective_from=${eff}`.then((r:any)=>r.length))fail(409,'Pay already changes on that date. Choose a different effective date.');
  await tx`insert into erp_private.client_payroll_pay(person_id,client_id,gross,taxable_benefits,other_pension,mortgage_interest,postretirement_medical,effective_from,reason,created_by)
   values(${person.person_id},${cid},${pay.values.gross},${pay.values.taxable_benefits},${pay.values.other_pension},${pay.values.mortgage_interest},${pay.values.postretirement_medical},${eff},${text(p.reason,500)},${a.staff_id})`;
  return {ok:true,affected_months:await affected(tx,cid,eff!),
   note:'A month that was already submitted or approved keeps the figures it was saved with. To use this change for such a month, withdraw or amend that month and prepare it again.'};
 }
 if(p.action==='payroll_register_leave'){
  const person=one(await tx`select * from erp_private.client_payroll_people where person_id=${uuid(p.person_id)} and client_id=${cid} for update`);
  if(String(person.revision)!==revision(p.revision))fail(409,'The register changed. Refresh first.');
  if(person.status!=='Active')fail(409,'This person has already left.');
  const left=date(p.left_on),why=text(p.reason||'',500,false).trim();
  if(!left||left<day(person.started_on))fail(400,'Say the date the person left, on or after the day they started.');
  if(why.length<10)fail(400,'Give the reason they left (at least 10 characters).');
  await tx`update erp_private.client_payroll_people set status='Left',left_on=${left},left_reason=${why} where person_id=${person.person_id}`;
  return {ok:true,affected_months:await affected(tx,cid,left)};
 }
}
