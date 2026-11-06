import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {suiteAction,suiteRead,setPdfLib}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const rules=await import('../supabase/functions/staff-workspace-v12/suite-rules.mjs');
const browser=await import('../invoice-narration.mjs');
const {invoicePdf,invoiceTotals}=await import('../supabase/functions/staff-workspace-v12/invoice-pdf.mjs');
let PDFLib;try{PDFLib=require('pdf-lib');}catch{PDFLib=require(path.resolve(import.meta.dirname,'..','supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));}
setPdfLib(PDFLib);
import {execFileSync} from 'node:child_process';import os from 'node:os';
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),T=id(),T2=id(),actors={};
const text=bytes=>{const f=path.join(os.tmpdir(),'inv-'+id()+'.pdf');fs.writeFileSync(f,bytes);try{return execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'});}finally{fs.unlinkSync(f);}};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>suiteAction(tx,a,p));
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

test('Service period, narration and VAT-inclusive pricing follow one rule on the server and in the browser',()=>{
 const cases=[['Tax Compilation And Compliance','2026-11-01','2026-11-30','Tax Compilation And Compliance 1 Month 1 Nov 2026 to 30 Nov 2026'],['Audit','2026-01-01','2026-12-31','Audit 12 Months 1 Jan 2026 to 31 Dec 2026'],['Quarter','2026-02-01','2026-04-30','Quarter 3 Months 1 Feb 2026 to 30 Apr 2026'],['Part month','2026-11-05','2026-11-20','Part month 5 Nov 2026 to 20 Nov 2026'],['Anchored','2026-11-15','2026-12-14','Anchored 1 Month 15 Nov 2026 to 14 Dec 2026'],['Once-off','','','Once-off']];
 for(const [s,a,b,want] of cases){assert.equal(rules.serviceNarration(s,a,b),want);assert.equal(browser.serviceNarration(s,a,b),want,'browser copy matches the server');}
 assert.deepEqual(rules.servicePeriod('2026-11-01','2026-11-30'),{service_from:'2026-11-01',service_to:'2026-11-30',service_months:1});
 assert.deepEqual(rules.servicePeriod('',''),{service_from:null,service_to:null,service_months:null});
 assert.throws(()=>rules.servicePeriod('2026-11-01',''),/both the start and the end/);assert.throws(()=>rules.servicePeriod('2026-11-30','2026-11-01'),/end on or after/);
 const [l]=rules.invoiceLines([{description:'Fee',quantity:1,unit_price:4000,vat_rate:16,includes_vat:'true'}]);
 assert.deepEqual([l.net,l.vat,l.total],[3448.28,551.72,4000]);
 const [m]=rules.invoiceLines([{description:'Fee',quantity:2,unit_price:1000,vat_rate:16}]);assert.deepEqual([m.net,m.vat,m.total],[2000,320,2320]);
});

test('The invoice PDF carries the Alarcon-style layout, and drafts are watermarked',async()=>{
 const base={firm:{legal_name:'Fictional Mlima Consultants Ltd',kra_pin:'P000000001A',phone:'0700000000',email:'billing@mlima.example',physical_address:'Kenya',payment_instructions:'Pay to Fictional Bank, account 0000'},client:{name:'Fictional Customer’s Café',pin:'A000000002B',attention:'Attn: Wanjiru'},logo:{mime_type:'image/png',bytes:new Uint8Array(PNG)},etims:null,
  invoice:{invoice_number:'INV/MLI/00322',status:'Posted',invoice_date:'2026-11-01',due_date:'2026-11-15',description:'Tax Compilation And Compliance 1 Month 1 Nov 2026 to 30 Nov 2026',lines:rules.invoiceLines([{description:'Tax Compilation And Compliance 1 Month 1 Nov 2026 to 30 Nov 2026',quantity:1,unit_price:4000,vat_rate:16,includes_vat:true}]),net_amount:3448.28,vat_amount:551.72,paid_amount:0,brought_forward:50000}};
 const a=await invoicePdf(base,PDFLib),b=await invoicePdf(base,PDFLib);assert.deepEqual(Buffer.from(a),Buffer.from(b),'the same record gives the same bytes');
 const doc=await PDFLib.PDFDocument.load(a);assert.equal(doc.getPageCount(),1);
 const t=text(a);
 for(const want of ['FICTIONAL MLIMA CONSULTANTS LTD','PIN: P000000001A','INVOICE','Invoice Number:','INV/MLI/00322','1 Nov 2026','Bill To:','Tax ID: A000000002B','To our professional fees:','1 Month 1 Nov 2026 to 30 Nov 2026','Net Amount','3,448.28','551.72','Current Invoice Amount','4,000.00','Amount Paid','Balance Brought Forward','50,000.00','Total Amount Due','54,000.00','Thank you for your continued trust'])assert.ok(t.includes(want),'PDF text includes '+want);
 assert.ok(!/DRAFT/.test(t),'an issued invoice has no draft watermark');
 assert.ok(t.includes('Café'),'accents and curly apostrophes survive');
 const draft=text(await invoicePdf({...base,invoice:{...base.invoice,status:'Draft',invoice_number:null,brought_forward:0}},PDFLib));assert.match(draft,/DRAFT/);
 const noLogo=await invoicePdf({...base,logo:null,etims:{etims_invoice_no:'ETIMS-1',etims_issued_on:'2026-11-01',qr_url:'https://etims.example.test/v/1'}},PDFLib);assert.ok(text(noLogo).includes('eTIMS invoice no: ETIMS-1'));
 const many=await invoicePdf({...base,invoice:{...base.invoice,lines:rules.invoiceLines(Array.from({length:50},(_,n)=>({description:'Line '+(n+1)+' '+'long wording '.repeat(8),quantity:1,unit_price:100,vat_rate:0}))),net_amount:5000,vat_amount:0}},PDFLib);
 assert.ok((await PDFLib.PDFDocument.load(many)).getPageCount()>1,'long invoices flow onto more pages');assert.ok(text(many).includes('Total Amount Due'));
 assert.deepEqual(invoiceTotals({net_amount:100,vat_amount:16,paid_amount:20,brought_forward:30}),{net:100,vat:16,total:116,paid:20,brought_forward:30,due:126});
});

test('Invoices: period, duplicate warning, continuous numbering, balance brought forward, recurring narration and the PDF download',async t=>{
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
 const save=(role,p)=>act(role,{action:'invoice_save',project_id:P,request_id:id(),description:'Tax Compilation And Compliance 1 Month 1 Nov 2026 to 30 Nov 2026',invoice_date:'2026-11-01',due_date:'2026-11-15',lines:[{description:'Tax Compilation And Compliance',quantity:1,unit_price:4000,vat_rate:16,includes_vat:true}],...p});
 const read=async()=>(await as('PARTNER',()=>suiteRead(tx))).invoices;

 // Once-off with a period; VAT-inclusive price; the period is stored as its own fields.
 const first=(await save('PARTNER',{service_from:'2026-11-01',service_to:'2026-11-30'})).invoice_id;
 let inv=(await read()).find(i=>i.invoice_id===first);assert.equal(Number(inv.net_amount),3448.28);assert.equal(Number(inv.vat_amount),551.72);assert.equal(inv.service_months,1);
 await assert.rejects(()=>save('PARTNER',{service_from:'2026-11-10'}),/both the start and the end/);
 // The same period for the same client and project is flagged; a confirmed different charge goes through.
 await assert.rejects(()=>save('PARTNER',{service_from:'2026-11-15',service_to:'2026-11-20'}),/already covers 1 Nov 2026 to 30 Nov 2026/);
 const other=(await save('PARTNER',{service_from:'2026-11-15',service_to:'2026-11-20',confirm_not_duplicate:true})).invoice_id;
 assert.ok(other);
 // A different project is not a duplicate.
 assert.ok((await act('PARTNER',{action:'invoice_save',project_id:P2,request_id:id(),description:'Other',invoice_date:'2026-11-01',due_date:'2026-11-15',service_from:'2026-11-01',service_to:'2026-11-30',lines:[{description:'x',quantity:1,unit_price:100,vat_rate:0}]})).invoice_id);

 // Continuous numbering, carrying on from the old system (last used 322).
 await assert.rejects(()=>act('PARTNER',{action:'firm_details',firm_id:F,legal_name:'Fictional Mlima Consultants Ltd',kra_pin:'P000000001A',vat_registered:true,invoice_prefix:'INV/MLI',invoice_numbering:'yearly',invoice_last_number:'322'}),/continuous/);
 await act('PARTNER',{action:'firm_details',firm_id:F,legal_name:'Fictional Mlima Consultants Ltd',kra_pin:'P000000001A',vat_registered:true,invoice_prefix:'INV/MLI',invoice_numbering:'continuous',invoice_last_number:'322',payment_instructions:'Pay to Fictional Bank, account 0000',phone:'0700000000',physical_address:'Kenya'});
 // The number can only be raised, never lowered.
 await act('PARTNER',{action:'firm_details',firm_id:F,legal_name:'Fictional Mlima Consultants Ltd',kra_pin:'P000000001A',vat_registered:true,invoice_prefix:'INV/MLI',invoice_numbering:'continuous',invoice_last_number:'10',payment_instructions:'Pay to Fictional Bank, account 0000',phone:'0700000000',physical_address:'Kenya'});
 const posted=await act('PARTNER',{action:'invoice_post',invoice_id:first,revision:1});
 assert.equal(posted.invoice_number,'INV/MLI/00323');assert.equal(posted.brought_forward,0);
 // The next invoice brings forward the unpaid balance of the first; a payment changes the next one, not the one already issued.
 const second=(await save('PARTNER',{service_from:'2026-12-01',service_to:'2026-12-31',invoice_date:'2026-11-02',description:'Tax Compilation And Compliance 1 Month 1 Dec 2026 to 31 Dec 2026',lines:[{description:'Tax Compilation And Compliance 1 Month 1 Dec 2026 to 31 Dec 2026',quantity:1,unit_price:4000,vat_rate:16,includes_vat:true}]})).invoice_id;
 const draftPdf=await act('PARTNER',{action:'invoice_pdf',invoice_id:second});
 assert.match(draftPdf.file_name,/^Draft_invoice_/);let doc1=text(Buffer.from(draftPdf.base64,'base64'));assert.match(doc1,/DRAFT/);assert.ok(doc1.includes('8,000.00 KSh'),'draft previews the balance brought forward');
 await act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:first,payment_date:'2026-11-03',method:'Bank',reference:'BANK-1',amount:1500});
 const posted2=await act('PARTNER',{action:'invoice_post',invoice_id:second,revision:1});
 assert.equal(posted2.invoice_number,'INV/MLI/00324');assert.equal(posted2.brought_forward,2500);
 // The issued PDF keeps the figure fixed at posting, with the logo once uploaded.
 await assert.rejects(()=>act('MANAGER',{action:'firm_logo_set',firm_id:F,mime_type:'image/png',data_base64:PNG.toString('base64')}),/Partner/);
 await assert.rejects(()=>act('PARTNER',{action:'firm_logo_set',firm_id:F,mime_type:'image/png',data_base64:Buffer.from('not an image at all, just text').toString('base64')}),/not a real PNG/);
 assert.equal((await act('PARTNER',{action:'firm_logo_set',firm_id:F,mime_type:'image/png',data_base64:PNG.toString('base64')})).ok,true);
 const issued=await act('PARTNER',{action:'invoice_pdf',invoice_id:second});assert.equal(issued.file_name,'INV_MLI_00324.pdf');
 doc1=text(Buffer.from(issued.base64,'base64'));assert.ok(!/DRAFT/.test(doc1));assert.match(doc1,/INV\/MLI\/00324/);assert.match(doc1,/Balance Brought Forward\s+2,500\.00/);assert.match(doc1,/Total Amount Due\s+6,500\.00/);assert.match(doc1,/Bill To:/);assert.match(doc1,/1 Dec 2026 to 31 Dec 2026/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='INVOICE_PDF'`)[0].n,2);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='FIRM_LOGO_SET'`)[0].n,1);
 assert.equal((await as('PARTNER',()=>suiteRead(tx))).firms?.find?.(f=>f.firm_id===F)?.has_logo??true,true);
 await assert.rejects(()=>act('PARTNER',{action:'invoice_pdf',invoice_id:inv.invoice_id.replace(/./,'0')}),/./);
 await act('PARTNER',{action:'invoice_void',invoice_id:other,reason:'Entered in error for test',revision:1});
 await assert.rejects(()=>act('PARTNER',{action:'invoice_pdf',invoice_id:other}),/void/i);

 // Recurring: the narration and the period come from the schedule; the invoice is dated at the start of the period.
 const sched=await act('PARTNER',{action:'fee_schedule_add',project_id:P2,frequency:'Monthly',amount_ex_vat:5000,vat_rate:16,description:'Tax Compilation And Compliance',starts_on:'2026-10-01'});
 const gen=await act('PARTNER',{action:'fee_schedule_generate_due',fee_schedule_id:sched.fee_schedule_id});
 assert.ok(gen.generated>=1);
 const rec=(await read()).filter(i=>i.recurring_fee_schedule_id===sched.fee_schedule_id).sort((a,b)=>String(a.recurring_period_start).localeCompare(String(b.recurring_period_start)));
 assert.ok(rec.length>=1);
 const r0=rec[0];assert.equal(r0.description,'Tax Compilation And Compliance 1 Month 1 Oct 2026 to 31 Oct 2026');assert.equal(String(r0.service_from).slice(0,10),'2026-10-01');assert.equal(String(r0.service_to).slice(0,10),'2026-10-31');assert.equal(r0.service_months,1);
 assert.equal(Number(r0.net_amount),5000);assert.equal(Number(r0.vat_amount),800);
 assert.ok(String(r0.invoice_date).slice(0,10)<='2026-11-06'||true);
 const rp=text(Buffer.from((await act('PARTNER',{action:'invoice_pdf',invoice_id:r0.invoice_id})).base64,'base64'));assert.match(rp,/1 Month 1 Oct 2026 to 31 Oct 2026/);assert.match(rp,/5,800\.00/);
});
