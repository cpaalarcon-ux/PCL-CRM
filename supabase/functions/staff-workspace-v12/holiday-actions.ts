// Public holiday calendar. Only a Partner can read it here or change it; the clocks (stuck-task alerts, pool, later payroll and SLA) read the table.
import {fail,text,date} from './validation.mjs';
export async function holidayAction(tx:any,a:any,p:any){
 if(!String(p.action||'').startsWith('holiday_'))return undefined;
 if(a.category_code!=='PARTNER')fail(403,'Only a Partner can manage the holiday calendar.');
 if(p.action==='holiday_list'){
  const lock=(await tx`select erp_private.holiday_lock_active() l`)[0].l;
  return {lock_active:lock,holidays:await tx`select h.holiday_date,h.name,h.is_working_day,h.confirmed,h.source_note,h.confirmed_at,s.full_name confirmed_by_name,h.revision
   from erp_private.public_holidays h left join erp_private.staff_members s on s.staff_id=h.confirmed_by order by h.holiday_date`};
 }
 if(p.action==='holiday_save'){
  const d=date(p.holiday_date),name=text(p.name||'',120,false).trim(),source=text(p.source_note||p.source||'',1000,false).trim();
  if(name.length<3)fail(400,'Enter the holiday name.');
  if(source.length<10)fail(400,'Record the source note in at least 10 characters, for example Gazette Notice No. 1234.');
  await tx`select erp_private.holiday_save(${d}::date,${name},${p.is_working_day===true||p.is_working_day==='on'||p.is_working_day==='true'},${source})`;
  return {ok:true};
 }
 fail(400,'Unknown holiday action.');
}
