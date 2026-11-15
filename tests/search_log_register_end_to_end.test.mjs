import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {searchCalendarAction}=await import('../supabase/functions/staff-workspace-v12/search-calendar-actions.ts');const {targetMeasureAction}=await import('../supabase/functions/staff-workspace-v12/target-measure-actions.ts');const {payrollAccessLogAction}=await import('../supabase/functions/staff-workspace-v12/payroll-access-log.ts');const {payrollRegisterAction}=await import('../supabase/functions/staff-workspace-v12/payroll-register-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,async a=>(await searchCalendarAction(tx,a,p))??(await targetMeasureAction(tx,a,p))??(await payrollAccessLogAction(tx,a,p))??(await payrollRegisterAction(tx,a,p)));
test("search, calendar, payroll access log and the 95% register",async t=>{
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
 // ---- search
 await assert.rejects(()=>act('ASSISTANT',{action:'search_all',q:'a'}),/at least 2/);
 const s1=await act('ASSISTANT',{action:'search_all',q:'  V3 '});
 assert.equal(s1.query,'V3');assert.ok(s1.groups.clients.some(c=>c.client_id===C));assert.ok(s1.groups.projects.some(p=>p.project_id===P));
 const s2=await act('ASSISTANT',{action:'search_all',q:'document task'});assert.ok(s2.groups.tasks.some(x=>x.task_id===T));
 const s3=await act('ASSISTANT',{action:'search_all',q:'%%'});assert.equal(s3.total,0,'wildcards typed by a person are matched literally');
 const cat=(await tx`select code,name from erp_private.account_catalog where status='Active' order by code limit 1`)[0];
 if(cat){const s4=await act('ASSISTANT',{action:'search_all',q:cat.code});assert.ok(s4.groups.accounts.some(x=>x.code===cat.code));assert.equal(typeof s4.groups.accounts[0].clients_using,'number');}
 const hidden=await act('ASSISTANT',{action:'search_all',q:'hidden project'});assert.ok(!hidden.groups.projects.some(p=>p.project_id===P2),'a project the person cannot open is not listed');
 // ---- calendar
 const month=new Date(Date.now()+3*3600000).toISOString().slice(0,7),day10=month+'-10';
 await tx`update erp_private.tasks set due_at=${day10+'T09:00:00+03:00'} where task_id=${T}`;
 await tx`insert into erp_private.period_due_dates(client_id,starts_on,ends_on,filing_class,suggested_due_date,suggestion_rule,status,fallback_reason,confirmed_by) values(${C},${month+'-01'},${month+'-28'},'VAT',${month+'-20'},'20th of next month','TASK_DATE_FALLBACK','Waiting for iTax to be checked',${actors.MANAGER.staff_id})`;
 const cal=await act('ASSISTANT',{action:'calendar_read',month});
 assert.equal(cal.month,month);assert.ok(cal.count>=2);
 const all=cal.days.flatMap(d=>d.items);
 assert.ok(all.some(e=>e.kind==='task'&&e.date===day10&&e.project_id===P));assert.ok(all.some(e=>e.kind==='kra_suggested'&&e.date===month+'-20'&&/not confirmed/i.test(e.status)));
 await tx`update erp_private.tasks set status='Completed' where task_id=${T}`;
 assert.ok(!(await act('ASSISTANT',{action:'calendar_read',month})).days.flatMap(d=>d.items).some(e=>e.kind==='task'),'a finished task is not shown as due');
 await assert.rejects(()=>act('ASSISTANT',{action:'calendar_read',month:'2026-13'}),/YYYY-MM/);
 // ---- payroll access log
 assert.equal((await tx`select count(*)::int n from erp_private.payroll_access_log`)[0].n,0);
 await act('ASSISTANT',{action:'payroll_register_read',project_id:P});await act('SUPERVISOR',{action:'payroll_register_read',project_id:P});
 await assert.rejects(()=>act('INTERN',{action:'payroll_register_read',project_id:P}),/client access/);
 assert.equal((await tx`select count(*)::int n from erp_private.payroll_access_log`)[0].n,2,'a refused read leaves no row');
 const log=await act('MANAGER',{action:'payroll_access_log_read'});
 assert.equal(log.total,2);assert.deepEqual(log.rows.map(r=>r.surface),['Payroll register','Payroll register']);assert.ok(log.rows.some(r=>r.read_by===actors.ASSISTANT.staff_id));assert.equal(log.by_person.length,2);
 await assert.rejects(()=>act('ASSISTANT',{action:'payroll_access_log_read'}),/Manager or Partner/);
 const none=await act('PARTNER',{action:'payroll_access_log_read',from:'2999-01-01'});assert.equal(none.total,0);
 await db.exec('begin');await assert.rejects(()=>db.exec(`update erp_private.payroll_access_log set surface='Payroll run'`),/never edited/);await db.exec('rollback');
 await db.exec('begin');await assert.rejects(()=>db.exec(`delete from erp_private.payroll_access_log`),/./);await db.exec('rollback');
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.payroll_access_log(client_id,project_id,surface,read_by) values(${C},${P},'Payroll register',${actors.MANAGER.staff_id})`),/row-level security|violates/,'a person cannot write a read for someone else');
 const C2=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C2},'Fictional other client',${actors.ASSISTANT.staff_id})`;
 await assert.rejects(()=>as('PARTNER',()=>tx`insert into erp_private.payroll_access_log(client_id,project_id,surface,read_by) values(${C2},${P},'Payroll register',${actors.PARTNER.staff_id})`),/another client|row-level|violates/);
 // ---- 95% register
 await assert.rejects(()=>act('ASSISTANT',{action:'target_measure_read'}),/Supervisors, Managers and Partners/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'target_measure_record',kind:'Current',activity:'Period opening',period_label:'2026-09',minutes:10,method:'Timed',first_pass:true}),/baseline/i);
 await assert.rejects(()=>act('SUPERVISOR',{action:'target_measure_record',kind:'Baseline',activity:'Period opening',period_label:'2026-06',minutes:200,method:'Estimated'}),/note saying/);
 await act('SUPERVISOR',{action:'target_measure_record',kind:'Baseline',activity:'Period opening',period_label:'2026-06',minutes:200,method:'Timesheet',note:'Average of three manual months'});
 await act('SUPERVISOR',{action:'target_measure_record',kind:'Baseline',activity:'Period opening',client_id:C,period_label:'2026-06',minutes:220,method:'Timed'});
 for(const [m,min] of [['2026-09',40],['2026-10',20]])await act('MANAGER',{action:'target_measure_record',kind:'Current',activity:'Period opening',client_id:C,period_label:m,minutes:min,method:'Timed',first_pass:true});
 let reg=await act('MANAGER',{action:'target_measure_read'});let row=reg.summary.rows.find(r=>r.activity==='Period opening');
 assert.match(row.state,/Needs 1 more period/);assert.equal(row.reduction_pct,null,'no comparison before three periods');assert.equal(reg.summary.overall,null);
 await act('MANAGER',{action:'target_measure_record',kind:'Current',activity:'Period opening',client_id:C,period_label:'2026-11',minutes:10,method:'Timed',first_pass:false,rework_minutes:5,missed_deadline:true});
 reg=await act('PARTNER',{action:'target_measure_read'});row=reg.summary.rows.find(r=>r.activity==='Period opening');
 assert.equal(row.baseline_minutes,210);assert.equal(row.periods,3);assert.equal(row.current_minutes,23.3);assert.equal(row.reduction_pct,88.9);assert.equal(row.state,'Below target');
 assert.equal(row.missed_deadlines,1);assert.match(row.accuracy_note,/missed deadline/);assert.equal(reg.summary.overall.reached,false);
 const first=reg.entries.find(e=>e.kind==='Current'&&e.period_label==='2026-11');
 await assert.rejects(()=>act('MANAGER',{action:'target_measure_void',measurement_id:first.measurement_id,reason:'short'}),/at least 10/);
 await act('MANAGER',{action:'target_measure_void',measurement_id:first.measurement_id,reason:'Entered against the wrong month'});
 await assert.rejects(()=>act('MANAGER',{action:'target_measure_void',measurement_id:first.measurement_id,reason:'Second void attempt here'}),/already voided/);
 await act('MANAGER',{action:'target_measure_record',kind:'Current',activity:'Period opening',client_id:C,period_label:'2026-11',minutes:9,method:'Timed',first_pass:true});
 reg=await act('PARTNER',{action:'target_measure_read'});row=reg.summary.rows.find(r=>r.activity==='Period opening');
 assert.equal(row.current_minutes,23);assert.equal(row.reduction_pct,89.0);assert.equal(row.missed_deadlines,0);
 await db.exec('begin');await assert.rejects(()=>db.exec(`update erp_private.target_measurements set minutes=1 where kind='Baseline'`),/never edited/);await db.exec('rollback');
 assert.ok(reg.entries.some(e=>e.status==='Voided'&&e.voided_by_name),'a voided entry stays in the history');
 const reached=[['2026-12',2],['2027-01',2],['2027-02',2]];for(const [m,min] of reached)await act('MANAGER',{action:'target_measure_record',kind:'Current',activity:'Period opening',period_label:m,minutes:min,method:'Timed',first_pass:true});
 reg=await act('PARTNER',{action:'target_measure_read'});row=reg.summary.rows.find(r=>r.activity==='Period opening');assert.equal(row.state,'Target reached');assert.ok(row.reduction_pct>=95);assert.equal(reg.summary.overall.reached,true);
});
