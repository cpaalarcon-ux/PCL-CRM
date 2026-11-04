import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {suiteAction,suiteRead}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),T=id(),T2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>suiteAction(tx,a,p)),num=x=>Number(x);

test('advances are held by the receiving firm, applied only to that firm, linked to client/project/task, and statements can combine firms',async t=>{
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
 const draft=async(project,line,when='2026-10-01')=>(await act('PARTNER',{action:'invoice_save',project_id:project,request_id:id(),description:'Fictional fee',invoice_date:when,due_date:'2026-10-31',lines:[line]})).invoice_id;
 const post=async inv=>(await act('PARTNER',{action:'invoice_post',invoice_id:inv,revision:1})).invoice_number;

 // Task link on invoice lines: must belong to the invoice project.
 await assert.rejects(()=>draft(P,{description:'Wrong task',quantity:1,unit_price:1000,vat_rate:16,task_id:T2}),/task must belong/);
 const invA=await draft(P,{description:'Return filing',quantity:1,unit_price:10000,vat_rate:16,task_id:T,milestone:'Milestone 1'}),numA=await post(invA);
 const invB=await draft(P2,{description:'Advisory',quantity:1,unit_price:5000,vat_rate:0}),numB=await post(invB);
 assert.notEqual(numA,numB,'each firm issues its own invoice number');
 assert.equal((await tx`select lines->0->>'task_id' t,lines->0->>'milestone' m from erp_private.invoices where invoice_id=${invA}`)[0].t,T);
 const billed=await act('MANAGER',{action:'billing_by_task',project_id:P});assert.equal(billed.rows.length,1);assert.equal(num(billed.rows[0].billed),10000);assert.equal(billed.not_linked,0);

 // Receive an advance: held by firm A, earmarked to project A.
 const rid=id();
 await assert.rejects(()=>act('SUPERVISOR',{action:'advance_receive',request_id:id(),client_id:C,firm_id:F,amount:3000,method:'Cash',received_date:'2026-10-02',reference:'CV-1'}),/finance staff|not available|row-level/i);
 const adv=await act('PARTNER',{action:'advance_receive',request_id:rid,client_id:C,firm_id:F,project_id:P,amount:4000,method:'M-Pesa',received_date:'2026-10-02',reference:'QWERT1',purpose:'Fictional deposit'});
 assert.match(adv.receipt_number,/^ADV\/VCQA\//);
 assert.equal((await act('PARTNER',{action:'advance_receive',request_id:rid,client_id:C,firm_id:F,project_id:P,amount:4000,method:'M-Pesa',received_date:'2026-10-02',reference:'QWERT1'})).advance_id,adv.advance_id,'same request id returns the same advance');
 await assert.rejects(()=>act('PARTNER',{action:'advance_receive',request_id:id(),client_id:C,firm_id:F2,project_id:P,amount:10,method:'Cash',received_date:'2026-10-02',reference:'X'}),/different firm/);
 await assert.rejects(()=>act('PARTNER',{action:'advance_receive',request_id:id(),client_id:C,firm_id:F,amount:0,method:'Cash',received_date:'2026-10-02',reference:'X'}),/amount/i);
 let read=await as('PARTNER',()=>suiteRead(tx));
 assert.equal(num(read.advances[0].balance),4000);

 // Applying: only to the same firm's invoice and the earmarked project.
 await assert.rejects(()=>act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:adv.advance_id,invoice_id:invB,amount:1000}),/firm that received/);
 const adv2=await act('PARTNER',{action:'advance_receive',request_id:id(),client_id:C,firm_id:F,amount:500,method:'Cash',received_date:'2026-10-03',reference:'CV-2'});
 const apply=await act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:adv.advance_id,invoice_id:invA,amount:3000,payment_date:'2026-10-05'});
 assert.match(apply.receipt_number,/\/PAY\//);
 let pay=(await tx`select method,reference,advance_id,amount from erp_private.payments where payment_id=${apply.payment_id}`)[0];assert.equal(pay.method,'Advance');assert.equal(pay.reference,adv.receipt_number);assert.equal(num(pay.amount),3000);
 await assert.rejects(()=>act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:adv.advance_id,invoice_id:invA,amount:1500}),/not enough|credit/i);
 await assert.rejects(()=>act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:invA,amount:100,method:'Advance',reference:'x',payment_date:'2026-10-06'}),/./,'Advance cannot be chosen as a manual method');
 read=await as('PARTNER',()=>suiteRead(tx));
 assert.equal(num(read.advances.find(a=>a.advance_id===adv.advance_id).balance),1000);
 assert.equal(num(read.invoices.find(i=>i.invoice_id===invA).paid_amount),3000);

 // The database refuses an advance applied across firms or past its balance even if the action is bypassed.
 await assert.rejects(()=>tx`insert into erp_private.payments(request_id,invoice_id,project_id,client_id,firm_id,receipt_number,payment_date,method,reference,amount,advance_id,created_by) values(${id()},${invB},${P2},${C},${F2},'X/1','2026-10-06','Advance','x',100,${adv2.advance_id},${actors.PARTNER.staff_id})`,/foreign key|violates/i);
 await assert.rejects(()=>tx`insert into erp_private.payments(request_id,invoice_id,project_id,client_id,firm_id,receipt_number,payment_date,method,reference,amount,advance_id,created_by) values(${id()},${invA},${P},${C},${F},'X/2','2026-10-06','Advance','x',900,${adv.advance_id},${actors.PARTNER.staff_id})`,/not enough/,'over-application is blocked by the database');

 // Reversal returns the credit.
 await act('PARTNER',{action:'payment_reverse',request_id:id(),payment_id:apply.payment_id,payment_date:'2026-10-07',reason:'Applied in error'});
 read=await as('PARTNER',()=>suiteRead(tx));
 assert.equal(num(read.advances.find(a=>a.advance_id===adv.advance_id).balance),4000);
 assert.equal(num(read.invoices.find(i=>i.invoice_id===invA).paid_amount),0);
 await act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:adv.advance_id,invoice_id:invA,payment_date:'2026-10-08'});
 read=await as('PARTNER',()=>suiteRead(tx));
 assert.equal(num(read.advances.find(a=>a.advance_id===adv.advance_id).balance),0,'default amount is the smaller of the credit and the invoice balance');

 // Statements: separate per firm, or one combined with subtotals and advances held.
 await act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:invB,amount:1000,method:'Bank',reference:'BNK-1',payment_date:'2026-10-09'});
 const single=await act('MANAGER',{action:'statement',client_id:C,firm_id:F,starts_on:'2026-10-01',ends_on:'2026-10-31'});
 assert.equal(single.combined,false);assert.ok(single.rows.every(r=>r.firm_id===F));
 const comb=await act('MANAGER',{action:'statement',client_id:C,combine:true,firm_id:F,starts_on:'2026-10-01',ends_on:'2026-10-31'});
 assert.equal(comb.combined,true);assert.equal(comb.firms.length,2,'firm filter is ignored when combined');
 const a=comb.firms.find(f=>f.firm_id===F),b=comb.firms.find(f=>f.firm_id===F2);
 assert.equal(num(a.invoiced),11600);assert.equal(num(a.paid),4000);assert.equal(num(a.closing),7600);
 assert.equal(num(b.invoiced),5000);assert.equal(num(b.paid),1000);assert.equal(num(b.closing),4000);
 assert.equal(num(a.advances_held),500,'the unapplied advance is shown as a memo, not netted into the balance');
 assert.equal(num(comb.closing),num(a.closing)+num(b.closing));assert.equal(num(comb.advances_held),500);assert.equal(num(comb.net_after_advances),num(comb.closing)-500);
 assert.equal(comb.advances.length,2);
 const wip=await act('MANAGER',{action:'wip_report'});assert.equal(num(wip.rows.find(r=>r.project_id===P).advance_held),0);
});
