import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import zlib from 'node:zlib';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {suiteAction,suiteRead,setPdfLib}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const rules=await import('../supabase/functions/staff-workspace-v12/suite-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),T=id(),T2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>suiteAction(tx,a,p));

test('Invoices are locked to 16% VAT, disbursements carry none, and the database refuses a bypass',async t=>{
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
 const lines=(extra={})=>[{description:'Fee',quantity:1,unit_price:1000,...extra}];
 const save=(role,p)=>act(role,{action:'invoice_save',project_id:P,request_id:id(),description:'Policy test',invoice_date:'2026-11-01',due_date:'2026-11-15',lines:lines(),...p});
 // 1. Fee line: VAT is 16% whatever the caller sends or omits.
 const a=await save('PARTNER',{});const [ra]=(await tx`select net_amount,vat_amount,lines from erp_private.invoices where invoice_id=${a.invoice_id}`);
 assert.deepEqual([Number(ra.net_amount),Number(ra.vat_amount)],[1000,160]);assert.equal(ra.lines[0].vat_rate,16);assert.equal(ra.lines[0].line_type,'Fee');
 const b=await save('PARTNER',{lines:lines({vat_rate:16})});assert.ok(b.invoice_id,'an explicit 16 is accepted');
 // 2. Any other rate is refused with the firm policy message, and nothing is stored.
 const before=(await tx`select count(*)::int n from erp_private.invoices`)[0].n;
 for(const bad of [0,8,'0',15.99,100])await assert.rejects(()=>save('PARTNER',{lines:lines({vat_rate:bad})}),e=>e.status===400&&e.message==='Firm policy requires all invoices to be VATable at 16%.');
 assert.equal((await tx`select count(*)::int n from erp_private.invoices`)[0].n,before);
 // 3. Disbursements carry no VAT; VAT on them is refused.
 const d=await save('PARTNER',{lines:[...lines(),{description:'Registrar search fee',line_type:'Disbursement',quantity:1,unit_price:500}]});
 const [rd]=await tx`select net_amount,vat_amount,lines from erp_private.invoices where invoice_id=${d.invoice_id}`;
 assert.deepEqual([Number(rd.net_amount),Number(rd.vat_amount)],[1500,160],'VAT is on the fee only');assert.deepEqual(rd.lines.map(l=>[l.line_type,l.vat_rate,l.vat]),[['Fee',16,160],['Disbursement',0,0]]);
 await assert.rejects(()=>save('PARTNER',{lines:[{description:'Search',line_type:'Disbursement',quantity:1,unit_price:500,vat_rate:16}]}),e=>e.status===400&&/not VATable/.test(e.message));
 await assert.rejects(()=>save('PARTNER',{lines:[{description:'Search',line_type:'Disbursement',quantity:1,unit_price:500,includes_vat:true}]}),e=>e.status===400&&/not VATable/.test(e.message));
 await assert.rejects(()=>save('PARTNER',{lines:[{description:'x',line_type:'Other',quantity:1,unit_price:5}]}),e=>e.status===400);
 const only=await save('PARTNER',{lines:[{description:'Search',line_type:'Disbursement',quantity:1,unit_price:700}]});
 assert.deepEqual((await tx`select net_amount::float8 n,vat_amount::float8 v from erp_private.invoices where invoice_id=${only.invoice_id}`)[0],{n:700,v:0},'a disbursement-only invoice is allowed');
 // 4. The database refuses a bypass that skips the application.
 const raw=(lns,net,vat)=>as('PARTNER',()=>tx`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,created_by) values(${id()},${P},${C},${F},'raw','2026-11-01','2026-11-15',${tx.json(lns)}::jsonb,${net},${vat},${actors.PARTNER.staff_id})`);
 const L1=(o)=>[{description:'x',line_type:'Fee',quantity:1,unit_price:1000,vat_rate:16,net:1000,vat:160,total:1160,...o}];
 await assert.rejects(()=>raw(L1({vat_rate:0,vat:0}),1000,0),/VATable at 16%/);
 await assert.rejects(()=>raw(L1({vat_rate:8,vat:80}),1000,80),/VATable at 16%/);
 await assert.rejects(()=>raw(L1({}),1000,0),/VATable at 16%/,'totals must equal the lines');
 await assert.rejects(()=>raw(L1({line_type:'Disbursement',vat_rate:16,vat:160}),1000,160),/not VATable/);
 await assert.rejects(()=>raw([],0.01,0),/at least one line/);
 // 5. Editing a draft cannot sneak the rate down either; posting an invoice is unaffected.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.invoices set lines=${tx.json(L1({vat_rate:0,vat:0}))}::jsonb,vat_amount=0 where invoice_id=${a.invoice_id}`),/VATable at 16%/);
 await tx`update erp_private.invoices set invoice_number='INV/T/1',status='Posted',posted_by=${actors.PARTNER.staff_id},posted_at=now() where invoice_id=${a.invoice_id}`;
 // 6. A historical invoice billed at another rate stays readable and can still be voided.
 await db.exec(`alter table erp_private.invoices disable trigger invoice_vat_guard`);
 const old=id();await tx`insert into erp_private.invoices(invoice_id,request_id,project_id,client_id,firm_id,invoice_number,description,invoice_date,due_date,lines,net_amount,vat_amount,status,created_by,posted_by,posted_at) values(${old},${id()},${P},${C},${F},'INV/OLD/1','Old',${'2025-01-05'},${'2025-01-20'},${tx.json([{description:'Old',quantity:1,unit_price:1000,vat_rate:8,net:1000,vat:80,total:1080}])}::jsonb,1000,80,'Posted',${actors.PARTNER.staff_id},${actors.PARTNER.staff_id},now())`;
 await db.exec(`alter table erp_private.invoices enable trigger invoice_vat_guard`);
 assert.equal((await as('PARTNER',()=>suiteRead(tx))).invoices.find(i=>i.invoice_id===old).lines[0].vat_rate,8,'the old rate is still shown');
 await tx`update erp_private.invoices set status='Void',void_reason='Fictional correction' where invoice_id=${old}`;
 assert.equal((await tx`select status from erp_private.invoices where invoice_id=${old}`)[0].status,'Void');
 await assert.rejects(()=>tx`update erp_private.invoices set net_amount=net_amount+1 where invoice_id=${a.invoice_id}`,/immutable|VATable at 16%/,'a posted invoice still cannot be edited');
 await act('PARTNER',{action:'invoice_void',invoice_id:a.invoice_id,reason:'Fictional void of a posted invoice',revision:(await tx`select revision from erp_private.invoices where invoice_id=${a.invoice_id}`)[0].revision});
 assert.equal((await tx`select status from erp_private.invoices where invoice_id=${a.invoice_id}`)[0].status,'Void','a posted invoice can be voided');
 // 7. Recurring fees: no other rate can be chosen, and old 0%/8% schedules are brought to 16%.
 await assert.rejects(()=>act('PARTNER',{action:'fee_schedule_add',project_id:P2,frequency:'Monthly',amount_ex_vat:5000,vat_rate:0,description:'x',starts_on:'2026-10-01'}),e=>e.status===400&&e.message==='Firm policy requires all invoices to be VATable at 16%.');
 const sched=await act('PARTNER',{action:'fee_schedule_add',project_id:P2,frequency:'Monthly',amount_ex_vat:5000,description:'Compliance',starts_on:'2026-11-01'});
 assert.equal(Number((await tx`select vat_rate from erp_private.recurring_fee_schedules where fee_schedule_id=${sched.fee_schedule_id}`)[0].vat_rate),16);
 await assert.rejects(()=>tx`update erp_private.recurring_fee_schedules set vat_rate=0 where fee_schedule_id=${sched.fee_schedule_id}`,/recurring_fee_vat_16/);
 await act('PARTNER',{action:'fee_schedule_generate_due',fee_schedule_id:sched.fee_schedule_id});
 const auto=await tx`select vat_amount::float8 v,net_amount::float8 n,lines from erp_private.invoices where recurring_fee_schedule_id=${sched.fee_schedule_id} limit 1`;
 assert.deepEqual([auto[0].n,auto[0].v,auto[0].lines[0].vat_rate],[5000,800,16]);
 const nightly=await tx`select erp_private.run_recurring_fee_drafts() n`;assert.ok(nightly[0].n>=0);
});
