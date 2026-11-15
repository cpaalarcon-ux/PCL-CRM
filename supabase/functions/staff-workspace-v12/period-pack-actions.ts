import {fail,uuid} from './validation.mjs';
import {monthRange,previousMonth,packStatus,overview} from './period-pack-rules.mjs';
// Recurring service period pack (build 2809): one read-only view of what has come in for a month, what is waiting, and what is blocked and why.
// It changes nothing and approves nothing. Rules: period-pack-rules.mjs.
const ACTIONS=['period_pack_read','period_pack_overview'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);

async function packs(tx:any,projects:any[],month:string){
 const r=monthRange(month)!,prev=monthRange(previousMonth(month)!)!,ids=projects.map((p:any)=>p.project_id);
 if(!ids.length)return [];
 const arr=tx.array(ids);
 const imports=await tx`select project_id,kind,status,starts_on,ends_on from erp_private.period_imports where project_id=any(${arr}::uuid[]) and kind in('Sales','Payroll') and status in('Draft','Submitted','Returned','Confirmed')`;
 const batches=await tx`select b.project_id,b.dataset,b.period_start,b.period_end,count(r.row_id)::int as rows,count(r.row_id) filter(where r.route is null and r.account_code is null)::int as unmapped
  from erp_private.workbook_batches b left join erp_private.workbook_rows r on r.batch_id=b.batch_id where b.project_id=any(${arr}::uuid[]) and b.archived_at is null and b.dataset in('Sales','Purchases','Bank') group by b.batch_id,b.project_id,b.dataset,b.period_start,b.period_end`;
 const tasks=await tx`select t.project_id,t.task_name,t.status,t.blocked_reason,t.due_at from erp_private.tasks t join erp_private.work_period_tasks w on w.task_id=t.task_id join erp_private.project_work_periods wp on wp.work_period_id=w.work_period_id
  where t.project_id=any(${arr}::uuid[]) and wp.starts_on<=${r.end}::date and wp.ends_on>=${r.start}::date`;
 const cases=await tx`select project_id,kind,status from erp_private.tax_cases where project_id=any(${arr}::uuid[]) and deleted_at is null and starts_on<=${r.end}::date and ends_on>=${r.start}::date`;
 const declarations=await tx`select project_id,source_key,obligation_code,period_month,declarant_name,declared_on,reason from erp_private.source_declarations where project_id=any(${arr}::uuid[]) and status='Active' and period_month=${r.start}::date`;
 const now=new Date().toISOString();
 return projects.map((p:any)=>{
  const mine=imports.filter((i:any)=>i.project_id===p.project_id),bs=batches.filter((b:any)=>b.project_id===p.project_id);
  const earlier={sales:mine.some((i:any)=>i.kind==='Sales'&&day(i.ends_on)<r.start)||bs.some((b:any)=>b.dataset==='Sales'&&day(b.period_end)<r.start),
   purchases:bs.some((b:any)=>b.dataset==='Purchases'&&day(b.period_end)<r.start),bank:bs.some((b:any)=>b.dataset==='Bank'&&day(b.period_end)<r.start),payroll:mine.some((i:any)=>i.kind==='Payroll'&&day(i.ends_on)<r.start)};
  const priorList=mine.filter((i:any)=>i.kind==='Payroll'&&day(i.starts_on)===prev.start).map((i:any)=>i.status);
  const prior=priorList.includes('Confirmed')?'Confirmed':priorList[0]||null;
  const pack=packStatus({month,facts:{imports:mine,batches:bs,earlier,prior_payroll:prior,declarations:declarations.filter((x:any)=>x.project_id===p.project_id)},tasks:tasks.filter((t:any)=>t.project_id===p.project_id),cases:cases.filter((c:any)=>c.project_id===p.project_id),now});
  return {project_id:p.project_id,project_name:p.project_name,client_name:p.company_name,pack};
 });
}
export async function periodPackAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'Interns can access assigned tasks, not period packs.');
 const month=String(p.month||'');if(!monthRange(month))fail(400,'Choose the month as YYYY-MM.');
 if(p.action==='period_pack_read'){
  const pid=uuid(p.project_id),proj=(await tx`select p.project_id,p.project_name,c.company_name from erp_private.projects p join erp_private.clients c using(client_id) where p.project_id=${pid} and p.deleted_at is null`)[0];
  if(!proj)fail(403,'This project is unavailable to your account.');
  return (await packs(tx,[proj],month))[0];
 }
 if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Supervisor, Manager or Partner reads the period pack overview.');
 const projects=await tx`select p.project_id,p.project_name,c.company_name from erp_private.projects p join erp_private.clients c using(client_id)
  where p.deleted_at is null and p.status<>'Archived' and (exists(select 1 from erp_private.project_schedules s where s.project_id=p.project_id and s.enabled and s.deleted_at is null) or exists(select 1 from erp_private.project_work_periods w where w.project_id=p.project_id))
  order by c.company_name,p.project_name limit 300`;
 return {month,...overview(await packs(tx,projects,month)),note:'Only exceptions are listed. A source that has not arrived shows as Not received, not as zero, and an approval in one month is never carried to the next.'};
}
