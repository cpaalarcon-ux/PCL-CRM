// Build .109b: Escalate to Partner, and the communication access level on each client.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {commAccessCard,commExternalAllowed,COMM_LEVELS} from '../staff-client-lifecycle.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('access card and role rules on screen',()=>{
 assert.equal(commExternalAllowed('PARTNER','MANAGERS_AND_PARTNERS'),true);assert.equal(commExternalAllowed('MANAGER','MANAGERS_AND_PARTNERS'),true);
 assert.equal(commExternalAllowed('SUPERVISOR','SUPERVISORS_AND_ABOVE'),true);assert.equal(commExternalAllowed('SUPERVISOR','MANAGERS_AND_PARTNERS'),false);assert.equal(commExternalAllowed('SUPERVISOR',undefined),true);
 for(const r of ['ASSISTANT','INTERN','ADMIN'])assert.equal(commExternalAllowed(r,'SUPERVISORS_AND_ABOVE'),false);
 const c={client_id:'c1',comm_access_level:'MANAGERS_AND_PARTNERS'};
 assert.match(commAccessCard(c,'MANAGER',esc),/data-comm-form="c1"/);assert.match(commAccessCard(c,'MANAGER',esc),/<option value="MANAGERS_AND_PARTNERS" selected>/);
 assert.doesNotMatch(commAccessCard(c,'SUPERVISOR',esc),/data-comm-form/);assert.match(commAccessCard(c,'ASSISTANT',esc),/locked for your role/);assert.equal(COMM_LEVELS.length,2);
});
test('wiring: escalate to Partner and access level',()=>{
 const v6=rd('staff-workspace-v6.mjs');assert.match(v6,/partner_escalation_raise/);assert.match(v6,/partner_escalation_answer/);assert.match(v6,/Escalated to Partners|Escalate to a Partner/);
 assert.match(rd('staff-task-workspace.mjs'),/data-v6="ask-partner"/);assert.match(rd('staff-task-workspace.mjs'),/\['SUPERVISOR','MANAGER','PARTNER'\]/);
 assert.match(rd('staff-dashboard.mjs'),/id="homePartnerEscalations"/);assert.match(rd('staff-pilot.mjs'),/paintPartnerEscalations/);assert.match(rd('staff-pilot.mjs'),/client_comm_access_save/);
 assert.match(rd(fx+'escalation-actions.ts'),/partner_escalation_/);assert.match(rd(fx+'client-lifecycle-actions.ts'),/client_comm_access_save/);assert.match(rd(fx+'suite-actions.ts'),/comm_external_allowed/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('escalation to Partners and communication access, enforced by the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'ESC','Fictional escalation firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id,P1=actors.PARTNER.staff_id,P2=actors.PARTNER2.staff_id,S=actors.SUPERVISOR.staff_id,A=actors.ASSISTANT.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Escalation Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional escalation project','TAX-COMP',${M})`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const T=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${A},'Fictional escalated task')`;
 const raise=(role,task,why)=>as(role,()=>tx`select erp_private.partner_escalation_raise(${P}::uuid,${task}::uuid,${why}) id`).then(r=>r[0].id);
 // Escalate to Partner: Supervisors, Managers and Partners only.
 await assert.rejects(()=>raise('ASSISTANT',T,'Assistants cannot escalate to Partners'),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>raise('SUPERVISOR',T,'too short'),/at least 10 characters/);
 const e1=await raise('SUPERVISOR',T,'Client disputes the fee; a Partner must decide before filing');
 await assert.rejects(()=>raise('SUPERVISOR',T,'Client disputes the fee; a Partner must decide before filing'),/already escalated/);
 const e2=await raise('MANAGER',null,'Possible conflict of interest on this engagement');
 const e3=await raise('PARTNER',T,'Partner flags a regulatory deadline risk');
 // Urgent alerts go to every OTHER active Partner.
 const n=await tx`select recipient_id,message from erp_private.notifications where event_key like ${'partner-escalation:'+e1+':%'}`;
 assert.deepEqual(n.map(x=>x.recipient_id).sort(),[P1,P2].sort());assert.match(n[0].message,/^URGENT: escalated to the Partners/);
 const n3=await tx`select recipient_id from erp_private.notifications where event_key like ${'partner-escalation:'+e3+':%'}`;assert.deepEqual(n3.map(x=>x.recipient_id),[P2],'a Partner who escalates is not alerted about their own item');
 // Who sees what.
 const list=(role,hist=false)=>as(role,()=>tx`select escalation_id,status from erp_private.partner_escalation_list(${hist})`);
 assert.equal((await list('PARTNER2')).length,3);assert.deepEqual((await list('SUPERVISOR')).map(x=>x.escalation_id),[e1],'a Supervisor sees only their own');assert.equal((await list('ASSISTANT')).length,0);
 // Answering: Partners only, never the person who raised it, written note.
 const ans=(role,id,note)=>as(role,()=>tx`select erp_private.partner_escalation_answer(${id}::uuid,${note})`);
 await assert.rejects(()=>ans('MANAGER',e1,'A Manager cannot answer this'),/Only a Partner/);
 await assert.rejects(()=>ans('PARTNER',e3,'I answer my own escalation'),/Another Partner/);
 await assert.rejects(()=>ans('PARTNER2',e1,'short'),/at least 10 characters/);
 await ans('PARTNER2',e1,'Hold the filing; I will call the client today.');
 await assert.rejects(()=>ans('PARTNER',e1,'Second answer on the same item'),/already answered/);
 const raiserNote=await tx`select message from erp_private.notifications where recipient_id=${S} and event_key=${'partner-escalation-answer:'+e1}`;assert.match(raiserNote[0].message,/answered your escalation/);
 assert.equal((await list('PARTNER2')).length,2,'answered items leave the open list');assert.equal((await list('PARTNER2',true)).length,3);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.partner_escalations where escalation_id=${e1}`),/permission|cannot be deleted|delete/i);
 // Communication access. External channels are locked for Assistants; Supervisors follow the client's level; internal notes stay open.
 const com=(role,channel,ref)=>as(role,a=>tx`insert into erp_private.communications(request_id,reference,client_id,firm_id,channel,subject,purpose,details,communication_date,signatory_id,owner_id) values(${id()},${ref},${C},${F},${channel},'Fictional subject','Fictional purpose','Fictional details',current_date,${a.staff_id},${a.staff_id}) returning communication_id`);
 const seen=role=>as(role,()=>tx`select reference from erp_private.communications order by reference`).then(r=>r.map(x=>x.reference));
 await assert.rejects(()=>com('ASSISTANT','Letter','A-LET-1'),/row-level security/);
 await com('ASSISTANT','Internal note','A-NOTE-1');await com('SUPERVISOR','Letter','S-LET-1');await com('MANAGER','Call','M-CALL-1');await com('SUPERVISOR','Internal note','S-NOTE-1');
 assert.deepEqual(await seen('ASSISTANT'),['A-NOTE-1','S-NOTE-1'],'an Assistant sees only internal notes');
 assert.deepEqual(await seen('SUPERVISOR'),['A-NOTE-1','M-CALL-1','S-LET-1','S-NOTE-1']);
 // Changing the level: Manager or Partner, with a reason, only through the function.
 const level=(role,lvl,why)=>as(role,()=>tx`select erp_private.client_comm_access_save(${C}::uuid,${lvl},${why})`);
 await assert.rejects(()=>level('SUPERVISOR','MANAGERS_AND_PARTNERS','Supervisor tries to tighten'),/Only a Manager or Partner/);
 await assert.rejects(()=>level('MANAGER','MANAGERS_AND_PARTNERS','short'),/at least 10 characters/);
 await assert.rejects(()=>level('MANAGER','EVERYONE','Not a valid level at all'),/valid access level/);
 await as('MANAGER',()=>tx`update erp_private.clients set comm_access_level='MANAGERS_AND_PARTNERS' where client_id=${C}`).catch(()=>{});
 assert.equal((await tx`select comm_access_level l from erp_private.clients where client_id=${C}`)[0].l,'SUPERVISORS_AND_ABOVE','direct edits do not change it');
 await level('MANAGER','MANAGERS_AND_PARTNERS','Sensitive dispute; Partners handle all contact');
 assert.equal((await tx`select comm_access_level l from erp_private.clients where client_id=${C}`)[0].l,'MANAGERS_AND_PARTNERS');
 await assert.rejects(()=>com('SUPERVISOR','Email','S-MAIL-2'),/row-level security/);
 assert.deepEqual(await seen('SUPERVISOR'),['A-NOTE-1','S-NOTE-1'],'a Supervisor now sees internal notes only');
 await com('PARTNER','Meeting','P-MEET-1');assert.deepEqual(await seen('MANAGER'),['A-NOTE-1','M-CALL-1','P-MEET-1','S-LET-1','S-NOTE-1']);
});
