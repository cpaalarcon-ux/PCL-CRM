import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const storage={download:async()=>({data:null,error:new Error('not used')})};
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,storage)),setup=(role,p)=>as(role,a=>improvementAction(tx,a,p,storage));

test('mappings without a source code are told apart by their source account name',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'BLANKC','Fictional Blank Code firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Blank Code client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Blank Code project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const add=(name,code,from='2025-09-01',extra={})=>setup('MANAGER',{action:'v3_client_account_mapping_add',client_id:C,source_account_code:'',source_account_name:name,erp_account_code:code,effective_from:from,...extra});
 await add('SUPPLIERS','20000');
 await add('VAT PAYABLE','21020');
 await add('  vat payable ','21000','2026-01-01').then(()=>assert.fail('the same name and an overlapping date is still refused'),e=>assert.match(String(e.message),/source account name and date/));
 await add('VAT PAYABLE','21020','2024-01-01',{effective_to:'2025-08-31'});
 assert.equal((await tx`select count(*)::int as n from erp_private.client_account_mappings where client_id=${C}`)[0].n,3);
 await setup('MANAGER',{action:'v3_client_account_mapping_add',client_id:C,source_account_code:'SRC-1',source_account_name:'Supplier control',erp_account_code:'20000',effective_from:'2025-09-01'});
 await setup('MANAGER',{action:'v3_client_account_mapping_add',client_id:C,source_account_code:'SRC-1',source_account_name:'Supplier control 2',erp_account_code:'20000',effective_from:'2026-03-01'}).then(()=>assert.fail('a repeated source code is still refused'),e=>assert.match(String(e.message),/source code and date/));
 // The database guard applies the same rule when a reviewer activates two blank-code mappings with different names.
 const [m1,m2]=await tx`select mapping_id from erp_private.client_account_mappings where client_id=${C} and source_account_name in ('SUPPLIERS','VAT PAYABLE') and effective_from='2025-09-01' order by source_account_name desc`;
 await as('PARTNER',async a=>{for(const m of [m1,m2])await tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where mapping_id=${m.mapping_id}`;});
 assert.equal((await tx`select count(*)::int as n from erp_private.client_account_mappings where client_id=${C} and status='Active'`)[0].n,2);
});
