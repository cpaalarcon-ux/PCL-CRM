import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {allocatedHours,hoursBlock,workingDates,periods,compare}=await import('../supabase/functions/staff-workspace-v12/time-budget-rules.mjs');
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const {areaForStaffAction}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');

test('allocated hours rules: valid hours, the hard block, working days and the day, week and month comparison',()=>{
 assert.equal(allocatedHours('4'),4);assert.equal(allocatedHours(0.25),0.25);assert.equal(allocatedHours('',false),null);
 for(const bad of ['',null,0,0.1,-2,2001,'abc',1.234])assert.throws(()=>allocatedHours(bad),/hours/i);
 // No allocation: never blocked. Within the allocation: allowed, including exactly reaching it.
 assert.equal(hoursBlock(null,50,5),null);assert.equal(hoursBlock(4,0,4),null);assert.equal(hoursBlock(4,2.5,1.5),null);
 // One minute over is refused, and the message says what is left and what to do.
 assert.match(hoursBlock(4,2.5,1.51),/4 allocated hours and 2\.5 are already logged, so 1\.5 remain\. Log up to 1\.5 hours, or ask your Supervisor/);
 assert.match(hoursBlock(4,4,0.25),/All 4 hours allocated to this task have been logged\. Ask your Supervisor/);
 assert.match(hoursBlock(4,0,5),/so 4 remain/);
 // Monday 23 to Sunday 29 November 2026; a public holiday on a weekday is left out.
 assert.deepEqual(workingDates('2026-11-23','2026-11-29'),['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27']);
 assert.equal(workingDates('2026-12-21','2026-12-27',['2026-12-25']).length,4);
 assert.deepEqual(periods('2026-11-26'),{day:{from:'2026-11-26',to:'2026-11-26'},week:{from:'2026-11-23',to:'2026-11-29'},month:{from:'2026-11-01',to:'2026-11-30'}});
 const wk=compare({range:{from:'2026-11-23',to:'2026-11-29'},kind:'week',daily:8,weekly:40,holidays:[],leaveDates:['2026-11-27'],allocated:30,logged:28.5,approved:16,attended:33.25});
 assert.deepEqual(wk,{from:'2026-11-23',to:'2026-11-29',working_days:5,leave_days:1,expected_hours:32,allocated_hours:30,logged_hours:28.5,approved_hours:16,attended_hours:33.25,variance_hours:-3.5,percent_of_expected:89.1});
 assert.equal(compare({range:{from:'2026-11-01',to:'2026-11-30'},kind:'month',daily:8,weekly:40,holidays:[],leaveDates:[],allocated:0,logged:0,approved:0,attended:0}).expected_hours,168);
 assert.equal(compare({range:{from:'2026-11-28',to:'2026-11-28'},kind:'day',daily:8,weekly:40,holidays:[],leaveDates:[],allocated:0,logged:2,approved:0,attended:0}).percent_of_expected,null,'a Saturday expects no hours');
 assert.equal(areaForStaffAction('task_hours_set'),'projects');assert.equal(areaForStaffAction('timesheet_summary'),'time_hr');
});

const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),T1=id(),T0=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>workspaceAction(tx,a,p));
const nbi=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
test('allocated hours: time on a task is refused once it would pass the allocation, until a leader increases it with a reason',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'HRQA','Fictional hours firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','ASSISTANT2']){
  const cat=role.replace(/\d/,''),a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat,full_name:'Fictional '+role};
  await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;
  await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${a.full_name},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;
  await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;
  await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;
 }
 const A=actors.ASSISTANT.staff_id,A2=actors.ASSISTANT2.staff_id,M=actors.MANAGER.staff_id,S=actors.SUPERVISOR.staff_id;
 // The firm's decision is the default for everyone: 8 hours a day, 40 a week.
 assert.deepEqual((await tx`select expected_daily_hours::float8 d,expected_weekly_hours::float8 w from erp_private.staff_members where staff_id=${A}`)[0],{d:8,w:40});
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Hours Client',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional monthly tax','TAX-COMP',${M})`;
 for(const [s,r] of [[A,'ASSISTANT'],[A2,'ASSISTANT'],[M,'MANAGER'],[S,'SUPERVISOR']])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${s},${F},${r})`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,allocated_hours) values(${T1},${P},${A},'Capture sales',now(),4),(${T0},${P},${A},'Older task with no hours',now(),null)`;
 await assert.rejects(()=>tx`update erp_private.tasks set allocated_hours=0 where task_id=${T1}`,/check/i);
 const today=nbi(),log=(role,task,hours,extra={})=>act(role,{action:'timesheet_save',task_id:task,work_date:today,hours,description:'Fictional work done',status:'Submitted',...extra});
 // 1. Within the allocation time is saved; reaching it exactly is allowed; one step over is refused and nothing is saved.
 await log('ASSISTANT',T1,2.5);
 await assert.rejects(()=>log('ASSISTANT',T1,1.75),/4 allocated hours and 2\.5 are already logged, so 1\.5 remain/);
 await log('ASSISTANT',T1,1.5);
 await assert.rejects(()=>log('ASSISTANT',T1,0.25),/All 4 hours allocated to this task have been logged/);
 assert.equal(Number((await tx`select sum(hours) h from erp_private.timesheets where task_id=${T1}`)[0].h),4);
 // 2. A task created before the rule has no allocation and is not blocked.
 await log('ASSISTANT',T0,3);
 // 3. Editing an entry counts the new figure, not both: 1.5 can become 1 but not 2.
 const draft=(await tx`select timesheet_id,revision from erp_private.timesheets where task_id=${T1} and hours=1.5`)[0];
 await tx`update erp_private.timesheets set status='Draft' where timesheet_id=${draft.timesheet_id}`;
 const rev=(await tx`select revision from erp_private.timesheets where timesheet_id=${draft.timesheet_id}`)[0].revision;
 await assert.rejects(()=>log('ASSISTANT',T1,2,{timesheet_id:draft.timesheet_id,revision:rev}),/remain/);
 await log('ASSISTANT',T1,1,{timesheet_id:draft.timesheet_id,revision:rev});
 // 4. Only a Supervisor, Manager or Partner changes the allocation, with a reason, and never below what is logged.
 await assert.rejects(()=>act('ASSISTANT',{action:'task_hours_set',task_id:T1,allocated_hours:8,reason:'I need more time for this'}),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'task_hours_set',task_id:T1,allocated_hours:8,reason:'short'}),/10 characters/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'task_hours_set',task_id:T1,allocated_hours:3,reason:'Reduce the time on this task'}),/3\.5 hours are already logged/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'task_hours_set',task_id:T1,allocated_hours:4,reason:'No change to the hours here'}),/already has these/);
 const up=await act('SUPERVISOR',{action:'task_hours_set',task_id:T1,allocated_hours:6,reason:'More sales invoices than expected this month'});
 assert.equal(up.allocated_hours,6);assert.equal(up.logged_hours,3.5);assert.equal(up.project_warning,null);
 await log('ASSISTANT',T1,2.5);
 await assert.rejects(()=>log('ASSISTANT',T1,0.01),/All 6 hours/);
 const changes=await tx`select old_hours::float8 o,new_hours::float8 n,reason,changed_by from erp_private.task_hour_changes where task_id=${T1} order by created_at`;
 assert.deepEqual(changes.map(c=>[c.o,c.n]),[[4,6]]);assert.equal(changes[0].changed_by,S);
 // 5. Setting hours on the older task starts the block there too. The project budget warning appears once task hours pass it.
 await tx`insert into erp_private.project_budgets(project_id,agreed_fee,budgeted_hours,budgeted_cost,effective_from,reason,created_by) values(${P},50000,8,20000,current_date,'Fictional budget',${M})`;
 const first=await act('MANAGER',{action:'task_hours_set',task_id:T0,allocated_hours:3,reason:'Standard time for this older task'});
 assert.equal(first.project_allocated_hours,9);assert.match(first.project_warning,/add up to 9 allocated hours, more than the project budget of 8 hours/);
 await assert.rejects(()=>log('ASSISTANT',T0,0.5),/All 3 hours/);
 // 6. A rejected entry no longer counts, so its hours can be logged again.
 const one=(await tx`select timesheet_id from erp_private.timesheets where task_id=${T0}`)[0];
 await tx`update erp_private.timesheets set status='Rejected',reviewed_by=${M},reviewed_at=now(),review_note='Fictional rejection' where timesheet_id=${one.timesheet_id}`;
 await log('ASSISTANT',T0,3);
 // 7. The total counts everyone's time on the task, including a previous holder the new holder cannot see.
 const T2=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,allocated_hours) values(${T2},${P},${A2},'Shared task',now(),5)`;
 await log('ASSISTANT2',T2,4);await tx`update erp_private.tasks set assigned_to=${A} where task_id=${T2}`;
 await assert.rejects(()=>log('ASSISTANT',T2,2),/5 allocated hours and 4 are already logged, so 1 remain/);
 await log('ASSISTANT',T2,1);
 // 8. Expected against actual for the day, week and month.
 const sum=await act('ASSISTANT',{action:'timesheet_summary'});
 assert.equal(sum.expected_daily_hours,8);assert.equal(sum.expected_weekly_hours,40);
 const wd=new Date(today+'T00:00:00Z').getUTCDay(),weekday=wd!==0&&wd!==6;
 assert.equal(sum.day.expected_hours,weekday?8:0);assert.equal(sum.day.logged_hours,10,'6 on the first task, 3 on the older one, 1 on the shared one');
 assert.equal(sum.day.allocated_hours,14,'6 + 3 + 5 allocated on tasks due today');assert.equal(sum.week.expected_hours,40);assert.ok(sum.month.expected_hours>=160);
 assert.equal(sum.day.variance_hours,weekday?2:10);assert.equal(sum.week.logged_hours,10);
 await assert.rejects(()=>act('ASSISTANT',{action:'timesheet_summary',staff_id:A2}),/your own/);
 assert.equal((await act('MANAGER',{action:'timesheet_summary',staff_id:A2})).day.logged_hours,4);
 // 9. A new task needs allocated hours.
 await assert.rejects(()=>act('MANAGER',{action:'task_create',project_id:P,assigned_to:A,task_name:'New fictional task',due_date:today}),/Enter the hours allocated|not ready|before/i);
});
test('allocated hours on the screens: the task form asks for them and the time form shows what is left',()=>{
 const v6=fs.readFileSync(root+'/staff-workspace-v6.mjs','utf8'),pilot=fs.readFileSync(root+'/staff-pilot.mjs','utf8'),read=fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/workspace-read.ts','utf8');
 assert.match(v6,/field\('allocated_hours','Allocated hours \*'/);assert.match(pilot,/field\('allocated_hours','Allocated hours \*'/);
 assert.match(v6,/h left of/);assert.match(v6,/action:'task_hours_set'/);assert.match(v6,/action:'timesheet_summary'/);assert.match(v6,/data-v6="time-summary"/);
 assert.match(read,/t\.allocated_hours,\(case when t\.allocated_hours is null then null else erp_private\.task_logged_hours\(t\.task_id\) end\) logged_hours/);
});
