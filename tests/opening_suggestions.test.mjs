// Suggestions for opening TB lines (learned from the firm, read from the account name).
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
test('Opening TB suggestions: learned from the firm and read for the legal structure',async(t)=>{
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
 await tx`update erp_private.clients set legal_entity_type='Partnership',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const setup=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:setup.period_id};
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${C}`;
 // A second client of the same firm whose approved mappings are the firm's experience. The preparer is not assigned to it.
 const A=id(),PA=id(),A2=id(),PA2=id();
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${A},'Fictional other client A',${actors.MANAGER.staff_id}),(${A2},'Fictional other client B',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${A},${F}),(${A2},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${PA},${A},${F},'Fictional project A','TAX-COMP',${actors.MANAGER.staff_id}),(${PA2},${A2},${F},'Fictional project B','TAX-COMP',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${PA},${actors.MANAGER.staff_id},${F},'MANAGER'),(${PA2},${actors.MANAGER.staff_id},${F},'MANAGER')`;
 const learn=async(client,code,name,erp,active=true)=>{await as('MANAGER',a=>tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,created_by) values(${client},${code},${name},${erp},'2020-01-01',${a.staff_id})`);if(active)await as('PARTNER',a=>tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where client_id=${client} and erp_account_code=${erp} and source_account_name=${name}`);};
 await learn(A,'3100',"Partners' current accounts",'36010');
 await learn(A2,'3100',"Partners' current accounts",'36010');
 await learn(A,'ZZ9','Weird fund','36000',false);
 await learn(A,'7000','Mystery clearing','10070');
 await learn(A2,'7000','Mystery clearing','10060');
 const suggest=rows=>ledger('ASSISTANT',{...base,action:'ledger_opening_suggest',rows});
 const out=await suggest([
  {key:'a',source_code:'3100',source_name:"Partners' current accounts"},
  {key:'b',source_code:'',source_name:'Trade creditors'},
  {key:'c',source_code:'',source_name:'Share capital'},
  {key:'d',source_code:'ZZ9',source_name:'Weird fund'},
  {key:'e',source_code:'7000',source_name:'Mystery clearing'},
  {key:'f',source_code:'',source_name:'Unexplained thing'},
  {key:'g',source_code:'',source_name:'Equity Bank'},
  {key:'h',source_code:'',source_name:'Capital'}]);
 const S=out.suggestions;
 // learned from two other clients, and the name agrees
 assert.equal(S.a.code,'36010');assert.equal(S.a.source,'firm');assert.equal(S.a.clients,2);assert.equal(S.a.confidence,'High');assert.match(S.a.basis,/2 other clients of this firm/);
 // read from the name
 assert.equal(S.b.code,'20000');assert.equal(S.b.source,'rule');assert.equal(S.b.confidence,'High');
 // a company's share capital is not offered to a partnership; an unapproved mapping is not learned from; nothing guessed for unknown names
 assert.equal(S.c,undefined);assert.equal(S.d,undefined);assert.equal(S.f,undefined);
 // clients disagree and the name says nothing: low confidence, never High
 assert.equal(S.e.confidence,'Low');
 assert.equal(S.g.code,'10020');
 // "Capital" means partners' capital for a partnership
 assert.equal(S.h.code,'36000');
 // only counts are returned, never client names or mapping rows
 assert.doesNotMatch(JSON.stringify(out),/Fictional other client|mapping_id|client_id/);
 // an intern and a project outside the preparer's access cannot ask
 await assert.rejects(()=>ledger('INTERN',{...base,action:'ledger_opening_suggest',rows:[{key:'a',source_name:'Bank'}]}),/./);
 // a company sees the company account
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${C}`;
 await tx`update erp_private.ledger_periods set entity_type='Limited company' where period_id=${setup.period_id}`.catch(()=>{});
});

import {ruleSuggestion,suggestAccount,allowedAccount,normaliseName,entityKey} from '../supabase/functions/staff-workspace-v12/opening-tb-suggest.mjs';
const accounts=[...'10000 10010 10020 10030 10040 10060 10070 10080 10090 10110 10130 10160 10190 15001 15002 15004 15005 15006 15900 15920 20000 20010 20030 20070 20080 20090 21000 21020 21600 21601 21602 21603 21604 30000 30010 31000 35000 35010 36000 36010 36020'.split(' ')].map(code=>({code,name:'Fictional '+code,status:'Active',is_legacy:false,entity_types:{30000:['Limited company'],30010:['Limited company'],31000:['Limited company'],35000:['Sole proprietor'],35010:['Sole proprietor'],36000:['Partnership'],36010:['Partnership'],36020:['Partnership']}[code]||[]}));
const code=(name,entityType,extra={})=>suggestAccount({sourceCode:'',sourceName:name,entityType,accounts,chart:null,...extra})?.code;
test('names are read for the legal structure',()=>{
 assert.equal(code('Capital','Partnership'),'36000');assert.equal(code('Capital','Limited company'),'30000');assert.equal(code('Capital','Sole proprietor'),'35000');
 assert.equal(code('Drawings','Partnership'),'36020');assert.equal(code('Drawings','Sole proprietor'),'35010');assert.equal(code('Drawings','Limited company'),undefined);
 assert.equal(code('Share capital','Partnership'),undefined);assert.equal(code('Share capital','Limited company'),'30000');
 assert.equal(code('Retained earnings','Limited company'),'31000');assert.equal(code('Accumulated profits','Partnership'),'36010');assert.equal(code('Retained earnings','Sole proprietor'),'35000');
 assert.equal(code("Partner's current account",'Partnership'),'36010');
});
test('common balance-sheet names map to the standard accounts',()=>{
 const t=[['Cash in hand','10000'],['Petty cash','10010'],['KCB Bank Account','10020'],['Savings account','10030'],['M-Pesa','10040'],['Trade debtors','10060'],['Other debtors','10070'],['Staff advances','10080'],['Prepayments','10090'],['Rent deposit','10110'],['Input VAT','10160'],['Stock','10190'],['Land','15001'],['Buildings','15002'],['Motor vehicles','15004'],['Furniture & fittings','15005'],['Computers','15006'],['Accumulated depreciation - motor vehicles','15920'],['Accumulated depreciation - buildings','15900'],['Trade creditors','20000'],['Accruals','20010'],['Customer deposits','20030'],['Bank overdraft','20080'],['Bank loan','20090'],['Output VAT','21000'],['VAT payable','21020'],['PAYE payable','21600'],['NHIF','21601'],['Housing levy','21602'],['NSSF','21603'],['NITA','21604']];
 for(const [name,want] of t)assert.equal(code(name,'Limited company'),want,name);
});
test('an overdraft is not a bank balance, and a partner current account is not a bank account',()=>{
 assert.equal(code('Equity Bank overdraft','Limited company'),'20080');assert.equal(code('Director current account','Limited company'),undefined);
});
test('accounts outside the chart, the entity or the balance sheet are never offered',()=>{
 assert.equal(allowedAccount('36010',{accounts,entityType:'Limited company',chart:null}),null);
 assert.equal(allowedAccount('10020',{accounts,entityType:'Limited company',chart:new Set(['10000'])}),null);
 assert.equal(allowedAccount('60000',{accounts:[{code:'60000',status:'Active',is_legacy:false,entity_types:[]}],entityType:'',chart:null}),null);
 assert.equal(code('Trade creditors','Limited company',{chart:new Set(['10000'])}),undefined);
});
test('learned mappings: agreement raises confidence, disagreement defers to the name or stays low',()=>{
 const learned=[{source_code:'3100',source_name:'x',erp_account_code:'36010',clients:3}];
 const one=suggestAccount({sourceCode:'3100',sourceName:'Odd name',entityType:'Partnership',accounts,chart:null,learned});
 assert.equal(one.code,'36010');assert.equal(one.confidence,'High');
 const solo=suggestAccount({sourceCode:'3100',sourceName:'Odd name',entityType:'Partnership',accounts,chart:null,learned:[{...learned[0],clients:1}]});assert.equal(solo.confidence,'Medium');
 const split=suggestAccount({sourceCode:'7',sourceName:'Trade creditors',entityType:'Limited company',accounts,chart:null,learned:[{source_code:'7',source_name:'a',erp_account_code:'20000',clients:1},{source_code:'7',source_name:'a',erp_account_code:'20010',clients:1}]});
 assert.equal(split.code,'20000');assert.equal(split.confidence,'Medium');
 assert.equal(suggestAccount({sourceCode:'7',sourceName:'Zzz',entityType:'Limited company',accounts,chart:null,learned:[{source_code:'7',source_name:'a',erp_account_code:'20000',clients:1},{source_code:'7',source_name:'a',erp_account_code:'20010',clients:1}]}).confidence,'Low');
 assert.equal(normaliseName("Partners' Current  A/c"),'partners current a c');assert.equal(entityKey('Non-profit organisation'),'npo');
});
