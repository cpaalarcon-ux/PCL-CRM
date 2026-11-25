import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientTeamAction}=await import('../supabase/functions/staff-workspace-v12/client-team-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),G=id(),C=id(),P1=id(),P2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>clientTeamAction(tx,a,p));
const rows=(role,sql,params=[])=>as(role,()=>db.query(sql,params).then(r=>r.rows));
const sees=async(role,c)=>(await rows(role,'select count(*)::int n from erp_private.clients where client_id=$1',[c]))[0].n===1;
test("client team balance: fewest open tasks, leave, project override, hand-over and new-project defaults",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await db.exec('alter table erp_private.tasks disable trigger task_assignee_guard;alter table erp_private.project_schedules disable trigger schedule_assignee_guard;'); // fixture: this suite is not about who holds tasks; the assignment rule is tested in assistant_only_assignment.test.mjs
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${G},'V3QB','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','ASSISTANT2','ASSISTANT3','OUTSIDER','INTERN']){const cat=role.replace(/[0-9]/,'').replace('OUTSIDER','ASSISTANT'),a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${role==='OUTSIDER'?G:F},'Assigned')`;}
 const id_=r=>actors[r].staff_id,M=id_('MANAGER'),M2=id_('MANAGER2'),S=id_('ASSISTANT3'),A=id_('ASSISTANT'),A2=id_('ASSISTANT2'),OUT=id_('OUTSIDER'),PT=id_('PARTNER');
 await tx`insert into erp_private.staff_capabilities(staff_id,capability) values(${M2},'MLRO')`;
 await tx`insert into erp_private.clients(client_id,company_name,legal_entity_type) values(${C},'Fictional Team Client Ltd','Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 for(const [p,n] of [[P1,'Fictional tax project'],[P2,'Fictional second project']])await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${C},${F},${n},'TAX-COMP',${M})`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P1},${M},${F},'MANAGER'),(${P2},${M},${F},'MANAGER')`;
 const team=async(extra='')=>(await tx`select s.login_id,m.role,m.workstream,m.project_id from erp_private.client_team_members m join erp_private.staff_members s using(staff_id) where m.client_id=${C} and m.ended_at is null`).map(r=>[r.login_id,r.role,r.workstream||'',r.project_id?(r.project_id===P1?'P1':'P2'):'client'].join('|')).sort();
 const owner=async(p,key)=>(await tx`select s.login_id from erp_private.tasks t join erp_private.staff_members s on s.staff_id=t.assigned_to where t.project_id=${p} and t.recurring_key=${key}`)[0]?.login_id;
 let n=0;const task=async(p,key,assigned=M)=>{const rk=key+':'+(++n);await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at,recurring_key,template_key) values(${p},${assigned},${key},now()+interval '7 days',${rk},${key})`;return rk;};
 await db.exec('set session_replication_role=replica');await tx`update erp_private.projects set status='Active' where project_id in (${P1},${P2})`;await db.exec('set session_replication_role=origin');
 const add=(who,role,extra={})=>ax('MANAGER',{action:'client_team_add',client_id:C,staff_id:who,role,...extra});
 const load=async who=>(await tx`select count(*)::int n from erp_private.tasks where assigned_to=${who} and deleted_at is null and status not in('Completed','Cancelled')`)[0].n;
 const holder=async rk=>(await tx`select assigned_to from erp_private.tasks where recurring_key=${rk}`)[0].assigned_to;
 const leave=async who=>{const l=id();await tx`insert into erp_private.leave_requests(leave_id,staff_id,leave_type,starts_on,ends_on,working_days,reason,status) values(${l},${who},'Annual',current_date-1,current_date+30,20,'Fictional leave','Approved')`;return l;};
 const endLeave=l=>tx`update erp_private.leave_requests set status='Cancelled' where leave_id=${l}`;
 const pick=async(p,ws,exclude=[])=>(await tx`select erp_private.team_pick(${C},${p},${F},'WORKSTREAM_OWNER',${ws},now()+interval '7 days',${tx.array(exclude)}::uuid[]) p`)[0].p;

 // 1. Two owners for sales: tasks go to whoever has fewer open tasks, the earliest named wins a tie.
 await add(A,'WORKSTREAM_OWNER',{workstream:'SALES'});await add(A2,'WORKSTREAM_OWNER',{workstream:'SALES'});
 const r=[];for(let i=0;i<4;i++)r.push(await task(P1,'weekly-sales'));
 assert.deepEqual(await Promise.all(r.map(holder)),[A,A2,A,A2],'work is shared between the two owners');
 assert.equal(await load(A),2);assert.equal(await load(A2),2);
 await tx`update erp_private.tasks set status='Completed' where recurring_key=${r[1]}`;
 assert.equal(await holder(await task(P1,'weekly-sales')),A2,'the person with fewer open tasks takes the next task');

 // 2. Someone on approved leave on the due date is skipped. With everyone away the project preparer keeps it.
 const la=await leave(A);assert.equal(await holder(await task(P1,'weekly-sales')),A2,'A is on leave, so A2 takes it');
 const lb=await leave(A2);assert.equal(await holder(await task(P1,'weekly-sales')),M,'nobody on the team is free, so the project preparer keeps it');
 await endLeave(la);await endLeave(lb);
 assert.ok([A,A2].includes(await holder(await task(P1,'weekly-sales'))),'a cancelled leave no longer counts');

 // 3. Excluded people (the task reviewer) are never picked.
 assert.equal(await pick(P1,'SALES',[A]),A2);assert.equal(await pick(P1,'SALES',[A,A2]),null);

 // 4. A project's own owner replaces the client's while available. On leave, the client's owners cover.
 await add(S,'WORKSTREAM_OWNER',{workstream:'SALES',project_id:P2});
 assert.equal(await holder(await task(P2,'weekly-sales')),S,'the project owner takes the project work');
 const ls=await leave(S);assert.ok([A,A2].includes(await holder(await task(P2,'weekly-sales'))),'the client owners cover while the project owner is away');await endLeave(ls);
 assert.ok([A,A2].includes(await holder(await task(P1,'weekly-sales'))),'other projects keep using the client owners');

 // 5. Hand over. A holds some not-started tasks, one is in progress.
 const heldA=(await tx`select recurring_key,task_id from erp_private.tasks where assigned_to=${A} and status='Pending' and deleted_at is null order by created_at`);
 assert.ok(heldA.length>=2,'A holds several not-started tasks');
 await tx`update erp_private.tasks set status='In Progress' where task_id=${heldA[0].task_id}`;
 const read=await ax('MANAGER',{action:'client_team_read',client_id:C});
 assert.ok(read.holders.find(h=>h.staff_id===A&&h.workstream==='SALES'),'the screen lists who holds not-started work');
 await assert.rejects(ax('ASSISTANT',{action:'client_team_handover',client_id:C,from_staff_id:A,preview:true}),/Manager or Partner|unavailable/);
 const preview=await ax('MANAGER',{action:'client_team_handover',client_id:C,from_staff_id:A,preview:true});
 assert.equal(preview.preview,true);assert.equal(preview.moving,heldA.length-1,'the task in progress is never moved');
 assert.equal((await tx`select count(*)::int n from erp_private.task_events where from_staff_id=${A} and event_type='Reassigned'`)[0].n,0,'a preview moves nothing');
 await assert.rejects(ax('MANAGER',{action:'client_team_handover',client_id:C,from_staff_id:A,reason:'short'}),/at least 10 characters/);
 // A is still on the team, so with no one named the tasks go to the best other owner (A2 or S where S is the project owner).
 const done=await ax('MANAGER',{action:'client_team_handover',client_id:C,from_staff_id:A,workstream:'SALES',reason:'Fictional: A is on leave from today'});
 assert.equal(done.preview,false);assert.equal(done.moving,heldA.length-1);
 assert.equal(await holder(heldA[0].recurring_key),A,'the task already in progress stays with A');
 for(const t of heldA.slice(1))assert.notEqual(await holder(t.recurring_key),A);
 assert.equal((await tx`select count(*)::int n from erp_private.task_events where from_staff_id=${A} and event_type='Reassigned' and reason like 'Fictional: A is on leave%'`)[0].n,heldA.length-1,'every move is logged with the reason');
 // Explicit person. A person who reviews this client cannot take the preparation work.
 await add(M2,'REVIEWER');
 await assert.rejects(ax('MANAGER',{action:'client_team_handover',client_id:C,from_staff_id:A2,to_staff_id:M2,reason:'Fictional: hand to reviewer',preview:true}),/reviews or is MLRO/);
 const toA=await ax('MANAGER',{action:'client_team_handover',client_id:C,from_staff_id:A2,to_staff_id:A,reason:'Fictional: A is back from leave'});
 assert.ok(toA.moving>=1);assert.deepEqual(toA.groups.map(g=>g.staff_id),[A]);

 // 6. Ending someone reports how many not-started tasks are still with them.
 const a2row=(await tx`select team_member_id from erp_private.client_team_members where client_id=${C} and staff_id=${A2} and ended_at is null limit 1`)[0];
 const ended=await ax('MANAGER',{action:'client_team_end',client_id:C,team_member_id:a2row.team_member_id,reason:'Fictional: moved elsewhere'});
 assert.equal(typeof ended.open_tasks,'number');

 // 7. New-project defaults: preparer and reviewer from the team, never the same person, leave respected.
 await add(A,'PREPARER');await add(A2,'PREPARER');await add(PT,'REVIEWER');
 const d1=await ax('MANAGER',{action:'client_team_defaults',client_id:C,firm_id:F});
 assert.ok([A,A2].includes(d1.preparer_id));assert.ok([M2,PT].includes(d1.reviewer_id));assert.notEqual(d1.preparer_id,d1.reviewer_id);assert.ok(d1.preparer_name&&d1.reviewer_name);
 const lm=await leave(M2);const lp=await leave(d1.preparer_id);
 const d2=await ax('MANAGER',{action:'client_team_defaults',client_id:C,firm_id:F});
 assert.equal(d2.reviewer_id,PT,'a reviewer on leave is not suggested');assert.notEqual(d2.preparer_id,d1.preparer_id,'a preparer on leave is not suggested');
 await endLeave(lm);await endLeave(lp);
 const noTeam=await ax('MANAGER',{action:'client_team_defaults',client_id:C,firm_id:G});
 assert.equal(noTeam.preparer_id,null,'nobody on the team works in a firm that does not handle the client');
});
