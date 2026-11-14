import {fail,uuid,text} from './validation.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'This work period is unavailable.');return r[0];};
export async function taxPeriodAction(tx:any,a:any,p:any){
 if(!['work_periods','work_period_archive','work_archive'].includes(p.action))return undefined;
 const leader=['PARTNER','MANAGER'].includes(a.category_code);
 if(p.action==='work_archive'){
  if(!leader)fail(403,'Managers and the Engagement Partner may browse archived work.');
  const search='%'+text(p.search||'',100,false)+'%',offset=Math.max(0,Math.min(10000,Math.trunc(Number(p.offset)||0)));
  const periods=await tx`select w.*,p.project_name,p.client_id,p.handling_firm_id,c.company_name from erp_private.project_work_periods w join erp_private.projects p using(project_id) join erp_private.clients c using(client_id) where w.status='Archived' and concat_ws(' ',p.project_name,c.company_name,w.starts_on::text) ilike ${search} order by w.starts_on desc,w.work_period_id limit 100 offset ${offset}`;
  if(!p.work_period_id)return {periods};
  const w=one(await tx`select * from erp_private.project_work_periods where work_period_id=${uuid(p.work_period_id)} and status='Archived'`);
  return {periods,period:w,documents:await tx`select document_id,file_name,category,uploaded_at from erp_private.documents where project_id=${w.project_id} and deleted_at is null order by uploaded_at desc limit 500`,time:await tx`select t.staff_id,t.hours,t.work_date,t.status,t.description from erp_private.timesheets t join erp_private.work_period_tasks l using(task_id) where l.work_period_id=${w.work_period_id} order by t.work_date`,tasks:await tx`select t.*,pr.stage procedure_stage from erp_private.work_period_tasks l join erp_private.tasks t using(task_id) left join erp_private.task_procedures pr using(task_id) where l.work_period_id=${w.work_period_id} order by t.due_at,t.task_name`};
 }
 const pid=uuid(p.project_id);one(await tx`select project_id from erp_private.projects where project_id=${pid}`);
 if(p.action==='work_period_archive'){
  if(!leader)fail(403,'A Manager or Partner must archive completed work.');
  await tx`select erp_private.generate_project_tasks(${pid}::uuid)`;
  const [result]=await tx`select erp_private.archive_closed_periods(${pid}::uuid) archived`;return result;
 }
 return {periods:await tx`select * from erp_private.project_work_periods where project_id=${pid} order by starts_on desc`,links:await tx`select l.* from erp_private.work_period_tasks l join erp_private.project_work_periods w using(work_period_id) where w.project_id=${pid}`};
}
