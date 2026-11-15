import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientYearRolloverAction}=await import('../supabase/functions/staff-workspace-v12/client-year-rollover-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>clientYearRolloverAction(tx,a,p));
test("Continue Setup readiness and the year rollover",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${F2},'V3OTHER','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Fictional hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 // The client KYC, letter and opening gates have their own tests; here only the eligibility trigger is under test.
 for(const g of ['projects_guard','entity_activation','b_client_lifecycle_project_guard','zz_opening_gate'])await db.exec(`alter table erp_private.projects disable trigger ${g}`);
 const iso=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
 const M=actors.MANAGER.staff_id,PT=actors.PARTNER.staff_id,SUP=actors.SUPERVISOR.staff_id;
 const rep=on=>db.exec(`set session_replication_role=${on?'replica':'origin'}`);
 const [AC1,AC2]=(await tx`select code from erp_private.account_catalog where status='Active' order by code limit 2`).map(r=>r.code);
 await rep(true);
 await tx`update erp_private.clients set kra_pin='A123456789B',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await rep(false);
 // ---- Continue Setup: found by PIN, nothing done yet
 await assert.rejects(()=>act('INTERN',{action:'client_setup_continue_read',q:'Fictional'}),/client access/);
 await assert.rejects(()=>act('ASSISTANT',{action:'client_setup_continue_read',q:'a'}),/at least 2/);
 let found=await act('ASSISTANT',{action:'client_setup_continue_read',q:'a123456789'});
 assert.equal(found.candidates.length,1);let c0=found.candidates[0];assert.equal(c0.client_id,C);assert.equal(c0.done,0);assert.equal(c0.next_step.key,'profile');assert.equal(c0.ready,false);assert.ok(c0.project_access.projects>=1,'project access follows the assignment');
 assert.equal((await act('ASSISTANT',{action:'client_setup_continue_read',q:'%%'})).candidates.length,0);
 // ---- readiness moves on as each piece is approved
 await rep(true);
 for(const code of ['identity','registration','tax','ownership','activities','year_end','contacts'])await tx`insert into erp_private.client_setup_sections(client_id,section_code,status,content_digest,approved_digest,unchanged_approval,submitted_by,reviewed_by) values(${C},${code},'Approved','d','d',false,${actors.ASSISTANT.staff_id},${actors.MANAGER.staff_id})`;
 await rep(false);
 let sel=(await act('ASSISTANT',{action:'client_setup_continue_read',client_id:C})).selected;assert.equal(sel.done,1);assert.equal(sel.next_step.key,'year');
 await rep(true);
 const PER=id();await tx`insert into erp_private.ledger_periods(period_id,project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,status,created_by) values(${PER},${P},${C},${F},'2026-01-01','2026-12-31','Limited company','Fictional certificate','Open',${actors.MANAGER.staff_id})`;
 await rep(false);
 sel=(await act('ASSISTANT',{action:'client_setup_continue_read',client_id:C})).selected;assert.equal(sel.next_step.key,'chart');
 await rep(true);
 const CH=id();await tx`insert into erp_private.client_chart_versions(version_id,client_id,effective_from,entity_type,packs,accounts,extra_accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${CH},${C},'2026-01-01','Limited company',${tx.array(['Consultancy'])},${tx.array([AC1,AC2])},'[]','Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now(),'Fictional approval note')`;
 await rep(false);
 sel=(await act('ASSISTANT',{action:'client_setup_continue_read',client_id:C})).selected;assert.equal(sel.next_step.key,'mappings');
 await rep(true);
 const M1=id(),M2=id(),M3=id();
 await rep(false);
 await rep(true);
 await tx`insert into erp_private.client_account_mappings(mapping_id,client_id,source_account_code,source_account_name,erp_account_code,effective_from,status,created_by,approved_by,approved_at) values(${M1},${C},'S1','Fictional cash',${AC1},'2026-01-01','Active',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now()),(${M2},${C},'S2','Fictional sales',${AC2},'2026-01-01','Active',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now()),(${M3},${C},'S3','Fictional old',${AC2},'2025-01-01','Inactive',${actors.MANAGER.staff_id},null,null)`;
 await rep(false);
 await rep(true);
 await tx`update erp_private.client_account_mappings set effective_to='2025-12-31' where mapping_id=${M3}`;
 await rep(false);
 sel=(await act('ASSISTANT',{action:'client_setup_continue_read',client_id:C})).selected;assert.equal(sel.next_step.key,'opening');assert.equal(sel.done,4);
 await rep(true);
 await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional: newly formed company',opening_balance_confirmed_by=${actors.MANAGER.staff_id},opening_balance_confirmed_at=now() where client_id=${C}`;
 await rep(false);
 sel=(await act('ASSISTANT',{action:'client_setup_continue_read',client_id:C})).selected;assert.equal(sel.ready,true);assert.equal(sel.next_step,null);assert.equal(sel.done,5);
 // ---- the same PIN cannot be added twice (the database already refuses it)
 await assert.rejects(()=>tx`insert into erp_private.clients(client_id,company_name,kra_pin,owner_staff_id) values(${id()},'Fictional duplicate','A123456789B',${actors.ASSISTANT.staff_id})`,/client_pin_unique/);
 // ---- rollover preview
 await assert.rejects(()=>act('ASSISTANT',{action:'client_year_rollover_create',client_id:C,source_period_id:PER}),/Manager or Partner/);
 let r=await act('ASSISTANT',{action:'client_year_rollover_read',client_id:C});
 assert.equal(r.can_start,false);assert.deepEqual(r.preview.next,{starts_on:'2027-01-01',ends_on:'2027-12-31'});assert.deepEqual(r.preview.blockers,[]);assert.match(r.preview.warnings[0],/still open/);
 assert.ok(r.preview.changes.some(x=>/2 approved mappings copied as drafts/.test(x.text)&&/1 ended, draft or inactive mapping left out/.test(x.text)));assert.ok(r.preview.changes.some(x=>x.kind==='unchanged'));assert.ok(r.preview.changes.some(x=>x.kind==='not_done'));
 // ---- create: draft chart and draft mappings, prior year unchanged
 const made=await act('MANAGER',{action:'client_year_rollover_create',client_id:C,source_period_id:PER});assert.equal(made.mappings_copied,2);
 const nc=(await tx`select * from erp_private.client_chart_versions where version_id=${made.chart_version_id}`)[0];assert.equal(nc.status,'Draft');assert.equal(nc.effective_from.toISOString().slice(0,10),'2027-01-01');assert.deepEqual(nc.accounts,[AC1,AC2]);
 const nm=await tx`select status,effective_from,source_account_name from erp_private.client_account_mappings where client_id=${C} and effective_from='2027-01-01' order by source_account_name`;assert.equal(nm.length,2);assert.ok(nm.every(x=>x.status==='Draft'));
 assert.equal((await tx`select status from erp_private.client_chart_versions where version_id=${CH}`)[0].status,'Approved','the prior chart is untouched');
 assert.equal((await tx`select count(*)::int n from erp_private.client_account_mappings where client_id=${C} and status='Active' and effective_from='2026-01-01'`)[0].n,2);
 assert.equal((await tx`select status from erp_private.ledger_periods where period_id=${PER}`)[0].status,'Open');
 await assert.rejects(()=>act('MANAGER',{action:'client_year_rollover_create',client_id:C,source_period_id:PER}),/already draft|waiting for review/i);
 // ---- review: not by the starter, not while the source year is open
 r=await act('MANAGER',{action:'client_year_rollover_read',client_id:C});const ro=r.rollovers[0];assert.equal(ro.status,'Draft');assert.equal(ro.new_chart_status,'Draft');
 await assert.rejects(()=>act('MANAGER',{action:'client_year_rollover_review',client_id:C,rollover_id:ro.rollover_id,revision:ro.revision,review_note:'Checked the carried accounts'}),/different Manager or Partner/);
 await assert.rejects(()=>act('PARTNER',{action:'client_year_rollover_review',client_id:C,rollover_id:ro.rollover_id,revision:ro.revision,review_note:'Checked the carried accounts'}),/Close the source year/);
 await rep(true);
 await tx`update erp_private.ledger_periods set status='Closed',closed_at=now(),closed_by=${actors.MANAGER.staff_id} where period_id=${PER}`;
 await rep(false);
 await assert.rejects(()=>act('PARTNER',{action:'client_year_rollover_review',client_id:C,rollover_id:ro.rollover_id,revision:ro.revision,review_note:'short'}),/at least 10/);
 await assert.rejects(()=>act('PARTNER',{action:'client_year_rollover_review',client_id:C,rollover_id:ro.rollover_id,revision:'999',review_note:'Checked the carried accounts'}),/changed/);
 const rev=await act('PARTNER',{action:'client_year_rollover_review',client_id:C,rollover_id:ro.rollover_id,revision:ro.revision,review_note:'Checked the carried accounts and mappings'});assert.equal(rev.reviewed,true);
 r=await act('MANAGER',{action:'client_year_rollover_read',client_id:C});assert.equal(r.rollovers[0].status,'Reviewed');assert.equal(r.rollovers[0].reviewed_by_name,'Fictional PARTNER');
 await assert.rejects(()=>act('PARTNER',{action:'client_year_rollover_withdraw',client_id:C,rollover_id:ro.rollover_id,revision:r.rollovers[0].revision,reason:'Trying after review'}),/closed/);
 await db.exec('begin');await assert.rejects(()=>db.exec(`update erp_private.client_year_rollovers set new_ends_on='2027-12-30'`),/never edited/);await db.exec('rollback');
 // reviewing the chart is still a separate approval
 assert.equal((await tx`select status from erp_private.client_chart_versions where version_id=${made.chart_version_id}`)[0].status,'Draft');
});
