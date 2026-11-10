// Forensic restricted file: access list, evidence with chain of custody, findings tied to evidence, litigation hold, report issue and lock.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Forensic file: hidden from everyone off the list, evidence, custody, findings, hold, report issue and lock',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id,AST=actors.ASSISTANT.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M,firm=F)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${firm})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 // ---- fixture: extra people ---------------------------------------------------------------------------------------------------------------------
 const extra=async(role,cat,firms)=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;
  await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;
  await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;for(const f of firms)await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${f},'Assigned')`;return a.staff_id;};
 const F2=id();await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F2},'OTHR','Another fictional firm')`;
 const ADM=await extra('ADMIN','ADMIN',[]),OUT=await extra('OUTSIDER','MANAGER',[F2]);
 const SUP=actors.SUPERVISOR.staff_id,PT2=actors.PARTNER2.staff_id,INT=actors.INTERN.staff_id;
 const A=await mk('UAT Fictional Services Ltd','A500000001Z'),B=await mk('UAT Fictional Traders Ltd','A500000002Z',M,F2);
 const sha=n=>n.toString(16).padStart(64,'0');
 const call=(role,fn,args=[])=>q(role,`select erp_private.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) r`,args).then(r=>j(r[0].r));
 const open=(role,o={})=>{const v={c:id(),client:A,firm:F,title:'Fictional forensic review of cash receipts',mandate:'Instructed by the fictional client to examine cash receipts for the year ended 2025.',day:'2026-11-01',...o};
  return call(role,'forensic_case_open',[v.c,v.client,v.firm,v.title,v.mandate,v.day]);};
 const ev=(role,c,o={})=>{const v={id:id(),desc:'Fictional bank statement extract',src:'Handed over by the fictional client accountant',day:'2026-11-02',file:'statement.pdf',size:2048,sha:sha(++counter),mime:'application/pdf',...o};
  return call(role,'forensic_evidence_register',[v.id,c,v.desc,v.src,v.day,v.file,o.key??`forensic/${c}/${v.id}.pdf`,v.size,v.sha,v.mime]).then(r=>({...r,id:v.id}));};
 let counter=1000;

 // ---- 1. Settings: defaults until a Partner confirms them -------------------------------------------------------------------------------------
 const st=j(await tx`select setting_key,text_value,rule_status from erp_private.forensic_settings order by setting_key`);
 assert.equal(st.length,2);assert.ok(st.every(s=>s.rule_status==='Suggested'));
 assert.equal(st.find(s=>s.setting_key==='standard_reference').text_value,'[FORENSIC STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]');
 assert.equal(st.find(s=>s.setting_key==='report_needs_verified_standard').text_value,'YES');
 await q('MANAGER',`update erp_private.forensic_settings set text_value='NO' where setting_key='report_needs_verified_standard'`);
 assert.equal((await tx`select text_value from erp_private.forensic_settings where setting_key='report_needs_verified_standard'`)[0].text_value,'YES','a Manager cannot change a setting');
 assert.equal((await q('MANAGER',`select * from erp_private.forensic_settings`)).length,0,'a Manager cannot even read the settings');
 await assert.rejects(q('PARTNER',`update erp_private.forensic_settings set text_value=$1 where setting_key='standard_reference'`,['ISRS '+'4000 forensic']),/not used until the Compliance Lead has verified/);
 await assert.rejects(q('PARTNER',`update erp_private.forensic_settings set text_value='MAYBE' where setting_key='report_needs_verified_standard'`),/Choose YES or NO/);
 await assert.rejects(q('PARTNER',`update erp_private.forensic_settings set rule_status='Confirmed',confirmed_by=$1,source_note='Compliance Lead email of 10 Nov' where setting_key='standard_reference'`,[PT]),/placeholder cannot be confirmed/);

 // ---- 2. Opening a file ------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(open('MANAGER'),/Only a Partner can open a forensic file/);
 await assert.rejects(open('PARTNER',{firm:F2}),/handling firm that serves this client/);
 await assert.rejects(open('PARTNER',{day:'2999-01-01'}),/cannot be in the future/);
 await assert.rejects(open('PARTNER',{title:'Short'.slice(0,3)}),/check constraint|title/);
 await assert.rejects(open('PARTNER',{title:'Review under '+'ISRS '+'4000 of cash'}),/check constraint|title/);
 const k1=await open('PARTNER');
 assert.match(k1.case_ref,/^FOR-\d{4}-\d{4}$/);
 const lst=await call('PARTNER','forensic_list');assert.equal(lst.length,1);assert.equal(lst[0].my_level,'Lead');assert.equal(lst[0].client_name,'UAT Fictional Services Ltd');assert.equal(lst[0].hold_active,false);

 // ---- 2b. The client card says nothing about a forensic file to anyone, the lead included (decision of 10 Nov 2026, build 2700) ---------------------
 const cardCols=await q('PARTNER',`select * from erp_private.client_card_flags($1::uuid[])`,[[A]]);
 assert.equal(cardCols.length,1);assert.ok(!Object.keys(cardCols[0]).some(k=>/forensic/i.test(k)),'the card question has no forensic column at all');
 assert.deepEqual(Object.keys(cardCols[0]).sort(),['client_id','filing_late','filing_late_days','filing_soon','filing_soon_days','incoming_overdue','incoming_waiting','kra_days','kra_open']);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where table_name ~* 'forensic' or action ~* 'forensic'`)[0].n,0,'nothing forensic is in the general log');
 await assert.rejects(tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key) values(${actors.PARTNER.auth_user_id},'x','forensic_cases','INSERT','k')`,/audit_events_no_forensic/,'the general log refuses a forensic table');
 await assert.rejects(tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key) values(${actors.PARTNER.auth_user_id},'x','clients','VIEW_FORENSIC','k')`,/audit_events_no_forensic/,'the general log refuses a forensic action');
 // The menu entry: a Partner (who can open a first file) or anyone on an access list; nobody else.
 const menu=role=>q(role,`select erp_private.forensic_menu() r`).then(r=>r[0].r);
 assert.equal(await menu('PARTNER'),true);assert.equal(await menu('PARTNER2'),true);
 for(const role of ['MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN','ADMIN','OUTSIDER'])assert.equal(await menu(role),false,role+' off every list gets no menu entry');
 assert.deepEqual((await tx`select has_function_privilege('anon','erp_private.forensic_menu()','execute') a,has_function_privilege('erp_api','erp_private.forensic_menu()','execute') b`)[0],{a:false,b:true});
 // ---- 3. Hidden from everyone off the list (other Partners, Managers, Supervisors, the administrator) ------------------------------------------
 for(const role of ['PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN','ADMIN','OUTSIDER']){
  assert.deepEqual(await call(role,'forensic_list'),[],role+' sees no forensic file');
  await assert.rejects(call(role,'forensic_get',[k1.case_id]),/not available to you/,role);
  for(const t of ['forensic_cases','forensic_access','forensic_evidence','forensic_custody','forensic_findings','forensic_reports','forensic_holds','forensic_events'])
   assert.equal((await q(role,`select count(*)::int n from erp_private.${t}`))[0].n,0,role+' reads no rows of '+t);
 }
 await assert.rejects(call('PARTNER2','forensic_get',['00000000-0000-0000-0000-000000000000']),/not available to you/,'a missing file gives the same answer as a hidden one');
 await assert.rejects(call('PARTNER2','forensic_access_add',[k1.case_id,PT2,'Viewer']),/not available to you/);
 await assert.rejects(ev('PARTNER2',k1.case_id),/not available to you/);
 await assert.rejects(call('PARTNER2','forensic_report_save',[k1.case_id,'A report that nobody else may write.']),/not available to you/);
 await assert.rejects(call('PARTNER2','forensic_hold_set',[k1.case_id,'A hold from someone off the list']),/not available to you/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where table_name like 'forensic%'`)[0].n,0,'the general audit log never holds forensic rows');
 await assert.rejects(q('PARTNER',`insert into erp_private.forensic_cases(case_ref,firm_id,client_id,title,mandate_text,mandate_date,lead_id,opened_by) values('X',$1,$2,'Direct insert title','A direct insert should never be allowed here.','2026-11-01',$3,$3)`,[F,A,PT]),/permission denied/);
 await assert.rejects(q('PARTNER',`update erp_private.forensic_cases set title='Renamed directly by a Partner' where case_id=$1`,[k1.case_id]),/permission denied/);

 // ---- 4. The access list -----------------------------------------------------------------------------------------------------------------------
 await assert.rejects(call('MANAGER','forensic_access_add',[k1.case_id,M2,'Viewer']),/not available to you/,'a Manager off the list cannot add anyone');
 await assert.rejects(call('PARTNER','forensic_access_add',[k1.case_id,ADM,'Viewer']),/Administrators and Interns cannot be added/);
 await assert.rejects(call('PARTNER','forensic_access_add',[k1.case_id,INT,'Viewer']),/Administrators and Interns cannot be added/);
 await assert.rejects(call('PARTNER','forensic_access_add',[k1.case_id,OUT,'Viewer']),/does not work in the firm/);
 await assert.rejects(call('PARTNER','forensic_access_add',[k1.case_id,M,'Lead']),/Investigator or Viewer/);
 await call('PARTNER','forensic_access_add',[k1.case_id,M,'Investigator']);
 await call('PARTNER','forensic_access_add',[k1.case_id,AST,'Viewer']);
 assert.equal(await menu('MANAGER'),true,'an Investigator on the list gets the menu entry');assert.equal(await menu('ASSISTANT'),true,'a Viewer on the list gets it too');assert.equal(await menu('MANAGER2'),false,'a Manager not on the list still does not');
 await assert.rejects(call('PARTNER','forensic_access_add',[k1.case_id,M,'Viewer']),/already on the list/);
 const opts=await call('PARTNER','forensic_staff_options',[k1.case_id]);
 assert.ok(opts.some(o=>o.staff_id===PT2)&&opts.some(o=>o.staff_id===SUP));
 assert.ok(!opts.some(o=>[ADM,INT,OUT,M,AST,PT].includes(o.staff_id)),'options leave out administrators, Interns, people off the firm and people already listed');
 await assert.rejects(call('MANAGER','forensic_staff_options',[k1.case_id]),/Only the lead Partner can do this/);
 await assert.rejects(call('MANAGER','forensic_access_add',[k1.case_id,SUP,'Viewer']),/Only the lead Partner can do this/,'an Investigator cannot add anyone');
 assert.equal((await call('MANAGER','forensic_list')).length,1);assert.equal((await call('ASSISTANT','forensic_list'))[0].my_level,'Viewer');
 for(const role of ['SUPERVISOR','PARTNER2'])assert.deepEqual(await call(role,'forensic_list'),[],role+' is still off the list');

 // ---- 5. Evidence, custody -----------------------------------------------------------------------------------------------------------------------
 await assert.rejects(ev('ASSISTANT',k1.case_id),/read-only access/,'a Viewer cannot add evidence');
 await assert.rejects(ev('MANAGER',k1.case_id,{key:'forensic/other/x.pdf'}),/not stored under this forensic file/);
 await assert.rejects(ev('MANAGER',k1.case_id,{day:'2999-01-01'}),/cannot be in the future/);
 const e1=await ev('MANAGER',k1.case_id);assert.equal(e1.evidence_no,1);
 const e2=await ev('PARTNER',k1.case_id,{desc:'Fictional cash book extract',file:'cashbook.xlsx',mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});assert.equal(e2.evidence_no,2);
 const dupSha=sha(777);await ev('PARTNER',k1.case_id,{sha:dupSha});
 await assert.rejects(ev('PARTNER',k1.case_id,{sha:dupSha}),/already evidence item 3/);
 const g1=await call('MANAGER','forensic_get',[k1.case_id]);
 assert.equal(g1.evidence.length,3);assert.equal(g1.evidence[0].custody[0].event_type,'Received');assert.equal(g1.evidence[0].custody[0].to_holder,'Fictional MANAGER');
 await assert.rejects(call('ASSISTANT','forensic_custody_add',[e1.id,'Examined',null,null,'Read by a Viewer',null]),/read-only access/);
 await assert.rejects(call('MANAGER','forensic_custody_add',[e1.id,'Transferred','Fictional Manager',null,null,null]),/check constraint|chk|forensic_custody/);
 await assert.rejects(call('MANAGER','forensic_custody_add',[e1.id,'Received',null,null,null,null]),/Choose Transferred/);
 await assert.rejects(call('MANAGER','forensic_custody_add',[e1.id,'Examined',null,null,null,'2999-01-01T00:00:00Z']),/future/);
 await call('MANAGER','forensic_custody_add',[e1.id,'Transferred','Fictional Manager','Fictional court registry','Handed over against receipt',null]);
 assert.equal((await call('MANAGER','forensic_get',[k1.case_id])).evidence[0].custody.length,2);
 await assert.rejects(q('PARTNER',`update erp_private.forensic_custody set note='edited' where evidence_id=$1`,[e1.id]),/permission denied/);
 await assert.rejects(tx`update erp_private.forensic_custody set note='edited' where evidence_id=${e1.id}`,/append-only/);
 await assert.rejects(tx`delete from erp_private.forensic_custody where evidence_id=${e1.id}`,/archived, not deleted/);
 // download goes through a function that checks the list and logs
 const file=await call('MANAGER','forensic_evidence_file',[e1.id]);assert.equal(file.file_name,'statement.pdf');assert.match(file.object_key,/^forensic\//);
 await assert.rejects(call('PARTNER2','forensic_evidence_file',[e1.id]),/not available to you/);

 // ---- 6. Findings must cite evidence --------------------------------------------------------------------------------------------------------------
 await assert.rejects(call('ASSISTANT','forensic_finding_add',[k1.case_id,'Receipts not banked','Cash receipts of the fictional client were not banked on the day.',[e1.id]]),/read-only access/);
 await assert.rejects(call('MANAGER','forensic_finding_add',[k1.case_id,'Receipts not banked','Cash receipts of the fictional client were not banked on the day.',[]]),/at least one item of evidence/);
 await assert.rejects(call('MANAGER','forensic_finding_add',[k1.case_id,'Receipts not banked','Cash receipts of the fictional client were not banked on the day.',[id()]]),/live evidence in this forensic file/);
 const f1=await call('MANAGER','forensic_finding_add',[k1.case_id,'Receipts not banked','Cash receipts of the fictional client were not banked on the day.',[e1.id,e2.id,e1.id]]);assert.equal(f1.seq,1);
 const g2=await call('MANAGER','forensic_get',[k1.case_id]);assert.deepEqual(g2.findings[0].evidence_nos,[1,2]);
 await assert.rejects(call('PARTNER','forensic_evidence_withdraw',[e1.id,'Wrong file uploaded in error']),/finding still cites/);
 await assert.rejects(call('MANAGER','forensic_finding_withdraw',[f1.finding_id,'Not supported by the evidence']),/Only the lead Partner/);
 await assert.rejects(call('PARTNER','forensic_finding_withdraw',[f1.finding_id,'short']),/at least 10 characters/);
 const f2=await call('MANAGER','forensic_finding_add',[k1.case_id,'Second finding','A second fictional finding that cites the cash book extract only.',[e2.id]]);
 await call('PARTNER','forensic_finding_withdraw',[f2.finding_id,'Cash book extract was superseded']);
 await call('PARTNER','forensic_evidence_withdraw',[(await ev('MANAGER',k1.case_id)).id,'Uploaded in error, wrong file chosen']);
 const g3=await call('PARTNER','forensic_get',[k1.case_id]);assert.ok(g3.findings[1].withdrawn_at);assert.ok(g3.evidence[3].withdrawn_at);
 await assert.rejects(call('MANAGER','forensic_finding_add',[k1.case_id,'Third finding','Cites withdrawn evidence which must be refused by the database.',[e1.id,g3.evidence[3].evidence_id]]),/live evidence/);
 await assert.rejects(tx`update erp_private.forensic_findings set title='Edited title of the finding' where finding_id=${f1.finding_id}`,/Only a withdrawal/);
 await assert.rejects(tx`update erp_private.forensic_evidence set sha256=${sha(5)} where evidence_id=${e1.id}`,/Only a withdrawal/);

 // ---- 7. Litigation hold ---------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(call('MANAGER','forensic_hold_set',[k1.case_id,'Hold everything for the court matter']),/Only the lead Partner/);
 await assert.rejects(call('PARTNER','forensic_hold_release',[k1.case_id,'There is no hold to release']),/No litigation hold is in force/);
 await call('PARTNER','forensic_hold_set',[k1.case_id,'Court order served on the fictional client, hold all records']);
 await assert.rejects(call('PARTNER','forensic_hold_set',[k1.case_id,'A second hold on top of the first one']),/already in force/);
 assert.equal((await call('PARTNER','forensic_list'))[0].hold_active,true);
 await call('PARTNER','forensic_hold_release',[k1.case_id,'Court matter withdrawn by the claimant']);
 const gh=await call('PARTNER','forensic_get',[k1.case_id]);assert.deepEqual(gh.holds.map(h=>h.action),['Set','Released']);assert.equal((await call('PARTNER','forensic_list'))[0].hold_active,false);

 // ---- 8. Report and issue ---------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(call('ASSISTANT','forensic_report_save',[k1.case_id,'A viewer cannot write the report at all.']),/read-only access/);
 await assert.rejects(call('MANAGER','forensic_report_save',[k1.case_id,'Too short']),/at least 20 characters/);
 await assert.rejects(call('MANAGER','forensic_report_save',[k1.case_id,'The report relies on '+'ISRS '+'4000 for its method of work.']),/not used until the Compliance Lead/);
 await assert.rejects(call('PARTNER','forensic_report_issue',[k1.case_id,true]),/Save the report first/);
 const r1=await call('MANAGER','forensic_report_save',[k1.case_id,'Draft one of the fictional forensic report.']);assert.equal(r1.version,1);
 const r2=await call('MANAGER','forensic_report_save',[k1.case_id,'Draft two of the fictional forensic report, now with the findings.']);assert.equal(r2.version,2);
 await assert.rejects(call('MANAGER','forensic_report_issue',[k1.case_id,true]),/Only the lead Partner/);
 await assert.rejects(call('PARTNER','forensic_report_issue',[k1.case_id,false]),/Confirm that you have read/);
 await assert.rejects(call('PARTNER','forensic_report_issue',[k1.case_id,true]),/has not been verified by the Compliance Lead/,'the placeholder blocks issue by default');
 await q('PARTNER',`update erp_private.forensic_settings set text_value=$1 where setting_key='standard_reference'`,['Reference verified by the Compliance Lead (fictional test value)']);
 await assert.rejects(call('PARTNER','forensic_report_issue',[k1.case_id,true]),/has not been verified/,'a changed value is still not confirmed');
 await assert.rejects(q('PARTNER',`update erp_private.forensic_settings set rule_status='Confirmed',confirmed_by=$1,source_note='short' where setting_key='standard_reference'`,[PT]),/Say who confirmed this/);
 await assert.rejects(q('PARTNER',`update erp_private.forensic_settings set rule_status='Confirmed',confirmed_by=$1,source_note='Compliance Lead email of 10 Nov 2026' where setting_key='standard_reference'`,[PT2]),/signed-in Partner/);
 await q('PARTNER',`update erp_private.forensic_settings set rule_status='Confirmed',confirmed_by=$1,source_note='Compliance Lead email of 10 Nov 2026' where setting_key='standard_reference'`,[PT]);
 // a case with no findings and no evidence cannot be issued either
 const k2=await open('PARTNER',{title:'Fictional second forensic file'});
 await call('PARTNER','forensic_report_save',[k2.case_id,'A report written before any evidence exists.']);
 await assert.rejects(call('PARTNER','forensic_report_issue',[k2.case_id,true]),/at least one item of evidence/);
 const issued=await call('PARTNER','forensic_report_issue',[k1.case_id,true]);
 assert.equal(issued.version,2);assert.equal(issued.standard_verified,true);assert.match(issued.sha256,/^[0-9a-f]{64}$/);
 const gi=await call('MANAGER','forensic_get',[k1.case_id]);assert.equal(gi.case.status,'Issued');assert.ok(gi.case.locked_at);assert.equal(gi.case.issued_standard_reference,'Reference verified by the Compliance Lead (fictional test value)');
 assert.equal(gi.reports.find(r=>r.issued).version,2);
 // locked: no new evidence, finding, report; custody, holds and access changes still allowed
 await assert.rejects(ev('MANAGER',k1.case_id),/locked/);
 await assert.rejects(call('MANAGER','forensic_finding_add',[k1.case_id,'Late finding','A finding added after the report was issued, which is refused.',[e1.id]]),/locked/);
 await assert.rejects(call('MANAGER','forensic_report_save',[k1.case_id,'A late edit to the report after it was issued.']),/locked/);
 await assert.rejects(call('PARTNER','forensic_evidence_withdraw',[e2.id,'Trying to withdraw after the lock']),/locked/);
 await assert.rejects(call('PARTNER','forensic_report_issue',[k1.case_id,true]),/locked/);
 await call('MANAGER','forensic_custody_add',[e2.id,'Returned','Fictional court registry','Fictional client',null,null]);
 await call('PARTNER','forensic_hold_set',[k1.case_id,'New hold after the report was issued to court']);
 await call('PARTNER','forensic_access_add',[k1.case_id,SUP,'Viewer']);
 await assert.rejects(tx`update erp_private.forensic_cases set title='Renamed after the lock by a superuser' where case_id=${k1.case_id}`,/cannot be changed/);
 await assert.rejects(tx`update erp_private.forensic_cases set issued_report_sha256=${sha(1)} where case_id=${k1.case_id}`,/locked/);

 // ---- 9. Setting the standard back: changing the value withdraws the confirmation; NO lets the placeholder through ------------------------------
 await q('PARTNER',`update erp_private.forensic_settings set text_value='[FORENSIC STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]' where setting_key='standard_reference'`);
 assert.equal((await tx`select rule_status from erp_private.forensic_settings where setting_key='standard_reference'`)[0].rule_status,'Suggested');
 await q('PARTNER',`update erp_private.forensic_settings set text_value='NO' where setting_key='report_needs_verified_standard'`);
 const k3=await open('PARTNER',{title:'Fictional third forensic file'});const e3=await ev('PARTNER',k3.case_id);
 await call('PARTNER','forensic_finding_add',[k3.case_id,'Only finding','The only fictional finding in the third file, tied to evidence.',[e3.id]]);
 await call('PARTNER','forensic_report_save',[k3.case_id,'A report issued while the standard stays a placeholder.']);
 const i3=await call('PARTNER','forensic_report_issue',[k3.case_id,true]);assert.equal(i3.standard_verified,false);assert.match(i3.standard_reference,/PENDING COMPLIANCE REVIEW/);

 // ---- 10. Removing people and transferring the lead --------------------------------------------------------------------------------------------
 await assert.rejects(call('MANAGER','forensic_access_remove',[k1.case_id,AST,'Removed by an Investigator, not allowed']),/Only the lead Partner/);
 await assert.rejects(call('PARTNER','forensic_access_remove',[k1.case_id,AST,'short']),/at least 10 characters/);
 await assert.rejects(call('PARTNER','forensic_access_remove',[k1.case_id,PT,'Removing the lead is not possible']),/transfer the lead first/);
 await call('PARTNER','forensic_access_level',[k1.case_id,AST,'Investigator']);
 assert.equal((await call('ASSISTANT','forensic_list'))[0].my_level,'Investigator');
 await call('PARTNER','forensic_access_remove',[k1.case_id,AST,'Assistant finished with the matter']);
 assert.deepEqual(await call('ASSISTANT','forensic_list'),[],'a removed person no longer sees the file');
 await assert.rejects(call('ASSISTANT','forensic_get',[k1.case_id]),/not available to you/);
 await assert.rejects(call('PARTNER','forensic_lead_transfer',[k1.case_id,M,'A Manager cannot become the lead']),/another active Partner/);
 await assert.rejects(call('PARTNER','forensic_lead_transfer',[k1.case_id,PT,'The lead cannot transfer to themselves']),/another active Partner/);
 await assert.rejects(call('MANAGER','forensic_lead_transfer',[k1.case_id,PT2,'An Investigator cannot hand over the lead']),/Only the lead Partner/);
 assert.deepEqual(await call('PARTNER2','forensic_list'),[]);
 await call('PARTNER','forensic_lead_transfer',[k1.case_id,PT2,'Original lead is leaving the firm']);
 assert.equal((await call('PARTNER2','forensic_list')).find(c=>c.case_id===k1.case_id).my_level,'Lead');
 assert.equal((await call('PARTNER','forensic_list')).find(c=>c.case_id===k1.case_id).my_level,'Investigator');
 await assert.rejects(call('PARTNER','forensic_access_add',[k1.case_id,SUP,'Viewer']),/Only the lead Partner/,'the former lead no longer manages the list');
 assert.equal((await tx`select count(*)::int n from erp_private.forensic_access where case_id=${k1.case_id} and level='Lead' and removed_at is null`)[0].n,1);

 // ---- 11. The event log -----------------------------------------------------------------------------------------------------------------------------
 const gz=await call('PARTNER2','forensic_get',[k1.case_id]);const types=new Set(gz.events.map(e=>e.event_type));
 for(const t of ['File opened','Person added','Person removed','Evidence added','Evidence downloaded','Finding added','Report saved','Report issued','Litigation hold set','Lead transferred','Evidence withdrawn','Finding withdrawn','Access level changed'])assert.ok(types.has(t),t);
 await assert.rejects(tx`update erp_private.forensic_events set detail='x' where case_id=${k1.case_id}`,/append-only/);
 await assert.rejects(q('PARTNER2',`insert into erp_private.forensic_events(case_id,event_type,actor_id) values($1,'Fake',$2)`,[k1.case_id,PT2]),/permission denied/);

 // ---- 12. Row security, grants, search path ----------------------------------------------------------------------------------------------------------
 const rls=await tx`select relname,relrowsecurity,relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='erp_private' and relname like 'forensic\_%' and relkind='r'`;
 assert.equal(rls.length,10);assert.ok(rls.every(r=>r.relrowsecurity&&r.relforcerowsecurity),'row security enabled and forced on every forensic table');
 const fns=await tx`select p.proname,p.proconfig,has_function_privilege('erp_api',p.oid,'execute') ok,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authd from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname like 'forensic\_%'`;
 assert.ok(fns.length>=30);assert.ok(fns.every(f=>!f.anon&&!f.authd),'no public execute');
 assert.ok(fns.filter(f=>f.proconfig).length===fns.length&&fns.every(f=>String(f.proconfig).includes('search_path')),'every function pins its search path');
 for(const hidden of ['forensic_log','forensic_need','forensic_setting_text','forensic_append_only'])assert.equal(fns.find(f=>f.proname===hidden).ok,false,hidden+' is not callable by the application role');
 assert.equal(fns.find(f=>f.proname==='forensic_get').ok,true);
 // ordinary views never mention the file
 assert.equal((await q('PARTNER2',`select count(*)::int n from erp_private.documents where file_name like '%statement%'`))[0].n,0);
 assert.equal((await tx`select engine_state from erp_private.service_profiles where service_code='ADV-FOR'`)[0].engine_state,'Built');
});
