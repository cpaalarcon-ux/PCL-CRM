// Team & HR and the Manager Pool. Read-only alerts plus the pull-from-pool and send-to-pool actions; the rules live in the database
// (erp_private.team_workload, refresh_review_pool, task_pool_claim, task_send_to_pool).
import {fail,text,uuid} from './validation.mjs';
const REVIEWERS=['PARTNER','MANAGER','SUPERVISOR'];
export async function teamAction(tx:any,a:any,p:any){
 if(p.action==='task_team_workload'){
  if(!REVIEWERS.includes(a.category_code))fail(403,'You do not have access to this action.');
  const target=p.target_staff_id?uuid(p.target_staff_id):null;
  return {people:await tx`select staff_id,full_name,category_code,active_tasks,overdue_tasks,on_leave,is_overloaded from erp_private.team_workload() where staff_id in (select v.staff_id from erp_private.view_staff_ids(${target}::uuid) v)`,threshold:15,target_staff_id:target};
 }
 if(p.action==='task_pool_list'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'The Manager Pool is for Managers and Partners.');
  await tx`select erp_private.refresh_review_pool()`;
  const tasks=await tx`select t.task_id,t.task_name,t.due_at,c.company_name,pr.project_name,r.pool_reason,r.manual,r.pooled_at,
    pw.reviewer_id,rv.full_name reviewer_name,pw.prepared_by,pb.full_name prepared_by_name,t.assigned_to=${a.staff_id} or pw.prepared_by=${a.staff_id} is_mine
   from erp_private.task_review_pool r join erp_private.tasks t on t.task_id=r.task_id join erp_private.projects pr on pr.project_id=t.project_id join erp_private.clients c on c.client_id=pr.client_id
   join erp_private.task_procedures pw on pw.task_id=t.task_id left join erp_private.staff_members rv on rv.staff_id=pw.reviewer_id left join erp_private.staff_members pb on pb.staff_id=pw.prepared_by
   where r.review_pool_status='POOL' and t.deleted_at is null order by r.pooled_at limit 200`;
  const recent=await tx`select l.log_id,l.action,l.created_at,l.reason,t.task_name,fr.full_name from_name,tn.full_name to_name,ab.full_name acted_by_name
   from erp_private.task_pool_log l join erp_private.tasks t on t.task_id=l.task_id left join erp_private.staff_members fr on fr.staff_id=l.from_reviewer left join erp_private.staff_members tn on tn.staff_id=l.to_staff_id left join erp_private.staff_members ab on ab.staff_id=l.acted_by
   order by l.created_at desc limit 15`;
  return {tasks,recent};
 }
 if(p.action==='task_pool_claim'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'The Manager Pool is for Managers and Partners.');
  await tx`select erp_private.task_pool_claim(${uuid(p.task_id)}::uuid)`;
  return {ok:true};
 }
 if(p.action==='task_pool_send'){
  if(!REVIEWERS.includes(a.category_code))fail(403,'Only a Supervisor, Manager or Partner can send work to the pool.');
  const reason=text(p.reason||'',1000,false).trim();if(reason.length<10)fail(400,'Say why this goes to the pool in at least 10 characters.');
  await tx`select erp_private.task_send_to_pool(${uuid(p.task_id)}::uuid,${reason})`;
  return {ok:true};
 }
 return undefined;
}
