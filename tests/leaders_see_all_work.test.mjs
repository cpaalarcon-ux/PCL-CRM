import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {reviewQueueAction} from '../supabase/functions/staff-workspace-v12/review-queue.ts';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),C2=id(),C3=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('Partners, Managers and Supervisors see all work in their firms; Assistants see only what is assigned; Supervisors escalate to Managers',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VSQA','Fictional visibility firm'),(${F2},'VSQB','Fictional second firm')`;
 const staff=async(role,cat,firm)=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${firm},'Assigned')`;};
 await staff('PARTNER','PARTNER',F);await staff('MANAGER','MANAGER',F);await staff('MANAGER2','MANAGER',F);await staff('OTHERFIRM','MANAGER',F2);await staff('SUPERVISOR','SUPERVISOR',F);await staff('ASSISTANT','ASSISTANT',F);await staff('ASSISTANT2','ASSISTANT',F);await staff('INTERN','INTERN',F);
 // MANAGER created everything. C is linked to F with a project; C2 has no firm link yet; C3 belongs to the second firm only.
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Mlima Traders',${actors.MANAGER.staff_id}),(${C2},'Pwani Fresh',${actors.MANAGER.staff_id}),(${C3},'Bonde Foods',${actors.OTHERFIRM.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C3},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Mlima Traders accounts','TAX-COMP',${actors.MANAGER.staff_id})`;
 const names=(role,table,col)=>as(role,async()=>(await tx(['select '+col+' n from erp_private.'+table+' order by 1'])).map(x=>x.n));
 const clients=role=>names(role,'clients','company_name'),projects=role=>names(role,'projects','project_name');

 assert.deepEqual(await clients('PARTNER'),['Bonde Foods','Mlima Traders','Pwani Fresh'],'a Partner sees everything');
 assert.deepEqual(await clients('MANAGER'),['Mlima Traders','Pwani Fresh'],'the creator sees their own, not another firm');
 assert.deepEqual(await clients('MANAGER2'),['Mlima Traders','Pwani Fresh'],'another Manager sees every client of the firm, including one with no firm link yet, though they did not create it or work on it');
 assert.deepEqual(await projects('MANAGER2'),['Mlima Traders accounts']);
 assert.deepEqual(await clients('OTHERFIRM'),['Bonde Foods','Pwani Fresh'],'a Manager of another firm does not see this firm\'s client, but does see an unlinked new one');
 assert.deepEqual(await projects('OTHERFIRM'),[]);
 assert.deepEqual(await clients('SUPERVISOR'),['Mlima Traders','Pwani Fresh'],'a Supervisor sees the firm\'s clients');
 assert.deepEqual(await projects('SUPERVISOR'),['Mlima Traders accounts'],'and its projects');
 assert.equal((await as('SUPERVISOR',()=>tx`select count(*)::int n from erp_private.client_firm_links`))[0].n,1,'and the firm link, so the client list can place them');
 for(const role of ['ASSISTANT','ASSISTANT2','INTERN']){assert.deepEqual(await clients(role),[],role+' sees nothing that is not assigned');assert.deepEqual(await projects(role),[]);}

 // Work inside the project: Supervisors see all of it like Managers; an Assistant sees only the client, project and task assigned to them.
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors.ASSISTANT.staff_id},${F},'ASSISTANT'),(${P},${actors.MANAGER.staff_id},${F},'MANAGER')`;
 const TA=id(),TM=id();
 await tx`insert into erp_private.tasks(task_id,project_id,task_name,assigned_to) values(${TA},${P},'Mlima bank reconciliation',${actors.ASSISTANT.staff_id}),(${TM},${P},'Mlima VAT return',${actors.MANAGER.staff_id})`;
 const tasks=role=>names(role,'tasks','task_name');
 assert.deepEqual(await tasks('MANAGER2'),['Mlima VAT return','Mlima bank reconciliation']);
 assert.deepEqual(await tasks('SUPERVISOR'),['Mlima VAT return','Mlima bank reconciliation'],'a Supervisor sees the work inside other people\'s projects');
 assert.deepEqual(await tasks('ASSISTANT'),['Mlima bank reconciliation'],'an Assistant sees only their own task');
 assert.deepEqual(await clients('ASSISTANT'),['Mlima Traders'],'and only the client and project they are assigned to');
 assert.deepEqual(await projects('ASSISTANT'),['Mlima Traders accounts']);
 assert.deepEqual(await tasks('ASSISTANT2'),[]);assert.deepEqual(await clients('ASSISTANT2'),[]);

 // Overall rights: a Manager who did not create the work can change the client and the project.
 await as('MANAGER2',async()=>{await tx`update erp_private.clients set company_name='Mlima Traders Limited' where client_id=${C}`;await tx`update erp_private.projects set project_name='Mlima Traders annual accounts' where project_id=${P}`;});
 assert.equal((await db.query(`select company_name from erp_private.clients where client_id=$1`,[C])).rows[0].company_name,'Mlima Traders Limited');
 assert.equal((await db.query(`select project_name from erp_private.projects where project_id=$1`,[P])).rows[0].project_name,'Mlima Traders annual accounts');
 // Approvals and client setup stay with Managers and Partners: a Supervisor cannot change the client record.
 await as('SUPERVISOR',()=>tx`update erp_private.clients set company_name='Changed by a Supervisor' where client_id=${C}`);
 assert.equal((await db.query(`select company_name from erp_private.clients where client_id=$1`,[C])).rows[0].company_name,'Mlima Traders Limited');

 // Reviewers: a Manager of the firm and every Partner, never the person acting.
 const reviewers=async role=>(await as(role,()=>tx`select full_name from erp_private.review_candidates(${C})`)).map(x=>x.full_name).sort();
 assert.deepEqual(await reviewers('MANAGER'),['Fictional MANAGER2','Fictional PARTNER']);
 assert.deepEqual(await reviewers('MANAGER2'),['Fictional MANAGER','Fictional PARTNER']);

 // Escalation: a Supervisor sends something they cannot handle to a named Manager. Partners are alerted as well; other Managers are not.
 const all=async role=>(await db.query(`select message from erp_private.notifications where recipient_id=$1 order by created_at`,[actors[role].staff_id])).rows.map(x=>x.message);
 const seen={};for(const role of Object.keys(actors))seen[role]=(await all(role)).length; // task assignment alerts from the set-up above are not escalations
 const notes=async role=>(await all(role)).slice(seen[role]);
 const raise=(role,task,reason,manager)=>as(role,async()=>(await tx`select erp_private.escalation_raise(${P}::uuid,${task}::uuid,${reason},${manager}::uuid) id`)[0].id);
 const listed=(role,history=false)=>as(role,()=>tx`select * from erp_private.escalation_list(${history})`);
 const eid=await raise('SUPERVISOR',TM,'The client wants to add wholesale trade and I cannot approve it.',actors.MANAGER2.staff_id);
 assert.equal((await notes('MANAGER2')).length,1);assert.equal((await notes('PARTNER')).length,1);assert.equal((await notes('MANAGER')).length,0,'a Manager it was not sent to is not alerted');
 assert.match((await notes('MANAGER2'))[0],/Escalated to you by Fictional SUPERVISOR for Mlima Traders Limited \(Mlima VAT return\)/);
 await assert.rejects(()=>raise('SUPERVISOR',TM,'The client wants to add wholesale trade and I cannot approve it.',actors.MANAGER2.staff_id),/already escalated/);
 await assert.rejects(()=>raise('MANAGER',TM,'Managers decide directly, they do not escalate.',null),/Only a Supervisor or Assistant/);
 await assert.rejects(()=>raise('ASSISTANT2',TA,'I am not assigned to this work at all.',null),/Escalation unavailable/);
 await assert.rejects(()=>raise('SUPERVISOR',TM,'Please decide this one for me.',actors.OTHERFIRM.staff_id),/not a Manager or Partner available/);
 assert.equal((await listed('MANAGER2')).length,1);assert.equal((await listed('PARTNER')).length,1);assert.equal((await listed('SUPERVISOR')).length,1,'the person who raised it can follow it');
 assert.equal((await listed('MANAGER')).length,0,'it was not sent to this Manager');assert.equal((await listed('ASSISTANT')).length,0);
 const queue=role=>as(role,a=>reviewQueueAction(tx,a,{action:'v3_review_queue'}));
 const q=(await queue('MANAGER2')).items.filter(x=>x.kind==='escalation');assert.equal(q.length,1,'it is on the Manager\'s Home list');assert.equal(q[0].sent_to_me,true);assert.match(q[0].title,/Escalated by Fictional SUPERVISOR/);assert.match(q[0].detail,/wholesale trade/);
 assert.equal((await queue('MANAGER')).items.filter(x=>x.kind==='escalation').length,0);assert.equal((await queue('SUPERVISOR')).items.length,0);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.escalation_resolve(${eid}::uuid,'Handle it this way please.')`),/Only that Manager or a Partner/);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.escalation_resolve(${eid}::uuid,'Handle it this way please.')`),/Only a Manager or Partner/);
 await as('MANAGER2',()=>tx`select erp_private.escalation_resolve(${eid}::uuid,'Approved: add it from 1 July and I will review the setup.')`);
 assert.match((await notes('SUPERVISOR'))[0],/Your escalation for Mlima Traders Limited was answered by Fictional MANAGER2: Approved/);
 assert.equal((await listed('MANAGER2')).length,0,'an answered escalation leaves the list');assert.equal((await listed('MANAGER2',true)).length,1);
 await assert.rejects(()=>as('PARTNER',()=>tx`select erp_private.escalation_resolve(${eid}::uuid,'Handle it this way please.')`),/already resolved/);
 // An Assistant can ask too, on their own task; with nobody named, every Manager and Partner is alerted.
 await raise('ASSISTANT',TA,'I cannot find the supplier statement and need a decision.',null);
 assert.equal((await notes('MANAGER')).length,1);assert.equal((await notes('MANAGER2')).length,2);assert.equal((await notes('PARTNER')).length,2);
});
