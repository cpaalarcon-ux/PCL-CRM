import {fail} from './validation.mjs';
import {cleanQuery,queryProblem,likePattern,monthRange,shiftMonth,calendarEvents,byDay,PER_KIND} from './search-calendar-rules.mjs';
// Build 2835: one search box across clients, engagements, projects, tasks and trial-balance accounts, and a month calendar of due dates. Both are reads under the
// signed-in person's own row access: nothing here widens what a person can see.
const ACTIONS=['search_all','calendar_read'];
export const isSearchAction=(a:string)=>ACTIONS.includes(a);
const nairobiToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
export async function searchCalendarAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(p.action==='search_all'){
  const problem=queryProblem(p.q);if(problem)fail(400,problem);
  const q=cleanQuery(p.q),like=likePattern(q);
  const clients=await tx`select client_id,company_name,trading_name,kra_pin,record_status from erp_private.clients where deleted_at is null and (company_name ilike ${like} escape '\' or coalesce(trading_name,'') ilike ${like} escape '\' or coalesce(kra_pin,'') ilike ${like} escape '\') order by company_name limit ${PER_KIND}`;
  const projects=await tx`select p.project_id,p.project_name,p.service_code,p.status,c.company_name from erp_private.projects p join erp_private.clients c on c.client_id=p.client_id where p.deleted_at is null and (p.project_name ilike ${like} escape '\' or p.service_code ilike ${like} escape '\') order by p.project_name limit ${PER_KIND}`;
  const engagements=await tx`select e.setup_id,e.project_id,e.service_code,e.period_start,e.period_end,e.status,c.company_name,p.project_name from erp_private.engagement_setups e join erp_private.clients c on c.client_id=e.client_id join erp_private.projects p on p.project_id=e.project_id where p.deleted_at is null and (c.company_name ilike ${like} escape '\' or p.project_name ilike ${like} escape '\' or e.service_code ilike ${like} escape '\' or e.scope ilike ${like} escape '\') order by e.period_end desc limit ${PER_KIND}`;
  const tasks=await tx`select t.task_id,t.project_id,t.task_name,t.status,t.due_at,p.project_name,c.company_name from erp_private.tasks t join erp_private.projects p on p.project_id=t.project_id join erp_private.clients c on c.client_id=p.client_id where t.deleted_at is null and t.task_name ilike ${like} escape '\' order by t.due_at nulls last limit ${PER_KIND}`;
  const accounts=await tx`select ac.code,ac.name,ac.account_group,ac.statement,(select count(*)::int from erp_private.client_chart_versions v where v.status='Approved' and ac.code=any(v.accounts)) as clients_using from erp_private.account_catalog ac where ac.status='Active' and (ac.code like ${like} escape '\' or ac.name ilike ${like} escape '\') order by ac.code limit ${PER_KIND}`;
  const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):v?String(v).slice(0,10):null;
  const groups={clients,projects,engagements:engagements.map((e:any)=>({...e,period_start:day(e.period_start),period_end:day(e.period_end)})),tasks:tasks.map((t:any)=>({...t,due_at:t.due_at?new Date(t.due_at).toISOString():null})),accounts};
  return {query:q,per_kind:PER_KIND,groups,total:Object.values(groups).reduce((n:number,g:any)=>n+g.length,0)};
 }
 const today=nairobiToday(),month=String(p.month||today.slice(0,7)),range=monthRange(month);if(!range)fail(400,'Choose a month as YYYY-MM.');
 const tasks=await tx`select t.task_id,t.project_id,t.task_name,t.status,t.due_at,c.company_name as client_name from erp_private.tasks t join erp_private.projects p on p.project_id=t.project_id join erp_private.clients c on c.client_id=p.client_id where t.deleted_at is null and t.due_at is not null and (t.due_at at time zone 'Africa/Nairobi')::date between ${range.from}::date and ${range.to}::date`;
 const dues=await tx`select d.*,c.company_name as client_name from erp_private.period_due_dates d join erp_private.clients c on c.client_id=d.client_id where coalesce(d.kra_due_date,d.suggested_due_date) between ${range.from}::date and ${range.to}::date`;
 const periods=await tx`select pr.*,c.company_name as client_name from erp_private.client_periods pr join erp_private.clients c on c.client_id=pr.client_id where pr.return_due_date between ${range.from}::date and ${range.to}::date or pr.internal_due_date between ${range.from}::date and ${range.to}::date or pr.payment_due_date between ${range.from}::date and ${range.to}::date`;
 const taskRows=tasks.map((t:any)=>({...t,due_at:new Date(t.due_at).toLocaleString('sv-SE',{timeZone:'Africa/Nairobi'}).replace(' ','T')}));
 const events=calendarEvents({tasks:taskRows,dues,periods,today,range});
 return {month,previous:shiftMonth(month,-1),next:shiftMonth(month,1),today,range,days:byDay(events),count:events.length,overdue:events.filter((e:any)=>e.overdue).length};
}
