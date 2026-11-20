// Annual pack slice 1 through the real actions: roles, maker-checker on the statement map, dated replacement, framework save, readiness.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {statementMapAction,reportingRead,reportingSave,packReadinessFrom}=await import('../supabase/functions/staff-workspace-v12/annual-pack.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const map=(role,p)=>as(role,a=>statementMapAction(tx,a,p));

test('statement map and reporting framework through the actions',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 const per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${C},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];

 // read: every role except an intern sees the lines; nothing is approved yet
 const m0=await map('ASSISTANT',{action:'ledger_statement_map_read'});
 assert(m0.lines.length>40);assert.equal(m0.totals.approved,0);assert(m0.totals.draft>300);assert.equal(m0.unmapped.length,0);

 // who may approve: not a Manager, not an Assistant; a Partner may, and may approve every seeded proposal at once
 await assert.rejects(()=>map('MANAGER',{action:'ledger_statement_map_approve',all_seeded:true}),/Partner/);
 await assert.rejects(()=>map('ASSISTANT',{action:'ledger_statement_map_propose',account_code:'10020',line_code:'SFP.CASH',effective_from:'2026-01-01',reason:'Fictional reason here'}),/Manager or Partner/);
 const done=await map('PARTNER',{action:'ledger_statement_map_approve',all_seeded:true,review_note:'Fictional review of the seeded map'});
 assert(done.reviewed>300);
 const m1=await map('PARTNER',{action:'ledger_statement_map_read'});assert.equal(m1.totals.draft,0);assert(m1.totals.approved>300);
 await assert.rejects(()=>map('PARTNER',{action:'ledger_statement_map_approve',all_seeded:true}),/no seeded/i);

 // a change is proposed by a Manager, must start after the current line, and a different Partner is not needed only because the proposer is a Manager
 await assert.rejects(()=>map('MANAGER',{action:'ledger_statement_map_propose',account_code:'10020',line_code:'SFP.CASH',effective_from:'2026-06-01',reason:'Fictional reason here'}),/already on that statement line/);
 await assert.rejects(()=>map('MANAGER',{action:'ledger_statement_map_propose',account_code:'10020',line_code:'SFP.INV',effective_from:'2025-01-01',reason:'Fictional reason here'}),/after the current/);
 await assert.rejects(()=>map('MANAGER',{action:'ledger_statement_map_propose',account_code:'10020',line_code:'SFP.INV',effective_from:'2026-06-01',reason:'short'}),/10 characters/);
 const prop=await map('MANAGER',{action:'ledger_statement_map_propose',account_code:'10050',line_code:'SFP.OTHER_REC',effective_from:'2026-07-01',reason:'Fictional: undeposited collections are a receivable here'});
 await assert.rejects(()=>map('MANAGER',{action:'ledger_statement_map_propose',account_code:'10050',line_code:'SFP.INV',effective_from:'2026-08-01',reason:'Fictional second draft'}),/already has a change/);
 await assert.rejects(()=>map('MANAGER',{action:'ledger_statement_map_reject',map_ids:[prop.map_id],review_note:'Fictional note long enough'}),/Partner/);
 await assert.rejects(()=>map('PARTNER',{action:'ledger_statement_map_reject',map_ids:[prop.map_id],review_note:'short'}),/10 characters/);
 await map('PARTNER',{action:'ledger_statement_map_approve',map_ids:[prop.map_id]});
 const rows=(await tx`select line_code,effective_from,effective_to,status from erp_private.account_statement_map where account_code='10050' order by effective_from`);
 assert.equal(rows.length,2);assert.equal(rows[0].line_code,'SFP.CASH');assert.equal(new Date(rows[0].effective_to).toISOString().slice(0,10),'2026-06-30');assert.equal(rows[1].status,'Approved');assert.equal(rows[1].effective_to,null);
 // the same Partner who proposed cannot approve their own proposal
 const own=await map('PARTNER',{action:'ledger_statement_map_propose',account_code:'10060',line_code:'SFP.OTHER_REC',effective_from:'2026-07-01',reason:'Fictional own proposal text'});
 await assert.rejects(()=>map('PARTNER',{action:'ledger_statement_map_approve',map_ids:[own.map_id]}),/approved by a Partner other than/);
 await map('PARTNER',{action:'ledger_statement_map_reject',map_ids:[own.map_id],review_note:'Fictional withdrawn proposal'});
 await assert.rejects(()=>map('PARTNER',{action:'ledger_statement_map_approve',map_ids:[own.map_id]}),/already been reviewed/);

 // reporting framework: default is the 2025 edition; early application needs a note; Assistants cannot set it; closed years are frozen
 const r0=await as('ASSISTANT',()=>reportingRead(tx,per));assert.equal(r0.saved,false);assert.equal(r0.reporting.edition,'Third Edition (2025)');assert(r0.problems.length);
 const base={framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',presentation_currency:'KES',rounding:'Whole shillings',comparatives_basis:'Prior year ledger',early_application_note:'Fictional early application note for the year'};
 await assert.rejects(()=>as('ASSISTANT',a=>reportingSave(tx,a,per,base)),/Manager or Partner/);
 await assert.rejects(()=>as('MANAGER',a=>reportingSave(tx,a,per,{...base,early_application_note:''})),/early application/i);
 await assert.rejects(()=>as('MANAGER',a=>reportingSave(tx,a,per,{...base,edition:'Second Edition (2015, amended 2022)',framework:'IFRS Accounting Standards'})),/Choose a valid option/);
 const saved=await as('MANAGER',a=>reportingSave(tx,a,per,base));assert.equal(saved.saved,true);assert.equal(String(saved.reporting.revision),'1');assert.deepEqual(saved.problems,[]);
 await as('MANAGER',a=>reportingSave(tx,a,per,{...base,revision:'1',rounding:'Thousands'}));
 await assert.rejects(()=>as('MANAGER',a=>reportingSave(tx,a,per,{...base,revision:'1',rounding:'Whole shillings'})),/changed by someone else/);
 const again=await as('PARTNER',()=>reportingRead(tx,per));assert.equal(again.reporting.rounding,'Thousands');assert.equal(String(again.reporting.revision),'2');
 await assert.rejects(()=>as('MANAGER',a=>reportingSave(tx,a,{...per,status:'Closed'},{...base,revision:'2'})),/closed/);

 // readiness reads the same saved choices and the approved map
 const per2={...per,status:'Open'};
 const data={as_of:'2026-12-31',tb:[{code:'10020',name:'Bank',opening:0,movement_debit:100,movement_credit:0,net:100},{code:'30000',name:'Share capital',opening:0,movement_debit:0,movement_credit:100,net:-100}],issues:[],prior_year:{source:'Prior-year ledger'}};
 const ready=await as('MANAGER',()=>packReadinessFrom(tx,per2,data));
 assert.equal(ready.checks.find(c=>c.code==='MAP_APPROVED').status,'Pass');assert.equal(ready.checks.find(c=>c.code==='REPORTING_BASIS').status,'Pass');
 const notReady=await as('MANAGER',()=>packReadinessFrom(tx,per2,{...data,tb:[...data.tb,{code:'11000',name:'Sales control',opening:0,movement_debit:9,movement_credit:0,net:9}]}));
 assert.equal(notReady.ready,false);assert.equal(notReady.checks.find(c=>c.code==='NO_LEGACY').status,'Blocked');
});
