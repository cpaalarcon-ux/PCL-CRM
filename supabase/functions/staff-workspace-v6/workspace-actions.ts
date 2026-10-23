import {fail,text,uuid,date,revision,choice} from './validation.mjs';
import {projectEditor,scheduleInput,defaultProjectName,timeInput,nairobiDate} from './workspace-rules.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'This record is not available to your account.');return r[0];};
const editor=(a:any)=>{if(!projectEditor(a))fail(403,'A Partner, Manager or Supervisor must manage this project.');};
async function assign(tx:any,pid:string,firm:string,sid:string){
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
export async function workspaceAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action==='sector_save'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must add sectors.');
  const name=text(p.name,100),parent=p.parent_id?uuid(p.parent_id):null;
  return {sector:one(await tx`insert into erp_private.sectors(name,parent_id) values(${name},${parent}) returning sector_id,name,parent_id`)};
 }
 if(p.action==='project_save'){
  editor(a);const pid=p.project_id?uuid(p.project_id):crypto.randomUUID(),cid=uuid(p.client_id),firm=uuid(p.firm_id),service=text(p.service_code,40);
  const old=p.project_id?one(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null for update`):null;
  if(old&&(old.client_id!==cid||old.handling_firm_id!==firm))fail(400,'Create a separate project to change the client or handling firm.');
  if(old&&String(old.revision)!==revision(p.revision))fail(409,'Project changed. Refresh before editing.');
  if(old?.status==='Archived')fail(400,'Archived projects cannot be scheduled.');
  const c=one(await tx`select company_name from erp_private.clients where client_id=${cid} and deleted_at is null`);
  const svc=one(await tx`select service_name from erp_private.services where service_code=${service} and is_active`);
  const s=scheduleInput(p),name=text(p.project_name||defaultProjectName(c.company_name,svc.service_name,s.starts_on),200);
  one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm} and deleted_at is null`);
  // Partners can explicitly select any registered firm; other categories require existing firm access.
  if(a.category_code==='PARTNER')await tx`insert into erp_private.staff_firm_access(staff_id,firm_id) values(${a.staff_id},${firm}) on conflict(staff_id,firm_id) do update set deleted_at=null`;
  if(old)await tx`update erp_private.projects set project_name=${name},service_code=${service} where project_id=${pid}`;
  else await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${pid},${cid},${firm},${name},${service},${a.staff_id})`;
  await assign(tx,pid,firm,a.staff_id);await assign(tx,pid,firm,s.assigned_to);const reviewer=await assign(tx,pid,firm,s.reviewer_id);
  if(!projectEditor(reviewer))fail(400,'Choose a Partner, Manager or Supervisor as reviewer.');
  const prior=(await tx`select * from erp_private.project_schedules where project_id=${pid} for update`)[0];
  const changed=!prior||['frequency','pack','starts_on','ends_on','enabled','assigned_to','reviewer_id'].some(k=>String(prior[k]).slice(0,k.endsWith('_on')?10:999)!==String((s as any)[k]))||JSON.stringify(prior.obligations.slice().sort())!==JSON.stringify(s.obligations.slice().sort());
  if(changed){
   const effective=prior?new Date(Date.parse(nairobiDate()+'T00:00:00Z')+86400000).toISOString().slice(0,10):s.starts_on;
   await tx`insert into erp_private.project_schedules(project_id,frequency,pack,starts_on,ends_on,effective_from,enabled,obligations,assigned_to,reviewer_id)
    values(${pid},${s.frequency},${s.pack},${s.starts_on},${s.ends_on},${effective},${s.enabled},${tx.array(s.obligations)},${s.assigned_to},${s.reviewer_id})
    on conflict(project_id) do update set frequency=excluded.frequency,pack=excluded.pack,starts_on=excluded.starts_on,ends_on=excluded.ends_on,effective_from=excluded.effective_from,
    enabled=excluded.enabled,obligations=excluded.obligations,assigned_to=excluded.assigned_to,reviewer_id=excluded.reviewer_id,version=project_schedules.version+1,updated_at=now()`;
  }
  const [r]=await tx`select erp_private.generate_project_tasks(${pid}::uuid) generated`;return {ok:true,project_id:pid,generated:r.generated,schedule_changed:changed};
 }
 if(p.action==='generate_tasks'){editor(a);return one(await tx`select erp_private.generate_project_tasks(${uuid(p.project_id)}::uuid) generated`);}
 if(p.action==='schedule_preview'){
  const s=one(await tx`select * from erp_private.project_schedules where project_id=${uuid(p.project_id)}`);
  return {occurrences:await tx`select distinct on(o.release_at,o.template_key,o.period_start) o.* from (select * from erp_private.project_schedule_history where project_id=${s.project_id} and enabled union all select * from erp_private.project_schedules where project_id=${s.project_id} and enabled) v cross join lateral erp_private.schedule_occurrences(v.frequency,v.pack,v.starts_on,v.ends_on,v.effective_from,v.obligations,now()+interval '40 days') o where o.release_at>now() order by o.release_at,o.template_key,o.period_start,v.version limit 100`};
 }
 if(p.action==='task_create'){
  editor(a);const pid=uuid(p.project_id),sid=uuid(p.assigned_to),due=date(p.due_date);
  if(!due)fail(400,'Choose a due date.');const project=one(await tx`select handling_firm_id,status from erp_private.projects where project_id=${pid}`);
  if(project.status==='Archived')fail(400,'Choose an open project.');await assign(tx,pid,project.handling_firm_id,sid);
  return one(await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,description,due_at,requires_document) values(${pid},${sid},${text(p.task_name,200)},${text(p.description||'',2000,false)},${due+'T17:00:00+03:00'},${p.requires_document===true}) returning task_id`);
 }
 if(p.action==='task_recipients')return {recipients:await tx`select * from erp_private.task_recipient_candidates(${uuid(p.task_id)}::uuid)`};
 if(p.action==='task_escalate'){
  const message=text(p.reason,1000);if(message.length<3)fail(400,'Enter a forwarding or escalation message (at least 3 characters).');
  await tx`select erp_private.route_task(${uuid(p.task_id)}::uuid,${uuid(p.assigned_to)}::uuid,${choice(p.operation||'Escalate',['Forward','Escalate'])},${message},${revision(p.revision)}::bigint)`;return {ok:true};
 }
 if(p.action==='timesheet_save'){
  const v=timeInput(p),tid=p.timesheet_id?uuid(p.timesheet_id):null;
  const task=one(await tx`select task_id,project_id,assigned_to from erp_private.tasks where task_id=${v.task_id} and deleted_at is null`);
  if(task.assigned_to!==a.staff_id)fail(403,'Log time against your own assigned task.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':'+v.work_date},0))`;
  const [total]=await tx`select coalesce(sum(hours),0) hours from erp_private.timesheets where staff_id=${a.staff_id} and work_date=${v.work_date} and deleted_at is null and status<>'Rejected' and timesheet_id<>coalesce(${tid}::uuid,'00000000-0000-0000-0000-000000000000'::uuid)`;
  if(Number(total.hours)+v.hours>24)fail(400,'Total time for a day cannot exceed 24 hours.');
  if(tid){const rows=await tx`update erp_private.timesheets set work_date=${v.work_date},hours=${v.hours},description=${v.description},billable=${v.billable},status=${v.status},reviewed_by=null,reviewed_at=null,review_note=null
   where timesheet_id=${tid} and staff_id=${a.staff_id} and task_id=${v.task_id} and revision=${revision(p.revision)} returning timesheet_id`;if(!rows.length)fail(409,'Only your draft or rejected time can be edited. Refresh first.');return {ok:true};}
  return one(await tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status) values(${a.staff_id},${task.project_id},${v.task_id},${v.work_date},${v.hours},${v.description},${v.billable},${v.status}) returning timesheet_id`);
 }
 if(p.action==='timesheet_review'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must review timesheets.');
  const status=choice(p.status,['Approved','Rejected']),note=text(p.review_note||'',2000,status==='Rejected');
  const rows=await tx`update erp_private.timesheets set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note}
   where timesheet_id=${uuid(p.timesheet_id)} and staff_id<>${a.staff_id} and status='Submitted' and revision=${revision(p.revision)} returning timesheet_id`;
  if(!rows.length)fail(409,'This entry cannot be reviewed. Refresh the queue.');return {ok:true};
 }
 if(p.action==='timesheet_reverse'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must reverse approved time.');
  const t=one(await tx`select * from erp_private.timesheets where timesheet_id=${uuid(p.timesheet_id)} and status='Approved' and reverses_id is null`);
  if(t.staff_id===a.staff_id)fail(403,'Another Manager must reverse your approved time.');
  return one(await tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,reviewed_by,reviewed_at,review_note,reverses_id)
   values(${t.staff_id},${t.project_id},${t.task_id},${t.work_date},${-Number(t.hours)},${text(p.reason,2000)},${t.billable},'Approved',${a.staff_id},now(),${text(p.reason,2000)},${t.timesheet_id}) returning timesheet_id`);
 }
 if(p.action==='project_report'){
  const pid=uuid(p.project_id);one(await tx`select project_id from erp_private.projects where project_id=${pid}`);
  return {tasks:await tx`select status,count(*)::int count,count(*) filter(where due_at<now() and status not in ('Completed','Cancelled'))::int overdue from erp_private.tasks where project_id=${pid} and deleted_at is null group by status`,
   time:await tx`select staff_id,status,sum(hours) hours from erp_private.timesheets where project_id=${pid} and deleted_at is null group by staff_id,status`,
   imports:await tx`select dataset,sum(source_count) source_rows,sum(new_count) imported,sum(duplicate_count) duplicates,sum(rejected_count) rejected from erp_private.workbook_batches where project_id=${pid} group by dataset`,
   mapping:await tx`select route,category_code,count(*)::int rows from erp_private.workbook_rows where project_id=${pid} and dataset in ('Purchases','Expenditure','Non-eTIMS') group by route,category_code`};
 }
 return undefined;
}
