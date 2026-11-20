// Approval notes and Supervisor-prepared work: the database refuses a decision without a real note (10+ characters, NULL included),
// treats Supervisor-prepared work like Assistant work, records the three new Partner policies, and serves the approval trail.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('approval notes are enforced by the database; Supervisor work needs a check; the trail is served to reviewers only',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;

 for(const role of ['ASSISTANT','SUPERVISOR'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 // 1. A Supervisor is a preparer who needs a check, like an Assistant; a Manager is not.
 const junior=async r=>(await tx`select erp_private.is_junior_preparer(${actors[r].staff_id}) j`)[0].j;
 assert.equal(await junior('ASSISTANT'),true);assert.equal(await junior('SUPERVISOR'),true);assert.equal(await junior('MANAGER'),false);assert.equal(await junior('PARTNER'),false);
 // 2. Leave: a decision needs a note of 10+ characters, and a missing note fails too.
 const LV=id();await tx`insert into erp_private.leave_requests(leave_id,staff_id,leave_type,starts_on,ends_on,working_days,reason) values(${LV},${actors.ASSISTANT.staff_id},'Annual','2027-03-01','2027-03-02',2,'Fictional family event')`;
 const dec=(note)=>tx`update erp_private.leave_requests set status='Approved',reviewed_by=${actors.MANAGER.staff_id},review_note=${note} where leave_id=${LV}`;
 await assert.rejects(()=>dec(null),/at least 10 characters/);await assert.rejects(()=>dec('ok'),/at least 10 characters/);await assert.rejects(()=>dec('         x        '),/at least 10 characters/);await assert.rejects(()=>dec('123456789'),/at least 10 characters/);
 assert.equal((await tx`select status from erp_private.leave_requests where leave_id=${LV}`)[0].status,'Pending','nothing changed');
 await dec('Cover agreed with the team');assert.equal((await tx`select status from erp_private.leave_requests where leave_id=${LV}`)[0].status,'Approved');
 // 3. Only status changes are checked: editing an already decided row, or a row that stays Pending, is not blocked.
 const LV2=id();await tx`insert into erp_private.leave_requests(leave_id,staff_id,leave_type,starts_on,ends_on,working_days,reason) values(${LV2},${actors.ASSISTANT.staff_id},'Sick','2027-04-01','2027-04-01',1,'Fictional clinic visit')`;
 await tx`update erp_private.leave_requests set reason='Fictional clinic visit (updated)' where leave_id=${LV2}`;
 // 4. Handover: reallocating or declining needs a note of 10+ characters.
 const T=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,status) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional VAT task','Pending')`;
 const H=id();await tx`insert into erp_private.task_handovers(handover_id,project_id,task_id,handling_firm_id,requested_by,narration) values(${H},${P},${T},${F},${actors.ASSISTANT.staff_id},'Fictional handover: returns drafted, bank review left')`;
 const ho=(st,note)=>tx`update erp_private.task_handovers set status=${st},new_assignee_id=${st==='Reallocated'?actors.SUPERVISOR.staff_id:null},decided_by=${actors.MANAGER.staff_id},decided_at=now(),decision_note=${note} where handover_id=${H}`;
 await assert.rejects(()=>ho('Reallocated',null),/at least 10 characters/);await assert.rejects(()=>ho('Reallocated','short'),/at least 10 characters/);
 await ho('Reallocated','Bank review is the only item left');
 // 5. The approval trail: created, status changes and the comments, for Supervisor, Manager or Partner only, for named record types only.
 const trail=await as('SUPERVISOR',()=>tx`select * from erp_private.approval_trail('leave_requests',${'{'+LV+'}'}::text[])`);
 assert.ok(trail.length>=2&&trail.some(r=>/^Created/.test(r.step))&&trail.some(r=>/Pending > Approved/.test(r.step)&&r.comment==='Cover agreed with the team'),'created and decided steps with the comment');
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select * from erp_private.approval_trail('leave_requests',${'{'+LV+'}'}::text[])`),/Supervisor, Manager or Partner required/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select * from erp_private.approval_trail('staff_credentials',${'{'+LV+'}'}::text[])`),/Unsupported record type/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select * from erp_private.approval_trail('leave_requests',${'{}'}::text[])`),/between 1 and 1000/);
});
