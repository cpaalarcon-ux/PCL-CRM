// Tax credit register (build 2730): ERP versus iTax variance gate, one claim at a time, no double counting.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Tax credit register: iTax check by a different person, variance approval, single claim, submission gate',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Credit Client Ltd','A400000040Z'),PJ=await proj(Z,'TAX-KRA'),AST=actors.ASSISTANT.staff_id;
 const snap=(c,p,stage='SUBMITTED',hash='a'.repeat(64),rules='CONFIRMED')=>db.query(`insert into erp_private.tax_computation_snapshots(case_id,project_id,stage,taken_by,inputs,result,rules_status,source_row_count,source_hash) values($1,$2,$3,$4,'{}','{}',$5,0,$6)`,[c,p,stage,M,rules,hash]);
 const mkCase=async(kind,s,e,status='Draft',no=0,amends=null,reason=null)=>{const c=id();await db.query(`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by,reviewed_by,review_snapshot,status,filing_date,amendment_no,amends_case_id,amendment_reason) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[c,PJ,kind,s,e,M,status==='Draft'?null:M2,status==='Draft'?null:'{}',status,status==='Filed'?'2026-10-05':null,no,amends,reason]);return c;};
 const add=(role,v={})=>q(role,`insert into erp_private.tax_credit_entries(client_id,project_id,credit_type,period_start,period_end,source_reference,erp_amount,entered_by,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning credit_id`,[Z,PJ,v.type||'WHT_VAT',v.s||'2026-09-01',v.e||'2026-09-30',v.ref||'WHT-VAT-CERT-0001',v.amt??1000,actors[role].staff_id,v.status||'PENDING']).then(r=>r[0].credit_id);
 const st=async c=>(await tx`select * from erp_private.tax_credit_entries where credit_id=${c}`)[0];
 const itax=(role,c,amt)=>q(role,`update erp_private.tax_credit_entries set itax_amount=$2 where credit_id=$1`,[c,amt]);
 // ---- 1. Entering a credit -----------------------------------------------------------------------------------------------------------------------------
 const V=await mkCase('VAT','2026-09-01','2026-09-30');
 const c1=await add('MANAGER2');
 let e=await st(c1);assert.deepEqual([e.status,e.applies_to,e.erp_amount,e.itax_amount,e.variance,e.claim_amount],['PENDING','VAT','1000.00',null,null,null]);
 await assert.rejects(add('MANAGER2'),/duplicate|unique/i,'the same certificate cannot be entered twice');
 await assert.rejects(add('MANAGER2',{ref:'WHT-VAT-CERT-0002',status:'RECONCILED'}),/pending iTax|check|constraint/i,'a new credit always starts pending');
 await assert.rejects(add('MANAGER2',{ref:'ab'}),/check|constraint/i,'a reference of at least 3 characters');
 await assert.rejects(add('MANAGER2',{ref:'NEG-1',amt:-5}),/check|constraint/i);
 await assert.rejects(q('MANAGER2',`insert into erp_private.tax_credit_entries(client_id,project_id,credit_type,period_start,period_end,source_reference,erp_amount,entered_by) values($1,$2,'WHT_VAT','2026-09-30','2026-09-01','BAD-PERIOD',1,$3)`,[Z,PJ,M2]),/check|constraint/i,'period end cannot precede its start');
 await assert.rejects(q('MANAGER2',`insert into erp_private.tax_credit_entries(client_id,project_id,credit_type,period_start,period_end,source_reference,erp_amount,entered_by) values($1,$2,'WHT_VAT','2026-09-01','2026-09-30','FORGED-BY',1,$3)`,[Z,PJ,M]),/row-level security/i,'the entered_by must be the signed-in person');
 assert.equal((await q('INTERN',`select * from erp_private.tax_credit_entries`)).length,0,'interns cannot read the register');
 await assert.rejects(q('INTERN',`insert into erp_private.tax_credit_entries(client_id,project_id,credit_type,period_start,period_end,source_reference,erp_amount,entered_by) values($1,$2,'WHT_VAT','2026-09-01','2026-09-30','INTERN-TRY',1,$3)`,[Z,PJ,actors.INTERN.staff_id]),/row-level security|must belong/i,'or add to it');
 // ---- 2. The iTax check: a different person --------------------------------------------------------------------------------------------------------------
 await assert.rejects(itax('MANAGER2',c1,1000),/different person/);
 await itax('MANAGER',c1,1000);
 e=await st(c1);assert.deepEqual([e.status,e.claim_amount,e.itax_checked_by===M,e.variance],['RECONCILED','1000.00',true,'0.00'],'equal figures reconcile and the claim is the agreed figure');
 await assert.rejects(itax('MANAGER',c1,900),/already settled/,'a reconciled figure cannot be re-opened');
 // ---- 3. A difference: pending-style gate on submission, approval by a different Manager or Partner --------------------------------------------------------
 const c2=await add('MANAGER2',{ref:'WHT-VAT-CERT-0003',amt:500});
 await itax('MANAGER',c2,450);
 e=await st(c2);assert.deepEqual([e.status,e.variance,e.claim_amount],['DISPUTED','-50.00',null]);
 assert.equal((await tx`select erp_private.tax_credit_open_count(${V}) n`)[0].n,1,'one unresolved entry in the VAT period');
 await assert.rejects(()=>tx`update erp_private.tax_cases set status='Submitted' where case_id=${V}`,/still need the iTax check/,'the return cannot be submitted');
 await assert.rejects(q('MANAGER2',`update erp_private.tax_credit_entries set status='MANAGER_APPROVED',claim_amount=450,decision_reason='Certificate total confirmed by client' where credit_id=$1`,[c2]),/other than the person who entered/,'the person who entered it cannot approve it');
 await assert.rejects(q('MANAGER',`update erp_private.tax_credit_entries set status='MANAGER_APPROVED',claim_amount=450,decision_reason='short' where credit_id=$1`,[c2]),/check|constraint/i,'a written reason of 10 characters');
 await assert.rejects(q('MANAGER',`update erp_private.tax_credit_entries set status='MANAGER_APPROVED',claim_amount=501,decision_reason='Certificate total confirmed by client' where credit_id=$1`,[c2]),/check|constraint/i,'cannot claim more than the larger figure');
 await q('MANAGER',`update erp_private.tax_credit_entries set status='MANAGER_APPROVED',claim_amount=450,decision_reason='Certificate total confirmed by client' where credit_id=$1`,[c2]);
 e=await st(c2);assert.deepEqual([e.status,e.claim_amount,e.decided_by===M],['MANAGER_APPROVED','450.00',true]);
 assert.equal((await tx`select erp_private.tax_credit_open_count(${V}) n`)[0].n,0);
 // ---- 4. Claiming: right tax, open return, once -------------------------------------------------------------------------------------------------------------
 const c3=await add('MANAGER2',{ref:'PENDING-ONLY',amt:10});
 const claim=(role,c,case_)=>q(role,`update erp_private.tax_credit_entries set claimed_in_case_id=$2 where credit_id=$1`,[c,case_]);
 await assert.rejects(claim('MANAGER2',c3,V),/agree to iTax/,'a pending credit cannot be claimed');
 const IT=await mkCase('Company','2026-01-01','2026-12-31');
 await assert.rejects(claim('MANAGER2',c1,IT),/cannot be claimed in a/,'a VAT credit cannot go into an income-tax return');
 const V2=await mkCase('VAT','2026-10-01','2026-10-31');
 await assert.rejects(claim('MANAGER2',c1,V2),/does not fall in this return period/);
 await claim('MANAGER2',c1,V);await claim('MANAGER2',c2,V);
 e=await st(c1);assert.deepEqual([e.claimed_in_case_id===V,e.claimed_by===M2],[true,true]);
 const cl=await tx`select * from erp_private.tax_credit_claimed(${V})`;
 assert.deepEqual(cl.map(x=>[x.credit_type,x.applies_to,x.entries,String(x.claim_total)]),[['WHT_VAT','VAT',2,'1450.00']],'one place for the totals: 1000 + 450');
 await assert.rejects(q('MANAGER2',`update erp_private.tax_credit_entries set itax_amount=1 where credit_id=$1`,[c1]),/claimed credit cannot change/,'a claimed credit is frozen');
 // ---- 5. Income-tax types are kept apart ----------------------------------------------------------------------------------------------------------------------
 const w1=await add('MANAGER2',{type:'WHT_INCOME_TAX',ref:'WHT-IT-0001',s:'2026-03-01',e:'2026-03-31',amt:2000}),i1=await add('MANAGER2',{type:'INSTALMENT_TAX',ref:'INSTAL-0001',s:'2026-06-01',e:'2026-06-30',amt:3000});
 assert.deepEqual([(await st(w1)).applies_to,(await st(i1)).applies_to],['INCOME_TAX','INCOME_TAX']);
 assert.equal((await tx`select erp_private.tax_credit_open_count(${V}) n`)[0].n,1,'only the still-pending VAT entry counts: the two income-tax credits never gate a VAT return');
 assert.equal((await tx`select erp_private.tax_credit_open_count(${IT}) n`)[0].n,2,'but they do gate the annual income-tax return');
 await itax('MANAGER',w1,2000);await itax('MANAGER',i1,3000);
 await claim('MANAGER2',w1,IT);await claim('MANAGER2',i1,IT);
 assert.deepEqual((await tx`select credit_type,claim_total::text t from erp_private.tax_credit_claimed(${IT})`).map(x=>[x.credit_type,x.t]),[['INSTALMENT_TAX','3000.00'],['WHT_INCOME_TAX','2000.00']]);
 await assert.rejects(claim('MANAGER2',w1,V),/already claimed|cannot be claimed in a/,'a credit cannot be claimed in two returns');
 // ---- 6. Release only while the return is a draft ----------------------------------------------------------------------------------------------------------------
 await q('MANAGER2',`update erp_private.tax_credit_entries set claimed_in_case_id=null where credit_id=$1`,[i1]);
 assert.equal((await st(i1)).claimed_in_case_id,null);
 await claim('MANAGER2',i1,IT);
 await snap(IT,PJ);
 await tx`update erp_private.tax_cases set status='Submitted' where case_id=${IT}`;
 await assert.rejects(q('MANAGER2',`update erp_private.tax_credit_entries set claimed_in_case_id=null where credit_id=$1`,[i1]),/cannot be released/,'once submitted, the claims are fixed');
 // ---- 7. Rejection: a Manager or Partner, with a reason; the reference can be entered again ----------------------------------------------------------------------
 const r1=await add('MANAGER2',{ref:'WRONG-CERT-9',amt:77});
 await q('PARTNER',`update erp_private.tax_credit_entries set status='REJECTED',decision_reason='Entered against the wrong client' where credit_id=$1`,[r1]);
 assert.equal((await st(r1)).status,'REJECTED');
 await assert.rejects(q('PARTNER',`update erp_private.tax_credit_entries set status='PENDING' where credit_id=$1`,[r1]),/closed/);
 const r2=await add('MANAGER2',{ref:'WRONG-CERT-9',amt:70});assert.equal((await st(r2)).status,'PENDING');
 await assert.rejects(q('MANAGER2',`update erp_private.tax_credit_entries set erp_amount=1 where credit_id=$1`,[r2]),/cannot be edited/,'what was entered cannot be rewritten');
 await assert.rejects(q('PARTNER',`update erp_private.tax_credit_entries set status='REJECTED',decision_reason='x' where credit_id=$1`,[c1]),/cannot be rejected|claimed credit/,'a reconciled, claimed credit cannot be rejected');
 await assert.rejects(()=>tx`delete from erp_private.tax_credit_entries where credit_id=${r2}`,/archived, not deleted/);
 // ---- 8. Amendments: a credit moves from the superseded version to its amendment, and the totals are never added twice -------------------------------------------
 const F0=await mkCase('VAT','2026-07-01','2026-07-31'),f1=await add('MANAGER2',{ref:'WHT-VAT-JULY',s:'2026-07-01',e:'2026-07-31',amt:300});
 await itax('MANAGER',f1,300);await claim('MANAGER2',f1,F0);
 await db.exec('alter table erp_private.tax_cases disable trigger tax_case_client_approval');
 await tx`update erp_private.tax_cases set status='Filed',reviewed_by=${M},review_snapshot='{}',filing_date='2026-08-05' where case_id=${F0}`;
 await db.exec('alter table erp_private.tax_cases enable trigger tax_case_client_approval');
 await assert.rejects(q('MANAGER2',`update erp_private.tax_credit_entries set claimed_in_case_id=null where credit_id=$1`,[f1]),/cannot be released/,'a credit claimed in a filed return stays there');
 const A1=await mkCase('VAT','2026-07-01','2026-07-31','Draft',1,F0,'Corrected the withholding certificate');
 await claim('MANAGER2',f1,A1);
 assert.equal((await st(f1)).claimed_in_case_id,A1,'the credit moves to the amendment that supersedes the filed version');
 assert.equal((await tx`select count(*)::int n from erp_private.tax_credit_claimed(${F0})`)[0].n,0,'so the superseded version no longer lists it');
 assert.equal((await tx`select claim_total::text t from erp_private.tax_credit_claimed(${A1})`)[0].t,'300.00','and it is counted once');
 const F1=await mkCase('VAT','2026-11-01','2026-11-30');
 await assert.rejects(claim('MANAGER2',f1,F1),/does not fall in this return period|already claimed/,'it cannot be claimed in an unrelated return');
 // ---- 9. Access --------------------------------------------------------------------------------------------------------------------------------------------------------
 for(const role of ['anon','authenticated']){await db.exec('begin');await db.exec(`set local role ${role}`);await assert.rejects(()=>db.query('select 1 from erp_private.tax_credit_entries'),/permission denied/);await db.exec('rollback');}
 for(const fn of ['tax_credit_guard()','tax_credit_open_count(uuid)','tax_credit_case_gate()','tax_credit_claimed(uuid)']){const g=await tx`select has_function_privilege('anon',${'erp_private.'+fn},'execute') a,has_function_privilege('authenticated',${'erp_private.'+fn},'execute') b`;assert.deepEqual([g[0].a,g[0].b],[false,false],fn);}
 const defs=await tx`select p.proname,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname like 'tax_credit%'`;
 assert.ok(defs.length>=4&&defs.every(x=>JSON.stringify(x.proconfig).includes('search_path')),'fixed search_path');
 // ---- 10. Server, rights and screen ---------------------------------------------------------------------------------------------------------------------------------
 const read=f=>fs.readFileSync(path.join(root,f),'utf8'),srv=read('supabase/functions/staff-workspace-v12/credit-actions.ts');
 for(const a of ['tax_credit_list','tax_credit_add','tax_credit_itax','tax_credit_approve','tax_credit_reject','tax_credit_claim','tax_credit_release'])assert.ok(srv.includes(`'${a}'`),a);
 assert.match(srv,/A different person must check the client/);assert.match(srv,/other than the person who entered the credit must approve/);
 const idx=read('supabase/functions/staff-workspace-v12/index.ts');
 assert.ok(idx.indexOf('creditAction(tx,a,p)')<idx.indexOf('taxAction(tx,a,p)'),'the credit handler runs before taxAction, which rejects unknown tax_ actions');
 assert.match(read('supabase/functions/staff-workspace-v12/tax-review-actions.ts'),/tax_credit_open_count/);
 assert.equal(read('staff-rights-catalog.mjs'),read('supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs'));
 for(const f of ['supabase/migrations/20261110273000_tax_credit_register.sql','supabase/functions/staff-workspace-v12/credit-actions.ts'])assert.ok(!/ISRS\s*4000/i.test(read(f)));
});
