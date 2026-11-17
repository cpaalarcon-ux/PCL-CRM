import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientMasterAction}=await import('../supabase/functions/staff-workspace-v12/client-master-actions.ts');
const {setupReport}=await import('../supabase/functions/staff-workspace-v12/client-master-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const cm=(role,p)=>as(role,a=>clientMasterAction(tx,a,p));
test('build 2861: the report judges set-up time against a Partner-recorded baseline and target, and says nothing until there is something to judge',()=>{
 const t0='2026-01-05T08:00:00Z',rows=[{client_id:'a',started_at:t0,ready_at:'2026-01-05T09:00:00Z'},{client_id:'b',started_at:t0,ready_at:'2026-01-05T08:20:00Z'},{client_id:'c',started_at:t0,ready_at:null}];
 const none=setupReport(rows,null,null);assert.equal(none.average_minutes,40);assert.equal(none.target_met,null);assert.equal(none.target_percent,null);
 const r=setupReport(rows,600,90);assert.equal(r.reduction_percent,93);assert.equal(r.target_minutes,60);assert.equal(r.target_met,true);
 assert.equal(setupReport(rows,300,90).target_met,false,'40 minutes against 300 is 87% shorter, short of 90');
 assert.equal(setupReport([{client_id:'c',started_at:t0,ready_at:null}],600,90).target_met,null,'nothing finished, nothing judged');
 assert.equal(setupReport(rows,600,null).target_met,null);assert.equal(setupReport(rows,600,150).target_percent,null);
});
test('the baseline: a Partner records it with its source; it is never edited; replacing it needs a reason and keeps the old one',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'BLQA','Fictional baseline firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional baseline client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.client_setup_milestones(client_id,milestone,reached_at,reached_by) values(${C},'Started','2026-01-05T08:00:00Z',${actors.ASSISTANT.staff_id}),(${C},'Ready','2026-01-05T09:00:00Z',${actors.MANAGER.staff_id})`;
 // Before any baseline: the report measures, but judges nothing, and only a Partner is offered the form.
 const r0=await cm('SUPERVISOR',{action:'client_master_report'});assert.equal(r0.summary.average_minutes,60);assert.equal(r0.baseline,null);assert.equal(r0.summary.target_met,null);assert.equal(r0.can_set_baseline,false);
 await assert.rejects(()=>cm('ASSISTANT',{action:'client_master_report'}),/Supervisor, Manager or Partner/);
 const b={action:'setup_baseline_set',measure:'Client set-up',baseline_minutes:480,source:'Timings of the last ten set-ups done the old way'};
 for(const role of ['MANAGER','SUPERVISOR','ASSISTANT'])await assert.rejects(()=>cm(role,b),/Only a Partner/);
 await assert.rejects(()=>cm('PARTNER',{...b,baseline_minutes:0}),/whole minutes/);await assert.rejects(()=>cm('PARTNER',{...b,target_reduction_percent:100}),/whole percentage/);await assert.rejects(()=>cm('PARTNER',{...b,source:'x'}),/where the baseline comes from/i);await assert.rejects(()=>cm('PARTNER',{...b,measure:'Other'}),/Choose Client set-up or Service set-up/);
 const s1=await cm('PARTNER',b);assert.equal(s1.ok,true);assert.equal(s1.replaced,false);assert.equal(s1.baseline.target_reduction_percent,90);
 const r1=await cm('MANAGER',{action:'client_master_report'});assert.equal(r1.baseline.baseline_minutes,480);assert.equal(r1.summary.reduction_percent,88);assert.equal(r1.summary.target_percent,90);assert.equal(r1.summary.target_met,false);assert.equal(r1.can_set_baseline,false);
 // Replacing needs a reason; the old one is kept as history and a new live one applies.
 await assert.rejects(()=>cm('PARTNER',{...b,baseline_minutes:600}),/Say why it is being replaced/);
 const s2=await cm('PARTNER',{...b,baseline_minutes:600,reason:'Re-timed over a full month'});assert.equal(s2.replaced,true);
 const all=await tx`select baseline_minutes,ended_reason from erp_private.setup_baselines where measure='Client set-up' order by set_at,baseline_minutes`;assert.equal(all.length,2);assert.equal(all.filter(x=>x.ended_reason).length,1);
 const r2=await cm('PARTNER',{action:'client_master_report'});assert.equal(r2.summary.reduction_percent,90);assert.equal(r2.summary.target_met,true);assert.equal(r2.can_set_baseline,true);
 // A figure typed into the request is a what-if and does not change the record.
 const w=await cm('PARTNER',{action:'client_master_report',baseline_minutes:100});assert.equal(w.what_if,true);assert.equal(w.summary.reduction_percent,40);assert.equal((await tx`select count(*)::int n from erp_private.setup_baselines where ended_at is null`)[0].n,1);
 // The service measure is separate, and with no service set-up released nothing is judged.
 await cm('PARTNER',{...b,measure:'Service set-up',baseline_minutes:240,target_reduction_percent:80});
 const r3=await cm('PARTNER',{action:'client_master_report'});assert.equal(r3.service_baseline.baseline_minutes,240);assert.equal(r3.service_summary.average_minutes,null);assert.equal(r3.service_summary.target_met,null);assert.equal(r3.service_summary.target_percent,80);
 // The table refuses edits and deletes, and an ended baseline is history.
 await assert.rejects(()=>tx`update erp_private.setup_baselines set baseline_minutes=1 where measure='Service set-up'`,/not edited|cannot change/);
 await assert.rejects(()=>tx`update erp_private.setup_baselines set source='changed source' where ended_at is not null`,/history/);
 await assert.rejects(()=>tx`delete from erp_private.setup_baselines`,/delete|removed|reject/i);
 // The screen offers the form only to a Partner and states the verdict only when there is one.
 const ui=fs.readFileSync(path.join(root,'staff-client-master.mjs'),'utf8');assert.match(ui,/r\.can_set_baseline\?`<details><summary>Record or replace a baseline/);assert.match(ui,/data-target-met=/);assert.match(ui,/so nothing is judged/);
});
