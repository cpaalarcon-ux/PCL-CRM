import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {amlReportAction}=await import('../supabase/functions/staff-workspace-v12/aml-report-actions.ts');const {amlAction}=await import('../supabase/functions/staff-workspace-v12/aml-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const rx=(role,p)=>as(role,a=>amlReportAction(tx,a,p));
test('build 2865: restricted concerns, every look logged, annual compliance report, AML scope summary',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 const q=(sql,...v)=>db.query(sql,v).then(r=>r.rows);
 await as('PARTNER',()=>tx`select erp_private.staff_right_grant(${actors.MANAGER.staff_id}::uuid,'MLRO','Appointed as the firm MLRO',current_date+30)`);
 const SUMMARY='The client asked us to split cash deposits just under a limit, which looked unusual to me.';
 // Anyone can raise a concern and is told only its reference.
 const c1=await rx('ASSISTANT',{action:'concern_raise',client_id:C,summary:SUMMARY});assert.match(c1.ref,/^SAR-\d{4}-\d{5}$/);assert.deepEqual(Object.keys(c1).sort(),['note','ok','ref']);assert.match(c1.note,/Do not discuss/);
 const c2=await rx('INTERN',{action:'concern_raise',summary:'A visitor asked staff to hold a large sum of cash for a client.'});assert.notEqual(c1.ref,c2.ref);
 await assert.rejects(()=>rx('ASSISTANT',{action:'concern_raise',client_id:C,summary:'too short'}),/at least 20/);
 await assert.rejects(()=>rx('INTERN',{action:'concern_raise',client_id:C,summary:SUMMARY}),/unavailable/,'a client you cannot see is refused');
 // Nobody reads the tables directly, not even the MLRO or a Partner, so no read can skip the log.
 for(const role of ['ASSISTANT','MANAGER','PARTNER'])await assert.rejects(()=>as(role,()=>tx`select * from erp_private.aml_reports`),/permission denied/,role);
 for(const role of ['MANAGER','PARTNER'])await assert.rejects(()=>as(role,()=>tx`select * from erp_private.aml_report_access_log`),/permission denied/,role);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.aml_reports(summary,raised_by) values('A summary long enough to pass the check',${actors.ASSISTANT.staff_id})`),/permission denied/);
 // Not the MLRO: the attempt is refused and recorded (a normal reply, so the record is kept).
 for(const act of [{action:'sar_list'},{action:'sar_log'}])for(const role of ['ASSISTANT','SUPERVISOR','INTERN']){const r=await rx(role,act);assert.equal(r.denied,true,role+' '+act.action);}
 const rep0=(await q(`select report_id from erp_private.aml_reports order by raised_at limit 1`))[0].report_id;
 assert.equal((await rx('ASSISTANT',{action:'sar_read',report_id:rep0})).denied,true);
 assert.equal((await rx('ASSISTANT',{action:'sar_event',report_id:rep0,event_type:'Note',note:'I want to add a note'})).denied,true);
 assert.equal((await q(`select count(*)::int n from erp_private.aml_report_access_log where action='Denied'`))[0].n,8);
 // The MLRO (the Manager holding the right) reads, decides and everything is logged.
 const list=await rx('MANAGER',{action:'sar_list'});assert.equal(list.reports.length,2);assert.ok(list.reports.every(r=>r.status==='Received'));
 const first=list.reports.find(r=>r.report_ref===c1.ref);assert.equal(first.company_name,'Fictional V3 client');assert.equal(first.raised_by_name,'Fictional ASSISTANT');
 const one=await rx('MANAGER',{action:'sar_read',report_id:first.report_id});assert.equal(one.report.summary,SUMMARY);assert.equal(one.events.length,1);
 await assert.rejects(()=>rx('MANAGER',{action:'sar_event',report_id:first.report_id,event_type:'Reported to FRC',note:'Filed'}),/reference/);
 await assert.rejects(()=>rx('MANAGER',{action:'sar_event',report_id:first.report_id,event_type:'Closed without report',note:'no'}),/at least 10/);
 await assert.rejects(()=>rx('MANAGER',{action:'sar_event',report_id:first.report_id,event_type:'Reported to FRC',frc_reference:'FRC-1',reported_on:'2099-01-01'}),/future/);
 await rx('MANAGER',{action:'sar_event',report_id:first.report_id,event_type:'Under review',note:'Looking at the deposit pattern'});
 await rx('PARTNER',{action:'sar_event',report_id:first.report_id,event_type:'Reported to FRC',frc_reference:'FRC-TEST-0001',reported_on:new Date().toISOString().slice(0,10),note:'Filed through the portal'});
 await assert.rejects(()=>rx('MANAGER',{action:'sar_event',report_id:first.report_id,event_type:'Note',note:'One more thing'}),/concluded/);
 const two=await rx('MANAGER',{action:'sar_read',report_id:first.report_id});assert.deepEqual(two.events.map(e=>e.event_type),['Received','Under review','Reported to FRC']);assert.equal(two.events[2].frc_reference,'FRC-TEST-0001');
 assert.equal((await rx('MANAGER',{action:'sar_list'})).reports.find(r=>r.report_ref===c1.ref).status,'Reported to FRC');
 // Records are never edited or removed, even by the database owner.
 await assert.rejects(()=>q(`update erp_private.aml_reports set summary='Changed quietly to something else entirely'`),/not changed or removed/);
 await assert.rejects(()=>q(`delete from erp_private.aml_report_events`),/not changed or removed/);
 await assert.rejects(()=>q(`update erp_private.aml_report_access_log set action='Listed'`),/not changed or removed/);
 // The log shows who looked. Opening the log is itself logged, and only the MLRO may.
 const lg=await rx('MANAGER',{action:'sar_log'});const acts=lg.log.map(x=>x.action);
 for(const a of ['Raised','Listed','Read','Event','Denied'])assert.ok(acts.includes(a),a);
 assert.ok(lg.log.some(x=>x.action==='Denied'&&x.actor_name==='Fictional ASSISTANT'));assert.ok(lg.log.some(x=>x.action==='Read'&&x.report_ref===c1.ref&&x.actor_name==='Fictional MANAGER'));
 assert.ok((await rx('PARTNER',{action:'sar_log'})).log.some(x=>x.action==='Log viewed'));
 // The text of a concern is never copied into the general change audit.
 assert.equal((await q(`select count(*)::int n from erp_private.audit_events where table_name like 'aml_report%' or after_values::text like '%split cash deposits%'`))[0].n,0);
 // Menu: only the MLRO sees the link.
 assert.equal((await rx('MANAGER',{action:'sar_menu'})).mlro,true);assert.equal((await rx('ASSISTANT',{action:'sar_menu'})).mlro,false);
 // ---- Annual compliance report ----
 await q(`update erp_private.staff_capabilities set expires_on=date '2099-01-01' where capability='MLRO'`);
 assert.equal((await q(`select erp_private.aml_annual_ensure('2026-12-31') n`))[0].n,0,'nothing is created before 2027');
 assert.equal((await q(`select erp_private.aml_annual_ensure('2027-01-01') n`))[0].n,1);assert.equal((await q(`select erp_private.aml_annual_ensure('2027-01-01') n`))[0].n,0,'running it again makes no second row');
 const ar=(await q(`select covers_year,due_on::text,assigned_to,status from erp_private.aml_annual_reports`))[0];assert.equal(ar.covers_year,2026);assert.equal(ar.due_on,'2027-01-31');assert.equal(ar.assigned_to,actors.MANAGER.staff_id,'assigned to the MLRO');assert.equal(ar.status,'Open');
 await assert.rejects(()=>rx('ASSISTANT',{action:'sar_annual_read'}),/kept by the MLRO/);
 const av=await rx('MANAGER',{action:'sar_annual_read'});assert.equal(av.reports.length,1);assert.match(av.rule,/1 January/);assert.equal(av.reports[0].assigned_name,'Fictional MANAGER');
 const aid=av.reports[0].annual_id;
 await assert.rejects(()=>rx('SUPERVISOR',{action:'sar_annual_move',annual_id:aid,status:'Prepared'}),/kept by the MLRO/);
 await assert.rejects(()=>rx('MANAGER',{action:'sar_annual_move',annual_id:aid,status:'Submitted',submitted_on:new Date().toISOString().slice(0,10)}),/reference/);
 await rx('MANAGER',{action:'sar_annual_move',annual_id:aid,status:'Prepared',note:'Draft ready'});
 const today=new Date().toISOString().slice(0,10);
 const sub=await rx('MANAGER',{action:'sar_annual_move',annual_id:aid,status:'Submitted',submitted_on:today,receipt_reference:'FRC-ANNUAL-1'});assert.equal(sub.reports[0].status,'Submitted');assert.equal(sub.reports[0].overdue,false);
 await assert.rejects(()=>rx('MANAGER',{action:'sar_annual_move',annual_id:aid,status:'Prepared'}),/history/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.aml_annual_reports`),/permission denied|archived|deleted/i);
 // Adding a past year: the MLRO only, a year that has ended, once.
 await assert.rejects(()=>rx('ASSISTANT',{action:'sar_annual_add',firm_id:F,covers_year:2024}),/kept by the MLRO/);
 const added=await rx('MANAGER',{action:'sar_annual_add',firm_id:F,covers_year:2024});assert.equal(added.reports.find(r=>r.covers_year===2024).due_on,'2025-01-31');assert.equal(added.reports.find(r=>r.covers_year===2024).overdue,true);
 await assert.rejects(()=>rx('MANAGER',{action:'sar_annual_add',firm_id:F,covers_year:2024}),/already exists/);
 await assert.rejects(()=>rx('MANAGER',{action:'sar_annual_add',firm_id:F,covers_year:new Date().getFullYear()}),/year that has ended/);
 // ---- The client file's AML scope tab ----
 const sc=await as('ASSISTANT',a=>amlAction(tx,a,{action:'aml_scope_read',client_id:C}));assert.equal(sc.profile,null);assert.equal(sc.gate_enforced,false);assert.equal(sc.services.length,0,'a person sees only the services on projects they can open');const sm=await as('MANAGER',a=>amlAction(tx,a,{action:'aml_scope_read',client_id:C}));assert.equal(sm.services[0].service_code,'TAX-COMP');assert.equal(sm.services[0].code,'UNDECIDED');assert.match(sc.note,/not treated as exempt/);
 await assert.rejects(()=>as('INTERN',a=>amlAction(tx,a,{action:'aml_scope_read',client_id:C})),/client access/);
});
test('the compliance screens, menu and tab are wired in',()=>{
 const rd=f=>fs.readFileSync(path.resolve(import.meta.dirname,'..',f),'utf8');
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/amlReportAction\(tx,a,p\)/);
 const nav=rd('staff-nav.mjs');assert.match(nav,/GROUP_COMPLIANCE/);assert.match(nav,/action:'sar-list'[^}]*gate:'mlro'/);assert.match(nav,/action:'concern-new'/);
 const pilot=rd('staff-pilot.mjs');assert.match(pilot,/compliance=\(\(\)=>\{const subs=modLinks\('compliance'\)/);assert.match(pilot,/engagements,compliance,leaf\('finance'/);assert.match(pilot,/action:'sar_menu'/);
 assert.match(rd('staff-suite.mjs'),/complianceUi\.handle\(action,id\)/);
 const ui=rd('staff-compliance.mjs');for(const a of ['concern_raise','sar_list','sar_read','sar_event','sar_log','sar_annual_move','aml_scope_read'])assert.match(ui,new RegExp(a));assert.match(ui,/denied/);
 assert.match(rd('staff-client-profile.mjs'),/\['aml','AML scope'\]/);assert.match(rd('staff-improvements.mjs'),/compliance\.paintScope\(host,id\)/);
 const mig=rd('supabase/migrations/20261121170000_aml_restricted_reports.sql');assert.doesNotMatch(mig,/change_audit[^\n]*aml_report/);assert.match(mig,/cron\.schedule\('aml-annual-report'/);
 assert.doesNotMatch(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/\^\(\?:[^\n]*(concern_|sar_)/,'the concern and restricted actions are open to every signed-in staff member; the database decides');
});
