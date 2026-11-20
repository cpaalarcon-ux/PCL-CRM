import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import zlib from 'node:zlib';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {suiteAction,suiteRead,setPdfLib}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),T=id(),T2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>suiteAction(tx,a,p));
test('Recurring fee drafts are created automatically, the same way as the button, and never posted',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional firm A')`;
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F2},'VCQB','Fictional firm B')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F2},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 for(const [pid,firm,name] of [[P,F,'Fictional project A'],[P2,F2,'Fictional project B']]){
  await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${pid},${C},${firm},${name},'TAX-COMP',${actors.MANAGER.staff_id})`;await db.exec(`set session_replication_role=replica`);await tx`update erp_private.projects set status='Active' where project_id=${pid}`;await db.exec(`set session_replication_role=origin`);
  for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pid},${actors[role].staff_id},${firm},${role})`;
 }
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional filing task')`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T2},${P2},${actors.ASSISTANT.staff_id},'Other firm task')`;
 await tx`update erp_private.firms set kra_pin='P000000001A',phone='0700000000',physical_address='Kenya',invoice_prefix='INV/MLI',payment_instructions='Pay to Fictional Bank, account 0000' where firm_id=${F}`;
 const read=async()=>(await as('PARTNER',()=>suiteRead(tx))).invoices;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date()),ymd=d=>d instanceof Date?d.toISOString().slice(0,10):String(d).slice(0,10);
 const addDays=(iso,n)=>new Date(Date.parse(iso+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
 const run=async()=>Number((await tx`select erp_private.run_recurring_fee_drafts() as n`)[0].n);
 const clean=l=>l.map(i=>({desc:i.description,from:ymd(i.service_from),to:ymd(i.service_to),months:i.service_months,issue:ymd(i.invoice_date),due:ymd(i.due_date),net:Number(i.net_amount),vat:Number(i.vat_amount),status:i.status,line:i.lines[0]})).sort((a,b)=>a.from.localeCompare(b.from));
 // A schedule that starts on the 31st exercises the end-of-month rule; a quarterly one with an end date exercises a short last period.
 // The SQL month arithmetic equals the server rules, including the end-of-month cases.
 {const rules=await import('../supabase/functions/staff-workspace-v12/suite-rules.mjs');for(const [d,n] of [['2026-01-31',1],['2028-01-31',1],['2026-01-31',2],['2026-11-15',2],['2026-12-31',12],['2026-08-30',6],['2026-05-31',1],['2026-10-01',3]]){const got=ymd((await tx`select erp_private.fee_add_months(${d}::date,${n}) as v`)[0].v);assert.equal(got,rules.addMonthsAnchored(d,n),d+' +'+n);}
  assert.equal((await tx`select erp_private.fee_day_text('2026-11-01'::date) as v`)[0].v,rules.formatDay('2026-11-01'));}
 const start=addDays(today,-75).slice(0,8)+'31'.slice(0,2);
 const s31=addDays(today,-100),sQ=addDays(today,-200);
 const mk=(pid,p)=>act('PARTNER',{action:'fee_schedule_add',project_id:pid,description:'Tax Compilation And Compliance',amount_ex_vat:5000,vat_rate:16,...p});
 const A=await mk(P,{frequency:'Monthly',starts_on:s31}),B=await mk(P2,{frequency:'Monthly',starts_on:s31});
 // The button on project 2 is the reference; the daily run does project 1. They must agree line for line.
 const gen=await act('PARTNER',{action:'fee_schedule_generate_due',fee_schedule_id:B.fee_schedule_id});assert.ok(gen.generated>=3);
 const setProject=async st=>{await db.exec('alter table erp_private.projects disable trigger user');await tx`update erp_private.projects set status=${st} where project_id=${P}`;await db.exec('alter table erp_private.projects enable trigger user');};
 await setProject('Archived');assert.equal(await run(),0,'a project that is not active gets no drafts');assert.equal((await tx`select count(*)::int n from erp_private.invoices where recurring_fee_schedule_id=${A.fee_schedule_id}`)[0].n,0);await setProject('Active');
 const made=await run();assert.equal(made,gen.generated,'the daily run creates as many drafts as the button');
 const mine=clean((await read()).filter(i=>i.recurring_fee_schedule_id===A.fee_schedule_id)),ref=clean((await read()).filter(i=>i.recurring_fee_schedule_id===B.fee_schedule_id));
 assert.deepEqual(mine,ref,'same periods, narration, dates, amounts and line as the button');
 assert.ok(mine.every(i=>i.status==='Draft'),'never posted automatically');
 assert.ok(mine[0].desc.startsWith('Tax Compilation And Compliance 1 Month '));assert.equal(mine[0].net,5000);assert.equal(mine[0].vat,800);
 assert.equal(await run(),0,'a second run creates nothing');
 assert.equal((await tx`select count(*)::int n from erp_private.invoices where recurring_fee_schedule_id=${A.fee_schedule_id}`)[0].n,mine.length);
 const notes=await tx`select recipient_id from erp_private.notifications where event_key like ${'fee-drafts:'+A.fee_schedule_id+'%'}`;assert.ok(notes.length>=1);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='AUTO_DRAFTS' and record_key=${A.fee_schedule_id}`)[0].n,1);
 // Paused, cancelled and ended schedules and inactive projects produce nothing; a quarterly schedule with an end date stops on it.
 await db.exec('alter table erp_private.recurring_fee_schedules disable trigger user');await tx`update erp_private.recurring_fee_schedules set status='Cancelled',status_reason='test' where fee_schedule_id=${A.fee_schedule_id}`;await tx`update erp_private.recurring_fee_schedules set status='Paused' where fee_schedule_id=${B.fee_schedule_id}`;await db.exec('alter table erp_private.recurring_fee_schedules enable trigger user');
 const Q=await mk(P,{frequency:'Quarterly',starts_on:sQ,ends_on:addDays(sQ,130)});
 const before=(await tx`select count(*)::int n from erp_private.invoices`)[0].n;
 const q=await run();assert.ok(q>=1);
 const qs=clean((await read()).filter(i=>i.recurring_fee_schedule_id===Q.fee_schedule_id));
 assert.ok(qs.length>=1&&qs.length<=2);assert.ok(qs.every(i=>i.from<=ymd(addDays(sQ,130))),'no period starts after the end date');
 const last=qs.at(-1);if(last.to===ymd(addDays(sQ,130)))assert.ok(last.desc.includes(' to '));
 assert.equal((await tx`select count(*)::int n from erp_private.invoices`)[0].n,Number(before)+qs.length,'paused and cancelled schedules created nothing');
});
