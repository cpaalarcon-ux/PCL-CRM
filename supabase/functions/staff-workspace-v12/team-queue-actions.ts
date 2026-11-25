import {choice,date,fail,text,uuid} from './validation.mjs';
// Team queue for Supervisors, Managers and Partners. Tasks are done by Assistants; reviewers see the review queue and every active task.
// Read-only: opening, editing, returning and approving use the existing task screens. Row access is still decided by the database.
const ACTIONS=['team_queue_read'];
const REVIEWERS=['PARTNER','MANAGER','SUPERVISOR'];
export async function teamQueueAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!REVIEWERS.includes(a.category_code))fail(403,'The team queue is for Supervisors, Managers and Partners.');
 const mode=choice(p.mode||'reviews',['reviews','all']),assistant=p.assistant_id?uuid(p.assistant_id):null,client=text(p.client||'',140,false).toLowerCase(),due=date(p.due_before),offset=Math.min(100000,Math.max(0,Number.parseInt(p.offset,10)||0));
 const rows=await tx`select t.task_id,t.task_name,t.status,t.due_at,t.project_id,p.project_name,c.company_name as client_name,t.assigned_to,s.full_name as assignee_name,
   (t.due_at is not null and (t.due_at at time zone 'Africa/Nairobi')::date<(now() at time zone 'Africa/Nairobi')::date and t.status not in ('Completed','Cancelled')) as overdue,count(*) over() as total_count
  from erp_private.tasks t join erp_private.projects p on p.project_id=t.project_id and p.deleted_at is null
  join erp_private.clients c on c.client_id=p.client_id and c.deleted_at is null
  left join erp_private.staff_members s on s.staff_id=t.assigned_to
  left join erp_private.task_procedures w on w.task_id=t.task_id
  where t.deleted_at is null and t.status not in ('Completed','Cancelled')
   and (${mode}='all' or (t.status='In Review' and t.assigned_to is distinct from ${a.staff_id}::uuid and coalesce(w.prepared_by,t.assigned_to) is distinct from ${a.staff_id}::uuid))
   and (${assistant}::uuid is null or t.assigned_to=${assistant}::uuid)
   and (${client}='' or strpos(lower(c.company_name),${client})>0)
   and (${due}::date is null or (t.due_at at time zone 'Africa/Nairobi')::date<=${due}::date)
  order by overdue desc,t.due_at nulls last,t.task_id limit 100 offset ${offset}`;
 const assistants=await tx`select distinct staff_id,full_name from erp_private.assignment_candidates() where category_code='ASSISTANT' order by full_name,staff_id limit 300`;
 return {mode,records:rows,total:Number(rows[0]?.total_count||0),assistants,page_size:100,offset};
}
