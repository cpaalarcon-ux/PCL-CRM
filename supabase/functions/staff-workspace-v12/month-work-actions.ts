import {fail,text,uuid,date} from './validation.mjs';
// Monthly compliance work period: four weekly tasks cleared one at a time, then extra tasks until the return is filed, then a locked month.
// The database functions (20261214200000_monthly_work_period.sql) hold the rules and re-check who is calling; this file only passes the request through.
const ACTIONS=['month_work_read','month_work_open','month_work_new_week','month_work_submit','month_work_clear','month_work_add_task'];
export async function monthWorkAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(p.action==='month_work_read'){
  const [r]=await tx`select erp_private.month_overview(${p.project_id?uuid(p.project_id):null}::uuid) as o`;
  const months=r.o as any[];
  const exceptions=months.filter(m=>m.flag!=='On track'&&!m.closed).map(m=>({work_period_id:m.work_period_id,client_name:m.client_name,month_start:m.month_start,cleared:m.cleared,flag:m.flag}));
  return {ok:true,months,exceptions,me:{staff_id:a.staff_id,category_code:a.category_code}};
 }
 if(p.action==='month_work_open'){
  const month=/^\d{4}-\d{2}(-\d{2})?$/.test(String(p.month||''))?String(p.month).slice(0,7)+'-01':fail(400,'Choose the month.');
  const [r]=await tx`select erp_private.month_open(${uuid(p.project_id)}::uuid,${month}::date,${uuid(p.preparer_id)}::uuid,${p.duplicate_reason?text(p.duplicate_reason,1000):null}) as id`;
  return {ok:true,work_period_id:r.id};
 }
 if(p.action==='month_work_new_week'){
  const [r]=await tx`select erp_private.month_new_week(${uuid(p.work_period_id)}::uuid) as id`;
  return {ok:true,task_id:r.id};
 }
 if(p.action==='month_work_submit'){
  const list:any={};for(const k of ['sales','purchases','bank','mapping','review','reporting'])list[k]=p.checklist?.[k]===true;
  await tx`select erp_private.month_week_submit(${uuid(p.task_id)}::uuid,${tx.json?tx.json(list):JSON.stringify(list)}::jsonb)`;
  return {ok:true};
 }
 if(p.action==='month_work_clear'){
  const clear=p.clear===true;
  await tx`select erp_private.month_week_clear(${uuid(p.task_id)}::uuid,${clear},${clear?null:text(p.note||'',1000,false)})`;
  return {ok:true};
 }
 const due=date(p.due_date);if(!due)fail(400,'Choose a due date.');
 const [r]=await tx`select erp_private.month_add_task(${uuid(p.work_period_id)}::uuid,${text(p.task_name,200)},${due}::date,${uuid(p.assigned_to)}::uuid,${p.amendment_case_id?uuid(p.amendment_case_id):null}::uuid) as id`;
 return {ok:true,task_id:r.id};
}
