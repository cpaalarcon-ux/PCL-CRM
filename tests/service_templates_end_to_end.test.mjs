import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {serviceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/service-template-actions.ts');const {clientMasterAction}=await import('../supabase/functions/staff-workspace-v12/client-master-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const st=(role,p)=>as(role,a=>serviceTemplateAction(tx,a,p));const cm=(role,p)=>as(role,a=>clientMasterAction(tx,a,p));
test('templates: client type decides the file, never the service; services are chosen, approved, conditioned on the confirmed profile, released once, never duplicated',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 {const a=actors.PARTNER2={staff_id:id(),auth_user_id:id(),session:id(),category_code:'PARTNER'};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},'PARTNER2','partner2','Fictional PARTNER2','PARTNER','Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;}
 // ---- Client types ----
 await tx`update erp_private.clients set legal_structure='Limited Company',legal_subtype='Private Limited Company' where client_id=${C}`;
 const list=await st('ASSISTANT',{action:'client_template_list'});
 assert.deepEqual(list.templates.map(x=>x.template_code),['INDIVIDUAL','PARTNERSHIP','COMPANY','NONPROFIT','COOPERATIVE']);
 assert.match(list.note,/does not choose any service/);
 const c0=await st('MANAGER',{action:'client_template_read',client_id:C});
 assert.equal(c0.template.template_code,'COMPANY');assert.equal(c0.checklist.counts.facts.required,10);assert.equal(c0.checklist.ready,false);
 assert.deepEqual(c0.checklist.evidence.filter(e=>e.requirement==='Required').map(e=>e.key).sort(),['BENEFICIAL_OWNERSHIP','DIRECTORS_CR12','KRA_PIN','REGISTER_MEMBERS','REGISTRATION_IDENTITY']);
 assert.deepEqual(c0.checklist.parties.map(x=>x.label.split(' ')[0]),['Directors','Shareholders']);
 assert.ok(c0.checklist.exceptions.length>=17);
 // Someone who is not a Manager or Partner sees the lines but not the state of the KYC file.
 const c1=await st('ASSISTANT',{action:'client_template_read',client_id:C});assert.equal(c1.checklist.restricted,true);assert.equal(c1.checklist.ready,false);assert.ok(c1.checklist.evidence.every(e=>e.state==='Not visible'));
 // The client master follows the template.
 const m0=await cm('ASSISTANT',{action:'client_master_read',client_id:C});assert.equal(m0.template.template_code,'COMPANY');assert.equal(m0.required,10);assert.ok(m0.rows.some(r=>r.key==='authority_basis'));assert.ok(m0.fields.some(f=>f.key==='regulator'));
 // A legal structure with no template is shown as missing one, not guessed.
 const C2=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,legal_structure,legal_subtype) values(${C2},'Fictional county client',${actors.ASSISTANT.staff_id},'Other legal entity','Public Entity','County Government')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C2},${F})`;
 const n=await st('MANAGER',{action:'client_template_read',client_id:C2});assert.equal(n.template,null);assert.match(n.message,/no client-type template/);
 const nm=await cm('MANAGER',{action:'client_master_read',client_id:C2});assert.equal(nm.ready,false);assert.match(nm.exceptions[0].issue,/no client-type template/);
 // Individual and co-operative templates carry their own facts and overlay.
 const C3=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,legal_structure,legal_subtype) values(${C3},'Fictional sole trader',${actors.ASSISTANT.staff_id},'Sole proprietor','Individual','Sole Proprietor')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C3},${F})`;
 const i3=await cm('MANAGER',{action:'client_master_read',client_id:C3});assert.equal(i3.template.template_code,'INDIVIDUAL');assert.ok(i3.rows.some(r=>r.key==='national_id'&&!r.optional)&&i3.rows.some(r=>r.key==='business_name'&&r.optional));assert.ok(!i3.rows.some(r=>r.key==='registration_number'));
 const C4=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,legal_structure,legal_subtype) values(${C4},'Fictional SACCO',${actors.ASSISTANT.staff_id},'Co-operative society','Co-operative Society','Deposit-taking SACCO')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C4},${F})`;
 const k4=await st('PARTNER',{action:'client_template_read',client_id:C4});assert.equal(k4.template.template_code,'COOPERATIVE');assert.ok(k4.checklist.licences.some(l=>l.key==='licence:SACCO_LICENCE'&&l.state==='Missing'));
 assert.ok(k4.checklist.exceptions.some(e=>e.key==='licence:SACCO_LICENCE'));assert.ok(k4.checklist.facts.some(f=>f.key==='regulator'&&!f.optional));

 // ---- Service templates ----
 const sl=await st('MANAGER',{action:'service_template_list'});
 assert.equal(sl.templates.length,5);assert.ok(sl.templates.every(x=>x.status==='Draft'&&x.source==='Starter'));
 assert.deepEqual([...new Set(sl.templates.map(x=>x.service_group))].sort(),['Accounting and Bookkeeping','Advisory and Other','Audit and Assurance','Payroll','Tax Compliance']);
 const tax=sl.templates.find(x=>x.template_code==='TAX-MONTHLY');assert.deepEqual(tax.services.map(s=>s.service_code),['TAX-COMP']);
 const opts0=await st('MANAGER',{action:'engagement_setup_options',client_id:C});assert.equal(opts0.templates.length,0);assert.equal(opts0.client_template.template_code,'COMPANY');
 const base={action:'engagement_setup_plan',client_id:C,firm_id:F,template_id:tax.template_id,service_code:'TAX-COMP',period_start:'2026-01-01',period_end:'2026-03-31',scope:'Monthly VAT and PAYE working for the first quarter of 2026.',responsible_staff:actors.ASSISTANT.staff_id,reviewer_staff:actors.SUPERVISOR.staff_id,project_id:P};
 // Nothing is created from a template that no Partner has approved, whatever the client type.
 const p0=await st('MANAGER',base);assert.equal(p0.ok,false);assert.match(p0.plan.problems[0],/approved/);
 await assert.rejects(()=>st('MANAGER',{action:'service_template_approve',template_id:tax.template_id,revision:tax.revision}),/Partner approves/);
 await st('PARTNER',{action:'service_template_approve',template_id:tax.template_id,revision:tax.revision});
 const opts1=await st('MANAGER',{action:'engagement_setup_options',client_id:C});assert.deepEqual(opts1.templates.map(x=>x.template_code),['TAX-MONTHLY']);
 // A changed version: a Manager proposes, a different Partner approves; the old version is retired, never edited.
 const v1=(await st('MANAGER',{action:'service_template_list'})).templates.find(x=>x.template_id===tax.template_id);
 const prop=await st('MANAGER',{action:'service_template_propose',from_template_id:tax.template_id,drop_task_keys:['tot_working'],due_days:{vat_working:10},mandatory:{purchases:false}});assert.equal(prop.version,2);
 await assert.rejects(()=>st('MANAGER',{action:'service_template_propose',from_template_id:tax.template_id}),/already waiting/);
 await assert.rejects(()=>st('MANAGER',{action:'service_template_approve',template_id:prop.template_id,revision:1}),/Partner approves/);
 const sl2=(await st('PARTNER',{action:'service_template_list'})).templates;const d2=sl2.find(x=>x.template_id===prop.template_id);
 assert.equal(d2.tasks.length,v1.tasks.length-1);assert.equal(d2.tasks.find(x=>x.task_key==='vat_working').due_days,10);assert.equal(d2.tasks.find(x=>x.task_key==='purchases').mandatory,false);
 // The Partner who is not the proposer approves it.
 const ap=await st('PARTNER2',{action:'service_template_approve',template_id:prop.template_id,revision:d2.revision});assert.equal(ap.replaced,true);
 const after=(await st('PARTNER',{action:'service_template_list'})).templates.filter(x=>x.template_code==='TAX-MONTHLY');
 assert.deepEqual(after.map(x=>[x.version,x.status]),[[2,'Approved'],[1,'Retired']]);
 await assert.rejects(()=>tx`update erp_private.service_templates set name='Changed' where template_id=${prop.template_id}`,/never edited/);
 await assert.rejects(()=>tx`insert into erp_private.service_template_tasks(template_id,task_key,task_name,stage) values(${prop.template_id},'extra','Extra task here','Execution')`,/draft/);
 const T2=prop.template_id;
 // The Partner who proposes a version cannot approve it.
 const p3=await st('PARTNER',{action:'service_template_propose',from_template_id:T2,name:'Tax compliance, monthly (draft change)'});
 const d3=(await st('PARTNER',{action:'service_template_list'})).templates.find(x=>x.template_id===p3.template_id);
 await assert.rejects(()=>st('PARTNER',{action:'service_template_approve',template_id:p3.template_id,revision:d3.revision}),/different Partner approves/);
 await st('PARTNER2',{action:'service_template_retire',template_id:p3.template_id,revision:d3.revision,reason:'Not needed after review'});

 // ---- Engagement set-up ----
 const plan=async(role,over={})=>st(role,{...base,template_id:T2,...over});
 const a0=await plan('MANAGER');assert.equal(a0.ok,true,JSON.stringify(a0.plan.problems));
 // No verified tax profile: VAT and PAYE tasks are not made, with the reason; sales and purchases are made monthly.
 assert.equal(a0.plan.create.length,6);assert.deepEqual([...new Set(a0.plan.create.map(c=>c.task_key))].sort(),['purchases','sales']);
 assert.ok(a0.plan.skipped.some(s=>s.task_key==='vat_working'&&/does not show VAT/.test(s.reason)));assert.ok(a0.plan.skipped.some(s=>s.task_key==='income_tax'));
 assert.equal(a0.plan.skipped.some(s=>s.task_key==='tot_working'),false);
 assert.equal(a0.plan.client.template_code,'COMPANY');assert.ok(a0.plan.warnings.some(w=>/not fully confirmed/.test(w)));
 // Checks on who and what.
 assert.match((await plan('MANAGER',{reviewer_staff:actors.ASSISTANT.staff_id})).plan.problems.join(' '),/different person/);
 assert.match((await plan('MANAGER',{responsible_staff:actors.SUPERVISOR.staff_id,reviewer_staff:actors.ASSISTANT.staff_id})).plan.problems.join(' '),/Supervisor, Manager or Partner/);
 assert.match((await plan('MANAGER',{service_code:'ACC-BOOK',project_id:null})).plan.problems.join(' '),/not for the service/);
 await assert.rejects(()=>plan('MANAGER',{period_end:'2025-01-01'}),/cannot end before/);
 await assert.rejects(()=>plan('MANAGER',{scope:'short'}),/at least 10/);
 await assert.rejects(()=>plan('ASSISTANT'),/Supervisor, Manager or Partner/);
 // A mandatory task needs a Manager or Partner and a reason to drop; an optional one can go.
 assert.match((await plan('SUPERVISOR',{exclusions:[{task_key:'sales',reason:'not needed'}]})).plan.problems.join(' '),/Only a Manager or Partner/);
 assert.match((await plan('MANAGER',{exclusions:[{task_key:'sales',reason:''}]})).plan.problems.join(' '),/Say why/);
 const dropped=await plan('MANAGER',{exclusions:[{task_key:'sales',reason:'Client sends no sales this quarter'},{task_key:'purchases',reason:''}]});
 assert.equal(dropped.ok,true);assert.equal(dropped.plan.create.length,0);assert.equal(dropped.plan.skipped.filter(s=>s.kind==='Dropped').length,2);
 // A verified tax profile with VAT turns on the VAT tasks only.
 await tx`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,status,created_by,verified_by,verified_at) values(${C},'Company','Resident','Standard',${tx.array(['VAT'])},'2026-01-01','2026-12-31','Fictional profile',${'Verified'},${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now())`;
 const a1=await plan('MANAGER');assert.equal(a1.plan.create.length,12);assert.deepEqual([...new Set(a1.plan.create.map(c=>c.task_key))].sort(),['purchases','sales','vat_review','vat_working']);
 assert.ok(a1.plan.skipped.some(s=>s.task_key==='paye_working'));assert.equal(a1.plan.create.find(c=>c.task_key==='vat_review').owner_role,'REVIEWER');
 const vat=a1.plan.create.filter(c=>c.task_key==='vat_working');assert.deepEqual(vat.map(c=>c.due_on),['2026-02-10','2026-03-10','2026-04-10']);
 // Applying: needs confirmation. The project is a draft, so the set-up waits and creates nothing yet.
 await assert.rejects(()=>st('MANAGER',{...base,template_id:T2,action:'engagement_setup_apply'}),/Confirm the plan/);
 const ap1=await st('MANAGER',{...base,template_id:T2,action:'engagement_setup_apply',confirm:true});
 assert.equal(ap1.released,false);assert.match(ap1.waiting_reason,/Draft/);assert.equal(ap1.tasks_created,0);
 assert.equal((await tx`select count(*)::int n from erp_private.tasks where project_id=${P} and template_key like 'tpl:%'`)[0].n,0);
 const lst=await st('MANAGER',{action:'engagement_setup_list',client_id:C});assert.equal(lst.setups.length,1);assert.equal(lst.setups[0].status,'Waiting');
 // The same client, service and period cannot be set up twice.
 assert.match((await plan('MANAGER')).plan.problems.join(' '),/already set up/);
 await assert.rejects(()=>st('MANAGER',{...base,template_id:T2,action:'engagement_setup_apply',confirm:true}),/already set up/);
 // A period that overlaps an existing set-up of the same service is refused, so no task is made twice.
 assert.match((await plan('MANAGER',{period_start:'2026-03-01',period_end:'2026-04-30'})).plan.problems.join(' '),/part of that period \(2026-01-01 to 2026-03-31\)/);
 // Activate the project and the ledger gate: the waiting set-up is released once, with the conditions checked again.
 await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional client starts fresh',opening_balance_confirmed_by=${actors.PARTNER.staff_id},opening_balance_confirmed_at=now() where client_id=${C}`;await tx`update erp_private.clients set entity_evidence='Certificate of incorporation CR-12345',year_end_month=12,year_end_day=31 where client_id=${C}`;await db.exec('set session_replication_role=replica');await tx`update erp_private.projects set status='Active' where project_id=${P}`;await db.exec('set session_replication_role=origin');
 const rel=await st('MANAGER',{action:'engagement_setup_release',setup_id:ap1.setup_id});
 assert.equal(rel.released,true);assert.equal(rel.tasks_created,12);
 const made=await tx`select task_name,assigned_to,due_at,recurring_key,period_start,requires_document from erp_private.tasks where project_id=${P} and template_key like 'tpl:%' order by recurring_key`;
 assert.equal(made.length,12);assert.equal(new Set(made.map(m=>m.recurring_key)).size,12);
 assert.ok(made.filter(m=>/Review VAT/.test(m.task_name)).every(m=>m.assigned_to===actors.SUPERVISOR.staff_id));assert.ok(made.filter(m=>/Collect and upload sales/.test(m.task_name)).every(m=>m.assigned_to===actors.ASSISTANT.staff_id&&m.requires_document));
 const rel2=await st('MANAGER',{action:'engagement_setup_release',setup_id:ap1.setup_id});assert.equal(rel2.already,true);assert.equal((await tx`select count(*)::int n from erp_private.tasks where project_id=${P} and template_key like 'tpl:%'`)[0].n,12);
 const done=await st('MANAGER',{action:'engagement_setup_list',client_id:C});assert.equal(done.setups[0].status,'Released');assert.equal(done.setups[0].tasks_created,12);assert.ok(done.setups[0].skipped.some(s=>s.task_key==='paye_working'));
 await assert.rejects(()=>tx`update erp_private.engagement_setups set scope='A different scope entirely' where setup_id=${ap1.setup_id}`,/not edited/);
 // The next quarter is a separate set-up; the earlier tasks are not touched and nothing from last quarter's completion is copied.
 const q2={period_start:'2026-04-01',period_end:'2026-06-30'};
 const a2=await plan('MANAGER',q2);assert.equal(a2.ok,true);assert.equal(a2.plan.create.length,12);
 const ap2=await st('MANAGER',{...base,...q2,template_id:T2,action:'engagement_setup_apply',confirm:true});assert.equal(ap2.released,true);assert.equal(ap2.tasks_created,12);
 assert.equal((await tx`select count(*)::int n from erp_private.tasks where project_id=${P} and template_key like 'tpl:%'`)[0].n,24);
 assert.equal((await tx`select count(*)::int n from erp_private.tasks where project_id=${P} and template_key like 'tpl:%' and status<>'Pending'`)[0].n,0);
 // A project that already makes its tasks from a recurring schedule is not given the same work twice.
 await tx`insert into erp_private.project_schedules(project_id,frequency,pack,starts_on,ends_on,effective_from,enabled,obligations,assigned_to,reviewer_id) values(${P},'Monthly','Tax Compilation','2026-01-01','2026-12-31','2026-01-01',true,${tx.array(['VAT'])},${actors.ASSISTANT.staff_id},${actors.SUPERVISOR.staff_id})`;
 assert.match((await plan('MANAGER',{period_start:'2026-07-01',period_end:'2026-09-30'})).plan.problems.join(' '),/recurring schedule/);
 // The client type alone creates nothing: no engagement set-up and no template task exists for the other clients.
 assert.equal((await tx`select count(*)::int n from erp_private.engagement_setups where client_id in(${C2},${C3},${C4})`)[0].n,0);
 assert.equal((await tx`select count(*)::int n from erp_private.projects where client_id in(${C2},${C3},${C4})`)[0].n,0);
 // A new project for a chosen service goes through the same gates as any new project, is created as a draft, and the set-up waits.
 const acc=sl.templates.find(x=>x.template_code==='ACC-MONTHLY');await st('PARTNER',{action:'service_template_approve',template_id:acc.template_id,revision:acc.revision});
 const nb={...base,template_id:acc.template_id,service_code:'ACC-BOOK',project_id:null,period_start:'2026-01-01',period_end:'2026-01-31'};
 const np=await st('MANAGER',{...nb,action:'engagement_setup_plan'});assert.equal(np.ok,true,JSON.stringify(np.plan.problems));assert.equal(np.plan.project,null);assert.deepEqual([...new Set(np.plan.create.map(c=>c.task_key))].sort(),['bank_rec','bank_statements','ledger_review','month_pack']);
 await assert.rejects(()=>st('MANAGER',{...nb,action:'engagement_setup_apply',confirm:true}),/chart of accounts for this Limited company client is not approved/);
 assert.equal((await tx`select count(*)::int n from erp_private.projects where client_id=${C} and service_code='ACC-BOOK'`)[0].n,0);assert.equal((await tx`select count(*)::int n from erp_private.engagement_setups where client_id=${C} and service_code='ACC-BOOK'`)[0].n,0);
 // Retiring needs a Partner and a reason.
 const other=sl.templates.find(x=>x.template_code==='ADVISORY-PROJECT');
 await assert.rejects(()=>st('PARTNER',{action:'service_template_retire',template_id:other.template_id,revision:other.revision,reason:'no'}),/at least 5/);
 await st('PARTNER',{action:'service_template_retire',template_id:other.template_id,revision:other.revision,reason:'Not used by the firm'});
 await assert.rejects(()=>st('INTERN',{action:'service_template_list'}),/client access/);
});
