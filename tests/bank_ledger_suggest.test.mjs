import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientChartAction,approvedChart}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const {bankAccountAction}=await import('../supabase/functions/staff-workspace-v12/bank-accounts.ts');
const {suggestBankCode}=await import('../supabase/functions/staff-workspace-v12/bank-close.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chart=(role,p)=>as(role,a=>clientChartAction(tx,a,p));

test('a new bank account is given the right ledger account, and a missing chart account is proposed as an amendment',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CHARTQA','Fictional chart firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional chart client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional chart project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await tx`update erp_private.clients set legal_structure='Limited Company',legal_subtype='Private Limited Company' where client_id=${C}`;
 await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional CR12',${actors.MANAGER.staff_id})`;

 // Pure rule: the standard account for the type, then the next free additional account.
 assert.equal(suggestBankCode('Bank current',new Set()),'10020');assert.equal(suggestBankCode('Bank savings',new Set()),'10030');assert.equal(suggestBankCode('Mobile money',new Set()),'10040');assert.equal(suggestBankCode('Overdraft',new Set()),'20080');
 assert.equal(suggestBankCode('Bank current',new Set(['10020'])),'10021');assert.equal(suggestBankCode('Mobile money',new Set(['10040','10021','10022'])),'10023');
 assert.equal(suggestBankCode('Overdraft',new Set(['20080'])),null,'only one overdraft account');
 assert.equal(suggestBankCode('Bank current',new Set(['10020',...Array.from({length:8},(_,i)=>String(10021+i))])),null,'all additional accounts used');
 const l={client_id:C,starts_on:'2026-01-01'},bank=(role,p)=>as(role,a=>bankAccountAction(tx,a,l,p)),propose=(role,p)=>chart(role,p);
 // Approve the client's chart (without the additional bank accounts, which are Draft in the master chart).
 const proposal=await chart('MANAGER',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-01-01'});
 await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,extra_accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C},'2026-01-01','Limited company',${'{Wholesale}'},${'{'+proposal.accounts.map(x=>x.code).join(',')+'}'},${tx.json([])},'Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now(),'Fictional approval')`;
 const sugg=(kind='Bank current',extra={})=>bank('ASSISTANT',{action:'ledger_bank_suggest',kind,...extra});
 // First bank: the standard account, already in the chart.
 let s=await sugg();assert.equal(s.code,'10020');assert.equal(s.state,'ready');
 await bank('MANAGER',{action:'ledger_bank_save',bank_name:'Fictional Bank One',kind:'Bank current',gl_code:'10020'});
 // Second bank: 10021 is still Draft in the master chart, so a Partner must approve it first.
 s=await sugg();assert.equal(s.code,'10021');assert.equal(s.state,'needs_partner_approval');assert.match(s.message,/Partner must approve/);
 await db.exec(`alter table erp_private.account_catalog disable trigger user;update erp_private.account_catalog set status='Active' where code='10021';alter table erp_private.account_catalog enable trigger user;`);
 // Active in the master chart but not in this client's chart: the amendment is proposed, never silently added.
 s=await sugg();assert.equal(s.state,'needs_chart_amendment');assert.match(s.message,/propose a chart amendment/);
 assert.equal((await tx`select count(*)::int n from erp_private.client_chart_versions where client_id=${C} and status='Draft'`)[0].n,0,'suggesting changes nothing');
 await assert.rejects(()=>bank('MANAGER',{action:'ledger_bank_save',bank_name:'Fictional Bank Two',kind:'Bank current',gl_code:'10021'}),/not in this client's approved chart/);
 const made=await bank('MANAGER',{action:'ledger_bank_propose_chart',kind:'Bank current',bank_name:'Fictional Bank Two'});
 assert.equal(made.state,'amendment_proposed');
 const draft=(await tx`select * from erp_private.client_chart_versions where client_id=${C} and status='Draft'`)[0];
 assert.equal(draft.version_id,made.version_id);assert.ok(draft.accounts.includes('10021'));assert.deepEqual(draft.extra_accounts.map(x=>x.code),['10021']);assert.match(draft.extra_accounts[0].reason,/Fictional Bank Two/);assert.equal(draft.prepared_by,actors.MANAGER.staff_id);
 await assert.rejects(()=>bank('MANAGER',{action:'ledger_bank_propose_chart',kind:'Bank current',bank_name:'Fictional Bank Two'}),/already waiting for review/);
 // The preparer cannot approve it; a different Manager or Partner does (an Assistant-prepared chart would be checked by a Supervisor first).
 await tx`update erp_private.client_chart_versions set status='Approved',reviewed_by=${actors.PARTNER.staff_id},reviewed_at=now(),review_note='Fictional approval of bank ledger account' where version_id=${made.version_id}`;
 s=await sugg();assert.equal(s.state,'ready');assert.equal(s.code,'10021');
 await bank('MANAGER',{action:'ledger_bank_save',bank_name:'Fictional Bank Two',kind:'Bank current',gl_code:'10021'});
 // Editing a bank does not count its own ledger account as used.
 const one=(await tx`select bank_account_id from erp_private.client_bank_accounts where gl_code='10021'`)[0];
 s=await sugg('Bank current',{bank_account_id:one.bank_account_id});assert.equal(s.code,'10021');
 // An overdraft uses 20080; a second overdraft has no free account.
 s=await sugg('Overdraft');assert.equal(s.code,'20080');
 await bank('MANAGER',{action:'ledger_bank_save',bank_name:'Fictional Overdraft Bank',kind:'Overdraft',gl_code:'20080'});
 s=await sugg('Overdraft');assert.equal(s.code,null);assert.equal(s.state,'none_free');
 // The amendment keeps the extras already approved when a later bank needs another account.
 await db.exec(`alter table erp_private.account_catalog disable trigger user;update erp_private.account_catalog set status='Active' where code='10022';alter table erp_private.account_catalog enable trigger user;`);
 const again=await bank('MANAGER',{action:'ledger_bank_propose_chart',kind:'Bank savings',bank_name:'Fictional Bank Three'});
 assert.equal(again.state,'ready','10030 is already in the chart, so nothing is proposed');
 await bank('MANAGER',{action:'ledger_bank_save',bank_name:'Fictional Bank Three',kind:'Bank savings',gl_code:'10030'});
 const third=await bank('MANAGER',{action:'ledger_bank_propose_chart',kind:'Bank current',bank_name:'Fictional Bank Four'});
 assert.equal(third.code,'10022');assert.equal(third.state,'amendment_proposed');
 const draft2=(await tx`select extra_accounts from erp_private.client_chart_versions where version_id=${third.version_id}`)[0];
 assert.deepEqual(draft2.extra_accounts.map(x=>x.code).sort(),['10021','10022'],'the earlier approved extra is carried forward');
 // Interns cannot use it.
 await assert.rejects(()=>as('ASSISTANT',a=>bankAccountAction(tx,{...a,category_code:'INTERN'},l,{action:'ledger_bank_suggest',kind:'Bank current'})),/Assigned accounting staff/);
});
