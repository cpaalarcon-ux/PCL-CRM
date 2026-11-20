import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {annualTaxLedgerControl}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),map=(role,p)=>as(role,a=>accountingAction(tx,a,p));
test('Client ledger: source integrity, maker/checker, entity profit and shared PPE rates',async(t)=>{
 t.after(()=>db.close());
 const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,storage));let workbookBytes;const storage={download:async()=>({data:new Blob([workbookBytes])})};
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${F2},'V3OTHER','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Fictional hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',205,205,0,0,${actors.ASSISTANT.staff_id})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const setup=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:setup.period_id};
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${C}`;
 const mapAdd=(role,code,from,src)=>call(role,{action:'v3_client_account_mapping_add',client_id:C,source_account_code:src,source_account_name:'Fictional source '+src,erp_account_code:code,effective_from:from});
 const entry=(code,debit,credit)=>({account_code:code,debit,credit,source_status:'Confirmed',source_reference:'Fictional source statement'});
 const rows=async code=>await tx`select mapping_id,status,effective_from::text as effective_from,effective_to::text as effective_to from erp_private.client_account_mappings where client_id=${C} and erp_account_code=${code} order by effective_from`;
 const openingOf=async(role,b,lines,extra={})=>await ledger(role,{...b,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-'+b.period_id.slice(0,4),journal_date:'2026-01-01',evidence:'Fictional approved schedules',lines,...extra});
 // 1. The setup is dated after the opening date (added later in the year): another preparer's work gets a dated correction, not a dead end.
 await mapAdd('MANAGER','10000','2020-01-01','FX-BANK');
 await mapAdd('MANAGER','31000','2026-11-01','FX-RE');
 const opening=await openingOf('ASSISTANT',base,[entry('10000',100000,0),entry('31000',0,100000)]);
 const re=await rows('31000');
 assert.equal(re.length,2);assert.equal(re[0].effective_from,'2026-01-01');assert.equal(re[0].effective_to,'2026-10-31');assert.equal(re[1].effective_from,'2026-11-01');
 // Saving again does not add a second correction.
 const j1=await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:opening.journal_id});
 await openingOf('ASSISTANT',base,[entry('10000',100000,0),entry('31000',0,100000)],{journal_id:opening.journal_id,revision:j1.journal.revision});
 assert.equal((await rows('31000')).length,2);
 await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:opening.journal_id,revision:(await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:opening.journal_id})).journal.revision});
 await checkJournal(tx,opening.journal_id);
 const j2=await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:opening.journal_id});
 await ledger('PARTNER',{...base,action:'ledger_journal_review',journal_id:opening.journal_id,revision:j2.journal.revision,status:'Posted',review_note:'Fictional independent review of the opening schedules.'});
 const after=await rows('31000');assert.equal(after[0].status,'Active');assert.equal(after[1].status,'Draft');
 // 2. A Draft setup you created yourself is moved back to the opening date.
 const next=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2027-01-01',ends_on:'2027-12-31'}),b2={project_id:P,period_id:next.period_id};
 await mapAdd('MANAGER','32000','2027-06-01','FX-CY');
 await ledger('MANAGER',{...b2,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-2027',journal_date:'2027-01-01',evidence:'Fictional approved schedules',lines:[entry('10000',50,0),entry('32000',0,50)]});
 const cy=await rows('32000');assert.equal(cy.length,1);assert.equal(cy[0].effective_from,'2027-01-01');assert.equal(cy[0].status,'Draft');
 // 3. An account with no setup at all names the fix.
 await assert.rejects(()=>openingOf('ASSISTANT',{...base,period_id:setup.period_id},[entry('10010',1,0),entry('31000',0,1)]),/not approved for this client’s opening balance date \(2026-01-01\).*Effective from/);
 // 4. Income and expense lines name the account to close them to.
 await assert.rejects(()=>openingOf('ASSISTANT',{...base,period_id:setup.period_id},[entry('60000',10,0),entry('31000',0,10)]),/31000 Retained earnings - companies/);
});

test('closing hint follows the legal structure',async()=>{const {closingAccountHint}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');assert.equal(closingAccountHint('Partnership').code,'36010');assert.equal(closingAccountHint('Sole proprietor').code,'35000');assert.equal(closingAccountHint('Limited company').code,'31000');assert.equal(closingAccountHint('').code,'32000');});
