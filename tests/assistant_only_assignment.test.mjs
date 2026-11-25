import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const {teamQueueAction}=await import('../supabase/functions/staff-workspace-v12/team-queue-actions.ts');
const {scopeWorkspaceRecords}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),G=id(),C=id(),C2=id(),P=id(),P2=id(),T1=id(),T2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>workspaceAction(tx,a,p));
const queue=(role,p)=>as(role,a=>teamQueueAction(tx,a,p));
const rows=(role,sql)=>as(role,()=>db.query(sql).then(r=>r.rows));
test('tasks are assigned to Assistants only; Supervisors see and review everything in their firm; the team queue lists it',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'ASQA','Fictional assign firm'),(${G},'ASQB','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','SUPERVISOR2','ASSISTANT','ASSISTANT2','INTERN','OTHERSUP']){
  const cat=role.replace(/\d/,'').replace('OTHERSUP','SUPERVISOR'),firm=role==='OTHERSUP'?G:F,a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat,full_name:'Fictional '+role};
  await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;
  await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${a.full_name},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;
  await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;
  await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${firm},'Assigned')`;
 }
 const S=actors.SUPERVISOR.staff_id,A=actors.ASSISTANT.staff_id,A2=actors.ASSISTANT2.staff_id,M=actors.MANAGER.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Mlima Traders',${M}),(${C2},'Pwani Fresh',${M})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C2},${F})`;
 for(const [p,c,n] of [[P,C,'Mlima monthly tax'],[P2,C2,'Pwani monthly tax']])await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${c},${F},${n},'TAX-COMP',${M})`;
 for(const [p,s,r] of [[P,A,'ASSISTANT'],[P,A2,'ASSISTANT'],[P,M,'MANAGER'],[P2,A2,'ASSISTANT'],[P2,M,'MANAGER'],[P,actors.INTERN.staff_id,'INTERN']])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${s},${F},${r})`;

 // 1. The database refuses a task that is unassigned or held by anyone but an active Assistant, whatever way it is created.
 const add=(who,p=P)=>tx`insert into erp_private.tasks(project_id,assigned_to,task_name) values(${p},${who},'Fictional task') returning task_id`;
 await assert.rejects(()=>add(null),/Assign this task to an Assistant/);
 for(const who of [M,actors.PARTNER.staff_id,S,actors.INTERN.staff_id])await assert.rejects(()=>add(who),/Assistants only/);
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,status) values(${T1},${P},${A},'Capture January sales',now()+interval '2 days','In Review'),(${T2},${P2},${A2},'Capture January bank',now()-interval '1 day','Pending')`;
 await assert.rejects(()=>tx`update erp_private.tasks set assigned_to=${M} where task_id=${T1}`,/Assistants only/);
 await assert.rejects(()=>tx`update erp_private.tasks set assigned_to=null where task_id=${T1}`,/Assign this task/);
 await tx`update erp_private.tasks set task_name='Capture January sales (checked)' where task_id=${T1}`;
 // A task already held by a non-Assistant (older data) can still be edited; only a change of assignee is checked.
 await tx`alter table erp_private.tasks disable trigger task_assignee_guard`;const old=(await add(M))[0].task_id;await tx`alter table erp_private.tasks enable trigger task_assignee_guard`;
 await tx`update erp_private.tasks set task_name='Older task, renamed' where task_id=${old}`;
 await tx`update erp_private.tasks set assigned_to=${A} where task_id=${old}`;
 await tx`update erp_private.staff_members set access_status='Inactive' where staff_id=${A2}`;
 await assert.rejects(()=>add(A2),/active/);
 await tx`update erp_private.staff_members set access_status='Active' where staff_id=${A2}`;
 // A recurring schedule must also name an Assistant.
 await assert.rejects(()=>tx`insert into erp_private.project_schedules(project_id,frequency,pack,starts_on,ends_on,effective_from,assigned_to,reviewer_id) values(${P},'Monthly','General','2026-01-01','2026-12-31','2026-01-01',${M},${M})`,/Assistant/);

 // 2. The server refuses an unassigned task or a non-Assistant before it reaches the database.
 await assert.rejects(()=>act('MANAGER',{action:'task_create',project_id:P,unassigned:true,task_name:'x',due_date:'2026-12-01'}),/Assign this task to an Assistant/);
 await assert.rejects(()=>act('MANAGER',{action:'task_create',project_id:P,assigned_to:M,task_name:'x',due_date:'2026-12-01'}),/Assistants only/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'task_create',project_id:P,assigned_to:S,task_name:'x',due_date:'2026-12-01'}),/Assistants only/);

 // 3. A Supervisor sees every project and task in their firm, assigned or not, and cannot reach another firm.
 assert.equal((await rows('SUPERVISOR','select project_id from erp_private.projects')).length,2);
 assert.equal((await rows('SUPERVISOR2','select project_id from erp_private.projects')).length,2,'a Supervisor with no assignment sees them too');
 assert.equal((await rows('SUPERVISOR','select task_id from erp_private.tasks')).length,3);
 assert.equal((await rows('OTHERSUP','select project_id from erp_private.projects')).length,0,'but not another firm');
 assert.equal((await rows('ASSISTANT','select task_id from erp_private.tasks')).length,2,'an Assistant sees only their own tasks');
 // and can work on them: change status, reassign to an Assistant, but not to a Manager.
 await as('SUPERVISOR2',()=>tx`update erp_private.tasks set status='In Progress' where task_id=${T2}`);
 await as('SUPERVISOR2',()=>tx`update erp_private.tasks set assigned_to=${A} where task_id=${T2}`).catch(e=>assert.match(e.message,/assignment|project_assignments|violates/));
 await assert.rejects(()=>as('SUPERVISOR2',()=>tx`update erp_private.tasks set assigned_to=${M} where task_id=${T2}`),/Assistants only/);

 // 4. Forward goes to an Assistant; Escalate asks a reviewer to look but leaves the task with its Assistant.
 const rev=async id=>(await tx`select revision from erp_private.tasks where task_id=${id}`)[0].revision;
 await tx`update erp_private.tasks set status='Pending' where task_id=${T1}`;
 await assert.rejects(async()=>act('SUPERVISOR',{action:'task_escalate',task_id:T1,assigned_to:M,operation:'Forward',reason:'Please take this.',revision:String(await rev(T1))}),/Assistant/);
 await act('SUPERVISOR',{action:'task_escalate',task_id:T1,assigned_to:M,operation:'Escalate',reason:'Please look at the client query.',revision:String(await rev(T1))});
 assert.equal((await tx`select assigned_to from erp_private.tasks where task_id=${T1}`)[0].assigned_to,A,'an escalated task stays with its Assistant');
 await act('SUPERVISOR',{action:'task_escalate',task_id:T1,assigned_to:A2,operation:'Forward',reason:'Please take this over.',revision:String(await rev(T1))});
 assert.equal((await tx`select assigned_to from erp_private.tasks where task_id=${T1}`)[0].assigned_to,A2,'a forwarded task moves to the other Assistant');

 // 5. Team queue: reviewers only; My reviews then All active tasks; filters by Assistant, client and due date.
 await assert.rejects(()=>queue('ASSISTANT',{action:'team_queue_read'}),/Supervisors, Managers and Partners/);
 await tx`update erp_private.tasks set status='In Review' where task_id=${T1}`;
 const reviews=await queue('SUPERVISOR',{action:'team_queue_read',mode:'reviews'});
 assert.deepEqual(reviews.records.map(r=>r.task_id),[T1],'My reviews lists work waiting for review');
 const all=await queue('MANAGER',{action:'team_queue_read',mode:'all'});
 assert.equal(all.total,3);assert.ok(all.records[0].overdue,'overdue work comes first');
 assert.deepEqual(all.assistants.map(x=>x.full_name).sort(),['Fictional ASSISTANT','Fictional ASSISTANT2']);
 assert.deepEqual((await queue('MANAGER',{action:'team_queue_read',mode:'all',assistant_id:A2})).records.map(r=>r.task_id).includes(T1),true);
 assert.equal((await queue('MANAGER',{action:'team_queue_read',mode:'all',client:'pwani'})).records.every(r=>r.client_name==='Pwani Fresh'),true);
 assert.equal((await queue('MANAGER',{action:'team_queue_read',mode:'all',due_before:'2020-01-01'})).total,0);

 // 6. The workspace a Supervisor receives holds every project and task, but still only their own leave and attendance rows.
 const ws={projects:[{project_id:P,client_id:C},{project_id:P2,client_id:C2}],tasks:[{task_id:T1,project_id:P,assigned_to:A},{task_id:T2,project_id:P2,assigned_to:A2}],clients:[{client_id:C,company_name:'a'},{client_id:C2,company_name:'b'}],task_procedures:[],schedules:[],assignments:[],suite:{leave:[{staff_id:S},{staff_id:A}]}};
 const sup=scopeWorkspaceRecords(ws,'SUPERVISOR',S);
 assert.equal(sup.projects.length,2);assert.equal(sup.tasks.length,2);assert.equal(sup.suite.leave.length,1);
 const asst=scopeWorkspaceRecords(ws,'ASSISTANT',A);assert.equal(asst.projects.length,1,'an Assistant still sees only the project of their own task');assert.equal(asst.tasks.length,1);
});
