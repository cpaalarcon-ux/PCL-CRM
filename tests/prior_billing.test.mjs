// Billing brought over from the previous system: load file checks, two-person load, statement and receipts.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {default:ExcelJS}=await import('exceljs');
const {checkPriorBilling,clientKey,PRIOR_COLUMNS}=await import('../supabase/functions/staff-workspace-v12/prior-billing-rules.mjs');
const {priorBillingAction,priorBillingStage}=await import('../supabase/functions/staff-workspace-v12/prior-billing-actions.ts');
const {suiteAction}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const {areaForStaffAction}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
const H=PRIOR_COLUMNS,line=(o)=>H.map(h=>o[h]??''),rowsOf=list=>list.map((o,i)=>({row:i+2,values:o}));
const L=(kind,reference,client_name,total,extra={})=>({kind,reference,client_name,firm_code:kind==='Payment'?'':'PBQA',document_date:'2026-10-01',due_date:kind==='Invoice'?'2026-10-15':'',amount_before_vat:kind==='Payment'?'':Math.round(total/1.16*100)/100,vat:kind==='Payment'?'':Math.round((total-Math.round(total/1.16*100)/100)*100)/100,total,amount_still_due:'',previous_status:kind==='Payment'?'Reconciled':'Posted',reverses_invoice:'',method:kind==='Payment'?'Bank':'',...extra});

test('load file rules: every line is checked and one error stops the file',()=>{
 const clients=new Map([[clientKey('UAT Fictional Alpha Ltd'),'c1'],[clientKey('UAT Fictional Beta'),'c2'],[clientKey('UAT Fictional Twin'),null]]),firms=new Map([['PBQA','f1']]),ctx={clients,firms,today:'2026-11-27'};
 assert.equal(clientKey('  uat   fictional  alpha ltd '),'UAT FICTIONAL ALPHA LTD');
 const good=[L('Invoice','INV/T/001','uat fictional alpha ltd',11600,{amount_still_due:1600}),L('Invoice','INV/T/002','UAT Fictional Alpha Ltd',5800),L('Credit note','RINV/T/001','UAT Fictional Alpha Ltd',5800,{reverses_invoice:'INV/T/002'}),L('Payment','PAY/T/001','UAT Fictional Alpha Ltd',10000),L('Payment','PAY/T/002','UAT Fictional Beta',3000)];
 const ok=checkPriorBilling(rowsOf(good),ctx);assert.deepEqual(ok.errors,[]);assert.equal(ok.clean.length,5);
 assert.deepEqual([ok.summary.invoices,ok.summary.credit_notes,ok.summary.payments,ok.summary.invoiced,ok.summary.credited,ok.summary.paid,ok.summary.still_due,ok.summary.open_invoices,ok.summary.clients],[2,1,2,17400,5800,13000,1600,1,2]);
 // Alpha adds up (17,400 - 5,800 - 10,000 = 1,600 due). Beta paid 3,000 with no invoice: money on account, reported, not an error.
 assert.deepEqual(ok.summary.differences.map(d=>[d.client_name,d.difference,/on account/.test(d.meaning)]),[['UAT Fictional Beta',-3000,true]]);
 assert.deepEqual([ok.clean[0].client_id,ok.clean[0].firm_id,ok.clean[0].amount_due,ok.clean[3].firm_id,ok.clean[3].net_amount],['c1','f1',1600,'','']);
 const bad=(o,re)=>{const r=checkPriorBilling(rowsOf([o]),ctx);assert.equal(r.clean.length,0);assert.ok(r.errors.some(e=>re.test(e.message)),JSON.stringify(r.errors));};
 bad(L('Bill','X/001','UAT Fictional Beta',100),/Invoice, Credit note or Payment/);bad(L('Invoice','X/001','UAT Fictional Gamma',100),/No client named/);bad(L('Invoice','X/001','UAT Fictional Twin',100),/More than one client/);
 bad(L('Invoice','X/001','UAT Fictional Beta',100,{firm_code:'ZZZ'}),/not one of the firms/);bad(L('Invoice','X/001','UAT Fictional Beta',100,{firm_code:''}),/firm that issued/);
 bad(L('Invoice','X/001','UAT Fictional Beta',100,{document_date:'01/10/2026'}),/YYYY-MM-DD/);bad(L('Invoice','X/001','UAT Fictional Beta',100,{document_date:'2026-12-01'}),/future/);
 bad(L('Invoice','X/001','UAT Fictional Beta',100,{vat:99}),/does not equal the total/);bad(L('Invoice','X/001','UAT Fictional Beta',100,{amount_still_due:101}),/between zero and the total/);
 bad(L('Invoice','X/001','UAT Fictional Beta',-5),/greater than zero/);bad(L('Payment','X/001','UAT Fictional Beta',100,{vat:16}),/blank for a payment/);bad(L('Invoice','X/001','UAT Fictional Beta',100,{previous_status:''}),/status the document had/);
 let r=checkPriorBilling(rowsOf([L('Invoice','X/001','UAT Fictional Beta',100),L('Invoice','x/001','UAT Fictional Beta',100)]),ctx);assert.ok(r.errors.some(e=>/appears twice/.test(e.message)));
 r=checkPriorBilling(rowsOf([L('Invoice','X/001','UAT Fictional Beta',100)]),{...ctx,existing:new Set(['Invoice|X/001'])});assert.ok(r.errors.some(e=>/already loaded/.test(e.message)));
 r=checkPriorBilling(rowsOf([L('Credit note','R/1','UAT Fictional Beta',100,{reverses_invoice:'NOPE'})]),ctx);assert.ok(r.errors.some(e=>/not in the file/.test(e.message)));
 r=checkPriorBilling(rowsOf([L('Invoice','X/001','UAT Fictional Alpha Ltd',100),L('Credit note','R/1','UAT Fictional Beta',100,{reverses_invoice:'X/001'})]),ctx);assert.ok(r.errors.some(e=>/different client/.test(e.message)));
 // One bad line among good ones keeps nothing.
 r=checkPriorBilling(rowsOf([...good,L('Invoice','X/009','UAT Fictional Gamma',100)]),ctx);assert.equal(r.clean.length,0);assert.equal(r.summary,null);
 for(const a of ['prior_billing_batches','prior_billing_decide','prior_billing_client','prior_receipt_add','prior_receipt_reverse','prior_billing_stage'])assert.equal(areaForStaffAction(a),'billing_wip');
});

const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),C2=id(),P=id(),P2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>priorBillingAction(tx,a,p));
test('billing from the previous system: checked, staged by Finance, approved by someone else, then kept under each client',async t=>{
 t.after(()=>db.close());
 const boot=fs.readFileSync(path.join(root,'tests/client_lifecycle.test.mjs'),'utf8').split('\n').find(l=>l.includes('create role anon'));
 await eval('(async()=>{'+boot+'})()');
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PBQA','Fictional prior billing firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d+$/,''),full_name:'Fictional '+role};
  await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;
  await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${'PB'+role},${'prior-'+role.toLowerCase()},${a.full_name},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;
  await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;
  await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},${role==='ASSISTANT'?'Assigned':'Firm'})`;}
 const P=actors.PARTNER.staff_id,M=actors.MANAGER.staff_id,C=id(),C2=id();
 for(const [c,n] of [[C,'UAT Fictional Alpha Ltd'],[C2,'UAT Fictional Beta']]){await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${c},${n},${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;}
 const end=new Date(Date.now()+200*86400000).toISOString().slice(0,10);
 await as('PARTNER',()=>tx`select erp_private.staff_right_grant(${M}::uuid,'FINANCE','Fictional reason: keeps the firm billing records',${end}::date)`);
 const book=async rows=>{const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Prior billing');ws.addRow(H);for(const r of rows)ws.addRow(line(r));return Buffer.from(await wb.xlsx.writeBuffer());};
 const stage=async(role,rows,name='fictional_prior_billing.xlsx')=>{const f=new FormData();f.set('file',new File([await book(rows)],name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return as(role,a=>priorBillingStage(tx,a,f));};
 const good=[L('Invoice','INV/T/001','uat fictional alpha ltd',11600,{amount_still_due:1600}),L('Invoice','INV/T/002','UAT Fictional Alpha Ltd',5800),L('Credit note','RINV/T/001','UAT Fictional Alpha Ltd',5800,{reverses_invoice:'INV/T/002'}),L('Payment','PAY/T/001','UAT Fictional Alpha Ltd',10000),L('Invoice','INV/T/003','UAT Fictional Beta',2320,{amount_still_due:2320})];
 const docs=async()=>(await tx`select count(*)::int n from erp_private.prior_billing_documents`)[0].n;

 // 1. Only the Finance right stages a file. A file with one wrong line keeps nothing.
 for(const r of ['MANAGER2','SUPERVISOR','ASSISTANT'])await assert.rejects(()=>stage(r,good),/Finance right/);// a Partner holds the Finance right by rank
 const failed=await stage('MANAGER',[...good,L('Invoice','INV/T/009','UAT Fictional Nobody',100)]);
 assert.equal(failed.status,'VALIDATION_FAILED');assert.match(failed.errors[0].message,/No client named/);assert.equal((await tx`select count(*)::int n from erp_private.prior_billing_batches`)[0].n,0);

 // 2. A clean file is staged. Nothing is under the clients yet, and the same file cannot be staged twice.
 const st=await stage('MANAGER',good);assert.equal(st.status,'STAGED');assert.match(st.batch_ref,/^PB-\d{8}-[0-9A-F]{6}$/);assert.equal(st.summary.still_due,3920);
 assert.equal(await docs(),0);await assert.rejects(()=>stage('MANAGER',good),/already staged/);
 const list=await act('MANAGER2',{action:'prior_billing_batches'});assert.equal(list.batches[0].status,'Staged');assert.equal(list.can_stage,false);assert.equal(list.can_decide,false);
 for(const r of ['SUPERVISOR','ASSISTANT'])await assert.rejects(()=>act(r,{action:'prior_billing_batches'}),/do not have access/);

 // 3. Approval is by a different Manager or Partner; the stager cannot approve or discard their own file.
 const decide=(role,decision,note='')=>act(role,{action:'prior_billing_decide',batch_ref:st.batch_ref,decision,note});
 for(const r of ['MANAGER','MANAGER2','SUPERVISOR'])await assert.rejects(()=>decide(r,'Approve'),/Only a Partner/);await assert.rejects(()=>decide('MANAGER2','Discard','Staged by mistake today'),/Only a Partner/);await assert.rejects(()=>decide('PARTNER','Discard','short'),/at least 10 characters/);
 const done=await decide('PARTNER','Approve','Agreed to the Odoo aged list');assert.deepEqual([done.status,done.documents],['Loaded',5]);assert.equal(await docs(),5);
 await assert.rejects(()=>decide('PARTNER','Approve'),/already loaded/);await assert.rejects(()=>stage('MANAGER',good),/already loaded/);
 // The same documents cannot come in again from a different file.
 const again=await stage('MANAGER',[L('Invoice','inv/t/001','UAT Fictional Alpha Ltd',11600)],'another.xlsx');assert.equal(again.status,'VALIDATION_FAILED');assert.match(again.errors[0].message,/already loaded/);

 // 4. Loaded records are frozen, even for the database owner.
 await assert.rejects(()=>tx`update erp_private.prior_billing_documents set total_amount=1 where reference='INV/T/001'`,/kept as loaded/);await assert.rejects(()=>tx`delete from erp_private.prior_billing_documents`,/kept as loaded/);

 // 5. Under the client: documents, what is still owed, and nothing for people without the right to see billing.
 let view=await act('MANAGER2',{action:'prior_billing_client',client_id:C});
 assert.deepEqual(view.totals,{invoiced:17400,credited:5800,paid_before:10000,received_here:0,outstanding:1600});assert.equal(view.documents.length,4);assert.equal(view.can_receipt,false);
 assert.equal((await as('SUPERVISOR',()=>tx`select * from erp_private.prior_billing_documents`)).length,0);await assert.rejects(()=>act('ASSISTANT',{action:'prior_billing_client',client_id:C}),/do not have access/);
 const inv1=view.documents.find(d=>d.reference==='INV/T/001'),inv2=view.documents.find(d=>d.reference==='INV/T/002'),cn=view.documents.find(d=>d.kind==='Credit note');

 // 6. Receipts against an old invoice: Finance only, never more than is owed, numbered from the firm's receipt sequence, reversible with a reason.
 const receipt=(role,doc,amount,extra={})=>act(role,{action:'prior_receipt_add',doc_id:doc,amount,payment_date:new Date().toISOString().slice(0,10),method:'M-Pesa',reference:'FICT123',request_id:id(),...extra});
 await assert.rejects(()=>receipt('MANAGER2',inv1.doc_id,500),/Finance right/);await assert.rejects(()=>receipt('MANAGER',inv1.doc_id,1600.01),/Only 1600.00 is still owed/);
 await assert.rejects(()=>receipt('MANAGER',inv2.doc_id,10),/Only 0.00 is still owed/);await assert.rejects(()=>receipt('MANAGER',cn.doc_id,10),/against an invoice/);
 await assert.rejects(()=>receipt('MANAGER',inv1.doc_id,100,{payment_date:'2026-09-01'}),/on or after the invoice date/);
 const req=id(),r1=await receipt('MANAGER',inv1.doc_id,1000,{request_id:req});assert.match(r1.receipt_number,/^REC\/PBQA\/\d{4}\/00001$/);
 assert.deepEqual(await receipt('MANAGER',inv1.doc_id,1000,{request_id:req}),r1,'the same request is not recorded twice');
 await assert.rejects(()=>receipt('MANAGER',inv1.doc_id,600.01),/Only 600.00 is still owed/);const r2=await receipt('MANAGER',inv1.doc_id,600);
 view=await act('MANAGER',{action:'prior_billing_client',client_id:C});assert.equal(view.totals.outstanding,0);assert.equal(view.totals.received_here,1600);
 const reverse=(role,rid,reason)=>act(role,{action:'prior_receipt_reverse',receipt_id:rid,reason,request_id:id()});
 await assert.rejects(()=>reverse('MANAGER',r2.receipt_id,'short'),/at least 10 characters/);const rv=await reverse('MANAGER',r2.receipt_id,'Bank returned the transfer');
 await assert.rejects(()=>reverse('MANAGER',r2.receipt_id,'Trying to reverse it twice'),/already reversed/);await assert.rejects(()=>reverse('MANAGER',rv.receipt_id,'Reversing the reversal itself'),/cannot itself be reversed/);
 view=await act('MANAGER',{action:'prior_billing_client',client_id:C});assert.equal(view.totals.outstanding,600);assert.equal(view.receipts.length,3);
 await assert.rejects(()=>tx`delete from erp_private.prior_billing_receipts`,/kept as loaded/);

 // 7. The client statement carries the previous-system documents and the receipts in one running balance.
 const stmt=await as('PARTNER',a=>suiteAction(tx,a,{action:'statement',client_id:C,starts_on:'2026-01-01',ends_on:new Date().toISOString().slice(0,10)}));
 assert.equal(stmt.closing,600);assert.ok(stmt.rows.some(r=>r.reference==='Odoo INV/T/001'&&Number(r.debit)===11600));assert.ok(stmt.rows.some(r=>/Previous-system credit note for INV\/T\/002/.test(r.description)&&Number(r.credit)===5800));
 assert.ok(stmt.rows.some(r=>r.reference===r1.receipt_number&&Number(r.credit)===1000));assert.equal(stmt.rows.length,7);
 // A payment with no firm is left out when one firm is chosen, so the firm view shows what that firm billed and received here.
 const byFirm=await as('PARTNER',a=>suiteAction(tx,a,{action:'statement',client_id:C,firm_id:F,starts_on:'2026-01-01',ends_on:new Date().toISOString().slice(0,10)}));assert.equal(byFirm.rows.length,6);assert.equal(byFirm.closing,10600);

 // A Partner who staged a file cannot decide it either.
 const own=await stage('PARTNER',[L('Invoice','INV/T/070','UAT Fictional Beta',1160)],'partner.xlsx');
 await assert.rejects(()=>act('PARTNER',{action:'prior_billing_decide',batch_ref:own.batch_ref,decision:'Approve'}),/different Partner approves/);await assert.rejects(()=>act('PARTNER',{action:'prior_billing_decide',batch_ref:own.batch_ref,decision:'Discard',note:'Staged by mistake today'}),/different Partner discards/);
 // 8. A staged file can be discarded by someone else, with a reason, and then staged again.
 const st2=await stage('MANAGER',[L('Invoice','INV/T/050','UAT Fictional Beta',1160,{amount_still_due:1160})],'second.xlsx');
 assert.equal((await act('PARTNER',{action:'prior_billing_decide',batch_ref:st2.batch_ref,decision:'Discard',note:'Wrong month was exported'})).status,'Discarded');assert.equal(await docs(),5);
 assert.equal((await stage('MANAGER',[L('Invoice','INV/T/050','UAT Fictional Beta',1160,{amount_still_due:1160})],'second.xlsx')).status,'STAGED');
});
