import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {payrollRegisterAction}=await import('../supabase/functions/staff-workspace-v12/payroll-register-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const reg=(role,p)=>as(role,a=>payrollRegisterAction(tx,a,{project_id:P,...p}));
test('payroll register: add, change pay with effective dates, roll a month forward, leave, never edit; submitted months are reported not altered',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await assert.rejects(()=>reg('INTERN',{action:'payroll_register_read'}),/client access/);
 const person=(name,pin,x={})=>({name,kra_pin:pin,relationship:'Employee',employment_type:'Permanent',started_on:'2026-01-01',...x});
 const pay=(gross,eff='2026-01-01',reason='Contract signed January 2026')=>({gross,effective_from:eff,reason});
 const w=await reg('ASSISTANT',{action:'payroll_register_add',person:person('Wanjiru','A000000001Z'),pay:pay(100000)});
 const o=await reg('ASSISTANT',{action:'payroll_register_add',person:person('Otieno','A000000002Z'),pay:pay(80000)});
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_add',person:person('Wanjiru again','A000000001Z'),pay:pay(1)}),/already on this client/);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_add',person:{...person('Boss','A000000003Z'),relationship:'Owner'},pay:pay(5)}),/Drawings/);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_add',person:person('No reason','A000000004Z'),pay:{gross:5,effective_from:'2026-01-01',reason:'x'}}),/reason/);
 // A raise from 1 September: earlier months still draft the old pay, later months the new pay.
 const raise=await reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:110000,effective_from:'2026-09-01',reason:'Annual review approved August 2026'});assert.deepEqual(raise.affected_months,[]);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:111000,effective_from:'2026-09-01',reason:'Same date again please'}),/already changes on that date/);
 const aug=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-08'}),sep=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09'});
 assert.equal(aug.lines.find((l)=>l.name==='Wanjiru').gross,100000);assert.equal(sep.lines.find((l)=>l.name==='Wanjiru').gross,110000);
 assert.deepEqual(sep.changes.pay_changes.map((c)=>c.name),['Wanjiru']);assert.equal(sep.lines[0].evidence_reference,'','evidence for the month is entered new');assert.equal(sep.lines[0].other_deductions,'');
 // Pay is never edited or deleted, even by SQL as the API role.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_payroll_pay set gross=1`),/never edited|permission/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.client_payroll_pay`),/not allowed|permission|delete/i);
 // A person who leaves drops out of later months; earlier months are unchanged. A new person is reported as new staff.
 await reg('ASSISTANT',{action:'payroll_register_add',person:person('Kamau','A000000005Z',{started_on:'2026-10-01'}),pay:pay(60000,'2026-10-01','Offer letter October 2026')});
 const list=await reg('ASSISTANT',{action:'payroll_register_read'}),oti=list.people.find((x)=>x.name==='Otieno');
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_leave',person_id:o.person_id,revision:oti.revision,left_on:'2026-09-30',reason:'short'}),/reason/);
 await reg('ASSISTANT',{action:'payroll_register_leave',person_id:o.person_id,revision:oti.revision,left_on:'2026-09-30',reason:'Resigned, notice served September'});
 const oct=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-10'});
 assert.deepEqual(oct.lines.map((l)=>l.name),['Kamau','Wanjiru']);assert.deepEqual(oct.changes.new_staff.map((c)=>c.name),['Kamau']);assert.deepEqual(oct.changes.left.map((c)=>c.name),['Otieno']);
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09'})).lines.length,2,'September still includes Otieno');
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_pay',person_id:o.person_id,gross:1,effective_from:'2026-11-01',reason:'After leaving date'}),/left/);
 // A pay change dated inside a month that is already submitted or approved is reported; the saved month is untouched.
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_imports(import_id,project_id,client_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by,entry_mode) values(${id()},${P},${C},'Payroll','PAYROLL','PAYROLL_MONTHLY','2026-09-01','2026-09-30',${tx.json({employees:[],calculated:[]})},${'h'+id()},'Confirmed',${actors.ASSISTANT.staff_id},'Manual')`;
 await db.exec('set session_replication_role=origin');
 const late=await reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:120000,effective_from:'2026-09-15',reason:'Backdated correction approved'});
 assert.deepEqual(late.affected_months.map((m)=>m.month),['2026-09']);assert.match(late.note,/keeps the figures/);
 const rows=await tx`select count(*)::int n from erp_private.period_imports where client_id=${C}`;assert.equal(rows[0].n,1,'no payroll was created or changed by the register');
 const ex=(await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09'})).existing_run;assert.equal(ex.status,'Confirmed','the draft warns that the month already exists');
});
