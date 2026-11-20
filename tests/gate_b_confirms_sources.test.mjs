import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const storage={download:async()=>({data:null,error:new Error('not used')})},ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,storage));

// Gate B is one reviewer action. Posting a depreciation journal built from a submitted asset approves the
// asset classification and class rate in the same action; no separate asset review is needed first.
test('posting a depreciation journal confirms its submitted asset in the same independent review',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'GATEBS','Fictional Gate B sources firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Gate B sources client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Gate B sources project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id};
 const computer=(await ledger('ASSISTANT',{action:'ledger_periods',project_id:P})).rates.find(x=>x.class_code==='COMPUTER');assert.ok(computer);
 const prepare=async(role,name)=>{const asset=await ledger(role,{...base,action:'ledger_asset_save',asset_name:name,asset_account:'15006',rate_id:computer.rate_id,first_use_date:'2026-01-01',cost:100000,business_percentage:100,noncommercial_vehicle:false,evidence:'Fictional invoice, ownership and first-use evidence'});
  const read=()=>ledger('ASSISTANT',{...base,action:'ledger_asset_read',asset_id:asset.asset_id});await ledger(role,{...base,action:'ledger_asset_submit',asset_id:asset.asset_id,revision:(await read()).asset.revision});
  const charge=await ledger('ASSISTANT',{...base,action:'ledger_depreciation_create',asset_id:asset.asset_id,starts_on:'2026-01-01',ends_on:'2026-12-31',reference:'DEP-'+name.slice(-1),evidence:'Fictional annual class-rate calculation'});
  let j=await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:charge.journal_id});await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:charge.journal_id,revision:j.journal.revision});await checkJournal(tx,charge.journal_id);
  j=await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:charge.journal_id});return {asset,journal:j.journal,read};};
 const status=async assetId=>(await tx`select status,reviewed_by from erp_private.ledger_assets where asset_id=${assetId}`)[0];

 const first=await prepare('ASSISTANT','Fictional computer A');
 assert.equal((await status(first.asset.asset_id)).status,'Submitted','a depreciation entry can be prepared from a submitted asset');
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:first.journal.journal_id,revision:first.journal.revision,status:'Posted',review_note:'short'}),/at least 10 characters/);
 await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:first.journal.journal_id,revision:first.journal.revision,status:'Posted',review_note:'Fictional independent review of classification, rate and charge.'});
 assert.deepEqual(await status(first.asset.asset_id),{status:'Approved',reviewed_by:actors.MANAGER.staff_id},'the posting reviewer approves the asset in the same action');
 assert.equal((await tx`select status from erp_private.ledger_journals where journal_id=${first.journal.journal_id}`)[0].status,'Posted');

 const second=await prepare('MANAGER','Fictional computer B');
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:second.journal.journal_id,revision:second.journal.revision,status:'Posted',review_note:'Manager who prepared the asset tries to post'}),/You prepared the asset classification/);
 assert.equal((await status(second.asset.asset_id)).status,'Submitted');
 await ledger('PARTNER',{...base,action:'ledger_journal_review',journal_id:second.journal.journal_id,revision:second.journal.revision,status:'Posted',review_note:'Fictional Partner review of classification, rate and charge.'});
 assert.equal((await status(second.asset.asset_id)).reviewed_by,actors.PARTNER.staff_id);
});
