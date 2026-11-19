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

test('client supplier aliases: exact text only, never approve a pair, Partner approval by someone else, dated, never edited',async t=>{
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
 const mk=(key,party,routing,tb,date='2026-09-10',description='Fictional goods')=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${Math.floor(Math.random()*1e6)},${'AL-'+key},'{}',${tx.json({date,amount:1000,vat:160,invoice:'AL-'+key,party,party_pin:'P000000001A',description,vat_category:'16%',routing_code:routing,tb_code:tb})})`;
 const get=key=>tx`select * from erp_private.workbook_rows where row_key=${'AL-'+key}`.then(r=>r[0]);
 const rm=(role,p)=>as(role,a=>routingMapAction(tx,a,{client_id:C,...p}));
 // One approved pair (XRT1 with a1) and one pair that is only proposed (XRT7 with a2).
 await rm('MANAGER',{action:'routing_map_propose',module:'Purchases',routing_code:'XRT1',item_code:a1.code,erp_account_code:a1.code,effective_from:'2026-09-01'});
 const pairMap=(await rm('PARTNER',{action:'routing_map_read'})).maps.find(x=>x.routing_code==='XRT1');
 await rm('PARTNER',{action:'routing_map_approve',routing_id:pairMap.routing_id,revision:pairMap.revision});
 await rm('MANAGER',{action:'routing_map_propose',module:'Purchases',routing_code:'XRT7',item_code:a2.code,erp_account_code:a2.code,effective_from:'2026-09-01'});
 await mk('S1','Mlima Supplies Ltd','','');await mk('S2','  MLIMA   SUPPLIES, LTD. ','','');await mk('S3','Mlima Supplies Limited','','');
 await mk('S4','Mlima Supplies Ltd','XRT9',a2.code);await mk('S5','Other Trading Co','','');await mk('S6','Mlima Supplies Ltd','','','2026-08-20');
 // Nothing is mapped before an alias is approved, and the supplier name alone never maps a row.
 assert.equal((await auto('ASSISTANT',{action:'workbook_auto_map'})).mapped,0);
 // Staff cannot propose; a pair that is not approved cannot be pointed at; the form's issues are named.
 await assert.rejects(()=>rm('ASSISTANT',{action:'routing_map_alias_propose',party:'Mlima Supplies Ltd',routing_code:'XRT1',item_code:a1.code,effective_from:'2026-09-01'}),/Manager or Partner proposes/);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_alias_propose',party:'Mlima Supplies Ltd',routing_code:'XRT7',item_code:a2.code,effective_from:'2026-09-01'}),/not an approved mapping/);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_alias_propose',party:'',routing_code:'XRT1',item_code:a1.code,effective_from:'2026-09-01'}),/supplier name/);
 const prop=await rm('MANAGER',{action:'routing_map_alias_propose',party:'Mlima Supplies Ltd',routing_code:'xrt1',item_code:a1.code,effective_from:'2026-09-01'});assert.equal(prop.party_key,'mlima supplies ltd');
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_alias_propose',party:'MLIMA SUPPLIES LTD.',routing_code:'XRT1',item_code:a1.code,effective_from:'2026-09-15'}),/already covers/);
 assert.equal((await auto('ASSISTANT',{action:'workbook_auto_map'})).mapped,0,'a draft alias maps nothing');
 const al=(await rm('MANAGER',{action:'routing_map_alias_read'})).aliases[0];assert.equal(al.status,'Draft');
 // Only a Partner who did not propose it approves.
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_alias_approve',alias_id:al.alias_id,revision:al.revision}),/Partner approves/);
 await rm('PARTNER',{action:'routing_map_alias_propose',party:'Own Partner Co',routing_code:'XRT1',item_code:a1.code,effective_from:'2026-09-01'});
 const own=(await rm('PARTNER',{action:'routing_map_alias_read'})).aliases.find(x=>x.party_key==='own partner co');
 await assert.rejects(()=>rm('PARTNER',{action:'routing_map_alias_approve',alias_id:own.alias_id,revision:own.revision}),/did not propose it/);
 assert.deepEqual(await rm('PARTNER',{action:'routing_map_alias_approve',alias_id:al.alias_id,revision:al.revision}),{ok:true});
 // The approved alias maps exact text after the fixed clean-up and nothing else.
 const run=await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal(run.mapped,2);assert.equal(run.via_alias,2);assert.equal(run.via_routing_map,2);
 const s1=await get('S1');assert.equal(s1.account_code,a1.code);assert.equal(s1.review_details.mapping_confirmation.via,'alias');assert.equal(s1.review_details.mapping_confirmation.alias_id,al.alias_id);assert.equal(s1.review_details.mapping_confirmation.method,ROUTING_METHOD);
 assert.equal((await get('S2')).account_code,a1.code,'spacing, case and punctuation are cleaned up');
 assert.equal((await get('S3')).account_code,null,'a similar name never maps');
 assert.equal((await get('S4')).account_code,null,'a file code that disagrees with the alias is not overridden');
 assert.equal((await get('S5')).account_code,null);assert.equal((await get('S6')).account_code,null,'before the alias start date');
 // An alias never approves a pair: when the pair is withdrawn, the alias maps nothing and says why.
 const live=(await rm('MANAGER',{action:'routing_map_read'})).maps.find(x=>x.routing_id===pairMap.routing_id);
 await rm('MANAGER',{action:'routing_map_withdraw',routing_id:live.routing_id,revision:live.revision,reason:'Pair withdrawn for the alias test'});
 await mk('S7','Mlima Supplies Ltd','','');
 const run2=await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal(run2.mapped,0);assert.equal((await get('S7')).account_code,null);assert.match((await get('S7')).review_details.auto_map_note.reason,/alias never approves a pair/);
 // Approved aliases are never edited or deleted; they are ended with a reason.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_routing_alias set party_key='someone else' where alias_id=${al.alias_id}`),/cannot be edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.client_routing_alias where alias_id=${al.alias_id}`),/./);
 const cur=(await rm('MANAGER',{action:'routing_map_alias_read'})).aliases.find(x=>x.alias_id===al.alias_id);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_alias_end',alias_id:al.alias_id,revision:cur.revision,effective_to:'2026-09-30',reason:'short'}),/at least 10/);
 assert.deepEqual(await rm('MANAGER',{action:'routing_map_alias_end',alias_id:al.alias_id,revision:cur.revision,effective_to:'2026-09-30',reason:'Supplier changed what it sells to us'}),{ok:true});
 const ended=(await rm('MANAGER',{action:'routing_map_alias_read'})).aliases.find(x=>x.alias_id===al.alias_id);assert.equal(new Date(ended.effective_to).toISOString().slice(0,10),'2026-09-30');
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_alias_end',alias_id:al.alias_id,revision:ended.revision,effective_to:'2026-10-31',reason:'Trying to move the end date'}),/already|cannot be moved|without an end date/);
 assert.equal((await get('S1')).account_code,a1.code,'rows already mapped keep their account');
 // Interns and administrators cannot read or use the alias list.
 actors.INTERN={...actors.ASSISTANT,category_code:'INTERN'};
 await assert.rejects(()=>rm('INTERN',{action:'routing_map_alias_read'}),/maintained by staff/);
});
