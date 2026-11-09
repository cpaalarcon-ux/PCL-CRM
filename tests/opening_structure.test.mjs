// Suggestions for opening TB lines (learned from the firm, read from the account name).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
import ExcelJS from 'exceljs';
import {proposeAccounts} from '../supabase/functions/staff-workspace-v12/client-chart.ts';
import {normalSide,openingStructure} from '../supabase/functions/staff-workspace-v12/opening-structure.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {annualTaxLedgerControl}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),map=(role,p)=>as(role,a=>accountingAction(tx,a,p));
test('Opening T-structure: built from the approved chart and downloadable as the standard six-column workbook',async(t)=>{
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
 await db.exec('alter table erp_private.clients disable trigger zz_structure_guard');// the test moves the family back and forth; the real rule has its own test
 await tx`update erp_private.clients set legal_entity_type='Partnership',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const setup=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:setup.period_id};
 await tx`update erp_private.clients set legal_entity_type='Limited company' where client_id=${C}`;

 const getS=()=>ledger('ASSISTANT',{...base,action:'ledger_opening_structure'});
 // the chart proposed for a partnership: the approved chart is what the T-structure is built from
 const cat=await tx`select code,name,account_group,category_code,status,is_legacy,entity_types,industry_packs from erp_private.account_catalog order by code`;
 const proposed=proposeAccounts(cat,'Partnership',['Wholesale']).map(x=>x.code);
 await db.exec('alter table erp_private.client_chart_versions disable trigger user');
 await tx`update erp_private.client_chart_versions set accounts=${'{'+proposed.join(',')+'}'} where client_id=${C}`;
 const s=await getS();
 assert.deepEqual(s.sections.map(x=>x.title),['Assets','Liabilities','Equity']);
 const all=s.sections.flatMap(x=>x.accounts).map(x=>x.code);
 assert.ok(all.length>20&&all.length===s.count);
 assert.ok(all.every(c=>c<'40000'&&proposed.includes(c)),'only balance-sheet accounts of the approved chart');
 assert.ok(all.includes('36010')&&!all.includes('30000'),'a partnership sees partners accounts and no share capital');
 assert.ok(s.sections[0].accounts.every(x=>x.code[0]==='1')&&s.sections[1].accounts.every(x=>x.code[0]==='2')&&s.sections[2].accounts.every(x=>x.code[0]==='3'));
 assert.equal(s.sections[0].accounts.find(x=>/accumulated/i.test(x.name))?.normal_side,'Credit');
 // the workbook: standard six columns, routing and TB codes filled, balance check on a second sheet
 const f=await ledger('ASSISTANT',{...base,action:'ledger_opening_template'});
 assert.match(f.name,/^Opening_TB_T-structure_.*\.xlsx$/);assert.equal(f.accounts,all.length);
 const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(f.base64,'base64'));
 assert.deepEqual(wb.worksheets.map(w=>w.name),['Opening TB','T-structure','Read first']);
 const ws=wb.getWorksheet('Opening TB');
 assert.deepEqual([1,2,3,4,5,6].map(c=>ws.getRow(1).getCell(c).value),['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)']);
 assert.equal(ws.rowCount,all.length+1);
 for(let r=2;r<=ws.rowCount;r++){const row=ws.getRow(r);assert.equal(String(row.getCell(4).value),all[r-2]);assert.ok(row.getCell(3).value,'routing code filled');assert.equal(row.getCell(5).value,null);}
 const ts=wb.getWorksheet('T-structure');let formulas=0;ts.eachRow(r=>r.eachCell(c=>{if(c.value&&c.value.formula)formulas++;}));
 assert.ok(formulas>=all.length*2+6,'T-structure recalculates from the Opening TB sheet');
 assert.match(JSON.stringify(wb.getWorksheet('Read first').getSheetValues()),/chart amendment/);
 // balances typed in the T-structure: saved as a draft opening journal, Draft account setups created, activated by an independent poster
 const save=(p)=>ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-TB-2026',journal_date:'2026-01-01',description:'Typed',evidence:'Approved 2025 closing TB',...p});
 const line=(code,debit,credit)=>({account_code:code,source_name:'x',legacy_code:'',debit,credit,source_status:'Confirmed',source_reference:'Approved 2025 closing TB',description:''});
 await assert.rejects(()=>save({lines:[line('10000',1000,0),line('36010',0,1000)]}),/not approved for this client’s opening balance date/);
 await assert.rejects(()=>save({t_structure:true,lines:[line('30000',0,1000),line('10000',1000,0)]}),/approved chart of accounts/);
 const typed=await save({t_structure:true,lines:[line('10000',1000,0),line('36010',0,1000)]});assert.ok(typed.journal_id);
 const drafts=await tx`select erp_account_code,status,source_account_code from erp_private.client_account_mappings where client_id=${C} and erp_account_code in ('10000','36010') order by erp_account_code`;
 assert.deepEqual(drafts.map(x=>[x.erp_account_code,x.status,x.source_account_code]),[['10000','Draft',null],['36010','Draft',null]]);
 const again=await save({t_structure:true,journal_id:typed.journal_id,revision:(await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:typed.journal_id})).journal.revision,lines:[line('10000',1000,0),line('36010',0,1000)]});assert.equal(again.journal_id,typed.journal_id);
 assert.equal((await tx`select count(*)::int n from erp_private.client_account_mappings where client_id=${C} and erp_account_code in ('10000','36010')`)[0].n,2,'saving again does not duplicate the account setups');
 let jr=(await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:typed.journal_id})).journal;
 await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:typed.journal_id,revision:jr.revision});await checkJournal(tx,typed.journal_id);
 jr=(await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:typed.journal_id})).journal;
 await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:typed.journal_id,revision:jr.revision,status:'Posted',review_note:'Fictional independent review of the typed opening balances',confirm_opening_review:true});
 assert.deepEqual((await tx`select status from erp_private.client_account_mappings where client_id=${C} and erp_account_code in ('10000','36010') order by erp_account_code`).map(x=>x.status),['Active','Active'],'the independent poster activates the account setups');
 // without an approved chart nothing is offered
 await tx`update erp_private.client_chart_versions set status='Returned' where client_id=${C}`;
 await assert.rejects(getS,/Approve the client chart/);await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_opening_template'}),/Approve the client chart/);
 // a company gets the company layer
 await tx`update erp_private.client_chart_versions set status='Approved',entity_type='Limited company',accounts=${'{'+proposeAccounts(cat,'Limited company',['Wholesale']).map(x=>x.code).join(',')+'}'} where client_id=${C}`;
 const co=(await getS()).sections.flatMap(x=>x.accounts).map(x=>x.code);
 assert.ok(co.includes('30000')&&!co.includes('36010'));
});

test('normal balance side and grouping are pure rules',()=>{
 assert.equal(normalSide({code:'10020',name:'Bank - operating'}),'Debit');assert.equal(normalSide({code:'15920',name:'Accumulated depreciation - motor vehicles'}),'Credit');
 assert.equal(normalSide({code:'20000',name:'Trade payables'}),'Credit');assert.equal(normalSide({code:'36020',name:"Partners' drawings"}),'Debit');assert.equal(normalSide({code:'30000',name:'Share capital'}),'Credit');
 const r=openingStructure([{code:'10000',name:'Cash',status:'Active'},{code:'20000',name:'Payables',status:'Active'},{code:'30000',name:'Share capital',status:'Active'},{code:'50000',name:'Sales',status:'Active'},{code:'10001',name:'Old',status:'Active',is_legacy:true},{code:'10002',name:'Not in chart',status:'Active'}],new Set(['10000','20000','30000','50000','10001']));
 assert.deepEqual(r.sections.map(s=>s.accounts.length),[1,1,1]);assert.equal(r.count,3);
});
