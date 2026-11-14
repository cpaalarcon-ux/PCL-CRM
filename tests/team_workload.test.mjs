// Team workload: a Supervisor, Manager or Partner reads active tasks per person; above 15 active tasks is flagged; an Assistant cannot read it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('team workload flags more than 15 active tasks and is limited to reviewers',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;


 for(const role of ['ASSISTANT','SUPERVISOR'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 const mk=(n,status='Pending')=>tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,status) values(${id()},${P},${actors.ASSISTANT.staff_id},${'Fictional task '+n},${status})`;
 for(let i=1;i<=15;i++)await mk(i);
 await mk('done','Completed');await mk('cancelled','Cancelled');
 const load=r=>as(r,()=>tx`select * from erp_private.team_workload()`);
 let rows=await load('PARTNER'),a=rows.find(x=>x.staff_id===actors.ASSISTANT.staff_id);
 assert.equal(a.active_tasks,15,'completed and cancelled tasks are not active');assert.equal(a.is_overloaded,false,'exactly 15 is not over the limit');
 await mk(16);rows=await load('PARTNER');a=rows.find(x=>x.staff_id===actors.ASSISTANT.staff_id);
 assert.equal(a.active_tasks,16);assert.equal(a.is_overloaded,true,'16 active tasks is flagged');
 assert.equal(rows[0].staff_id,actors.ASSISTANT.staff_id,'the busiest person is listed first');
 for(const r of ['MANAGER','SUPERVISOR'])assert.ok((await load(r)).length>=1,r+' can read it');
 await assert.rejects(()=>load('ASSISTANT'),/Supervisor, Manager or Partner required/);
 // Approved leave today shows as on leave.
 await tx`insert into erp_private.leave_requests(leave_id,staff_id,leave_type,starts_on,ends_on,working_days,reason,status,reviewed_by,review_note) values(${id()},${actors.SUPERVISOR.staff_id},'Annual','2020-01-01','2099-12-31',5,'Fictional long leave','Approved',${actors.MANAGER.staff_id},'Cover agreed with the team')`;
 rows=await load('PARTNER');assert.equal(rows.find(x=>x.staff_id===actors.SUPERVISOR.staff_id).on_leave,true);assert.equal(rows.find(x=>x.staff_id===actors.ASSISTANT.staff_id).on_leave,false);
});

test('the sidebar follows the agreed layout and rights are unchanged',()=>{
 const app=fs.readFileSync(path.join(root,'staff-pilot.mjs'),'utf8'),leads=fs.readFileSync(path.join(root,'staff-leads.mjs'),'utf8'),msg=fs.readFileSync(path.join(root,'staff-messenger.mjs'),'utf8');
 for(const label of ['Clients','Projects & Tasks','Time & Attendance','Team & HR','Documents','Communications Hub','Finance & Reports','Administration'])assert.ok(app.includes(`'${label}'`),label);
 assert.match(app,/leaf\('leads','Leads & Pipeline'/,'Leads sit under Clients');
 assert.match(app,/parent\('clients','Clients','▦',\[lead\]\)/);
 assert.match(app,/parent\('projects','Projects & Tasks','▣',modLinks\('projects'\)\)/,'Projects & Tasks is the project and task manager');
 assert.match(app,/subs=\[audit,\.\.\.modLinks\('engagements'\)\]/,'Audit files sit under Engagements & Delivery');
 assert.ok(!/sideItems=\[[^\]]*leaf\('audit'/.test(app),'Audit is not a top-level sidebar item');
 // areas (rights) are untouched
 for(const area of ['clients','projects','time_hr','documents','communications','audit','billing_wip','staff_access','settings','leads'])assert.ok(app.includes(`area:'${area}'`),area);
 assert.match(leads,/Promote to Client/);assert.ok(!/Prepare client/.test(leads));assert.match(leads,/action:'lead_convert'/);
 assert.match(msg,/> Messenger<span id="messengerBadge"/);
});
