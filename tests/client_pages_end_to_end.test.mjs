import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const Pg=await import('../supabase/functions/staff-workspace-v12/client-pages-actions.ts');
const R=await import('../supabase/functions/staff-workspace-v12/annual-pack-rules.mjs');const G=await import('../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs');
const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

let per;const ED='Third Edition (2025)',FW='IFRS for SMEs Accounting Standard';


const pl=(kind,label,current,prior=null,code=null)=>({kind,label,code,current,prior});
const stmts={presentation:{unit_label:'KES'},profit_or_loss:{rows:[pl('heading','Revenue'),pl('line','Sales',1000000,800000,'PL.REVENUE'),pl('subtotal','Gross profit',600000,400000),pl('total','Profit for the year',150000,90000)]},financial_position:{rows:[pl('line','Cash',90000,50000,'SFP.CASH'),pl('total','Total assets',700000,500000)]}};
const get=async()=>({statements:stmts,client:{name:'Fictional Mlima Traders',legal_form:'Company'},reporting:{framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)'},as_of:'2026-12-31'});
const act=(role,p)=>as(role,a=>Pg.pagesAction(tx,a,per,p,get,'2026-12-31'));
const fact=async(k,v)=>{const m=(await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,source_reference,recorded_by) values(${CL},${k},${v},'Prior record','Fictional register extract',${actors.ASSISTANT.staff_id}) returning fact_id`)[0];return m.fact_id;};
const verify=id_=>tx`update erp_private.client_field_facts set status='Verified',verified_by=${actors.PARTNER.staff_id},verified_at=now(),verification_note='Fictional check' where fact_id=${id_}`;

test('client pages: facts and people from the client file, declared and approved pages, the Partner-only not-applicable rule, the pack check and the audit freeze',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const p2=actors.PARTNER2={staff_id:id(),auth_user_id:id(),session:id(),category_code:'PARTNER'};await tx`insert into auth.users(id) values(${p2.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${p2.session},${p2.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${p2.staff_id},${p2.auth_user_id},'PARTNER2','partner2','Fictional PARTNER2','PARTNER','Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${p2.session},${p2.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${p2.staff_id},${F},'Assigned')`;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${CL},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role==='PARTNER2'?'PARTNER':role})`;
 per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 // ----- nothing is in the client file yet: every page says what is missing and nothing is invented
 let r=await act('MANAGER',{action:'ledger_pages_read'});
 assert.equal(r.complete,false);assert.equal(r.form,'Company');assert.deepEqual(r.pages.map(p=>p.code),['COVER','ENTITY_INFO','REPORT','RESPONSIBILITIES','STATISTICS']);
 assert.equal(r.pages.find(p=>p.code==='COVER').state,'Not ready','a company needs its registration number verified before the cover can print');
 assert.match(r.problems.join(' '),/Registration number is not verified/);assert.match(r.problems.join(' '),/No director is recorded/);
 assert.equal(r.pages.find(p=>p.code==='STATISTICS').state,'Ready');
 // a recorded fact is not a verified fact
 await fact('registration_number','CPR/2020/000001');await fact('incorporation_date','2020-03-02');await fact('registered_address','Fictional House, Nairobi');
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.match(r.problems.join(' '),/Registration number is not verified/,'unverified facts are never printed');
 for(const f of (await tx`select fact_id from erp_private.client_field_facts`))await verify(f.fact_id);
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.equal(r.pages.find(p=>p.code==='COVER').state,'Ready');assert.ok(r.pages.find(p=>p.code==='COVER').blocks.some(b=>b.text==='Registration number: CPR/2020/000001'));
 // directors: seen through a narrow function by an Assistant, who cannot read the ownership records
 await tx`insert into erp_private.client_parties(client_id,role,party_kind,full_name,appointed_on,created_by) values(${CL},'Director','Individual','Fictional Amani Director','2020-03-02',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_parties(client_id,role,party_kind,full_name,appointed_on,created_by) values(${CL},'Director','Individual','Fictional Old Director','2020-03-02',${actors.MANAGER.staff_id})`;
 await tx`update erp_private.client_parties set ceased_on='2025-12-31',end_reason='Fictional resignation letter',ended_by=${actors.MANAGER.staff_id} where full_name='Fictional Old Director'`;
 await tx`insert into erp_private.client_parties(client_id,role,party_kind,full_name,shareholding_percentage,appointed_on,created_by) values(${CL},'Shareholder','Individual','Fictional Owner',100,'2020-03-02',${actors.MANAGER.staff_id})`;
 r=await act('ASSISTANT',{action:'ledger_pages_read'});assert.deepEqual(r.candidates,['Fictional Amani Director'],'only a director who served in the year; shareholders are not exposed');
 assert.equal((await as('ASSISTANT',()=>tx`select 1 from erp_private.client_parties`)).length,0,'the ownership records stay hidden from an Assistant');
 // ----- declaring
 const D=(code,fields,extra={})=>act('ASSISTANT',{action:'ledger_page_declare',code,state:'Declared',fields,...extra});
 await assert.rejects(()=>D('ENTITY_INFO',{bankers:'Fictional Bank',auditors:'Fictional Auditors'}),/Enter company secretary/);
 await assert.rejects(()=>D('NOPE',{}),/not one that is declared/);
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_page_declare',code:'ENTITY_INFO',state:'Not applicable',reason:'Not needed for this client at all.'}),/always applies/);
 const e1=await D('ENTITY_INFO',{bankers:'Fictional Bank Limited',auditors:'Fictional Auditors LLP',secretary:'Fictional Secretaries',advocates:'Fictional Advocates'});assert.equal(e1.version,1);
 r=await act('MANAGER',{action:'ledger_pages_read'});const ed=r.declared.find(d=>d.code==='ENTITY_INFO');assert.equal(ed.state,'Waiting for approval');assert.equal(ed.can_review,true);assert.match(r.problems.join(' '),/waiting for approval/);
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_page_review',page_id:e1.page_id,decision:'Approved'}),/Manager or Partner/);
 await assert.rejects(()=>act('MANAGER',{action:'ledger_page_review',page_id:e1.page_id,decision:'Returned',review_note:'no'}),/at least 10/);
 assert.equal((await act('MANAGER',{action:'ledger_page_review',page_id:e1.page_id,decision:'Returned',review_note:'Fictional: add the second banker.'})).status,'Returned');
 r=await act('ASSISTANT',{action:'ledger_pages_read'});assert.equal(r.declared.find(d=>d.code==='ENTITY_INFO').state,'Returned');assert.match(r.problems.join(' '),/returned for changes/);
 const e2=await D('ENTITY_INFO',{bankers:'Fictional Bank Limited; Fictional Sacco',auditors:'Fictional Auditors LLP',secretary:'Fictional Secretaries',advocates:'Fictional Advocates'});assert.equal(e2.version,2);
 // a Manager cannot approve what they declared; a Partner cannot while the firm has two Partners
 const rep=await act('MANAGER',{action:'ledger_page_declare',code:'REPORT',state:'Declared',fields:{review:'Fictional review: a steady year of trading.',dividends:'No dividend was declared.'}});
 await assert.rejects(()=>act('MANAGER',{action:'ledger_page_review',page_id:rep.page_id,decision:'Approved'}),/Someone else approves/);
 const rep2=await act('PARTNER',{action:'ledger_page_declare',code:'REPORT',state:'Declared',fields:{review:'Fictional review: a steady year of trading.',dividends:'No dividend was declared.',audit_info:'So far as each director knows, there is no information the auditor is unaware of.'}});assert.equal(rep2.version,2,'a new declaration replaces the draft');
 await assert.rejects(()=>act('PARTNER',{action:'ledger_page_review',page_id:rep2.page_id,decision:'Approved'}),/Someone else approves/);
 await assert.rejects(()=>act('PARTNER',{action:'ledger_page_review',page_id:rep2.page_id,decision:'Approved',sole_partner_approval:true}),/only Partner|sole Partner/);
 assert.equal((await act('MANAGER',{action:'ledger_page_review',page_id:rep2.page_id,decision:'Approved'})).sole_partner_approval,false);
 assert.equal((await act('MANAGER',{action:'ledger_page_review',page_id:e2.page_id,decision:'Approved'})).status,'Approved');
 await assert.rejects(()=>act('MANAGER',{action:'ledger_page_review',page_id:e1.page_id,decision:'Approved'}),/has changed/,'a replaced page cannot be reviewed');
 // responsibilities: the draft text is offered, signatories come from the record, the date follows the year end
 r=await act('MANAGER',{action:'ledger_pages_read'});const rd=r.declared.find(d=>d.code==='RESPONSIBILITIES');assert.match(rd.prefill.statement,/Companies Act, 2015/);assert.deepEqual(rd.prefill.signatory_choices,['Fictional Amani Director']);
 const base={statement:rd.prefill.statement,approved_on:'2027-02-15',signatories:['Fictional Amani Director']};
 await assert.rejects(()=>D('RESPONSIBILITIES',{...base,signatories:['Fictional Stranger']}),/not on the client/);
 await assert.rejects(()=>D('RESPONSIBILITIES',{...base,approved_on:'2026-06-30'}),/before the end of the year/);
 // not applicable: only a Partner approves, and always with a reason
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_page_declare',code:'RESPONSIBILITIES',state:'Not applicable',reason:'short'}),/at least 10/);
 const na=await act('ASSISTANT',{action:'ledger_page_declare',code:'RESPONSIBILITIES',state:'Not applicable',reason:'The firm issues no such statement for this client.'});assert.equal(na.version,1);
 await assert.rejects(()=>act('MANAGER',{action:'ledger_page_review',page_id:na.page_id,decision:'Approved'}),/Partner approves a page/);
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.equal(r.declared.find(d=>d.code==='RESPONSIBILITIES').can_review,false,'the Manager is not shown an approval they cannot give');
 assert.equal((await act('PARTNER2',{action:'ledger_page_review',page_id:na.page_id,decision:'Approved'})).status,'Approved');
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.equal(r.pages.find(p=>p.code==='RESPONSIBILITIES').state,'Not applicable');
 // replace it with the real statement: the not-applicable approval stands until the new one is approved
 const rs3=await D('RESPONSIBILITIES',base);assert.equal(rs3.version,2);
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.equal(r.pages.find(p=>p.code==='RESPONSIBILITIES').state,'Not applicable');
 await act('MANAGER',{action:'ledger_page_review',page_id:rs3.page_id,decision:'Approved'});
 await assert.rejects(()=>D('RESPONSIBILITIES',base),/already approved/);
 // the pack still lacks the principal activity, which is a disclosure approved elsewhere
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.equal(r.complete,false);assert.match(r.problems.join(' '),/principal activity is not approved/);
 {const x=(await as('ASSISTANT',a=>tx`insert into erp_private.period_disclosures(period_id,project_id,client_id,code,version,state,body,declared_by) values(${per.period_id},${P},${CL},'PRINCIPAL_ACTIVITY',1,'Text','Wholesale and retail trade in building materials.',${a.staff_id}) returning disclosure_id`))[0];
  await as('MANAGER',a=>tx`update erp_private.period_disclosures set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now() where disclosure_id=${x.disclosure_id}`);}
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.equal(r.complete,true,r.problems.join(' '));assert.deepEqual(r.problems,[]);
 const rb=r.pages.find(p=>p.code==='REPORT').blocks;assert.ok(rb.some(b=>b.text==='Wholesale and retail trade in building materials.'));assert.ok(rb.some(b=>/profit for the year was KES 150,000/.test(b.text||'')));
 assert.match(r.pages.find(p=>p.code==='ENTITY_INFO').blocks[0].lines.find(l=>l[0]==='Directors')[1],/Fictional Amani Director/);
 // ----- the pack gate: the check passes, and a missing page keeps the pack at "Ready for review", never final
 const rules={period:{starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'},reporting:{framework:FW,edition:ED,presentation_currency:'KES',rounding:'Whole shillings',comparatives_basis:'Prior-year ledger',early_application_note:''},tb:[],maps:[],lines:[],asOf:'2026-12-31'};
 const built=(await as('MANAGER',()=>Pg.pagesFor(tx,per,{statements:stmts,client:{name:'Fictional Mlima Traders',legal_form:'Company'},reporting:{}}))).built;
 assert.equal(R.packReadiness({...rules,pages:built}).checks.find(c=>c.code==='CLIENT_PAGES').status,'Pass');
 assert.equal(R.packReadiness({...rules}).checks.find(c=>c.code==='CLIENT_PAGES'),undefined,'older callers are unchanged');
 const bad=R.packReadiness({...rules,pages:{...built,complete:false,problems:['Report of the directors: not declared yet.']}});const bc=bad.checks.find(c=>c.code==='CLIENT_PAGES');assert.equal(bc.status,'Blocked');assert.match(bc.detail,/not declared yet/);
 const gate=G.annualGate({gate:{checks:[{code:'SIGN_OFF',label:'Signed off',ok:true,detail:''}]},pack:{checks:[...['REPORTING_BASIS','MAP_APPROVED','NO_LEGACY','NO_UNRESOLVED','COMPARATIVES'].map(code=>({code,label:code,status:'Pass',detail:''})),bc]},statementProblems:[]});
 assert.equal(gate.status,'Ready for review');assert.deepEqual(gate.failing,['A_CLIENT_PAGES']);assert.equal(gate.ready,false);
 // ----- the database holds the same rules
 await assert.rejects(()=>tx`update erp_private.period_client_pages set fields='{"bankers":"Changed after approval"}' where code='ENTITY_INFO' and status='Approved'`,/cannot be edited/);
 await assert.rejects(()=>tx`delete from erp_private.period_client_pages`);
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.period_client_pages set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now() where code='REPORT' and status='Superseded'`),/closed|Manager or Partner must review/);
 await assert.rejects(()=>tx`insert into erp_private.period_client_pages(period_id,project_id,client_id,code,version,state,fields,reason,declared_by) values(${per.period_id},${P},${CL},'REPORT',9,'Declared','{"review":"x"}',null,${actors.MANAGER.staff_id})`,/version/);
 await assert.rejects(()=>tx`insert into erp_private.period_client_pages(period_id,project_id,client_id,code,version,state,fields,reason,declared_by) values(${per.period_id},${P},${CL},'ENTITY_INFO',3,'Not applicable','{}','Fictional reason to skip it',${actors.MANAGER.staff_id})`,/check/);
 // ----- an audit lock freezes the pages
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_audit_locks(period_id,project_id,client_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,report_reference,report_date,opinion,locked_by) values(${per.period_id},${P},${CL},'In-house audit',${id()},${'a'.repeat(64)},${'b'.repeat(64)},${id()},'Fictional report ref','2026-12-31','Unmodified',${actors.PARTNER.staff_id})`;
 await db.exec('set session_replication_role=origin');
 r=await act('MANAGER',{action:'ledger_pages_read'});assert.equal(r.locked,true);assert.equal(r.can_declare,false);assert.ok(r.declared.every(d=>d.can_review===false));
 await assert.rejects(()=>D('REPORT',{review:'Fictional review: a changed year of trading.',dividends:'None.'}),/locked by an audit/);
 await assert.rejects(()=>tx`insert into erp_private.period_client_pages(period_id,project_id,client_id,code,version,state,fields,declared_by) values(${per.period_id},${P},${CL},'REPORT',3,'Declared','{"review":"Changed review text for the locked year."}',${actors.ASSISTANT.staff_id})`,/locked by an audit/);
 assert.equal(await Pg.pagesAction(tx,actors.MANAGER,per,{action:'something_else'},get,'2026-12-31'),undefined);
});
