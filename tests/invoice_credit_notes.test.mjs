import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {suiteAction,suiteRead,setPdfLib}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
let PDFLib;try{PDFLib=require('pdf-lib');}catch{PDFLib=require(path.resolve(import.meta.dirname,'..','supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));}
setPdfLib(PDFLib);
import {defaultActionRights,rightsForRequest} from '../staff-action-rights.mjs';
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),T=id(),T2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>suiteAction(tx,a,p)),num=x=>Number(x);

test('Credit notes: prepared by a Manager, issued by a Partner, never beyond what the client owes',async t=>{
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
 const post=async inv=>{const rev=async()=>(await tx`select revision from erp_private.invoices where invoice_id=${inv}`)[0].revision,o={override_reason:'Fictional test: one Partner prepares, checks and posts'};await act('PARTNER',{action:'invoice_submit',invoice_id:inv,revision:await rev()});await act('PARTNER',{action:'invoice_check',decision:'pass',invoice_id:inv,revision:await rev(),...o});return (await act('PARTNER',{action:'invoice_post',invoice_id:inv,revision:await rev(),...o})).invoice_number;};

 await tx`insert into erp_private.staff_capabilities(staff_id,capability) values(${actors.MANAGER.staff_id},'FINANCE')`;
 const sav=(role,inv,lines,o={})=>act(role,{action:'credit_note_save',invoice_id:inv,request_id:id(),reason_code:'Billing error',reason:'Fictional billing error',lines,...o});
 const cn=async cid=>(await tx`select * from erp_private.invoice_credit_notes where credit_note_id=${cid}`)[0];
 const rev=async cid=>String((await cn(cid)).revision);
 const run=async(role,action,cid,o={})=>act(role,{action,credit_note_id:cid,revision:await rev(cid),...o});
 const credited=async i=>num((await tx`select erp_private.invoice_credited(${i}) c`)[0].c);
 const tdy=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 // ---- invoices to credit -----------------------------------------------------------------------------------------------------------------------------------
 const invA=await draft(P,{description:'Return filing',quantity:1,unit_price:10000,vat_rate:16});const numA=await post(invA);
 const invB=await (async()=>{const i=(await act('PARTNER',{action:'invoice_save',project_id:P,request_id:id(),description:'Fictional fee',invoice_date:'2026-10-01',due_date:'2026-10-31',lines:[{description:'Advisory fee',quantity:1,unit_price:5000,vat_rate:16},{description:'Filing fee paid out',quantity:1,unit_price:2000,vat_rate:0,line_type:'Disbursement'}]})).invoice_id;await post(i);return i;})();
 const draftOnly=await draft(P,{description:'Not yet posted',quantity:1,unit_price:1000,vat_rate:16},'2026-10-02');
 // ---- 1. preparing: only a posted invoice, lines of that invoice, VAT follows the line --------------------------------------------------------------------
 await assert.rejects(sav('MANAGER',draftOnly,[{line_no:0,full:true}]),/posted invoice/);
 await assert.rejects(sav('SUPERVISOR',invA,[{line_no:0,full:true}]),/./,'a Supervisor has no billing access');
 await assert.rejects(sav('MANAGER',invA,[{line_no:3,full:true}]),/Choose lines from the invoice/);
 await assert.rejects(sav('MANAGER',invA,[{line_no:0,net:10000.01}]),/at most 10000\.00/);
 const rq=id();const c1=(await sav('MANAGER',invA,[{line_no:0,full:true}],{request_id:rq})).credit_note_id;
 assert.equal((await sav('MANAGER',invA,[{line_no:0,full:true}],{request_id:rq})).credit_note_id,c1,'the same request returns the same credit note');
 let r=await cn(c1);assert.deepEqual([r.status,num(r.net_amount),num(r.vat_amount),num(r.total_amount),r.prepared_by===actors.MANAGER.staff_id],['Draft',10000,1600,11600,true]);
 await assert.rejects(sav('MANAGER',invA,[{line_no:0,full:true}]),/already fully credited/,'the same line cannot be credited twice across notes');
 // a partial credit: VAT follows each line, the disbursement carries none
 const c2=(await sav('MANAGER',invB,[{line_no:0,net:2000},{line_no:1,full:true}])).credit_note_id;r=await cn(c2);
 assert.deepEqual([num(r.net_amount),num(r.vat_amount),num(r.total_amount)],[4000,320,4320]);
 await assert.rejects(sav('MANAGER',invB,[{line_no:0,net:3000.01}]),/at most 3000\.00/,'what is left on the line after the draft above');
 // ---- 2. a Manager prepares and submits but cannot issue; a submitted note is frozen -------------------------------------------------------------------------
 await assert.rejects(run('MANAGER','credit_note_issue',c1),/Partner/);
 await run('MANAGER','credit_note_submit',c1);assert.equal((await cn(c1)).status,'Submitted');
 await assert.rejects(act('MANAGER',{action:'credit_note_save',credit_note_id:c1,revision:await rev(c1),reason_code:'Billing error',reason:'Changed after submitting',lines:[{line_no:0,full:true}]}),/Only a draft credit note/);
 await assert.rejects(tx`update erp_private.invoice_credit_notes set reason='Edited behind the back' where credit_note_id=${c1}`,/./);
 // ---- 3. issue: a Partner who did not prepare it; the number is the firm's CN sequence; the invoice balance falls -------------------------------------------
 const out=await run('PARTNER','credit_note_issue',c1);assert.match(out.credit_note_number,/^CN\/VCQA\/2026\/00001$/);
 r=await cn(c1);assert.deepEqual([r.status,r.issued_by===actors.PARTNER.staff_id,r.review_override_reason],['Issued',true,null]);
 assert.equal(await credited(invA),11600);
 await assert.rejects(act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:invA,amount:1,method:'Bank',reference:'B-1',payment_date:'2026-10-05'}),/exceeds the invoice balance/,'nothing left to pay once the invoice is fully credited');
 await assert.rejects(act('PARTNER',{action:'invoice_void',invoice_id:invA,revision:String((await tx`select revision from erp_private.invoices where invoice_id=${invA}`)[0].revision),reason:'Void it'}),/issued credit note/);
 // the client statement carries the credit note as a credit
 const st=await act('PARTNER',{action:'statement',client_id:C,starts_on:'2026-01-01',ends_on:'2026-12-31'});
 const row=st.rows.find(x=>x.reference===out.credit_note_number);assert.ok(row,'the credit note is on the statement');assert.deepEqual([num(row.credit),num(row.debit)],[11600,0]);
 // ---- 4. a Partner who prepared a note cannot issue it without a recorded reason ------------------------------------------------------------------------------
 const c3=(await sav('PARTNER',invB,[{line_no:0,net:1000}])).credit_note_id;
 await assert.rejects(run('PARTNER','credit_note_issue',c3),/Submit the credit note/);
 await run('PARTNER','credit_note_submit',c3);
 await assert.rejects(run('PARTNER','credit_note_issue',c3),/prepared a credit note cannot issue it/);
 await assert.rejects(run('PARTNER','credit_note_issue',c3,{override_reason:'short'}),/at least 10/);
 await run('PARTNER','credit_note_issue',c3,{override_reason:'Sole Partner available today'});
 r=await cn(c3);assert.equal(r.review_override_reason,'Sole Partner available today');
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='CREDIT_NOTE_SELF_REVIEW_OVERRIDE' and record_key=${c3}`)[0].n,1);
 // ---- 5. never more than the client still owes: a paid invoice must have its payment reversed first -----------------------------------------------------------
 const invC=await draft(P,{description:'Annual return',quantity:1,unit_price:10000,vat_rate:16},'2026-10-03');await post(invC);
 await act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:invC,amount:8000,method:'Bank',reference:'B-2',payment_date:'2026-10-06'});
 const c4=(await sav('MANAGER',invC,[{line_no:0,full:true}])).credit_note_id;await run('MANAGER','credit_note_submit',c4);
 await assert.rejects(run('PARTNER','credit_note_issue',c4),/still owes 3600\.00/);
 await assert.rejects(run('MANAGER','credit_note_return',c4,{note:'Too large for the balance'}),/Partner/);
 await run('PARTNER','credit_note_return',c4,{note:'Too large for the balance'});r=await cn(c4);assert.deepEqual([r.status,r.return_note],['Draft','Too large for the balance']);
 await act('MANAGER',{action:'credit_note_save',credit_note_id:c4,revision:await rev(c4),reason_code:'Fee agreed down',reason:'Agreed reduction on the fee',lines:[{line_no:0,net:3000}]});
 await run('MANAGER','credit_note_submit',c4);await run('PARTNER','credit_note_issue',c4);
 assert.equal(await credited(invC),3480);
 await assert.rejects(act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:invC,amount:200,method:'Bank',reference:'B-3',payment_date:'2026-10-07'}),/exceeds the invoice balance/,'the balance is 11600 - 8000 - 3480 = 120');
 await act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:invC,amount:120,method:'Bank',reference:'B-4',payment_date:'2026-10-07'});
 // ---- 6. eTIMS reference once; a note recorded on eTIMS cannot be voided here -------------------------------------------------------------------------------
 await assert.rejects(run('MANAGER','credit_note_etims_record',c2,{etims_credit_note_no:'E-1',etims_issued_on:tdy}),/issued credit note/);
 await run('MANAGER','credit_note_etims_record',c1,{etims_credit_note_no:'ETIMS-CN-1',etims_issued_on:tdy});
 await assert.rejects(run('MANAGER','credit_note_etims_record',c1,{etims_credit_note_no:'ETIMS-CN-2',etims_issued_on:tdy}),/already recorded/);
 await assert.rejects(run('PARTNER','credit_note_void',c1,{reason:'Not allowed now'}),/eTIMS/);
 // ---- 7. voiding an issued credit note puts the balance back ---------------------------------------------------------------------------------------------------
 const before=await credited(invB);await run('PARTNER','credit_note_void',c3,{reason:'Issued against the wrong line'});assert.equal(before-await credited(invB),1160);
 await assert.rejects(run('PARTNER','credit_note_void',c3,{reason:'Again'}),/already void/);
 // ---- 8. the PDF is a credit note, marked until its eTIMS number is recorded ----------------------------------------------------------------------------------
 const pdf=await act('PARTNER',{action:'credit_note_pdf',credit_note_id:c4});assert.equal(Buffer.from(pdf.base64,'base64').subarray(0,4).toString(),'%PDF');assert.match(pdf.file_name,/^CN_VCQA_2026_00003\.pdf$/);
 await assert.rejects(act('PARTNER',{action:'credit_note_pdf',credit_note_id:c3}),/void credit note/);
 // ---- 9. the workspace read lists credit notes and the credited amount ------------------------------------------------------------------------------------------------
 const ws=await as('PARTNER',()=>tx`select (select count(*)::int from erp_private.invoice_credit_notes) n,erp_private.invoice_credited(${invC}) c`);assert.deepEqual([ws[0].n,num(ws[0].c)],[4,3480]);
});
test('Credit notes: rights, Edge actions and screen',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
 assert.equal(rd('staff-action-rights.mjs'),rd(fx+'staff-action-rights.mjs'));
 const rights=r=>defaultActionRights(r);
 for(const c of ['creditnote.view','creditnote.create','creditnote.submit','creditnote.etims'])for(const role of ['PARTNER','MANAGER'])assert.ok(rights(role).includes(c),role+' '+c);
 for(const c of ['creditnote.approve','creditnote.void'])assert.ok(rights('PARTNER').includes(c)&&!rights('MANAGER').includes(c),c+' is Partner only');
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN'])assert.ok(!rights(role).some(c=>c.startsWith('creditnote.')),role+' has no credit note right');
 assert.deepEqual(rightsForRequest({action:'credit_note_issue'},'billing_wip'),['creditnote.view','creditnote.approve']);
 assert.match(rd(fx+'staff-access-control.mjs'),/invoice_\|credit_note_\|payment_/);assert.match(rd(fx+'staff-access-control.mjs'),/'payments','credit_notes'\]/);
 const edge=rd(fx+'suite-actions.ts');
 assert.match(edge,/partner\(a\);if\(c\.status!=='Submitted'\)fail\(400,'Submit the credit note before it is issued\.'\)/);
 assert.match(edge,/selfReview\(a,\[c\.prepared_by\],p,'issue'\)/);
 assert.match(edge,/the client still owes \$\{owed\.toFixed\(2\)\}/);
 assert.match(edge,/erp_private\.invoice_credited\(x\.invoice_id\)/,'brought forward uses the credited amount');
 const ui=rd('staff-suite.mjs');
 assert.match(ui,/button\('credit-new','Credit note'/);assert.match(ui,/partner\(\)&&c\.status==='Submitted'\?button\('credit-issue','Issue'/);
 assert.match(ui,/creditSection\(\)/);assert.match(rd('staff-pilot.mjs'),/&cn=20261207-credit-notes/);
});
