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
test('statutory files: NSSF, SHIF and P10 are built from a confirmed summary, filled from the register, reconciled to the posted journal, and recorded on release',async t=>{
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
 const {statutoryFileAction}=await import('../supabase/functions/staff-workspace-v12/statutory-file-actions.ts');
 const {exportProfileAction}=await import('../supabase/functions/staff-workspace-v12/export-profile-actions.ts');
 const ep=(role,p)=>as(role,a=>exportProfileAction(tx,a,p));
 const sf=(role,p)=>as(role,a=>statutoryFileAction(tx,a,{project_id:P,...p}));
 const emp=(name,n,gross,extra={})=>({name,employee_id:'2'+String(n).padStart(7,'0'),pin:extra.pin===undefined?'A00000000'+n+'Z':extra.pin,gross,source_row:n+1,resident:true,employment_type:extra.type||'Permanent',taxable_benefits:0,other_pension:0,postretirement_medical:0,mortgage_interest:0});
 const calc=(n,gross,paye,nssf,shif,ahl,enssf,eahl,nita,extra={})=>({gross,paye,employee_nssf:nssf,shif,employee_ahl:ahl,other_deductions:0,employer_nssf:enssf,employer_ahl:eahl,nita,net_pay:Math.round((gross-paye-nssf-shif-ahl)*100)/100,source_row:n+1,taxable:gross-nssf-shif-ahl,personal_relief:2400,insurance_relief:0,taxable_benefits:0,...extra});
 const month=(start,end,rows,calcRows,status='Confirmed')=>({import_id:id(),start,end,rows,calcRows,status});
 async function addImport(m){await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.period_imports(import_id,project_id,client_id,document_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by) values(${m.import_id},${P},${C},${D},'Payroll','PAYROLL','PAYROLL_MONTHLY',${m.start},${m.end},${tx.json({employees:m.rows,calculated:m.calcRows,issues:[],differences:[]})},${'h'+m.import_id},${m.status},${actors.ASSISTANT.staff_id})`;}finally{await db.exec('set session_replication_role=origin');}}
 // Three people: two permanent on the register, one casual with no PIN (PAYE without PIN is Section E item 5, not a Section B row).
 const sep=month('2026-09-01','2026-09-30',[emp('Wanjiru Kamau',1,100000),emp('Otieno Odhiambo',2,80000.4),emp('Casual Worker',3,9000,{pin:'',type:'Casual'})],
  [calc(1,100000,20000,2160,2750,1500,2160,1500,50),calc(2,80000.4,14000,2160,2200,1200,2160,1200,50),calc(3,9000,150,0,0,135,0,135,0,{})]);
 await addImport(sep);
 const draft=month('2026-10-01','2026-10-31',[emp('Wanjiru Kamau',1,100000)],[calc(1,100000,20000,2160,2750,1500,2160,1500,50)],'Submitted');await addImport(draft);
 const people=[['Wanjiru Kamau','A000000001Z','20000001'],['Otieno Odhiambo','A000000002Z','20000002']];
 for(const [name,pin,nid] of people)await tx`insert into erp_private.client_payroll_people(client_id,name,kra_pin,national_id,started_on,created_by,phone) values(${C},${name},${pin},${nid},'2026-01-01',${actors.MANAGER.staff_id},'0712345678')`;
 // Nothing filled yet, and the journal is not posted: every file is blocked and says exactly why.
 const blocked=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id});
 assert.equal(blocked.ready,false);assert.ok(blocked.issues.some(x=>/Wanjiru Kamau: .*surname.*NSSF number.* missing/s.test(x)),blocked.issues.join('|'));assert.ok(blocked.issues.some(x=>/not posted yet/.test(x)));
 await assert.rejects(()=>sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id,release:true}),/not ready to release/);
 await assert.rejects(()=>sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:draft.import_id}),/confirmed payroll summary/);
 await assert.rejects(()=>sf('INTERN',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id}),/client access/);
 // Fill the register through the action (revision checked, payroll number unique, exemption only with disability).
 const reg=async()=>await tx`select person_id,name,revision from erp_private.client_payroll_people where client_id=${C} order by kra_pin`;
 const ids=[{surname:'Kamau',other_names:'Wanjiru Grace',id_type:'National ID',nssf_number:'NS1001',sha_number:'SHA1001',payroll_number:'P001'},{surname:'Odhiambo',other_names:'Otieno Paul',id_type:'National ID',nssf_number:'NS1002',sha_number:'SHA1002',payroll_number:'P002'}];
 for(const [i,r] of (await reg()).entries())await sf('ASSISTANT',{action:'payroll_register_identifiers',person_id:r.person_id,revision:String(r.revision),...ids[i]});
 const [pr1,pr2]=await reg();
 await assert.rejects(()=>sf('ASSISTANT',{action:'payroll_register_identifiers',person_id:pr2.person_id,revision:String(pr2.revision),...ids[1],payroll_number:'P001'}),/already used/);
 await assert.rejects(()=>sf('ASSISTANT',{action:'payroll_register_identifiers',person_id:pr2.person_id,revision:'1',...ids[1]}),/Refresh/);
 await assert.rejects(()=>sf('ASSISTANT',{action:'payroll_register_identifiers',person_id:pr2.person_id,revision:String(pr2.revision),...ids[1],exemption_certificate:'EX1'}),/disability/);
 // The register is filled, but the journal is still not posted, so nothing is released.
 const stillBlocked=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id});
 assert.equal(stillBlocked.issues.length,2);assert.ok(stillBlocked.issues.some(x=>/not posted yet/.test(x)));assert.ok(stillBlocked.issues.some(x=>/No published export profile/.test(x)),'starter profiles are drafts, so nothing is releasable until they are confirmed');assert.equal(stillBlocked.row_count,2);
 // Map the payroll codes, prepare the journal, review and post it.
 const rm=(role,p)=>as(role,a=>routingMapAction(tx,a,{client_id:C,...p}));
 const rows=Object.entries(A).map(([code,acc])=>({module:'Payroll',routing_code:code,erp_account_code:acc,effective_from:'2026-01-01'}));
 await rm('MANAGER',{action:'routing_map_propose',rows});
 for(const d of (await rm('PARTNER',{action:'routing_map_read',module:'Payroll'})).maps)await rm('PARTNER',{action:'routing_map_approve',routing_id:d.routing_id,revision:d.revision});
 const made=await ledger('ASSISTANT',{...base,import_id:sep.import_id,action:'ledger_payroll_journal_create'});
 const j0=await jr(made.journal_id);
 await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:made.journal_id,revision:j0.journal.revision});await checkJournal(tx,made.journal_id);
 // A draft (not posted) journal still blocks.
 const draftJ=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'SHIF',import_id:sep.import_id});assert.ok(draftJ.issues.some(x=>/not posted yet/.test(x)));
 const j1=await jr(made.journal_id);
 await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:made.journal_id,revision:j1.journal.revision,status:'Posted',review_note:'Checked totals against the confirmed payroll.'});

 // Export profiles: the three starter profiles are Drafts. A Manager or Partner confirms each against its source; nothing releases before that.
 const list0=await ep('MANAGER',{action:'export_profile_list'});assert.equal(list0.profiles.length,3);assert.ok(list0.profiles.every(x=>x.status==='Draft'&&x.provenance==='Starter'));
 const prof=code=>list0.profiles.find(x=>x.return_code===code);
 assert.equal(prof('NSSF').rounding_rule,'ROUND_UP_WHOLE');assert.deepEqual(prof('NSSF').rounded_columns,['GROSS PAY']);assert.equal(prof('SHIF').rounding_rule,'EXACT_2DP');assert.equal(prof('PAYE_P10').employer_housing_levy,'SEPARATE_SHEET');
 await assert.rejects(()=>ep('ASSISTANT',{action:'export_profile_publish',profile_id:prof('NSSF').profile_id,revision:prof('NSSF').revision,verified_against:'NSSF return specification',verified_on:'2026-11-15'}),/Manager or Partner/);
 await assert.rejects(()=>ep('PARTNER',{action:'export_profile_publish',profile_id:prof('NSSF').profile_id,revision:prof('NSSF').revision,verified_against:'x',verified_on:'2026-11-15'}),/checked against/);
 for(const code of ['NSSF','SHIF','PAYE_P10'])await ep('PARTNER',{action:'export_profile_publish',profile_id:prof(code).profile_id,revision:prof(code).revision,verified_against:'Sample file supplied 15 Nov 2026 and the agency specification',verified_on:'2026-11-15'});
 assert.ok((await ep('MANAGER',{action:'export_profile_list'})).profiles.every(x=>x.status==='Published'&&x.verified_on==='2026-11-15'));
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.statutory_export_profiles set rounding_rule='EXACT_2DP',rounded_columns='{}' where return_code='NSSF'`),/never edited/);
 // NSSF: seven columns in the NSSF sample's order, casual left out, totals agree with the summary, journal agrees.
 const nssf=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id});
 assert.deepEqual(nssf.issues,[]);assert.equal(nssf.ready,true);assert.equal(nssf.reconciliation.status,'Agrees');assert.equal(nssf.row_count,2);
 assert.deepEqual(nssf.layout.columns,['PAYROLL NUMBER','SURNAME','OTHER NAMES','ID Number','KRA Pin','NSSF Number','GROSS PAY']);
 assert.deepEqual(nssf.preview[0],['P001','Kamau','Wanjiru Grace','20000001','A000000001Z','NS1001',100000]);assert.equal(nssf.preview[1][6],80001,'80,000.40 is rounded up to 80,001 in the export only');assert.deepEqual(nssf.rounding['GROSS PAY'],{exact:180000.4,rounded:180001,difference:0.6});assert.equal(nssf.profile.version,1);
 assert.equal(nssf.totals.employee_nssf,4320);assert.equal(nssf.totals.employer_nssf,4320);assert.equal(nssf.csv,undefined,'a plain prepare never hands out the file');
 assert.equal((await tx`select count(*)::int n from erp_private.statutory_file_exports`)[0].n,0);
 const rel=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id,release:true});
 assert.equal(rel.released,true);assert.match(rel.csv,/^﻿PAYROLL NUMBER,SURNAME,OTHER NAMES,ID Number,KRA Pin,NSSF Number,GROSS PAY\r\nP001,Kamau,Wanjiru Grace,20000001,A000000001Z,NS1001,100000\r\n/);assert.match(rel.file_name,/^NSSF_2026-09_Fictional_V3_client\.csv$/);
 const rec=(await tx`select * from erp_private.statutory_file_exports`);assert.equal(rec.length,1);assert.equal(rec[0].content_sha256,rel.sha256);assert.equal(rec[0].layout_code,'NSSF_MONTHLY_7COL_V1');assert.equal(rec[0].row_count,2);assert.equal(rec[0].profile_version,1);assert.ok(rec[0].profile_id);assert.equal(rec[0].rounding['GROSS PAY'].difference,0.6);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.statutory_file_exports set row_count=0`),/never edited|permission denied/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.statutory_file_exports`),/permission denied|never deleted|cannot be deleted/i);
 // SHIF: nine columns; a missing phone stops it.
 const shif=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'SHIF',import_id:sep.import_id});
 assert.equal(shif.ready,true);assert.deepEqual(shif.layout.columns,['PAYROLL NUMBER','FIRSTNAME','LASTNAME','IDENTITY TYPE','ID NO','KRA PIN','NHIF NO','CONTRIBUTION AMOUNT','PHONE']);
 assert.deepEqual(shif.preview[0],['P001','Wanjiru Grace','Kamau','National ID','20000001','A000000001Z','SHA1001',2750,'0712345678']);assert.equal(shif.totals.shif,4950);
 await tx`update erp_private.client_payroll_people set phone=null where person_id=${pr2.person_id}`;
 const nophone=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'SHIF',import_id:sep.import_id});assert.equal(nophone.ready,false);assert.match(nophone.issues[0],/Otieno Odhiambo: phone is missing/);
 await tx`update erp_private.client_payroll_people set phone='0712345678' where person_id=${pr2.person_id}`;
 // P10: Section B rows have a PIN; the casual with no PIN is Section E item 5; housing levy and NITA totals; the screen says it is not the KRA file.
 const p10=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'PAYE_P10',import_id:sep.import_id});
 assert.equal(p10.not_the_agency_file,true);assert.equal(p10.row_count,2);assert.equal(p10.section_e.total_employees,2);assert.equal(p10.section_e.paye_deducted,34000);assert.equal(p10.section_e.paye_without_pin,150);assert.equal(p10.section_e.total_paye_payable,34150);
 assert.equal(p10.section_e.nita_members,2);assert.equal(p10.section_e.nita_levy,100);assert.equal(p10.section_e.housing_levy_employee,2700,'Section E item 7 is the employee levy only');assert.equal(p10.section_e.housing_levy_without_pin,270);assert.equal(p10.extra_tables.length,1);assert.equal(p10.extra_tables[0].key,'sheet_m');assert.deepEqual(p10.extra_tables[0].totals,{employee:2700,employer:2700,total:5400});assert.deepEqual(p10.extra_tables[0].preview[0],['A000000001Z','Wanjiru Kamau',1500,1500,3000]);assert.ok(p10.notes.some(x=>/no KRA PIN/.test(x)));assert.equal(p10.layout.columns.length,26);
 assert.deepEqual(p10.preview[0].slice(0,8),['A000000001Z','Wanjiru Kamau','Resident','Primary Employee','No','',100000,0]);
 assert.equal(p10.preview[0][24],20000,'Self assessed PAYE equals PAYE deducted');
 assert.ok(p10.notes.some(x=>/Other Benefits \(G\)/.test(x)));assert.ok(p10.notes.some(x=>/employee share only/.test(x)));
 assert.equal(p10.ready,true);
 // A person missing from the register: P10 needs the user to confirm the defaults before release.
 await tx`update erp_private.client_payroll_people set kra_pin='A000000009Z',national_id='29999999' where person_id=${pr2.person_id}`;
 const unreg=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'PAYE_P10',import_id:sep.import_id});assert.equal(unreg.needs_default_confirmation,true);assert.equal(unreg.ready,false);assert.ok(unreg.issues.some(x=>/Confirm that Primary Employee/.test(x)));
 const okd=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'PAYE_P10',import_id:sep.import_id,confirm_defaults:true});assert.equal(okd.ready,true);
 await tx`update erp_private.client_payroll_people set kra_pin='A000000002Z',national_id='20000002' where person_id=${pr2.person_id}`;

 // A newer version never changes an old month: v2 starts 1 Oct 2026, v1 is ended on 30 Sep. September still uses v1.
 const v1=prof('NSSF');
 const draft2=await ep('MANAGER',{action:'export_profile_create',return_code:'NSSF',template_version:'NSSF return, Year 4 (Feb 2026)',rounding_rule:'EXACT_2DP',effective_from:'2026-10-01'});assert.equal(draft2.version,2);
 const l1=(await ep('MANAGER',{action:'export_profile_list'})).profiles,d2=l1.find(x=>x.version===2&&x.return_code==='NSSF');
 await assert.rejects(()=>ep('MANAGER',{action:'export_profile_publish',profile_id:d2.profile_id,revision:d2.revision,verified_against:'NSSF return specification Year 4',verified_on:'2026-11-15'}),/different Manager or Partner/);
 await assert.rejects(()=>ep('PARTNER',{action:'export_profile_publish',profile_id:d2.profile_id,revision:d2.revision,verified_against:'NSSF return specification Year 4',verified_on:'2026-11-15'}),/End it the day before/);
 const v1now=(await ep('MANAGER',{action:'export_profile_list'})).profiles.find(x=>x.profile_id===v1.profile_id);
 await assert.rejects(()=>ep('PARTNER',{action:'export_profile_end',profile_id:v1.profile_id,revision:v1now.revision,effective_to:'2026-09-30',reason:'x'}),/Say why/);
 await ep('PARTNER',{action:'export_profile_end',profile_id:v1.profile_id,revision:v1now.revision,effective_to:'2026-09-30',reason:'Replaced by the Year 4 specification from October'});
 await ep('PARTNER',{action:'export_profile_publish',profile_id:d2.profile_id,revision:d2.revision,verified_against:'NSSF return specification Year 4',verified_on:'2026-11-15'});
 const sepStill=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id});assert.equal(sepStill.profile.version,1,'a later version does not change an earlier month');assert.equal(sepStill.preview[1][6],80001);
 const v1after=(await ep('MANAGER',{action:'export_profile_list'})).profiles.find(x=>x.profile_id===v1.profile_id);
 await assert.rejects(()=>ep('PARTNER',{action:'export_profile_retire',profile_id:v1.profile_id,revision:v1after.revision,reason:'No longer needed'}),/produced files|End it on a date/);
 await assert.rejects(()=>ep('PARTNER',{action:'export_profile_end',profile_id:v1.profile_id,revision:v1after.revision,effective_to:'2026-12-31',reason:'Try to extend it'}),/never extended/);
 // A variance between the summary and the posted journal blocks release: change a posted line (as the database owner, simulating a later difference).
 await db.exec('set session_replication_role=replica');
 await tx`update erp_private.ledger_lines set credit=credit+10 where journal_id=${made.journal_id} and account_code='21600'`;
 await db.exec('set session_replication_role=origin');
 const variance=await sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id});assert.equal(variance.ready,false);assert.equal(variance.reconciliation.status,'Variance');assert.ok(variance.issues.some(x=>/Account 21600: .*difference 10\.00/.test(x)),variance.issues.join('|'));
 await assert.rejects(()=>sf('ASSISTANT',{action:'statutory_file_prepare',kind:'NSSF',import_id:sep.import_id,release:true}),/not ready to release/);
 // The month list: only confirmed summaries, with whether the journal is posted.
 const read=await sf('ASSISTANT',{action:'statutory_file_read'});assert.deepEqual(read.months.map(m=>m.month),['2026-09']);assert.equal(read.exports.length,1);assert.equal(read.layouts.length,3);
});
