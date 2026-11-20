// Step 1 (joined-practice review): rules the edge function already enforced are now also enforced by database triggers.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('Step 1: server-only rules are also enforced by the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id;
 // Act as a signed-in person without dropping to the erp_api role, so the trigger sees actor() but table grants do not get in the way.
 const asActor=async(role,sqlText,v=[])=>{const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);const r=await db.query(sqlText,v);await db.exec('commit');return r.rows;}catch(e){await db.exec('rollback');throw e;}};
 const C=id();
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type) values(${C},'UAT Fictional Rules Ltd','A123456789Z','Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company')`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.client_compliance(client_id,last_edited_by) values(${C},${M})`;

 // ---- 1. KYC verification ------------------------------------------------------------------------------------------------------------------
 const verify=(role,by)=>asActor(role,`update erp_private.client_compliance set verified_by=$2,verified_at=now() where client_id=$1`,[C,by]);
 await assert.rejects(()=>verify('MANAGER2',M2),/Complete the client fields/,'conflict, screening and review date are missing');
 await db.query(`update erp_private.client_compliance set conflict_checked=true,sanctions_date=current_date,sanctions_result='Clear',review_due=current_date+365 where client_id=$1`,[C]);
 await assert.rejects(()=>verify('MANAGER',M),/latest KYC change/,'the last editor cannot verify');
 await assert.rejects(()=>verify('ASSISTANT',actors.ASSISTANT.staff_id),/Only a Manager or Partner/);
 await assert.rejects(()=>verify('MANAGER2',M),/signed-in/,'the verifier must be the signed-in person');
 await verify('MANAGER2',M2);
 assert.equal((await tx`select verified_by from erp_private.client_compliance where client_id=${C}`)[0].verified_by,M2);
 await db.query(`update erp_private.client_compliance set verified_by=null,verified_at=null where client_id=$1`,[C]);
 await db.exec('alter table erp_private.clients disable trigger zz_structure_guard');await db.query(`update erp_private.clients set legal_subtype=null where client_id=$1`,[C]);await db.exec('alter table erp_private.clients enable trigger zz_structure_guard');
 await assert.rejects(()=>verify('MANAGER2',M2),/Complete the client fields/,'a client with no subcategory cannot be verified');
 await db.exec('alter table erp_private.clients disable trigger zz_structure_guard');await db.query(`update erp_private.clients set legal_subtype='Private Limited Company' where client_id=$1`,[C]);await db.exec('alter table erp_private.clients enable trigger zz_structure_guard');

 // ---- 2. Tax profile: preparer cannot verify ------------------------------------------------------------------------------------------------
 const mkProfile=async(by)=>{const p=id();await db.query(`insert into erp_private.client_tax_profiles(profile_id,client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,created_by) values($1,$2,'Company','Resident','Standard',ARRAY['PAYE'],'2025-01-01','2025-12-31','Fictional',$3)`,[p,C,by]);return p;};
 const verifyProfile=(role,p,by)=>asActor(role,`update erp_private.client_tax_profiles set status='Verified',verified_by=$2,verified_at=now(),obligations_reviewed_by=$2,obligations_reviewed_at=now() where profile_id=$1`,[p,by]);
 const P1=await mkProfile(M);
 await assert.rejects(()=>verifyProfile('MANAGER',P1,M),/prepared a tax profile cannot verify/);
 await verifyProfile('MANAGER2',P1,M2);
 assert.equal((await tx`select status from erp_private.client_tax_profiles where profile_id=${P1}`)[0].status,'Verified');

 // ---- 3. Tax case: preparer submits, another person reviews ----------------------------------------------------------------------------------
 const PR=id();
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${PR},${C},${F},'Fictional tax project','TAX-COMP',${M})`;
 const TC=id();
 await db.query(`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by,status) values($1,$2,'PAYE','2026-01-01','2026-01-31',$3,'Draft')`,[TC,PR,M]);
 await db.query(`insert into erp_private.tax_computation_snapshots(case_id,project_id,stage,taken_by,inputs,result,rules_status,source_row_count,source_hash) values($1,$2,'SUBMITTED',$3,'{}','{}','CONFIRMED',0,$4)`,[TC,PR,M,'a'.repeat(64)]);
 await assert.rejects(()=>asActor('MANAGER2',`update erp_private.tax_cases set status='Submitted' where case_id=$1`,[TC]),/Only the preparer/);
 await asActor('MANAGER',`update erp_private.tax_cases set status='Submitted' where case_id=$1`,[TC]);
 await assert.rejects(()=>asActor('MANAGER',`update erp_private.tax_cases set status='Returned',reviewed_by=$2,review_note='Please check the PAYE totals again' where case_id=$1`,[TC,M]),/Another reviewer/,'the preparer cannot review');
 await assert.rejects(()=>asActor('MANAGER2',`update erp_private.tax_cases set status='Returned',reviewed_by=$2,review_note='Please check the PAYE totals again' where case_id=$1`,[TC,M]),/Another reviewer/);
 await assert.rejects(()=>asActor('MANAGER2',`update erp_private.tax_cases set status='Returned',review_note='Please check the PAYE totals again' where case_id=$1`,[TC]),/Record the reviewer/);
 await assert.rejects(()=>asActor('MANAGER2',`update erp_private.tax_cases set status='Returned',reviewed_by=$2,review_note='Please check the PAYE totals again' where case_id=$1`,[TC,actors.PARTNER.staff_id]),/signed-in/);
 await asActor('MANAGER2',`update erp_private.tax_cases set status='Returned',reviewed_by=$2,review_note='Please check the PAYE totals again' where case_id=$1`,[TC,M2]);
 assert.equal((await tx`select status from erp_private.tax_cases where case_id=${TC}`)[0].status,'Returned');

 // ---- 4. Engagement activation needs the opening TB posted ----------------------------------------------------------------------------------
 const AP=id();
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${AP},${C},${F},'Fictional bookkeeping project','ACC-BOOK',${M})`;
 await assert.rejects(()=>tx`update erp_private.projects set status='Active' where project_id=${AP}`,/opening TB/,'no posted opening journal');
 await db.query(`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional new company, no opening balances',opening_balance_confirmed_by=$2,opening_balance_confirmed_at=now() where client_id=$1`,[C,M]);
 await tx`update erp_private.projects set status='Active' where project_id=${AP}`;
 assert.equal((await tx`select status from erp_private.projects where project_id=${AP}`)[0].status,'Active');

 // ---- 5. Accounting family locks once records exist ------------------------------------------------------------------------------------------
 const C2=id();
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type) values(${C2},'UAT Fictional Family Ltd','B123456789Z','Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company')`;
 await db.exec('alter table erp_private.clients disable trigger zz_family_follows_structure');// this test is about the records lock, not about the family following the structure (its own test)
 await tx`update erp_private.clients set legal_entity_type='Partnership' where client_id=${C2}`;
 await db.exec('alter table erp_private.clients enable trigger zz_family_follows_structure');
 await db.exec('alter table erp_private.clients disable trigger zz_family_follows_structure');
 await assert.rejects(()=>tx`update erp_private.clients set legal_entity_type='Sole proprietor' where client_id=${C}`,/accounting family cannot change/,'tax cases exist for this client');
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${C}`;
 await db.exec('alter table erp_private.clients enable trigger zz_family_follows_structure');

 // ---- 6. Legal structure revision needs a Manager or Partner and a reason --------------------------------------------------------------------
 const revise=(role,note,at)=>asActor(role,`update erp_private.clients set legal_structure='Partnership',legal_subtype='General Partnership',legal_structure_note=$2,legal_structure_changed_at=$3 where client_id=$1`,[C2,note,at]);
 await assert.rejects(()=>revise('ASSISTANT','Moved to a partnership after review',new Date().toISOString()),/Only a Manager or Partner/);
 await assert.rejects(()=>revise('MANAGER','short',new Date().toISOString()),/Record why/);
 await assert.rejects(()=>revise('MANAGER','Moved to a partnership after review',null),/Record why/,'the change time must be recorded');
 await revise('MANAGER','Moved to a partnership after review',new Date().toISOString());
 assert.equal((await tx`select legal_structure from erp_private.clients where client_id=${C2}`)[0].legal_structure,'Partnership');
 // A first classification (nothing set before) is not a revision.
 const C3=id();
 await tx`insert into erp_private.clients(client_id,company_name) values(${C3},'UAT Fictional Unclassified Ltd')`;
 await asActor('ASSISTANT',`update erp_private.clients set legal_structure='Individual',legal_subtype='Sole Proprietor' where client_id=$1`,[C3]);
});
