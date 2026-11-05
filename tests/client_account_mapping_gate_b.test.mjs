import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const storage={download:async()=>({data:null,error:new Error('not used')})};
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,storage)),setup=(role,p)=>as(role,a=>improvementAction(tx,a,p,storage));

// Three-gate model: a client account mapping has no approval of its own. It is usable while
// Pending review and is reviewed once, at Gate B, by the person who approves and posts the journal.
test('a new client account mapping is reviewed once, when an independent reviewer posts the journal that uses it',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'GATEB','Fictional Gate B firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Gate B client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Gate B project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id};
 const entry=(code,debit,credit)=>({account_code:code,debit,credit,source_status:'Confirmed',source_reference:'Fictional prior-year closing TB'});
 const save=()=>ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-2026',journal_date:'2026-01-01',evidence:'Fictional approved bank and capital schedules',lines:[entry('10000',100000,0),entry('30000',0,100000)]});
 await assert.rejects(save,/not approved for this client/,'an account with no client mapping at all is still refused');
 for(const [code,name] of [['10000','Cash at bank'],['30000','Share capital']])await setup('MANAGER',{action:'v3_client_account_mapping_add',client_id:C,source_account_code:'SRC-'+code,source_account_name:name,erp_account_code:code,effective_from:'2026-01-01'});
 assert.equal((await tx`select count(*)::int as n from erp_private.client_account_mappings where client_id=${C} and status='Draft'`)[0].n,2);
 const opening=await save();
 let j=await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:opening.journal_id});
 await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:opening.journal_id,revision:j.journal.revision});
 j=await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:opening.journal_id});
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:opening.journal_id,revision:j.journal.revision,status:'Posted',review_note:'Manager who set up the mappings tries to post'}),/You set up the client account mapping/);
 assert.equal((await tx`select status from erp_private.ledger_journals where journal_id=${opening.journal_id}`)[0].status,'Submitted','a refused review leaves the journal unposted');
 assert.equal((await tx`select count(*)::int as n from erp_private.client_account_mappings where client_id=${C} and status='Active'`)[0].n,0);
 const posted=await ledger('PARTNER',{...base,action:'ledger_journal_review',journal_id:opening.journal_id,revision:j.journal.revision,status:'Posted',review_note:'Independently verified mappings, bank and share capital.'});
 assert.equal(posted.activated_mapping_count,2);
 const rows=await tx`select status,approved_by from erp_private.client_account_mappings where client_id=${C}`;
 assert.ok(rows.every(r=>r.status==='Active'&&r.approved_by===actors.PARTNER.staff_id),'the posting reviewer is recorded as the mapping reviewer');
 assert.equal((await tx`select status from erp_private.ledger_journals where journal_id=${opening.journal_id}`)[0].status,'Posted');
});
