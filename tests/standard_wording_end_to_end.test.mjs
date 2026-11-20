import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const W=await import('../supabase/functions/staff-workspace-v12/wording-actions.ts');
const M=await import('../supabase/functions/staff-workspace-v12/annual-pack-wording.mjs');
const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

let per;const ED='Third Edition (2025)',FW='IFRS for SMEs Accounting Standard';
const stub=(refs=['REVENUE','PPE'])=>async()=>({statements:{notes:{items:refs.map(ref=>({ref}))}},client:{name:'Fictional Mlima Traders',legal_form:'Company'},reporting:{framework:FW,edition:ED,rounding:'Whole shillings',early_application_note:'Early application of the Third Edition (2025).'},as_of:'2026-12-31'});
const lib=(role,p)=>as(role,a=>W.wordingLibraryAction(tx,a,{framework:FW,edition:ED,...p}));
const yr=(role,p,refs)=>as(role,a=>W.wordingAction(tx,a,per,p,stub(refs),'2026-12-31'));
const total=M.WORDING_DEFAULTS.reduce((n,d)=>n+M.variantKeys(d.code).length,0);

test('standard wording and disclosures: preparation, Partner approval, declarations, the sole-Partner rule, order and the audit freeze',async t=>{
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
 // ----- the library
 await assert.rejects(()=>lib('ASSISTANT',{action:'wording_library_prepare_all'}),/Manager or Partner/);
 await assert.rejects(()=>lib('MANAGER',{action:'wording_library_review',wording_ids:[id()],decision:'Approved'}),/Only a Partner/);
 let r=await lib('MANAGER',{action:'wording_library_read'});assert.equal(r.entries.length,total);assert.ok(r.entries.every(e=>e.state==='Not prepared'));assert.equal(r.can_prepare,true);assert.equal(r.can_review,false);
 assert.equal((await lib('MANAGER',{action:'wording_library_prepare_all'})).prepared,total);
 assert.equal((await lib('MANAGER',{action:'wording_library_prepare_all'})).prepared,0,'nothing is prepared twice');
 r=await lib('PARTNER',{action:'wording_library_read'});assert.ok(r.entries.every(e=>e.state==='Waiting for a Partner'&&e.draft.origin==='Built-in draft'));
 await assert.rejects(()=>lib('MANAGER',{action:'wording_library_prepare',code:'POLICY_CASH',variant:'All',body:'Cash is cash at {rate} per cent of the total.'}),/not a fact/);
 await assert.rejects(()=>lib('MANAGER',{action:'wording_library_prepare',code:'POLICY_CASH',variant:'Company',body:'Cash comprises cash on hand and bank balances.'}),/no such variant/);
 await assert.rejects(()=>lib('MANAGER',{action:'wording_library_prepare',framework:'IFRS Accounting Standards',edition:'As issued at the reporting date',code:'POLICY_CASH',variant:'All'}),/no built-in wording/);
 // an edited draft by the Partner: the same Partner cannot approve it, the other Partner can
 const cash=await lib('PARTNER',{action:'wording_library_prepare',code:'POLICY_CASH',variant:'All',body:'Cash and cash equivalents comprise cash on hand, bank balances and mobile money balances.'});assert.equal(cash.version,2);
 await assert.rejects(()=>lib('PARTNER',{action:'wording_library_review',wording_id:cash.wording_id,decision:'Approved'}),/different Partner approves/);
 await assert.rejects(()=>lib('PARTNER2',{action:'wording_library_review',wording_id:cash.wording_id,decision:'Returned',review_note:'no'}),/at least 10/);
 const ids=(await tx`select wording_id from erp_private.standard_wording where status='Draft'`).map(x=>x.wording_id);assert.equal(ids.length,total);
 const rv=await lib('PARTNER2',{action:'wording_library_review',wording_ids:ids,decision:'Approved'});assert.equal(rv.reviewed.length,total);assert.ok(rv.reviewed.every(x=>x.status==='Approved'&&x.sole_partner_approval===false));
 r=await lib('PARTNER',{action:'wording_library_read'});assert.equal(r.approved_count,total);
 assert.equal((await tx`select count(*)::int n from erp_private.standard_wording where code='POLICY_CASH' and status='Superseded'`)[0].n,1,'the first draft was superseded by the edited one');
 await assert.rejects(()=>lib('MANAGER',{action:'wording_library_prepare',code:'POLICY_PAYABLES',variant:'All'}),/already approved with this text/);
 // a change is a new version; the approved text stands until the new one is approved
 const nv=await lib('MANAGER',{action:'wording_library_prepare',code:'POLICY_PAYABLES',variant:'All',body:'Trade and other payables are measured at the transaction price and then at amortised cost.'});assert.equal(nv.version,2);
 assert.equal((await lib('PARTNER',{action:'wording_library_read'})).entries.find(e=>e.code==='POLICY_PAYABLES').approved.version,1);
 assert.equal((await lib('PARTNER2',{action:'wording_library_review',wording_id:nv.wording_id,decision:'Approved'})).reviewed[0].status,'Approved');
 assert.equal((await tx`select version from erp_private.standard_wording where code='POLICY_PAYABLES' and status='Approved'`)[0].version,2);
 // the database holds the same rules
 await assert.rejects(()=>tx`update erp_private.standard_wording set body='Changed after approval, so this must fail.' where code='POLICY_PAYABLES' and status='Approved'`,/cannot be edited/);
 await assert.rejects(()=>tx`delete from erp_private.standard_wording`);
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.standard_wording set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now() where code='POLICY_CASH' and status='Superseded'`),/Partner must review|closed/);

 // ----- the year: nothing declared yet, so the pack is blocked and names every disclosure
 let y=await yr('ASSISTANT',{action:'ledger_wording_read'});
 assert.equal(y.complete,false);assert.equal(y.disclosures.length,8,'six always, plus revenue and depreciation facts for the two notes');assert.ok(y.disclosures.every(d=>d.state==='Not declared'));assert.equal(y.can_declare,true);assert.equal(y.can_order,false);
 assert.ok(y.problems.some(p=>/"Going concern" has not been declared/.test(p)));
 // declarations: the rules
 await assert.rejects(()=>yr('INTERN',{action:'ledger_wording_read'}),/staff who prepare or review/).catch(()=>{});
 await assert.rejects(()=>yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'GOING_CONCERN',state:'Nothing to report'}),/needs a statement/);
 await assert.rejects(()=>yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'POLICY_INVENTORY',state:'Text',body:'First in first out is used throughout.'}),/not needed for this client year/);
 await assert.rejects(()=>yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'RELATED_PARTIES',state:'Text',body:'short'}),/at least 10/);
 const d1=await yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'PRINCIPAL_ACTIVITY',state:'Text',body:'Wholesale and retail trade in building materials.'});assert.equal(d1.version,1);
 await assert.rejects(()=>yr('ASSISTANT',{action:'ledger_disclosure_review',disclosure_id:d1.disclosure_id,decision:'Approved'}),/Manager or Partner/);
 y=await yr('MANAGER',{action:'ledger_wording_read'});assert.equal(y.disclosures.find(d=>d.code==='PRINCIPAL_ACTIVITY').state,'Waiting for approval');assert.equal(y.disclosures.find(d=>d.code==='PRINCIPAL_ACTIVITY').can_review,true);
 assert.ok(y.problems.some(p=>/"Principal activity" is declared and waits/.test(p)));
 await assert.rejects(()=>yr('MANAGER',{action:'ledger_disclosure_review',disclosure_id:d1.disclosure_id,decision:'Returned',review_note:'no'}),/at least 10/);
 const rt=await yr('MANAGER',{action:'ledger_disclosure_review',disclosure_id:d1.disclosure_id,decision:'Returned',review_note:'Fictional: name the products sold.'});assert.equal(rt.status,'Returned');
 y=await yr('ASSISTANT',{action:'ledger_wording_read'});assert.equal(y.disclosures.find(d=>d.code==='PRINCIPAL_ACTIVITY').state,'Returned');
 const d1b=await yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'PRINCIPAL_ACTIVITY',state:'Text',body:'Wholesale and retail trade in cement, timber and roofing sheets.'});assert.equal(d1b.version,2);
 // a Manager cannot approve what the Manager declared; a Partner can approve a Manager's; the sole-Partner flag is not available while the firm has two Partners
 const d2=await yr('MANAGER',{action:'ledger_disclosure_declare',code:'GOING_CONCERN',state:'Text',body:'The owners expect the business to continue for at least twelve months from the reporting date.'});
 await assert.rejects(()=>yr('MANAGER',{action:'ledger_disclosure_review',disclosure_id:d2.disclosure_id,decision:'Approved'}),/Someone else approves/);
 const d3=await yr('PARTNER',{action:'ledger_disclosure_declare',code:'POLICY_REVENUE',state:'Text',body:'Sales of goods are recognised when the goods are delivered to the customer.'});
 await assert.rejects(()=>yr('PARTNER',{action:'ledger_disclosure_review',disclosure_id:d3.disclosure_id,decision:'Approved'}),/Someone else approves/);
 await assert.rejects(()=>yr('PARTNER',{action:'ledger_disclosure_review',disclosure_id:d3.disclosure_id,decision:'Approved',sole_partner_approval:true}),/only Partner/);
 assert.equal((await yr('PARTNER2',{action:'ledger_disclosure_review',disclosure_id:d3.disclosure_id,decision:'Approved'})).sole_partner_approval,false);
 assert.equal((await yr('PARTNER',{action:'ledger_disclosure_review',disclosure_id:d2.disclosure_id,decision:'Approved'})).status,'Approved');
 assert.equal((await yr('PARTNER',{action:'ledger_disclosure_review',disclosure_id:d1b.disclosure_id,decision:'Approved'})).status,'Approved');
 for(const [code,body] of [['POLICY_PPE','Buildings 2.5 per cent, vehicles 25 per cent and equipment 12.5 per cent, on the reducing balance.']]){const x=await yr('ASSISTANT',{action:'ledger_disclosure_declare',code,state:'Text',body});await yr('MANAGER',{action:'ledger_disclosure_review',disclosure_id:x.disclosure_id,decision:'Approved'});}
 for(const code of ['RELATED_PARTIES','EVENTS_AFTER','COMMITMENTS','CONTINGENCIES']){const x=await yr('ASSISTANT',{action:'ledger_disclosure_declare',code,state:'Nothing to report'});assert.equal(x.version,1);
  if(code==='CONTINGENCIES'){y=await yr('MANAGER',{action:'ledger_wording_read'});assert.equal(y.complete,false,'one disclosure is still waiting');assert.ok(y.problems.some(p=>/"Contingent liabilities and assets" is declared and waits/.test(p)));}
  await yr('MANAGER',{action:'ledger_disclosure_review',disclosure_id:x.disclosure_id,decision:'Approved'});}
 y=await yr('MANAGER',{action:'ledger_wording_read'});
 assert.deepEqual(y.problems,[]);assert.equal(y.complete,true);
 const sec=k=>y.sections.find(s=>s.key===k);
 assert.match(sec('REPORTING_ENTITY').text,/^Fictional Mlima Traders \(the Company\) is a company incorporated and domiciled in Kenya under the Companies Act, 2015\. Its principal activity is: Wholesale and retail trade in cement, timber and roofing sheets\.$/);
 assert.match(sec('POLICY_PPE').text,/Buildings 2\.5 per cent/);assert.equal(sec('POLICY_CASH'),undefined,'no cash note, so no cash policy');assert.match((await yr('MANAGER',{action:'ledger_wording_read'},['REVENUE','PPE','CASH'])).sections.find(s=>s.key==='POLICY_CASH').text,/mobile money balances/);assert.equal(sec('RELATED_PARTIES').text,'Nothing to report.');
 // an approved declaration changed later: the approval stands until the new one is approved, then the old one is superseded
 const ch=await yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'EVENTS_AFTER',state:'Text',body:'A customer account of KES 50,000 was written off after the year end.'});assert.equal(ch.version,2);
 y=await yr('MANAGER',{action:'ledger_wording_read'});assert.equal(y.complete,true,'the approved nothing-to-report still stands');assert.equal(y.disclosures.find(d=>d.code==='EVENTS_AFTER').state,'Waiting for approval');
 await yr('MANAGER',{action:'ledger_disclosure_review',disclosure_id:ch.disclosure_id,decision:'Approved'});
 y=await yr('MANAGER',{action:'ledger_wording_read'});assert.match(y.sections.find(s=>s.key==='EVENTS_AFTER').text,/written off/);
 await assert.rejects(()=>yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'EVENTS_AFTER',state:'Text',body:'A customer account of KES 50,000 was written off after the year end.'}),/already approved/);
 // a year with no stock and no revenue note needs neither fact
 const y2=await yr('MANAGER',{action:'ledger_wording_read'},['PPE']);assert.equal(y2.disclosures.length,7);assert.ok(!y2.disclosures.some(d=>d.code==='POLICY_REVENUE'));
 // order: a Manager or Partner only; each disclosure once
 await assert.rejects(()=>yr('ASSISTANT',{action:'ledger_disclosure_order',codes:['GOING_CONCERN']}),/Manager or Partner/);
 await assert.rejects(()=>yr('MANAGER',{action:'ledger_disclosure_order',codes:['GOING_CONCERN','GOING_CONCERN']}),/once/);
 await assert.rejects(()=>yr('MANAGER',{action:'ledger_disclosure_order',codes:['NOPE']}),/once/);
 await yr('MANAGER',{action:'ledger_disclosure_order',codes:['CONTINGENCIES','GOING_CONCERN','RELATED_PARTIES']});
 y=await yr('ASSISTANT',{action:'ledger_wording_read'});assert.deepEqual(y.order.slice(0,3),['CONTINGENCIES','GOING_CONCERN','RELATED_PARTIES']);assert.deepEqual(y.sections.filter(s=>s.kind==='disclosure').map(s=>s.key).slice(0,3),['CONTINGENCIES','GOING_CONCERN','RELATED_PARTIES']);assert.equal(y.complete,true,'order changes no wording');
 await yr('MANAGER',{action:'ledger_disclosure_order',codes:['GOING_CONCERN','CONTINGENCIES']});
 assert.deepEqual((await tx`select codes from erp_private.period_disclosure_order`)[0].codes,['GOING_CONCERN','CONTINGENCIES'],'one row per year, updated');
 // the database holds the same rules
 await assert.rejects(()=>tx`update erp_private.period_disclosures set body='Changed after approval, so this must fail.' where code='PRINCIPAL_ACTIVITY' and status='Approved'`,/cannot be edited/);
 await assert.rejects(()=>tx`delete from erp_private.period_disclosures`);
 await assert.rejects(()=>tx`insert into erp_private.period_disclosures(period_id,project_id,client_id,code,version,state,body,declared_by) values(${per.period_id},${P},${CL},'GOING_CONCERN',9,'Nothing to report',null,${actors.MANAGER.staff_id})`,/check|version/);
 await assert.rejects(()=>tx`insert into erp_private.period_disclosure_order(period_id,project_id,client_id,codes,updated_by) values(${per.period_id},${P},${CL},'{A,A}',${actors.MANAGER.staff_id}) on conflict (period_id) do update set codes=excluded.codes`);
 // an audit lock freezes the disclosures
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_audit_locks(period_id,project_id,client_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,report_reference,report_date,opinion,locked_by) values(${per.period_id},${P},${CL},'In-house audit',${id()},${'a'.repeat(64)},${'b'.repeat(64)},${id()},'Fictional report ref','2026-12-31','Unmodified',${actors.PARTNER.staff_id})`;
 await db.exec('set session_replication_role=origin');
 y=await yr('MANAGER',{action:'ledger_wording_read'});assert.equal(y.locked,true);assert.equal(y.can_declare,false);assert.equal(y.can_order,false);
 await assert.rejects(()=>yr('ASSISTANT',{action:'ledger_disclosure_declare',code:'COMMITMENTS',state:'Text',body:'A lease commitment of KES 120,000 a year for three years.'}),/locked by an audit/);
 await assert.rejects(()=>yr('MANAGER',{action:'ledger_disclosure_order',codes:['GOING_CONCERN']}),/locked by an audit/);
 await assert.rejects(()=>tx`insert into erp_private.period_disclosures(period_id,project_id,client_id,code,version,state,body,declared_by) values(${per.period_id},${P},${CL},'COMMITMENTS',2,'Text','A lease commitment of KES 120,000 a year.',${actors.ASSISTANT.staff_id})`,/locked by an audit/);
 assert.equal(await W.wordingAction(tx,actors.MANAGER,per,{action:'something_else'},stub(),'2026-12-31'),undefined);
 assert.equal(await W.wordingLibraryAction(tx,actors.MANAGER,{action:'something_else'}),undefined);
});
