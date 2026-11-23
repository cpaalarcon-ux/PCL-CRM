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

test('Reset to draft: Partner only, firm setting on, nothing paid, credited or on eTIMS; the number is kept',async t=>{
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
 const inv=async i=>(await tx`select * from erp_private.invoices where invoice_id=${i}`)[0];
 const reset=(role,i,o={})=>(async()=>act(role,{action:'invoice_reset_to_draft',invoice_id:i,revision:String((await inv(i)).revision),reason:'Fictional: wrong billing period typed',...o}))();
 const line={description:'Return filing',quantity:1,unit_price:10000,vat_rate:16};
 const A=await draft(P,line);const numA=await post(A);
 // ---- 1. off by default; only a Partner; a reason is required --------------------------------------------------------------------------------------------------
 assert.equal((await tx`select allow_invoice_reset_to_draft x from erp_private.firms where firm_id=${F}`)[0].x,false);
 await assert.rejects(reset('PARTNER',A),/switched off for this firm/);
 await assert.rejects(reset('MANAGER',A),/./,'a Manager cannot reset');
 await act('PARTNER',{action:'firm_details',firm_id:F,legal_name:'Fictional firm A',vat_registered:true,allow_invoice_reset_to_draft:true});
 assert.equal((await tx`select allow_invoice_reset_to_draft x from erp_private.firms where firm_id=${F}`)[0].x,true);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='FIRM_INVOICE_RESET_SETTING' and record_key=${F}`)[0].n,1);
 await assert.rejects(reset('MANAGER',A),/./,'a Manager still cannot reset when the firm allows it');
 await assert.rejects(reset('PARTNER',A,{reason:'too short'}),/at least 10 characters/);
 // ---- 2. a reset keeps the number, clears the review record, and leaves an audit trail ----------------------------------------------------------------------------
 await reset('PARTNER',A);
 let r=await inv(A);
 assert.deepEqual([r.status,r.review_stage,r.invoice_number,r.reset_count,r.last_reset_by===actors.PARTNER.staff_id,r.submitted_by,r.checked_by],['Draft','Draft',numA,1,true,null,null]);
 assert.match(r.last_reset_reason,/wrong billing period/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='INVOICE_RESET_TO_DRAFT' and record_key=${A}`)[0].n,1);
 await assert.rejects(reset('PARTNER',A),/Only a posted invoice/,'a draft cannot be reset again');
 // it has to go through submit, check and post again, and it takes the same number back
 await assert.rejects(act('PARTNER',{action:'invoice_post',invoice_id:A,revision:String((await inv(A)).revision),override_reason:'Fictional test: one Partner prepares, checks and posts'}),/checked before posting/);
 assert.equal(await post(A),numA,'the number is retained, not a new one');
 assert.equal((await inv(A)).status,'Posted');
 assert.equal(num((await tx`select last_value from erp_private.number_sequences where firm_id=${F} and kind='INV'`)[0].last_value),1,'no second number was used');
 // ---- 3. things that stop a reset ---------------------------------------------------------------------------------------------------------------------------------------
 const B=await draft(P,line,'2026-10-02');await post(B);
 await act('PARTNER',{action:'payment_add',request_id:id(),invoice_id:B,amount:100,method:'Bank',reference:'FICT-1',payment_date:'2026-10-05'});
 await assert.rejects(reset('PARTNER',B),/payment recorded/);
 const Cn=await draft(P,line,'2026-10-03');await post(Cn);
 await act('PARTNER',{action:'credit_note_save',invoice_id:Cn,request_id:id(),reason_code:'Billing error',reason:'Fictional billing error',lines:[{line_no:0,net:1000}]});
 await assert.rejects(reset('PARTNER',Cn),/has a credit note/);
 const E=await draft(P,line,'2026-10-04');await post(E);
 await act('PARTNER',{action:'invoice_etims_record',invoice_id:E,etims_invoice_no:'FICT-ETIMS-1',etims_issued_on:'2026-10-04'});
 await assert.rejects(reset('PARTNER',E),/eTIMS reference/);
 // ---- 4. the database repeats the rules, so a different route cannot skip them ------------------------------------------------------------------------------
 const D=await draft(P,line,'2026-10-05');await post(D);
 const raw=(role,sql)=>as(role,()=>tx`update erp_private.invoices set status='Draft',review_stage='Draft',reset_count=reset_count+1,last_reset_by=${actors[role].staff_id},last_reset_at=now(),last_reset_reason=${sql} where invoice_id=${D}`);
 await assert.rejects(raw('MANAGER','Fictional: a Manager tries it directly'),/Only an Engagement Partner/);
 await assert.rejects(raw('PARTNER','short'),/at least 10 characters/);
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.invoices set status='Draft',review_stage='Draft',description='Fictional tampered text',reset_count=reset_count+1,last_reset_by=${actors.PARTNER.staff_id},last_reset_reason='Fictional: change the description too' where invoice_id=${D}`),/changes only the invoice status/);
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.invoices set status='Draft',review_stage='Draft',invoice_number='INV/TAMPERED',reset_count=reset_count+1,last_reset_by=${actors.PARTNER.staff_id},last_reset_reason='Fictional: change the number too' where invoice_id=${D}`),/keeps its number/);
 await tx`update erp_private.firms set allow_invoice_reset_to_draft=false where firm_id=${F}`;
 await assert.rejects(raw('PARTNER','Fictional: setting is off for the firm'),/switched off/);
 await tx`update erp_private.firms set allow_invoice_reset_to_draft=true where firm_id=${F}`;
 await raw('PARTNER','Fictional: direct reset with every rule met');assert.equal((await inv(D)).status,'Draft');
 // a posted invoice still cannot be moved to Draft by any other change, and a void invoice stays void
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.invoices set status='Draft' where invoice_id=${B}`),/at least 10 characters/);
 const V=await draft(P,line,'2026-10-06');await post(V);await act('PARTNER',{action:'invoice_void',invoice_id:V,revision:String((await inv(V)).revision),reason:'Fictional void'});
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.invoices set status='Draft' where invoice_id=${V}`),/Invalid invoice transition/);
});
test('Reset to draft: rights, Edge action and screen',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
 assert.equal(rd('staff-action-rights.mjs'),rd(fx+'staff-action-rights.mjs'));
 const rights=r=>defaultActionRights(r);
 assert.ok(rights('PARTNER').includes('invoice.reset'));
 for(const role of ['MANAGER','SUPERVISOR','ASSISTANT','INTERN'])assert.ok(!rights(role).includes('invoice.reset'),role+' has no reset right');
 assert.deepEqual(rightsForRequest({action:'invoice_reset_to_draft'},'billing_wip'),['invoice.view','invoice.reset']);
 const edge=rd(fx+'suite-actions.ts');
 assert.match(edge,/if\(p\.action==='invoice_reset_to_draft'\)\{\s*partner\(a\);/);
 assert.match(edge,/const ref=i\.invoice_number\|\|await nextNumber\(tx,i\.firm_id,'INV'/,'posting again keeps the number');
 assert.match(rd(fx+'workspace-read.ts'),/allow_invoice_reset_to_draft/);
 const ui=rd('staff-suite.mjs');
 assert.match(ui,/button\('invoice-reset','Reset to draft'/);assert.match(ui,/'invoice-reset':'invoice_reset_to_draft'/);
 assert.match(ui,/name="allow_invoice_reset_to_draft"/);assert.match(rd('staff-pilot.mjs'),/&rs=20261208-reset/);
});
