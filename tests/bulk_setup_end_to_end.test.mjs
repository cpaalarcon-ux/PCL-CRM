import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {bulkSetupAction}=await import('../supabase/functions/staff-workspace-v12/bulk-setup-actions.ts');
const {exportProfileAction}=await import('../supabase/functions/staff-workspace-v12/export-profile-actions.ts');
const {serviceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/service-template-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
let sp=0;tx.savepoint=async fn=>{const n='sp'+(++sp);await db.exec('savepoint '+n);try{const r=await fn(tx);await db.exec('release savepoint '+n);return r;}catch(e){await db.exec('rollback to savepoint '+n);await db.exec('release savepoint '+n);throw e;}};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const bs=(role,p)=>as(role,a=>bulkSetupAction(tx,a,p)),ep=(role,p)=>as(role,a=>exportProfileAction(tx,a,p)),st=(role,p)=>as(role,a=>serviceTemplateAction(tx,a,p));
const count=async(sql)=>(await db.query(sql)).rows[0].n;

test('bulk set-up: preview writes nothing, valid rows are applied through the single-client rules, the rest are listed with a reason, and every client has an audit record',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'BLKQA','Fictional bulk firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 // Four fictional clients. A and B are ready for a new project (classified, evidence, year end, approved chart). C has no chart. D is not linked to any firm.
 const [A,B,C,D]=[id(),id(),id(),id()],P=id();
 for(const [c,name] of [[A,'UAT FICTIONAL BULK ALPHA LIMITED'],[B,'UAT FICTIONAL BULK BETA LIMITED'],[C,'UAT FICTIONAL BULK GAMMA LIMITED'],[D,'UAT FICTIONAL BULK DELTA LIMITED']]){
  await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,legal_structure,legal_subtype,entity_evidence,year_end_month,year_end_day) values(${c},${name},${actors.MANAGER.staff_id},'Limited company','Limited Company','Private Limited Company','Certificate of incorporation CR-12345',12,31)`;
  await tx`update erp_private.clients set is_uat_fixture=true where client_id=${c}`;
  if(c!==D)await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;
 }
 for(const c of [A,B])await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${c},'2026-01-01','Limited company',${'{Wholesale}'},${'{10000,30000}'},'Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now(),'Fictional approval of the chart')`;
 // The manager sees every fictional client through one assigned project each (a Draft project does not matter here).
 for(const c of [A,B,C]){const p=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${c},${F},'Fictional books','TAX-COMP',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${actors.MANAGER.staff_id},${F},'MANAGER')`;await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${actors.PARTNER.staff_id},${F},'PARTNER')`;}

 // ---- who may use it, and what stops the whole run ----
 for(const role of ['ASSISTANT','SUPERVISOR','INTERN'])await assert.rejects(bs(role,{action:'bulk_setup_options'}),/Manager or Partner/);
 await assert.rejects(bs('MANAGER',{action:'bulk_setup_preview',operation:'NOPE',rows:[{client_id:A}]}),/Choose what to set up/);
 await assert.rejects(bs('MANAGER',{action:'bulk_setup_preview',operation:'PAYROLL_RETURNS',return_codes:['NSSF'],effective_from:'2026-01-01',rows:[]}),/at least one client/);
 await assert.rejects(bs('MANAGER',{action:'bulk_setup_preview',operation:'PAYROLL_RETURNS',return_codes:['NSSF'],effective_from:'2026-01-01',rows:Array.from({length:201},()=>({client_id:A}))}),/up to 200/);
 await assert.rejects(bs('MANAGER',{action:'bulk_setup_preview',operation:'PAYROLL_RETURNS',return_codes:['XX'],effective_from:'2026-01-01',rows:[{client_id:A}]}),/at least one return/);
 await assert.rejects(bs('MANAGER',{action:'bulk_setup_preview',operation:'PAYROLL_RETURNS',return_codes:['NSSF'],effective_from:'2026-13-45',rows:[{client_id:A}]}),/first day/);
 const opts=await bs('MANAGER',{action:'bulk_setup_options'});assert.equal(opts.max_rows,200);assert.ok(opts.clients.length===0||opts.clients.every(c=>c.company_name));assert.deepEqual(opts.returns.map(r=>r.return_code),['NSSF','SHIF','PAYE_P10']);

 // ---- payroll returns ----
 const rows=[{client_id:A},{client_id:B},{client_id:A},{client_id:'not-an-id'},{client_id:id()}];
 const req={operation:'PAYROLL_RETURNS',return_codes:['NSSF','SHIF'],effective_from:'2026-01-01',note:'Fictional bulk choice',rows};
 const pv0=await bs('MANAGER',{action:'bulk_setup_preview',...req});
 assert.equal(pv0.summary.ready,0,'no export profile is published yet, so every row says so');assert.equal(pv0.results.filter(r=>/No published export profile covers/.test(r.reason)).length,4,'A and B, NSSF and SHIF');
 const list0=await ep('MANAGER',{action:'export_profile_list'});
 for(const code of ['NSSF','SHIF']){const pr=list0.profiles.find(x=>x.return_code===code);await ep('PARTNER',{action:'export_profile_publish',profile_id:pr.profile_id,revision:pr.revision,verified_against:'Fictional agency specification for the test',verified_on:'2026-11-15'});}
 const pv=await bs('MANAGER',{action:'bulk_setup_preview',...req});
 assert.equal(pv.preview,true);assert.equal(pv.summary.total,10,'five clients times two returns');
 assert.equal(pv.summary.ready,4,'A and B for NSSF and SHIF');
 const why=pv.summary.exceptions.map(e=>e.reason).join(' | ');assert.match(why,/more than once/);assert.match(why,/no valid client reference/);assert.match(why,/unavailable to your account/);
 assert.equal(await count('select count(*)::int n from erp_private.client_payroll_returns'),0,'a preview writes nothing');
 assert.equal(await count('select count(*)::int n from erp_private.bulk_setup_runs'),0,'a preview leaves no run');
 await assert.rejects(bs('MANAGER',{action:'bulk_setup_apply',...req}),/confirm/);
 const ap=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...req});
 assert.equal(ap.applied,true);assert.equal(ap.summary.applied,4);assert.equal(ap.summary.skipped,6);
 assert.equal(await count('select count(*)::int n from erp_private.client_payroll_returns'),4);
 // One audit record per client and item, with the reason for every skipped row.
 const run=await bs('PARTNER',{action:'bulk_setup_run_read',run_id:ap.run_id});
 assert.equal(run.rows.length,10);assert.equal(run.run.applied_count,4);assert.equal(run.run.skipped_count,6);assert.equal(run.run.created_by_name,'Fictional MANAGER');
 assert.ok(run.rows.filter(r=>r.outcome==='Skipped').every(r=>r.reason&&r.reason.length>5));assert.ok(run.rows.filter(r=>r.outcome==='Applied').every(r=>r.record_ref&&r.client_id));
 assert.ok(run.rows.some(r=>r.client_id===null&&/unavailable/.test(r.reason)),'an unavailable client is kept as a skipped line with no client link');
 assert.equal(await count(`select count(*)::int n from erp_private.audit_events where table_name='bulk_setup_rows'`),10,'the audit trail has one entry per row');
 assert.equal(await count(`select count(*)::int n from erp_private.audit_events where table_name='bulk_setup_runs'`),1);
 // The same run again: every client already has the returns, so every row is skipped and says so.
 const again=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...req});assert.equal(again.summary.applied,0);assert.equal(again.results.filter(r=>/already chosen/.test(r.reason)).length,4,'A and B, NSSF and SHIF');
 assert.equal(await count('select count(*)::int n from erp_private.client_payroll_returns'),4,'nothing is chosen twice');
 // The audit record cannot be changed or removed, by anyone.
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.bulk_setup_rows set outcome='Applied' where run_id=${ap.run_id}`),/./);
 await assert.rejects(as('PARTNER',()=>tx`delete from erp_private.bulk_setup_runs where run_id=${ap.run_id}`),/./);
 const runs=await bs('PARTNER',{action:'bulk_setup_runs_read'});assert.equal(runs.runs.length,2);assert.match(runs.runs[0].operation_label,/payroll returns/);

 // ---- services from an approved template ----
 const sl=await st('MANAGER',{action:'service_template_list'});const tax=sl.templates.find(x=>x.template_code==='TAX-MONTHLY');
 const eng={operation:'ENGAGEMENT',template_id:tax.template_id,service_code:'TAX-COMP',period_start:'2026-01-01',period_end:'2026-03-31',scope:'Monthly VAT and PAYE working for the first quarter of 2026.',responsible_staff:actors.ASSISTANT.staff_id,reviewer_staff:actors.SUPERVISOR.staff_id,rows:[{client_id:A},{client_id:B},{client_id:C},{client_id:D}]};
 const e0=await bs('MANAGER',{action:'bulk_setup_preview',...eng});assert.equal(e0.summary.ready,0);assert.match(e0.results[0].reason,/approved/,'a template no Partner approved is refused for every client');
 await st('PARTNER',{action:'service_template_approve',template_id:tax.template_id,revision:tax.revision});
 const e1=await bs('MANAGER',{action:'bulk_setup_preview',...eng});
 assert.deepEqual(e1.results.map(r=>r.outcome),['Ready','Ready','Skipped','Skipped']);
 assert.match(e1.results[0].note,/tasks? would be created/);assert.match(e1.results[2].reason,/chart of accounts/);assert.match(e1.results[3].reason,/not linked|unavailable/);
 assert.equal(await count('select count(*)::int n from erp_private.engagement_setups'),0,'an engagement preview writes nothing');
 assert.equal(await count(`select count(*)::int n from erp_private.projects where project_name<>'Fictional books'`),0,'and creates no project');
 const e2=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...eng});
 assert.equal(e2.summary.applied,2);assert.equal(e2.summary.skipped,2);
 assert.equal(await count('select count(*)::int n from erp_private.engagement_setups'),2);
 assert.ok(e2.results.filter(r=>r.outcome==='Applied').every(r=>r.record_ref));
 // The people chosen are held to the same rules: a reviewer who is also the responsible person is refused for that row only.
 const e3=await bs('MANAGER',{action:'bulk_setup_preview',...eng,period_start:'2026-04-01',period_end:'2026-06-30',rows:[{client_id:A,reviewer_staff:actors.ASSISTANT.staff_id},{client_id:B}]});
 assert.deepEqual(e3.results.map(r=>r.outcome),['Skipped','Ready']);assert.match(e3.results[0].reason,/different person/);
 // The same service and period again: refused for both, nothing is made twice.
 const e4=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...eng});assert.equal(e4.summary.applied,0);assert.match(e4.results[0].reason,/already set up/);
 assert.equal(await count('select count(*)::int n from erp_private.engagement_setups'),2);
 // A bulk run approves nothing: the set-ups wait for the project to be ready, as they do one at a time.
 assert.equal(await count(`select count(*)::int n from erp_private.engagement_setups where status='Released'`),0);
 assert.equal(await count(`select count(*)::int n from erp_private.audit_events where table_name='bulk_setup_rows'`),28,'every row of every run (10 + 10 + 4 + 4) is in the audit trail');
});
