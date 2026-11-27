import {date,fail,text,uuid} from './validation.mjs';
import {projectEditor} from './workspace-rules.mjs';

const actions=new Set(['communication_followup_list','communication_followup_options','communication_followup_create']);
const one=(rows:any[])=>{
 if(!rows.length)fail(403,'This follow-up source or engagement is unavailable.');
 return rows[0];
};

export async function communicationFollowupAction(tx:any,a:any,p:any,run:(p:any)=>Promise<any>,can:(action:string)=>Promise<boolean>){
 if(!actions.has(p.action))return undefined;
 const [canDiscuss,canViewTasks,canCreate,canReadCorrespondence,canReadTickets]=await Promise.all([
  can('discussion_messages'),can('task_types_list'),can('task_create'),can('communication_resolve'),can('client_support_list'),
 ]);
 const create=projectEditor(a)&&canCreate&&canViewTasks;
 const sourceAllowed=canDiscuss&&canViewTasks&&['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code);

 if(p.action==='communication_followup_list'){
  const firm=p.firm_id?uuid(p.firm_id):null;
  const staff=a.staff_id;
  const lead=['PARTNER','MANAGER'].includes(a.category_code);
  const [tasks,requests,correspondence,tickets]=await Promise.all([
   canViewTasks?tx`
    select 'task' kind,t.task_id id,t.task_name title,c.company_name,t.status,s.full_name owner,
     case when not t.redate_needed then (t.due_at at time zone 'Africa/Nairobi')::date::text end due_on,
     (not t.redate_needed and t.due_at<now()) overdue,
     (t.status='Waiting on client' or w.stage in ('Pending client documents','Awaiting client approval')) waiting,
     review.awaiting_review,
     case when ${canDiscuss} and erp_private.discussion_allowed(f.channel_id) then f.message_id end message_id,
     case when ${canDiscuss} and erp_private.discussion_allowed(f.channel_id) then f.channel_id end channel_id
    from erp_private.communication_followups f join erp_private.tasks t using(task_id)
    join erp_private.projects j on j.project_id=t.project_id join erp_private.clients c using(client_id)
    left join erp_private.task_procedures w using(task_id) left join erp_private.staff_members s on s.staff_id=t.assigned_to
    cross join lateral (select coalesce(${projectEditor(a)} and (
     (w.stage='Pending supervisor review' and w.prepared_by<>${staff} and (w.reviewer_id=${staff} or ${lead}))
     or (t.status='In Review' and t.assigned_to<>${staff} and exists (
      select 1 from erp_private.project_schedules s where s.project_id=t.project_id and s.reviewer_id=${staff}
     ))
    ),false) awaiting_review) review
    where t.deleted_at is null and j.deleted_at is null and j.status<>'Archived' and t.status not in ('Completed','Cancelled')
     and (${firm}::uuid is null or j.handling_firm_id=${firm})
     and (t.assigned_to=${staff} or review.awaiting_review)
    order by t.due_at nulls last,t.task_id
   `:[],
   sourceAllowed?tx`
    select 'request' kind,f.followup_id id,f.title,c.company_name,'Follow-up requested' status,s.full_name owner,
     f.requested_due_on::text due_on,
     (f.requested_due_on<(now() at time zone 'Africa/Nairobi')::date) overdue,
     (${create} and f.requested_by<>${staff}) awaiting_review,
     f.message_id,f.channel_id
    from erp_private.communication_followups f join erp_private.projects j using(project_id)
    join erp_private.clients c using(client_id) left join erp_private.staff_members s on s.staff_id=f.requested_by
    where f.task_id is null and j.deleted_at is null and j.status='Active'
     and j.client_hold is null and erp_private.client_is_active(j.client_id)
     and (${firm}::uuid is null or j.handling_firm_id=${firm})
     and erp_private.discussion_allowed(f.channel_id) and (f.requested_by=${staff} or ${create})
    order by f.requested_due_on,f.followup_id
   `:[],
   canReadCorrespondence?tx`
    select 'correspondence' kind,m.communication_id id,m.subject title,c.company_name,m.status,s.full_name owner,
     m.followup_date::text due_on,(m.followup_date<(now() at time zone 'Africa/Nairobi')::date) overdue,
     (m.status='Waiting' and m.channel<>'Internal note') waiting,m.opaque_reference
    from erp_private.communications m join erp_private.clients c using(client_id)
    left join erp_private.staff_members s on s.staff_id=m.owner_id
    where m.owner_id=${staff} and m.deleted_at is null and m.status<>'Closed' and m.followup_date is not null
     and (${firm}::uuid is null or m.firm_id=${firm})
    order by m.followup_date,m.communication_id
   `:[],
   canReadTickets?tx`
    select 'request_ticket' kind,t.ticket_id id,t.subject title,c.company_name,t.status,s.full_name owner,
     deadline.due_on::text due_on,(deadline.due_on<(now() at time zone 'Africa/Nairobi')::date) overdue,
     (t.status='Waiting on client') waiting
    from erp_private.client_support_tickets t join erp_private.clients c using(client_id)
    left join erp_private.staff_members s on s.staff_id=t.assigned_to
    cross join lateral (select case when t.status='Open' then least(t.response_due_on,t.resolution_due_on) else t.resolution_due_on end due_on) deadline
    where t.assigned_to=${staff} and t.status not in ('Closed','Cancelled') and (${firm}::uuid is null or t.firm_id=${firm})
    order by deadline.due_on nulls last,t.ticket_id
   `:[],
  ]);
  return {items:[...tasks,...requests,...correspondence,...tickets]};
 }
 if(!sourceAllowed)fail(403,'Your account cannot create or request a follow-up from Messenger.');
 const channel=uuid(p.channel_id),message=uuid(p.message_id);
 const source=one(await tx`
  select c.project_id,m.body
  from erp_private.discussion_messages m join erp_private.discussion_channels c using(channel_id)
  where m.message_id=${message} and m.channel_id=${channel}
 `);
 if(p.action==='communication_followup_options'){
  const [projects,staff,types,pending]=await Promise.all([
   tx`select j.project_id,j.project_name,j.handling_firm_id,c.company_name from erp_private.projects j join erp_private.clients c using(client_id)
    where j.status='Active' and j.deleted_at is null and j.client_hold is null
     and erp_private.client_is_active(j.client_id) and (${source.project_id}::uuid is null or j.project_id=${source.project_id})
    order by c.company_name,j.project_name,j.project_id`,
   create?tx`select staff_id,full_name,firm_id from erp_private.assignment_candidates() where category_code='ASSISTANT' order by full_name`:[],
   create?tx`select standard_id,label from erp_private.task_type_names() order by label`:[],
   p.followup_id?tx`select followup_id,project_id,title,summary,requested_due_on::text due_on from erp_private.communication_followups
    where followup_id=${uuid(p.followup_id)} and message_id=${message} and channel_id=${channel} and task_id is null
     and (requested_by=${a.staff_id} or ${create})`:[],
  ]);
  return {create,body:source.body,projects,staff,types,pending:p.followup_id?one(pending):null};
 }
 const projectId=uuid(p.project_id);
 if(source.project_id&&source.project_id!==projectId)fail(400,'Choose the engagement linked to this conversation.');
 one(await tx`select project_id from erp_private.projects where project_id=${projectId} and status='Active'
  and deleted_at is null and client_hold is null and erp_private.client_is_active(client_id)`);
 await tx`select pg_advisory_xact_lock(hashtextextended(${'communication-followup:'+message+':'+projectId},0))`;
 let entry=(await tx`select followup_id,task_id from erp_private.communication_followups where message_id=${message} and project_id=${projectId}`)[0];
 if(p.followup_id&&entry?.followup_id!==uuid(p.followup_id))fail(403,'This follow-up request is unavailable.');
 if(entry?.task_id){
  const [visible]=await tx`select task_id from erp_private.tasks where task_id=${entry.task_id} and deleted_at is null`;
  return {existing:true,task_id:visible?.task_id??null};
 }
 const title=text(p.title,200).trim(),summary=text(p.summary,2000).trim(),due=date(p.due_on);
 if(title.length<3||summary.length<3||!due)fail(400,'Enter a title, an action summary and a due date.');
 if(!entry)entry=one(await tx`
  insert into erp_private.communication_followups(channel_id,message_id,project_id,requested_by,title,summary,requested_due_on)
  values(${channel},${message},${projectId},${a.staff_id},${title},${summary},${due}) returning followup_id,task_id
 `);
 if(p.request_only===true)return {requested:true};
 if(!create)fail(403,'Ask an authorised reviewer to create this task.');
 const made=await run({action:'task_create',project_id:projectId,assigned_to:uuid(p.assigned_to),
  task_name:title,description:summary,due_date:due,task_type_id:p.task_type_id?uuid(p.task_type_id):null});
 one(await tx`update erp_private.communication_followups set task_id=${made.task_id} where followup_id=${entry.followup_id} returning followup_id`);
 return {task_id:made.task_id};
}
