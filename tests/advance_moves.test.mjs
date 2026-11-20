import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {suiteAction,suiteRead}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),T=id(),T2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>suiteAction(tx,a,p)),num=x=>Number(x);

test('advances can be refunded or moved to another firm, and posted invoices carry an eTIMS reference',async t=>{
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
  await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${pid},${C},${firm},${name},'TAX-COMP',${actors.MANAGER.staff_id})`;await db.exec(`set session_replication_role=replica`);await tx`update erp_private.projects set status='Active' where project_id=${pid}`;await db.exec(`set session_replication_role=origin`);{const ld=crypto.randomUUID();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by,is_locked) values(${ld},${C},${firm},${pid},'Signed Engagement Letters','letter.pdf',${'k/'+ld},10,${'a'.repeat(64)},'application/pdf',${actors.MANAGER.staff_id},true)`;await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by,stage) values(${pid},${ld},${actors.MANAGER.staff_id},'Accepted')`;}
  for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pid},${actors[role].staff_id},${firm},${role})`;
 }
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional filing task')`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T2},${P2},${actors.ASSISTANT.staff_id},'Other firm task')`;
 const draft=async(project,line,when='2026-10-01')=>(await act('PARTNER',{action:'invoice_save',project_id:project,request_id:id(),description:'Fictional fee',invoice_date:when,due_date:'2026-10-31',lines:[line]})).invoice_id;
 const post=async inv=>(await act('PARTNER',{action:'invoice_post',invoice_id:inv,revision:1})).invoice_number;
 const invA=await draft(P,{description:'Return filing',quantity:1,unit_price:10000,vat_rate:16}),numA=await post(invA);
 const invA2=await draft(P,{description:'Second fee',quantity:1,unit_price:1000,vat_rate:16});
 const invB=await draft(P2,{description:'Advisory',quantity:1,unit_price:5000,vat_rate:0,line_type:'Disbursement'}),numB=await post(invB);
 const adv=await act('PARTNER',{action:'advance_receive',request_id:id(),client_id:C,firm_id:F,amount:4000,method:'Bank',received_date:'2026-10-02',reference:'BANK-1'});
 await act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:adv.advance_id,invoice_id:invA,amount:1000,payment_date:'2026-10-05'});
 const bal=async advId=>num((await as('PARTNER',()=>suiteRead(tx))).advances.find(a=>a.advance_id===advId).balance);
 assert.equal(await bal(adv.advance_id),3000);

 // Refund: Partner or Manager only, with a reason and a reference; cannot exceed the credit left.
 const refundBase={action:'advance_refund',advance_id:adv.advance_id,amount:500,method:'Bank',movement_date:'2026-10-10',reference:'BANK-REF-9',reason:'Client cancelled the engagement'};
 await assert.rejects(()=>act('SUPERVISOR',{...refundBase,request_id:id()}),/Partner or Manager/);
 await assert.rejects(()=>act('PARTNER',{...refundBase,request_id:id(),reason:'short'}),/reason/);
 await assert.rejects(()=>act('PARTNER',{...refundBase,request_id:id(),reference:' '}),/required text fields|Record how the money moved/);
 await assert.rejects(()=>act('PARTNER',{...refundBase,request_id:id(),amount:3500}),/Only KES 3000\.00/);
 const rid=id(),ref=await act('PARTNER',{...refundBase,request_id:rid});
 assert.match(ref.voucher_number,/^RFD\/VCQA\//);
 assert.equal((await act('PARTNER',{...refundBase,request_id:rid})).movement_id,ref.movement_id,'the same request id is not applied twice');
 assert.equal(await bal(adv.advance_id),2500,'a refund reduces the credit left');
 await assert.rejects(()=>act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:adv.advance_id,invoice_id:invA,amount:2600,payment_date:'2026-10-11'}),/not enough|credit/i,'refunded money cannot be applied');

 // Transfer to another firm of the same client.
 const F3=id();await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F3},'VCQC','Fictional firm C')`;
 const moveBase={action:'advance_transfer',advance_id:adv.advance_id,amount:1500,movement_date:'2026-10-12',reference:'INTERFIRM-1',reason:'Fees now billed by the other firm'};
 await assert.rejects(()=>act('PARTNER',{...moveBase,request_id:id(),to_firm_id:F}),/different firm/);
 await assert.rejects(()=>act('PARTNER',{...moveBase,request_id:id(),to_firm_id:F3}),/not linked/);
 await assert.rejects(()=>act('PARTNER',{...moveBase,request_id:id(),to_firm_id:F2,amount:2600}),/Only KES 2500\.00/);
 await assert.rejects(()=>act('PARTNER',{...moveBase,request_id:id(),to_firm_id:F2,to_project_id:P}),/not the client|different/i,'the earmark project must belong to the receiving firm');
 const mv=await act('PARTNER',{...moveBase,request_id:id(),to_firm_id:F2,to_project_id:P2});
 assert.match(mv.voucher_number,/^TRF\/VCQA\//);assert.match(mv.to_receipt_number,/^ADV\/VCQB\//);
 const created=(await tx`select * from erp_private.client_advances where advance_id=${mv.to_advance_id}`)[0];
 assert.equal(created.firm_id,F2);assert.equal(created.method,'Transfer');assert.equal(num(created.amount),1500);assert.equal(created.project_id,P2);
 assert.equal(await bal(adv.advance_id),1000);assert.equal(await bal(mv.to_advance_id),1500);
 // The new advance belongs to the receiving firm and its project only.
 await assert.rejects(()=>act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:mv.to_advance_id,invoice_id:invA,amount:100,payment_date:'2026-10-13'}),/firm that received/);
 await act('PARTNER',{action:'advance_apply',request_id:id(),advance_id:mv.to_advance_id,invoice_id:invB,amount:1500,payment_date:'2026-10-13'});
 assert.equal(await bal(mv.to_advance_id),0);
 // The database refuses an over-draw or a mismatched transfer even if the action is bypassed.
 await assert.rejects(()=>as('PARTNER',a=>tx`insert into erp_private.advance_movements(request_id,advance_id,client_id,firm_id,kind,amount,movement_date,voucher_number,method,reference,reason,created_by) values(${id()},${adv.advance_id},${C},${F},'Refund',5000,'2026-10-14','RFD/X/1','Cash','x','A long enough reason',${a.staff_id})`),/not enough/);
 await assert.rejects(()=>as('PARTNER',a=>tx`insert into erp_private.advance_movements(request_id,advance_id,client_id,firm_id,kind,amount,movement_date,voucher_number,reference,reason,to_advance_id,created_by) values(${id()},${adv.advance_id},${C},${F},'Transfer',100,'2026-10-14','TRF/X/1','x','A long enough reason',${mv.to_advance_id},${a.staff_id})`),/./);
 await assert.rejects(()=>tx`delete from erp_private.advance_movements where movement_id=${ref.movement_id}`,/./,'movements are append-only');
 await assert.rejects(()=>tx`update erp_private.advance_movements set amount=1 where movement_id=${ref.movement_id}`,/./);
 // The statement shows what is still held.
 const st=await act('MANAGER',{action:'statement',client_id:C,combine:true,starts_on:'2026-10-01',ends_on:'2026-10-31'});
 assert.equal(num(st.advances_held),1000);

 // eTIMS reference on a posted invoice: recorded once, copied from the portal.
 const read0=await as('PARTNER',()=>suiteRead(tx));assert.equal(read0.invoices.find(i=>i.invoice_id===invA).etims,null);
 const et={action:'invoice_etims_record',invoice_id:invA,etims_invoice_no:'ETIMS-000123',etims_issued_on:'2026-10-02',qr_url:'https://etims.example.test/verify/123'};
 await assert.rejects(()=>act('PARTNER',{...et,invoice_id:invA2}),/posted invoice/);
 await assert.rejects(()=>act('PARTNER',{...et,qr_url:'http://insecure.example.test'}),/https/);
 await assert.rejects(()=>act('PARTNER',{...et,etims_issued_on:'2099-01-01'}),/future/);
 await act('PARTNER',et);
 const read1=await as('PARTNER',()=>suiteRead(tx)),e=read1.invoices.find(i=>i.invoice_id===invA).etims;
 assert.equal(e.etims_invoice_no,'ETIMS-000123');assert.equal(String(e.etims_issued_on).slice(0,10),'2026-10-02');
 await assert.rejects(()=>act('PARTNER',{...et,etims_invoice_no:'ETIMS-000124'}),/already recorded for this invoice/);
 const invA3=await draft(P,{description:'Third fee',quantity:1,unit_price:500,vat_rate:16}),numA3=await post(invA3);
 await assert.rejects(()=>act('PARTNER',{...et,invoice_id:invA3}),/already recorded against another invoice/);
 await assert.rejects(()=>tx`update erp_private.invoice_etims set etims_invoice_no='CHANGED' where invoice_id=${invA}`,/./,'the reference cannot be edited');
});
