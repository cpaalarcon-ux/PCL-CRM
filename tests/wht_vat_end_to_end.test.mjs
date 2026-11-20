import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {whtVatAction}=await import('../supabase/functions/staff-workspace-v12/wht-vat-actions.ts'),{creditAction}=await import('../supabase/functions/staff-workspace-v12/credit-actions.ts'),{kraCsvAction}=await import('../supabase/functions/staff-workspace-v12/kra-csv-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>whtVatAction(tx,a,p)),cred=(role,p)=>as(role,a=>creditAction(tx,a,p)),csv=(role,p)=>as(role,a=>kraCsvAction(tx,a,p));
test("withholding VAT: certificate lines, the claim gate and the agent schedule",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${F2},'V3OTHER','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Fictional hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 // The client KYC, letter and opening gates have their own tests; here only the eligibility trigger is under test.
 for(const g of ['projects_guard','entity_activation','b_client_lifecycle_project_guard','zz_opening_gate'])await db.exec(`alter table erp_private.projects disable trigger ${g}`);
 const iso=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
 const M=actors.MANAGER.staff_id,AS=actors.ASSISTANT.staff_id;
 await tx`update erp_private.clients set kra_pin='P051234567Z' where client_id=${C}`;
 const rowB=(pin,date,inv,net,vat)=>[pin,'Fictional customer','CU1',date,inv,'Goods',net,vat,'',''].join(',');
 const rowF=(pin,date,inv,net,vat)=>['1',pin,'Fictional supplier',date,inv,'Goods','',net,vat,'',''].join(',');
 const rowH=(pin,date,inv,net)=>['1',pin,'Fictional zero-rated supplier',date,inv,'','Export services','',net].join(',');
 const up=(file,text,month='2026-10')=>csv('ASSISTANT',{action:'kra_csv_upload',project_id:P,month,file_name:file,csv_text:text});

 // ---- Supplier side: the certificate lines and the claim gate
 const credit=(await cred('ASSISTANT',{action:'tax_credit_add',project_id:P,credit_type:'WHT_VAT',period_start:'2026-10-01',period_end:'2026-10-31',source_reference:'WHT-CERT-0001',erp_amount:480})).credit_id;
 await up('PIN_SEC_B_WITH_VAT_PIN1.CSV',rowB('P051234567Z','03/10/2026','000123','1000.00','160.00')+'\n');
 const line=(o={})=>act('ASSISTANT',{action:'whtvat_certificate_line',project_id:P,credit_id:credit,withholder_pin:'P000111222K',withholder_name:'Fictional Customer Ltd',certificate_no:'C-77',certificate_date:'2026-10-20',invoice_no:'000123',invoice_date:'2026-10-03',invoice_net:1000,vat_withheld:200,...o});
 await assert.rejects(()=>line({withholder_pin:'bad'}),/KRA format/);
 await assert.rejects(()=>line({withholder_pin:'P051234567Z'}),/cannot be the taxpayer/);
 await assert.rejects(()=>line({certificate_date:'2026-10-01'}),/cannot be dated before the invoice/);
 await assert.rejects(()=>line({vat_withheld:0}),/above zero/);
 await assert.rejects(()=>as('INTERN',a=>whtVatAction(tx,a,{action:'whtvat_certificate_line',project_id:P,credit_id:credit})),/staff preparers/);
 const l1=await line();assert.equal(l1.linked_total,200);
 await assert.rejects(()=>line(),/already linked/);
 await assert.rejects(()=>line({invoice_no:'000555',vat_withheld:300}),/more than the credit/);
 let rd=await act('ASSISTANT',{action:'whtvat_read',project_id:P,month:'2026-10'});
 let cs=rd.credits.find(c=>c.credit_id===credit).state;
 assert.equal(cs.complete,false);assert.equal(cs.difference,280);assert.match(cs.problems[0],/differs from the credit/);assert.equal(cs.csv_checked,true);assert.deepEqual(cs.not_in_sales_csv,[]);
 const l2=await line({invoice_no:'000999',invoice_date:'2026-10-09',invoice_net:1400,vat_withheld:280});assert.equal(l2.linked_total,480);
 rd=await act('ASSISTANT',{action:'whtvat_read',project_id:P,month:'2026-10'});cs=rd.credits.find(c=>c.credit_id===credit).state;
 assert.equal(cs.complete,true);assert.deepEqual(cs.not_in_sales_csv,['000999'],'an invoice that is not in the retained sales CSV is shown, not blocked');
 assert.equal(rd.credits[0].lines[0].invoice_no,'000123','invoice numbers stay text with their leading zeros');
 // The claim gate: iTax agrees, the lines are complete, then it can be claimed; changing the lines while claimed is refused.
 const rev=async x=>(await cred('MANAGER',{action:'tax_credit_list',project_id:P})).credits.find(c=>c.credit_id===x).revision;
 const CASE=id();await tx`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by) values(${CASE},${P},'VAT','2026-10-01','2026-10-31',${AS})`;
 await cred('MANAGER',{action:'tax_credit_itax',credit_id:credit,revision:await rev(credit),itax_amount:480});
 const credit2=(await cred('ASSISTANT',{action:'tax_credit_add',project_id:P,credit_type:'WHT_VAT',period_start:'2026-10-01',period_end:'2026-10-31',source_reference:'WHT-CERT-0002',erp_amount:50})).credit_id;
 await cred('MANAGER',{action:'tax_credit_itax',credit_id:credit2,revision:await rev(credit2),itax_amount:50});

 await assert.rejects(async()=>cred('ASSISTANT',{action:'tax_credit_claim',credit_id:credit2,revision:await rev(credit2),case_id:CASE}),/No sales invoices are linked/);
 await cred('ASSISTANT',{action:'tax_credit_claim',credit_id:credit,revision:await rev(credit),case_id:CASE});
 await assert.rejects(()=>line({invoice_no:'000777',vat_withheld:1}),/Release the credit/);
 await assert.rejects(()=>tx`update erp_private.wht_vat_certificate_lines set vat_withheld=1`,/never edited/);
 await assert.rejects(()=>tx`delete from erp_private.wht_vat_certificate_lines`,/./);
 await cred('ASSISTANT',{action:'tax_credit_release',credit_id:credit,revision:await rev(credit)});

 // ---- Agent side: no rate means no line; the rate is read from the rule in force on the payment date
 await up('PIN_SEC_F_WITH_VAT_PIN1.CSV',rowF('P000000001A','06/10/2026','0001','1000.00','160.00')+'\n'+rowF('P000000002B','07/10/2026','0002','333.33','53.33')+'\n');
 await up('PIN_SEC_H_ZERO_PIN1.CSV',rowH('P000000003C','08/10/2026','0003','500.00')+'\n');
 const add=(o={})=>act('ASSISTANT',{action:'whtvat_agent_add',project_id:P,payment_date:'2026-11-05',evidence_reference:'Bank advice 2026-11-05, fictional',...o});
 rd=await act('ASSISTANT',{action:'whtvat_read',project_id:P,month:'2026-11'});
 assert.match(rd.rate.error,/no approved withholding VAT rate/);
 const csvLines=rd.candidates;assert.deepEqual(csvLines.map(l=>l.invoice_no).sort(),['0001','0002'],'zero-rated and exempt lines are not offered');
 await assert.rejects(()=>add({csv_line_id:csvLines.find(l=>l.invoice_no==='0001').line_id}),/no approved withholding VAT rate covering 2026-11-05/);
 const rule=(from,to,rate)=>tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,created_by,status,approved_by,approved_at) values('KE_WHTVAT_AGENT','VAT','Withholding VAT agent (staging rule)',${from},${to},${tx.json({rate,treatment:'Withholding VAT agent'})},'https://www.kra.go.ke/','Fictional staging rule for the test.',${M},'Approved',${actors.PARTNER.staff_id},now())`;
 await rule('2026-01-01','2026-12-31',2);
 const a1=await add({csv_line_id:csvLines.find(l=>l.invoice_no==='0001').line_id});
 assert.deepEqual([a1.rate,a1.vat_withheld,a1.whole_shillings,a1.basis],[2,20,20,'KRA purchases CSV']);
 const a2=await add({csv_line_id:csvLines.find(l=>l.invoice_no==='0002').line_id});
 assert.deepEqual([a2.vat_withheld,a2.whole_shillings],[6.67,7],'the cent is kept in the ledger; the KRA layout rounds up to the shilling');
 await assert.rejects(()=>add({csv_line_id:csvLines.find(l=>l.invoice_no==='0001').line_id}),/already on an active schedule line/);
 // Manual lines: the CSV decides when it knows the invoice; otherwise the preparer must say the invoice carries VAT.
 await assert.rejects(()=>add({supplier_pin:'P000000003C',supplier_name:'x supplier',invoice_no:'0003',invoice_date:'2026-10-08',invoice_net:500}),/zero-rated/);
 await assert.rejects(()=>add({supplier_pin:'P000000009Z',supplier_name:'Fictional Trader',invoice_no:'M-1',invoice_date:'2026-10-09',invoice_net:100.5}),/Confirm that you have seen the supplier invoice/);
 await assert.rejects(()=>add({supplier_pin:'P051234567Z',supplier_name:'Fictional Trader',invoice_no:'M-1',invoice_date:'2026-10-09',invoice_net:100.5,vat_charged_confirmed:true}),/taxpayer's own PIN/);
 await assert.rejects(()=>add({supplier_pin:'P000000009Z',supplier_name:'Fictional Trader',invoice_no:'M-1',invoice_date:'2026-11-09',invoice_net:100.5,payment_date:'2026-11-01',vat_charged_confirmed:true}),/cannot be after the payment date/);
 await assert.rejects(()=>add({supplier_pin:'P000000009Z',supplier_name:'Fictional Trader',invoice_no:'M-1',invoice_date:'2026-10-09',invoice_net:0,vat_charged_confirmed:true}),/above zero/);
 await assert.rejects(()=>add({csv_line_id:csvLines[0].line_id,evidence_reference:'x'}),/at least 3 characters/);
 const m1=await add({supplier_pin:'P000000009Z',supplier_name:'Fictional Trader',invoice_no:'M-1',invoice_date:'2026-10-09',invoice_net:100.5,vat_charged_confirmed:true});
 assert.deepEqual([m1.vat_withheld,m1.whole_shillings,m1.basis],[2.01,3,'Invoice sighted']);
 await assert.rejects(()=>add({supplier_pin:'P000000009Z',supplier_name:'Fictional Trader',invoice_no:'m-1',invoice_date:'2026-10-09',invoice_net:100.5,vat_charged_confirmed:true}),/already scheduled/);
 // A later rule applies from its own date; the earlier lines keep the rate they were made with.
 await rule('2027-01-01','2027-12-31',3);
 const m2=await add({supplier_pin:'P000000008Y',supplier_name:'Fictional Trader Two',invoice_no:'M-2',invoice_date:'2026-12-20',invoice_net:1000,payment_date:'2027-01-10',vat_charged_confirmed:true});
 assert.deepEqual([m2.rate,m2.vat_withheld],[3,30]);
 rd=await act('ASSISTANT',{action:'whtvat_read',project_id:P,month:'2026-11'});
 assert.deepEqual(rd.schedule.map(l=>[l.invoice_no,l.rate,l.vat_withheld]),[['0001',2,20],['0002',2,6.67],['M-1',2,2.01]]);
 assert.deepEqual([rd.schedule_totals.active,rd.schedule_totals.exact,rd.schedule_totals.whole],[3,28.68,30]);
 assert.equal(rd.rate.rate,2);assert.equal(rd.candidates.length,0,'scheduled invoices drop out of the list');
 assert.equal((await act('ASSISTANT',{action:'whtvat_read',project_id:P,month:'2027-01'})).schedule.length,1);

 // Nothing is edited: a mistaken line is voided with a reason and can be entered again.
 await assert.rejects(()=>tx`update erp_private.wht_vat_agent_lines set invoice_net=1`,/never edited/);
 await assert.rejects(()=>tx`delete from erp_private.wht_vat_agent_lines`,/./);
 await assert.rejects(()=>act('ASSISTANT',{action:'whtvat_agent_void',project_id:P,line_id:a2.line_id,reason:'wrong'}),/at least 10 characters/);
 await act('ASSISTANT',{action:'whtvat_agent_void',project_id:P,line_id:a2.line_id,reason:'Paid on a later date; re-entered correctly.'});
 await assert.rejects(()=>act('ASSISTANT',{action:'whtvat_agent_void',project_id:P,line_id:a2.line_id,reason:'Paid on a later date; again.'}),/already voided/);
 await assert.rejects(()=>tx`update erp_private.wht_vat_agent_lines set status='Active' where line_id=${a2.line_id}`,/closed/);
 assert.ok((await act('ASSISTANT',{action:'whtvat_read',project_id:P,month:'2026-11'})).candidates.some(l=>l.invoice_no==='0002'),'a voided line frees its invoice');
 await add({csv_line_id:csvLines.find(l=>l.invoice_no==='0002').line_id,payment_date:'2026-11-12'});

 // The export: sections A and B, whole shillings, never the ledger cent; an audit record is written.
 const ex=await act('ASSISTANT',{action:'whtvat_agent_export',project_id:P,month:'2026-11'});
 assert.match(ex.name,/^WHT_VAT_Schedule_2026-11_/);assert.equal(Buffer.from(ex.base64,'base64').subarray(0,2).toString(),'PK');
 assert.ok(ex.issues.some(i=>/vouchers the ERP does not hold/.test(i)));
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where table_name='exports' and action='DOWNLOAD' and after_values->>'kind'='WHTVAT'`)[0].n,1);

 // Isolation and structure.
 await assert.rejects(()=>act('INTERN',{action:'whtvat_read',project_id:P,month:'2026-11'}),/staff preparers/);
 for(const tbl of ['wht_vat_certificate_lines','wht_vat_agent_lines'])assert.deepEqual((await tx`select relrowsecurity,relforcerowsecurity from pg_class where oid=('erp_private.'||${tbl})::regclass`)[0],{relrowsecurity:true,relforcerowsecurity:true});
});
