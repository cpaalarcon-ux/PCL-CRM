// Build .109a: Partner time exemption. A Partner's own time is auto-approved and locked once a Partner signs the policy; corrections need a second Partner.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('wiring: server, screen and policy',()=>{
 const acts=rd(fx+'workspace-actions.ts');assert.match(acts,/partner_time_exempt\(\)/);assert.match(acts,/is_auto_approved=\$\{auto\}/);assert.match(acts,/timesheet_partner_list/);assert.match(acts,/second Partner/);
 const ui=rd('staff-workspace-v6.mjs');assert.match(ui,/Partner time/);assert.match(ui,/timesheet_partner_list/);assert.match(ui,/PARTNER_TIME_POLICY/);assert.match(ui,/Auto-approved \(Partner policy\)/);
});
test('Partner time is auto-approved only under a signed policy, and only a second Partner can correct it',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PTM','Fictional partner time firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id,P1=actors.PARTNER.staff_id,P2=actors.PARTNER2.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Partner Time Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional partner time project','TAX-COMP',${M})`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const T1=id(),T2=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T1},${P},${P1},'Fictional partner task'),(${T2},${P},${P2},'Fictional second partner task')`;
 const auto=(role,T,hours,extra={})=>as(role,a=>tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,reviewed_by,reviewed_at,review_note,is_auto_approved) values(${extra.staff??a.staff_id},${P},${T},'2026-11-05',${hours},'Fictional partner work',true,'Approved',${extra.reviewer??a.staff_id},now(),'Partner time, auto-approved',true) returning timesheet_id`);
 // 1. Policy exists and is Pending: the exemption is not available yet.
 assert.equal((await tx`select status from erp_private.system_policies where policy_code='PARTNER_TIME_POLICY'`)[0].status,'Pending');
 await assert.rejects(()=>auto('PARTNER',T1,2),/not auto-approved until a Partner signs/);
 // The normal route still works for a Partner while the policy is Pending: submit, and a second Partner approves.
 const norm=(await as('PARTNER',a=>tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status) values(${a.staff_id},${P},${T1},'2026-11-04',1,'Fictional normal route',true,'Submitted') returning timesheet_id`))[0].timesheet_id;
 await as('PARTNER',()=>tx`update erp_private.timesheets set status='Approved',reviewed_by=${P1},reviewed_at=now(),review_note='I approve my own time' where timesheet_id=${norm}`).catch(()=>{});
 assert.equal((await tx`select status from erp_private.timesheets where timesheet_id=${norm}`)[0].status,'Submitted','a Partner cannot approve their own time on the normal route');
 await as('PARTNER2',a=>tx`update erp_private.timesheets set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note='Checked by the second Partner' where timesheet_id=${norm}`);
 // 2. A Manager cannot use the flag, and nobody can flag time for someone else.
 await assert.rejects(()=>auto('MANAGER',T1,1),/own time can be auto-approved|not auto-approved/);
 // 3. A Partner signs the policy; only a Partner can.
 await as('MANAGER',()=>tx`update erp_private.system_policies set status='Signed_Off' where policy_code='PARTNER_TIME_POLICY'`).catch(()=>{});
 assert.equal((await tx`select status from erp_private.system_policies where policy_code='PARTNER_TIME_POLICY'`)[0].status,'Pending','a Manager cannot sign a policy');
 await as('PARTNER2',()=>tx`update erp_private.system_policies set status='Signed_Off' where policy_code='PARTNER_TIME_POLICY'`);
 // 4. Now a Partner's own time is saved approved, flagged, and never in a queue.
 const ts=(await auto('PARTNER',T1,3))[0].timesheet_id;
 const row=(await tx`select status,is_auto_approved,reviewed_by,review_note from erp_private.timesheets where timesheet_id=${ts}`)[0];
 assert.deepEqual([row.status,row.is_auto_approved,row.reviewed_by],['Approved',true,P1]);assert.match(row.review_note,/auto-approved/);
 assert.equal((await tx`select count(*)::int n from erp_private.timesheets where status='Submitted' and is_auto_approved`)[0].n,0);
 // It is locked: no edits or deletes.
 await as('PARTNER',()=>tx`update erp_private.timesheets set hours=1 where timesheet_id=${ts}`).catch(()=>{});
 assert.equal(Number((await tx`select hours from erp_private.timesheets where timesheet_id=${ts}`)[0].hours),3,'approved time cannot be edited');
 // The flag cannot be used with the wrong shape, for someone else's time, or by a non-Partner.
 await assert.rejects(()=>auto('PARTNER',T1,1,{staff:P2}),/violates|row-level|own time/i);
 await assert.rejects(()=>as('PARTNER',a=>tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,is_auto_approved) values(${a.staff_id},${P},${T1},'2026-11-05',1,'Fictional shape check',true,'Submitted',true)`),/violates|auto-approved/i);
 await assert.rejects(()=>auto('ASSISTANT',T1,1),/own time|not auto-approved|violates|row-level/i);
 // 5. Corrections: the owner, a Manager and a short note are all refused; a second Partner with a reason works and the original stays.
 const rev=(role,reason)=>as(role,a=>tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,reviewed_by,reviewed_at,review_note,reverses_id) values(${P1},${P},${T1},'2026-11-05',-3,${reason},true,'Approved',${a.staff_id},now(),${reason},${ts})`);
 await assert.rejects(()=>rev('PARTNER','Owner tries to correct own time'),/second Partner|own|Manager review|violates/i);
 await assert.rejects(()=>rev('MANAGER','Manager tries to correct a Partner'),/second Partner/);
 await assert.rejects(()=>rev('PARTNER2','too short'),/at least 10 characters/);
 await rev('PARTNER2','Wrong task selected; entered again on the right task');
 assert.equal((await tx`select count(*)::int n from erp_private.timesheets where reverses_id=${ts}`)[0].n,1);
 assert.equal((await tx`select status from erp_private.timesheets where timesheet_id=${ts}`)[0].status,'Approved','the original is never edited');
 // 6. Read-only Partner list: Partners only.
 const list=await as('PARTNER2',()=>tx`select * from erp_private.partner_time_list(90)`);
 assert.equal(list.length,1);assert.deepEqual([list[0].timesheet_id,list[0].reversed,list[0].own],[ts,true,false]);
 assert.equal((await as('PARTNER',()=>tx`select own from erp_private.partner_time_list(90)`))[0].own,true);
 await assert.rejects(()=>as('MANAGER',()=>tx`select * from erp_private.partner_time_list(90)`),/Only a Partner/);
 // 7. Partners are never flagged as overloaded.
 for(let i=0;i<16;i++){await tx`insert into erp_private.tasks(project_id,assigned_to,task_name) values(${P},${P1},${'Fictional load '+i}),(${P},${M},${'Fictional mgr load '+i})`;}
 const wl=await as('PARTNER2',()=>tx`select staff_id,is_overloaded,active_tasks from erp_private.team_workload()`);
 assert.equal(wl.find(x=>x.staff_id===P1).is_overloaded,false);assert.ok(wl.find(x=>x.staff_id===P1).active_tasks>15);assert.equal(wl.find(x=>x.staff_id===M).is_overloaded,true);
});
