import {fail,uuid,text,choice} from './validation.mjs';
import {day} from './suite-rules.mjs';

// KRA return due dates per client period and filing class. The ERP only SUGGESTS a date (the 9th for PAYE and payroll levies, the 20th for VAT/TOT/MRI); the Tax Lead, a Manager
// or a Partner confirms it against the KRA iTax calendar, or explicitly chooses the task-date fallback with a reason. The rules live in the database
// (20261110279000_tax_lead_due_dates_amendments.sql); these actions only pass the person's entries through.
const ACTIONS=['due_date_state','due_date_confirm','due_date_fallback'];
const KINDS=['VAT','PAYE','Company','Partnership','Individual','TOT','MRI','WHT','CGT','Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest'];
export async function dueDateAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'Tax setup requires a staff member.');
 const proj=(await tx`select client_id from erp_private.projects where project_id=${uuid(p.project_id)}`)[0];
 if(!proj)fail(404,'That project is unavailable to your account.');
 const start=day(p.starts_on),end=day(p.ends_on),kind=choice(p.kind,KINDS);
 if(end<start)fail(400,'End date must follow start date.');
 if(p.action==='due_date_state'){
  const [r]=await tx`select erp_private.period_due_state(${proj.client_id}::uuid,${start}::date,${end}::date,${kind}) as s`;
  return {state:r.s};
 }
 if(p.action==='due_date_confirm'){
  await tx`select erp_private.period_due_confirm(${proj.client_id}::uuid,${start}::date,${end}::date,${kind},${day(p.kra_due_date)}::date,${p.itax_confirmed===true||p.itax_confirmed==='on'})`;
  const [r]=await tx`select erp_private.period_due_state(${proj.client_id}::uuid,${start}::date,${end}::date,${kind}) as s`;
  return {ok:true,state:r.s};
 }
 await tx`select erp_private.period_due_fallback(${proj.client_id}::uuid,${start}::date,${end}::date,${kind},${text(p.fallback_reason||'',500,false)})`;
 const [r]=await tx`select erp_private.period_due_state(${proj.client_id}::uuid,${start}::date,${end}::date,${kind}) as s`;
 return {ok:true,state:r.s};
}
