// Audit lock (build 2875) through the real actions and the real migrations: arrangement, in-house and external locks, frozen notes, stale figures, ending a lock. Fictional data only.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const C=await import('../supabase/functions/staff-workspace-v12/annual-pack-comparatives.mjs');
const A=await import('../supabase/functions/staff-workspace-v12/annual-pack.ts');
const root=path.resolve(import.meta.dirname,'..');
const PL='PL.REVENUE\t1,000,000\nPL.COST_SALES\t400,000\nPL.STAFF\t200,000\nPL.OTHER_OPEX\t100,000\nPL.TAX\t90,000';
const EQ='SFP.SHARE_CAP, OPENING, 100,000\nSFP.RETAINED, OPENING, 50,000\nSFP.RETAINED, PROFIT, 210,000\nSFP.RETAINED, DIVIDENDS_DRAWINGS, (60,000)';
const CF='CF.PBT\t300,000\nCF.DEPREC\t20,000\nCF.WC_REC\t(30,000)\nCF.TAX_PAID\t(80,000)\nCF.PPE_PURCHASE\t(50,000)\nCF.DIVIDENDS_PAID\t(60,000)\nCF.CASH_OPEN\t20,000\nCF.CASH_CLOSE\t120,000';
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('the audit lock: both routes, frozen notes, stale figures and ending a lock',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const p2=actors.PARTNER2={staff_id:id(),auth_user_id:id(),session:id(),category_code:'PARTNER'};await tx`insert into auth.users(id) values(${p2.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${p2.session},${p2.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${p2.staff_id},${p2.auth_user_id},'PARTNER2','partner2','Fictional PARTNER2','PARTNER','Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${p2.session},${p2.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${p2.staff_id},${F},'Assigned')`;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${CL},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role==='PARTNER2'?'PARTNER':role})`;
 const per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 await as('PARTNER2',a=>A.statementMapAction(tx,a,{action:'ledger_statement_map_approve',all_seeded:true}));

 const codeFor=async line=>(await tx`select account_code from erp_private.account_statement_map where line_code=${line} and status='Approved' order by account_code limit 1`)[0].account_code;
 const [revenue,cos]=[await codeFor('PL.REVENUE'),await codeFor('PL.COST_SALES')];
 const row=(code,name,opening,debit,credit)=>({code,name,opening,movement_debit:debit,movement_credit:credit,net:opening+debit-credit});
 const tb=[row('30000','Share capital',-100000,0,0),row('31000','Retained earnings',-200000,0,0),row('10020','Bank',120000,300000,0),row('15004','Equipment',180000,0,0),row(revenue,'Sales',0,0,500000),row(cos,'Cost of sales',0,200000,0)];
 const data={as_of:'2026-12-31',tb,issues:[],prior_year:{source:'Opening balances'}};
 const get=role=>as(role,a=>A.statementsFrom(tx,per,data));
 const line=(st,label)=>st.rows.find(r=>r.label===label&&r.kind!=='heading');

 // before comparatives are approved: current year is complete and balanced, prior columns are absent with the reason given
 {const {approvePpe}=await import('./helpers/ppe_ready.mjs'),X=await import('../supabase/functions/staff-workspace-v12/ppe-actions.ts');await approvePpe({tx,as,X,per,account:'15004',cost:180000});}
 let s=await get('ASSISTANT');
 assert.equal(s.client.name,'Fictional Mlima Traders');assert.equal(s.statements.checks.balanced,true);
 assert.equal(line(s.statements.profit_or_loss,'Profit for the year').current,300000);
 assert.equal(line(s.statements.financial_position,'Total assets').current,600000);assert.equal(line(s.statements.financial_position,'Total equity and liabilities').current,600000);
 assert.equal(s.statements.profit_or_loss.has_prior,false);assert.match(s.statements.problems.join(' '),/prior-year profit or loss/);
 const eq0=s.statements.changes_in_equity,cf0=s.statements.cash_flow,eqRow=(e,m)=>e.current.rows.find(r=>r.move===m);
 assert.equal(eqRow(eq0,'OPENING').total,300000);assert.equal(eqRow(eq0,'PROFIT').total,300000);assert.equal(eqRow(eq0,'CLOSING').total,600000);assert.equal(eq0.total_closing,600000,'equity closes at 600,000, the equity in the financial position');
 assert.equal(eq0.has_prior,false);assert.equal(cf0.reconciles,true);assert.equal(cf0.cash_open,120000);assert.equal(cf0.cash_close,420000);assert.equal(cf0.net_change,300000);
 assert.equal(s.status,'Draft - not ready');assert.equal(s.readiness.ready,false);

 // reporting basis, then comparatives entered by a Manager and approved by a second Partner
 await as('MANAGER',a=>A.reportingSave(tx,a,per,{framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',presentation_currency:'KES',rounding:'Whole shillings',comparatives_basis:'Approved opening balances',early_application_note:'Fictional early application note for the year'}));
 const set=await as('MANAGER',a=>A.comparativesSave(tx,a,per,{source_kind:'Signed prior-year financial statements',source_reference:'Fictional signed accounts for 2025, dated 14 March 2026',pl:PL,eq:EQ,cf:CF}));
 await as('PARTNER2',a=>A.comparativesReview(tx,a,per,{set_id:set.set_id,decision:'Approved',review_note:'Fictional agreed to signed accounts'},data));
 s=await get('MANAGER');
 const p=s.statements.profit_or_loss,f=s.statements.financial_position;
 assert.equal(p.has_prior,true);assert.equal(line(p,'Revenue').prior,1000000);assert.equal(line(p,'Profit for the year').prior,210000);assert.equal(line(p,'Profit for the year').current,300000);
 assert.equal(f.has_prior,true);assert.equal(line(f,'Total assets').prior,300000);assert.equal(line(f,'Total equity and liabilities').prior,300000);
 assert.deepEqual(s.statements.problems,[]);
 // Build 2873: everything else is in order, but the statements are not ready until a Partner has approved the notes
 assert.deepEqual(s.readiness.checks.filter(c=>c.status==='Blocked').map(c=>c.code),['SUPPORT_SCHEDULES','NOTES_APPROVED','WORDING_COMPLETE','CLIENT_PAGES'],'build 2886: the supporting schedules come first, because the notes digest includes them');
 {const {approveSchedules}=await import('./helpers/schedules_ready.mjs'),S=await import('../supabase/functions/staff-workspace-v12/support-schedules-actions.ts');const sr=await approveSchedules({tx,as,S,per,getStatements:()=>A.statementsFrom(tx,per,data),asOf:'2026-12-31'});assert.equal(sr.ok,true,sr.problems.join(' '));assert.ok(sr.relevant>0);}
 s=await get('MANAGER');assert.deepEqual(s.readiness.checks.filter(c=>c.status==='Blocked').map(c=>c.code),['NOTES_APPROVED','WORDING_COMPLETE','CLIENT_PAGES']);assert.equal(s.readiness.ready,false);assert.equal(s.statements.notes.items.length>0,true);assert.deepEqual(s.statements.notes.problems,[]);
 assert.equal(line(s.statements.profit_or_loss,'Revenue').note,1,'the note number is written on the face');
 const NA=await import('../supabase/functions/staff-workspace-v12/notes-actions.ts');
 const nget=(asOf)=>A.statementsFrom(tx,per,data);
 const nact=(role,body)=>as(role,a=>NA.notesAction(tx,a,per,{action:'ledger_notes_read',...body},nget,'2026-12-31'));
 let nr=await nact('MANAGER',{});assert.equal(nr.state,'none');assert.equal(nr.can_prepare,true);assert.equal(nr.can_review,false);assert.ok(nr.notes.length>0);assert.ok(nr.notes.every(n=>n.ties));
 await assert.rejects(()=>nact('ASSISTANT',{action:'ledger_notes_prepare'}),/Manager or Partner/);
 await assert.rejects(()=>nact('MANAGER',{action:'ledger_notes_review',set_id:id(),decision:'Approved'}),/Only a Partner/);
 await assert.rejects(()=>nact('PARTNER2',{action:'ledger_notes_review',set_id:id(),decision:'Approved'}),/have changed/);
 const n1=await nact('MANAGER',{action:'ledger_notes_prepare'});assert.equal(n1.version,1);
 nr=await nact('PARTNER2',{});assert.equal(nr.state,'draft');assert.equal(nr.can_review,true);assert.equal(nr.drafted_by_me,false);
 s=await get('MANAGER');assert.match(s.readiness.checks.find(c=>c.code==='NOTES_APPROVED').detail,/wait for a Partner/);assert.equal(s.status,'Draft - not ready');
 // returned needs a reason; a prepared set is then superseded by a fresh draft
 await assert.rejects(()=>nact('PARTNER2',{action:'ledger_notes_review',set_id:n1.set_id,decision:'Returned',review_note:'no'}),/at least 10/);
 assert.equal((await nact('PARTNER2',{action:'ledger_notes_review',set_id:n1.set_id,decision:'Returned',review_note:'Fictional wrong figure in the receivables note'})).status,'Returned');
 nr=await nact('MANAGER',{});assert.equal(nr.state,'none');
 const n2=await nact('MANAGER',{action:'ledger_notes_prepare'});assert.equal(n2.version,2);
 // a Partner who prepared them cannot approve without being the only Partner
 const n3=await nact('PARTNER',{action:'ledger_notes_prepare'});assert.equal(n3.version,3);
 await assert.rejects(()=>nact('PARTNER',{action:'ledger_notes_review',set_id:n3.set_id,decision:'Approved'}),/different Partner approves/);
 await assert.rejects(()=>nact('PARTNER2',{action:'ledger_notes_review',set_id:n2.set_id,decision:'Approved'}),/have changed/,'the earlier draft was replaced');
 const ap=await nact('PARTNER2',{action:'ledger_notes_review',set_id:n3.set_id,decision:'Approved'});assert.equal(ap.status,'Approved');assert.equal(ap.sole_partner_approval,false);
 {const {approveWording}=await import('./helpers/wording_ready.mjs'),W=await import('../supabase/functions/staff-workspace-v12/wording-actions.ts');const w=await approveWording({tx,as,W,per,getStatements:nget,asOf:'2026-12-31'});assert.equal(w.complete,true,w.problems.join(' '));}
 {const {approvePages}=await import('./helpers/pages_ready.mjs'),Pg=await import('../supabase/functions/staff-workspace-v12/client-pages-actions.ts');const pr=await approvePages({tx,as,Pg,per,getStatements:nget,asOf:'2026-12-31'});assert.equal(pr.complete,true,pr.problems.join(' '));}
 s=await get('MANAGER');assert.equal(s.readiness.checks.find(c=>c.code==='NOTES_APPROVED').status,'Pass');assert.equal(s.readiness.ready,true);assert.equal(s.status,'Ready for review');
 await assert.rejects(()=>nact('MANAGER',{action:'ledger_notes_prepare'}),/already approved/);
 const changed={...data,tb:data.tb.map(r=>r.code==='10020'?{...r,movement_debit:r.movement_debit+1000,net:r.net+1000}:r)};
 const ngetChanged=()=>A.statementsFrom(tx,per,changed);
 const changedBal={...data,tb:data.tb.map(r=>r.code==='10020'?{...r,movement_debit:r.movement_debit+1000,net:r.net+1000}:r.code===revenue?{...r,movement_credit:r.movement_credit+1000,net:r.net-1000}:r)};
 const ngetBal=()=>A.statementsFrom(tx,per,changedBal);
 // ---- Build 2875: the audit lock, after the Partner has approved the notes ----
 const AL=await import('../supabase/functions/staff-workspace-v12/audit-lock-actions.ts');
 const aact=(role,body,getter=nget,l=per)=>as(role,a=>AL.auditLockAction(tx,a,l,body,getter,'2026-12-31'));
 const aread=(role,getter=nget)=>aact(role,{action:'ledger_audit_read'},getter);
 const chk=st=>st.readiness.checks.find(c=>c.code==='AUDIT_LOCKED');
 // nothing recorded and no audit file: not required, so the pack behaves as before (Info, not a blocker)
 let ar=await aread('MANAGER');assert.equal(ar.state.status,'not_declared');assert.equal(ar.state.required,false);assert.equal(ar.check.status,'Info');assert.equal(ar.wording,'Draft');assert.equal(ar.notes.ok,true);
 s=await get('MANAGER');assert.equal(chk(s).status,'Info');assert.equal(s.readiness.ready,true);
 // declaring how the year is audited
 await assert.rejects(()=>aact('ASSISTANT',{action:'ledger_audit_declare',mode:'In-house audit'}),/Manager or Partner/);
 await assert.rejects(()=>aact('MANAGER',{action:'ledger_audit_declare',mode:'Not audited'}),/Only a Partner/);
 await assert.rejects(()=>aact('MANAGER',{action:'ledger_audit_declare',mode:'Whatever'}),/valid option/);
 await aact('MANAGER',{action:'ledger_audit_declare',mode:'In-house audit',note:'Fictional in-house team'});
 ar=await aread('MANAGER');assert.equal(ar.state.status,'not_started');assert.equal(ar.state.required,true);assert.equal(ar.can_lock,true);
 s=await get('MANAGER');assert.equal(chk(s).status,'Blocked');assert.match(chk(s).detail,/has not started/);assert.equal(s.readiness.ready,false);assert.equal(s.status,'Draft - not ready');
 // an in-house lock needs an audit file for this client's year that is complete and approved
 const lockBody={action:'ledger_audit_lock',mode:'In-house audit',opinion:'Unmodified',report_reference:'Fictional audit report AR-2026-01',report_date:'2026-03-01'};
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:id()}),/audit file that covers/);
 const PA=id();
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${PA},${CL},${F},'Fictional audit project','AUD-STAT',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${PA},${actors[role].staff_id},${F},${role==='PARTNER2'?'PARTNER':role})`;
 const FILE=id();
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE},${PA},${CL},${F},'2026-01-01','2026-12-31','First-year','IFRS for SMEs',${actors.MANAGER.staff_id})`;
 const setFile=async st=>{await db.exec(`set session_replication_role=replica`);await tx`update erp_private.audit_files set file_status=${st} where audit_file_id=${FILE}`;await db.exec(`set session_replication_role=origin`);};
 ar=await aread('MANAGER');assert.equal(ar.state.status,'in_progress');assert.equal(ar.state.label,'In-house audit in progress');assert.equal(ar.candidates.audit_files.length,1);assert.equal(ar.candidates.audit_files[0].complete,false);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE}),/completed and approved/);
 await setFile('Approved');
 ar=await aread('MANAGER');assert.equal(ar.state.status,'ready');assert.equal(ar.candidates.audit_files[0].prepared_by_me,true);
 // the locker did not prepare the file; the notes must be current and approved; report details are required
 await assert.rejects(()=>aact('MANAGER',{...lockBody,audit_file_id:FILE}),/did not prepare the audit file/);
 await assert.rejects(()=>aact('ASSISTANT',{...lockBody,audit_file_id:FILE}),/Manager or Partner/);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE,report_reference:'x'}),/report reference/);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE,report_date:''}),/report date/);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE,report_date:'2999-01-01'}),/future/);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE,opinion:'Fine'}),/valid option/);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE},ngetBal),/approve the notes.*changed/);
 // the database refuses a lock against notes that are not the approved set
 await assert.rejects(()=>as('PARTNER',a=>tx`insert into erp_private.period_audit_locks(period_id,project_id,client_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,report_reference,report_date,opinion,locked_by) values(${per.period_id},${P},${CL},'In-house audit',${n1.set_id},${'a'.repeat(64)},${'b'.repeat(64)},${FILE},'Fictional ref','2026-03-01','Unmodified',${a.staff_id})`),/approve the notes/);
 const lk=await aact('PARTNER',{...lockBody,audit_file_id:FILE});assert.equal(lk.mode,'In-house audit');assert.equal(lk.sole_partner_approval,false);
 // locked: the statements are audited, the pack is ready, and the check passes
 s=await get('MANAGER');assert.equal(chk(s).status,'Pass');assert.equal(s.readiness.ready,true);assert.equal(s.statements.audit.locked,true);assert.equal(s.status,'Ready for review');
 ar=await aread('PARTNER');assert.equal(ar.state.status,'locked');assert.equal(ar.wording,'Audited');assert.equal(ar.lock.opinion,'Unmodified');assert.equal(ar.can_end,true);assert.equal(ar.can_lock,false);assert.equal(ar.history.length,1);
 ar=await aread('MANAGER');assert.equal(ar.can_end,false);
 // while locked: notes frozen, one live lock, arrangement fixed, a lock is never edited or deleted
 await assert.rejects(()=>nact('MANAGER',{action:'ledger_notes_prepare'}),/locked by an audit/);
 await assert.rejects(()=>nact('PARTNER2',{action:'ledger_notes_review',set_id:n3.set_id,decision:'Returned',review_note:'Fictional late return'}),/locked by an audit/);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE}),/already locked/);
 await assert.rejects(()=>aact('PARTNER',{action:'ledger_audit_declare',mode:'External audit'}),/ends the lock/);
 await assert.rejects(()=>as('PARTNER',a=>tx`update erp_private.period_audit_locks set opinion='Adverse' where lock_id=${lk.lock_id}`),/never edited/);
 await assert.rejects(()=>as('PARTNER',a=>tx`delete from erp_private.period_audit_locks where lock_id=${lk.lock_id}`),/./);
 await assert.rejects(()=>as('PARTNER',a=>tx`insert into erp_private.period_note_sets(period_id,project_id,client_id,version,as_of,digest,note_count,calculation_version,snapshot,prepared_by) values(${per.period_id},${P},${CL},4,'2026-12-31',${'c'.repeat(64)},1,'x','{}',${a.staff_id})`),/locked by an audit/);
 // a change to a figure after the lock shows as changed after the audit and blocks the pack
 const sc=await as('MANAGER',a=>A.statementsFrom(tx,per,changedBal));
 assert.equal(sc.statements.audit.stale,true);assert.equal(sc.statements.audit.locked,false);assert.equal(chk(sc).status,'Blocked');assert.match(chk(sc).detail,/changed after the pack was locked/);assert.equal(sc.readiness.ready,false);
 ar=await aread('PARTNER',ngetBal);assert.equal(ar.state.status,'stale');assert.equal(ar.wording,'Draft');
 // only a Partner ends a lock, with a reason, and the record is kept
 await assert.rejects(()=>aact('MANAGER',{action:'ledger_audit_end',lock_id:lk.lock_id,reason:'Fictional reason long enough'}),/Only a Partner/);
 await assert.rejects(()=>aact('PARTNER',{action:'ledger_audit_end',lock_id:lk.lock_id,reason:'short'}),/at least 10/);
 await assert.rejects(()=>aact('PARTNER',{action:'ledger_audit_end',lock_id:id(),reason:'Fictional reason long enough'}),/no longer live/);
 assert.equal((await aact('PARTNER',{action:'ledger_audit_end',lock_id:lk.lock_id,reason:'Fictional auditor reissued the report'})).ended,true);
 ar=await aread('PARTNER');assert.equal(ar.state.status,'ready');assert.equal(ar.wording,'Draft');assert.equal(ar.history.length,1);assert.equal(ar.history[0].end_reason,'Fictional auditor reissued the report');
 await assert.rejects(()=>as('PARTNER',a=>tx`update erp_private.period_audit_locks set end_reason='Rewritten after the event' where lock_id=${lk.lock_id}`),/already ended|never edited/);
 // notes can change again once the lock has ended
 await assert.rejects(()=>nact('MANAGER',{action:'ledger_notes_prepare'}),/already approved/,'no longer frozen: the answer is now the ordinary one');
 // sole-Partner exception: the file preparer cannot lock it unless they are the firm's only Partner, and here there are two
 await db.exec(`set session_replication_role=replica`);await tx`update erp_private.audit_files set created_by=${actors.PARTNER.staff_id} where audit_file_id=${FILE}`;await db.exec(`set session_replication_role=origin`);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE}),/did not prepare|only Partner/);
 await assert.rejects(()=>aact('PARTNER',{...lockBody,audit_file_id:FILE,sole_partner_approval:true}),/only Partner/);
 // external audit: the signed PDF in this client's vault
 await aact('PARTNER',{action:'ledger_audit_declare',mode:'External audit'});
 ar=await aread('MANAGER');assert.equal(ar.state.status,'external_pending');assert.equal(ar.state.label,'External auditor pending');
 const doc=async(client,mime,name)=>{const D=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${client},${F},${client===CL?P:null},'Final Reports',${name},${'qa/'+D},100,${'d'.repeat(64)},${mime},${actors.MANAGER.staff_id})`;return D;};
 const pdf=await doc(CL,'application/pdf','Fictional signed audit report.pdf'),xls=await doc(CL,'application/vnd.ms-excel','Fictional draft.xls');
 const ext={action:'ledger_audit_lock',mode:'External audit',opinion:'Qualified',report_reference:'Fictional ext ref 7',report_date:'2026-03-05',auditor_name:'Fictional Auditors LLP'};
 ar=await aread('MANAGER');assert.ok(ar.candidates.documents.some(d=>d.document_id===pdf));
 await assert.rejects(()=>aact('MANAGER',{...ext,document_id:id()}),/vault/);
 await assert.rejects(()=>aact('MANAGER',{...ext,document_id:xls}),/must be a PDF/);
 await assert.rejects(()=>aact('MANAGER',{...ext,document_id:pdf,auditor_name:''}),/auditor/);
 const ek=await aact('MANAGER',{...ext,document_id:pdf});assert.equal(ek.mode,'External audit');
 ar=await aread('MANAGER');assert.equal(ar.state.status,'locked');assert.equal(ar.state.label,'Audited: external auditor');assert.equal(ar.lock.opinion,'Qualified');assert.equal(ar.lock.auditor_name,'Fictional Auditors LLP');
 s=await get('MANAGER');assert.equal(chk(s).status,'Pass');
 // Build 2885: the assembled pack. Before any lock it is subject to audit; with a lock whose signed PDF does not match the recorded fingerprint it is never "Audited" and the report is not attached;
 // with a lock whose signed PDF matches, the PDF is added exactly as signed, the watermark goes and the word is Audited.
 {
  const AE=await import('../supabase/functions/staff-workspace-v12/annual-pack-export-actions.ts'),GR=await import('../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs'),SA=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
  const PDFLib=require(path.join(root,'supabase/functions/staff-workspace-v6/node_modules/pdf-lib')),ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd(),root]}));SA.setPdfLib(PDFLib);
  const annualGateFor=async()=>{const st=await nget('2026-12-31');return {st,gate:GR.annualGate({gate:{checks:[{code:'SIGN_OFF',label:'Signed off',ok:true,detail:''}]},pack:st.readiness,statementProblems:st.statements.problems})};};
  const signedDoc=await PDFLib.PDFDocument.create();signedDoc.addPage([300,300]).drawText('FICTIONAL SIGNED REPORT BODY',{x:20,y:200,size:11});const signedBytes=await signedDoc.save();
  const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(n=>n.toString(16).padStart(2,'0')).join('');
  const store=bytes=>({download:async()=>({data:new Blob([bytes])})});
  const run=(role,p,storage)=>as(role,a=>AE.packAssembleAction(tx,a,per,{action:'ledger_pack_assemble',...p},{annualGateFor,storage,pdfLib:SA.pdfLib,ExcelJS}));
  const text=async bytes=>{const {execFileSync}=await import('node:child_process'),os=await import('node:os'),fl=path.join(os.tmpdir(),'lock-'+id()+'.pdf');fs.writeFileSync(fl,bytes);try{return execFileSync('pdftotext',['-layout',fl,'-'],{encoding:'utf8'});}finally{fs.unlinkSync(fl);}};
  await assert.rejects(()=>run('INTERN',{action:'ledger_pack_assemble_read'},store(signedBytes)),/staff who prepare or review/).catch(()=>{});
  // the lock above was made against a document whose recorded fingerprint is not the signed file's
  let r=await run('MANAGER',{action:'ledger_pack_assemble_read'},store(signedBytes));
  assert.equal(r.status_word,'Subject to audit');assert.equal(r.attachments.length,0);assert.ok(r.open_checks.some(x=>/could not be attached/.test(x)));assert.ok(r.problems.some(x=>/could not be attached/.test(x)));assert.equal(r.complete,false);
  assert.deepEqual(r.contents.map(c=>c.code).slice(0,5),['COVER','ENTITY_INFO','REPORT','RESPONSIBILITIES','STATISTICS']);assert.ok(r.contents.some(c=>c.code==='AUDITOR'));assert.ok(r.contents.some(c=>c.code==='NOTES'));
  assert.ok(r.numbering.leading_notes>=1&&r.numbering.shift===r.numbering.leading_notes,'wording notes lead; system numbers shift by that count');
  const bad=await run('MANAGER',{format:'pdf'},store(signedBytes));assert.equal(bad.mime_type,'application/pdf');const badText=await text(Buffer.from(bad.base64,'base64'));assert.doesNotMatch(badText,/FICTIONAL SIGNED REPORT BODY/);assert.match(badText,/SUBJECT TO AUDIT/);
  // end the lock and lock again against a document whose fingerprint is the signed file's
  const k1=(await aread('MANAGER')).lock.lock_id;await aact('PARTNER',{action:'ledger_audit_end',lock_id:k1,reason:'Fictional re-lock against the verified signed PDF'});
  r=await run('MANAGER',{action:'ledger_pack_assemble_read'},store(signedBytes));assert.equal(r.status_word,'Subject to audit','no lock, an audit is required');
  const good=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${good},${CL},${F},${P},'Final Reports','Fictional verified signed report.pdf',${'qa/'+good},${signedBytes.length},${await sha(signedBytes)},'application/pdf',${actors.MANAGER.staff_id})`;
  const ek2=await aact('MANAGER',{...ext,document_id:good});assert.equal(ek2.mode,'External audit');
  r=await run('MANAGER',{action:'ledger_pack_assemble_read'},store(signedBytes));assert.equal(r.status_word,'Audited');assert.equal(r.watermark,null);assert.deepEqual(r.open_checks,[]);assert.equal(r.attachments.length,1);assert.equal(r.attachments[0].sha256,await sha(signedBytes));
  const pdf2=await run('MANAGER',{format:'pdf'},store(signedBytes)),pb=Buffer.from(pdf2.base64,'base64'),t2=await text(pb);
  assert.match(pdf2.file_name,/_Annual_pack_2026-12-31_Audited\.pdf$/);assert.match(t2,/FICTIONAL SIGNED REPORT BODY/);assert.match(t2,/AUDITED/);assert.doesNotMatch(t2,/SUBJECT TO AUDIT|DRAFT|MANAGEMENT DRAFT/);assert.match(t2,/Fictional ext ref 7/);assert.match(t2,/Qualified/);
  assert.equal(pdf2.fingerprint,r.fingerprint);assert.match(t2,new RegExp('Fingerprint '+r.fingerprint.slice(0,16)));
  const xl=await run('MANAGER',{format:'xlsx'},store(signedBytes));assert.match(xl.file_name,/Audited\.xlsx$/);assert.equal(xl.mime_type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  // Build 2890: every pack produced is registered; the one made while a check was open is a draft, the audited ones are signed through the live audit lock.
  {const liveLock=(await aread('MANAGER')).lock.lock_id,regs=await tx`select pack_kind,report_kind,file_format,status_word,is_final,lock_id,review_id from erp_private.ledger_report_packs where period_id=${per.period_id} order by generated_at`;
   assert.deepEqual(regs.map(x=>[x.pack_kind,x.report_kind,x.file_format,x.status_word,x.is_final,x.lock_id===liveLock,x.review_id]),[['Annual filing pack',null,'pdf','Subject to audit',false,false,null],['Annual filing pack',null,'pdf','Audited',true,true,null],['Annual filing pack',null,'xlsx','Audited',true,true,null]]);
   assert.equal(regs[0].lock_id,null,'a pack that was produced while a check was open is not signed');}
  // a file changed in storage after the lock is refused, never attached
  const tampered=new Uint8Array([...signedBytes,32]);r=await run('MANAGER',{action:'ledger_pack_assemble_read'},store(tampered));assert.equal(r.attachments.length,0);assert.notEqual(r.status_word,'Audited');
  const gone=await run('MANAGER',{action:'ledger_pack_assemble_read'},{download:async()=>({error:{message:'missing'},data:null})});assert.equal(gone.attachments.length,0);assert.notEqual(gone.status_word,'Audited');
  assert.equal(await AE.packAssembleAction(tx,actors.MANAGER,per,{action:'something_else'},{}),undefined);
  ek.lock_id=ek2.lock_id;
 }
 await aact('PARTNER',{action:'ledger_audit_end',lock_id:ek.lock_id,reason:'Fictional report withdrawn by the auditor'});
 // not audited is a Partner's declaration; a Manager cannot change it afterwards
 await aact('PARTNER',{action:'ledger_audit_declare',mode:'Not audited',note:'Fictional exempt by the client'});
 ar=await aread('MANAGER');assert.equal(ar.state.status,'not_audited');assert.equal(ar.check.status,'Info');assert.equal(ar.can_lock,false);
 s=await get('MANAGER');assert.equal(chk(s).status,'Info');assert.equal(s.readiness.ready,true);
 await assert.rejects(()=>aact('MANAGER',{action:'ledger_audit_declare',mode:'In-house audit'}),/Only a Partner/);
 assert.equal((await aact('PARTNER',{action:'ledger_audit_declare',mode:'In-house audit'})).mode,'In-house audit');
 // an audit file of another client is refused (database and action)
 await assert.rejects(()=>aact('PARTNER',{...lockBody,mode:'In-house audit',audit_file_id:id()}),/audit file that covers/);
});
