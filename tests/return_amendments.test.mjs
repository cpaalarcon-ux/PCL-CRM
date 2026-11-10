// Amendments linked to the locked original (build 2720): a filed return is never edited; a numbered amendment case is linked to it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Amendments: numbered, linked, one at a time, only from a filed return, original untouched',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Amend Client Ltd','A400000030Z'),PJ=await proj(Z,'TAX-KRA'),AST=actors.ASSISTANT.staff_id;
 const T0=(await tx`select (now() at time zone 'Africa/Nairobi')::date::text d`)[0].d;
 const mk1=async(kind,s,e,status,no=0,amends=null,reason=null)=>{const c=id();await db.query(`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by,reviewed_by,review_snapshot,status,filing_date,amendment_no,amends_case_id,amendment_reason) values($1,$2,$3,$4,$5,$6,$7,'{}',$8,$9,$10,$11,$12)`,[c,PJ,kind,s,e,AST,M,status,status==='Filed'?'2026-10-05':null,no,amends,reason]);return c;};
 const ident=(c)=>tx`select amendment_no,case_id from erp_private.tax_return_identities where case_id=${c}`;
 // ---- 1. The original reserves the period; an amendment is a new, linked, numbered case ------------------------------------------------------------------
 const O=await mk1('VAT','2026-09-01','2026-09-30','Filed');
 assert.equal((await ident(O))[0].amendment_no,0);
 await assert.rejects(mk1('VAT','2026-09-01','2026-09-30','Draft'),/duplicate|unique|overlaps/i,'a second original for the same period is still refused');
 await assert.rejects(mk1('VAT','2026-09-01','2026-09-30','Draft',1,O,'short'),/check|constraint/i,'an amendment needs a written reason of at least 10 characters');
 await assert.rejects(mk1('VAT','2026-09-01','2026-09-30','Draft',0,O,null),/check|constraint/i,'an original cannot point at another case');
 await assert.rejects(mk1('VAT','2026-09-01','2026-09-30','Draft',1,null,'Corrected output VAT on sale 4471'),/check|constraint/i,'an amendment must say what it amends');
 await assert.rejects(mk1('VAT','2026-09-01','2026-09-29','Draft',1,O,'Corrected output VAT on sale 4471'),/same client, obligation and period/,'same period only');
 await assert.rejects(mk1('PAYE','2026-09-01','2026-09-30','Draft',1,O,'Corrected output VAT on sale 4471'),/same client, obligation and period/,'same obligation only');
 const A1=await mk1('VAT','2026-09-01','2026-09-30','Draft',1,O,'Corrected output VAT on sale 4471');
 assert.deepEqual((await ident(A1))[0].amendment_no,1);
 await assert.rejects(mk1('VAT','2026-09-01','2026-09-30','Draft',1,O,'Another correction of the same return'),/duplicate|unique|in progress/i,'one amendment at a time');
 await assert.rejects(mk1('VAT','2026-09-01','2026-09-30','Draft',2,A1,'Second correction of the same return'),/Only a filed return|in progress/,'cannot amend an amendment that is not filed yet');
 // ---- 2. Draft original cannot be amended ------------------------------------------------------------------------------------------------------------------
 const D0=await mk1('PAYE','2026-09-01','2026-09-30','Draft');
 await assert.rejects(mk1('PAYE','2026-09-01','2026-09-30','Draft',1,D0,'Corrected the gross pay of one employee'),/Only a filed return/);
 // ---- 3. A chain: only the latest filed version can be amended -----------------------------------------------------------------------------------------
 const O2=await mk1('TOT','2026-09-01','2026-09-30','Filed');
 const B1=await mk1('TOT','2026-09-01','2026-09-30','Filed',1,O2,'Gross receipts understated in the original');
 await assert.rejects(mk1('TOT','2026-09-01','2026-09-30','Draft',2,O2,'Trying to branch from the original'),/latest filed version/,'cannot branch from an older version');
 await assert.rejects(mk1('TOT','2026-09-01','2026-09-30','Draft',3,B1,'Skipping a version number is not allowed'),/latest filed version/,'numbers are consecutive');
 const B2=await mk1('TOT','2026-09-01','2026-09-30','Draft',2,B1,'Second correction after the audit query');
 assert.equal((await ident(B2))[0].amendment_no,2);
 // ---- 4. The filed original and the amendment identity cannot be changed --------------------------------------------------------------------------------
 await assert.rejects(()=>tx`update erp_private.tax_cases set inputs='{"x":1}' where case_id=${O}`,/Tax file is locked|snapshot cannot change/,'the filed original is untouched');
 await assert.rejects(()=>tx`update erp_private.tax_cases set amendment_reason='Changed my mind about the reason' where case_id=${A1}`,/cannot change/);
 await assert.rejects(()=>tx`update erp_private.tax_cases set amendment_no=5 where case_id=${A1}`,/cannot change|check/i);
 await assert.rejects(()=>tx`update erp_private.tax_cases set amends_case_id=${B1} where case_id=${A1}`,/cannot change/);
 await tx`update erp_private.tax_cases set status='Submitted' where case_id=${A1}`;
 assert.equal((await tx`select status from erp_private.tax_cases where case_id=${A1}`)[0].status,'Submitted','an amendment moves through review like any return');
 // ---- 5. An amendment cannot be Filed without its own filing record ----------------------------------------------------------------------------------------
 await tx`update erp_private.tax_cases set status='Draft' where case_id=${B2}`.catch(()=>{});
 const L=await mk1('MRI','2026-09-01','2026-09-30','Filed');
 const L1=await mk1('MRI','2026-09-01','2026-09-30','Locked',1,L,'Rental income of one unit was omitted');
 await assert.rejects(()=>tx`update erp_private.tax_cases set status='Filed',filing_date='2026-10-06' where case_id=${L1}`,/Written approval|filing record/,'the original filing record does not stand in for the amendment');
 assert.equal((await tx`select count(*)::int n from erp_private.tax_filings where case_id=${L1}`)[0].n,0);
 // ---- 6. Server and screen --------------------------------------------------------------------------------------------------------------------------------------------
 const read=f=>fs.readFileSync(path.join(root,f),'utf8');
 const srv=read('supabase/functions/staff-workspace-v12/tax-review-actions.ts');
 assert.match(srv,/p\.action==='tax_amend'/);assert.match(srv,/target\.status!=='Filed'/);assert.match(srv,/amendment_no>\$\{target\.amendment_no\}/);assert.match(srv,/return_tied:false,eligibility_confirmed:false/,'approvals and tie-out start again');
 assert.match(srv,/order by ends_on desc, amendment_no desc/,'carry-forward uses the latest version of the previous period');
 assert.match(read('supabase/functions/staff-workspace-v12/period-import-actions.ts'),/order by amendment_no desc/);
 assert.match(read('supabase/functions/staff-workspace-v12/suite-actions.ts'),/amendment_no,amends_case_id/);
 const ui=read('staff-suite.mjs');
 assert.match(ui,/tax-amend/);assert.match(ui,/Amend this filed return/);assert.match(ui,/Amendment \$\{c\.amendment_no\}/);
 for(const f of ['supabase/migrations/20261110272000_return_amendments.sql','staff-suite.mjs'])assert.ok(!/ISRS\s*4000/i.test(read(f)));
});
