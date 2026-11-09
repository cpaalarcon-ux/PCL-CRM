// Audit build S4: SACCO layout, account map, statements, equity movements, statistics, the section-10 list and the report route.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('S4: SACCO statements, equity movements, statistics, section-10 list and the report route',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit adjustments firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id;
 // ---- A SACCO client, file and trial balances (current and comparative) -------------------------------------------------------------
 await db.exec('alter table erp_private.projects disable trigger sasra_project_gate;alter table erp_private.audit_files disable trigger sasra_file_gate');
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_structure,legal_subtype) values(${C},'Fictional Mkopo SACCO',${M},'Co-operative Society','Deposit-taking SACCO')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional SACCO audit','AUD-STAT',${M})`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const FILE=id();
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE},${P},${C},${F},'2025-01-01','2025-12-31','First-year','IFRS for SMEs',${M})`;
 // current, comparative, area, statement line
 const ACC=[['cash','1000','Cash at bank',3000000,2500000,'Cash and bank','Assets'],['loans','1100','Member loans',8000000,7000000,'Trade receivables','Assets'],['ecl','1190','Loan loss allowance',-400000,-300000,'Trade receivables','Assets'],
  ['ppe','1500','Property and equipment',1000000,900000,'Property, plant and equipment','Assets'],['dep','2000','Member deposits',-7000000,-6500000,'Borrowings','Liabilities'],['pay','2100','Payables',-800000,-350000,'Trade payables','Liabilities'],
  ['share','3000','Share capital',-2000000,-1800000,'Equity','Equity'],['stat','3100','Statutory reserve',-600000,-500000,'Equity','Equity'],['ret','3200','Retained earnings',-800000,-700000,'Equity','Equity'],
  ['inc','4000','Loan interest income',-1500000,-1200000,'Revenue','Revenue'],['fees','4100','Fees',-200000,-150000,'Revenue','Revenue'],['staff','6000','Staff costs',500000,450000,'Payroll and expenses','Operating expenses'],
  ['admin','6100','Administration',300000,250000,'Payroll and expenses','Operating expenses'],['depint','6200','Interest on deposits',400000,350000,'Payroll and expenses','Finance costs'],['imp','6300','Loan impairment',100000,50000,'Payroll and expenses','Operating expenses']];
 const acct={};
 for(const [k,code,name,,,area,fl] of ACC){acct[k]=id();await tx`insert into erp_private.audit_account_mappings(audit_account_id,handling_firm_id,legacy_account_code,legacy_account_name,audit_area,financial_statement_line,confirmed_by) values(${acct[k]},${F},${code},${name},${area},${fl},${M})`;}
 const mkImport=async(kind,col,sheet)=>{const DOC=id(),IMP=id(),H1=(kind==='Current'?'a':'c').repeat(64),H2=(kind==='Current'?'b':'d').repeat(64);
  await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${DOC},${C},${F},${P},'Import Sources',${sheet+'.xlsx'},${'k/'+sheet},1,${H1},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${M})`;
  const dr=ACC.reduce((s,a)=>s+Math.max(a[col],0),0);
  await tx`insert into erp_private.audit_tb_imports(audit_tb_import_id,audit_file_id,project_id,handling_firm_id,source_document_id,source_sha256,import_signature,sheet_name,period_ends_on,header_row,first_data_row,last_data_row,column_mapping,period_kind,status,source_row_count,total_debit,total_credit,imported_by,confirmed_by,confirmed_at) values(${IMP},${FILE},${P},${F},${DOC},${H1},${H2},'TB',${kind==='Current'?'2025-12-31':'2024-12-31'},1,2,${ACC.length+1},'{}',${kind},'Confirmed',${ACC.length},${dr},${dr},${M},${M},now())`;
  let row=2;for(const a of ACC){const amt=a[col];await tx`insert into erp_private.audit_tb_lines(audit_tb_import_id,audit_file_id,project_id,handling_firm_id,source_row,legacy_account_code,legacy_account_name,source_debit,source_credit,audit_account_id,audit_area,financial_statement_line,mapping_confidence) values(${IMP},${FILE},${P},${F},${row++},${a[1]},${a[2]},${Math.max(amt,0)},${Math.max(-amt,0)},${acct[a[0]]},${a[5]},${a[6]},'Confirmed')`;}};
 await mkImport('Current',3,'cur');
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const J=o=>JSON.stringify(o);
 const ws=async role=>JSON.parse(JSON.stringify((await q(role,'select erp_private.sacco_workspace($1) w',[FILE]))[0].w));
 const calc=async()=>JSON.parse(JSON.stringify((await db.query('select erp_private.sacco_fs_calc($1) r',[FILE])).rows[0].r));
 const line=(sec,code)=>sec.flatMap(s=>s.lines).find(l=>l.code===code);
 const mapAll=async(role,only)=>{const items=ACC.filter(a=>!only||only.includes(a[0])).map(a=>({audit_account_id:acct[a[0]],line_code:LINE[a[0]]}));return q(role,'select erp_private.sacco_map_save($1::jsonb) r',[J(items)]);};
 const LINE={cash:'A.CASH',loans:'A.LOANS',ecl:'A.ECL',ppe:'A.PPE',dep:'L.DEPOSITS',pay:'L.PAYABLES',share:'E.SHARE',stat:'E.STATUTORY',ret:'E.RETAINED',inc:'I.LOANS',fees:'I.FEES',staff:'X.STAFF',admin:'X.ADMIN',depint:'X.DEPINT',imp:'X.ECL'};

 // ---- 1. The draft layout exists, is valid, and gates everything until a Partner approves it ----------------------------------------
 let w=await ws('MANAGER');
 assert.equal(w.layout.status,'Draft');assert.equal(w.layout.version,1);assert.equal(w.layout.problem,null);assert.equal(w.layout.lines.length,54);
 assert.equal(await q('INTERN','select erp_private.sacco_workspace($1) w',[FILE]).then(r=>r[0].w),null,'an intern sees nothing');
 let c=await calc();
 assert.equal(c.layout,'SACCO');assert.match(c.blocking.join(' '),/still a draft/);assert.match(c.blocking.join(' '),/15 accounts with balances are not mapped/);
 assert.equal(c.comparative_available,false);assert.match(c.warnings.join(' '),/No comparative trial balance/);
 // The general report is routed: a SACCO file gets the SACCO body, an ordinary file the standard one.
 assert.equal((await db.query('select erp_private.audit_fs_calc($1) r',[FILE])).rows[0].r.layout,'SACCO');
 const C2=id(),P2=id(),FILE2=id();
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C2},'Fictional Ordinary Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C2},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${C2},${F},'Fictional ordinary audit','AUD-STAT',${M})`;
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE2},${P2},${C2},${F},'2025-01-01','2025-12-31','First-year','IFRS for SMEs',${M})`;
 const std=(await db.query('select erp_private.audit_fs_calc($1) r',[FILE2])).rows[0].r;assert.equal(std.layout,undefined);assert.equal(std.statement,'Financial statements');assert.ok(Array.isArray(std.sections));
 assert.equal(await q('MANAGER','select erp_private.sacco_workspace($1) w',[FILE2]).then(r=>r[0].w),null,'not a SACCO file');
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_value_save($1,$2,1,$3)',[FILE2,'S.MEMBERS','Register']),/not for a SACCO/);

 // ---- 2. Mapping: proposals need a Partner, bad lines are refused -------------------------------------------------------------------
 await assert.rejects(()=>mapAll('INTERN'),/Not allowed/);
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_map_save($1::jsonb)',[J([{audit_account_id:acct.cash,line_code:'A.TOTAL'}])]),/Choose a statement line/);
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_map_save($1::jsonb)',[J([])]),/at least one account/);
 let r=(await mapAll('MANAGER',['cash','loans','ecl','ppe','dep','pay']))[0].r;assert.equal(r.status,'Proposed');assert.equal(r.saved,6);
 c=await calc();assert.match(c.blocking.join(' '),/9 accounts with balances are not mapped/);assert.match(c.blocking.join(' '),/6 mapped accounts are waiting for Partner approval/);
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_map_approve($1::uuid[])',[[acct.cash]]),/Only a Partner/);
 r=(await mapAll('PARTNER',['share','stat','ret','inc','fees','staff','admin','depint','imp']))[0].r;assert.equal(r.status,'Approved');
 assert.equal((await q('PARTNER','select erp_private.sacco_map_approve($1::uuid[]) r',[ACC.map(a=>acct[a[0]])]))[0].r.approved,6);
 c=await calc();assert.doesNotMatch(c.blocking.join(' '),/not mapped|waiting for Partner approval/);
 // A manager changing an approved mapping puts it back to proposed.
 await mapAll('MANAGER',['cash']);assert.equal((await ws('MANAGER')).accounts.find(a=>a.audit_account_id===acct.cash).map_status,'Approved','saving the same line again changes nothing');
 await q('MANAGER','select erp_private.sacco_map_save($1::jsonb)',[J([{audit_account_id:acct.cash,line_code:'A.INVEST'}])]);
 assert.equal((await ws('MANAGER')).accounts.find(a=>a.audit_account_id===acct.cash).map_status,'Proposed');
 await mapAll('PARTNER',['cash']);

 // ---- 3. Statements from the adjusted trial balance --------------------------------------------------------------------------------
 c=await calc();
 assert.equal(line(c.position,'A.TOTAL').current,11600000);assert.equal(line(c.position,'A.ECL').current,-400000);assert.equal(line(c.position,'L.TOTAL').current,7800000);
 assert.equal(line(c.position,'E.SURPLUS').current,400000);assert.equal(line(c.position,'E.TOTAL').current,3800000);assert.equal(line(c.position,'LE.TOTAL').current,11600000);
 assert.equal(line(c.income,'I.TOTAL').current,1700000);assert.equal(line(c.income,'X.TOTAL').current,1300000);assert.equal(line(c.income,'P.SURPLUS').current,400000);
 assert.equal(c.balances,true);assert.equal(c.totals.difference,0);assert.equal(line(c.position,'A.CASH').comparative,null);
 assert.deepEqual(c.soce.columns.map(x=>x.code),['E.SHARE','E.STATUTORY','E.INSTITUTIONAL','E.REVAL','E.OTHERRES','E.RETAINED']);
 // The surplus lands in the retained-earnings column.
 const row=k=>c.soce.rows.find(x=>x.key===k);
 assert.equal(row('surplus').values['E.RETAINED'],400000);assert.equal(row('closing').values['E.RETAINED'],1200000);assert.equal(row('closing').total,3800000);

 // ---- 4. Layout editing and approval -----------------------------------------------------------------------------------------------
 const L1=w.layout.layout_id;
 const edit=(role,data)=>q(role,'select erp_private.sacco_layout_line_save($1,$2::jsonb) r',[L1,J(data)]);
 const ln=code=>w.layout.lines.find(x=>x.line_code===code);
 await assert.rejects(()=>edit('SUPERVISOR',{...ln('A.CASH'),caption:'Cash'}),/Only a Manager or Partner/);
 await edit('MANAGER',{...ln('A.CASH'),caption:'Cash and bank balances'});
 await assert.rejects(()=>edit('MANAGER',{...ln('E.TOTAL'),total_of:['E.SHARE','NOPE']}).then(()=>q('PARTNER','select erp_private.sacco_layout_approve($1,$2)',[L1,'Checked every caption and total'])),/refers to a line that does not exist/);
 await edit('MANAGER',{...ln('E.TOTAL')});
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_layout_line_remove($1,$2)',[L1,'E.SHARE']),/still uses this line/);
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_layout_copy()'),/already a draft/);
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_layout_approve($1,$2)',[L1,'Checked every caption and total']),/Only a Partner/);
 await assert.rejects(()=>q('PARTNER','select erp_private.sacco_layout_approve($1,$2)',[L1,'short']),/at least 10/);
 await edit('MANAGER',{...ln('X.TAX'),caption:'Income tax expense'});
  await q('PARTNER','select erp_private.sacco_layout_approve($1,$2)',[L1,'Read every caption, total and note against the specimen']);
 w=await ws('MANAGER');assert.equal(w.layout.status,'Approved');assert.equal(w.layout.approved_by_name,'Fictional PARTNER');assert.equal(w.draft,null);
 await assert.rejects(()=>db.query(`update erp_private.sacco_layout_lines set caption='Changed' where layout_id=$1 and line_code='A.CASH'`,[L1]),/Only a draft layout can be changed/);
 await assert.rejects(()=>db.query(`update erp_private.sacco_layouts set title='Another title here' where layout_id=$1`,[L1]),/cannot be changed/);
 await assert.rejects(()=>q('PARTNER','select erp_private.sacco_layout_line_save($1,$2::jsonb)',[L1,J(ln('A.CASH'))]),/Only a draft layout can be edited/);
 c=await calc();assert.doesNotMatch(c.blocking.join(' '),/still a draft/);assert.equal(c.layout_status,'Approved');

 // ---- 5. Equity movements explain the change in each reserve (needs the comparative trial balance) ------------------------------------
 await mkImport('Comparative',4,'cmp');
 c=await calc();assert.equal(c.comparative_available,true);
 assert.equal(line(c.position,'A.TOTAL').comparative,10100000);
 assert.equal(c.soce.rows.find(x=>x.key==='opening').values['E.RETAINED'],950000,'opening retained earnings include the prior-year surplus');
 assert.match(c.blocking.join(' '),/statement of changes in equity does not reconcile/);
 const mv=(role,l,k,a,n='Resolution of the annual general meeting')=>q(role,'select erp_private.sacco_move_save($1,$2,$3,$4,$5) r',[FILE,l,k,a,n]);
 await assert.rejects(()=>mv('INTERN','E.SHARE','Other',1),/Not allowed/);
 await assert.rejects(()=>mv('MANAGER','A.CASH','Other',1),/Choose a reserve/);
 await assert.rejects(()=>mv('MANAGER','E.SHARE','Other',0),/Enter the amount/);
 await assert.rejects(()=>mv('MANAGER','E.SHARE','Made up kind',5),/violates check constraint/);
 await mv('SUPERVISOR','E.SHARE','Shares issued or redeemed',200000,'Share contributions per the members register');
 await mv('SUPERVISOR','E.STATUTORY','Transfer to or from reserve',100000,'Transfer per the AGM resolution');
 c=await calc();assert.match(c.blocking.join(' '),/Transfers between reserves do not net to zero \(difference 100000/);
 await mv('SUPERVISOR','E.RETAINED','Transfer to or from reserve',-100000,'Transfer per the AGM resolution');
 await mv('SUPERVISOR','E.RETAINED','Dividend on shares',-50000,'Dividend declared at the AGM');
 c=await calc();assert.deepEqual(c.blocking,[],'everything reconciles: '+c.blocking.join(' | '));
 assert.equal(c.soce.rows.find(x=>x.key==='difference').total,0);assert.equal(c.soce.rows.find(x=>x.key==='expected').values['E.RETAINED'],1200000);
 // A wrong dividend shows up as an unexplained difference; withdrawing it fixes it. Only the enterer, a Manager or a Partner may withdraw.
 await (q('ASSISTANT',`select erp_private.sacco_move_save($1,'E.OTHERRES','Other',5000,'Mistaken entry for the test') r`,[FILE]));
 const badId=(await db.query(`select move_id from erp_private.sacco_equity_moves where note='Mistaken entry for the test'`)).rows[0].move_id;
 c=await calc();assert.match(c.blocking.join(' '),/does not reconcile/);
 await assert.rejects(()=>q('SUPERVISOR','select erp_private.sacco_move_withdraw($1,$2)',[badId,'Wrong reserve chosen']),/Only the person who entered it/);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.sacco_move_withdraw($1,$2)',[badId,'no']),/at least 5/);
 await q('ASSISTANT','select erp_private.sacco_move_withdraw($1,$2)',[badId,'Wrong reserve chosen']);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.sacco_move_withdraw($1,$2)',[badId,'Wrong reserve chosen']),/already withdrawn/);
 c=await calc();assert.deepEqual(c.blocking,[]);
 w=await ws('MANAGER');assert.equal(w.moves.length,5);assert.equal(w.moves.filter(m=>m.status==='Withdrawn').length,1);

 // ---- 6. Statistics ------------------------------------------------------------------------------------------------------------------
 const st=(role,l,a,n='Members register at 31 December')=>q(role,'select erp_private.sacco_value_save($1,$2,$3,$4) r',[FILE,l,a,n]);
 await assert.rejects(()=>st('MANAGER','S.MEMBERS',1200.5),/whole number/);
 await assert.rejects(()=>st('MANAGER','S.MEMBERS',-1),/zero or more/);
 await assert.rejects(()=>st('MANAGER','A.CASH',5),/Choose a statistic/);
 await assert.rejects(()=>st('MANAGER','S.MEMBERS',5,'no'),/at least 5/);
 await assert.rejects(()=>st('INTERN','S.MEMBERS',5),/Not allowed/);
 await st('ASSISTANT','S.MEMBERS',1200);await st('MANAGER','S.MEMBERS',1250,'Members register, corrected');
 c=await calc();const stat=code=>c.statistics.find(x=>x.code===code);
 assert.equal(stat('S.MEMBERS').value,1250,'the latest entry wins');assert.equal(stat('S.MEMBERS').source_note,'Members register, corrected');assert.equal(stat('S.NPL').value,null);
 assert.match(c.warnings.join(' '),/6 statistics have no value yet/);assert.ok(Array.isArray(c.ratios));

 // ---- 7. Section-10 items: prepared by one person, reviewed by another, unreviewed items block sign-off ----------------------------
 c=await calc();assert.equal(c.checks.length,7);assert.ok(c.checks.every(x=>x.status==='Open'));
 const sup=code=>c.checks.find(x=>x.code===code).support;
 assert.equal(sup('C.DIVRES').state,'ok');assert.equal(sup('C.ECL').state,'attention');assert.match(sup('C.ECL').text,/Enter the prudential provision/);
 await st('MANAGER','S.PRUDPROV',450000,'Prudential provision schedule, page 3');
 c=await calc();assert.match(sup('C.ECL').text,/difference \(prudential less allowance\) 50000/);
 await st('MANAGER','S.PRUDPROV',400000,'Prudential provision schedule, revised');
 c=await calc();assert.equal(sup('C.ECL').state,'ok');
 assert.match(sup('C.CAPLIQ').text,/SASRA figure lines/);
 const prep=(role,l,app,n='Agreed to the signed legal note in the file')=>q(role,'select erp_private.sacco_check_prepare($1,$2,$3,$4) r',[FILE,l,app,n]);
 const rev=(role,l,ok,n='Agreed')=>q(role,'select erp_private.sacco_check_review($1,$2,$3,$4) r',[FILE,l,ok,n]);
 await assert.rejects(()=>prep('INTERN','C.LEGAL',true),/Not allowed/);
 await assert.rejects(()=>prep('ASSISTANT','C.NOPE',true),/Choose a section-10 item/);
 await assert.rejects(()=>prep('ASSISTANT','C.LEGAL',true,'short'),/at least 10/);
 await prep('MANAGER','C.LEGAL',true);
 await assert.rejects(()=>rev('MANAGER','C.LEGAL',true),/someone else must review/);
 await assert.rejects(()=>rev('SUPERVISOR','C.LEGAL',true),/Only a Manager or Partner/);
 await assert.rejects(()=>rev('PARTNER','C.DIRECTORS',true),/not waiting for review/);
 await rev('PARTNER','C.LEGAL',false,'Name the licence number too');
 c=await calc();assert.equal(c.checks.find(x=>x.code==='C.LEGAL').status,'Returned');
 await prep('MANAGER','C.LEGAL',true,'Licence number added to the legal note');
 await rev('MANAGER2','C.LEGAL',true);
 c=await calc();assert.equal(c.checks.find(x=>x.code==='C.LEGAL').status,'Reviewed');assert.equal(c.checks.find(x=>x.code==='C.LEGAL').reviewer_name,'Fictional MANAGER2');
 const issues=async()=>(await q('MANAGER','select erp_private.sasra_signoff_issues($1) r',[FILE]))[0].r;
 let iss=await issues();assert.ok(iss.some(x=>/Section 10 item not reviewed: Directors' statement/.test(x)));assert.ok(!iss.some(x=>/Legal framework note/.test(x)));assert.ok(!iss.some(x=>/layout is not approved/.test(x)));
 for(const code of ['C.DIRECTORS','C.REGREPORT','C.CAPLIQ','C.ECL','C.AML','C.DIVRES']){await prep('ASSISTANT',code,code!=='C.REGREPORT','Done and filed, or not applicable for this SACCO');await rev('PARTNER',code,true);}
 iss=await issues();assert.ok(!iss.some(x=>/Section 10/.test(x)),'nothing left to review: '+iss.join(' | '));
 // Preparing again sends a reviewed item back for review.
 await prep('ASSISTANT','C.AML',true,'Updated after a late finding');iss=await issues();assert.ok(iss.some(x=>/AML, CFT and CPF/.test(x)),'a re-prepared item needs review again');
 await rev('MANAGER','C.AML',true);

 // ---- 8. The report: draft, gate on submit, stale when a basis changes ------------------------------------------------------------------
 const draft=role=>q(role,`select erp_private.audit_report_draft($1,'Financial statements','{}'::jsonb) id`,[FILE]).then(r=>r[0].id);
 const body=async id=>JSON.parse(JSON.stringify((await db.query('select body from erp_private.audit_reports where report_id=$1',[id])).rows[0].body));
 const R1=await draft('ASSISTANT');let b=await body(R1);
 assert.equal(b.layout,'SACCO');assert.equal(b.checks,undefined,'the section-10 list is not part of the statements');assert.equal(b.layout_version,1);assert.equal(b.entity,'Fictional Mkopo SACCO');assert.deepEqual(b.blocking,[]);
 const status=async()=>(await q('MANAGER','select erp_private.audit_report_status($1) s',[FILE]))[0].s.find(x=>x.kind==='Financial statements');
 // Two new accounts with balances (a debit and a credit, so the statements still balance) that are not on the map block submission.
 const extra1=id(),extra2=id();
 for(const [k,code,nm,fl] of [[extra1,'1900','Suspense','Assets'],[extra2,'2900','Accrual','Liabilities']])await tx`insert into erp_private.audit_account_mappings(audit_account_id,handling_firm_id,legacy_account_code,legacy_account_name,audit_area,financial_statement_line,confirmed_by) values(${k},${F},${code},${nm},'Cash and bank',${fl},${M})`;
 const CURIMP=(await tx`select audit_tb_import_id from erp_private.audit_tb_imports where audit_file_id=${FILE} and period_kind='Current'`)[0].audit_tb_import_id;
 for(const [k,code,nm,d,cr,fl] of [[extra1,'1900','Suspense',1000,0,'Assets'],[extra2,'2900','Accrual',0,1000,'Liabilities']])await tx`insert into erp_private.audit_tb_lines(audit_tb_import_id,audit_file_id,project_id,handling_firm_id,source_row,legacy_account_code,legacy_account_name,source_debit,source_credit,audit_account_id,audit_area,financial_statement_line,mapping_confidence) values(${CURIMP},${FILE},${P},${F},${code==='1900'?98:99},${code},${nm},${d},${cr},${k},'Cash and bank',${fl},'Confirmed')`;
 await assert.rejects(()=>q('ASSISTANT','select erp_private.audit_report_submit($1)',[R1]),/figures behind this report have changed/);
 const R2=await draft('ASSISTANT');b=await body(R2);assert.match(b.blocking.join(' '),/2 accounts with balances are not mapped to a statement line: 1900 Suspense, 2900 Accrual/);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.audit_report_submit($1)',[R2]),/not ready to submit: 2 accounts with balances are not mapped/);
 await q('PARTNER','select erp_private.sacco_map_save($1::jsonb) r',[J([{audit_account_id:extra1,line_code:'A.OTHER'},{audit_account_id:extra2,line_code:'L.OTHER'}])]);
 const R3=await draft('ASSISTANT');b=await body(R3);assert.deepEqual(b.blocking,[]);assert.equal(line(b.position,'A.OTHER').current,1000);assert.equal(line(b.position,'L.OTHER').current,1000);
 await q('ASSISTANT','select erp_private.audit_report_submit($1)',[R3]);
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_report_review($1,$2,$3)',[R3,'Approve','Reviewed against the trial balance']),/Only a Partner approves/);
 await q('PARTNER','select erp_private.audit_report_review($1,$2,$3)',[R3,'Approve','Reviewed against the trial balance and the layout']);
 let s=await status();assert.equal(s.current,true);assert.equal(s.approved_report_id,R3);
 // Anything the statements are built on makes the approved version out of date: a statistic, a movement, the map.
 await st('MANAGER','S.EMPLOYEES',14,'Payroll headcount');s=await status();assert.equal(s.current,false,'a new statistic changes the basis');
 const R4=await draft('MANAGER');await q('MANAGER','select erp_private.audit_report_submit($1)',[R4]);await q('PARTNER','select erp_private.audit_report_review($1,$2,$3)',[R4,'Approve','Statistic added, rest unchanged here']);
 s=await status();assert.equal(s.current,true);
 await q('PARTNER','select erp_private.sacco_map_save($1::jsonb) r',[J([{audit_account_id:extra1,line_code:'A.RECEIV'}])]);s=await status();assert.equal(s.current,false,'a remapped account changes the basis');

 // ---- 9. A new layout version supersedes the old one --------------------------------------------------------------------------------------
 await assert.rejects(()=>q('SUPERVISOR','select erp_private.sacco_layout_copy()'),/Only a Manager or Partner/);
 const L2=(await q('MANAGER','select erp_private.sacco_layout_copy() id'))[0].id;
 w=await ws('MANAGER');assert.equal(w.layout.version,1,'the approved version is still the one in use');assert.equal(w.draft.version,2);assert.equal(w.draft.lines.length,w.layout.lines.length);
 await q('MANAGER','select erp_private.sacco_layout_line_save($1,$2::jsonb)',[L2,J({...w.draft.lines.find(x=>x.line_code==='L.OTHER'),caption:'Other liabilities and provisions'})]);
 await q('PARTNER','select erp_private.sacco_layout_approve($1,$2)',[L2,'Version 2 reviewed against version 1']);
 w=await ws('PARTNER');assert.equal(w.layout.version,2);assert.deepEqual(w.versions.map(v=>v.status),['Approved','Superseded']);
 c=await calc();assert.equal(c.layout_version,2);assert.equal(line(c.position,'L.OTHER').caption,'Other liabilities and provisions');
 // A layout that drops a line accounts are mapped to cannot be approved.
 const L3=(await q('MANAGER','select erp_private.sacco_layout_copy() id'))[0].id;
 w=await ws('MANAGER');
 await assert.rejects(()=>q('MANAGER','select erp_private.sacco_layout_line_remove($1,$2)',[L3,'A.RECEIV']),/still uses this line/);
 const tot=w.draft.lines.find(x=>x.line_code==='A.TOTAL');
 await q('MANAGER','select erp_private.sacco_layout_line_save($1,$2::jsonb)',[L3,J({...tot,total_of:tot.total_of.filter(x=>x!=='A.RECEIV')})]);
 await q('MANAGER','select erp_private.sacco_layout_line_remove($1,$2)',[L3,'A.RECEIV']);
 w=await ws('PARTNER');assert.match(w.draft.problem,/Accounts are mapped to A\.RECEIV, which is not a line in this layout/);
 await assert.rejects(()=>q('PARTNER','select erp_private.sacco_layout_approve($1,$2)',[L3,'Dropping a line to see the check']),/Accounts are mapped to A\.RECEIV/);
});
