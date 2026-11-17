import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {p9Action}=await import('../supabase/functions/staff-workspace-v12/p9-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('P9 cards: built from confirmed payroll months, checked against the runs, recorded on release',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,kra_pin) values(${C},'Fictional P9 client',${actors.ASSISTANT.staff_id},'P000000001A')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional P9 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const LIM={rate_key:'KE_PAYROLL_LIMITS',parameters:{pension_monthly_cap:30000,mortgage_monthly_cap:30000,medical_monthly_cap:15000}};
 const emp=(n,pin)=>({name:'Fictional Employee '+n,pin,employee_id:'2000000'+n,source_row:n,employment_type:'Permanent',other_pension:0,postretirement_medical:0,mortgage_interest:0,resident:true});
 const calc=(n,x={})=>({source_row:n,gross:100000,taxable_benefits:0,employee_nssf:2160,employer_nssf:2160,shif:2750,employee_ahl:1500,employer_ahl:1500,nita:50,other_deductions:0,allowed_deductions:6410,exemption:0,taxable:93590,gross_tax:21000,personal_relief:2400,insurance_relief:0,paye:18600,...x});
 const addImport=async(month,status,calcOver={})=>{const start=`2026-${String(month).padStart(2,'0')}-01`,end=new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10);await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.period_imports(import_id,project_id,client_id,document_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by) values(${id()},${P},${C},${D},'Payroll','PAYROLL','PAYROLL_MONTHLY',${start},${end},${tx.json({employees:[emp(1,'A000000001Z'),emp(2,'A000000002Z')],calculated:[calc(1,calcOver),calc(2)],rules:[LIM],issues:[],differences:[]})},${'h'+month+status},${status},${actors.ASSISTANT.staff_id})`;}finally{await db.exec('set session_replication_role=origin');}};
 const person=async(name,pin,surname,other)=>{await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.client_payroll_people(client_id,name,kra_pin,national_id,started_on,created_by,surname,other_names) values(${C},${name},${pin},${'2'+pin.slice(1,10).replace(/^0+/,'').padStart(7,'0')},'2025-01-01',${actors.MANAGER.staff_id},${surname},${other})`;}finally{await db.exec('set session_replication_role=origin');}};
 const p9=(role,p)=>as(role,a=>p9Action(tx,a,{project_id:P,...p}));
 await person('Fictional Employee 1','A000000001Z','Fictionalone','Person A');await person('Fictional Employee 2','A000000002Z','Fictionaltwo','Person B');
 // access: an intern and an admin are refused; the read lists nothing until a month is confirmed
 await assert.rejects(()=>p9('INTERN',{action:'statutory_file_p9_read'}),/staff with client access/);
 let r=await p9('ASSISTANT',{action:'statutory_file_p9_read'});assert.deepEqual(r.years,[]);assert.equal(r.columns.length,18);
 // months that are not confirmed are not used
 for(let m=1;m<=11;m++)await addImport(m,'Confirmed');await addImport(12,'Submitted');
 r=await p9('ASSISTANT',{action:'statutory_file_p9_read'});assert.deepEqual(r.years,[{year:2026,confirmed_months:11}]);
 let x=await p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:2026});
 assert.equal(x.ready,false);assert.ok(x.issues.some(i=>/December 2026: there is no confirmed payroll/.test(i)),'a submitted month does not count');assert.equal(x.employees.length,2);
 await assert.rejects(()=>p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:2026,release:true}),/not ready to release/);
 assert.equal((await tx`select count(*)::int n from erp_private.p9_releases`)[0].n,0,'nothing is recorded when the release is refused');
 // the preparer says no payroll ran in December: the cards are ready
 x=await p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:2026,empty_months:['2026-12']});
 assert.deepEqual(x.issues,[]);assert.equal(x.ready,true);assert.equal(x.employees[0].rows[11],null);assert.equal(x.employees[0].rows[0].A,100000);assert.equal(x.employees[0].totals.O,18600*11);assert.equal(x.client.pin,'P000000001A');
 assert.ok(x.notes.some(n=>/Value of quarters/.test(n)));
 const logged=(await tx`select count(*)::int n from erp_private.payroll_access_log where surface='P9 cards'`)[0].n;assert.ok(logged>=2,'every prepare leaves an access record');
 // one card for one person
 const one=await p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:2026,empty_months:['2026-12'],pin:'a000000002z'});assert.equal(one.employees.length,1);assert.equal(one.employees[0].pin,'A000000002Z');
 // a register name that is missing stops the cards and names the person
 await db.exec('set session_replication_role=replica');await tx`update erp_private.client_payroll_people set other_names=null where kra_pin='A000000002Z'`;await db.exec('set session_replication_role=origin');
 x=await p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:2026,empty_months:['2026-12']});assert.equal(x.ready,false);assert.ok(x.issues.some(i=>/Fictional Employee 2: surname and other names are missing/.test(i)));
 await db.exec('set session_replication_role=replica');await tx`update erp_private.client_payroll_people set other_names='Person B' where kra_pin='A000000002Z'`;await db.exec('set session_replication_role=origin');
 // a month whose figures do not agree with the run's own deductions stops the cards
 await db.exec('set session_replication_role=replica');await tx`update erp_private.period_imports set payload=jsonb_set(payload,'{calculated,0,allowed_deductions}','6000') where starts_on='2026-03-01'`;await db.exec('set session_replication_role=origin');
 x=await p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:2026,empty_months:['2026-12']});assert.equal(x.ready,false);assert.ok(x.issues.some(i=>/March 2026: total deductions \(J\)/.test(i)));
 await db.exec('set session_replication_role=replica');await tx`update erp_private.period_imports set payload=jsonb_set(payload,'{calculated,0,allowed_deductions}','6410') where starts_on='2026-03-01'`;await db.exec('set session_replication_role=origin');
 // release: one file and one record per employee, with a hash; the record is never edited or deleted
 const rel=await p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:2026,empty_months:['2026-12'],release:true});
 assert.equal(rel.released,true);assert.equal(rel.files.length,2);assert.match(rel.files[0].file_name,/^P9_2026_Fictional_P9_client_Fictional_Employee_1_A000000001Z\.csv$/);assert.match(rel.files[0].csv,/Total tax \(Col\. O\),204600\.00/);assert.match(rel.files[0].sha256,/^[0-9a-f]{64}$/);
 const rows=await tx`select employee_pin,tax_year,months_on_payroll,total_paye,total_chargeable_pay,content_sha256,generated_by from erp_private.p9_releases order by employee_pin`;
 assert.equal(rows.length,2);assert.equal(Number(rows[0].total_paye),204600);assert.equal(rows[0].months_on_payroll,11);assert.equal(rows[0].content_sha256,rel.files[0].sha256);assert.equal(rows[0].generated_by,actors.ASSISTANT.staff_id);
 r=await p9('ASSISTANT',{action:'statutory_file_p9_read'});assert.equal(r.released.length,2);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.p9_releases set total_paye=1`),/permission denied/);
 await assert.rejects(()=>tx`update erp_private.p9_releases set total_paye=1`,/never edited/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.p9_releases`));
 await assert.rejects(()=>as('INTERN',a=>tx`insert into erp_private.p9_releases(client_id,project_id,tax_year,employee_pin,employee_name,months_on_payroll,total_chargeable_pay,total_paye,content_sha256,generated_by) values(${C},${P},2026,'A000000009Z','x',1,1,1,${'b'.repeat(64)},${a.staff_id})`));
 // a bad year is refused
 await assert.rejects(()=>p9('ASSISTANT',{action:'statutory_file_p9_prepare',year:1999}),/Choose the year/);
 assert.equal(await p9Action(tx,actors.ASSISTANT,{action:'something_else'}),undefined);
});
