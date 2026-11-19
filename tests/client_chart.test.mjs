import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientChartAction,requireChartAccount,proposeAccounts}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {journalIssues}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chart=(role,p)=>as(role,a=>clientChartAction(tx,a,p));
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,{download:async()=>({data:null})}));

test('proposed accounts follow the entity type and the industry packs',()=>{
 const accounts=[{code:'10000',status:'Active',entity_types:[],industry_packs:[]},{code:'30000',status:'Active',entity_types:['Limited company'],industry_packs:[]},{code:'35000',status:'Active',entity_types:['Sole proprietor'],industry_packs:[]},{code:'40200',status:'Active',entity_types:[],industry_packs:['Hospitality']},{code:'40160',status:'Draft',entity_types:[],industry_packs:['Construction']}];
 assert.deepEqual(proposeAccounts(accounts,'Sole proprietor',['Hospitality']).map(x=>x.code),['10000','35000','40200']);
 assert.deepEqual(proposeAccounts(accounts,'Limited company',['Construction']).map(x=>x.code),['10000','30000'],'Draft accounts wait for Partner approval');
 assert.match(journalIssues([{line_no:1,account_code:'35000',debit:10,credit:0},{line_no:2,account_code:'10000',debit:0,credit:10}],[{code:'35000',status:'Active',in_client_chart:false},{code:'10000',status:'Active',in_client_chart:true}]).join(' '),/not in this client's approved chart/);
});

test('a client chart is proposed with exceptions cleared, independently approved, then limits accounts',async t=>{
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

 await assert.rejects(()=>chart('MANAGER',{action:'v3_client_chart_propose',client_id:C,effective_from:'2026-01-01'}),/at least one business activity/);
 await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${C},'construction',true,'Construction','Construction and building works','Business','2026-01-01','Fictional CR12',${actors.MANAGER.staff_id})`;
 await as('MANAGER',a=>tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,created_by) values(${C},'TL-1','Fictional tourism levy','21608','2026-01-01',${a.staff_id})`);

 let r=await chart('ASSISTANT',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-01-01'});
 assert.equal(r.status,'Not approved');assert.deepEqual(r.packs,['Construction']);
 const codes=new Set(r.accounts.map(x=>x.code));
 assert.ok(codes.has('30000')&&codes.has('10020'),'company equity and core accounts are proposed');
 assert.ok(!codes.has('35000')&&!codes.has('36000'),'sole-proprietor and partnership equity are excluded');
 assert.ok(r.awaiting_partner_approval.some(x=>x.code==='40160'),'Draft construction accounts are listed as awaiting Partner approval');
 assert.deepEqual(r.exceptions.map(x=>x.code),['21608'],'a used account outside the proposal is an exception');

 await assert.rejects(()=>chart('ASSISTANT',{action:'v3_client_chart_review',version_id:id(),revision:1,status:'Approved',review_note:'An Assistant cannot approve a chart'}),/Partner or Manager/);
 await assert.rejects(()=>chart('MANAGER',{action:'v3_client_chart_propose',client_id:C,effective_from:'2026-01-01'}),/already used by the client/);
 await assert.rejects(()=>chart('MANAGER',{action:'v3_client_chart_propose',client_id:C,effective_from:'2026-01-01',extra_accounts:[{code:'35000',reason:'Fictional wrong entity'}]}),/Sole proprietor only/);
 await chart('MANAGER',{action:'v3_client_chart_propose',client_id:C,effective_from:'2026-01-01',extra_accounts:[{code:'21608',reason:'Client runs a site canteen subject to the levy'}]});
 r=await chart('MANAGER',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-01-01'});
 assert.equal(r.status,'Pending review');
 const draft=r.draft;
 await assert.rejects(()=>chart('MANAGER',{action:'v3_client_chart_review',version_id:draft.version_id,revision:draft.revision,status:'Approved',review_note:'Self approval attempt'}),/different Manager or Partner/);
 // Books set-up pack: Construction carries stock, so the approver sees the gaps and must confirm they looked before approving.
 assert.equal(r.books_pack.stock_needed,true);assert.equal(r.books_pack.complete,false);
 assert.match(r.books_pack.gaps.join(' | '),/Stock update method and count frequency are not set for Construction and building works/);
 assert.match(r.books_pack.gaps.join(' | '),/No stock categories/);assert.match(r.books_pack.gaps.join(' | '),/VAT categories sold are not set/);
 const bp=await chart('ASSISTANT',{action:'v3_books_pack_read',client_id:C,effective_from:'2026-01-01'});assert.equal(bp.stock_step_done,false);
 await assert.rejects(()=>chart('PARTNER',{action:'v3_client_chart_review',version_id:draft.version_id,revision:draft.revision,status:'Approved',review_note:'Entity layer and construction pack checked.'}),/Confirm that you reviewed the Books set-up pack/);
 await chart('PARTNER',{action:'v3_client_chart_review',version_id:draft.version_id,revision:draft.revision,status:'Approved',review_note:'Entity layer and construction pack checked.',books_pack_reviewed:true});
 const audit=(await tx`select after_values from erp_private.audit_events where action='BOOKS_PACK_REVIEWED' and record_key=${draft.version_id}`);
 assert.equal(audit.length,1,'the review of the pack is recorded');assert.ok(audit[0].after_values.gaps.length>=3,'the gaps the approver saw are kept');assert.equal(audit[0].after_values.reviewed_by,actors.PARTNER.staff_id);
 r=await chart('MANAGER',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-01-01'});
 assert.equal(r.status,'Approved');
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_chart_versions set accounts=array['10000'] where version_id=${draft.version_id}`),/cannot be edited/);
 // Once the stock settings, categories and VAT categories are saved (reusing the existing tables), the pack is complete and the stock step is done.
 const act=(await tx`select activity_id from erp_private.client_activities where client_id=${C} limit 1`)[0].activity_id;
 await as('MANAGER',a=>tx`insert into erp_private.stock_policy_versions(client_id,activity_id,inventory_method,valuation_basis,effective_from,count_frequency,evidence,configured_by) values(${C},${act},'Periodic','Weighted average','2026-01-02','Monthly','Fictional stock policy evidence',${a.staff_id})`);
 await as('MANAGER',a=>tx`insert into erp_private.stock_categories(client_id,activity_id,inventory_use,stock_class,created_by) values(${C},${act},'Construction raw materials','Cement and sand',${a.staff_id})`);
 await tx`update erp_private.clients set vat_categories_sold=array['16%'] where client_id=${C}`;
 const done=await chart('ASSISTANT',{action:'v3_books_pack_read',client_id:C,effective_from:'2026-03-01'});
 assert.equal(done.books_pack.complete,true);assert.equal(done.stock_step_done,true);assert.equal(done.books_pack.activities[0].policy.count_frequency,'Monthly');assert.deepEqual(done.books_pack.activities[0].categories.map(x=>x.stock_class),['Cement and sand']);
 const early=await chart('ASSISTANT',{action:'v3_books_pack_read',client_id:C,effective_from:'2026-01-01'});
 assert.match(early.books_pack.gaps.join(' | '),/start on 2026-01-02, after the date this chart applies from/,'settings that start later are a named gap, not assumed');

 await requireChartAccount(tx,C,'30000','2026-02-01');
 await requireChartAccount(tx,C,'21608','2026-02-01');
 await assert.rejects(()=>requireChartAccount(tx,C,'35000','2026-02-01'),/not in this client's approved chart/);
 await requireChartAccount(tx,C,'35000','2025-12-31');

 const periods=await ledger('MANAGER',{action:'ledger_periods',project_id:P}),flag=code=>periods.accounts.find(x=>x.code===code)?.in_client_chart;
 assert.equal(flag('30000'),true);assert.equal(flag('35000'),false,'ledger account choices mark accounts outside the chart');
});
