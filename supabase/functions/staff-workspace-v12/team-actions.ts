// Team & HR: who is carrying how much. Read-only; an alert, never a block. The rule (more than 15 active tasks) lives in erp_private.team_workload.
import {fail} from './validation.mjs';
export async function teamAction(tx:any,a:any,p:any){
 if(p.action!=='task_team_workload')return undefined;
 if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'You do not have access to this action.');
 return {people:await tx`select staff_id,full_name,category_code,active_tasks,overdue_tasks,on_leave,is_overloaded from erp_private.team_workload()`,threshold:15};
}
