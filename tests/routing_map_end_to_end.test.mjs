import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
import {approveChart} from './helpers/chart-and-posting.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {autoMapAction}=await import('../supabase/functions/staff-workspace-v12/auto-map.ts');
const {routingMapAction}=await import('../supabase/functions/staff-workspace-v12/routing-map-actions.ts');
const {ROUTING_METHOD}=await import('../supabase/functions/staff-workspace-v12/auto-map.ts');
const {assertSupportedPeriod}=await import('../supabase/functions/staff-workspace-v12/supported-period.ts');
const {loadCrosswalk,revenueAccount}=await import('../supabase/functions/staff-workspace-v12/sales-crosswalk.ts');
const {firstSupportedStart}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),map=(role,p)=>as(role,a=>accountingAction(tx,a,p)),auto=(role,p)=>as(role,a=>autoMapAction(tx,a,{project_id:P,...p}));

test('the approved routing map: one approval maps every row with the code for its dates; rows without a single approved match are left with a reason; a maker never approves',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await approveChart(tx,{C,prepared:actors.MANAGER.staff_id,reviewed:actors.PARTNER.staff_id});
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const W=id();await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await call('MANAGER',{action:'v3_stock_policy_add',client_id:C,activity_id:W,inventory_method:'Periodic',effective_from:'2026-01-02',count_frequency:'Monthly'});
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',5,5,0,0,${actors.ASSISTANT.staff_id})`;
 const acct=(await tx`select code,category_code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy order by code limit 3`),[a1,a2]=acct;
 const mk=(key,routing,tb,date='2026-09-10')=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${Math.floor(Math.random()*1e6)},${'RM-'+key},'{}',${tx.json({date,amount:1000,vat:160,invoice:'RM-'+key,party:'Fictional supplier',party_pin:'P000000001A',description:'Fictional goods',vat_category:'16%',routing_code:routing,tb_code:tb})})`;
 await mk('A1','XRT1',a1.code);await mk('A2','XRT1',a1.code);await mk('LATE','XRT1',a1.code,'2026-12-20');await mk('NOMAP','XRT9',a2.code);await mk('CODEONLY','','');await mk('NOTB','XRT1','');
 const get=key=>tx`select * from erp_private.workbook_rows where row_key=${'RM-'+key}`.then(r=>r[0]);
 const rm=(role,p)=>as(role,a=>routingMapAction(tx,a,{client_id:C,...p}));
 // Before any approval nothing is mapped, and the reason names the code.
 const none=await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal(none.mapped,0);assert.deepEqual(none.unmapped_routing_codes.map(x=>[x.routing_code,x.rows]),[['XRT1',4],['XRT9',1]]);assert.equal(none.suggested_awaiting_approval,4,'valid pairs with no approved mapping are only suggestions');assert.equal((await get('NOTB')).review_details.auto_map_note.code,'TB_BLANK','a routing code without a TB code is an exception');assert.equal((await get('CODEONLY')).review_details.auto_map_note.code,'NO_CODES');
 assert.match((await get('A1')).review_details.auto_map_note.reason,/XRT1 has no approved mapping/);
 // Staff propose; a draft maps nothing.
 await assert.rejects(()=>rm('ASSISTANT',{action:'routing_map_propose',module:'Purchases',routing_code:'XRT1',erp_account_code:a1.code,effective_from:'2026-09-01'}),/Manager or Partner proposes/);
 const prop=await rm('MANAGER',{action:'routing_map_propose',module:'Purchases',routing_code:'xrt1',erp_account_code:a1.code,effective_from:'2026-09-01',effective_to:'2026-10-31'});assert.equal(prop.saved,1);
 assert.equal((await auto('ASSISTANT',{action:'workbook_auto_map'})).mapped,0,'a draft is not approved');
 const dup=await rm('MANAGER',{action:'routing_map_propose',rows:[{module:'Purchases',routing_code:'XRT1',erp_account_code:a2.code,effective_from:'2026-10-01'}]}).catch(e=>e);assert.match(String(dup.message),/already covers/);
 const bad=await rm('MANAGER',{action:'routing_map_propose',module:'Purchases',routing_code:'XRT2',erp_account_code:'11010',effective_from:'2026-09-01'}).catch(e=>e);assert.match(String(bad.message),/not a purchase account|not active|chart of accounts/);
 const list=await rm('MANAGER',{action:'routing_map_read'}),m=list.maps[0];assert.equal(m.version,1);assert.equal(m.status,'Draft');assert.equal(m.routing_code,'XRT1');
 // The proposer cannot approve it, and neither can another Manager: only a Partner who did not propose it.
 await assert.rejects(()=>rm('ASSISTANT',{action:'routing_map_approve',routing_id:m.routing_id,revision:m.revision}),/Partner approves/);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_approve',routing_id:m.routing_id,revision:m.revision}),/Partner approves/);
 const own=await rm('PARTNER',{action:'routing_map_propose',module:'Purchases',routing_code:'XRT5',erp_account_code:a1.code,effective_from:'2026-09-01'});assert.equal(own.saved,1);
 const mine=(await rm('PARTNER',{action:'routing_map_read'})).maps.find(x=>x.routing_code==='XRT5');
 await assert.rejects(()=>rm('PARTNER',{action:'routing_map_approve',routing_id:mine.routing_id,revision:mine.revision}),/did not propose it/);
 assert.deepEqual(await rm('PARTNER',{action:'routing_map_approve',routing_id:m.routing_id,revision:m.revision}),{ok:true});
 // One approval maps every row with the code that falls inside its dates; the rest keep their reason.
 const run=await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal(run.mapped,2);assert.equal(run.via_routing_map,2);
 const a=await get('A1');assert.equal(a.account_code,a1.code);assert.equal(a.review_details.mapping_confirmation.method,ROUTING_METHOD);assert.equal(a.review_details.mapping_confirmation.awaiting_review,true);assert.equal(a.review_details.mapping_confirmation.routing_map_id,m.routing_id);assert.equal(a.review_details.mapping_confirmation.routing_map_version,1);
 assert.equal((await get('A2')).account_code,a1.code);
 const late=await get('LATE');assert.equal(late.account_code,null);assert.match(late.review_details.auto_map_note.reason,/not one that covers 2026-12-20/);
 assert.equal((await get('NOMAP')).account_code,null);assert.match((await get('NOMAP')).review_details.auto_map_note.reason,/XRT9 has no approved mapping/);
 // The mapping is never edited; it is ended or withdrawn with a reason.
 const live=(await rm('PARTNER',{action:'routing_map_read'})).maps.find(x=>x.routing_id===m.routing_id);
 await assert.rejects(()=>rm('ASSISTANT',{action:'routing_map_withdraw',routing_id:m.routing_id,revision:live.revision,reason:'Staff cannot withdraw an approved one'}),/Manager or Partner withdraws/);
 await assert.rejects(()=>rm('PARTNER',{action:'routing_map_withdraw',routing_id:m.routing_id,revision:live.revision,reason:'short'}),/at least 10/);
 assert.deepEqual(await rm('PARTNER',{action:'routing_map_withdraw',routing_id:m.routing_id,revision:live.revision,reason:'Wrong account chosen for this code'}),{ok:true});
 await mk('AFTER','XRT1',a1.code);assert.equal((await auto('ASSISTANT',{action:'workbook_auto_map'})).mapped,0,'a withdrawn mapping maps nothing new');
 assert.equal((await get('A1')).account_code,a1.code,'rows already mapped keep their classification');
 await assert.rejects(()=>tx`update erp_private.client_routing_map set erp_account_code=${a2.code} where routing_id=${m.routing_id}`,/cannot be edited|withdrawn/);
 // The Manager's queue: a valid pair with no approved mapping waits as "Suggested - Awaiting Approval"; a Manager proposes it, a Partner approves it, and only then does the next automatic mapping map the rows.
 await mk('Q1','XRT7',a2.code,'2026-09-12');await mk('Q2','XRT7',a2.code,'2026-09-20');
 await auto('ASSISTANT',{action:'workbook_auto_map'});
 assert.equal((await get('Q1')).account_code,null,'a valid TB code in a file is never approval');
 const q1=await rm('MANAGER',{action:'routing_map_suggestions'});
 const pair=q1.pairs.find(x=>x.routing_code==='XRT7');assert.deepEqual([pair.tb_code,pair.rows,pair.first_date,pair.last_date,pair.state],[a2.code,2,'2026-09-12','2026-09-20','Suggested - Awaiting Approval']);
 assert.ok(q1.pairs.find(x=>x.routing_code==='XRT9'),'every waiting pair is listed');assert.ok(q1.exception_rows>=2,'rows missing a code are counted as exceptions, not suggestions');
 assert.equal(q1.pairs.some(x=>!x.routing_code||!x.tb_code),false);assert.equal(q1.can_propose,true);assert.equal(q1.can_approve,false);
 await assert.rejects(()=>rm('ASSISTANT',{action:'routing_map_suggest_propose',pairs:[{routing_code:'XRT7',tb_code:a2.code}]}),/Manager or Partner proposes/);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_suggest_propose',pairs:[{routing_code:'XRT7',tb_code:'11111'}]}),/no longer waiting/);
 assert.equal((await rm('MANAGER',{action:'routing_map_suggest_propose',pairs:[{routing_code:'XRT7',tb_code:a2.code}]})).saved,1);
 const q2=(await rm('MANAGER',{action:'routing_map_suggestions'})).pairs.find(x=>x.routing_code==='XRT7');assert.equal(q2.state,'Draft: waiting for a Partner');assert.ok(q2.draft_id);
 await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal((await get('Q1')).account_code,null,'a draft maps nothing');
 const dm=(await rm('PARTNER',{action:'routing_map_read'})).maps.find(x=>x.routing_id===q2.draft_id);assert.equal(dm.effective_from.toISOString?.().slice(0,10)||String(dm.effective_from).slice(0,10),'2026-09-12');
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_approve',routing_id:dm.routing_id,revision:dm.revision}),/Partner approves/);
 await rm('PARTNER',{action:'routing_map_approve',routing_id:dm.routing_id,revision:dm.revision});
 const done=await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal(done.mapped,2);assert.equal((await get('Q1')).account_code,a2.code);assert.equal((await get('Q1')).review_details.mapping_confirmation.method,ROUTING_METHOD);
 assert.equal((await rm('MANAGER',{action:'routing_map_suggestions'})).pairs.some(x=>x.routing_code==='XRT7'),false,'approved pairs leave the queue');
});
