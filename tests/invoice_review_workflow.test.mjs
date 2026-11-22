// Invoice workflow step A: submit, check and post, with the preparer kept apart from the checker and poster.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
import {defaultActionRights,rightsForRequest,canUseAction} from '../staff-action-rights.mjs';
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Invoices: submit, check and post follow the maker-checker rules in the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Support Client Ltd','A400000060Z'),PJ=await proj(Z,'TAX-KRA'),SUP=actors.SUPERVISOR.staff_id,AST=actors.ASSISTANT.staff_id;

 for(const r of ['MANAGER','MANAGER2'])await tx`insert into erp_private.staff_capabilities(staff_id,capability) values(${actors[r].staff_id},'FINANCE')`;
 for(const r of ['PARTNER','MANAGER','MANAGER2'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${PJ},${actors[r].staff_id},${F},${actors[r].category_code})`;
 const inv=async(by=M)=>{const i=id();await tx`insert into erp_private.invoices(invoice_id,request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,created_by) values(${i},${id()},${PJ},${Z},${F},'Fictional workflow invoice',current_date,current_date+14,${JSON.stringify([{description:'Fictional fee',quantity:1,unit_price:1000,line_type:'Fee',net:1000,vat_rate:16,vat:160}])}::jsonb,1000,160,${by})`;return i;};
 const upd=(role,i,set,v=[])=>q(role,`update erp_private.invoices set ${set} where invoice_id=$1 returning review_stage,status`,[i,...v]);
 const st=async i=>(await tx`select status,review_stage,submitted_by,checked_by,review_override_reason,return_note from erp_private.invoices where invoice_id=${i}`)[0];
 const MS=actors.MANAGER.staff_id,M2S=actors.MANAGER2.staff_id,P1=actors.PARTNER.staff_id;
 const I1=await inv();
 // a draft cannot be posted, and a stage cannot be skipped
 await assert.rejects(upd('MANAGER2',I1,`status='Posted',invoice_number='INV/T/1',posted_by=$2,posted_at=now()`,[M2S]),/Check the invoice before posting/);
 await assert.rejects(upd('MANAGER2',I1,`review_stage='Checked',checked_by=$2`,[M2S]),/Invalid invoice review step/);
 // submit by the preparer (the Manager who created it)
 await upd('MANAGER',I1,`review_stage='Submitted',submitted_by=$2,submitted_at=now()`,[MS]);
 assert.equal((await st(I1)).review_stage,'Submitted');
 await assert.rejects(upd('MANAGER',I1,`description='Changed after submitting'`),/Return the invoice to Draft/,'content is locked once submitted');
 // the submitter cannot check it; another Manager can
 await assert.rejects(upd('MANAGER',I1,`review_stage='Checked',checked_by=$2,checked_at=now()`,[MS]),/cannot check it/);
 await upd('MANAGER2',I1,`review_stage='Checked',checked_by=$2,checked_at=now()`,[M2S]);
 assert.equal((await st(I1)).review_stage,'Checked');
 // the preparer cannot post; the checker (a different person) can
 await assert.rejects(upd('MANAGER',I1,`status='Posted',invoice_number='INV/T/1',posted_by=$2,posted_at=now()`,[MS]),/prepared an invoice cannot post/);
 await upd('MANAGER2',I1,`status='Posted',invoice_number='INV/T/1',posted_by=$2,posted_at=now()`,[M2S]);
 assert.equal((await st(I1)).status,'Posted');
 // returning needs a reason and sends it back to Draft
 const I2=await inv();
 await upd('MANAGER',I2,`review_stage='Submitted',submitted_by=$2,submitted_at=now()`,[MS]);
 await assert.rejects(upd('MANAGER2',I2,`review_stage='Draft'`),/reason for returning/);
 await upd('MANAGER2',I2,`review_stage='Draft',return_note='Fee line needs the engagement reference'`);
 assert.deepEqual([(await st(I2)).review_stage,(await st(I2)).return_note],['Draft','Fee line needs the engagement reference']);
 await upd('MANAGER',I2,`description='Edited after the return'`);
 // a Partner who prepared an invoice can check and post it only with a recorded reason of 10+ characters
 const I3=await inv(P1);
 await upd('PARTNER',I3,`review_stage='Submitted',submitted_by=$2,submitted_at=now()`,[P1]);
 await assert.rejects(upd('PARTNER',I3,`review_stage='Checked',checked_by=$2,review_override_reason='short'`,[P1]),/cannot check it/);
 await upd('PARTNER',I3,`review_stage='Checked',checked_by=$2,review_override_reason='Sole Partner in the office this week'`,[P1]);
 await upd('PARTNER',I3,`status='Posted',invoice_number='INV/T/3',posted_by=$2,posted_at=now()`,[P1]);
 assert.equal((await st(I3)).status,'Posted');
 // voiding a submitted draft is still possible
 const I4=await inv();await upd('MANAGER',I4,`review_stage='Submitted',submitted_by=$2,submitted_at=now()`,[MS]);
 await upd('MANAGER2',I4,`status='Void',void_reason='Raised in error'`);assert.equal((await st(I4)).status,'Void');
});
test('Invoices: rights, Edge actions and screen carry the same workflow',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
 assert.equal(rd('staff-action-rights.mjs'),rd(fx+'staff-action-rights.mjs'));
 for(const role of ['PARTNER','MANAGER'])for(const c of ['invoice.submit','invoice.review','invoice.post'])assert.ok(defaultActionRights(role).includes(c),role+' '+c);
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN','ADMIN'])for(const c of ['invoice.submit','invoice.review','invoice.post'])assert.ok(!defaultActionRights(role).includes(c),role+' '+c);
 assert.deepEqual(rightsForRequest({action:'invoice_submit'},'billing_wip'),['invoice.view','invoice.submit']);
 assert.deepEqual(rightsForRequest({action:'invoice_check'},'billing_wip'),['invoice.view','invoice.review']);
 assert.deepEqual(rightsForRequest({action:'invoice_post'},'billing_wip'),['invoice.view','invoice.post']);
 assert.ok(!canUseAction(['invoice.post'],{action:'invoice_post'},'billing_wip'),'switching the Post right off stops posting');
 assert.ok(canUseAction(['invoice.post'],{action:'invoice_check'},'billing_wip'),'checking is a separate right');
 const edge=rd(fx+'suite-actions.ts');
 assert.match(edge,/if\(i\.review_stage!=='Checked'\)fail\(400,'Submit the invoice and have it checked before posting it\.'\)/);
 assert.match(edge,/if\(old\.review_stage!=='Draft'\)fail\(400,'This invoice has been submitted for checking/);
 assert.match(edge,/selfReview\(a,\[i\.submitted_by\],p,'check'\)/);
 assert.match(edge,/selfReview\(a,\[i\.created_by,i\.submitted_by\],p,'post'\)/);
 assert.match(edge,/a\.category_code==='PARTNER'&&why\.length>=10/);
 const ui=rd('staff-suite.mjs');
 assert.match(ui,/button\('invoice-submit','Submit for check'/);assert.match(ui,/review_stage==='Submitted'\?button\('invoice-check'/);
 assert.match(ui,/review_stage==='Checked'\?button\('invoice-post','Post'/);
 assert.ok(!/status==='Draft'\?button\('invoice-post'/.test(ui),'Post no longer shows on every draft');
 assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261206-invoice-review/);
});
