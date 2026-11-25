import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>amlAction(tx,a,p));
test("MLRO onboarding batches: only the MLRO who did not upload may rate; uploads cannot be altered",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await as('PARTNER',()=>tx`select erp_private.staff_right_grant(${actors.MANAGER.staff_id}::uuid,'MLRO','Appointed as the firm MLRO',current_date+30)`);
 const ref='OB-20261125-TEST';
 // The preparer (an Assistant) records the batch as Staged, with nothing decided.
 await as('ASSISTANT',a=>tx`insert into erp_private.onboarding_batches(batch_ref,firm_id,file_name,client_count,created_by) values(${ref},${F},'Fictional.xlsx',1,${a.staff_id})`);
 await as('ASSISTANT',()=>tx`insert into erp_private.onboarding_batch_clients(batch_ref,client_id,row_no,kra_pin,answers) values(${ref},${C},2,'P000000001A','{}')`);
 // A preparer cannot rate or confirm, and cannot insert a pre-rated line.
 assert.equal((await as('ASSISTANT',()=>tx`update erp_private.onboarding_batch_clients set risk_rating='Low',rated_by=${actors.ASSISTANT.staff_id} where batch_ref=${ref} returning 1`)).length,0);
 assert.equal((await as('ASSISTANT',()=>tx`update erp_private.onboarding_batches set status='Confirmed' where batch_ref=${ref} returning 1`)).length,0);
 // The MLRO (a Manager, not the uploader) can record checks and a rating, but not alter the uploaded answers.
 await as('MANAGER',a=>tx`update erp_private.onboarding_batches set evidence_reference='Folder X',mlro_staff_id=${a.staff_id} where batch_ref=${ref} returning batch_ref`).then(r=>assert.equal(r.length,1));
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.onboarding_batches set file_name='Other.xlsx' where batch_ref=${ref}`),/cannot be changed/);
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.onboarding_batch_clients set answers='{"x":1}' where batch_ref=${ref}`),/cannot be changed/);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.onboarding_batch_clients set risk_rating='Low',rated_by=${actors.SUPERVISOR.staff_id} where batch_ref=${ref}`),/own name/);
 const rated=await as('MANAGER',a=>tx`update erp_private.onboarding_batch_clients set risk_rating='Low',rated_by=${a.staff_id},rated_at=now() where batch_ref=${ref} returning risk_rating`);assert.equal(rated[0].risk_rating,'Low');
 // Nothing is ever deleted, and a Confirmed batch needs a signed document.
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.onboarding_batches where batch_ref=${ref}`));
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.onboarding_batches set status='Confirmed' where batch_ref=${ref}`),/./);
 // An MLRO cannot decide a batch they uploaded themselves.
 await as('PARTNER',()=>tx`select erp_private.staff_right_grant(${actors.SUPERVISOR.staff_id}::uuid,'MLRO','Appointed as a second MLRO',current_date+30)`);
 await as('SUPERVISOR',a=>tx`insert into erp_private.onboarding_batches(batch_ref,firm_id,file_name,client_count,created_by) values('OB-20261125-OWN1',${F},'Own.xlsx',1,${a.staff_id})`);
 assert.equal((await as('SUPERVISOR',a=>tx`update erp_private.onboarding_batches set evidence_reference='x',mlro_staff_id=${a.staff_id} where batch_ref='OB-20261125-OWN1' returning 1`)).length,0);
 // The identity sighting record is on the owner line and needs a date and a name when Yes.
 const cols=await tx`select column_name from information_schema.columns where table_schema='erp_private' and table_name='beneficial_owners' and column_name like 'identity_sighted%'`;
 assert.equal(cols.length,3);
});
