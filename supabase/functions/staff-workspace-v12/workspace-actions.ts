import {fail,text,uuid,date,revision,choice} from './validation.mjs';
import {projectEditor,scheduleInput,defaultProjectName,timeInput,nairobiDate} from './workspace-rules.mjs';
import {expectedHours,taskPosition,periods,compare} from './time-budget-rules.mjs';
import {requireObligationsAllowed} from './obligation-check-actions.ts';
import {requireRightChart} from './legal-structure-actions.ts';
const one=(r:any[])=>{if(!r.length)fail(403,'This record is not available to your account.');return r[0];};
const editor=(a:any)=>{if(!projectEditor(a))fail(403,'A Partner, Manager or Supervisor must manage this project.');};
export async function requireProjectSetup(tx:any,cid:string){
 const c=one(await tx`select legal_entity_type,entity_evidence,year_end_month,year_end_day from erp_private.clients where client_id=${cid} and deleted_at is null`);
 if(!c.legal_entity_type||String(c.entity_evidence||'').trim().length<10||!c.year_end_month||!c.year_end_day)fail(400,'Complete Clients → Entity / activities: confirm legal entity, supporting source and financial year-end before creating project work.');
}
async function requireScheduleObligations(tx:any,s:any,cid:string){
 // Build 2814: each selected obligation is Confirmed, or covered by an approved exception, before any tax work is scheduled.
 await requireObligationsAllowed(tx,cid,s);
}
export async function projectTaskGate(tx:any,pid:string,cid:string,effectiveOn:string){
 const project=one(await tx`select status from erp_private.projects where project_id=${pid} and deleted_at is null`);
 if(project.status!=='Active')return {ready:false,reason:'Project is Draft. Complete the engagement checks and activate it after resolving the opening-balance step.'};
 const client=one(await tx`select opening_balance_status from erp_private.clients where client_id=${cid} and deleted_at is null`);
 if(client.opening_balance_status==='No opening balances')return {ready:true,reason:''};
 const [posted]=await tx`select j.journal_id from erp_private.ledger_journals j join erp_private.ledger_periods lp using(period_id)
  where lp.client_id=${cid} and lp.starts_on<=${effectiveOn} and lp.ends_on>=${effectiveOn} and j.kind='Opening' and j.status='Posted' limit 1`;
 return posted?{ready:true,reason:''}:{ready:false,reason:'The opening TB source is not yet posted for the financial year covering this schedule. Import it, map and balance it, then have a different Manager or Partner post it.'};
}
export async function assign(tx:any,pid:string,firm:string,sid:string){
 const s=one(await tx`select * from erp_private.assignment_candidates() where staff_id=${sid} and firm_id=${firm}`);
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pid},${sid},${firm},${s.category_code}) on conflict(project_id,staff_id) do update set deleted_at=null`;
 return s;
}
export async function workspaceExtra(tx:any){
 return {sectors:await tx`select sector_id,name,parent_id from erp_private.sectors where deleted_at is null order by name`,
 candidates:await tx`select * from erp_private.assignment_candidates()`,
 schedules:await tx`select * from erp_private.project_schedules where deleted_at is null`,
 timesheets:await tx`select * from erp_private.timesheets where deleted_at is null order by work_date desc,created_at desc limit 1000`,
 notifications:await tx`select * from erp_private.notifications order by created_at desc limit 50`,
 task_events:await tx`select * from erp_private.task_events order by created_at desc limit 200`,
 workbook_batches:await tx`select * from erp_private.workbook_batches order by created_at desc limit 200`};
}
async function previewSchedule(tx:any,s:any,cid:string){
 const catchup_task=s.enabled&&s.catchup_starts_on?{starts_on:s.catchup_starts_on,ends_on:s.catchup_ends_on}:null;
 if(!s.enabled)return {enabled:false,total:0,due_now:0,upcoming:0,breakdown:[],catchup_task:null};
 const client=one(await tx`select year_end_month,year_end_day from erp_private.clients where client_id=${cid} and deleted_at is null`);
 if(!client.year_end_month||!client.year_end_day)fail(400,'Set the client financial year-end before previewing tasks.');
 const through=`${s.ends_on}T23:59:59+03:00`;
 const occurrences=await tx`select template_key,task_name,period_start,period_end,release_at,release_at<=now() as due_now
  from erp_private.schedule_occurrences(${s.frequency},${s.pack},${s.starts_on},${s.ends_on},${s.starts_on},${tx.array(s.obligations)},${through}::timestamptz,${client.year_end_month},${client.year_end_day})
  order by release_at,template_key limit 2000`;
 const grouped=new Map<string,any>();for(const row of occurrences){const item=grouped.get(row.template_key)||{template_key:row.template_key,task_name:row.task_name,total:0,due_now:0,upcoming:0};item.total++;if(row.due_now)item.due_now++;else item.upcoming++;grouped.set(row.template_key,item);}
 const breakdown=[...grouped.values()];
 const total=breakdown.reduce((sum:number,row:any)=>sum+Number(row.total),0),due_now=breakdown.reduce((sum:number,row:any)=>sum+Number(row.due_now),0);
 return {enabled:true,total,due_now,upcoming:total-due_now,breakdown,catchup_task,financial_year_end:{month:client.year_end_month,day:client.year_end_day},periods:occurrences.slice(0,3).map((x:any)=>({start:x.period_start,end:x.period_end}))};
}
// Expected hours are seen and set only by Engagement Partners and Managers a Partner has selected (the TIME_BUDGET right).
async function seesTimeBudget(tx:any){return (await tx`select erp_private.sees_time_budget() ok`)[0].ok===true;}
async function needTimeBudget(tx:any){if(!(await seesTimeBudget(tx)))fail(403,'Expected hours are seen and set by Engagement Partners and the Managers they have selected.');}
async function setTaskHours(tx:any,a:any,taskId:string,hours:number,reason:string){
 await tx`select pg_advisory_xact_lock(hashtextextended(${taskId+':hours'},0))`;
 const [old]=await tx`select expected_hours from erp_private.task_expected_hours where task_id=${taskId} for update`;
 if(old&&Number(old.expected_hours)===hours)fail(400,'The task already has these expected hours.');
 if(old)await tx`update erp_private.task_expected_hours set expected_hours=${hours},source='Set',set_by=${a.staff_id},updated_at=now() where task_id=${taskId}`;
 else await tx`insert into erp_private.task_expected_hours(task_id,expected_hours,source,set_by) values(${taskId},${hours},'Set',${a.staff_id})`;
 await tx`insert into erp_private.task_hour_changes(task_id,old_hours,new_hours,reason,changed_by) values(${taskId},${old?old.expected_hours:null},${hours},${reason},${a.staff_id})`;
 const [lg]=await tx`select erp_private.task_logged_hours(${taskId}::uuid) h`;
 return {ok:true,task_id:taskId,...taskPosition(hours,Number(lg.h||0))};
}
// Expected hours on a project's tasks against the project's budgeted hours. A note for the person setting hours, not a block.
async function projectHoursPosition(tx:any,pid:string){
 const [s]=await tx`select coalesce(sum(e.expected_hours),0) h from erp_private.tasks t join erp_private.task_expected_hours e using(task_id) where t.project_id=${pid} and t.deleted_at is null and t.status<>'Cancelled'`;
 const [b]=await tx`select budgeted_hours from erp_private.project_budgets where project_id=${pid} and effective_from<=current_date order by effective_from desc limit 1`;
 const expected=Math.round(Number(s.h)*100)/100,budget=b?Number(b.budgeted_hours):null;
 return {project_expected_hours:expected,project_budgeted_hours:budget,project_warning:budget!==null&&expected>budget?`The tasks on this project now add up to ${expected} expected hours, more than the project budget of ${budget} hours.`:null};
}
export async function workspaceAction(tx:any,a:any,p:any,{draftOnly=false}={}):Promise<any>{
 if(p.action==='sector_save'){
  if(!['PARTNER','MANAGER','ADMIN'].includes(a.category_code))fail(403,'A Partner, Manager or System Administrator must add sectors.');
  const name=text(p.name,100),parent=p.parent_id?uuid(p.parent_id):null;
  return {sector:one(await tx`insert into erp_private.sectors(name,parent_id) values(${name},${parent}) returning sector_id,name,parent_id`)};
 }
 if(p.action==='schedule_state'){
  editor(a);const pid=uuid(p.project_id),operation=choice(p.operation,['Pause','Resume']),s=one(await tx`select * from erp_private.project_schedules where project_id=${pid} and deleted_at is null for update`),project=one(await tx`select status from erp_private.projects where project_id=${pid} and deleted_at is null`);
  if(project.status==='Archived')fail(400,'An archived project cannot resume recurring work.');if(String(s.version)!==revision(p.version))fail(409,'The schedule changed. Refresh the project before changing its status.');
  if(operation==='Pause'&&!s.enabled)return {ok:true,enabled:false};if(operation==='Resume'&&s.enabled)return {ok:true,enabled:true};
  const today=nairobiDate(),effective=operation==='Pause'?today:new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  if(operation==='Resume'&&s.ends_on<today)fail(400,'This schedule has ended. Extend the dates or create a new project from the client setup.');
  if(operation==='Resume'){const client=one(await tx`select client_id from erp_private.projects where project_id=${pid}`);await requireScheduleObligations(tx,{...s,starts_on:effective},client.client_id);}
  await tx`update erp_private.project_schedules set enabled=${operation==='Resume'},effective_from=${effective},version=version+1,updated_at=now() where project_id=${pid}`;
  return {ok:true,enabled:operation==='Resume',effective_from:effective};
 }
 if(p.action==='schedule_cancel'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must end a recurring service schedule.');const pid=uuid(p.project_id),reason=text(p.reason,1000);
  if(reason.length<3)fail(400,'Enter why future recurring work is being ended.');const s=one(await tx`select * from erp_private.project_schedules where project_id=${pid} and deleted_at is null for update`),project=one(await tx`select status from erp_private.projects where project_id=${pid} and deleted_at is null`);
  if(project.status==='Archived')fail(400,'This project is already archived.');if(String(s.version)!==revision(p.version))fail(409,'The schedule changed. Refresh the project before ending it.');
  const today=nairobiDate();if(!s.enabled&&s.ends_on<=today)fail(400,'This recurring schedule has already ended.');const end=s.ends_on<today?s.ends_on:s.starts_on>today?s.starts_on:today;
  await tx`update erp_private.project_schedules set enabled=false,ends_on=${end},effective_from=${today},version=version+1,updated_at=now() where project_id=${pid}`;
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'project_schedules','END_RECURRENCE',${pid},${tx.json({reason,ends_on:end,effective_from:today})})`;
  return {ok:true,enabled:false,ends_on:end};
 }
 if(p.action==='schedule_config_preview'){
  editor(a);const s=scheduleInput({...p,pack:p.pack||'Tax Compilation'});
  let cid=p.client_id?uuid(p.client_id):null;if(!cid&&p.project_id)cid=one(await tx`select client_id from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`).client_id;
  if(!cid)fail(400,'Choose the client before previewing its reporting schedule.');
  const firm=p.firm_id?uuid(p.firm_id):null;if(!firm)fail(400,'Choose the handling firm before previewing the reporting schedule.');
  await requireProjectSetup(tx,cid);if(!p.project_id)await requireRightChart(tx,cid,'creating the draft project');
  one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm} and deleted_at is null`);
  let existingSchedule=null;if(p.project_id){const project=one(await tx`select client_id,handling_firm_id from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`);if(project.client_id!==cid||project.handling_firm_id!==firm)fail(400,'Choose the client and handling firm assigned to this project.');existingSchedule=(await tx`select project_id from erp_private.project_schedules where project_id=${uuid(p.project_id)} and deleted_at is null limit 1`)[0]||null;}
  if(!existingSchedule&&s.pack==='Tax Compilation'&&s.frequency!=='Once-off'&&s.starts_on.slice(8,10)!=='01')fail(400,'Set recurring work to the first day of the client’s current reporting month. Earlier missing months can be added as one catch-up task.');
  return await previewSchedule(tx,s,cid);
 }
 if(p.action==='project_hub_page'){
  const pageSize=Number(p.page_size||25);if(!Number.isInteger(pageSize)||pageSize<1||pageSize>50)fail(400,'Choose a project page size from 1 to 50.');
  const yearText=String(p.year||nairobiDate().slice(0,4));if(!/^\d{4}$/.test(yearText)||Number(yearText)<2000||Number(yearText)>2200)fail(400,'Choose a valid reporting year.');
  const yearStart=`${yearText}-01-01`,yearEnd=`${Number(yearText)+1}-01-01`,firm=p.firm_id?uuid(p.firm_id):null,search=text(p.search||'',120,false),show=choice(p.show||'open',['open','overdue','all']);
  const timestamp=(value:any,label:string)=>{if(value==null||value==='')return null;if(typeof value!=='string'||value.length>40||!Number.isFinite(Date.parse(value)))fail(400,`The ${label} is invalid.`);return new Date(value).toISOString();};
  const snapshotInput=timestamp(p.snapshot_at,'project snapshot'),afterProjectId=p.after_project_id?uuid(p.after_project_id):null,afterName=p.after_name==null?null:text(p.after_name,300,false),afterOverdue=p.after_overdue==null||p.after_overdue===''?null:Number(p.after_overdue);
  if(afterOverdue!==null&&(!Number.isInteger(afterOverdue)||afterOverdue<0))fail(400,'The project page cursor is invalid. Restart the project list.');
  if([afterOverdue!==null,afterName!==null,!!afterProjectId].some(Boolean)&&![afterOverdue!==null,afterName!==null,!!afterProjectId].every(Boolean))fail(400,'The project page cursor is incomplete. Restart the project list.');
  const [snapshot]=await tx`select coalesce(${snapshotInput}::timestamptz,transaction_timestamp()) snapshot_at`;
  const fullAccess=['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code),intern=a.category_code==='INTERN',today=nairobiDate();
  const rows=await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,p.service_code,p.status,p.tax_master,p.revision,p.created_at,
    c.company_name,lower(c.company_name) sort_name,f.firm_code,
    (select to_jsonb(s) from erp_private.project_schedules s where s.project_id=p.project_id and s.deleted_at is null) schedule,
    board.periods,board.open_count,board.overdue_count,board.next_due,board.handler_sets,board.stage_sets
   from erp_private.projects p
   join erp_private.clients c using(client_id)
   join erp_private.firms f on f.firm_id=p.handling_firm_id
   cross join lateral (
    select coalesce(jsonb_agg(jsonb_build_object('work_period_id',w.work_period_id,'project_id',w.project_id,'period_kind',w.period_kind,'starts_on',w.starts_on,'ends_on',w.ends_on,'status',w.status,'open_count',counts.open_count,'overdue_count',counts.overdue_count) order by w.starts_on,w.period_kind),'[]'::jsonb) periods,
      coalesce(sum(counts.open_count),0)::int open_count,coalesce(sum(counts.overdue_count),0)::int overdue_count,
      min(counts.next_due) next_due,coalesce(jsonb_agg(counts.handlers),'[]'::jsonb) handler_sets,coalesce(jsonb_agg(counts.stages),'[]'::jsonb) stage_sets
    from erp_private.project_work_periods w
    cross join lateral (
     select count(distinct t.task_id) filter(where t.status not in ('Completed','Cancelled'))::int open_count,
       count(distinct t.task_id) filter(where t.status not in ('Completed','Cancelled') and (t.due_at at time zone 'Africa/Nairobi')::date<(now() at time zone 'Africa/Nairobi')::date)::int overdue_count,
       min(t.due_at) filter(where t.status not in ('Completed','Cancelled')) next_due,
       coalesce(jsonb_agg(t.assigned_to) filter(where t.status not in ('Completed','Cancelled') and t.assigned_to is not null),'[]'::jsonb) handlers,
       coalesce(jsonb_agg(case when tpr.profile is not null and tpr.profile<>'Supporting task' then tpr.stage else t.status end) filter(where t.status not in ('Completed','Cancelled')),'[]'::jsonb) stages
     from erp_private.work_period_tasks l join erp_private.tasks t using(task_id) left join erp_private.task_procedures tpr on tpr.task_id=t.task_id
     where l.work_period_id=w.work_period_id and t.deleted_at is null
      and (
       ${fullAccess}::boolean
       or (${!intern}::boolean and exists(select 1 from erp_private.project_assignments pa where pa.project_id=t.project_id and pa.staff_id=${a.staff_id} and pa.deleted_at is null and (pa.start_date is null or pa.start_date<=${today}::date) and (pa.end_date is null or pa.end_date>=${today}::date)))
       or t.assigned_to=${a.staff_id}
       or (${!intern}::boolean and (
        exists(select 1 from erp_private.task_procedures tp where tp.task_id=t.task_id and tp.reviewer_id=${a.staff_id} and tp.prepared_by<>${a.staff_id})
        or exists(select 1 from erp_private.project_schedules ps where ps.project_id=t.project_id and ps.deleted_at is null and ps.reviewer_id=${a.staff_id} and t.status='In Review')
       ))
      )
    ) counts
    where w.project_id=p.project_id and w.status='Open' and w.starts_on>=${yearStart}::date and w.starts_on<${yearEnd}::date
   ) board
   where p.deleted_at is null and c.deleted_at is null
    and p.created_at<=${snapshot.snapshot_at}::timestamptz
    and (${firm}::uuid is null or p.handling_firm_id=${firm}::uuid)
    and (${search}='' or c.company_name ilike ('%'||${search}||'%'))
    and jsonb_array_length(board.periods)>0
    and (${show}='all' or (${show}='open' and board.open_count>0) or (${show}='overdue' and board.overdue_count>0))
    and (${afterOverdue}::int is null or board.overdue_count<${afterOverdue}::int or (board.overdue_count=${afterOverdue}::int and (lower(c.company_name),p.project_id)>(${afterName}::text,${afterProjectId}::uuid)))
    and (
     ${fullAccess}::boolean
     or (${!intern}::boolean and exists(select 1 from erp_private.project_assignments pa where pa.project_id=p.project_id and pa.staff_id=${a.staff_id} and pa.deleted_at is null and (pa.start_date is null or pa.start_date<=${today}::date) and (pa.end_date is null or pa.end_date>=${today}::date)))
     or exists(select 1 from erp_private.tasks own where own.project_id=p.project_id and own.assigned_to=${a.staff_id} and own.deleted_at is null)
     or (${a.category_code!=='INTERN'}::boolean and (
      exists(select 1 from erp_private.task_procedures tp join erp_private.tasks rt using(task_id) where tp.project_id=p.project_id and tp.reviewer_id=${a.staff_id} and tp.prepared_by<>${a.staff_id} and rt.deleted_at is null)
      or exists(select 1 from erp_private.project_schedules ps join erp_private.tasks review_task using(project_id) where ps.project_id=p.project_id and ps.deleted_at is null and ps.reviewer_id=${a.staff_id} and review_task.status='In Review' and review_task.deleted_at is null)
     ))
    )
   order by board.overdue_count desc,lower(c.company_name),p.project_id limit ${pageSize+1}`;
  // Most overdue first, then client name. People and stages are tallied here so the browser needs no task list to draw a row.
  const tally=(sets:any,top:number)=>{const m=new Map<string,number>();for(const set of (Array.isArray(sets)?sets:[]))for(const v of (Array.isArray(set)?set:[]))if(v)m.set(String(v),(m.get(String(v))||0)+1);return [...m.entries()].sort((x,y)=>y[1]-x[1]||x[0].localeCompare(y[0])).slice(0,top);};
  const hasMore=rows.length>pageSize,items=rows.slice(0,pageSize).map((r:any)=>{const {handler_sets,stage_sets,sort_name,...rest}=r;return {...rest,sort_name,handlers:tally(handler_sets,50).map(([staff_id,tasks])=>({staff_id,tasks})),stages:tally(stage_sets,20).map(([stage,tasks])=>({stage,tasks}))};}),last=items[items.length-1]||null;
  return {snapshot_at:snapshot.snapshot_at,items,has_more:hasMore,next_cursor:hasMore&&last?{overdue_count:last.overdue_count,sort_name:last.sort_name,project_id:last.project_id}:null,page_size:pageSize,order:'overdue first, then client name'};
 }
 if(p.action==='project_detail_read'){
  const pid=uuid(p.project_id),fullAccess=['PARTNER','MANAGER'].includes(a.category_code),intern=a.category_code==='INTERN',today=nairobiDate();
  const project=one(await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,p.service_code,p.status,p.tax_master,p.revision,p.created_at,c.company_name,c.year_end_month,c.year_end_day,c.opening_balance_status,f.firm_code,f.legal_name
   from erp_private.projects p join erp_private.clients c using(client_id) join erp_private.firms f on f.firm_id=p.handling_firm_id
   where p.project_id=${pid} and p.deleted_at is null and c.deleted_at is null and (
    ${fullAccess}::boolean
    or (${!intern}::boolean and exists(select 1 from erp_private.project_assignments pa where pa.project_id=p.project_id and pa.staff_id=${a.staff_id} and pa.deleted_at is null and (pa.start_date is null or pa.start_date<=${today}::date) and (pa.end_date is null or pa.end_date>=${today}::date)))
    or exists(select 1 from erp_private.tasks own where own.project_id=p.project_id and own.assigned_to=${a.staff_id} and own.deleted_at is null)
    or (${a.category_code!=='INTERN'}::boolean and (
     exists(select 1 from erp_private.task_procedures tp join erp_private.tasks rt using(task_id) where tp.project_id=p.project_id and tp.reviewer_id=${a.staff_id} and tp.prepared_by<>${a.staff_id} and rt.deleted_at is null)
     or exists(select 1 from erp_private.project_schedules ps join erp_private.tasks review_task using(project_id) where ps.project_id=p.project_id and ps.deleted_at is null and ps.reviewer_id=${a.staff_id} and review_task.status='In Review' and review_task.deleted_at is null)
    ))
   )`);
  const [scheduleRow]=await tx`select * from erp_private.project_schedules where project_id=${pid} and deleted_at is null`;
  const periods=await tx`select * from erp_private.project_work_periods where project_id=${pid} and status='Open' order by starts_on desc,period_kind`;
  const tasks=await tx`select t.task_id,t.project_id,t.assigned_to,t.task_name,t.description,t.due_at,t.status,t.blocked_reason,t.revision,t.requires_document,t.period_start,t.period_end,t.template_key,t.filing_date,t.iso_week_year,t.iso_week_number from erp_private.tasks t where t.project_id=${pid} and t.deleted_at is null and (
   ${fullAccess}::boolean
   or (${!intern}::boolean and exists(select 1 from erp_private.project_assignments pa where pa.project_id=t.project_id and pa.staff_id=${a.staff_id} and pa.deleted_at is null and (pa.start_date is null or pa.start_date<=${today}::date) and (pa.end_date is null or pa.end_date>=${today}::date)))
   or t.assigned_to=${a.staff_id}
   or (${!intern}::boolean and (
    exists(select 1 from erp_private.task_procedures tp where tp.task_id=t.task_id and tp.reviewer_id=${a.staff_id} and tp.prepared_by<>${a.staff_id})
    or exists(select 1 from erp_private.project_schedules ps where ps.project_id=t.project_id and ps.deleted_at is null and ps.reviewer_id=${a.staff_id} and t.status='In Review')
   ))
  ) order by (t.status in ('Completed','Cancelled')),t.due_at nulls last,t.task_id`;
  const taskIds=tasks.map((t:any)=>t.task_id);
  const procedures=taskIds.length?await tx`select w.task_id,w.project_id,w.profile,w.stage,w.case_id,w.reviewer_id,w.prepared_by,w.closed_at,w.closed_by,w.revision from erp_private.task_procedures w where w.task_id=any(${taskIds}::uuid[])`:[];
  const periodTasks=taskIds.length?await tx`select l.* from erp_private.work_period_tasks l join erp_private.project_work_periods w using(work_period_id) where w.project_id=${pid} and w.status='Open' and l.task_id=any(${taskIds}::uuid[])`:[];
  const events=taskIds.length?await tx`select e.* from erp_private.task_events e where e.task_id=any(${taskIds}::uuid[]) order by e.created_at desc limit 500`:[];
  return {project,client:{client_id:project.client_id,company_name:project.company_name,year_end_month:project.year_end_month,year_end_day:project.year_end_day,opening_balance_status:project.opening_balance_status},firm:{firm_id:project.handling_firm_id,firm_code:project.firm_code,legal_name:project.legal_name},schedule:scheduleRow||null,work_periods:periods,tasks,task_procedures:procedures,work_period_tasks:periodTasks,task_events:events,task_count:tasks.length};
 }
 if(p.action==='project_save'){
  editor(a);const pid=p.project_id?uuid(p.project_id):crypto.randomUUID(),cid=uuid(p.client_id),firm=uuid(p.firm_id),service=text(p.service_code,40);
  const old=p.project_id?one(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null for update`):null;
  if(old&&(old.client_id!==cid||old.handling_firm_id!==firm))fail(400,'Create a separate project to change the client or handling firm.');
  if(old&&String(old.revision)!==revision(p.revision))fail(409,'Project changed. Refresh before editing.');
  if(old?.status==='Archived')fail(400,'Archived projects cannot be scheduled.');
  const c=one(await tx`select company_name,legal_entity_type,entity_evidence,year_end_month,year_end_day,opening_balance_status from erp_private.clients where client_id=${cid} and deleted_at is null`);
  const svc=one(await tx`select service_name from erp_private.services where service_code=${service} and is_active`);
  const s=scheduleInput(service==='TAX-COMP'?{...p,pack:'Tax Compilation'}:p),name=text(p.project_name||defaultProjectName(c.company_name,svc.service_name,s.starts_on),200);
  if(!old&&s.pack==='Tax Compilation'&&s.frequency!=='Once-off'&&s.starts_on.slice(8,10)!=='01')fail(400,'Set recurring work to the first day of the client’s current reporting month. Earlier missing months can be added as one catch-up task.');
  if(service!=='TAX-COMP'&&s.obligations.length)fail(400,'Recurring tax work must use the KRA Tax Compilation service.');
  if(p.require_schedule_preview===true){
   if(p.schedule_previewed!==true)fail(400,'Preview the task schedule before saving.');
   const preview=await previewSchedule(tx,s,cid);
   if(preview.due_now>12&&p.confirm_task_backlog!==true)fail(400,`The schedule would create ${preview.due_now} tasks now. Review the catch-up count and confirm, or change the start date.`);
  }
  const isTaxMaster=service==='TAX-COMP'&&s.pack==='Tax Compilation';
  if(old?.tax_master&&!isTaxMaster)fail(400,'A tax master project must remain the Tax Compilation master. Create a separate project for another service.');
  if(isTaxMaster){
   await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':'+firm+':tax-master'},0))`;
   const duplicate=(await tx`select project_id from erp_private.projects where client_id=${cid} and handling_firm_id=${firm} and tax_master and deleted_at is null and project_id<>${pid} limit 1`)[0];
   if(duplicate)fail(409,'A tax master project already exists for this client and handling firm. Open it and add reporting periods as tasks; do not create a separate project for each month.');
  }
  if(!old||s.enabled&&s.obligations.length)await requireProjectSetup(tx,cid);
  if(!old)await requireRightChart(tx,cid,'creating the draft project');
  one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm} and deleted_at is null`);
  // Partners can explicitly select any registered firm; other categories require existing firm access.
  if(a.category_code==='PARTNER')await tx`insert into erp_private.staff_firm_access(staff_id,firm_id) values(${a.staff_id},${firm}) on conflict(staff_id,firm_id) do update set deleted_at=null`;
  if(old)await tx`update erp_private.projects set project_name=${name},service_code=${service} where project_id=${pid}`;
  else await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${pid},${cid},${firm},${name},${service},${a.staff_id})`;
  if(isTaxMaster){
   if(s.assigned_to===s.reviewer_id)fail(400,'Choose a different Supervisor, Manager or Partner for independent review.');
   await tx`update erp_private.projects set tax_master=true where project_id=${pid}`;
  }
  await assign(tx,pid,firm,a.staff_id);await assign(tx,pid,firm,s.assigned_to);const reviewer=await assign(tx,pid,firm,s.reviewer_id);
  if(!projectEditor(reviewer))fail(400,'Choose a Partner, Manager or Supervisor as reviewer.');
  const prior=(await tx`select * from erp_private.project_schedules where project_id=${pid} for update`)[0];
  if(prior){
   const [catchupTask]=await tx`select task_id from erp_private.tasks where project_id=${pid} and recurring_key='catchup-upload' and deleted_at is null limit 1`;
   if(catchupTask&&(String(prior.catchup_starts_on||'')!==String(s.catchup_starts_on||'')||String(prior.catchup_ends_on||'')!==String(s.catchup_ends_on||'')))
    fail(400,'The one-time catch-up task has already been released. Keep its approved period range unchanged; create a separately reviewed follow-up task for any additional months.');
  }
  await requireScheduleObligations(tx,s,cid);
  const changed=!prior||['frequency','pack','starts_on','ends_on','enabled','assigned_to','reviewer_id','catchup_starts_on','catchup_ends_on'].some(k=>String(prior[k]||'').slice(0,k.endsWith('_on')?10:999)!==String((s as any)[k]||''))||JSON.stringify(prior.obligations.slice().sort())!==JSON.stringify(s.obligations.slice().sort());
  if(changed){
   const effective=prior?new Date(Date.parse(nairobiDate()+'T00:00:00Z')+86400000).toISOString().slice(0,10):s.starts_on;
   await tx`insert into erp_private.project_schedules(project_id,frequency,pack,starts_on,ends_on,effective_from,enabled,obligations,assigned_to,reviewer_id,catchup_starts_on,catchup_ends_on)
    values(${pid},${s.frequency},${s.pack},${s.starts_on},${s.ends_on},${effective},${s.enabled},${tx.array(s.obligations)},${s.assigned_to},${s.reviewer_id},${s.catchup_starts_on},${s.catchup_ends_on})
    on conflict(project_id) do update set frequency=excluded.frequency,pack=excluded.pack,starts_on=excluded.starts_on,ends_on=excluded.ends_on,effective_from=excluded.effective_from,
    enabled=excluded.enabled,obligations=excluded.obligations,assigned_to=excluded.assigned_to,reviewer_id=excluded.reviewer_id,
    catchup_starts_on=excluded.catchup_starts_on,catchup_ends_on=excluded.catchup_ends_on,version=project_schedules.version+1,updated_at=now()`;
  }
  const projectStatus=old?.status||'Draft',gate=projectStatus==='Active'?await projectTaskGate(tx,pid,cid,s.starts_on):{ready:false,reason:'Project is Draft. Its schedule is saved, but no tasks or reports are activated yet.'};
  const [r]=gate.ready&&projectStatus==='Active'?await tx`select erp_private.generate_project_tasks(${pid}::uuid) generated`:[{generated:0}];
  return {ok:true,project_id:pid,project_status:projectStatus,generated:r.generated,schedule_changed:changed,task_generation_blocked_reason:gate.ready?'':gate.reason};
 }
 if(p.action==='generate_tasks'){editor(a);const pid=uuid(p.project_id),project=one(await tx`select p.client_id,p.handling_firm_id,s.starts_on from erp_private.projects p left join erp_private.project_schedules s using(project_id) where p.project_id=${pid} and p.deleted_at is null`),gate=await projectTaskGate(tx,pid,project.client_id,project.starts_on||nairobiDate());if(!gate.ready)fail(400,gate.reason);return one(await tx`select erp_private.generate_project_tasks(${pid}::uuid) generated`);}
 if(p.action==='schedule_preview'){
  const s=one(await tx`select * from erp_private.project_schedules where project_id=${uuid(p.project_id)}`);
  const client=one(await tx`select c.year_end_month,c.year_end_day from erp_private.projects p join erp_private.clients c using(client_id) where p.project_id=${s.project_id}`);
  return {financial_year_end:{month:client.year_end_month,day:client.year_end_day},catchup_task:s.enabled&&s.catchup_starts_on?{starts_on:s.catchup_starts_on,ends_on:s.catchup_ends_on}:null,occurrences:await tx`select distinct on(o.release_at,o.template_key,o.period_start) o.* from (select * from erp_private.project_schedule_history where project_id=${s.project_id} and enabled union all select * from erp_private.project_schedules where project_id=${s.project_id} and enabled) v cross join lateral erp_private.schedule_occurrences(v.frequency,v.pack,v.starts_on,v.ends_on,v.effective_from,v.obligations,now()+interval '40 days',${client.year_end_month},${client.year_end_day}) o where o.release_at>now() order by o.release_at,o.template_key,o.period_start,v.version limit 100`};
 }
 if(p.action==='task_create'){
  editor(a);if(p.unassigned===true||!p.assigned_to)fail(400,'Assign this task to an Assistant. Tasks are not left unassigned.');
  const pid=uuid(p.project_id),sid=uuid(p.assigned_to),due=date(p.due_date);
  const assignee=one(await tx`select category_code,access_status from erp_private.staff_members where staff_id=${sid} and deleted_at is null`);
  if(assignee.category_code!=='ASSISTANT'||assignee.access_status!=='Active')fail(400,'Tasks are assigned to active Assistants only. Supervisors, Managers and Partners review, edit and reassign tasks.');
  if(!due)fail(400,'Choose a due date.');const project=one(await tx`select client_id,handling_firm_id,status from erp_private.projects where project_id=${pid}`);
  if(project.status==='Archived')fail(400,'Choose an open project.');
  // Every task has an expected time. The creator chooses a task type, which carries standard hours they are not shown.
  // Someone who may see expected hours can enter the hours directly instead.
  const sees=await seesTimeBudget(tx),direct=sees&&p.expected_hours!==undefined&&p.expected_hours!==null&&p.expected_hours!==''?expectedHours(p.expected_hours):null;
  const typeId=p.task_type_id?uuid(p.task_type_id):null;
  // Until the first task type is added there is nothing to choose, so work is not stopped: the task is created and listed for the selected Managers and Partners as having no expected hours.
  if(!typeId&&direct===null&&(await tx`select 1 from erp_private.task_type_names() limit 1`).length)fail(400,'Choose the task type. Every task needs one so that its expected time is set.');
  if(typeId&&!(await tx`select 1 from erp_private.task_type_names() where standard_id=${typeId}`).length)fail(400,'Choose a task type from the list.');
  const gate=await projectTaskGate(tx,pid,project.client_id,due);if(!gate.ready)fail(400,gate.reason);await assign(tx,pid,project.handling_firm_id,sid);
  const made=one(await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,description,due_at,requires_document,task_type_id) values(${pid},${sid},${text(p.task_name,200)},${text(p.description||'',2000,false)},${due+'T17:00:00+03:00'},${p.requires_document===true},${typeId}) returning task_id`);
  if(direct!==null)await setTaskHours(tx,a,made.task_id,direct,'Expected hours entered when the task was created.');
  return made;
 }
 if(p.action==='task_recipients')return {recipients:await tx`select * from erp_private.task_recipient_candidates(${uuid(p.task_id)}::uuid)`};
 if(p.action==='task_escalate'){
  const message=text(p.reason,1000);if(message.length<3)fail(400,'Enter a forwarding or escalation message (at least 3 characters).');
  await tx`select erp_private.route_task(${uuid(p.task_id)}::uuid,${uuid(p.assigned_to)}::uuid,${choice(p.operation||'Escalate',['Forward','Escalate'])},${message},${revision(p.revision)}::bigint)`;return {ok:true};
 }
 if(p.action==='task_types_list'){
  // Task type names for anyone creating a task. Hours are included only for the people who may see them.
  if(await seesTimeBudget(tx))return {can_see_hours:true,types:await tx`select standard_id,kind,match_key,label,expected_hours,active,revision from erp_private.standard_task_hours order by kind,label`};
  return {can_see_hours:false,types:(await tx`select standard_id,label from erp_private.task_type_names()`).map((t:any)=>({standard_id:t.standard_id,label:t.label}))};
 }
 if(p.action==='task_standard_save'){
  // The standard list: a task type chosen when a task is created by hand, or the standard time of a recurring task matched by its template key.
  await needTimeBudget(tx);const hours=expectedHours(p.expected_hours),label=text(p.label,200),kind=choice(p.kind||'Task type',['Task type','Recurring task']);
  if(label.length<3)fail(400,'Give the name in at least 3 characters.');
  if(p.standard_id){
   const rows=await tx`update erp_private.standard_task_hours set label=${label},expected_hours=${hours},active=${p.active!==false},updated_by=${a.staff_id},updated_at=now() where standard_id=${uuid(p.standard_id)} and revision=${revision(p.revision)} returning standard_id`;
   if(!rows.length)fail(409,'This standard was changed by someone else. Refresh first.');return {ok:true,standard_id:rows[0].standard_id};
  }
  const key=kind==='Recurring task'?text(p.match_key,200):label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  if(key.length<2)fail(400,kind==='Recurring task'?'Choose the recurring task this standard is for.':'Use letters or numbers in the name.');
  if((await tx`select 1 from erp_private.standard_task_hours where kind=${kind} and lower(match_key)=lower(${key})`).length)fail(400,'A standard with this name already exists. Edit that one.');
  const made=one(await tx`insert into erp_private.standard_task_hours(kind,match_key,label,expected_hours,created_by) values(${kind},${key},${label},${hours},${a.staff_id}) returning standard_id`);
  // A new recurring standard also fills open tasks of that kind that have no expected hours yet.
  let filled=0;if(kind==='Recurring task')filled=(await tx`insert into erp_private.task_expected_hours(task_id,expected_hours,source,standard_id) select t.task_id,${hours},'Standard',${made.standard_id} from erp_private.tasks t where lower(t.template_key)=lower(${key}) and t.deleted_at is null and t.status not in('Completed','Cancelled') and not exists(select 1 from erp_private.task_expected_hours e where e.task_id=t.task_id) returning task_id`).length;
  return {ok:true,standard_id:made.standard_id,tasks_filled:filled};
 }
 if(p.action==='task_hours_set'){
  // Expected hours on one task, with a reason. With save_as_standard, the same hours become the standard for that recurring task from now on.
  await needTimeBudget(tx);const tk=uuid(p.task_id),hours=expectedHours(p.expected_hours),reason=text(p.reason,1000);if(reason.length<10)fail(400,'Give the reason in at least 10 characters.');
  const t=one(await tx`select task_id,project_id,task_name,template_key from erp_private.tasks where task_id=${tk} and deleted_at is null`);
  const out=await setTaskHours(tx,a,tk,hours,reason);let standard:any=null;
  if(p.save_as_standard===true){
   if(!t.template_key)fail(400,'Only a recurring task can be saved as a standard. For other tasks, add a task type.');
   const label=String(t.task_name).split(' · ')[0].slice(0,200);
   const [had]=await tx`select standard_id from erp_private.standard_task_hours where kind='Recurring task' and lower(match_key)=lower(${t.template_key})`;
   if(had)await tx`update erp_private.standard_task_hours set expected_hours=${hours},active=true,updated_by=${a.staff_id},updated_at=now() where standard_id=${had.standard_id}`;
   const sid=had?had.standard_id:one(await tx`insert into erp_private.standard_task_hours(kind,match_key,label,expected_hours,created_by) values('Recurring task',${t.template_key},${label},${hours},${a.staff_id}) returning standard_id`).standard_id;
   const filled=await tx`insert into erp_private.task_expected_hours(task_id,expected_hours,source,standard_id) select x.task_id,${hours},'Standard',${sid} from erp_private.tasks x where lower(x.template_key)=lower(${t.template_key}) and x.deleted_at is null and x.status not in('Completed','Cancelled') and not exists(select 1 from erp_private.task_expected_hours e where e.task_id=x.task_id) returning task_id`;
   standard={standard_id:sid,tasks_filled:filled.length};
  }
  return {...out,standard,...(await projectHoursPosition(tx,t.project_id))};
 }
 if(p.action==='task_hours_review'){
  // For the people who may see expected hours: open tasks with none, and tasks whose logged time has passed the expected time.
  await needTimeBudget(tx);
  const rows=await tx`select t.task_id,t.task_name,t.project_id,t.assigned_to,t.status,t.due_at,t.template_key,e.expected_hours,e.source,erp_private.task_logged_hours(t.task_id) logged
   from erp_private.tasks t left join erp_private.task_expected_hours e using(task_id) where t.deleted_at is null and (t.status not in('Completed','Cancelled') or e.expected_hours is not null) order by t.due_at nulls last limit 2000`;
  const all=rows.map((r:any)=>({task_id:r.task_id,task_name:r.task_name,project_id:r.project_id,assigned_to:r.assigned_to,status:r.status,due_at:r.due_at,recurring:!!r.template_key,source:r.source||null,...taskPosition(r.expected_hours,r.logged)}));
  return {missing:all.filter((r:any)=>r.expected_hours===null),over:all.filter((r:any)=>r.over_hours>0).sort((x:any,y:any)=>y.over_hours-x.over_hours),with_hours:all.filter((r:any)=>r.expected_hours!==null).length};
 }
 if(p.action==='timesheet_summary'){
  // Expected against actual time for one person: the day, the week and the month that contain a date. Task expected hours are added only for the people who may see them.
  const sid=p.staff_id?uuid(p.staff_id):a.staff_id;if(sid!==a.staff_id&&!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'You can see your own time summary.');
  const on=date(p.date)||nairobiDate();if(!on)fail(400,'Choose a date.');
  const person=one(await tx`select staff_id,full_name,expected_daily_hours,expected_weekly_hours from erp_private.staff_members where staff_id=${sid} and deleted_at is null`);
  const pr=periods(on),from=pr.month.from<pr.week.from?pr.month.from:pr.week.from,to=pr.month.to>pr.week.to?pr.month.to:pr.week.to,day=(x:any)=>new Date(x).toISOString().slice(0,10);
  const holidays=(await tx`select holiday_date from erp_private.public_holidays where holiday_date between ${from} and ${to} and coalesce(is_working_day,false)=false`).map((h:any)=>day(h.holiday_date));
  const att=await tx`select work_date,status,clock_in,clock_out,break_minutes from erp_private.attendance where staff_id=${sid} and work_date between ${from} and ${to} and deleted_at is null`;
  const sheets=await tx`select work_date,hours,status from erp_private.timesheets where staff_id=${sid} and work_date between ${from} and ${to} and deleted_at is null and status<>'Rejected'`;
  const sees=await seesTimeBudget(tx),nbi=(x:any)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date(x));
  const tasks=sees?await tx`select t.due_at,e.expected_hours from erp_private.tasks t left join erp_private.task_expected_hours e using(task_id) where t.assigned_to=${sid} and t.deleted_at is null and t.status<>'Cancelled' and t.due_at is not null and (t.due_at at time zone 'Africa/Nairobi')::date between ${from} and ${to}`:[];
  const out:any={staff_id:sid,full_name:person.full_name,date:on,expected_daily_hours:Number(person.expected_daily_hours),expected_weekly_hours:Number(person.expected_weekly_hours),shows_task_hours:sees};
  for(const kind of ['day','week','month'] as const){const r=pr[kind],inR=(d:string)=>d>=r.from&&d<=r.to,mine=tasks.filter((t:any)=>inR(nbi(t.due_at)));
   out[kind]=compare({range:r,kind,daily:person.expected_daily_hours,weekly:person.expected_weekly_hours,holidays,
    leaveDates:att.filter((x:any)=>x.status==='On leave').map((x:any)=>day(x.work_date)),
    logged:sheets.filter((t:any)=>inR(day(t.work_date))).reduce((s:number,t:any)=>s+Number(t.hours),0),
    approved:sheets.filter((t:any)=>t.status==='Approved'&&inR(day(t.work_date))).reduce((s:number,t:any)=>s+Number(t.hours),0),
    attended:att.filter((x:any)=>x.clock_in&&x.clock_out&&inR(day(x.work_date))).reduce((s:number,x:any)=>s+Math.max(0,(new Date(x.clock_out).getTime()-new Date(x.clock_in).getTime())/3600000-Number(x.break_minutes||0)/60),0),
    taskHours:sees?{expected:mine.reduce((s:number,t:any)=>s+Number(t.expected_hours||0),0),missing:mine.filter((t:any)=>t.expected_hours===null).length}:null});}
  return out;
 }
 if(p.action==='timesheet_save'){
  const v=timeInput(draftOnly?{...p,status:'Draft'}:p),tid=!draftOnly&&p.timesheet_id?uuid(p.timesheet_id):null;
  const task=one(await tx`select task_id,project_id,assigned_to from erp_private.tasks where task_id=${v.task_id} and deleted_at is null`);
  if(task.assigned_to!==a.staff_id)fail(403,'Log time against your own assigned task.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':'+v.work_date},0))`;
  const [total]=await tx`select coalesce(sum(hours),0) hours from erp_private.timesheets where staff_id=${a.staff_id} and work_date=${v.work_date} and deleted_at is null and status<>'Rejected' and timesheet_id<>coalesce(${tid}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`;
  if(Number(total.hours)+v.hours>24)fail(400,'Total time for a day cannot exceed 24 hours.');
  // Partner time exemption: once a Partner has signed the Partner Time Policy, a Partner's own time is saved approved and locked (flagged auto-approved).
  const [ex]=!draftOnly&&a.category_code==='PARTNER'?await tx`select erp_private.partner_time_exempt() ok`:[{ok:false}];
  const auto=ex.ok===true,note='Partner time, auto-approved';
  if(tid){const rows=await tx`update erp_private.timesheets set work_date=${v.work_date},hours=${v.hours},description=${v.description},billable=${v.billable},status=${auto?'Approved':v.status},reviewed_by=${auto?a.staff_id:null},reviewed_at=${auto?new Date().toISOString():null},review_note=${auto?note:null},is_auto_approved=${auto}
   where timesheet_id=${tid} and staff_id=${a.staff_id} and task_id=${v.task_id} and revision=${revision(p.revision)} returning timesheet_id`;if(!rows.length)fail(409,'Only your draft or rejected time can be edited. Refresh first.');return {ok:true,auto_approved:auto};}
  // Recorded time is always the hours keyed in. A stopped timer may only be referenced as a suggestion, and only if it is this person's own, for this task.
  let timerSeconds:number|null=null;
  if(p.timer_seconds!==undefined&&p.timer_seconds!==null&&p.timer_seconds!==''){
   const tm=(await tx`select suggested_seconds from erp_private.task_timers where staff_id=${a.staff_id} and status='Stopped' and suggested_task_id=${v.task_id} and suggested_seconds=${Math.round(Number(p.timer_seconds))} and timesheet_id is null for update`)[0];
   if(tm)timerSeconds=tm.suggested_seconds;
  }
  const saved=one(await tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,timer_seconds,time_source,reviewed_by,reviewed_at,review_note,is_auto_approved) values(${a.staff_id},${task.project_id},${v.task_id},${v.work_date},${v.hours},${v.description},${v.billable},${auto?'Approved':v.status},${timerSeconds},${timerSeconds===null?'Manual':'Manual with timer'},${auto?a.staff_id:null},${auto?new Date().toISOString():null},${auto?note:null},${auto}) returning timesheet_id`);
  if(timerSeconds!==null)await tx`update erp_private.task_timers set timesheet_id=${saved.timesheet_id} where staff_id=${a.staff_id}`;
  return auto?{...saved,auto_approved:true}:saved;
 }
 if(p.action==='timesheet_review'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must review timesheets.');
  const status=choice(p.status,['Approved','Rejected']),note=text(p.review_note||'',2000,true);if(note.length<10)fail(400,'Record a review note of at least 10 characters.');
  const rows=await tx`update erp_private.timesheets set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note}
   where timesheet_id=${uuid(p.timesheet_id)} and staff_id<>${a.staff_id} and status='Submitted' and revision=${revision(p.revision)} returning timesheet_id`;
  if(!rows.length)fail(409,'This entry cannot be reviewed. Refresh the queue.');return {ok:true};
 }
 if(p.action==='timesheet_partner_list'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can see Partner time.');
  const days=Math.round(Number(p.days||90));if(!Number.isFinite(days)||days<1||days>730)fail(400,'Choose between 1 and 730 days.');
  return {entries:await tx`select * from erp_private.partner_time_list(${days}::integer)`};
 }
 if(p.action==='timesheet_reverse'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must reverse approved time.');
  const t=one(await tx`select * from erp_private.timesheets where timesheet_id=${uuid(p.timesheet_id)} and status='Approved' and reverses_id is null`);
  if(t.staff_id===a.staff_id)fail(403,t.is_auto_approved?'A second Partner must correct your auto-approved time.':'Another Manager must reverse your approved time.');
  if(t.is_auto_approved&&(a.category_code!=='PARTNER'||text(p.reason||'',2000,true).trim().length<10))fail(403,'Only a second Partner can correct a Partner\'s auto-approved time, with a reason of at least 10 characters.');
  return one(await tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,reviewed_by,reviewed_at,review_note,reverses_id)
   values(${t.staff_id},${t.project_id},${t.task_id},${t.work_date},${-Number(t.hours)},${text(p.reason,2000)},${t.billable},'Approved',${a.staff_id},now(),${text(p.reason,2000)},${t.timesheet_id}) returning timesheet_id`);
 }
 if(p.action==='project_report'){
  const pid=uuid(p.project_id),project=one(await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,p.status,ps.starts_on schedule_starts_on,c.company_name,c.year_end_month,c.year_end_day,c.opening_balance_status,c.opening_balance_note,
   exists(select 1 from erp_private.documents d where d.client_id=c.client_id and d.handling_firm_id=p.handling_firm_id and d.project_id is null and d.import_purpose='Opening TB' and d.archived_at is null and d.deleted_at is null) has_opening_tb_source,
   exists(select 1 from erp_private.ledger_periods lp join erp_private.ledger_journals j using(period_id) where lp.client_id=c.client_id and lp.starts_on<=coalesce(ps.starts_on,(now() at time zone 'Africa/Nairobi')::date) and lp.ends_on>=coalesce(ps.starts_on,(now() at time zone 'Africa/Nairobi')::date) and j.kind='Opening' and j.status='Posted') has_posted_opening
   from erp_private.projects p join erp_private.clients c using(client_id) left join erp_private.project_schedules ps on ps.project_id=p.project_id and ps.deleted_at is null where p.project_id=${pid} and p.deleted_at is null and c.deleted_at is null`);
  const [finance]=await tx`select erp_private.finance_allowed(${pid}::uuid) allowed`;
  const accounting=finance.allowed?await tx`select lp.period_id,lp.starts_on,lp.ends_on,lp.status,
    count(distinct j.journal_id) filter(where j.status='Posted')::int posted_journals,
    count(distinct j.journal_id) filter(where j.status in ('Draft','Submitted','Returned'))::int pending_journals,
    round(coalesce(sum(ll.debit) filter(where j.status='Posted'),0),2)::numeric posted_debits,
    round(coalesce(sum(ll.credit) filter(where j.status='Posted'),0),2)::numeric posted_credits
   from erp_private.ledger_periods lp left join erp_private.ledger_journals j on j.period_id=lp.period_id
   left join erp_private.ledger_lines ll on ll.journal_id=j.journal_id
   where lp.project_id=${pid} group by lp.period_id,lp.starts_on,lp.ends_on,lp.status order by lp.starts_on desc`:[];
  const invoices=finance.allowed?await tx`with invoice_totals as (
    select i.invoice_id,i.status,coalesce(i.recurring_period_start,i.invoice_date) period_start,i.net_amount,i.vat_amount,i.total_amount,coalesce(p.paid,0) paid
    from erp_private.invoices i left join lateral(select sum(x.amount) paid from erp_private.payments x where x.invoice_id=i.invoice_id)p on true
    where i.project_id=${pid} and i.deleted_at is null
   ) select period_start,status,count(*)::int invoice_count,coalesce(sum(net_amount),0)::numeric net,coalesce(sum(vat_amount),0)::numeric vat,
    coalesce(sum(total_amount),0)::numeric gross,coalesce(sum(paid),0)::numeric paid from invoice_totals group by period_start,status order by period_start desc,status`:[];
  const feeSchedules=finance.allowed?await tx`select fee_schedule_id,frequency,amount_ex_vat,vat_rate,description,starts_on,ends_on,status
   from erp_private.recurring_fee_schedules where project_id=${pid} order by starts_on desc`:[];
  const periodImports=await tx`select import_id,kind,starts_on,ends_on,status,prepared_by,reviewed_by,
    coalesce((payload->>'source_count')::int,0)::int source_rows,
    case when kind='Sales' then coalesce((select sum((g.value->>'net')::numeric) from jsonb_array_elements(coalesce(payload->'groups','[]'::jsonb)) as g(value)),0)
      else coalesce((payload #>> '{totals,gross}')::numeric,0) end net_or_gross,
    case when kind='Sales' then coalesce((select sum((g.value->>'vat')::numeric) from jsonb_array_elements(coalesce(payload->'groups','[]'::jsonb)) as g(value)),0)
      else coalesce((payload #>> '{totals,paye}')::numeric,0) end vat_or_paye,
    case when kind='Sales' then coalesce((select sum((g.value->>'gross')::numeric) from jsonb_array_elements(coalesce(payload->'groups','[]'::jsonb)) as g(value)),0)
      else coalesce((payload #>> '{totals,employer_nssf}')::numeric,0)+coalesce((payload #>> '{totals,employer_ahl}')::numeric,0)+coalesce((payload #>> '{totals,nita}')::numeric,0) end gross_or_employer_costs
   from erp_private.period_imports where project_id=${pid} and (kind='Sales' or ${!!finance.allowed}) order by starts_on desc,created_at desc limit 500`;
  const opening={status:project.opening_balance_status,note:project.opening_balance_note,source_staged:project.has_opening_tb_source,opening_journal_posted:project.has_posted_opening,task_gate_ready:project.opening_balance_status==='No opening balances'||project.has_posted_opening};
  return {tasks:await tx`select status,count(*)::int count,count(*) filter(where due_at<now() and status not in ('Completed','Cancelled'))::int overdue from erp_private.tasks where project_id=${pid} and deleted_at is null group by status`,
   task_periods:await tx`select period_start,period_end,status,count(*)::int tasks,count(*) filter(where due_at<now() and status not in ('Completed','Cancelled'))::int overdue
    from erp_private.tasks where project_id=${pid} and deleted_at is null and period_start is not null group by period_start,period_end,status order by period_start desc,status limit 500`,
   time:await tx`select staff_id,status,sum(hours) hours from erp_private.timesheets where project_id=${pid} and deleted_at is null group by staff_id,status`,
   imports:await tx`select dataset,period_start,period_end,sum(source_count) source_rows,sum(new_count) imported,sum(duplicate_count) duplicates,sum(rejected_count) rejected from erp_private.workbook_batches where project_id=${pid} and archived_at is null group by dataset,period_start,period_end order by period_start desc`,
   mapping:await tx`select b.period_start,b.period_end,r.route,r.category_code,count(*)::int rows from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and b.archived_at is null and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') group by b.period_start,b.period_end,r.route,r.category_code order by b.period_start desc`,
   project:{name:project.project_name,client:project.company_name,status:project.status,financial_year_start:project.schedule_starts_on,financial_year_end:project.year_end_month&&project.year_end_day?`${String(project.year_end_day).padStart(2,'0')}/${String(project.year_end_month).padStart(2,'0')}`:'Not set'},
   opening,accounting_available:!!finance.allowed,accounting,invoices,fee_schedules:feeSchedules,period_imports:periodImports};
 }
 return undefined;
}

