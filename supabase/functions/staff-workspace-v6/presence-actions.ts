import {fail,uuid,text,choice,date,revision} from './validation.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'This staff record or task is unavailable.');return r[0];};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Manager or Partner must access team attendance.');};
export function presenceLabel(p:any,attendance:any,now=Date.now()){
 if(!p||now-new Date(p.last_seen_at).getTime()>120000)return 'Offline';
 if(!attendance?.clock_in)return 'Not clocked in';if(attendance.clock_out)return 'Clocked out';if(p.manual_status==='Break')return 'On break';if(p.manual_status==='Meeting')return 'In meeting';
 return now-new Date(p.last_activity_at).getTime()<=300000?'Active':'Away';
}
export async function presenceAction(tx:any,a:any,p:any,context:any){
 if(p.action==='notification_read'){one(await tx`select notification_id from erp_private.notifications where notification_id=${uuid(p.notification_id)} and recipient_id=${a.staff_id}`);await tx`insert into erp_private.notification_reads(notification_id,staff_id) values(${p.notification_id},${a.staff_id}) on conflict do nothing`;return {ok:true};}
 if(!String(p.action).startsWith('presence_')&&!String(p.action).startsWith('timer_'))return undefined;
 const sid=a.staff_id,when=today();
 if(p.action==='presence_heartbeat'){
  const s={session_id:context.session_id,last_seen_at:new Date(Date.now()-Number(context.activity_age_ms||0))};
  await tx`insert into erp_private.staff_presence(staff_id,session_id,last_seen_at,last_activity_at) values(${sid},${s.session_id},now(),${s.last_seen_at}) on conflict(staff_id) do update set session_id=excluded.session_id,last_seen_at=now(),last_activity_at=case when ${context.activity_age_ms===null} then erp_private.staff_presence.last_activity_at else excluded.last_activity_at end`;
  const own=one(await tx`select * from erp_private.staff_presence where staff_id=${sid}`),attendance=(await tx`select * from erp_private.attendance where staff_id=${sid} and work_date=${when} and deleted_at is null`)[0]||null,timer=(await tx`select * from erp_private.task_timers where staff_id=${sid}`)[0]||null;
  return {presence:own,status:presenceLabel(own,attendance),attendance,timer,server_time:new Date().toISOString()};
 }
 if(p.action==='presence_state'){
  const state=choice(p.state,['Auto','Break','Meeting']);const att=one(await tx`select * from erp_private.attendance where staff_id=${sid} and work_date=${when} and clock_in is not null and clock_out is null for update`),old=one(await tx`select * from erp_private.staff_presence where staff_id=${sid} for update`);
  if(old.manual_status==='Break'&&old.break_started_at){const secs=Math.max(0,Math.floor((Date.now()-new Date(old.break_started_at).getTime())/1000));await tx`update erp_private.attendance set recorded_break_seconds=recorded_break_seconds+${secs} where attendance_id=${att.attendance_id}`;await tx`update erp_private.task_timers set paused_seconds=paused_seconds+greatest(0,extract(epoch from now()-paused_at)::int),paused_at=null where staff_id=${sid} and status='Running' and paused_at is not null`;}
  if(state==='Break')await tx`update erp_private.task_timers set paused_at=now() where staff_id=${sid} and status='Running' and paused_at is null`;
  await tx`update erp_private.staff_presence set manual_status=${state},break_started_at=case when ${state}='Break' then now() else null end where staff_id=${sid}`;return {ok:true};
 }
 if(p.action==='presence_clock_out'||p.action==='presence_force_out'){
  const target=p.action==='presence_force_out'?uuid(p.staff_id):sid;if(target!==sid)leader(a);
  await tx`select pg_advisory_xact_lock(hashtextextended(${target+':attendance'},0))`;
  const att=one(await tx`select * from erp_private.attendance where staff_id=${target} and work_date=${when} and clock_in is not null and clock_out is null and deleted_at is null for update`);
  let mins=Number(p.break_minutes||0);if(!Number.isInteger(mins)||mins<0||mins>480||mins>(Date.now()-new Date(att.clock_in).getTime())/60000)fail(400,'Check the actual break minutes.');
  const reason=target!==sid?text(p.reason,1000):'Staff clocked out manually.';
  await tx`update erp_private.attendance set clock_out=now(),break_minutes=${mins},reason=${reason},review_required=false,reviewed_by=${target!==sid?sid:null} where attendance_id=${att.attendance_id}`;
  await tx`update erp_private.staff_presence set manual_status='Auto',break_started_at=null where staff_id=${target}`;return {ok:true};
 }
 if(p.action==='timer_start'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${sid+':timer'},0))`;const task=one(await tx`select * from erp_private.tasks where task_id=${uuid(p.task_id)} and assigned_to=${sid} and deleted_at is null and status not in ('Completed','Cancelled')`);
  one(await tx`select attendance_id from erp_private.attendance where staff_id=${sid} and work_date=${when} and clock_in is not null and clock_out is null and deleted_at is null for update`);
  const presence=(await tx`select manual_status from erp_private.staff_presence where staff_id=${sid}`)[0];if(presence?.manual_status==='Break')fail(400,'Resume work before starting a task timer.');
  const old=(await tx`select * from erp_private.task_timers where staff_id=${sid} for update`)[0];if(old?.status==='Running')fail(400,'Stop the current task timer first.');
  await tx`insert into erp_private.task_timers(staff_id,task_id,started_at) values(${sid},${task.task_id},now()) on conflict(staff_id) do update set task_id=excluded.task_id,started_at=now(),stopped_at=null,paused_at=null,paused_seconds=0,status='Running',timesheet_id=null,notes=null`;return {ok:true};
 }
 if(p.action==='timer_stop'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${sid+':timer'},0))`;const timer=one(await tx`select * from erp_private.task_timers where staff_id=${sid} for update`);
  if(timer.status!=='Running')return {ok:true,timesheet_id:timer.timesheet_id,needs_review:timer.status==='Needs review'};
  const task=(await tx`select * from erp_private.tasks where task_id=${timer.task_id} and assigned_to=${sid} and deleted_at is null`)[0],date0=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date(timer.started_at));
  const seconds=Math.max(0,(Date.now()-new Date(timer.started_at).getTime())/1000-Number(timer.paused_seconds)-(timer.paused_at?(Date.now()-new Date(timer.paused_at).getTime())/1000:0)),hours=Math.round(seconds/36)/100;
  if(!task||date0!==when||hours>24){await tx`update erp_private.task_timers set stopped_at=now(),status='Needs review',notes='Confirm actual work date and hours manually; task or date changed.' where staff_id=${sid}`;return {ok:true,needs_review:true};}
  const [sum]=await tx`select coalesce(sum(hours),0) hours from erp_private.timesheets where staff_id=${sid} and work_date=${when} and status<>'Rejected' and deleted_at is null`;if(Number(sum.hours)+hours>24)fail(400,'Recorded time would exceed 24 hours. Review your existing timesheets.');
  let id=null;if(hours>0){const r=one(await tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status) values(${sid},${task.project_id},${task.task_id},${when},${hours},'Task timer draft — confirm actual work and description before submission.',true,'Draft') returning timesheet_id`);id=r.timesheet_id;}
  await tx`update erp_private.task_timers set stopped_at=now(),status='Stopped',timesheet_id=${id},notes='Stopped by staff. Draft time requires confirmation and independent approval.' where staff_id=${sid}`;return {ok:true,timesheet_id:id};
 }
 if(p.action==='presence_team'){
  leader(a);const rows=await tx`select s.staff_id,s.full_name,p.last_seen_at,p.last_activity_at,p.manual_status,a.clock_in,a.clock_out,a.review_required,t.task_id,t.status as timer_status,k.task_name from erp_private.staff_members s left join erp_private.staff_presence p using(staff_id) left join erp_private.attendance a on a.staff_id=s.staff_id and a.work_date=${when} left join erp_private.task_timers t on t.staff_id=s.staff_id and t.status='Running' left join erp_private.tasks k on k.task_id=t.task_id where s.deleted_at is null and s.access_status='Active' and erp_private.manages(s.staff_id) order by s.full_name limit 200`;
  return {rows:rows.map((r:any)=>({...r,status:presenceLabel(r.last_seen_at?r:null,r)})),updated_at:new Date().toISOString()};
 }
 if(p.action==='presence_report'){
  const start=date(p.starts_on),end=date(p.ends_on);if(!start||!end||end<start||Date.parse(end)-Date.parse(start)>180*86400000)fail(400,'Choose a range up to 180 days.');
  const att=await tx`select staff_id,sum(greatest(0,extract(epoch from clock_out-clock_in)/3600-break_minutes/60.0)) filter(where clock_out is not null and not review_required) as office_hours,count(*) filter(where review_required)::int pending_review from erp_private.attendance where work_date between ${start} and ${end} and deleted_at is null group by staff_id`;
  const time=await tx`select staff_id,sum(hours) as logged_hours,sum(hours) filter(where billable) as billable_hours,sum(hours) filter(where billable and status='Approved') as approved_billable_hours from erp_private.timesheets where work_date between ${start} and ${end} and deleted_at is null and status<>'Rejected' group by staff_id`;
  const ids=[...new Set([...att,...time].map((r:any)=>r.staff_id))];return {rows:ids.map(id=>{const x=att.find((r:any)=>r.staff_id===id)||{},t=time.find((r:any)=>r.staff_id===id)||{},office=Number(x.office_hours||0),logged=Number(t.logged_hours||0),billable=Number(t.billable_hours||0);return {staff_id:id,office_hours:office,logged_hours:logged,approved_billable_hours:Number(t.approved_billable_hours||0),unallocated_hours:office-logged,logged_billable_utilization:office?Math.round(billable/office*10000)/100:null,pending_attendance_review:x.pending_review||0};})};
 }
 if(p.action==='presence_note'){leader(a);const target=uuid(p.staff_id);one(await tx`select staff_id from erp_private.staff_members where staff_id=${target} and erp_private.manages(staff_id)`);await tx`insert into erp_private.notifications(recipient_id,message,event_key) values(${target},${'Staff note from '+a.full_name+': '+text(p.message,1000)},${crypto.randomUUID()})`;return {ok:true};}
 fail(404,'Unknown attendance or presence action.');
}
