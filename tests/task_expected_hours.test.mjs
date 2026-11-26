import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {expectedHours,taskPosition,workingDates,periods,compare}=await import('../supabase/functions/staff-workspace-v12/time-budget-rules.mjs');
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const {readWorkspace}=await import('../supabase/functions/staff-workspace-v12/workspace-read.ts');
const {areaForStaffAction}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');

test('expected hours rules: valid hours, a task position, working days and the day, week and month comparison',()=>{
 assert.equal(expectedHours('4'),4);assert.equal(expectedHours(0.25),0.25);assert.equal(expectedHours('',false),null);
 for(const bad of ['',null,0,0.1,-2,2001,'abc',1.234])assert.throws(()=>expectedHours(bad),/hours/i);
 assert.deepEqual(taskPosition(4,2.5),{expected_hours:4,logged_hours:2.5,over_hours:0,percent_used:62.5,status:'Within expected'});
 assert.deepEqual(taskPosition(4,4),{expected_hours:4,logged_hours:4,over_hours:0,percent_used:100,status:'Within expected'});
 assert.deepEqual(taskPosition(4,5.5),{expected_hours:4,logged_hours:5.5,over_hours:1.5,percent_used:137.5,status:'Over expected'});
 assert.deepEqual(taskPosition(null,3),{expected_hours:null,logged_hours:3,over_hours:null,status:'No expected hours'});
 assert.deepEqual(workingDates('2026-11-23','2026-11-29'),['2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27']);
 assert.equal(workingDates('2026-12-21','2026-12-27',['2026-12-25']).length,4);
 assert.deepEqual(periods('2026-11-26'),{day:{from:'2026-11-26',to:'2026-11-26'},week:{from:'2026-11-23',to:'2026-11-29'},month:{from:'2026-11-01',to:'2026-11-30'}});
 const base={range:{from:'2026-11-23',to:'2026-11-29'},kind:'week',daily:8,weekly:40,holidays:[],leaveDates:['2026-11-27'],logged:28.5,approved:16,attended:33.25};
 // Someone who may not see task hours gets no task figure at all, not a zero.
 assert.deepEqual(compare(base),{from:'2026-11-23',to:'2026-11-29',working_days:5,leave_days:1,expected_hours:32,logged_hours:28.5,approved_hours:16,attended_hours:33.25,variance_hours:-3.5,percent_of_expected:89.1});
 assert.deepEqual(compare({...base,taskHours:{expected:30,missing:2}}),{from:'2026-11-23',to:'2026-11-29',working_days:5,leave_days:1,expected_hours:32,logged_hours:28.5,approved_hours:16,attended_hours:33.25,variance_hours:-3.5,percent_of_expected:89.1,task_expected_hours:30,tasks_without_hours:2});
 assert.equal(compare({...base,range:{from:'2026-11-01',to:'2026-11-30'},kind:'month',leaveDates:[]}).expected_hours,168);
 assert.equal(compare({...base,range:{from:'2026-11-28',to:'2026-11-28'},kind:'day',leaveDates:[]}).percent_of_expected,null,'a Saturday expects no hours');
 for(const a of ['task_hours_set','task_types_list','task_standard_save','task_hours_review'])assert.equal(areaForStaffAction(a),'projects');assert.equal(areaForStaffAction('timesheet_summary'),'time_hr');
});

const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),T1=id(),T0=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>workspaceAction(tx,a,p));
const nbi=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
test('expected hours: hidden from the people doing the work, never a block, flagged to Partners and selected Managers',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'HRQA','Fictional hours firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','ASSISTANT2']){
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
 for(const [s,r] of [[A,'ASSISTANT'],[A2,'ASSISTANT'],[M,'MANAGER'],[actors.MANAGER2.staff_id,'MANAGER'],[S,'SUPERVISOR']])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${s},${F},${r})`;
 await db.exec(`alter table erp_private.clients disable trigger user`);await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional new client, nothing brought forward',opening_balance_confirmed_by=${M},opening_balance_confirmed_at=now() where client_id=${C}`;await db.exec(`alter table erp_private.clients enable trigger user`);
 await db.exec(`alter table erp_private.projects disable trigger user;update erp_private.projects set status='Active';alter table erp_private.projects enable trigger user;`);
 await db.exec(`alter table erp_private.staff_members disable trigger user`);await tx`update erp_private.staff_members set manager_id=${actors.MANAGER2.staff_id} where staff_id in(${A},${A2})`;await tx`update erp_private.staff_members set manager_id=${M} where staff_id=${actors.MANAGER2.staff_id}`;await db.exec(`alter table erp_private.staff_members enable trigger user`);
 const today=nbi(),log=(role,task,hours,extra={})=>act(role,{action:'timesheet_save',task_id:task,work_date:today,hours,description:'Fictional work done',status:'Submitted',...extra});
 const create=(role,extra={})=>act(role,{action:'task_create',project_id:P,assigned_to:A,task_name:'Fictional task '+id().slice(0,6),due_date:today,...extra});
 const hours=async task=>{const [r]=await tx`select expected_hours::float8 h,source from erp_private.task_expected_hours where task_id=${task}`;return r||null;};
 const noHours=o=>assert.ok(!/expected_hours|logged_hours|over_hours|percent_used|"hours"/.test(JSON.stringify(o)),'no hours in: '+JSON.stringify(o));

 // 1. Who holds the right. Partners by rank; a Manager only when a Partner selects them; never a Supervisor or an Assistant.
 const sees=role=>as(role,async()=>(await tx`select erp_private.sees_time_budget() ok`)[0].ok);
 assert.equal(await sees('PARTNER'),true);for(const r of ['MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])assert.equal(await sees(r),false,r);
 const end=new Date(Date.now()+200*86400000).toISOString().slice(0,10),grant=(to,cap='TIME_BUDGET')=>as('PARTNER',()=>tx`select erp_private.staff_right_grant(${to}::uuid,${cap},'Fictional reason: selected to manage task hours',${end}::date)`);
 await assert.rejects(()=>grant(S),/selected Managers/);await assert.rejects(()=>grant(A),/selected Managers/);
 await grant(M);assert.equal(await sees('MANAGER'),true);assert.equal(await sees('MANAGER2'),false,'a Manager who was not selected does not see hours');

 // 2. Before any task type exists, work is not stopped: a task is created with no expected hours and is listed as missing for the holders.
 const first=await create('MANAGER2');assert.equal(await hours(first.task_id),null);
 for(const r of ['SUPERVISOR','MANAGER2','ASSISTANT'])await assert.rejects(()=>act(r,{action:'task_standard_save',label:'Sales capture',expected_hours:4}),/Engagement Partners and the Managers they have selected/);

 // 3. The standard list. Holders keep it; everyone else gets the names only.
 const st=await act('MANAGER',{action:'task_standard_save',label:'Sales capture',expected_hours:4});
 await act('PARTNER',{action:'task_standard_save',label:'VAT return',expected_hours:2.5});
 await assert.rejects(()=>act('PARTNER',{action:'task_standard_save',label:'sales capture',expected_hours:9}),/already exists/);
 await assert.rejects(()=>act('PARTNER',{action:'task_standard_save',label:'Payroll',expected_hours:0}),/Expected hours must be between/);
 const forSup=await act('SUPERVISOR',{action:'task_types_list'});assert.equal(forSup.can_see_hours,false);assert.deepEqual(forSup.types.map(t=>t.label),['Sales capture','VAT return']);noHours(forSup.types);
 const forMgr=await act('MANAGER',{action:'task_types_list'});assert.equal(forMgr.can_see_hours,true);assert.equal(Number(forMgr.types.find(t=>t.label==='VAT return').expected_hours),2.5);
 assert.equal((await as('SUPERVISOR',()=>tx`select * from erp_private.standard_task_hours`)).length,0,'row security hides the standard list from the table itself');

 // 4. Creating a task now needs a task type. The creator is not shown the hours; the task takes them on its own.
 await assert.rejects(()=>create('MANAGER2'),/Choose the task type/);
 await assert.rejects(()=>create('MANAGER2',{task_type_id:id()}),/Choose a task type from the list/);
 const made=await create('MANAGER2',{task_type_id:st.standard_id}),T1=made.task_id;noHours(made);
 assert.deepEqual(await hours(T1),{h:4,source:'Standard'});
 // Someone without the right who sends hours is ignored: only the holders may enter hours directly.
 const sneaky=await create('MANAGER2',{task_type_id:st.standard_id,expected_hours:99});assert.equal((await hours(sneaky.task_id)).h,4);
 const direct=await create('MANAGER',{expected_hours:6.5});assert.deepEqual(await hours(direct.task_id),{h:6.5,source:'Set'});

 // 5. Hidden from the people doing the work, everywhere they could look.
 for(const r of ['ASSISTANT','SUPERVISOR','MANAGER2']){
  const ws=await as(r,a=>readWorkspace(tx,a)),t=ws.tasks.find(t=>t.task_id===T1);
  assert.ok(t,r+' can open the task');assert.equal(t.expected_hours,null,r);assert.equal(t.logged_hours,null,r);assert.equal(ws.me.sees_time_budget,false);
  assert.equal((await as(r,()=>tx`select * from erp_private.task_expected_hours`)).length,0,r);assert.equal((await as(r,()=>tx`select * from erp_private.task_hour_changes`)).length,0,r);
  assert.equal((await as(r,()=>tx`select erp_private.task_logged_hours(${T1}::uuid) h`))[0].h,null,r);
  await assert.rejects(()=>act(r,{action:'task_hours_set',task_id:T1,expected_hours:8,reason:'Trying to see or change the hours'}),/Engagement Partners and the Managers they have selected/);
  await assert.rejects(()=>act(r,{action:'task_hours_review'}),/Engagement Partners and the Managers they have selected/);
 }
 const wsM=await as('MANAGER',a=>readWorkspace(tx,a));assert.equal(Number(wsM.tasks.find(t=>t.task_id===T1).expected_hours),4);assert.equal(wsM.me.sees_time_budget,true);

 // 6. Time is never blocked. Going past the expected hours saves, and tells the person nothing about the expected hours.
 noHours(await log('ASSISTANT',T1,2.5));noHours(await log('ASSISTANT',T1,1.5));
 const over=await log('ASSISTANT',T1,1.75);noHours(over);
 assert.equal(Number((await tx`select sum(hours) h from erp_private.timesheets where task_id=${T1}`)[0].h),5.75);
 // The task with no expected hours takes time too.
 await log('ASSISTANT',first.task_id,3);

 // 7. The holders see the overrun and the tasks with no hours.
 let rv=await act('MANAGER',{action:'task_hours_review'});
 assert.deepEqual(rv.over.map(x=>[x.task_id,x.expected_hours,x.logged_hours,x.over_hours,x.status]),[[T1,4,5.75,1.75,'Over expected']]);
 assert.deepEqual(rv.missing.map(x=>x.task_id),[first.task_id]);assert.equal(rv.missing[0].logged_hours,3);
 assert.deepEqual((await act('PARTNER',{action:'task_hours_review'})).over.map(x=>x.task_id),[T1]);

 // 8. A holder changes the hours with a reason; every change is kept.
 await assert.rejects(()=>act('MANAGER',{action:'task_hours_set',task_id:T1,expected_hours:6,reason:'short'}),/at least 10 characters/);
 await assert.rejects(()=>act('MANAGER',{action:'task_hours_set',task_id:T1,expected_hours:4,reason:'No change at all here'}),/already has these expected hours/);
 const set=await act('MANAGER',{action:'task_hours_set',task_id:T1,expected_hours:6,reason:'Client sent twice the usual invoices'});
 assert.equal(set.status,'Within expected');assert.equal(set.over_hours,0);assert.deepEqual(await hours(T1),{h:6,source:'Set'});
 await act('PARTNER',{action:'task_hours_set',task_id:first.task_id,expected_hours:2,reason:'Created before task types existed'});
 rv=await act('MANAGER',{action:'task_hours_review'});assert.deepEqual(rv.over.map(x=>[x.task_id,x.over_hours]),[[first.task_id,1]]);assert.equal(rv.missing.length,0);
 assert.deepEqual((await tx`select old_hours::float8 o,new_hours::float8 n,changed_by from erp_private.task_hour_changes where task_id=${T1}`),[{o:4,n:6,changed_by:M}]);
 await assert.rejects(()=>act('MANAGER',{action:'task_hours_set',task_id:T1,expected_hours:7,reason:'Not a recurring task at all',save_as_standard:true}),/Only a recurring task/);

 // 9. Recurring tasks take a standard time. Set once on one of them, it fills the open ones and every later one.
 const R1=id(),R2=id(),R3=id();
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,template_key) values(${R1},${P},${A},'File PAYE · October',now(),'tpl:paye'),(${R2},${P},${A2},'File PAYE · November',now(),'tpl:paye')`;
 assert.equal(await hours(R1),null);
 const std=await act('MANAGER',{action:'task_hours_set',task_id:R1,expected_hours:1.5,reason:'Standard time for a PAYE filing',save_as_standard:true});
 assert.equal(std.standard.tasks_filled,1);assert.deepEqual(await hours(R1),{h:1.5,source:'Set'});assert.deepEqual(await hours(R2),{h:1.5,source:'Standard'});
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,template_key) values(${R3},${P},${A},'File PAYE · December',now(),'tpl:paye')`;
 assert.deepEqual(await hours(R3),{h:1.5,source:'Standard'},'the next generated task takes the standard with nobody doing anything');
 const lst=await act('PARTNER',{action:'task_types_list'});assert.deepEqual(lst.types.filter(t=>t.kind==='Recurring task').map(t=>[t.match_key,t.label,Number(t.expected_hours)]),[['tpl:paye','File PAYE',1.5]]);
 assert.deepEqual((await act('SUPERVISOR',{action:'task_types_list'})).types.map(t=>t.label),['Sales capture','VAT return'],'recurring standards are not offered as task types');
 // A changed standard applies to new tasks only.
 const row=lst.types.find(t=>t.label==='Sales capture');
 await act('PARTNER',{action:'task_standard_save',standard_id:row.standard_id,label:'Sales capture',expected_hours:5,revision:row.revision});
 await assert.rejects(()=>act('PARTNER',{action:'task_standard_save',standard_id:row.standard_id,label:'Sales capture',expected_hours:7,revision:row.revision}),/changed by someone else/);
 assert.equal((await hours((await create('MANAGER2',{task_type_id:row.standard_id})).task_id)).h,5);assert.equal((await hours(sneaky.task_id)).h,4);

 // 10. Expected against actual. Everyone sees 8 and 40 against what they logged; only holders also see the task figure.
 const mine=await act('ASSISTANT',{action:'timesheet_summary',date:today});
 assert.equal(mine.expected_daily_hours,8);assert.equal(mine.expected_weekly_hours,40);assert.equal(mine.shows_task_hours,false);assert.equal(mine.day.logged_hours,8.75);
 assert.ok(!('task_expected_hours' in mine.day)&&!('task_expected_hours' in mine.week)&&!('task_expected_hours' in mine.month));
 const seen=await act('MANAGER',{action:'timesheet_summary',date:today,staff_id:A});assert.equal(seen.shows_task_hours,true);assert.ok(seen.month.task_expected_hours>0);
 await assert.rejects(()=>act('ASSISTANT',{action:'timesheet_summary',date:today,staff_id:A2}),/your own time summary/);

 // 11. When the right ends, so does the view.
 const [g]=await tx`select * from erp_private.staff_capabilities where staff_id=${M} and capability='TIME_BUDGET' and deleted_at is null`;
 await as('PARTNER',()=>tx`select erp_private.staff_right_revoke(${(g.capability_id||g.grant_id||g.staff_capability_id)}::uuid,'Fictional reason: no longer managing task hours')`);
 assert.equal(await sees('MANAGER'),false);assert.equal((await as('MANAGER',a=>readWorkspace(tx,a))).tasks.find(t=>t.task_id===T1).expected_hours,null);
});
