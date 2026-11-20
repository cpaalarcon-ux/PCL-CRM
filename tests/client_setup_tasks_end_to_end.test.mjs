import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {clientSetupReviewAction}=await import('../supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');


const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const rv=(role,p)=>as(role,a=>clientSetupReviewAction(tx,a,p));

test('Client Setup Tasks: tasks come only from recorded data, are split by who can act, and reading changes nothing',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'TSKQA','Fictional tasks firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT','INTERN']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const C=id(),P=id();
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL TASKS LIMITED','P051000009A','Wholesale & Retail','Nairobi','Limited company','CR-FICTIONAL-0009 fictional certificate',10,31,${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional books','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const r of ['PARTNER','MANAGER','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[r].staff_id},${F},'MANAGER')`;
 const counts=async()=>({sec:(await tx`select count(*)::int n from erp_private.client_setup_sections`)[0].n,ev:(await tx`select count(*)::int n from erp_private.client_setup_section_events`)[0].n,rm:(await tx`select count(*)::int n from erp_private.client_routing_map`)[0].n,au:(await tx`select count(*)::int n from erp_private.audit_events`)[0].n});
 const kinds=r=>r.tasks.map(t=>t.kind);
 const T=r=>role=>rv(role,{action:'client_setup_tasks_read',...r});

 // nothing recorded yet: the nine sections and the chart are open; the opening trial balance waits behind the chart, so it is not a task
 const before=await counts();
 const r0=await T({})('ASSISTANT');
 assert.equal(r0.clients_with_tasks,1);assert.deepEqual(kinds(r0),['section_prepare','chart_prepare']);
 assert.equal(r0.tasks[0].count,9);assert.equal(r0.tasks[0].needs_me,true);assert.equal(r0.leader,false);
 assert.ok(!kinds(r0).includes('opening_prepare'),'opening is blocked behind the chart, so it is not asked for yet');
 assert.deepEqual(r0.configuration.map(i=>i.code).sort(),['activities','contacts','identity','ownership','permanent_file','registration','tax','year_end'],'only the sections that need the client are on the checklist; engagement is internal');
 assert.ok(r0.configuration.every(i=>i.reason&&i.go==='setup'));
 assert.deepEqual(await counts(),before,'reading the queue writes nothing');
 await assert.rejects(T({})('INTERN'),/client access/);

 // a section is submitted: it moves from "to prepare" to "to review" and is not counted twice
 await rv('MANAGER',{action:'client_setup_section_submit',client_id:C,sections:[{section_code:'identity',source_kind:'BRS'},{section_code:'year_end',source_kind:'KRA'}]});
 const r1m=await T({client_id:C})('MANAGER'),prep=r1m.tasks.find(t=>t.kind==='section_prepare'),rev=r1m.tasks.find(t=>t.kind==='section_review');
 assert.equal(prep.count,7);assert.equal(rev.count,2);
 assert.equal(rev.blocked_mine,2,'the person who submitted them cannot review them');assert.equal(rev.needs_me,false);
 assert.ok(!r1m.configuration.some(i=>i.code==='identity'),'a submitted section is no longer waiting on the client');
 const r1p=await T({})('PARTNER');assert.equal(r1p.tasks.find(t=>t.kind==='section_review').needs_me,true);assert.equal(r1p.tasks.find(t=>t.kind==='section_review').blocked_mine,0);
 assert.equal((await T({})('ASSISTANT')).tasks.find(t=>t.kind==='section_review').needs_me,false,'an Assistant does not review');

 // a draft routing mapping is a review task for a Manager or Partner other than its proposer
 const acct=(await tx`select code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy order by code limit 1`)[0].code;
 await as('MANAGER',()=>tx`insert into erp_private.client_routing_map(client_id,module,routing_code,erp_account_code,effective_from,created_by) values(${C},'Purchases','EXP01',${acct},'2026-01-01',${actors.MANAGER.staff_id})`);
 const r2m=await T({})('MANAGER'),rm=r2m.tasks.find(t=>t.kind==='routing_review');
 assert.equal(rm.count,1);assert.equal(rm.blocked_mine,1);assert.equal(rm.needs_me,false);assert.equal(rm.go,'routing');
 assert.equal((await T({})('PARTNER')).tasks.find(t=>t.kind==='routing_review').needs_me,true);

 // a client outside the request returns nothing, and an unknown id is not an error that leaks anything
 const none=await T({client_id:id()})('PARTNER');assert.deepEqual(none.tasks,[]);assert.equal(none.clients_checked,0);
 await assert.rejects(T({client_id:'not-an-id'})('PARTNER'),/./);
});
