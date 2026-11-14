import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {periodPackAction}=await import('../supabase/functions/staff-workspace-v12/period-pack-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const pk=(role,p)=>as(role,a=>periodPackAction(tx,a,p));
test('period packs: states instead of zeros, blocked reasons, carried-forward issues without carried approvals, supervisor exceptions only',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const WP=id(),T2=id(),T3=id();
 async function imp(kind,start,end,status,hashKey){await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.period_imports(import_id,project_id,client_id,document_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by) values(${id()},${P},${C},${D},${kind},${kind==='Payroll'?'PAYROLL':'ETIMS'},${kind==='Payroll'?'PAYROLL_MONTHLY':'MONTH_FINAL'},${start},${end},${tx.json({employees:[],calculated:[],groups:[]})},${'h'+hashKey+id()},${status},${actors.ASSISTANT.staff_id})`;}finally{await db.exec('set session_replication_role=origin');}}
 // Nothing has ever come in: nothing is expected, so nothing is "zero".
 const empty=await pk('SUPERVISOR',{action:'period_pack_read',project_id:P,month:'2026-09'});
 assert.deepEqual(empty.pack.sources,[]);assert.equal(empty.pack.stage,'Nothing started');assert.equal(empty.pack.clean,false);
 await assert.rejects(()=>pk('SUPERVISOR',{action:'period_pack_read',project_id:P,month:'09-2026'}),/YYYY-MM/);
 await assert.rejects(()=>pk('INTERN',{action:'period_pack_read',project_id:P,month:'2026-09'}),/Interns/);
 // August came in: sales confirmed, payroll only submitted. September: sales nothing yet, payroll drafted.
 await imp('Sales','2026-08-01','2026-08-31','Confirmed','s8');await imp('Payroll','2026-08-01','2026-08-31','Submitted','p8');await imp('Payroll','2026-09-01','2026-09-30','Draft','p9');
 const aug=await pk('SUPERVISOR',{action:'period_pack_read',project_id:P,month:'2026-08'});
 assert.equal(aug.pack.sources.find(s=>s.key==='sales').state,'Ready');assert.equal(aug.pack.sources.find(s=>s.key==='payroll').state,'Waiting for review');
 const sep=await pk('SUPERVISOR',{action:'period_pack_read',project_id:P,month:'2026-09'});
 assert.equal(sep.pack.sources.find(s=>s.key==='sales').state,'Not received');assert.match(sep.pack.sources.find(s=>s.key==='sales').detail,/before/);
 const pay=sep.pack.sources.find(s=>s.key==='payroll');assert.equal(pay.state,'Blocked');assert.match(pay.detail,/does not inherit that approval/);assert.equal(sep.pack.stage,'Blocked');
 // Tasks for the month: one overdue, one blocked with its reason.
 await tx`insert into erp_private.project_work_periods(work_period_id,project_id,period_kind,starts_on,ends_on) values(${WP},${P},'Monthly','2026-09-01','2026-09-30')`;
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,status,blocked_reason) values(${T2},${P},${actors.ASSISTANT.staff_id},'Upload September sales','2026-09-10T17:00:00+03:00','Pending',null),(${T3},${P},${actors.ASSISTANT.staff_id},'Reconcile bank','2026-12-30T17:00:00+03:00','Blocked','Waiting for the statement from the client')`;
 await tx`insert into erp_private.work_period_tasks(task_id,work_period_id) values(${T2},${WP}),(${T3},${WP})`;
 await db.exec('set session_replication_role=origin');
 const tk=await pk('MANAGER',{action:'period_pack_read',project_id:P,month:'2026-09'});
 assert.equal(tk.pack.tasks.open,2);assert.equal(tk.pack.tasks.overdue,1);assert.equal(tk.pack.tasks.blocked[0].reason,'Waiting for the statement from the client');
 assert.ok(tk.pack.exceptions.some(e=>e.state==='Overdue'));assert.ok(tk.pack.exceptions.some(e=>e.state==='Blocked'&&/Waiting for the statement/.test(e.detail)));
 // Supervisor overview lists exceptions only; an Assistant cannot read it.
 const ov=await pk('SUPERVISOR',{action:'period_pack_overview',month:'2026-09'});
 assert.equal(ov.projects,1);assert.equal(ov.with_exceptions,1);assert.equal(ov.clean,0);assert.equal(ov.rows[0].stage,'Blocked');assert.match(ov.note,/not as zero/);
 await assert.rejects(()=>pk('ASSISTANT',{action:'period_pack_overview',month:'2026-09'}),/Supervisor, Manager or Partner/);
 // Approving last month's payroll unblocks this month's, but this month still needs its own review: the approval is not carried.
 await db.exec('set session_replication_role=replica');await tx`update erp_private.period_imports set status='Confirmed' where kind='Payroll' and starts_on='2026-08-01'`;await db.exec('set session_replication_role=origin');
 const after=await pk('SUPERVISOR',{action:'period_pack_read',project_id:P,month:'2026-09'});
 assert.equal(after.pack.sources.find(s=>s.key==='payroll').state,'In progress');assert.notEqual(after.pack.sources.find(s=>s.key==='payroll').state,'Ready');
 // A quiet month with nothing expected and nothing due is not shown as a problem elsewhere: a month before anything existed.
 const early=await pk('SUPERVISOR',{action:'period_pack_read',project_id:P,month:'2026-01'});assert.deepEqual(early.pack.sources,[]);
});
