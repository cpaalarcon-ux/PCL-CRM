import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {handoverAction}=await import('../supabase/functions/staff-workspace-v12/handover-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),C2=id(),P=id(),T1=id(),T2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>handoverAction(tx,a,p));
const count=(role,table)=>as(role,()=>tx(Object.assign([`select count(*)::int n from erp_private.${table}`],{raw:[`select count(*)::int n from erp_private.${table}`]}))).then(r=>r[0].n);
test('assistants see only assigned work; unfinished work is handed over with a narration and reallocated by a Supervisor, Manager or Partner',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'HOQA','Fictional handover firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','ASSISTANT2','INTERN']){const cat=role.replace(/\d/,'');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat,full_name:'Fictional '+role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${a.full_name},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Mlima Traders',${actors.MANAGER.staff_id}),(${C2},'Unassigned Fictional Client',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C2},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Mlima monthly tax','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of ['MANAGER','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T1},${P},${actors.ASSISTANT.staff_id},'Capture January sales'),(${T2},${P},${actors.ASSISTANT.staff_id},'Capture January purchases')`;

 // An assistant sees only the client and project they are assigned to; nothing unassigned.
 assert.equal(await count('ASSISTANT','clients'),1,'the assigned client only, never the unassigned one');
 assert.equal(await count('ASSISTANT2','clients'),0);assert.equal(await count('ASSISTANT2','projects'),0);assert.equal(await count('ASSISTANT2','tasks'),0);

 // Request rules.
 await assert.rejects(()=>act('ASSISTANT',{action:'task_handover_request',project_id:P,task_id:T1,narration:'too short'}),/at least 10 characters/);
 await assert.rejects(()=>act('ASSISTANT2',{action:'task_handover_request',project_id:P,task_id:T1,narration:'Not my task but I try anyway.'}),/only your own open task/);
 const req=await act('ASSISTANT',{action:'task_handover_request',project_id:P,task_id:T1,narration:'January sales are 80% captured; the till rolls for 20-31 Jan are still with the client.'});
 assert.ok(req.handover_id);
 await assert.rejects(()=>act('ASSISTANT',{action:'task_handover_request',project_id:P,task_id:T1,narration:'Asking a second time for the same task.'}),/already waiting/);
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where recipient_id=${actors.SUPERVISOR.staff_id} and message like 'Handover requested%'`)[0].n,1,'the Supervisor is alerted');
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where recipient_id=${actors.ASSISTANT.staff_id} and message like 'Handover requested%'`)[0].n,0,'the requester is not alerted about their own request');

 // Who may decide and see the queue.
 await assert.rejects(()=>act('ASSISTANT',{action:'task_handover_decide',handover_id:req.handover_id,decision:'Reallocated',new_assignee_id:actors.ASSISTANT2.staff_id}),/Only a Supervisor, Manager or Partner/);
 await assert.rejects(()=>act('ASSISTANT',{action:'task_handover_reallocate',project_id:P,task_id:T2,new_assignee_id:actors.ASSISTANT2.staff_id,reason:'An assistant cannot reallocate directly.'}),/Only a Supervisor, Manager or Partner/);
 assert.equal((await act('ASSISTANT',{action:'task_handover_list'})).handovers.length,1,'the requester sees their own request');
 assert.equal((await act('ASSISTANT2',{action:'task_handover_list'})).handovers.length,0,'other assistants see nothing');
 const queue=(await act('SUPERVISOR',{action:'task_handover_list'})).handovers;
 assert.equal(queue.length,1);assert.equal(queue[0].client_name,'Mlima Traders');assert.equal(queue[0].task_name,'Capture January sales');assert.match(queue[0].narration,/till rolls/);
 await assert.rejects(()=>act('ASSISTANT',{action:'task_handover_candidates',project_id:P}),/Only a Supervisor, Manager or Partner/);
 const cands=(await act('SUPERVISOR',{action:'task_handover_candidates',project_id:P,exclude:actors.ASSISTANT.staff_id})).candidates.map(x=>x.full_name).sort();
 assert.deepEqual(cands,['Fictional ASSISTANT2','Fictional MANAGER','Fictional PARTNER','Fictional SUPERVISOR'],'active firm staff; never the person handing over and never an intern');

 // Reallocation.
 await assert.rejects(()=>act('SUPERVISOR',{action:'task_handover_decide',handover_id:req.handover_id,decision:'Reallocated',new_assignee_id:actors.ASSISTANT.staff_id}),/another active staff member/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'task_handover_decide',handover_id:req.handover_id,decision:'Reallocated',new_assignee_id:actors.INTERN.staff_id}),/another active staff member/);
 const done=await act('SUPERVISOR',{action:'task_handover_decide',handover_id:req.handover_id,decision:'Reallocated',new_assignee_id:actors.ASSISTANT2.staff_id,note:'Chase the client for the till rolls first.'});
 assert.equal(done.moved,1);
 assert.equal((await tx`select assigned_to from erp_private.tasks where task_id=${T1}`)[0].assigned_to,actors.ASSISTANT2.staff_id);
 assert.equal((await tx`select assigned_to from erp_private.tasks where task_id=${T2}`)[0].assigned_to,actors.ASSISTANT.staff_id,'the other task stays with the first assistant');
 assert.equal(await count('ASSISTANT2','projects'),1,'the new assignee now sees the project');assert.equal(await count('ASSISTANT2','tasks'),1);
 assert.equal((await tx`select count(*)::int n from erp_private.task_events where task_id=${T1} and event_type='Forwarded' and reason like 'Handover:%'`)[0].n,1,'recorded in the task history');
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where recipient_id=${actors.ASSISTANT2.staff_id} and message like 'Reallocated to you%'`)[0].n,1);
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where recipient_id=${actors.ASSISTANT.staff_id} and message like 'Handover accepted%'`)[0].n,1);
 await assert.rejects(()=>act('MANAGER',{action:'task_handover_decide',handover_id:req.handover_id,decision:'Declined',note:'Already decided earlier today.'}),/already decided/);
 assert.equal((await act('SUPERVISOR',{action:'task_handover_list'})).handovers.length,0,'a decided request leaves the open queue');
 assert.equal((await act('SUPERVISOR',{action:'task_handover_list',history:true,task_id:T1})).handovers[0].new_assignee_name,'Fictional ASSISTANT2');

 // Decline needs a reason; the work stays put.
 const req2=await act('ASSISTANT',{action:'task_handover_request',project_id:P,task_id:T2,narration:'I am on leave from Monday and cannot finish the purchases.'});
 await assert.rejects(()=>act('MANAGER',{action:'task_handover_decide',handover_id:req2.handover_id,decision:'Declined',note:'no'}),/at least 10 characters/);
 await act('MANAGER',{action:'task_handover_decide',handover_id:req2.handover_id,decision:'Declined',note:'Leave starts after the filing date; finish it first.'});
 assert.equal((await tx`select status from erp_private.task_handovers where handover_id=${req2.handover_id}`)[0].status,'Declined');
 assert.equal((await tx`select assigned_to from erp_private.tasks where task_id=${T2}`)[0].assigned_to,actors.ASSISTANT.staff_id);

 // The whole project: requested by the assistant, then reallocated directly by a Partner.
 const req3=await act('ASSISTANT',{action:'task_handover_request',project_id:P,narration:'I am leaving the engagement; please take all my open work on it.'});
 assert.ok(req3.handover_id);
 const moved=await act('PARTNER',{action:'task_handover_decide',handover_id:req3.handover_id,decision:'Reallocated',new_assignee_id:actors.ASSISTANT2.staff_id});
 assert.equal(moved.moved,1);
 assert.equal(await count('ASSISTANT','projects'),0,'the first assistant no longer sees the project or client');assert.equal(await count('ASSISTANT','clients'),0);

 // Direct reallocation by a Supervisor, recorded in the same table.
 const direct=await act('SUPERVISOR',{action:'task_handover_reallocate',project_id:P,task_id:T1,new_assignee_id:actors.SUPERVISOR.staff_id,reason:'Supervisor takes the sales capture to finish before the deadline.'});
 assert.equal(direct.moved,1);
 assert.equal((await tx`select assigned_to from erp_private.tasks where task_id=${T1}`)[0].assigned_to,actors.SUPERVISOR.staff_id);
 assert.equal((await tx`select count(*)::int n from erp_private.task_handovers where decision_note='Direct reallocation'`)[0].n,1);
 await assert.rejects(()=>act('SUPERVISOR',{action:'task_handover_reallocate',project_id:P,task_id:T1,new_assignee_id:actors.SUPERVISOR.staff_id,reason:'Same person again, which is pointless.'}),/another active staff member/);

 // There is no suspense account.
 assert.equal((await tx`select count(*)::int n from erp_private.account_catalog where code='37000'`)[0].n,0);
 await assert.rejects(()=>tx`insert into erp_private.account_catalog(code,name,account_group,category_code,statement,status) values('37000','Opening balances suspense','Equity','EQ','BS','Draft')`,/no suspense account/);
});
