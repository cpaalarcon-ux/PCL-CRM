// Build .105: working-hours clock, stuck-task alerts, new statuses, Manager Pool and Partners out of the overload badge.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('statuses, working-hours clock, stuck-task alerts, Manager Pool and the Partner overload exemption',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;


 for(const role of ['ASSISTANT','SUPERVISOR','PARTNER','MANAGER2'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;

 const row=async(sql)=>sql; const q=(s)=>db.query(s).then(r=>r.rows);
 // 1. Working seconds: Monday to Friday 08:00 to 17:00 Nairobi, no weekends, no public holidays.
 const ws=async(a,b)=>Number((await tx`select erp_private.working_seconds(${a}::timestamptz,${b}::timestamptz) s`)[0].s);
 assert.equal(await ws('2026-11-09T04:00:00Z','2026-11-09T15:00:00Z'),9*3600,'Monday 07:00 to 18:00 Nairobi counts only 08:00 to 17:00');
 assert.equal(await ws('2026-11-13T13:00:00Z','2026-11-16T06:00:00Z'),2*3600,'Friday 16:00 to Monday 09:00 counts one hour each side');
 assert.equal(await ws('2026-11-14T05:00:00Z','2026-11-15T14:00:00Z'),0,'a weekend counts nothing');
 assert.equal(await ws('2026-12-25T05:00:00Z','2026-12-25T14:00:00Z'),0,'Christmas Day (a Friday) counts nothing');
 assert.equal(await ws('2026-11-09T14:00:00Z','2026-11-09T05:00:00Z'),0,'a reversed range is zero');
 // 2. Statuses and the clock.
 const mk=async(name,assignee,status='Pending')=>{const T=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,status) values(${T},${P},${assignee},${name},${status})`;return T;};
 const st=async T=>(await tx`select status,work_started_at,work_seconds,last_paused_at from erp_private.tasks where task_id=${T}`)[0];
 const T1=await mk('Fictional VAT prep',actors.ASSISTANT.staff_id);
 await tx`update erp_private.tasks set status='In Progress' where task_id=${T1}`;let s=await st(T1);assert.ok(s.work_started_at,'clock starts at In Progress');
 for(const status of ['Waiting on client','Paused','Blocked']){
  await tx`update erp_private.tasks set status='In Progress',work_started_at=now() - interval '1 second' where task_id=${T1}`;
  await tx`update erp_private.tasks set status=${status} where task_id=${T1}`;s=await st(T1);
  assert.equal(s.work_started_at,null,status+' stops the clock');assert.ok(s.last_paused_at,status+' records the pause');
 }
 await assert.rejects(()=>tx`update erp_private.tasks set status='Napping' where task_id=${T1}`,/tasks_status_check/);
 // 3. Stuck-task alerts: 4 working hours to the Supervisor, 8 to the Manager; once each; paused work is not counted; alert only.
 await tx`update erp_private.staff_members set manager_id=${actors.MANAGER.staff_id} where staff_id=${actors.ASSISTANT.staff_id}`;
 const T2=await mk('Fictional VAT return',actors.ASSISTANT.staff_id,'In Progress');
 const notes=async T=>(await tx`select n.recipient_id,n.message from erp_private.notifications n where n.task_id=${T} and n.event_key like 'stuck:%'`);
 await tx`update erp_private.tasks set work_seconds=3*3600+3599,work_started_at=now() where task_id=${T2}`;
 await tx`select erp_private.stuck_task_scan()`;assert.equal((await notes(T2)).length,0,'under 4 working hours: no alert');
 await tx`update erp_private.tasks set work_seconds=4*3600 where task_id=${T2}`;await tx`select erp_private.stuck_task_scan()`;
 let n=await notes(T2);assert.deepEqual(n.map(x=>x.recipient_id),[actors.SUPERVISOR.staff_id],'4 hours goes to the Supervisor on the job');assert.match(n[0].message,/4 working hours/);
 await tx`select erp_private.stuck_task_scan()`;assert.equal((await notes(T2)).length,1,'an alert is raised once per level');
 await tx`update erp_private.tasks set work_seconds=8*3600 where task_id=${T2}`;await tx`select erp_private.stuck_task_scan()`;
 n=await notes(T2);assert.equal(n.length,2);assert.ok(n.some(x=>x.recipient_id===actors.MANAGER.staff_id&&/Manager-level/.test(x.message)),'8 hours goes to the Manager');
 assert.equal((await st(T2)).status,'In Progress','an alert never blocks the task');
 await tx`update erp_private.tasks set status='Pending',description='still editable' where task_id=${T2}`;
 const T3=await mk('Fictional paused task',actors.ASSISTANT.staff_id,'Paused');await tx`update erp_private.tasks set work_seconds=9*3600 where task_id=${T3}`;await tx`select erp_private.stuck_task_scan()`;assert.equal((await notes(T3)).length,0,'a paused task raises nothing');
 // Partner-assigned work has no Supervisor: the other Partner hears of it.
 const T4=await mk('Fictional Partner review',actors.PARTNER.staff_id,'In Progress');await tx`update erp_private.tasks set work_seconds=4*3600,work_started_at=now() where task_id=${T4}`;await tx`select erp_private.stuck_task_scan()`;
 assert.deepEqual((await notes(T4)).map(x=>x.recipient_id),[actors.PARTNER2.staff_id]);
 // 4. Overload badge: Partners are never flagged.
 for(let i=0;i<17;i++)await mk('Fictional bulk '+i,actors.PARTNER.staff_id);
 const wl=await as('PARTNER2',()=>tx`select * from erp_private.team_workload()`);
 const pw=wl.find(x=>x.staff_id===actors.PARTNER.staff_id);assert.ok(pw.active_tasks>15&&pw.is_overloaded===false,'a Partner with many tasks is not flagged');
 // 5. Manager Pool.
 const T5=await mk('Fictional review item',actors.ASSISTANT.staff_id,'In Review');
 await tx`update erp_private.task_procedures set reviewer_id=${actors.SUPERVISOR.staff_id},prepared_by=${actors.ASSISTANT.staff_id} where task_id=${T5}`;
 await tx`update erp_private.task_procedures set stage='Pending supervisor review' where task_id=${T5}`;
 const pool=async T=>(await tx`select review_pool_status s,pool_reason r from erp_private.task_review_pool where task_id=${T}`)[0];
 await tx`select erp_private.refresh_review_pool()`;assert.equal(await pool(T5),undefined,'a present reviewer keeps the task with them');
 const LV=id();await tx`insert into erp_private.leave_requests(leave_id,staff_id,leave_type,starts_on,ends_on,working_days,reason,status,reviewed_by,review_note) values(${LV},${actors.SUPERVISOR.staff_id},'Annual','2020-01-01','2099-12-31',5,'Fictional long leave','Approved',${actors.MANAGER.staff_id},'Cover agreed with the team')`;
 await tx`select erp_private.refresh_review_pool()`;assert.deepEqual(await pool(T5),{s:'POOL',r:'Named reviewer is on leave'});
 const claim=(role,T)=>as(role,()=>tx`select erp_private.task_pool_claim(${T}::uuid)`);
 await assert.rejects(()=>claim('ASSISTANT',T5),/Manager or Partner must pull/);
 await assert.rejects(()=>claim('SUPERVISOR',T5),/Manager or Partner must pull/);
 // the preparer can never pull their own work
 const T6=await mk('Fictional manager-prepared item',actors.MANAGER2.staff_id,'In Review');
 await tx`update erp_private.task_procedures set reviewer_id=${actors.SUPERVISOR.staff_id},prepared_by=${actors.MANAGER2.staff_id} where task_id=${T6}`;await tx`update erp_private.task_procedures set stage='Pending supervisor review' where task_id=${T6}`;
 await tx`select erp_private.refresh_review_pool()`;assert.equal((await pool(T6)).s,'POOL');
 await assert.rejects(()=>claim('MANAGER2',T6),/prepared or worked on this task/);
 await claim('MANAGER',T6);
 const w6=(await tx`select reviewer_id from erp_private.task_procedures where task_id=${T6}`)[0];assert.equal(w6.reviewer_id,actors.MANAGER.staff_id,'the Manager is now the named reviewer');
 assert.equal((await pool(T6)).s,'NAMED');
 await assert.rejects(()=>claim('PARTNER',T6),/not in the pool/);
 const lg=await tx`select action,from_reviewer,to_staff_id,acted_by from erp_private.task_pool_log where task_id=${T6} order by created_at,log_id`;
 assert.deepEqual(lg.map(x=>x.action),['Pooled','Claimed']);assert.equal(lg[1].acted_by,actors.MANAGER.staff_id);assert.equal(lg[1].to_staff_id,actors.MANAGER.staff_id);assert.equal(lg[1].from_reviewer,actors.SUPERVISOR.staff_id);
 await assert.rejects(()=>tx`update erp_private.task_pool_log set reason='changed' where task_id=${T6}`,/cannot be changed/);
 await assert.rejects(()=>tx`update erp_private.task_procedures set reviewer_id=${actors.PARTNER.staff_id} where task_id=${T6}`,/Return work before changing setup/);
 // an automatic pool entry returns to the reviewer when the leave ends
 await tx`update erp_private.leave_requests set status='Cancelled' where leave_id=${LV}`;await tx`select erp_private.refresh_review_pool()`;
 assert.equal((await pool(T5)).s,'NAMED','back with the named reviewer');assert.equal((await tx`select count(*)::int c from erp_private.task_pool_log where task_id=${T5} and action='Restored'`)[0].c,1);
 // manual send to the pool needs a reason of 10+ characters and a Supervisor, Manager or Partner
 const send=(role,T,why)=>as(role,()=>tx`select erp_private.task_send_to_pool(${T}::uuid,${why})`);
 await assert.rejects(()=>send('ASSISTANT',T5,'General review, no client'),/Supervisor, Manager or Partner required/);
 await assert.rejects(()=>send('SUPERVISOR',T5,'short'),/at least 10 characters/);
 await send('SUPERVISOR',T5,'General review, not tied to one client');assert.equal((await pool(T5)).s,'POOL');
 await tx`select erp_private.refresh_review_pool()`;assert.equal((await pool(T5)).s,'POOL','a manual entry is not undone automatically');
 await claim('PARTNER',T5);assert.equal((await pool(T5)).s,'NAMED');
});

test('screens and server expose the new statuses, the pool widget for Managers and Partners, and the reasons for pausing',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),app=rd('staff-pilot.mjs'),dash=rd('staff-dashboard.mjs'),team=rd('supabase/functions/staff-workspace-v12/team-actions.ts'),val=rd('supabase/functions/staff-workspace-v12/validation.mjs'),idx=rd('supabase/functions/staff-workspace-v12/index.ts'),tw=rd('staff-task-workspace.mjs');
 assert.match(val,/'Waiting on client','Paused'/);assert.match(app,/states=\['Pending','In Progress','Waiting on client','Paused'/);
 assert.match(idx,/\['Waiting on client','Paused'\]\.includes\(status\)&&reason\.length<3/);
 assert.match(dash,/\['PARTNER','MANAGER'\]\.includes\(role\)\?'<section class="card home-my-reviews" id="homePool"/,'the pool widget is for Managers and Partners only');
 assert.match(app,/\['PARTNER','MANAGER'\]\.includes\(data\.me\.category_code\)\)\{void teamUI\.paintPool\(\)/);
 for(const a of ['task_pool_list','task_pool_claim','task_pool_send','task_team_workload'])assert.ok(team.includes(`'${a}'`),a);
 assert.match(team,/The Manager Pool is for Managers and Partners/);
 assert.match(tw,/data-pool="send"/);assert.match(rd('staff-team.mjs'),/Pull &amp; Assign to Me/);
});
