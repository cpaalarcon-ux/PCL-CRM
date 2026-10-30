import {fail,text,uuid,date,revision,choice} from './validation.mjs';
import {projectEditor,scheduleInput,defaultProjectName,timeInput,nairobiDate,openingBalanceReady} from './workspace-rules.mjs';
const profileForScheduledWork:Record<string,string[]>={
 VAT:['VAT'],PAYE:['PAYE'],TOT:['TOT'],MRI:['MRI'],
 'Housing levy':['Housing levy'],SHIF:['SHIF'],NSSF:['NSSF'],NITA:['NITA'],
 'Fringe benefit':['Fringe benefit'],'Deemed interest':['Deemed interest']
};
const one=(r:any[])=>{if(!r.length)fail(403,'This record is not available to your account.');return r[0];};
const editor=(a:any)=>{if(!projectEditor(a))fail(403,'A Partner, Manager or Supervisor must manage this project.');};
async function requireOpeningBalanceSetup(tx:any,cid:string,firm?:string,effectiveOn?:string){
 const c=one(await tx`select legal_entity_type,entity_evidence,year_end_month,year_end_day,opening_balance_status from erp_private.clients where client_id=${cid} and deleted_at is null`);
 if(!c.legal_entity_type||String(c.entity_evidence||'').trim().length<10||!c.year_end_month||!c.year_end_day)fail(400,'Complete Clients → Entity / activities: confirm legal entity, supporting source and financial year-end before creating project work.');
 const accountDate=effectiveOn||nairobiDate(),[account]=await tx`select mapping_id from erp_private.client_account_mappings where client_id=${cid} and status='Active' and effective_from<=${accountDate} and (effective_to is null or effective_to>=${accountDate}) limit 1`;
 if(!account)fail(400,`Before creating project work, open Clients → Client accounts and approve at least one ERP account that covers ${accountDate}. Purchase and opening TB rows will still be checked against their own dates.`);
 const [source]=await tx`select document_id from erp_private.documents where client_id=${cid} and (${firm||null}::uuid is null or handling_firm_id=${firm||null}::uuid)
  and project_id is null and category='Import Sources' and import_purpose='Opening TB' and archived_at is null and deleted_at is null limit 1`;
 const [posted]=await tx`select j.journal_id from erp_private.ledger_journals j join erp_private.ledger_periods lp using(period_id)
  where lp.client_id=${cid} and j.kind='Opening' and j.status='Posted' limit 1`;
 if(!openingBalanceReady({status:c.opening_balance_status,hasSource:!!source,hasPostedOpening:!!posted}))fail(400,'Before creating a project or generating tasks, stage the approved prior-year opening TB in Documents → Import sources, or record why the client has no opening balances.');
}
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
async function previewSchedule(tx:any,s:any,cid:string){
 if(!s.enabled)return {enabled:false,total:0,due_now:0,upcoming:0,breakdown:[]};
 const client=one(await tx`select year_end_month,year_end_day from erp_private.clients where client_id=${cid} and deleted_at is null`);
 if(!client.year_end_month||!client.year_end_day)fail(400,'Set the client financial year-end before previewing tasks.');
 const through=`${s.ends_on}T23:59:59+03:00`;
 const occurrences=await tx`select template_key,task_name,period_start,period_end,release_at,release_at<=now() as due_now
  from erp_private.schedule_occurrences(${s.frequency},${s.pack},${s.starts_on},${s.ends_on},${s.starts_on},${tx.array(s.obligations)},${through}::timestamptz,${client.year_end_month},${client.year_end_day})
  order by release_at,template_key limit 2000`;
 const grouped=new Map<string,any>();for(const row of occurrences){const item=grouped.get(row.template_key)||{template_key:row.template_key,task_name:row.task_name,total:0,due_now:0,upcoming:0};item.total++;if(row.due_now)item.due_now++;else item.upcoming++;grouped.set(row.template_key,item);}
 const breakdown=[...grouped.values()];
 const total=breakdown.reduce((sum:number,row:any)=>sum+Number(row.total),0),due_now=breakdown.reduce((sum:number,row:any)=>sum+Number(row.due_now),0);
 return {enabled:true,total,due_now,upcoming:total-due_now,breakdown,financial_year_end:{month:client.year_end_month,day:client.year_end_day},periods:occurrences.slice(0,3).map((x:any)=>({start:x.period_start,end:x.period_end}))};
}
export async function workspaceAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action==='sector_save'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must add sectors.');
  const name=text(p.name,100),parent=p.parent_id?uuid(p.parent_id):null;
  return {sector:one(await tx`insert into erp_private.sectors(name,parent_id) values(${name},${parent}) returning sector_id,name,parent_id`)};
 }
 if(p.action==='schedule_state'){
  editor(a);const pid=uuid(p.project_id),operation=choice(p.operation,['Pause','Resume']),s=one(await tx`select * from erp_private.project_schedules where project_id=${pid} and deleted_at is null for update`),project=one(await tx`select status from erp_private.projects where project_id=${pid} and deleted_at is null`);
  if(project.status==='Archived')fail(400,'An archived project cannot resume recurring work.');if(String(s.version)!==revision(p.version))fail(409,'The schedule changed. Refresh the project before changing its status.');
  if(operation==='Pause'&&!s.enabled)return {ok:true,enabled:false};if(operation==='Resume'&&s.enabled)return {ok:true,enabled:true};
  const today=nairobiDate(),effective=operation==='Pause'?today:new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  if(operation==='Resume'&&s.ends_on<today)fail(400,'This schedule has ended. Extend the dates or create a new project from the client setup.');
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
  if(!cid)fail(400,'Choose the client before previewing its reporting schedule.');return await previewSchedule(tx,s,cid);
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
  if(service!=='TAX-COMP'&&s.obligations.length)fail(400,'Recurring tax work must use the KRA Tax Compilation service.');
  if(p.require_schedule_preview===true){
   if(p.schedule_previewed!==true)fail(400,'Preview the task schedule before saving.');
   const preview=await previewSchedule(tx,s,cid);
   if(preview.due_now>12&&p.confirm_task_backlog!==true)fail(400,`The schedule would create ${preview.due_now} tasks now. Review the catch-up count and confirm, or change the start date.`);
  }
  if(!old||s.enabled&&s.obligations.length)await requireOpeningBalanceSetup(tx,cid,firm,s.starts_on);
  one(await tx`select client_id from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm} and deleted_at is null`);
  // Partners can explicitly select any registered firm; other categories require existing firm access.
  if(a.category_code==='PARTNER')await tx`insert into erp_private.staff_firm_access(staff_id,firm_id) values(${a.staff_id},${firm}) on conflict(staff_id,firm_id) do update set deleted_at=null`;
  if(old)await tx`update erp_private.projects set project_name=${name},service_code=${service} where project_id=${pid}`;
  else await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${pid},${cid},${firm},${name},${service},${a.staff_id})`;
  if(service==='TAX-COMP'&&s.pack==='Tax Compilation'){
   if(s.assigned_to===s.reviewer_id)fail(400,'Choose a different Supervisor, Manager or Partner for independent review.');
   await tx`update erp_private.projects set tax_master=true where project_id=${pid}`;
  }
  await assign(tx,pid,firm,a.staff_id);await assign(tx,pid,firm,s.assigned_to);const reviewer=await assign(tx,pid,firm,s.reviewer_id);
  if(!projectEditor(reviewer))fail(400,'Choose a Partner, Manager or Supervisor as reviewer.');
  const prior=(await tx`select * from erp_private.project_schedules where project_id=${pid} for update`)[0];
  const newlyScheduled=s.obligations.filter((code:string)=>!prior?.obligations?.includes(code)&&code!=='Payroll');
  if(newlyScheduled.length){
   const profiles=await tx`select obligations from erp_private.client_tax_profiles where client_id=${cid} and status='Verified' and deleted_at is null and effective_from<=${s.starts_on} and effective_to>=${s.starts_on} order by effective_from desc limit 1`;
   if(!profiles.length){const needsProfile=newlyScheduled.filter((code:string)=>!['VAT','PAYE','TOT'].includes(code));if(needsProfile.length)fail(400,'Verify the client tax profile for the schedule start date before adding these recurring services.');}
   else {const confirmed=new Set<string>(profiles[0].obligations||[]);for(const code of newlyScheduled){const required=profileForScheduledWork[code]||[];if(!required.length||!required.some(item=>confirmed.has(item)))fail(400,`${code} is not confirmed in the verified client tax profile for ${s.starts_on}. Update the profile before scheduling this work.`);}}
  }
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
 if(p.action==='generate_tasks'){editor(a);const project=one(await tx`select p.client_id,p.handling_firm_id,s.starts_on from erp_private.projects p left join erp_private.project_schedules s using(project_id) where p.project_id=${uuid(p.project_id)} and p.deleted_at is null`);await requireOpeningBalanceSetup(tx,project.client_id,project.handling_firm_id,project.starts_on||nairobiDate());return one(await tx`select erp_private.generate_project_tasks(${uuid(p.project_id)}::uuid) generated`);}
 if(p.action==='schedule_preview'){
  const s=one(await tx`select * from erp_private.project_schedules where project_id=${uuid(p.project_id)}`);
  const client=one(await tx`select c.year_end_month,c.year_end_day from erp_private.projects p join erp_private.clients c using(client_id) where p.project_id=${s.project_id}`);
  return {financial_year_end:{month:client.year_end_month,day:client.year_end_day},occurrences:await tx`select distinct on(o.release_at,o.template_key,o.period_start) o.* from (select * from erp_private.project_schedule_history where project_id=${s.project_id} and enabled union all select * from erp_private.project_schedules where project_id=${s.project_id} and enabled) v cross join lateral erp_private.schedule_occurrences(v.frequency,v.pack,v.starts_on,v.ends_on,v.effective_from,v.obligations,now()+interval '40 days',${client.year_end_month},${client.year_end_day}) o where o.release_at>now() order by o.release_at,o.template_key,o.period_start,v.version limit 100`};
 }
 if(p.action==='task_create'){
  editor(a);const pid=uuid(p.project_id),sid=uuid(p.assigned_to),due=date(p.due_date);
  if(!due)fail(400,'Choose a due date.');const project=one(await tx`select client_id,handling_firm_id,status from erp_private.projects where project_id=${pid}`);
  if(project.status==='Archived')fail(400,'Choose an open project.');await requireOpeningBalanceSetup(tx,project.client_id,project.handling_firm_id,due);await assign(tx,pid,project.handling_firm_id,sid);
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
  const pid=uuid(p.project_id),project=one(await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,c.company_name,c.year_end_month,c.year_end_day,c.opening_balance_status,c.opening_balance_note,
   exists(select 1 from erp_private.documents d where d.client_id=c.client_id and d.handling_firm_id=p.handling_firm_id and d.project_id is null and d.import_purpose='Opening TB' and d.archived_at is null and d.deleted_at is null) has_opening_tb_source,
   exists(select 1 from erp_private.ledger_periods lp join erp_private.ledger_journals j using(period_id) where lp.client_id=c.client_id and j.kind='Opening' and j.status='Posted') has_posted_opening
   from erp_private.projects p join erp_private.clients c using(client_id) where p.project_id=${pid} and p.deleted_at is null and c.deleted_at is null`);
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
  const opening={status:project.opening_balance_status,note:project.opening_balance_note,source_staged:project.has_opening_tb_source,opening_journal_posted:project.has_posted_opening};
  return {tasks:await tx`select status,count(*)::int count,count(*) filter(where due_at<now() and status not in ('Completed','Cancelled'))::int overdue from erp_private.tasks where project_id=${pid} and deleted_at is null group by status`,
   task_periods:await tx`select period_start,period_end,status,count(*)::int tasks,count(*) filter(where due_at<now() and status not in ('Completed','Cancelled'))::int overdue
    from erp_private.tasks where project_id=${pid} and deleted_at is null and period_start is not null group by period_start,period_end,status order by period_start desc,status limit 500`,
   time:await tx`select staff_id,status,sum(hours) hours from erp_private.timesheets where project_id=${pid} and deleted_at is null group by staff_id,status`,
   imports:await tx`select dataset,period_start,period_end,sum(source_count) source_rows,sum(new_count) imported,sum(duplicate_count) duplicates,sum(rejected_count) rejected from erp_private.workbook_batches where project_id=${pid} and archived_at is null group by dataset,period_start,period_end order by period_start desc`,
   mapping:await tx`select b.period_start,b.period_end,r.route,r.category_code,count(*)::int rows from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and b.archived_at is null and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') group by b.period_start,b.period_end,r.route,r.category_code order by b.period_start desc`,
   project:{name:project.project_name,client:project.company_name,financial_year_end:project.year_end_month&&project.year_end_day?`${String(project.year_end_day).padStart(2,'0')}/${String(project.year_end_month).padStart(2,'0')}`:'Not set'},
   opening,accounting_available:!!finance.allowed,accounting,invoices,fee_schedules:feeSchedules,period_imports:periodImports};
 }
 return undefined;
}
