import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
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
 await mapAllAccounts(tx,as,C);
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',205,205,0,0,${actors.ASSISTANT.staff_id})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const setup=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:setup.period_id};
 await assert.rejects(()=>ledger('ASSISTANT',{action:'ledger_period_create',project_id:P,starts_on:'2025-01-01',ends_on:'2025-12-31'}),/Manager or Partner/);
 await assert.rejects(()=>ledger('INTERN',{action:'ledger_periods',project_id:P}),/Interns/);await assert.rejects(()=>ledger('ASSISTANT',{action:'ledger_periods',project_id:P2}),/available/);
 const jr=async id=>await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:id});
 const submit=async id=>{const x=await jr(id);const r=await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:id,revision:x.journal.revision});await checkJournal(tx,id);return r;};
 const post=async id=>{await submit(id);const x=await jr(id);await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:id,revision:x.journal.revision,status:'Posted',review_note:'Fictional independent review of source and mapping.'});};
 const entry=(code,debit,credit)=>({account_code:code,debit,credit,source_status:'Confirmed',source_reference:'Fictional source statement'});
 const opening=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-2026',journal_date:'2026-01-01',evidence:'Fictional approved bank and capital schedules',lines:[entry('10000',100000,0),entry('30000',0,100000)]});
 await submit(opening.journal_id);let j=await jr(opening.journal_id);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_journal_review',journal_id:opening.journal_id,revision:j.journal.revision,status:'Posted',review_note:'Attempt to self approve this journal'}),/Manager or Partner/);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:opening.journal_id,revision:j.journal.revision,status:'Approved',review_note:'Obsolete separate approval state must not be accepted'}),/valid option/i,'the reviewer must approve and post in one action; there is no intermediate Approved state');
 await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:opening.journal_id,revision:j.journal.revision,status:'Posted',review_note:'Independently verified bank and share capital.'});
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.ledger_lines set debit=2 where journal_id=${opening.journal_id} and debit>0`),/draft/);
 const bad=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Adjustment',reference:'UNBALANCED',journal_date:'2026-09-30',evidence:'Fictional deliberately incomplete journal',lines:[entry('61180',1000,0),entry('20000',0,900)]});await assert.rejects(()=>submit(bad.journal_id),/No suspense/);
 // Row-level exceptions and the single-line fix: the broken entry says exactly what is wrong, a correction needs a reason and records who changed what,
 // the entry is checked again, and an entry with an open exception cannot be sent for review.
 let bx=await jr(bad.journal_id);
 assert.ok(bx.exceptions.some(e=>e.scope==='journal'&&e.kind==='OUT_OF_BALANCE'&&e.difference===100),'the imbalance is reported with its amount');
 assert.equal(bx.exception_summary.ready,false);assert.equal(bx.exception_summary.rows_total,2);assert.equal(bx.exception_summary.difference,100);
 const fixBase={...base,action:'ledger_journal_line_fix',journal_id:bad.journal_id,line_no:2};
 await assert.rejects(()=>ledger('ASSISTANT',{...fixBase,revision:bx.journal.revision,credit:1000,reason:'short'}),/reason of at least 10/);
 await assert.rejects(()=>ledger('ASSISTANT',{...fixBase,revision:bx.journal.revision,account_code:'99999',reason:'Fictional account that does not exist'}),/active detailed account|not available|Record unavailable/);
 await assert.rejects(()=>ledger('ASSISTANT',{...fixBase,revision:bx.journal.revision,credit:900,reason:'Fictional unchanged amount here'}),/Nothing was changed/);
 await assert.rejects(()=>ledger('ASSISTANT',{...fixBase,revision:bx.journal.revision,debit:5,credit:1000,reason:'Fictional both sides filled in'}),/either a debit or a credit/);
 await assert.rejects(()=>ledger('ASSISTANT',{...fixBase,revision:String(Number(bx.journal.revision)+5),credit:1000,reason:'Fictional stale revision attempt'}),/changed/);
 const fixed=await ledger('ASSISTANT',{...fixBase,revision:bx.journal.revision,credit:1000,reason:'Fictional credit corrected to the evidenced amount'});
 assert.equal(fixed.exception_summary.ready,true);assert.deepEqual(fixed.exceptions,[]);assert.equal(fixed.corrections.length,1);
 assert.deepEqual([fixed.corrections[0].before.credit,fixed.corrections[0].after.credit,fixed.corrections[0].by],[900,1000,actors.ASSISTANT.staff_id]);
 await assert.rejects(()=>ledger('SUPERVISOR',{...fixBase,revision:fixed.revision,credit:900,reason:'Fictional edit by someone not the preparer'}),/open draft|not available|Record unavailable|permission|right/i);
 const a=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Adjustment',journal_id:bad.journal_id,revision:(await jr(bad.journal_id)).journal.revision,reference:'EXPENSE',journal_date:'2026-09-30',evidence:'Fictional statutory licence and receipt',lines:[entry('61180',1000,0),entry('20000',0,1000)]});await post(a.journal_id);
 const payroll=await ledger('ASSISTANT',{...base,action:'ledger_payroll_create',reference:'PAY-SEP',journal_date:'2026-09-30',gross_pay:99000,paye:10000,employer_nssf:3000,evidence:'Fictional draft payroll schedule'});
 let px=await jr(payroll.journal_id);await ledger('ASSISTANT',{...base,action:'ledger_journal_metadata',journal_id:payroll.journal_id,revision:px.journal.revision,reference:'PAY-SEP',journal_date:'2026-09-30',evidence:'Fictional authorised payroll schedule, corrected source'});
 px=await jr(payroll.journal_id);await ledger('ASSISTANT',{...base,action:'ledger_payroll_create',journal_id:payroll.journal_id,revision:px.journal.revision,reference:'PAY-SEP',journal_date:'2026-09-30',gross_pay:100000,paye:10000,employer_nssf:3000,evidence:'Fictional corrected authorised payroll schedule'});await post(payroll.journal_id);
 px=await jr(payroll.journal_id);await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_journal_metadata',journal_id:payroll.journal_id,revision:px.journal.revision,reference:'REWRITE',journal_date:'2026-09-30',evidence:'Attempted rewrite after approval'}),/open draft/);
 const source=(await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,account_code,category_code,asset_details,first_use_status,first_use_date,narration) values(${B},${P},${C},'Purchases',2,'LEDGER-SOURCE','{}','{"date":"2026-09-01","invoice":"TEST-PPE","amount":100000,"vat":16000,"description":"Fictional computer"}',3,'15006','PPE25C','Fictional computer','In use','2026-09-01','Fictional computer') returning *`)[0];
 await tx`insert into erp_private.tax_row_reviews(row_id,project_id,source_revision,decision,deductible_percentage,income_treatment,reason,reviewed_by) values(${source.row_id},${P},${source.revision},'Eligible',100,'Capital','Fictional independent capital and VAT review',${actors.SUPERVISOR.staff_id})`;
 const purchase=await ledger('ASSISTANT',{...base,action:'ledger_generate_sources',kind:'Purchases',row_ids:[source.row_id],reference:'PPE-SOURCE',journal_date:'2026-09-30',evidence:'Fictional original invoice and review'});assert.equal((await ledger('ASSISTANT',{...base,action:'ledger_generate_sources',kind:'Purchases',row_ids:[source.row_id]})).reused,true);await post(purchase.journal_id);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.workbook_rows set narration='Attempted rewrite of posted source' where row_id=${source.row_id}`),/Posted|posted/);
 const rates=(await ledger('ASSISTANT',{action:'ledger_periods',project_id:P})).rates,computer=rates.find(x=>x.class_code==='COMPUTER'),motor=rates.find(x=>x.class_code==='MOTOR');
 const ap={...base,action:'ledger_asset_save',source_row_id:source.row_id,asset_name:'Fictional computer',asset_account:'15006',rate_id:computer.rate_id,first_use_date:'2026-01-01',cost:0,business_percentage:100,noncommercial_vehicle:false,evidence:'Fictional source invoice, ownership and first use'};
 await assert.rejects(()=>ledger('ASSISTANT',{...ap,rate_id:motor.rate_id}),/matching/);
 const asset=await ledger('ASSISTANT',ap),ar=async()=>ledger('ASSISTANT',{...base,action:'ledger_asset_read',asset_id:asset.asset_id});assert.equal((await ar()).asset.cost,'100000.00');assert.equal((await ar()).calculation.book_annual,25000);assert.equal((await ar()).calculation.tax_annual_projection,25000);
 let arx=await ar();await ledger('ASSISTANT',{...base,action:'ledger_asset_submit',asset_id:asset.asset_id,revision:arx.asset.revision});arx=await ar();await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_asset_review',asset_id:asset.asset_id,revision:arx.asset.revision,status:'Approved',review_note:'Attempted self review'}),/Manager or Partner/);
 await ledger('MANAGER',{...base,action:'ledger_asset_review',asset_id:asset.asset_id,revision:arx.asset.revision,status:'Approved',review_note:'Fictional independent classification, source, use and rate review.'});
 const charge=await ledger('ASSISTANT',{...base,action:'ledger_depreciation_create',asset_id:asset.asset_id,starts_on:'2026-01-01',ends_on:'2026-12-31',reference:'DEP-2026',evidence:'Fictional approved annual class-rate calculation'});await post(charge.journal_id);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_depreciation_create',asset_id:asset.asset_id,starts_on:'2026-09-01',ends_on:'2026-10-31',reference:'DUP-DEP',evidence:'Fictional overlap attempt'}),/already covers/);
 let report=await ledger('ASSISTANT',{...base,action:'ledger_read'});assert.equal(report.profit.payroll,103000);assert.equal(report.profit.depreciation,25000);assert.equal(report.profit.operating_expenses,1000);assert.equal(report.profit.profit_before_tax,-129000);assert.equal(report.tb.reduce((n,x)=>n+x.net,0),0);assert.equal(report.ready_to_close,false);
 // Supplier register and creditors ageing: the ledger is rebuilt from posted Trade payables lines, so it always agrees with the control account.
 const pay0=await ledger('ASSISTANT',{...base,action:'ledger_payables_read'});assert.equal(pay0.register_in_use,false);assert.equal(pay0.totals.difference,0);assert.ok(pay0.unassigned.count>0,'posted payables lines exist before any supplier is registered');
 assert.equal(report.close_checks.find(x=>x.code==='PAYABLES_REGISTER').status,'Not started');assert.ok(!report.issues.some(x=>/^Supplier ledger/.test(x)),'a client with no register is not blocked');
 await assert.rejects(()=>ledger('INTERN',{...base,action:'ledger_supplier_save',name:'Fictional Supplier Ltd'}),/Interns|available|permission/i);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_supplier_save',name:'Fictional Supplier Ltd',kra_pin:'BAD'}),/KRA PIN/);
 const sup=await ledger('ASSISTANT',{...base,action:'ledger_supplier_save',name:'Fictional Supplier Ltd',kra_pin:'p051234567z',aliases:'Fictional Supplies; FSL'});assert.equal(sup.revision,1);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_supplier_save',name:'fictional supplier ltd'}),/already in the supplier register/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_supplier_save',name:'Another',kra_pin:'P051234567Z'}),/already in the supplier register/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_supplier_save',supplier_id:sup.supplier_id,revision:99,name:'Fictional Supplier Ltd'}),/changed since/);
 const upd=await ledger('MANAGER',{...base,action:'ledger_supplier_save',supplier_id:sup.supplier_id,revision:sup.revision,name:'Fictional Supplier Ltd',kra_pin:'P051234567Z',note:'Fictional note'});assert.equal(upd.revision,2);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`delete from erp_private.suppliers where supplier_id=${sup.supplier_id}`),/delet|permission denied/i,'suppliers are never hard deleted');
 const pay1=await ledger('ASSISTANT',{...base,action:'ledger_payables_read'});assert.equal(pay1.register_in_use,true);assert.equal(pay1.totals.difference,0);assert.equal(pay1.register.length,1);
 report=await ledger('ASSISTANT',{...base,action:'ledger_read'});assert.equal(report.close_checks.find(x=>x.code==='PAYABLES_CONTROL').status,'Pass');
 assert.equal(report.close_checks.find(x=>x.code==='PAYABLES_ASSIGNED').status,'Blocked');assert.ok(report.issues.some(x=>/^Supplier ledger/.test(x)),'unassigned payables block approval once the register is in use');
 // Bank register: each bank is tied to its own ledger account, statements are tied to a bank, and close checks use the client's banks.
 await assert.rejects(()=>ledger('INTERN',{...base,action:'ledger_bank_save',bank_name:'Fictional Bank',kind:'Bank current',gl_code:'10020'}),/Interns|available|permission/i);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_name:'Fictional Bank',kind:'Bank current',gl_code:'10020',account_last4:'12'}),/last four/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_name:'Fictional Bank',kind:'Bank current',gl_code:'20080'}),/overdraft/i);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_name:'Fictional Bank',kind:'Bank current',gl_code:'11111'}),/valid option/i);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_name:'Fictional Bank',kind:'Bank current',gl_code:'10021'}),/not approved yet/,'additional bank accounts stay Draft until a Partner approves them');
 const kcb=await ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_name:'Fictional Bank',account_label:'Operating',account_last4:'4821',kind:'Bank current',gl_code:'10020',opened_on:'2025-01-01'});assert.equal(kcb.revision,1);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_name:'Second Bank',kind:'Bank savings',gl_code:'10020'}),/already used by Fictional Bank/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_account_id:kcb.bank_account_id,revision:99,bank_name:'Fictional Bank',kind:'Bank current',gl_code:'10020'}),/changed since/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_save',bank_account_id:kcb.bank_account_id,revision:kcb.revision,bank_name:'Fictional Bank',kind:'Bank current',gl_code:'10020',status:'Closed',closed_on:'2026-06-30'}),/Manager or Partner/);
 report=await ledger('ASSISTANT',{...base,action:'ledger_read'});assert.equal(report.bank_register.length,1);assert.equal(report.bank_register[0].account_last4,'4821');assert.equal(report.close_checks.find(x=>x.code==='BANK_UNREGISTERED').status,'Pass');
 const stmt=id();await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by,bank_account_id) values(${stmt},${P},${D},'Bank',1,'Bank','2026-09-01','2026-09-30','{}',0,0,0,0,${actors.ASSISTANT.staff_id},${kcb.bank_account_id})`;
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.client_bank_accounts set gl_code='10030' where bank_account_id=${kcb.bank_account_id}`),/Statements are already linked/,'the ledger link cannot move once statements depend on it');
 const closed=await ledger('MANAGER',{...base,action:'ledger_bank_save',bank_account_id:kcb.bank_account_id,revision:kcb.revision,bank_name:'Fictional Bank',kind:'Bank current',gl_code:'10020',status:'Closed',closed_on:'2026-12-31'});assert.equal(closed.revision,2);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_bank_save',bank_account_id:kcb.bank_account_id,revision:closed.revision,bank_name:'Fictional Bank',kind:'Bank current',gl_code:'10020'}),/closed bank account cannot be changed/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`delete from erp_private.client_bank_accounts where bank_account_id=${kcb.bank_account_id}`),/delet|permission denied/i);
 // Narration rules and the Fix-It queue: rules need a different Manager or Partner, and statement lines can be mapped to ledger accounts.
 const lineRow=(n,ref,credit,debit)=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${stmt},${P},${C},'Bank',${n},${'BANK-'+n},'{}',${tx.json({date:'2026-09-0'+n,reference:ref,credit,debit})}) returning row_id,revision`;
 const l1=(await lineRow(1,'LOAN FROM DIRECTOR JOHN',5000,0))[0],l2=(await lineRow(2,'KRA REFUND 123',800,0))[0],l3=(await lineRow(3,'BANK TO MOBILE 998',0,2000))[0];
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_rule_save',keyword:'ab',account_code:'62570'}),/three/);
 await assert.rejects(()=>ledger('INTERN',{...base,action:'ledger_bank_rule_save',keyword:'director loan',account_code:'62570'}),/Interns|available|permission/i);
 const rl=await ledger('ASSISTANT',{...base,action:'ledger_bank_rule_save',keyword:'Loan From Director',match_mode:'Contains',direction:'Money in',account_code:'62570',note:'Fictional lender'});assert.equal(rl.status,'Proposed');
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_rule_save',keyword:'loan from director',match_mode:'Contains',direction:'Money in',account_code:'62570'}),/already exists/);
 assert.equal((await ledger('ASSISTANT',{...base,action:'ledger_bank_apply_rules'})).mapped,0,'a proposed rule is never applied');
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_rule_review',rule_id:rl.rule_id,status:'Active'}),/Manager or Partner/);
 const mrule=await ledger('MANAGER',{...base,action:'ledger_bank_rule_save',keyword:'kra refund',account_code:'62570'});
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_bank_rule_review',rule_id:mrule.rule_id,status:'Active'}),/different Manager or Partner/);
 await ledger('PARTNER',{...base,action:'ledger_bank_rule_review',rule_id:mrule.rule_id,status:'Retired',review_note:'Fictional: too broad'});
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.bank_mapping_rules set keyword='other loan' where rule_id=${rl.rule_id}`),/cannot be edited/);
 await ledger('MANAGER',{...base,action:'ledger_bank_rule_review',rule_id:rl.rule_id,status:'Active'});
 const applied=await ledger('ASSISTANT',{...base,action:'ledger_bank_apply_rules'});assert.equal(applied.mapped,1);assert.equal(applied.left,2);
 assert.equal((await tx`select account_code from erp_private.workbook_rows where row_id=${l1.row_id}`)[0].account_code,'62570');
 // Starter narration rules (build 2783): suggestions copied in as Proposed rules, never active, never the unsafe transfer rule, never the locked excise rule.
 {
  const st=(await ledger('ASSISTANT',{...base,action:'ledger_bank_fixit_read'})).starters;
  assert.deepEqual(st.map(x=>x.key),['ledger-fee','commission-on-turnover','bank-charges','loan-interest','overdraft-interest','excise-duty']);
  assert.ok(!st.some(x=>/^(trf|transfer)/i.test(x.keyword)),'no blanket transfer rule');
  assert.match(st.find(x=>x.key==='excise-duty').problem,/Tax Lead has not confirmed/);assert.equal(st.find(x=>x.key==='ledger-fee').problem,null);
  await assert.rejects(()=>ledger('INTERN',{...base,action:'ledger_bank_starter_copy',keys:['ledger-fee']}),/Interns can access assigned tasks/);
  await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_starter_copy',keys:[]}),/at least one/);
  await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_starter_copy',keys:['no-such']}),/does not exist/);
  await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_starter_copy',keys:['excise-duty']}),/Tax Lead has not confirmed/);
  const got=await ledger('ASSISTANT',{...base,action:'ledger_bank_starter_copy',keys:['ledger-fee','loan-interest']});
  assert.deepEqual(got.proposed.map(x=>x.status),['Proposed','Proposed']);
  const rows=await tx`select keyword,direction,account_code,status,created_by,note from erp_private.bank_mapping_rules where note like 'Starter rule:%' order by keyword`;
  assert.deepEqual(rows.map(x=>[x.keyword,x.direction,x.account_code,x.status]),[['ledger fee','Money out','62510','Proposed'],['loan interest','Money out','62000','Proposed']]);
  assert.ok(rows.every(x=>x.created_by===actors.ASSISTANT.staff_id));
  assert.equal((await ledger('ASSISTANT',{...base,action:'ledger_bank_apply_rules'})).mapped,0,'a proposed starter rule maps nothing');
  await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_starter_copy',keys:['ledger-fee']}),/already has this rule, waiting for approval/);
  const mine=(await tx`select rule_id from erp_private.bank_mapping_rules where keyword='ledger fee'`)[0].rule_id;
  await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_rule_review',rule_id:mine,status:'Active'}),/Manager or Partner/);
  await ledger('MANAGER',{...base,action:'ledger_bank_rule_review',rule_id:mine,status:'Active'});
  assert.match((await ledger('ASSISTANT',{...base,action:'ledger_bank_fixit_read'})).starters.find(x=>x.key==='ledger-fee').problem,/already has this rule, approved/);
  await ledger('MANAGER',{...base,action:'ledger_bank_rule_review',rule_id:(await tx`select rule_id from erp_private.bank_mapping_rules where keyword='loan interest'`)[0].rule_id,status:'Retired',review_note:'Fictional: not needed for this client'});
  assert.equal((await ledger('ASSISTANT',{...base,action:'ledger_bank_fixit_read'})).starters.find(x=>x.key==='loan-interest').problem,null,'a retired starter can be proposed again');
 }
 let fix=await ledger('ASSISTANT',{...base,action:'ledger_bank_fixit_read'});assert.equal(fix.not_mapped,2);assert.equal(fix.lines>=3,true);assert.ok(fix.accounts.some(x=>x.code==='62570'));assert.ok(!fix.accounts.some(x=>x.code==='50000'),'stock accounts are not offered for bank lines');
 const rev2=fix.items.find(i=>i.row_id===l2.row_id).revision;
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_lines_map',items:[{row_id:l2.row_id,revision:rev2}],account_code:'10020'}),/own bank/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_lines_map',items:[{row_id:l2.row_id,revision:rev2}],account_code:'50000'}),/stock or fixed assets/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_lines_map',items:[{row_id:l2.row_id,revision:99}],account_code:'62570'}),/changed/);
 assert.equal((await ledger('ASSISTANT',{...base,action:'ledger_bank_lines_map',items:[{row_id:l2.row_id,revision:rev2}],account_code:'62570'})).mapped,1);
 fix=await ledger('ASSISTANT',{...base,action:'ledger_bank_fixit_read'});assert.equal(fix.not_mapped,1,'only the Bank to Mobile line is left');
 assert.equal((await tx`select review_details->'mapping_confirmation'->>'method' m from erp_private.workbook_rows where row_id=${l1.row_id}`)[0].m,'Bank rule');
 // Bank reconciliation summary: the client's own non-trade categories, with drill-down.
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_bank_category_save',name:'Director loans',account_codes:'62570'}),/Manager or Partner/);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_bank_category_save',name:'Director loans',account_codes:'10040'}),/bank account/);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_bank_category_save',name:'Director loans',account_codes:'50000'}),/stock or fixed-asset/);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_bank_category_save',name:'Director loans',account_codes:'99999'}),/not an active ledger account/);
 const sum0=await ledger('ASSISTANT',{...base,action:'ledger_bank_summary_read'});const sec0=Object.fromEntries(sum0.sections.map(x=>[x.key,x]));
 assert.equal(sum0.money_in,5800);assert.equal(sec0.unclassified.amount,0);assert.equal(sec0.trade.amount,5800,'before any category, mapped money in counts as trade');assert.equal(sum0.money_out.not_classified,2000);
 const cat=await ledger('MANAGER',{...base,action:'ledger_bank_category_save',name:'Director loans',account_codes:'62570',note:'Fictional'});
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_bank_category_save',name:'Other',account_codes:'62570'}),/already belongs/);
 const sum1=await ledger('ASSISTANT',{...base,action:'ledger_bank_summary_read'});const sec1=Object.fromEntries(sum1.sections.map(x=>[x.key,x]));
 assert.equal(sec1['cat:'+cat.category_id].amount,5800);assert.equal(sum1.trade_bankings,0);assert.equal(sec1['cat:'+cat.category_id].lines.length,2);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.bank_summary_categories set name='Renamed category' where category_id=${cat.category_id}`),/cannot be edited/);
 await ledger('MANAGER',{...base,action:'ledger_bank_category_retire',category_id:cat.category_id});
 assert.equal((await ledger('ASSISTANT',{...base,action:'ledger_bank_summary_read'})).trade_bankings,5800);
 // Statement balance fields are stored on the batch and read by the close checks.
 await tx`update erp_private.workbook_batches set statement_opening=100,statement_closing=900,balance_status='Overridden',balance_override_reason='Fictional approved override reason',balance_override_by=${actors.MANAGER.staff_id} where batch_id=${stmt}`.catch(e=>assert.match(String(e.message),/cannot be edited/));
 const reversal=await ledger('MANAGER',{...base,action:'ledger_reverse',journal_id:a.journal_id,reference:'REV-LICENCE',journal_date:'2026-10-01',evidence:'Fictional correction; original remains immutable'});
 // A Manager who prepares a reversal must have a different Partner approve it.
 let rv=await ledger('MANAGER',{...base,action:'ledger_journal_read',journal_id:reversal.journal_id});await ledger('MANAGER',{...base,action:'ledger_journal_submit',journal_id:reversal.journal_id,revision:rv.journal.revision});rv=await jr(reversal.journal_id);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:reversal.journal_id,revision:rv.journal.revision,status:'Posted',review_note:'Self review attempt from a manager'}),/different Manager/);
 await ledger('PARTNER',{...base,action:'ledger_journal_review',journal_id:reversal.journal_id,revision:rv.journal.revision,status:'Posted',review_note:'Fictional independent correction approval'});
 report=await ledger('ASSISTANT',{...base,action:'ledger_read'});assert.equal(report.profit.operating_expenses,0);assert.equal(report.profit.profit_before_tax,-128000);
 const annual=await annualTaxLedgerControl(tx,P,'2026-01-01','2026-12-31');assert.equal(annual.source_application.balanced,true);assert.equal(annual.source_application.trial_balance_difference,0);assert.equal(annual.profit_before_tax,report.profit.profit_before_tax);
 assert.equal((await annualTaxLedgerControl(tx,P,'2025-01-01','2025-12-31')).source_application,null,'annual tax control requires the exact client financial-year ledger');
 // Imported legacy names, negative sign presentation and all source rows remain auditable.
 const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]})),w=new ExcelJS.Workbook(),sheet=w.addWorksheet('Payroll');sheet.addRow(['Old code','Original name','Debit','Credit']);sheet.addRow(['OLD-SAL','Gross wages',1000,0]);sheet.addRow(['OLD-WAGE','Net wages',0,1000]);sheet.addRow(['OLD-REV','Original signed credit',-50,0]);sheet.addRow(['OLD-BANK','Original offset',50,0]);workbookBytes=await w.xlsx.writeBuffer();
 const ip={...base,document_id:D,sheet_name:'Payroll',header_row:1,kind:'Payroll',reference:'PAY-IMPORT',journal_date:'2026-10-31',evidence:'Fictional legacy balanced payroll schedule',column_map:{legacy_code:1,source_name:2,debit:3,credit:4}};
 assert.equal((await ledger('ASSISTANT',{...ip,action:'ledger_import_preview'})).preview.length,4);
 const imp=await ledger('ASSISTANT',{...ip,action:'ledger_import_commit'});assert.equal(imp.imported_count,4);assert.equal((await ledger('ASSISTANT',{...ip,action:'ledger_import_commit'})).duplicate_count,4);const imported=await jr(imp.journal_id);assert.equal(imported.lines[0].legacy_code,'OLD-SAL');assert.equal(imported.lines[2].source_status,'Unverified');assert.equal(imported.journal.source_snapshot.source_rows[2].original_debit,-50);await assert.rejects(()=>submit(imp.journal_id),/map to an active/);
 // The standard opening template has six columns. Evidence is captured once in ERP and source rows stay traceable.
 const openingSheet=w.addWorksheet('Opening TB');openingSheet.addRows([
  ['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)'],
  ['OLD-CASH','Cash on hand','ASSET','10000',100000,0],
  ['OLD-CAP','Share capital','EQUITY','30000',0,100000],
  ['', 'Difference in Books','','',100,0],
 ]);workbookBytes=await w.xlsx.writeBuffer();
 const secondOpeningSheet=w.addWorksheet('Opening TB Revised');secondOpeningSheet.addRows([
  ['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)'],
  ['OLD-CASH','Cash on hand','ASSET','10000',100000,0],
  ['OLD-CAP','Share capital','EQUITY','30000',0,100000],
 ]);workbookBytes=await w.xlsx.writeBuffer();
 const uploadPeriod=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2027-01-01',ends_on:'2027-12-31'}),openingBase={project_id:P,period_id:uploadPeriod.period_id};
 const openingImport={...openingBase,document_id:D,sheet_name:'Opening TB',header_row:1,kind:'Opening',reference:'OPEN-TB-2027',journal_date:'2027-01-01',column_map:{legacy_code:1,source_name:2,routing_code:3,tb_item_code:4,debit:5,credit:6},evidence:'Fictional approved 2026 closing TB and manager sign-off'};
 const openingPreview=await ledger('ASSISTANT',{...openingImport,action:'ledger_import_preview'});assert.deepEqual(openingPreview.headers,['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)']);
 await assert.rejects(()=>ledger('ASSISTANT',{...openingImport,action:'ledger_import_commit'}),/Confirm the approved prior-year trial balance/);
 await assert.rejects(()=>ledger('ASSISTANT',{...openingImport,action:'ledger_import_commit',confirm_opening_source:true,evidence:''}),/source workbook and approval reference/);
 const importedOpening=await ledger('ASSISTANT',{...openingImport,action:'ledger_import_commit',confirm_opening_source:true,column_map:{...openingImport.column_map,routing_code:1},account_overrides:{'2':'10000','3':'30000'},mapping_confirmations:{'2':true,'3':true}});assert.equal(importedOpening.imported_count,2);assert.equal(importedOpening.source_controls[0].difference_kes,100);
 const openingDraft=await ledger('ASSISTANT',{...openingBase,action:'ledger_journal_read',journal_id:importedOpening.journal_id});assert.equal(openingDraft.lines[0].source_status,'Confirmed');assert.equal(openingDraft.lines[0].source_reference,'Fictional.xlsx | Opening TB | row 2');assert.ok(!openingDraft.journal.source_snapshot.source_rows[0].mapping_issue,'an Assistant\'s confirmed account choice is kept as a Draft client account mapping');assert.equal((await tx`select count(*)::int n from erp_private.client_account_mappings where client_id=${C} and status='Draft' and created_by=${actors.ASSISTANT.staff_id}`)[0].n,2,'both Draft mappings belong to the Assistant and wait for a different Manager or Partner to post');assert.deepEqual(openingDraft.journal.source_snapshot.source_confirmation,{confirmed:true,confirmed_by:actors.ASSISTANT.staff_id,evidence_reference:openingImport.evidence,source_closing_date:'2026-12-31',currency:'KES'});await assert.rejects(()=>ledger('ASSISTANT',{...openingBase,action:'ledger_journal_submit',journal_id:importedOpening.journal_id,revision:openingDraft.journal.revision}),/Difference in Books/);
 // A corrected upload replaces the unposted opening draft in place; ledger history is never deleted.
 const replacedOpening=await ledger('ASSISTANT',{...openingImport,action:'ledger_import_commit',sheet_name:'Opening TB Revised',confirm_opening_source:true,account_overrides:{'2':'10000','3':'30000'},mapping_confirmations:{'2':true,'3':true}});
 assert.equal(replacedOpening.journal_id,importedOpening.journal_id);assert.equal(replacedOpening.replaced,true);assert.equal(replacedOpening.imported_count,2);
 assert.equal((await tx`select count(*)::integer as n from erp_private.ledger_journals where period_id=${uploadPeriod.period_id} and kind='Opening'`)[0].n,1,'Only one opening journal per year');
 // Snapshot totals are period filtered; no hidden future entries leak into an as-of account view.
 const early=await ledger('ASSISTANT',{...base,action:'ledger_account_read',account_code:'61180',as_of:'2026-09-30'});assert.equal(early.lines.length,1);
 assert.equal((await tx`select count(*)::integer as n from erp_private.document_access_events where document_id=${D} and actor_auth_id=${actors.ASSISTANT.auth_user_id} and action='DOWNLOAD'`)[0].n,6,'Each successful workbook preview/import access is logged');
 const newTables=await db.query(`select relname,relrowsecurity,relforcerowsecurity from pg_class where relname in ('ledger_periods','ledger_journals','ledger_lines','ledger_sources','ledger_assets','ledger_asset_charges','asset_class_rates')`);assert.equal(newTables.rows.length,7);assert.ok(newTables.rows.every(x=>x.relrowsecurity&&x.relforcerowsecurity));
});
