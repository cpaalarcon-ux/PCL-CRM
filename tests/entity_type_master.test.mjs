// Step 2 (joined-practice review): one master for the client's entity type. Legal structure + Subcategory decides the accounting family and the KYC entity type.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('Step 2: legal structure is the master entity type',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id;
 const kycOf=async(st,sub)=>(await tx`select kyc_entity_type k,engine_family f from erp_private.legal_structure_types where structure=${st} and subtype=${sub}`)[0];

 // ---- 1. The KYC entity type is derived from the accounting family in one place ----------------------------------------------------------
 assert.equal((await kycOf('Limited Company','Private Limited Company')).k,'Company');
 assert.equal((await kycOf('Limited Company','Branch of a Foreign Company')).k,'Company');
 assert.equal((await kycOf('Partnership','Limited Liability Partnership (LLP)')).k,'Partnership');
 assert.equal((await kycOf('Individual','Sole Proprietor')).k,'Sole proprietor');
 for(const [st,sub] of [['Non-Profit Organisation','NGO'],['Other','Trust'],['Co-operative Society','Deposit-taking SACCO'],['Public Entity','State Corporation'],['Individual','Individual Taxpayer']])assert.equal((await kycOf(st,sub)).k,'Other',st+' / '+sub);
 await assert.rejects(()=>tx`update erp_private.legal_structure_types set kyc_entity_type='Company' where subtype='NGO'`,/generated|cannot|column/i,'it cannot be set by hand');

 // ---- 2. The accounting family must follow the structure ------------------------------------------------------------------------------------
 const mk=async(name,pin,st,sub,fam)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type) values(${c},${name},${pin},'Energy','Nairobi','Corporate',${st},${sub},${fam})`;return c;};
 await assert.rejects(()=>mk('UAT Fictional Wrong Family Ltd','A100000001Z','Limited Company','Private Limited Company','Partnership'),/accounting family .* follows the legal structure/);
 const A=await mk('UAT Fictional Company Ltd','A100000002Z','Limited Company','Private Limited Company','Limited company');
 const U=await mk('UAT Fictional Unconfirmed Ltd','A100000003Z','Limited Company','Private Limited Company',null);
 await assert.rejects(()=>tx`update erp_private.clients set legal_entity_type='Sole proprietor' where client_id=${A}`,/follows the legal structure/);
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${U}`;

 // ---- 3. The KYC entity type must follow the structure ---------------------------------------------------------------------------------------
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${A},${F})`;
 await assert.rejects(()=>tx`insert into erp_private.client_compliance(client_id,entity_type) values(${A},'Other')`,/KYC entity type follows .* must be Company/);
 await tx`insert into erp_private.client_compliance(client_id,entity_type) values(${A},'Company')`;
 await assert.rejects(()=>tx`update erp_private.client_compliance set entity_type='Partnership' where client_id=${A}`,/must be Company/);
 const L=id();// a legacy client with no structure still chooses its own type
 await tx`insert into erp_private.clients(client_id,company_name) values(${L},'UAT Fictional Legacy Ltd')`;
 await tx`insert into erp_private.client_compliance(client_id,entity_type) values(${L},'Other')`;
 await tx`update erp_private.client_compliance set entity_type='Partnership' where client_id=${L}`;

 // ---- 4. Setting or revising the structure moves the KYC entity type with it -----------------------------------------------------------------
 await tx`update erp_private.clients set legal_structure='Partnership',legal_subtype='General Partnership',legal_entity_type='Partnership',legal_structure_note='Converted to a partnership after review',legal_structure_changed_at=now() where client_id=${A}`;
 assert.equal((await tx`select entity_type from erp_private.client_compliance where client_id=${A}`)[0].entity_type,'Partnership');
 await tx`update erp_private.clients set legal_structure='Individual',legal_subtype='Individual Taxpayer',legal_entity_type='Other legal entity',legal_structure_note='Now an individual taxpayer',legal_structure_changed_at=now()+interval '1 second' where client_id=${A}`;
 assert.equal((await tx`select entity_type from erp_private.client_compliance where client_id=${A}`)[0].entity_type,'Other');
 // A legacy client that gets its first classification is brought in line.
 await tx`update erp_private.clients set legal_structure='Partnership',legal_subtype='General Partnership' where client_id=${L}`;
 assert.equal((await tx`select entity_type from erp_private.client_compliance where client_id=${L}`)[0].entity_type,'Partnership');

 // ---- 5. Report of clients that already disagree (no silent rewrite) -------------------------------------------------------------------------
 assert.deepEqual(await tx`select * from erp_private.entity_type_conflicts()`,[],'everything agrees so far');
 await db.exec('alter table erp_private.clients disable trigger zz_family_follows_structure;alter table erp_private.client_compliance disable trigger zz_kyc_type_follows_structure');
 const D=await mk('UAT Fictional Drifted Ltd','A100000004Z','Limited Company','Private Limited Company','Partnership');
 await tx`insert into erp_private.client_compliance(client_id,entity_type) values(${D},'Other')`;
 await db.exec('alter table erp_private.clients enable trigger zz_family_follows_structure;alter table erp_private.client_compliance enable trigger zz_kyc_type_follows_structure');
 const prof=async(client,type)=>{await db.query(`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,created_by) values($1,$2,'Resident','Standard',ARRAY['PAYE'],'2026-01-01','2026-12-31','Fictional',$3)`,[client,type,M]);};
 await prof(D,'Individual');
 const rows=(await tx`select client_id,problem from erp_private.entity_type_conflicts() where client_id=${D} order by problem`).map(r=>r.problem);
 assert.equal(rows.length,3);
 assert.ok(rows.some(r=>/accounting family Partnership differs from Limited company/.test(r)));
 assert.ok(rows.some(r=>/KYC entity type Other differs from Company/.test(r)));
 assert.ok(rows.some(r=>/tax profile type Individual differs from the suggested Company/.test(r)));
 assert.equal((await tx`select count(*)::int n from erp_private.entity_type_conflicts() where client_id<>${D}`)[0].n,0,'only the drifted client is reported');
 assert.equal((await tx`select legal_entity_type from erp_private.clients where client_id=${D}`)[0].legal_entity_type,'Partnership','reporting does not rewrite it');
});
