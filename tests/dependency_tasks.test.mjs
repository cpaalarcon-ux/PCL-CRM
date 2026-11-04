import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p));
const asOf='2026-11-04';

test('the dependency map creates each applicable task once, skips unconfirmed obligations and never deletes started work',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'DEPQA','Fictional dependency firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional wholesale and retail client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional tax compilation','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 const version=(await tx`select version_id from erp_private.dependency_map_versions where version_label='ERP-DEPENDENCIES-UAT-1'`)[0].version_id;
 const profile=(await tx`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,status,created_by,verified_by,verified_at) values(${C},'Company','Resident','Standard',${tx.array(['VAT','PAYE'])}::text[],'2026-01-01','2026-12-31','Fictional profile','Verified',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now()) returning profile_id`)[0].profile_id;
 const obligation=async(code,applicable)=>(await tx`insert into erp_private.client_tax_obligations(client_id,profile_id,obligation_code,effective_from,effective_to,registered,applicable,client_status,evidence_reference,handling_firm_ids) values(${C},${profile},${code},'2026-01-01','2026-12-31','YES',${applicable},'ACTIVE','Fictional iTax obligation evidence',${tx.array([F])}::uuid[]) returning obligation_id`)[0].obligation_id;
 const vat=await obligation('VAT','YES'),paye=await obligation('PAYE','TO_CONFIRM');
 const source=async(type,sourceId,code,to=null)=>{for(const r of await tx`select dependency_code from erp_private.dependency_map_rules where version_id=${version} and source_type=${type} and source_code=${code}`)await tx`insert into erp_private.client_dependency_sources(client_id,source_type,source_id,source_code,dependency_code,version_id,effective_from,effective_to) values(${C},${type},${sourceId},${code},${r.dependency_code},${version},'2026-01-01',${to})`;};
 await source('ACTIVITY',id(),'wholesale');await source('ACTIVITY',id(),'retail');await source('OBLIGATION',vat,'VAT');await source('OBLIGATION',paye,'PAYE');

 await assert.rejects(()=>call('ASSISTANT',{action:'v3_activities_dependency_tasks_apply',project_id:P,as_of:asOf}),/Partner or Manager/);
 const plan=await call('MANAGER',{action:'v3_activities_dependency_tasks_preview',project_id:P,as_of:asOf});
 const create=Object.fromEntries(plan.create.map(x=>[x.dependency_code,x]));
 assert.deepEqual(create.STOCK_METHOD.from,['Activity retail','Activity wholesale'],'a dependency shared by two activities is one task');
 assert.ok(create.Z_ETR_CASH_SALES&&create.SALES_IMPORT&&create.ETIMS_MATCHING,'retail-only and confirmed VAT dependencies are planned');
 assert.ok(plan.covered.some(x=>x.dependency_code==='VAT_RETURN'),'the recurring VAT return stays with the reporting schedule');
 assert.ok(!create.VAT_RETURN);
 const p10=plan.waiting.find(x=>x.dependency_code==='P10_IMPORT');assert.match(p10.reasons[0],/PAYE: legal applicability is TO_CONFIRM/,'a To-confirm obligation creates no task');
 assert.ok(!create.PAYROLL_PAYABLES,'payroll checks wait for a confirmed PAYE position');

 const draft=await call('MANAGER',{action:'v3_activities_dependency_tasks_apply',project_id:P,as_of:asOf});
 assert.equal(draft.created,0);assert.match(draft.skipped,/active engagement/,'a draft engagement gets no tasks yet');
 await tx`update erp_private.projects set status='Active' where project_id=${P}`;
 const applied=await call('MANAGER',{action:'v3_activities_dependency_tasks_apply',project_id:P,as_of:asOf});
 assert.equal(applied.created,plan.create.length);
 const keys=(await tx`select recurring_key from erp_private.tasks where project_id=${P} and recurring_key like 'dep:%' order by 1`).map(x=>x.recurring_key);
 assert.equal(keys.filter(k=>k==='dep:STOCK_METHOD').length,1);
 assert.equal((await call('MANAGER',{action:'v3_activities_dependency_tasks_apply',project_id:P,as_of:asOf})).created,0,'a rebuild never duplicates tasks');

 await tx`update erp_private.tasks set status='In Progress' where project_id=${P} and recurring_key='dep:ETIMS_MATCHING'`;
 await tx`update erp_private.client_dependency_sources set effective_to='2026-11-03' where source_type='OBLIGATION' and source_code='VAT'`;
 const after=await call('PARTNER',{action:'v3_activities_dependency_tasks_apply',project_id:P,as_of:asOf});
 const status=async key=>(await tx`select status,blocked_reason from erp_private.tasks where project_id=${P} and recurring_key=${key}`)[0];
 assert.equal((await status('dep:SALES_IMPORT')).status,'Blocked');assert.match((await status('dep:SALES_IMPORT')).blocked_reason,/No longer applies from 2026-11-04/);
 assert.equal((await status('dep:ETIMS_MATCHING')).status,'In Progress','started work is never changed or deleted');
 assert.ok(after.stale.some(x=>x.dependency_code==='ETIMS_MATCHING'),'started work that no longer applies is listed for review');
 assert.equal((await status('dep:STOCK_METHOD')).status,'Pending','dependencies that still apply are untouched');
 assert.ok(Number((await tx`select count(*)::int n from erp_private.audit_events where action='DEPENDENCY_TASKS'`)[0].n)>=3);
});
