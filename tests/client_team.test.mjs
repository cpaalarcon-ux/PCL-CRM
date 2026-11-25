import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientTeamAction}=await import('../supabase/functions/staff-workspace-v12/client-team-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),G=id(),C=id(),P1=id(),P2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>clientTeamAction(tx,a,p));
const rows=(role,sql,params=[])=>as(role,()=>db.query(sql,params).then(r=>r.rows));
const sees=async(role,c)=>(await rows(role,'select count(*)::int n from erp_private.clients where client_id=$1',[c]))[0].n===1;
test("client team: several people per client, workstream owners, MLROs, project overrides and task routing",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await db.exec('alter table erp_private.tasks disable trigger task_assignee_guard;alter table erp_private.project_schedules disable trigger schedule_assignee_guard;'); // fixture: scheduled tasks here start with a Manager as project preparer; the assignment rule is tested in assistant_only_assignment.test.mjs
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${G},'V3QB','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','ASSISTANT2','ASSISTANT3','OUTSIDER','INTERN']){const cat=role.replace(/[0-9]/,'').replace('OUTSIDER','ASSISTANT'),a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${role==='OUTSIDER'?G:F},'Assigned')`;}
 const id_=r=>actors[r].staff_id,M=id_('MANAGER'),M2=id_('MANAGER2'),S=id_('SUPERVISOR'),A=id_('ASSISTANT'),A2=id_('ASSISTANT2'),A3=id_('ASSISTANT3'),OUT=id_('OUTSIDER'),PT=id_('PARTNER');
 await tx`insert into erp_private.staff_capabilities(staff_id,capability) values(${M2},'MLRO')`;
 await tx`insert into erp_private.clients(client_id,company_name,legal_entity_type) values(${C},'Fictional Team Client Ltd','Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 for(const [p,n] of [[P1,'Fictional tax project'],[P2,'Fictional second project']])await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${C},${F},${n},'TAX-COMP',${M})`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P1},${M},${F},'MANAGER'),(${P2},${M},${F},'MANAGER')`;
 const team=async(extra='')=>(await tx`select s.login_id,m.role,m.workstream,m.project_id from erp_private.client_team_members m join erp_private.staff_members s using(staff_id) where m.client_id=${C} and m.ended_at is null`).map(r=>[r.login_id,r.role,r.workstream||'',r.project_id?(r.project_id===P1?'P1':'P2'):'client'].join('|')).sort();
 const owner=async(p,key)=>(await tx`select s.login_id from erp_private.tasks t join erp_private.staff_members s on s.staff_id=t.assigned_to where t.project_id=${p} and t.recurring_key=${key}`)[0]?.login_id;
 let n=0;const task=async(p,key,assigned=M)=>{const rk=key+':'+(++n);await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at,recurring_key,template_key) values(${p},${assigned},${key},now()+interval '7 days',${rk},${key})`;return rk;};

 // Only a Manager or Partner names the team; staff who cannot see the client cannot read it.
 for(const role of ['ASSISTANT','INTERN'])await assert.rejects(ax(role,{action:'client_team_read',client_id:C}),/unavailable/);
 await ax('SUPERVISOR',{action:'client_team_read',client_id:C}); // a Supervisor sees every project in the firm, so reads the team; editing stays with Managers and Partners (next line)
 await assert.rejects(ax('SUPERVISOR',{action:'client_team_add',client_id:C,staff_id:A,role:'PREPARER'}),/unavailable|Manager or Partner/);
 const empty=await ax('MANAGER',{action:'client_team_read',client_id:C});assert.equal(empty.can_edit,true);assert.deepEqual(empty.members,[]);assert.equal(empty.workstreams.length,6);
 assert.ok(empty.candidates.find(c=>c.staff_id===M2&&c.is_mlro===true),'the MLRO right is shown');assert.ok(!empty.candidates.find(c=>c.staff_id===OUT),'a person who works in no firm of the manager is not offered');

 // Several preparers. Naming an Assistant gives the onboarding allocation, so they can open the client.
 assert.equal(await sees('ASSISTANT',C),false);
 await ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A,role:'PREPARER'});await ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A2,role:'PREPARER'});
 assert.equal(await sees('ASSISTANT',C),true);assert.equal(await sees('ASSISTANT',C)&&await sees('ASSISTANT2',C),true);
 assert.equal((await tx`select source from erp_private.client_onboarding_allocations where client_id=${C} and staff_id=${A} and ended_at is null`)[0].source,'Team');
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A,role:'PREPARER'}),/already holds/);
 // The assistant can now read the team but not change it.
 assert.equal((await ax('ASSISTANT',{action:'client_team_read',client_id:C})).can_edit,false);
 await assert.rejects(ax('ASSISTANT',{action:'client_team_add',client_id:C,staff_id:A2,role:'PREPARER'}),/Manager or Partner/);

 // Reviewers are Partners, Managers or Supervisors.
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A,role:'REVIEWER'}),/Partner, Manager or Supervisor/);
 await ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:M,role:'REVIEWER'});

 // More than one MLRO; only holders of the right (or a Partner) qualify, and an MLRO belongs to the client, not to one project.
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:M,role:'MLRO'}),/MLRO right/);
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:S,role:'MLRO'}),/MLRO right/);
 await ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:M2,role:'MLRO'});await ax('PARTNER',{action:'client_team_add',client_id:C,staff_id:PT,role:'MLRO'});
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,project_id:P1,staff_id:M2,role:'MLRO'}),/client, not for one project/);
 // Firm rules come from the database as well: a Partner can see everyone, but a person outside the client's firm cannot be named.
 await assert.rejects(ax('PARTNER',{action:'client_team_add',client_id:C,staff_id:OUT,role:'PREPARER'}),/does not work in a firm that handles this client/);
 await assert.rejects(ax('PARTNER',{action:'client_team_add',client_id:C,staff_id:id_('INTERN'),role:'PREPARER'}),/Choose an active/);

 // Workstream owners.
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A,role:'WORKSTREAM_OWNER'}),/valid option/);
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A,role:'PREPARER',workstream:'SALES'}),/applies only to a workstream owner/);
 for(const [s,w] of [[A,'SALES'],[A,'PURCHASES'],[A2,'BANK'],[A3,'PAYROLL']])await ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:s,role:'WORKSTREAM_OWNER',workstream:w});
 assert.equal((await team()).length,9);

 // Scheduled tasks go to the workstream owner; the rest keep going to the project's own preparer.
 const k1=await task(P1,'weekly-sales'),k2=await task(P1,'weekly-purchases'),k3=await task(P1,'weekly-bank'),k4=await task(P1,'monthly-payroll'),k6=await task(P1,'weekly-review');
 assert.deepEqual([await owner(P1,k1),await owner(P1,k2),await owner(P1,k3),await owner(P1,k4)],['assistant','assistant','assistant2','assistant3']);
 assert.deepEqual((await tx`select k,erp_private.team_workstream(k) w from unnest(array['weekly-sales','weekly-purchases','weekly-bank','monthly-payroll','monthly-paye','monthly-nssf','monthly-vat','monthly-tot','monthly-mri','annual-compile','weekly-review','monthly-review','weekly-mapping']) k`).map(r=>r.k+'='+(r.w||'')),['weekly-sales=SALES','weekly-purchases=PURCHASES','weekly-bank=BANK','monthly-payroll=PAYROLL','monthly-paye=PAYROLL','monthly-nssf=PAYROLL','monthly-vat=VAT','monthly-tot=VAT','monthly-mri=INCOME_TAX','annual-compile=INCOME_TAX','weekly-review=','monthly-review=','weekly-mapping=']);
 assert.equal(await owner(P1,k6),'manager','an unmapped task is untouched');
 // The owners were added to the project so the task is theirs to open.
 const onP1=(await tx`select s.login_id from erp_private.project_assignments a join erp_private.staff_members s using(staff_id) where a.project_id=${P1} and a.deleted_at is null`).map(r=>r.login_id).sort();assert.deepEqual(onP1,['assistant','assistant2','assistant3','manager']);
 // A task someone creates by hand has no template key and is never rerouted.
 await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at) values(${P1},${M},'Fictional manual task',now()+interval '3 days')`;assert.equal((await tx`select s.login_id from erp_private.tasks t join erp_private.staff_members s on s.staff_id=t.assigned_to where t.task_name='Fictional manual task'`)[0].login_id,'manager');

 // A project can name its own owner; it replaces the client's owner for that project only.
 await ax('MANAGER',{action:'client_team_add',client_id:C,project_id:P1,staff_id:A2,role:'WORKSTREAM_OWNER',workstream:'SALES'});
 assert.equal(await owner(P1,await task(P1,'weekly-sales')),'assistant2');assert.equal(await owner(P2,await task(P2,'weekly-sales')),'assistant','the other project still follows the client');
 assert.equal((await tx`select count(*)::int n from erp_private.project_assignments where project_id=${P1} and staff_id=${A2} and deleted_at is null`)[0].n,1);
 // A person is skipped when they leave the firm; the task then falls back.
 await tx`update erp_private.staff_firm_access set deleted_at=now() where staff_id=${A2} and firm_id=${F}`;
 assert.equal(await owner(P1,await task(P1,'weekly-bank')),'manager','a person no longer in the firm is skipped');
 await tx`update erp_private.staff_firm_access set deleted_at=null where staff_id=${A2} and firm_id=${F}`;

 // Ending needs a reason and is never edited afterwards. The team allocation ends with the last team role.
 const mine=await tx`select team_member_id,role,workstream,project_id from erp_private.client_team_members where client_id=${C} and staff_id=${A} and ended_at is null`;
 await assert.rejects(ax('MANAGER',{action:'client_team_end',client_id:C,team_member_id:mine[0].team_member_id,reason:'no'}),/at least 5 characters/);
 for(const m of mine.slice(0,-1))await ax('MANAGER',{action:'client_team_end',client_id:C,team_member_id:m.team_member_id,reason:'Fictional: moved to another client'});
 assert.equal(await sees('ASSISTANT',C),true,'still on the team, so the access stays');
 await ax('MANAGER',{action:'client_team_end',client_id:C,team_member_id:mine.at(-1).team_member_id,reason:'Fictional: moved to another client'});
 assert.equal((await tx`select count(*)::int n from erp_private.client_onboarding_allocations where client_id=${C} and staff_id=${A} and ended_at is null`)[0].n,0,'the allocation made for the team role ends with it');
 assert.match((await tx`select end_reason from erp_private.client_onboarding_allocations where client_id=${C} and staff_id=${A} and ended_at is not null`)[0].end_reason,/Left the client team/);
 assert.equal(await sees('ASSISTANT',C),true,'the project assignment made when tasks were routed is separate and stays until a Manager ends it');
 await assert.rejects(ax('MANAGER',{action:'client_team_end',client_id:C,team_member_id:mine[0].team_member_id,reason:'Fictional: again'}),/already ended/);
 await assert.rejects(tx`update erp_private.client_team_members set note='x' where team_member_id=${mine[0].team_member_id}`,/never edited/);
 await assert.rejects(tx`delete from erp_private.client_team_members where team_member_id=${mine[0].team_member_id}`);
 // A task already generated stays where it was; only new tasks follow the new team.
 assert.equal(await owner(P1,k1),'assistant');
 assert.equal(await owner(P1,await task(P1,'weekly-purchases')),'manager','with the owner gone, new tasks fall back to the project preparer');
 // An allocation a Manager made by hand is not ended when a team role ends.
 await tx`insert into erp_private.client_onboarding_allocations(client_id,staff_id,allocated_by,source) values(${C},${A},${M},'Selected')`;
 const again=await ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A,role:'PREPARER'});
 await ax('MANAGER',{action:'client_team_end',client_id:C,team_member_id:again.team_member_id,reason:'Fictional: changed my mind'});
 assert.equal((await tx`select count(*)::int n from erp_private.client_onboarding_allocations where client_id=${C} and staff_id=${A} and ended_at is null and source='Selected'`)[0].n,1);
 // Separation of duties: who prepares the work cannot also review it or be its MLRO, in the action and in the database.
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:M,role:'PREPARER'}),/cannot also review/,'a reviewer cannot also prepare');
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:M,role:'WORKSTREAM_OWNER',workstream:'VAT'}),/cannot also review/);
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:A3,role:'REVIEWER'}),/A reviewer is a Partner, Manager or Supervisor/,'a workstream owner is an Assistant, so cannot be a reviewer');
 await assert.rejects(tx`insert into erp_private.client_team_members(client_id,staff_id,role,assigned_by) values(${C},${A3},'REVIEWER',${M})`,/cannot prepare the work and also review|A reviewer is a Partner/,'the database refuses it even without the action');
 const reviewer=(await tx`select team_member_id from erp_private.client_team_members where client_id=${C} and staff_id=${M} and role='REVIEWER' and ended_at is null`)[0];
 await ax('MANAGER',{action:'client_team_end',client_id:C,team_member_id:reviewer.team_member_id,reason:'Fictional: now prepares'});
 await assert.rejects(ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:M,role:'PREPARER'}),/Assistants/,'a Manager cannot be a preparer: tasks go to Assistants only');
});
