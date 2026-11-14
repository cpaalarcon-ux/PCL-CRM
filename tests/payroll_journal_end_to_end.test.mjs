import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {routingMapAction}=await import('../supabase/functions/staff-workspace-v12/routing-map-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {starterConfirmAction}=await import('../supabase/functions/staff-workspace-v12/starter-confirm-actions.ts');
const {annualTaxLedgerControl}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),map=(role,p)=>as(role,a=>accountingAction(tx,a,p));
test('payroll: a draft journal from the approved payroll mappings, at account level, traceable to the summary, balanced, never posted by the mapping',async t=>{
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
 const jr=async id=>await ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:id});
 const acct=(await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code`).map(x=>x.code);
 const pick=(...codes)=>codes.find(c=>acct.includes(c));
 const A={GROSS_SALARY:'60000',NSSF_EMPLOYER:'60050',AHL_EMPLOYER:'60060',NITA_EMPLOYER:'60070',PAYE:'21600',NSSF_EMPLOYEE:'21603',SHIF:'21601',AHL_EMPLOYEE:'21602',NITA_PAYABLE:'21604',NET_PAY_PAYABLE:'21610'};
 for(const c of Object.values(A))assert.ok(acct.includes(c),'chart has '+c);
 const emp=(name,id,gross,paye,nssf,shif,ahl)=>({name,employee_id:id,pin:'A00000000'+id+'Z',gross,source_row:Number(id)+1});
 const calc=(gross,paye,nssf,shif,ahl,enssf,eahl,nita)=>({gross,paye,employee_nssf:nssf,shif,employee_ahl:ahl,other_deductions:0,employer_nssf:enssf,employer_ahl:eahl,nita,net_pay:Math.round((gross-paye-nssf-shif-ahl)*100)/100});
 const month=(start,end,rows,calcRows,status='Submitted')=>({import_id:id(),start,end,rows,calcRows,status});
 async function addImport(m){await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.period_imports(import_id,project_id,client_id,document_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by) values(${m.import_id},${P},${C},${D},'Payroll','PAYROLL','PAYROLL_MONTHLY',${m.start},${m.end},${tx.json({employees:m.rows,calculated:m.calcRows,issues:[],differences:[]})},${'h'+m.import_id},${m.status},${actors.ASSISTANT.staff_id})`;}finally{await db.exec('set session_replication_role=origin');}}
 const aug=month('2026-08-01','2026-08-31',[emp('Wanjiru','1',100000),emp('Otieno','2',80000)],[calc(100000,20000,2160,2000,1500,2160,1500,50),calc(80000,14000,2160,2000,1200,2160,1200,50)],'Confirmed');
 const sep=month('2026-09-01','2026-09-30',[emp('Wanjiru','1',110000),emp('Kamau','3',60000)],[calc(110000,23000,2160,3025,1650,2160,1650,50),calc(60000,8000,2160,1650,900,2160,900,50)]);
 await addImport(aug);await addImport(sep);
 const base2={...base,import_id:sep.import_id};
 // No approved mapping: the preview names every code, the draft is refused, nothing is guessed.
 const none=await ledger('ASSISTANT',{...base2,action:'ledger_payroll_journal_preview'});assert.ok(none.unmapped.length>=8);assert.equal(none.journal.balanced,false);assert.ok(none.unmapped.some(x=>x.code==='GROSS_SALARY'));
 await assert.rejects(()=>ledger('ASSISTANT',{...base2,action:'ledger_payroll_journal_create'}),/no approved mapping.*GROSS_SALARY/s);
 // A Manager proposes each payroll code; a Partner approves. Then the same mappings serve every later month.
 const rm=(role,p)=>as(role,a=>routingMapAction(tx,a,{client_id:C,...p}));
 const rows=Object.entries(A).map(([code,acc])=>({module:'Payroll',routing_code:code,erp_account_code:acc,effective_from:'2026-01-01'}));
 assert.equal((await rm('MANAGER',{action:'routing_map_propose',rows})).saved,rows.length);
 const drafts=(await rm('PARTNER',{action:'routing_map_read',module:'Payroll'})).maps;assert.equal(drafts.length,rows.length);assert.ok(drafts.every(d=>d.status==='Draft'&&d.side));
 await assert.rejects(()=>ledger('ASSISTANT',{...base2,action:'ledger_payroll_journal_create'}),/no approved mapping/,'drafts do not count');
 for(const d of drafts)await rm('PARTNER',{action:'routing_map_approve',routing_id:d.routing_id,revision:d.revision});
 const pre=await ledger('ASSISTANT',{...base2,action:'ledger_payroll_journal_preview'});
 assert.deepEqual(pre.unmapped,[]);assert.equal(pre.journal.balanced,true);assert.equal(pre.employees,2);assert.equal(pre.totals.gross,170000);
 assert.deepEqual(pre.changes.new_staff.map(x=>x.name),['Kamau']);assert.deepEqual(pre.changes.left.map(x=>x.name),['Otieno']);assert.deepEqual(pre.changes.salary_changes,[{name:'Wanjiru',from:100000,to:110000}]);
 const made=await ledger('ASSISTANT',{...base2,action:'ledger_payroll_journal_create'});
 const j=await jr(made.journal_id);assert.equal(j.journal.kind,'Payroll');assert.equal(j.journal.status,'Draft','prepared, not posted');assert.equal(j.journal.source_snapshot.import_id,sep.import_id);assert.equal(j.journal.source_snapshot.employees,2);
 const lines=j.lines,dr=lines.reduce((n,l)=>n+Number(l.debit),0),cr=lines.reduce((n,l)=>n+Number(l.credit),0);assert.equal(Math.round(dr*100),Math.round(cr*100),'balances');
 assert.equal(lines.length,10,'one line per account, not one per employee');
 assert.equal(Number(lines.find(l=>l.account_code==='60000').debit),170000);assert.equal(Number(lines.find(l=>l.account_code==='21603').credit),2160*2+2160*2,'NSSF payable carries the employee and employer shares');
 assert.equal(j.journal.source_snapshot.mappings.length,10);assert.ok(j.journal.source_snapshot.mappings.every(m=>m.version===1&&m.mapping_id));
 const again=await ledger('ASSISTANT',{...base2,action:'ledger_payroll_journal_create'});assert.equal(again.journal_id,made.journal_id);assert.equal(again.reused,true,'repeating opens the same entry');
 const viaImport=await ledger('ASSISTANT',{...base,action:'ledger_period_import_create',import_id:sep.import_id});assert.equal(viaImport.journal_id,made.journal_id,'the Prepare accounting entry button reaches the same entry');
 // Independent review: the preparer cannot post it; a different Manager does.
 await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:made.journal_id,revision:j.journal.revision});await checkJournal(tx,made.journal_id);
 const jj=await jr(made.journal_id);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_journal_review',journal_id:made.journal_id,revision:jj.journal.revision,status:'Posted',review_note:'Attempt to self approve this payroll'}),/Manager or Partner/);
 await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:made.journal_id,revision:jj.journal.revision,status:'Posted',review_note:'Checked totals, new staff and salary change.'});
 assert.equal((await jr(made.journal_id)).journal.status,'Posted');
 // The next month reuses the same approved mappings; a draft import cannot be journalled.
 const oct=month('2026-10-01','2026-10-31',[emp('Wanjiru','1',110000)],[calc(110000,23000,2160,3025,1650,2160,1650,50)]);await addImport(oct);
 assert.equal((await ledger('ASSISTANT',{...base,import_id:oct.import_id,action:'ledger_payroll_journal_preview'})).unmapped.length,0,'mappings are reused for later months');
 const dft=month('2026-11-01','2026-11-30',[emp('Wanjiru','1',110000)],[calc(110000,23000,2160,3025,1650,2160,1650,50)],'Draft');await addImport(dft);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,import_id:dft.import_id,action:'ledger_payroll_journal_create'}),/Submit the payroll summary first/);
 // A mapping that ends before a month leaves that month unprepared.
 const gross=(await rm('PARTNER',{action:'routing_map_read',module:'Payroll'})).maps.find(m=>m.routing_code==='GROSS_SALARY');
 await rm('MANAGER',{action:'routing_map_end',routing_id:gross.routing_id,revision:gross.revision,effective_to:'2026-09-30',reason:'Account replaced from October'});
 const after=await ledger('ASSISTANT',{...base,import_id:oct.import_id,action:'ledger_payroll_journal_preview'});assert.deepEqual(after.unmapped.map(x=>x.code),['GROSS_SALARY']);
});
