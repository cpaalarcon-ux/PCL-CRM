// Audit build S6: SACCO audit pack - programme, compliance register, matters communicated and key audit matters, and the two new report kinds.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('S6: programme, compliance register, matters and KAM decisions, statutory report to regulator',async t=>{
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
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const J=o=>JSON.stringify(o);
 const ws=async role=>JSON.parse(JSON.stringify((await q(role,'select erp_private.pack_workspace($1) w',[FILE]))[0].w));
 const issues=async()=>JSON.parse(JSON.stringify((await q('MANAGER','select erp_private.sasra_signoff_issues($1) r',[FILE]))[0].r));
 const packIssues=async()=>(await issues()).filter(x=>/programme|compliance register|compliance item|Matter TM|key audit/i.test(x));

 // ---- 1. The seeded programme and compliance items are drafts and carry no regulatory figure ------------------------------------------
 let w=await ws('MANAGER');
 const prog=()=>w.programmes.find(p=>p.code==='SACCO-STD'&&p.status==='Draft');
 assert.equal(w.sacco_type,'DT_SACCO');assert.equal(prog().version,1);assert.equal(prog().steps.length,26);
 assert.equal(await q('INTERN','select erp_private.pack_workspace($1) w',[FILE]).then(r=>r[0].w),null,'an intern sees nothing');
 assert.equal(w.compliance_items.length,9);assert.ok(w.compliance_items.every(i=>i.status==='Proposed'));
 assert.equal((await db.query(`select count(*)::int n from erp_private.audit_programme_steps where procedure ~ '[0-9]+ ?%' or audit_area ~ '%'`)).rows[0].n,0,'no percentage in the programme');
 assert.equal((await db.query(`select count(*)::int n from erp_private.audit_compliance_items where requirement ~ '[0-9]+ ?%' or title ~ '[0-9]+ ?%' or requirement ~ 'KES'`)).rows[0].n,0,'no regulatory figure in the compliance items');
 let iss=await packIssues();
 assert.ok(iss.some(x=>/programme is not approved by a Partner/.test(x)));assert.ok(iss.some(x=>/No compliance register items are approved/.test(x)));
 await assert.rejects(()=>q('ASSISTANT','select erp_private.pack_programme_adopt($1,$2)',[FILE,prog().programme_id]),/Only a programme approved by a Partner/);

 // ---- 2. Editing and approving the programme ----------------------------------------------------------------------------------------
 const step={step_code:'X.EXTRA',audit_area:'Loans to members',assertion:'Existence',procedure:'Inspect the credit committee file for a sample of loans over the limit set in the policy.',required:true,sort_order:265};
 await assert.rejects(()=>q('ASSISTANT','select erp_private.pack_programme_step_save($1,$2::jsonb)',[prog().programme_id,J(step)]),/Only a Manager or Partner/);
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_programme_step_save($1,$2::jsonb)',[prog().programme_id,J({...step,procedure:'Too short'})]),/procedure/i);
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_programme_step_save($1,$2::jsonb)',[prog().programme_id,J({...step,reference_code:'NOT-A-REF'})]),/not in the register/);
 await q('MANAGER','select erp_private.pack_programme_step_save($1,$2::jsonb)',[prog().programme_id,J({...step,reference_code:'SACCO-ACT-2008'})]);
 w=await ws('MANAGER');assert.equal(prog().steps.length,27);assert.equal(prog().steps.find(s=>s.step_code==='X.EXTRA').reference_code,'SACCO-ACT-2008');
 await q('MANAGER','select erp_private.pack_programme_step_remove($1,$2)',[prog().programme_id,'X.EXTRA']);
 w=await ws('MANAGER');assert.equal(prog().steps.length,26);
 const PID=prog().programme_id;
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_programme_approve($1,$2)',[PID,'Read every step and agreed']),/Only a Partner/);
 await assert.rejects(()=>q('PARTNER','select erp_private.pack_programme_approve($1,$2)',[PID,'short']),/at least 10/);
 await q('PARTNER','select erp_private.pack_programme_approve($1,$2)',[PID,'Read every step against the ISA and the legal report']);
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_programme_step_save($1,$2::jsonb)',[PID,J(step)]),/Only a draft programme/);
 await assert.rejects(()=>db.query(`update erp_private.audit_programme_steps set procedure='Changed after approval by someone with direct access.' where programme_id=$1`,[PID]),/Only a draft programme can be changed/);
 await assert.rejects(()=>db.query(`update erp_private.audit_programmes set title='Renamed after approval' where programme_id=$1`,[PID]),/approved programme cannot be changed/);

 // ---- 3. A file adopts it; one person performs, another reviews ----------------------------------------------------------------------
 await assert.rejects(()=>q('INTERN','select erp_private.pack_programme_adopt($1,$2)',[FILE,PID]),/Not allowed/);
 const FILE2=id(),C2=id(),P2=id();
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C2},'Fictional Ordinary Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C2},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${C2},${F},'Fictional ordinary audit','AUD-STAT',${M})`;
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE2},${P2},${C2},${F},'2025-01-01','2025-12-31','First-year','IFRS for SMEs',${M})`;
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_programme_adopt($1,$2)',[FILE2,PID]),/not for a SACCO/);
 assert.equal(await q('MANAGER','select erp_private.pack_workspace($1) w',[FILE2]).then(r=>r[0].w),null,'not a SACCO file');
 const r_=(await q('ASSISTANT','select erp_private.pack_programme_adopt($1,$2) r',[FILE,PID]))[0].r;assert.equal(r_.steps,26);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.pack_programme_adopt($1,$2)',[FILE,PID]),/already adopted/);
 iss=await packIssues();assert.ok(iss.some(x=>/26 required programme step\(s\) are not reviewed/.test(x)));
 const prep=(role,code,app=true,n='Agreed to the signed documents on the file',wp=null)=>q(role,'select erp_private.pack_step_prepare($1,$2,$3,$4,$5,$6) r',[FILE,PID,code,app,n,wp]);
 const rev=(role,code,ok,n='Agreed')=>q(role,'select erp_private.pack_step_review($1,$2,$3,$4,$5) r',[FILE,PID,code,ok,n]);
 await assert.rejects(()=>prep('INTERN','L.LEDGER'),/Not allowed/);
 await assert.rejects(()=>prep('ASSISTANT','L.NOPE'),/Choose a step/);
 await assert.rejects(()=>prep('ASSISTANT','L.LEDGER',true,'short'),/at least 10/);
 await assert.rejects(()=>prep('ASSISTANT','L.LEDGER',true,'Agreed ledger to GL',id()),/not on this file/);
 await prep('ASSISTANT','L.LEDGER');
 await assert.rejects(()=>rev('ASSISTANT','L.LEDGER',true),/Only a Manager or Partner/);
 await assert.rejects(()=>rev('MANAGER','L.EXIST',true),/not waiting for review/);
 await rev('MANAGER','L.LEDGER',false,'Name the population used');
 w=await ws('MANAGER');assert.equal(w.file_steps.find(s=>s.step_code==='L.LEDGER').status,'Returned');
 await prep('ASSISTANT','L.LEDGER',true,'Population named and agreed to the GL');
 await prep('MANAGER','L.EXIST',false,'No loans issued in the year, so nothing to select');
 await assert.rejects(()=>rev('MANAGER','L.EXIST',true),/someone else must review/);
 await rev('PARTNER','L.EXIST',true);
 for(const c of w.file_steps.map(s=>s.step_code).filter(c=>c!=='L.EXIST')){if(c!=='L.LEDGER')await prep('ASSISTANT',c);await rev(c.startsWith('P.')?'MANAGER2':'PARTNER',c,true);}
 w=await ws('MANAGER');assert.ok(w.file_steps.every(s=>s.status==='Reviewed'));assert.equal(w.file_steps.find(s=>s.step_code==='L.EXIST').applicable,false);
 iss=await packIssues();assert.ok(!iss.some(x=>/programme/i.test(x)),'programme done: '+iss.join(' | '));
 await prep('ASSISTANT','C.AML');iss=await packIssues();assert.ok(iss.some(x=>/1 required programme step\(s\) are not reviewed/.test(x)),'preparing again sends a step back for review');
 await rev('MANAGER','C.AML',true);
 // A new version supersedes the old one, but the file keeps the wording it adopted.
 const V2=(await q('MANAGER','select erp_private.pack_programme_copy($1) id',['SACCO-STD']))[0].id;
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_programme_copy($1)',['SACCO-STD']),/already a draft/);
 await q('MANAGER','select erp_private.pack_programme_step_save($1,$2::jsonb)',[V2,J({...step,procedure:'Version two wording of the extra loan procedure.'})]);
 await q('PARTNER','select erp_private.pack_programme_approve($1,$2)',[V2,'Version 2 reviewed against version 1']);
 w=await ws('PARTNER');assert.deepEqual(w.programmes.map(p=>p.status),['Approved','Superseded']);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.pack_programme_adopt($1,$2)',[FILE,V2]),/already adopted/);
 assert.equal(w.file_steps.length,26,'the file keeps the version it adopted');

 // ---- 4. Compliance register: Partner approves items, a file assesses them, someone else reviews ---------------------------------------
 const item={item_code:'SACCO-TEST',title:'A test requirement for the register',requirement:'The SACCO keeps a register of members and updates it each quarter.',citation:'Fictional by-law 4',applies_to:['ALL_SACCO'],nature:'Other',sort_order:200};
 await assert.rejects(()=>q('ASSISTANT','select erp_private.pack_compliance_item_save($1::jsonb)',[J(item)]),/Only a Manager or Partner/);
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_compliance_item_save($1::jsonb)',[J({...item,reference_code:'NOPE'})]),/not in the register/);
 await q('MANAGER','select erp_private.pack_compliance_item_save($1::jsonb)',[J(item)]);
 w=await ws('MANAGER');assert.equal(w.compliance_items.length,10);
 const ids=Object.fromEntries(w.compliance_items.map(i=>[i.item_code,i.item_id]));
 assert.deepEqual((await q('ASSISTANT','select erp_private.pack_compliance_adopt($1) r',[FILE]))[0].r,{ok:true,added:0});
 await assert.rejects(()=>q('MANAGER','select erp_private.pack_compliance_item_approve($1,$2)',[ids['SACCO-S7A'],'Checked against the Act']),/Only a Partner/);
 await assert.rejects(()=>q('PARTNER','select erp_private.pack_compliance_item_approve($1,$2)',[ids['SACCO-S7A'],'short']),/at least 10/);
 for(const code of Object.keys(ids))await q('PARTNER','select erp_private.pack_compliance_item_approve($1,$2)',[ids[code],'Read against the source and the legal report']);
 await q('MANAGER','select erp_private.pack_compliance_item_save($1::jsonb)',[J({...item,requirement:'The SACCO keeps a register of members and updates it monthly.'})]);
 w=await ws('MANAGER');assert.equal(w.compliance_items.find(i=>i.item_code==='SACCO-TEST').status,'Proposed','an edit sends an approved item back to the Partner');
 await q('PARTNER','select erp_private.pack_compliance_item_approve($1,$2)',[ids['SACCO-TEST'],'Re-read the changed wording']);
 iss=await packIssues();assert.ok(iss.some(x=>/compliance register has not been started/.test(x)));
 assert.equal((await q('ASSISTANT','select erp_private.pack_compliance_adopt($1) r',[FILE]))[0].r.added,10);
 assert.equal((await q('ASSISTANT','select erp_private.pack_compliance_adopt($1) r',[FILE]))[0].r.added,0,'adopting twice adds nothing');
 const cp=(role,code,res,eff,n='Inspected the register and agreed to the minutes')=>q(role,'select erp_private.pack_compliance_prepare($1,$2,$3,$4,$5) r',[FILE,ids[code],res,eff,n]);
 const cr=(role,code,ok,n='Agreed')=>q(role,'select erp_private.pack_compliance_review($1,$2,$3,$4) r',[FILE,ids[code],ok,n]);
 await assert.rejects(()=>cp('INTERN','SACCO-S7A','Complied','None'),/Not allowed/);
 await assert.rejects(()=>cp('ASSISTANT','SACCO-S7A','Maybe','None'),/Choose complied/);
 await assert.rejects(()=>cp('ASSISTANT','SACCO-S7A','Not complied','None','Policy not approved by the board last year'),/where a non-compliance is reported/);
 await assert.rejects(()=>cp('ASSISTANT','SACCO-S7A','Not complied','Statutory report','Too short a note'),/at least 20/);
 await cp('ASSISTANT','SACCO-S7A','Not complied','Statutory report','The AML policy was not approved by the board during the year');
 w=await ws('MANAGER');assert.equal(w.compliance.find(k=>k.item_code==='SACCO-S7A').reporting_effect,'Statutory report');
 await assert.rejects(()=>cr('ASSISTANT','SACCO-S7A',true),/Only a Manager or Partner/);
 await cp('MANAGER','SACCO-S7B','Complied','Management letter');
 w=await ws('MANAGER');assert.equal(w.compliance.find(k=>k.item_code==='SACCO-S7B').reporting_effect,'None','a complied item has no reporting effect');
 await assert.rejects(()=>cr('MANAGER','SACCO-S7B',true),/someone else must review/);
 await cr('PARTNER','SACCO-S7B',false,'Say which sections were read');
 w=await ws('MANAGER');assert.equal(w.compliance.find(k=>k.item_code==='SACCO-S7B').status,'Returned');
 await cp('MANAGER','SACCO-S7B','Complied','None','Read sections 7A and 7B, policy and training register agreed');
 for(const code of Object.keys(ids)){if(code!=='SACCO-S7A'&&code!=='SACCO-S7B')await cp('ASSISTANT',code,code==='REG-65-2'?'Not applicable':'Complied','None',code==='REG-65-2'?'Not a reporting duty for this file':'Inspected and agreed to the documents');}
 for(const code of Object.keys(ids))await cr(code==='SACCO-S7B'?'PARTNER':'MANAGER2',code,true);
 w=await ws('MANAGER');assert.ok(w.compliance.every(k=>k.status==='Reviewed'));
 iss=await packIssues();assert.ok(!iss.some(x=>/compliance/i.test(x)),'compliance done: '+iss.join(' | '));

 // ---- 5. Matters communicated and the Partner's key audit matter decision --------------------------------------------------------------------
 const mat={title:'Weak approval of large loans',description:'Loans above the committee limit were disbursed before the credit committee approved them.',communicated_on:'2025-11-20',method:'Written report',communicated_to:'Chair of the supervisory committee',response:'Management will tighten approvals'};
 const ms=(role,m,o={})=>q(role,'select erp_private.pack_matter_save($1,$2,$3::jsonb) r',[FILE,m,J({...mat,...o})]);
 await assert.rejects(()=>ms('INTERN',null),/Not allowed/);
 await assert.rejects(()=>ms('ASSISTANT',null,{communicated_on:'2030-01-01'}),/cannot be in the future/);
 await assert.rejects(()=>ms('ASSISTANT',null,{communicated_on:'2024-06-01'}),/before the audit period began/);
 await assert.rejects(()=>ms('ASSISTANT',null,{method:'Rumour'}),/method/i);
 await assert.rejects(()=>ms('ASSISTANT',null,{description:'Too short'}),/description/i);
 const M1=(await ms('ASSISTANT',null))[0].r.matter_id,M2=(await ms('ASSISTANT',null,{title:'Late bank reconciliations',description:'Bank reconciliations were completed more than two months after each month end.'}))[0].r.matter_id;
 w=await ws('MANAGER');assert.deepEqual(w.matters.map(m=>m.matter_ref),['TM-001','TM-002']);
 iss=await packIssues();assert.ok(iss.some(x=>/Matter TM-001 .* has no key audit matter decision/.test(x)));assert.ok(!iss.some(x=>/No matter has been decided/.test(x)),'the "none decided" line is not a sign-off issue');
 const kd=(role,m,o)=>q(role,'select erp_private.pack_kam_decide($1,$2::jsonb) r',[m,J(o)]);
 const KAM={decision:'KAM',significance_note:'Loans are the largest asset and the approval weakness affects their valuation.',heading:'Approval of large loans',how_addressed:'We tested approvals for every loan above the limit and extended our sample.',draft_text:'Loans to members are the largest asset. Approval of large loans was weak during the year, so we extended our work on existence and valuation.'};
 await assert.rejects(()=>kd('MANAGER',M1,KAM),/Only a Partner decides/);
 await assert.rejects(()=>kd('PARTNER',M1,{...KAM,decision:'Maybe'}),/Choose key audit matter/);
 await assert.rejects(()=>kd('PARTNER',M1,{...KAM,significance_note:'short'}),/reason for your decision/);
 await assert.rejects(()=>kd('PARTNER',M1,{...KAM,draft_text:'Too short'}),/needs a heading/);
 await kd('PARTNER',M1,KAM);await kd('PARTNER2',M2,{decision:'Not a KAM',significance_note:'Resolved during the year and not of most significance to the audit.'});
 w=await ws('MANAGER');assert.equal(w.matters[0].decision,'KAM');assert.equal(w.matters[1].decision,'Not a KAM');assert.deepEqual(w.kam_blocking,[]);
 iss=await packIssues();assert.ok(!iss.some(x=>/Matter TM/.test(x)));
 // Changing a matter after the decision makes the decision stale; the Partner has to decide again.
 await ms('ASSISTANT',M1,{response:'Management has now approved a new policy'});
 w=await ws('MANAGER');assert.equal(w.matters[0].decision_stale,true);assert.match(w.kam_blocking.join(' '),/Matter TM-001 .* changed after the Partner decided/);
 await kd('PARTNER',M1,KAM);w=await ws('MANAGER');assert.equal(w.matters[0].decision_stale,false);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.pack_matter_withdraw($1,$2)',[M2,'short']),/at least 10/);
 // A matter that was never communicated cannot have a decision, and a KAM cannot exist without one.
 assert.equal((await db.query(`select count(*)::int n from erp_private.audit_kam_decisions d left join erp_private.audit_tcwg_matters m on m.matter_id=d.matter_id where m.matter_id is null`)).rows[0].n,0);
 await assert.rejects(()=>db.query(`insert into erp_private.audit_kam_decisions(matter_id,audit_file_id,project_id,handling_firm_id,decision,significance_note,matter_revision,decided_by) values($1,$2,$3,$4,'Not a KAM','A reason that is long enough here',1,$5)`,[id(),FILE,P,F,actors.PARTNER.staff_id]),/foreign key|violates/i);

 // ---- 6. Key audit matters report ------------------------------------------------------------------------------------------------------------
 const draft=(role,kind,prm={})=>q(role,'select erp_private.audit_report_draft($1,$2,$3::jsonb) id',[FILE,kind,J(prm)]).then(r=>r[0].id);
 const body=async rid=>JSON.parse(JSON.stringify((await db.query('select body from erp_private.audit_reports where report_id=$1',[rid])).rows[0].body));
 const stat=async kind=>(await q('MANAGER','select erp_private.audit_report_status($1) s',[FILE]))[0].s.find(x=>x.kind===kind);
 const K1=await draft('MANAGER','Key audit matters');let b=await body(K1);
 assert.equal(b.items.length,1);assert.equal(b.items[0].heading,'Approval of large loans');assert.equal(b.items[0].matter_ref,'TM-001');assert.equal(b.items[0].communicated_on,'2025-11-20');
 assert.equal(b.considered_not_kam.length,1);assert.equal(b.considered_not_kam[0].matter_ref,'TM-002');
 assert.equal((await stat('Key audit matters')).required,true,'a decided KAM makes the report required');
 await q('MANAGER','select erp_private.audit_report_submit($1)',[K1]);
 await assert.rejects(()=>q('MANAGER2','select erp_private.audit_report_review($1,$2,$3)',[K1,'Approve','Read against the decisions']),/Only a Partner approves the key audit matters/);
 await q('PARTNER','select erp_private.audit_report_review($1,$2,$3)',[K1,'Approve','Read against the matters communicated']);
 assert.equal((await stat('Key audit matters')).current,true);
 await ms('ASSISTANT',M1,{response:'Management has changed its answer again'});
 assert.equal((await stat('Key audit matters')).current,false,'a changed matter makes the approved KAM report out of date');
 await kd('PARTNER',M1,KAM);
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_report_draft($1,$2,$3::jsonb)',[FILE2,'Key audit matters','{}']),/only for a SACCO file/);

 // ---- 7. Statutory report to regulator -------------------------------------------------------------------------------------------------------
 const prm={addressee:'The regulator (name to be confirmed by the Partner)',partner_conclusion:'In my opinion the matters listed below are the matters to report for this year.'};
 await assert.rejects(()=>draft('MANAGER','Statutory report to regulator',{...prm,addressee:''}),/who the report is addressed to/);
 await assert.rejects(()=>draft('MANAGER','Statutory report to regulator',{...prm,partner_conclusion:'Short'}),/own words/);
 assert.equal((await stat('Statutory report to regulator')).required,true,'required by default for a deposit-taking SACCO');
 const S1=await draft('MANAGER','Statutory report to regulator',prm);b=await body(S1);
 assert.equal(b.partner_conclusion,prm.partner_conclusion);assert.equal(b.sacco_type,'DT_SACCO');
 assert.deepEqual(b.ratios,[],'no ratio is confirmed yet');
 assert.equal(b.compliance.length,1);assert.equal(b.compliance[0].code,'SACCO-S7A');assert.equal(b.compliance[0].result,'Not complied');
 assert.equal(b.calendar.status,'Unconfirmed');assert.equal(b.calendar.due,null,'no date is computed until a Partner confirms the rule');assert.match(b.calendar.as_reported,/four months/);
 w=await ws('MANAGER');const blk=w.statutory_blocking.join(' | ');
 assert.match(blk,/audit report date is not set/);assert.match(blk,/eligibility is not confirmed/);assert.match(blk,/No SASRA ratio is confirmed/);
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_report_submit($1)',[S1]),/statutory report to regulator is not ready to submit: The audit report date is not set/);
 // Make the file ready: report date, eligibility (demonstration file), a confirmed ratio and the figures.
 await db.exec(`update erp_private.audit_files set audit_report_date='2026-03-20',is_demonstration=true,demonstration_warning='DEMONSTRATION DATA — NOT A REAL AUDIT / NOT FOR ISSUANCE',source_archive_read_only=true where audit_file_id='${FILE}'`);
 await db.query(`insert into erp_private.legal_references(ref_code,title,instrument_type,legal_status,applies_to,source_url,verification,verified_by,verified_at,verification_note) values('FICT-REG-TEST','Fictional regulation for the test','Regulation','In force','{DT_SACCO}','https://example.test/regulation','Primary source verified',$1,now(),'Fictional: read page 12 of the source')`,[actors.PARTNER.staff_id]);
 const REFID=(await db.query(`select ref_id from erp_private.legal_references where ref_code='FICT-REG-TEST'`)).rows[0].ref_id;
 await q('PARTNER','select erp_private.sasra_line_define($1,$2)',['CORE_CAPITAL','Fictional definition of core capital for the test']);await q('PARTNER','select erp_private.sasra_line_define($1,$2)',['TOTAL_ASSETS','Fictional definition of total assets for the test']);
 const RID=(await q('MANAGER','select erp_private.sasra_ratio_save($1::jsonb) r',[J({ratio_code:'fict_core',label:'Fictional core capital to total assets',sacco_type:'DT_SACCO',measure:'Percentage',comparator:'At least',threshold:'8',numerator_line:'CORE_CAPITAL',denominator_line:'TOTAL_ASSETS',effective_from:'2024-01-01',reference_id:REFID})]))[0].r.ratio_id;
 await q('PARTNER','select erp_private.sasra_ratio_activate($1,$2,$3)',[RID,'Fictional: checked page 12 of the source',1]);
 w=await ws('MANAGER');assert.match(w.statutory_blocking.join(' | '),/Figures missing for Fictional core capital/);
 await q('ASSISTANT','select erp_private.sasra_figure_save($1,$2,$3,$4)',[FILE,'CORE_CAPITAL',60,'Fictional WP E1']);await q('ASSISTANT','select erp_private.sasra_figure_save($1,$2,$3,$4)',[FILE,'TOTAL_ASSETS',1000,'Fictional WP E1']);
 w=await ws('MANAGER');assert.match(w.statutory_blocking.join(' | '),/Breach not acknowledged by a Partner/);
 await q('PARTNER','select erp_private.sasra_breach_ack($1,$2,$3)',[FILE,RID,'Fictional: disclosed in the report and discussed with the board']);
 w=await ws('MANAGER');assert.deepEqual(w.statutory_blocking,[]);
 const S2=await draft('MANAGER','Statutory report to regulator',prm);b=await body(S2);
 assert.equal(b.ratios.length,1);assert.equal(b.ratios[0].state,'Breach');assert.equal(b.ratios[0].acknowledged,true);assert.equal(b.ratio_acknowledgements.length,1);assert.equal(b.report_date,'2026-03-20');
 await q('MANAGER','select erp_private.audit_report_submit($1)',[S2]);
 await assert.rejects(()=>q('MANAGER2','select erp_private.audit_report_review($1,$2,$3)',[S2,'Approve','Read against the compliance register']),/Only a Partner approves the statutory report to regulator/);
 await q('PARTNER','select erp_private.audit_report_review($1,$2,$3)',[S2,'Approve','Read against the register, ratios and calendar']);
 assert.equal((await stat('Statutory report to regulator')).current,true);
 // A compliance result changing after approval makes it out of date; the file cannot be approved until a new version is approved.
 await cp('ASSISTANT','SACCO-AGM','Not complied','Statutory report','The annual general meeting was held after the date the legal report gives');
 assert.equal((await stat('Statutory report to regulator')).current,false);
 await assert.rejects(()=>db.query(`update erp_private.audit_files set file_status='Approved' where audit_file_id=$1`,[FILE]),/Approve a current version of:.*statutory report to regulator/);
 // The policy can be switched by a Partner only; DT files then no longer require the report, but an approved one stays valid evidence.
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_policy_save($1,$2,$3)',['SACCO_DT_REQUIRES_STATUTORY_REPORT','false','Not needed this year here']),/Only a Partner/);
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['SACCO_DT_REQUIRES_STATUTORY_REPORT','false','Fictional: Partner decision recorded']);
 assert.equal((await stat('Statutory report to regulator')).required,false);w=await ws('MANAGER');assert.equal(w.policy.confirmed,true);assert.equal(w.statutory_required,false);
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['SACCO_DT_REQUIRES_STATUTORY_REPORT','true','Fictional: back to the default']);
 await assert.rejects(()=>draft('MANAGER','Statutory report to regulator',prm).then(()=>q('MANAGER','select erp_private.audit_report_draft($1,$2,$3::jsonb)',[FILE2,'Statutory report to regulator',J(prm)])),/only for a SACCO file/);
 // The ordinary report kinds are untouched.
 assert.equal((await q('MANAGER','select erp_private.audit_report_status($1) s',[FILE2]))[0].s.length,6);
 assert.equal((await q('MANAGER','select erp_private.audit_report_status($1) s',[FILE2]))[0].s.find(x=>x.kind==='Statutory report to regulator').required,false);
 assert.deepEqual((await q('MANAGER','select erp_private.sasra_signoff_issues($1) r',[FILE2]))[0].r,[]);
});
