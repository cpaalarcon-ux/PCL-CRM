import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {isoWeek,profitByActivity,profitReport}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,{download:async()=>({data:null})}));

test('ISO week and new industry accounts in the profit report',()=>{
 assert.deepEqual(isoWeek('2026-11-04'),{year:2026,week:45,starts_on:'2026-11-02',ends_on:'2026-11-08',label:'2026 – Week 45'});
 assert.equal(isoWeek('2026-01-01').week,1);assert.equal(isoWeek('2021-01-03').week,53);
 const p=profitReport([{account_code:'40200',debit:0,credit:500},{account_code:'50170',debit:200,credit:0}]);
 assert.equal(p.sales,500,'rooms revenue (40200) counts as sales');assert.equal(p.cost_of_sales,200,'food and beverage cost (50170) counts as cost of sales');
 const a=[{activity_id:'a1',activity_name:'Hotel',pack_code:'Hospitality'}],r=profitByActivity([{account_code:'40200',debit:0,credit:500,activity_id:'a1'},{account_code:'40000',debit:0,credit:100,activity_id:null}],a);
 assert.equal(r.activities[0].sales,500);assert.equal(r.unallocated.sales,100);assert.equal(r.total.sales,600);
});

test('journal lines carry the activity, profit is reported per activity, reports are reviewed and exported',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'ACTQA','Fictional activity firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional activity client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional activity project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const W=id(),R=id();
 await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id}),(${R},${C},'retail',false,'Retail','Retail trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;

 await assert.rejects(()=>ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2024-01-01',ends_on:'2024-12-31'}),/periods ending 31 December 2025 onwards/);
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id};
 const jr=async jid=>ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:jid});
 const post=async jid=>{let x=await jr(jid);await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:jid,revision:x.journal.revision});x=await jr(jid);await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:jid,revision:x.journal.revision,status:'Posted',review_note:'Fictional independent review.'});};
 const line=(code,debit,credit,activity_id)=>({account_code:code,debit,credit,activity_id,source_status:'Confirmed',source_reference:'Fictional source'});
 const opening=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-2026',journal_date:'2026-01-01',evidence:'Fictional approved TB',lines:[line('10000',1000,0),line('30000',0,1000)]});await post(opening.journal_id);
 const sales=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Adjustment',reference:'SALES-JAN',journal_date:'2026-01-31',evidence:'Fictional sales schedules',lines:[line('10000',900,0),line('40000',0,600,W),line('40000',0,250,R),line('40000',0,50,null)]});await post(sales.journal_id);
 const stored=await tx`select account_code,activity_id from erp_private.ledger_lines where journal_id=${sales.journal_id} order by line_no`;
 assert.equal(stored[0].activity_id,null,'balance-sheet lines carry no activity');assert.equal(stored[1].activity_id,W);assert.equal(stored[2].activity_id,R);
 await assert.rejects(()=>tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,debit,credit,activity_id) values(${sales.journal_id},${P},99,'10000',1,0,${W})`,/Only income and expense lines/);

 const r=await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'});
 const col=name=>r.profit_by_activity.activities.find(a=>a.activity_name===name);
 assert.equal(col('Wholesale trade').sales,600);assert.equal(col('Retail trade').sales,250);assert.equal(r.profit_by_activity.unallocated.sales,50);assert.equal(r.profit_by_activity.total.sales,900);
 assert.equal(r.current_week.week>=1,true);assert.equal(r.prior_year.source,'Opening balances');assert.equal(r.data_cutoff,'2025-12-31');

 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_report_submit',report_kind:'Month',as_of:'2026-01-31',prepared_note:'short'}),/at least 10 characters/);
 await ledger('ASSISTANT',{...base,action:'ledger_report_submit',report_kind:'Month',as_of:'2026-01-31',prepared_note:'January sales agree to the fictional schedules.'});
 let rv=(await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'})).report_reviews[0];
 assert.equal(rv.status,'Submitted');assert.equal(rv.starts_on.toISOString?rv.starts_on.toISOString().slice(0,10):String(rv.starts_on).slice(0,10),'2026-01-01');
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status:'Approved',review_note:'Self approval attempt'}),/Manager or Partner/);
 await ledger('MANAGER',{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status:'Approved',review_note:'Checked to the January schedules.'});
 rv=(await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'})).report_reviews[0];assert.equal(rv.status,'Approved');

 const x=await ledger('ASSISTANT',{...base,action:'ledger_report_export',report_kind:'Year to date',as_of:'2026-12-31'});
 assert.match(x.file_name,/\.xlsx$/);assert.ok(x.base64.length>1000,'an Excel workbook is returned');
});
