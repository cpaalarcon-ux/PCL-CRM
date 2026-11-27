import {fail,text,uuid} from './validation.mjs';
import {timeInput} from './workspace-rules.mjs';
import {workspaceAction} from './workspace-actions.ts';
import {procedureAction} from './procedure-actions.ts';

const SNAPSHOT_LIMIT=100;
const STAFF_ROLES=['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN'];

export async function offlineDraftAction(tx:any,actor:any,p:any,{
 can, hash,
}:{can:(request:any)=>Promise<boolean>,hash:(value:string)=>Promise<string>}){
 if(!STAFF_ROLES.includes(actor.category_code))fail(403,'Offline drafts are available to engagement staff.');
 const canTime=await can({action:'timesheet_save',status:'Draft'});
 const canNote=await can({action:'procedure_action',operation:'note'})&&await can({action:'procedure_read'});
 if(!canTime&&!canNote)fail(403,'Your account cannot save offline drafts.');

 if(p.action==='task_offline_list'){
  const tasks=await tx`
   select t.task_id,t.task_name,(t.due_at at time zone 'Africa/Nairobi')::date::text due_on,
    ${canTime}::boolean can_time,
    (${canNote} and w.task_id is not null and w.stage<>'Closed'
     and (${actor.category_code}<>'INTERN' or w.profile='Supporting task')) can_note
   from erp_private.tasks t
   join erp_private.projects p using(project_id)
   left join erp_private.task_procedures w using(task_id)
   where t.assigned_to=${actor.staff_id} and t.deleted_at is null and t.client_hold is null
     and t.status not in ('Completed','Cancelled')
     and p.status='Active' and p.client_hold is null and p.deleted_at is null
     and erp_private.client_is_active(p.client_id)
     and (${canTime} or (w.task_id is not null and w.stage<>'Closed' and
      (${actor.category_code}<>'INTERN' or w.profile='Supporting task')))
   order by t.due_at nulls last,t.task_id limit ${SNAPSHOT_LIMIT+1}
  `;
  return {staff_id:actor.staff_id,tasks:tasks.slice(0,SNAPSHOT_LIMIT),has_more:tasks.length>SNAPSHOT_LIMIT};
 }

 const operationId=uuid(p.operation_id);
 const taskId=uuid(p.task_id);
 const kind=p.kind;
 if(!['time','note'].includes(kind))fail(400,'Choose a time draft or task note.');
 if(kind==='time'&&!canTime||kind==='note'&&!canNote)fail(403,'Your access to this draft action has changed.');
 const draft=kind==='time'?timeInput({task_id:taskId,work_date:p.work_date,hours:p.hours,
  description:p.description,billable:p.billable,status:'Draft'}):null;
 const note=kind==='note'?text(p.note,1000).trim():null;
 if(kind==='note'&&(!note||note.length<3))fail(400,'Enter at least three characters for the task note.');
 const digest=await hash(JSON.stringify([kind,taskId,draft,note]));
 // Serialise retries even if the client timed out while the first request was still running.
 await tx`select pg_advisory_xact_lock(hashtextextended(${'offline-draft:'+actor.staff_id+':'+operationId},0))`;
 const [previous]=await tx`
  select payload_hash,result from erp_private.offline_draft_receipts
  where staff_id=${actor.staff_id} and operation_id=${operationId}
 `;
 if(previous){
  if(previous.payload_hash!==digest)fail(409,'This request was already used for different work.');
  return previous.result;
 }

 const [task]=await tx`
  select t.task_id from erp_private.tasks t join erp_private.projects p using(project_id)
   join erp_private.clients c using(client_id)
  where t.task_id=${taskId} and t.assigned_to=${actor.staff_id}
    and t.deleted_at is null and t.client_hold is null and t.status not in ('Cancelled','Completed')
    and p.deleted_at is null and p.client_hold is null and p.status='Active'
    and c.deleted_at is null and erp_private.client_is_active(c.client_id)
  for share of t
 `;
 if(!task)fail(409,'This task is no longer assigned to you or open for work.');

 let result;
 if(draft){
  result=await workspaceAction(tx,actor,{...draft,action:'timesheet_save'},{draftOnly:true});
 }else{
  const [procedure]=await tx`select revision from erp_private.task_procedures where task_id=${taskId}`;
  if(!procedure)fail(409,'This task no longer has a procedure for work notes.');
  result=await procedureAction(tx,actor,{action:'procedure_action',task_id:taskId,
   revision:String(procedure.revision),operation:'note',message:note},null);
 }
 await tx`insert into erp_private.offline_draft_receipts(staff_id,operation_id,payload_hash,result)
  values(${actor.staff_id},${operationId},${digest},${tx.json(result)})`;
 return result;
}
