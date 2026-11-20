import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
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
 await readyForLedger(tx,C);
 const W=id(),R=id();
 await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id}),(${R},${C},'retail',false,'Retail','Retail trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;

 await assert.rejects(()=>ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2024-01-01',ends_on:'2024-12-31'}),/periods ending 31 December 2025 onwards/);
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id};
 const jr=async jid=>ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:jid});
 const post=async jid=>{let x=await jr(jid);await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:jid,revision:x.journal.revision});await checkJournal(tx,jid);x=await jr(jid);await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:jid,revision:x.journal.revision,status:'Posted',review_note:'Fictional independent review.'});};
 const line=(code,debit,credit,activity_id)=>({account_code:code,debit,credit,activity_id,source_status:'Confirmed',source_reference:'Fictional source'});
 const opening=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-2026',journal_date:'2026-01-01',evidence:'Fictional approved TB',lines:[line('10000',1000,0),line('30000',0,1000)]});await post(opening.journal_id);
 const sales=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Adjustment',reference:'SALES-JAN',journal_date:'2026-01-31',evidence:'Fictional sales schedules',lines:[line('10000',900,0),line('40000',0,600,W),line('40000',0,250,R),line('40000',0,50,null)]});await post(sales.journal_id);
 const stored=await tx`select account_code,activity_id from erp_private.ledger_lines where journal_id=${sales.journal_id} order by line_no`;
 assert.equal(stored[0].activity_id,null,'balance-sheet lines carry no activity');assert.equal(stored[1].activity_id,W);assert.equal(stored[2].activity_id,R);
 const draft=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Adjustment',reference:'DRAFT-TAG',journal_date:'2026-02-28',evidence:'Fictional draft',lines:[line('10000',1,0),line('40000',0,1,W)]});
 await assert.rejects(()=>tx`update erp_private.ledger_lines set activity_id=${W} where journal_id=${draft.journal_id} and line_no=1`,/Only income and expense lines/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Adjustment',reference:'BAD-TAG',journal_date:'2026-02-28',evidence:'Fictional draft',lines:[line('10000',1,0),line('40000',0,1,id())]}),/does not belong to the client/);

 const r=await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'});
 const col=name=>r.profit_by_activity.activities.find(a=>a.activity_name===name);
 assert.equal(col('Wholesale trade').sales,600);assert.equal(col('Retail trade').sales,250);assert.equal(r.profit_by_activity.unallocated.sales,50);assert.equal(r.profit_by_activity.total.sales,900);
 assert.deepEqual(r.unmapped,{count:0,value:0},'the trial balance reports unmapped purchase rows (none here)');assert.equal(r.current_week.week>=1,true);assert.equal(r.prior_year.source,'Opening balances');assert.equal(r.data_cutoff,'2025-12-31');

 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_report_submit',report_kind:'Month',as_of:'2026-01-31',prepared_note:'short'}),/at least 10 characters/);
 await ledger('ASSISTANT',{...base,action:'ledger_report_submit',report_kind:'Month',as_of:'2026-01-31',prepared_note:'January sales agree to the fictional schedules.'});
 let rv=(await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'})).report_reviews[0];
 assert.equal(rv.status,'Submitted');assert.equal(rv.starts_on.toISOString?rv.starts_on.toISOString().slice(0,10):String(rv.starts_on).slice(0,10),'2026-01-01');
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status:'Approved',review_note:'Self approval attempt'}),/Manager or Partner/);
 await ledger('MANAGER',{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status:'Approved',review_note:'Checked to the January schedules.'});
 rv=(await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'})).report_reviews[0];assert.equal(rv.status,'Approved');

 const x=await ledger('ASSISTANT',{...base,action:'ledger_report_export',report_kind:'Year to date',as_of:'2026-12-31'});
 assert.match(x.file_name,/\.xlsx$/);assert.ok(x.base64.length>1000,'an Excel workbook is returned');
 // Build 2815: the export is a Draft unless every readiness check passes; the final report is refused with the open checks named.
 assert.equal(x.mark,'DRAFT');assert.match(x.file_name,/_DRAFT\.xlsx$/);
 // The approval above is for the January report; the year-to-date report has no sign-off of its own.
 const gate=await ledger('ASSISTANT',{...base,action:'ledger_report_gate',report_kind:'Month',as_of:'2026-01-31'}),by=Object.fromEntries(gate.gate.checks.map(c=>[c.code,c]));
 assert.equal(gate.gate.ready,false);assert.equal(by.SIGN_OFF.ok,true,by.SIGN_OFF.detail);assert.equal(by.TB_BALANCED.ok,true);assert.equal(by.TOTALS_TIE.ok,true,by.TOTALS_TIE.detail);assert.equal(by.SOURCES.ok,false);
 const ytd=await ledger('ASSISTANT',{...base,action:'ledger_report_gate',report_kind:'Year to date',as_of:'2026-12-31'});assert.equal(ytd.gate.checks.find(c=>c.code==='SIGN_OFF').ok,false);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_export',report_kind:'Month',as_of:'2026-01-31',final:true}),/The final report is blocked\./);
 // Build 2817: stock is a warning, not a blocker, and a documented "nothing to report" declaration satisfies source completeness without filing anything.
 assert.equal(by.EXCEPTIONS.ok,true,by.EXCEPTIONS.detail);assert.deepEqual(gate.gate.warnings.map(w=>w.code),['STOCK']);assert.match(gate.gate.warnings[0].detail,/does not stop the report/);
 const dec={...base,action:'ledger_declaration_record',source_key:'payroll',obligation_code:'PAYE',month:'2026-01',declarant_name:'Fictional Client Director',declared_on:'2026-02-03',reason:'No employees were paid in January 2026.'};
 await assert.rejects(()=>ledger('ASSISTANT',dec),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>ledger('MANAGER',{...dec,reason:'None'}),/at least 15 characters/);
 await assert.rejects(()=>ledger('MANAGER',{...dec,month:'2027-01'}),/outside this client financial year/);
 await assert.rejects(()=>ledger('MANAGER',{...dec,declared_on:'2099-01-01'}),/cannot be in the future/);
 await assert.rejects(()=>ledger('MANAGER',{...dec,declarant_name:''}),/./);
 const filedBefore=(await tx`select count(*)::int n from erp_private.tax_cases`)[0].n;
 const made=await ledger('MANAGER',dec);assert.equal(made.ok,true);assert.match(made.note,/still filed and acknowledged as its own step/);
 await assert.rejects(()=>ledger('MANAGER',dec),/already covers this source, obligation and month/);
 const g2=await ledger('ASSISTANT',{...base,action:'ledger_report_gate',report_kind:'Month',as_of:'2026-01-31'});
 assert.equal(g2.gate.checks.find(c=>c.code==='SOURCES').ok,true);assert.equal(g2.sources.find(r=>r.key==='payroll').state,'Nothing to report');assert.deepEqual(g2.gate.failing,['JOURNALS'],'only the journals still waiting keep this report a draft; sources, exceptions and the stock warning do not');
 // The stock warning and the declared source do not appear among the reasons the final report is refused.
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_export',report_kind:'Month',as_of:'2026-01-31',final:true}),e=>/The final report is blocked\./.test(e.message)&&!/Stock|Expected sources/.test(e.message));
 // Nothing was filed, acknowledged or approved by the declaration.
 assert.equal((await tx`select count(*)::int n from erp_private.tax_cases`)[0].n,filedBefore);
 const listed=await ledger('ASSISTANT',{...base,action:'ledger_declaration_list'}).catch(e=>e);assert.match(String(listed.message),/Supervisor, Manager or Partner/);
 const list=await ledger('MANAGER',{...base,action:'ledger_declaration_list'});assert.equal(list.declarations.length,1);assert.equal(list.declarations[0].declarant_name,'Fictional Client Director');assert.ok(list.declarations[0].recorded_by_name);
 // The facts are never edited and never deleted; the declaration is ended with a reason, after which the source check fails again.
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.source_declarations set reason='Changed my mind about this one' where declaration_id=${made.declaration_id}`),/never edited/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.source_declarations where declaration_id=${made.declaration_id}`),/./);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_declaration_end',declaration_id:made.declaration_id,reason:'no'}),/at least 5/);
 await ledger('MANAGER',{...base,action:'ledger_declaration_end',declaration_id:made.declaration_id,reason:'The client later sent a payroll run.'});
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_declaration_end',declaration_id:made.declaration_id,reason:'Again, ending twice'}),/already been ended/);
 const g3=await ledger('ASSISTANT',{...base,action:'ledger_report_gate',report_kind:'Month',as_of:'2026-01-31'});assert.equal(g3.gate.checks.find(c=>c.code==='SOURCES').ok,false);
 // Build 2817: the annual statements pack goes through the same gate, with its own annual checks; the draft is marked and the final release is refused by the server.
 const ann=await ledger('ASSISTANT',{...base,action:'ledger_pack_statements',as_of:'2026-12-31'});
 assert.equal(ann.gate.ready,false);assert.equal(ann.status,'Draft - not ready');assert.equal(ann.gate.mark,'DRAFT');
 for(const c of ['A_COMPARATIVES','A_STATEMENTS','SIGN_OFF'])assert.ok(ann.gate.failing.includes(c),c+' should be open: '+ann.gate.failing);
 assert.ok(ann.gate.checks.some(c=>c.code==='A_MAP_APPROVED'),'the statement-line map is an annual check');
 assert.deepEqual(ann.gate.warnings.map(w=>w.code),['STOCK']);assert.equal(ann.gate.failing.includes('EXCEPTIONS'),false,'the stock line is not an open exception');
 const annReady=await ledger('ASSISTANT',{...base,action:'ledger_pack_readiness',as_of:'2026-12-31'});assert.equal(annReady.final,false);assert.ok(annReady.checks.some(c=>c.code==='SOURCES'));assert.ok(annReady.checks.some(c=>c.code==='SIGN_OFF'));assert.equal(annReady.checks.at(-1).code,'SIGN_OFF');
 const annX=await ledger('ASSISTANT',{...base,action:'ledger_pack_export',as_of:'2026-12-31'});assert.equal(annX.mark,'DRAFT');assert.match(annX.file_name,/_Annual_statements_2026-12-31_DRAFT\.xlsx$/);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_pack_export',as_of:'2026-12-31',final:true}),/The final annual statements are blocked\./);
 {const ExcelJS2=(await import('exceljs')).default,w2=new ExcelJS2.Workbook();await w2.xlsx.load(Buffer.from(annX.base64,'base64'));assert.ok(w2.worksheets.length>=2);for(const ws of w2.worksheets)assert.match(String(ws.getRow(1).getCell(1).value),/^DRAFT/,ws.name);}
 // The draft workbook says so on every sheet.
 const ExcelJS=(await import('exceljs')).default,wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(x.base64,'base64'));
 for(const ws of wb.worksheets)assert.match(String(ws.getRow(1).getCell(1).value),/^DRAFT/,ws.name);
});
