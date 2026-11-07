import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {debtorsRead,receiptAction}=await import('../supabase/functions/staff-workspace-v12/debtors.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('debtors ageing: receipts are allocated from bank credits, reversed with a reason, and age by invoice date',async t=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const BS=id(),BB=id(),SALE=(k,date,inv,party,amt,vat)=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${BS},${P},${C},'Sales',${k},${'S'+k},'{}',${tx.json({date,invoice:inv,party,party_pin:'P000000001A',amount:amt,vat})}) returning row_id`.then(r=>r[0].row_id),
  BANK=(k,date,ref,credit)=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${BB},${P},${C},'Bank',${k},${'B'+k},'{}',${tx.json({date,reference:ref,debit:0,credit,balance:0})}) returning row_id`.then(r=>r[0].row_id);
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${BS},${P},${D},'Sales',1,'Sales','2026-01-01','2026-12-31','{}',3,3,0,0,${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${BB},${P},${D},'Bank',1,'Bank','2026-01-01','2026-12-31','{}',2,2,0,0,${actors.ASSISTANT.staff_id})`;
 const s1=await SALE(2,'2026-01-10','INV1','Fictional Duka Ltd',1000,160),s2=await SALE(3,'2026-03-01','INV2','Fictional Duka Ltd',500,80),cn=await SALE(4,'2026-03-05','CN1','Fictional Duka Ltd',-100,-16);
 const b1=await BANK(2,'2026-01-20','MPESA-A1',1160),b2=await BANK(3,'2026-03-10','MPESA-A2',400),early=await BANK(4,'2026-01-02','MPESA-EARLY',50);
 const L={project_id:P,period_id:id(),starts_on:'2026-01-01',ends_on:'2026-12-31'},act=(role,p)=>as(role,a=>receiptAction(tx,a,L,p)),read=(role,asOf)=>as(role,()=>debtorsRead(tx,L,asOf));
 const alloc=(role,bank,sale,amount,rid=id())=>act(role,{action:'ledger_receipt_allocate',request_id:rid,bank_row_id:bank,sales_row_id:sale,amount});

 let r=await read('ASSISTANT','2026-04-30');
 assert.equal(r.totals.total,1624,'two invoices and a credit note are open before any receipt');
 assert.equal(r.unallocated_receipts.count,3);assert.equal(r.reconciliation.not_posted,1624,'nothing is posted to the ledger yet');

 // Allocate: one credit pays one invoice; another pays part of another.
 const rid=id();const first=await alloc('ASSISTANT',b1,s1,1160,rid);
 assert.deepEqual(await alloc('ASSISTANT',b1,s1,1160,rid),first,'the same request id is not applied twice');
 await alloc('ASSISTANT',b2,s2,400);
 r=await read('ASSISTANT','2026-04-30');
 const duka=r.customers[0];assert.equal(r.customers.length,1);
 assert.deepEqual(duka.invoices.map(i=>[i.invoice,i.open]),[['INV2',180],['CN1',-116]]);
 assert.equal(r.totals.total,64);assert.equal(r.totals.current,0);assert.equal(r.totals.d31_60,64,'INV2 is 60 days old and CN1 is 56 days old');
 assert.equal(r.unallocated_receipts.count,1);assert.equal(r.unallocated_receipts.value,50,'MPESA-A1 and A2 are fully used; the 50 left is the early credit');

 // Refusals.
 await assert.rejects(()=>alloc('ASSISTANT',b2,s2,1),/left to allocate|Only KES 0\.00/,'the bank credit is used up');
 await assert.rejects(()=>alloc('ASSISTANT',early,s2,1000),/Only KES 50\.00/,'cannot exceed the credit');
 await assert.rejects(()=>alloc('ASSISTANT',early,s2,50),/dated before the invoice/);
 await assert.rejects(()=>alloc('ASSISTANT',b2,cn,1),/not to credit notes/);
 await assert.rejects(()=>alloc('ASSISTANT',s1,b1,1),/Choose a bank or mobile-money credit/);
 // The database refuses an over-allocation even if the application check is bypassed.
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.customer_receipt_allocations(request_id,project_id,bank_row_id,sales_row_id,amount,allocated_by) values(${id()},${P},${b2},${s2},9999,${actors.ASSISTANT.staff_id})`),/./);

 // As-of date: an allocation for a receipt dated after the as-of date is not counted yet.
 r=await read('ASSISTANT','2026-01-15');assert.equal(r.totals.total,1160,'only INV1 existed at 15 January and its receipt is dated the 20th');

 // Reverse: only Supervisor and above, with a reason; the invoice reopens; reversal cannot be repeated or reversed.
 const hist=(await read('ASSISTANT','2026-04-30')).allocations.find(x=>x.invoice==='INV1');
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_receipt_reverse',request_id:id(),allocation_id:hist.allocation_id,reason:'Allocated to the wrong customer'}),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'ledger_receipt_reverse',request_id:id(),allocation_id:hist.allocation_id,reason:'short'}),/at least 10/);
 const rev=await act('SUPERVISOR',{action:'ledger_receipt_reverse',request_id:id(),allocation_id:hist.allocation_id,reason:'Allocated to the wrong customer'});
 await assert.rejects(()=>act('MANAGER',{action:'ledger_receipt_reverse',request_id:id(),allocation_id:hist.allocation_id,reason:'Trying to reverse twice'}),/already reversed/);
 await assert.rejects(()=>act('MANAGER',{action:'ledger_receipt_reverse',request_id:id(),allocation_id:rev.allocation_id,reason:'Reversing the reversal'}),/cannot be reversed/);
 r=await read('ASSISTANT','2026-04-30');
 assert.equal(r.totals.total,1224,'INV1 is open again (1,160) plus 64');assert.equal(r.unallocated_receipts.count,2,'the credit is free to allocate again');
 assert.equal(r.allocations.find(x=>x.invoice==='INV1').reversed,true);
 // Allocation rows are append-only.
 await assert.rejects(()=>tx`delete from erp_private.customer_receipt_allocations where allocation_id=${first.allocation_id}`,/./);
});
