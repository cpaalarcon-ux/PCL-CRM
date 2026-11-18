// Annual pack slice 3 through the real action: formatted statements from the trial balance, the approved statement-line map and the approved comparatives. Fictional data only.
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

test('formatted statements through the action: draft until comparatives are approved, then ready',async t=>{
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
 const setNoCf=await as('MANAGER',a=>A.comparativesSave(tx,a,per,{source_kind:'Signed prior-year financial statements',source_reference:'Fictional signed accounts for 2025, dated 14 March 2026',pl:PL,eq:EQ,cf:''}));
 // Build 2876: comparatives with no prior-year cash flow cannot be approved, so the statements stay a draft until it is derived from the two trial balances or entered from the signed statements
 await assert.rejects(()=>as('PARTNER2',a=>A.comparativesReview(tx,a,per,{set_id:setNoCf.set_id,decision:'Approved',review_note:'Fictional approved without a cash flow'},data)),/primary statement is missing/);
 s=await get('MANAGER');assert.equal(s.readiness.checks.find(c=>c.code==='COMPARATIVES').status,'Blocked');assert.equal(s.readiness.ready,false);assert.equal(s.status,'Draft - not ready');
 const set=await as('MANAGER',a=>A.comparativesSave(tx,a,per,{source_kind:'Signed prior-year financial statements',source_reference:'Fictional signed accounts for 2025, dated 14 March 2026',pl:PL,eq:EQ,cf:CF}));
 await as('PARTNER2',a=>A.comparativesReview(tx,a,per,{set_id:set.set_id,decision:'Approved',review_note:'Fictional agreed to signed accounts'},data));
 s=await get('MANAGER');
 const p=s.statements.profit_or_loss,f=s.statements.financial_position;
 assert.equal(p.has_prior,true);assert.equal(line(p,'Revenue').prior,1000000);assert.equal(line(p,'Profit for the year').prior,210000);assert.equal(line(p,'Profit for the year').current,300000);
 assert.equal(f.has_prior,true);assert.equal(line(f,'Total assets').prior,300000);assert.equal(line(f,'Total equity and liabilities').prior,300000);
 assert.deepEqual(s.statements.problems,[]);
 // Build 2873: everything else is in order, but the statements are not ready until a Partner has approved the notes
 assert.deepEqual(s.readiness.checks.filter(c=>c.status==='Blocked').map(c=>c.code),['NOTES_APPROVED','WORDING_COMPLETE']);assert.equal(s.readiness.ready,false);assert.equal(s.statements.notes.items.length>0,true);assert.deepEqual(s.statements.notes.problems,[]);
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
 s=await get('MANAGER');assert.equal(s.readiness.checks.find(c=>c.code==='NOTES_APPROVED').status,'Pass');assert.equal(s.readiness.ready,false,'the wording is still to be approved');assert.equal(s.readiness.checks.find(c=>c.code==='WORDING_COMPLETE').status,'Blocked');
 {const {approveWording}=await import('./helpers/wording_ready.mjs'),W=await import('../supabase/functions/staff-workspace-v12/wording-actions.ts');const w=await approveWording({tx,as,W,per,getStatements:nget,asOf:'2026-12-31'});assert.equal(w.complete,true,w.problems.join(' '));}
 s=await get('MANAGER');assert.equal(s.readiness.checks.find(c=>c.code==='WORDING_COMPLETE').status,'Pass');assert.equal(s.readiness.ready,true);assert.equal(s.status,'Ready for review');
 await assert.rejects(()=>nact('MANAGER',{action:'ledger_notes_prepare'}),/already approved/);
 // any change to a figure makes the approval stale: the pack is blocked again until the notes are prepared and approved again
 const changed={...data,tb:data.tb.map(r=>r.code==='10020'?{...r,movement_debit:r.movement_debit+1000,net:r.net+1000}:r)};
 const ngetChanged=()=>A.statementsFrom(tx,per,changed);
 nr=await as('PARTNER2',a=>NA.notesAction(tx,a,per,{action:'ledger_notes_read'},ngetChanged,'2026-12-31'));assert.equal(nr.state,'stale');assert.equal(nr.can_review,false);
 await assert.rejects(()=>as('PARTNER2',a=>NA.notesAction(tx,a,per,{action:'ledger_notes_review',set_id:n3.set_id,decision:'Approved'},ngetChanged,'2026-12-31')),/have changed/);
 // the database itself: an approved set cannot be edited or deleted, and only a Partner other than the preparer approves
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.period_note_sets set digest='x' where set_id=${n3.set_id}`),/./);
 await assert.rejects(()=>as('MANAGER',a=>tx`delete from erp_private.period_note_sets where set_id=${n3.set_id}`),/./);
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.period_note_sets set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now() where set_id=${n3.set_id}`),/./);
 const eq1=s.statements.changes_in_equity,cf1=s.statements.cash_flow;
 assert.equal(eq1.has_prior,true);assert.equal(eq1.prior.rows.find(r=>r.move==='DIVIDENDS_DRAWINGS').total,-60000);assert.equal(eq1.prior.rows.find(r=>r.move==='CLOSING').total,300000,'prior closing equals this year opening');assert.equal(eqRow(eq1,'OPENING').total,eq1.prior.rows.find(r=>r.move==='CLOSING').total);
 assert.equal(cf1.has_prior,true);assert.equal(cf1.reconciles,true);assert.equal(cf1.rows.find(r=>r.code==='CF.CASH_CLOSE').prior,120000);assert.equal(cf1.rows.find(r=>r.code==='CF.CASH_OPEN').current,cf1.rows.find(r=>r.code==='CF.CASH_CLOSE').prior,'prior closing cash is this year opening cash');
 assert.equal(s.reporting.rounding,'Whole shillings');assert.equal(s.reporting.edition,'Third Edition (2025)');

 // an account with a balance and no approved line stops the statements being complete, and the account is named
 const bad=await as('ASSISTANT',a=>A.statementsFrom(tx,per,{...data,tb:[...tb,row('99999','Fictional unmapped account',0,1000,0)]}));
 assert.equal(bad.status,'Draft - not ready');assert.match(bad.statements.problems.join(' '),/99999/);
 assert.equal(s.client.legal_form,'Company');assert.equal(s.readiness.checks.find(c=>c.code==='LEGAL_FORM').status,'Pass');assert.equal(s.readiness.checks.find(c=>c.code==='PARTNER_SHARES'),undefined);

 // Build 2870: a partnership gets partners' captions, and its profit shares are required before the statements can be final
 const CL2=id(),P2=id();
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL2},'Fictional Bahari Partners',${actors.MANAGER.staff_id},'Partnership')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL2},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${CL2},${F},'Fictional Bahari project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P2},${actors[role].staff_id},${F},${role==='PARTNER2'?'PARTNER':role})`;
 const per2=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P2},${CL2},${F},'2026-01-01','2026-12-31','Partnership','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 const ptb=[row('10020','Bank',0,0,0),row('15004','Equipment',180000,0,0),row('10000','Cash',120000,300000,0),row('35000','Partners capital',-300000,0,0),row(revenue,'Sales',0,0,500000),row(cos,'Cost',0,200000,0)];
 const pdata={as_of:'2026-12-31',tb:ptb.filter(r=>r.code!=='10020'),issues:[],prior_year:{source:'Opening balances'}};
 const ps=await as('MANAGER',a=>A.statementsFrom(tx,per2,pdata));
 assert.equal(ps.client.legal_form,'Partnership');assert.equal(ps.statements.changes_in_equity.title,"Statement of changes in partners' equity");
 assert.equal(ps.statements.financial_position.rows.find(r=>r.code==='SFP.OWNER_CAP')?.label,"Partners' capital accounts");
 assert.equal(ps.readiness.checks.find(c=>c.code==='PARTNER_SHARES').status,'Blocked');assert.equal(ps.readiness.checks.find(c=>c.code==='LEGAL_FORM').status,'Pass');
 // a company account on a partnership is reported on the statements and in the readiness list
 const mix=await as('MANAGER',a=>A.statementsFrom(tx,per2,{...pdata,tb:[...pdata.tb,row('30000','Share capital',-1000,0,0),row('10000','Cash',1000,0,0)].filter((r,i,arr)=>arr.findIndex(x=>x.code===r.code)===i)}));
 assert.match(mix.statements.problems.join(' '),/Share capital is a company account/);assert.equal(mix.readiness.checks.find(c=>c.code==='LEGAL_FORM').status,'Blocked');

 // Build 2872: the partners' profit shares are recorded from the deed, a different Partner approves them, and only then is profit allocated
 const PS=await import('../supabase/functions/staff-workspace-v12/partner-shares-actions.ts');
 const save=(role,body,l=per2)=>as(role,a=>PS.partnerSharesAction(tx,a,l,{action:'ledger_partner_shares_save',ratio_only:true,source_reference:'Partnership deed dated 3 March 2020',...body}));
 const review=(role,body,l=per2)=>as(role,a=>PS.partnerSharesAction(tx,a,l,{action:'ledger_partner_shares_review',...body}));
 const read=(role,l=per2)=>as(role,a=>PS.partnerSharesAction(tx,a,l,{action:'ledger_partner_shares_read'}));
 assert.match(ps.statements.problems.join(' '),/profit shares are not recorded/);assert.equal(ps.statements.partner_allocation,undefined);
 const two=[{partner_name:'Fictional A Bahari',share_percent:'60'},{partner_name:'Fictional B Mwangi',share_percent:'40'}];
 await assert.rejects(()=>save('ASSISTANT',{partners:two}),/Manager or Partner/);
 await assert.rejects(()=>save('MANAGER',{partners:two,ratio_only:false}),/no partner salary or interest/);
 await assert.rejects(()=>save('MANAGER',{partners:[two[0]]}),/at least 2 partners/);
 await assert.rejects(()=>save('MANAGER',{partners:[two[0],{partner_name:'Fictional B Mwangi',share_percent:'30'}]}),/add to 90%, not 100%/);
 await assert.rejects(()=>save('MANAGER',{partners:two,source_reference:'deed'}),/partnership deed/i);
 await assert.rejects(()=>save('MANAGER',{partners:two},per),/partnership only/);
 const v1=await save('MANAGER',{partners:two});assert.equal(v1.version,1);assert.equal(v1.partners,2);
 let r=await read('MANAGER');assert.equal(r.eligible,true);assert.equal(r.draft.lines.length,2);assert.equal(r.approved,null);assert.equal(r.can_review,false);
 let st=await as('MANAGER',a=>A.statementsFrom(tx,per2,pdata));
 assert.equal(st.readiness.checks.find(c=>c.code==='PARTNER_SHARES').status,'Blocked');assert.match(st.readiness.checks.find(c=>c.code==='PARTNER_SHARES').detail,/wait for a Partner/);assert.equal(st.statements.partner_allocation,undefined);
 await assert.rejects(()=>review('MANAGER',{set_id:v1.set_id,decision:'Approved'}),/Only a Partner/);
 await assert.rejects(()=>review('PARTNER2',{set_id:v1.set_id,decision:'Returned',review_note:'no'}),/at least 10/);
 // a different Partner approves; the profit (300,000) is shared 60 / 40 to the shilling
 const ok=await review('PARTNER2',{set_id:v1.set_id,decision:'Approved'});assert.equal(ok.status,'Approved');assert.equal(ok.sole_partner_approval,false);
 st=await as('MANAGER',a=>A.statementsFrom(tx,per2,pdata));
 assert.equal(st.readiness.checks.find(c=>c.code==='PARTNER_SHARES').status,'Pass');
 assert.deepEqual(st.statements.partner_allocation.rows.map(x=>[x.partner_name,x.percent,x.amount]),[['Fictional A Bahari','60%',180000],['Fictional B Mwangi','40%',120000]]);
 assert.equal(st.statements.partner_allocation.total,300000);assert.equal(st.statements.partner_allocation.profit,300000);
 // a new version replaces the approved one only once approved; a Partner cannot approve what they recorded unless they are the only Partner
 const v2=await save('PARTNER',{partners:[{partner_name:'Fictional A Bahari',share_percent:'50'},{partner_name:'Fictional B Mwangi',share_percent:'50'}]});
 await assert.rejects(()=>review('PARTNER',{set_id:v2.set_id,decision:'Approved',sole_partner_approval:true}),/different Partner|only Partner/);
 await assert.rejects(()=>review('PARTNER',{set_id:v2.set_id,decision:'Approved'}),/different Partner approves/);
 r=await read('PARTNER2');assert.equal(r.approved.version,1);assert.equal(r.draft.version,2);assert.equal(r.can_review,true);
 assert.equal((await review('PARTNER2',{set_id:v2.set_id,decision:'Approved'})).version,2);
 r=await read('MANAGER');assert.equal(r.approved.version,2);assert.deepEqual(r.history.map(h=>h.status),['Approved','Superseded']);
 // the firm's only active Partner may approve what they recorded, and it is recorded that way
 const v3=await save('PARTNER',{partners:[{partner_name:'Fictional A Bahari',share_percent:'70'},{partner_name:'Fictional B Mwangi',share_percent:'30'}]});
 await tx`update erp_private.staff_members set access_status='Inactive' where staff_id=${actors.PARTNER2.staff_id}`;
 await assert.rejects(()=>review('PARTNER',{set_id:v3.set_id,decision:'Approved'}),/different Partner approves/);
 const sole=await review('PARTNER',{set_id:v3.set_id,decision:'Approved',sole_partner_approval:true});assert.equal(sole.sole_partner_approval,true);
 await tx`update erp_private.staff_members set access_status='Active' where staff_id=${actors.PARTNER2.staff_id}`;
 r=await read('MANAGER');assert.equal(r.approved.version,3);assert.equal(r.approved.sole_partner_approval,true);
 // the database itself refuses what the action would: shares that do not add to 100%, edits, and deletes
 const off=(await as('MANAGER',a=>tx`insert into erp_private.period_partner_share_sets(period_id,project_id,client_id,version,source_reference,ratio_only,entered_by) values(${per2.period_id},${P2},${CL2},4,'Partnership deed dated 3 March 2020',true,${a.staff_id}) returning set_id`))[0];
 await as('MANAGER',a=>tx`insert into erp_private.period_partner_share_lines(set_id,project_id,partner_name,share_bp) values(${off.set_id},${P2},'Fictional A Bahari',5000),(${off.set_id},${P2},'Fictional B Mwangi',4000)`);
 await assert.rejects(()=>as('PARTNER2',a=>tx`update erp_private.period_partner_share_sets set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now() where set_id=${off.set_id}`),/exactly 100 per cent/);
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.period_partner_share_sets set ratio_only=false where set_id=${off.set_id}`),/./);
 await assert.rejects(()=>as('MANAGER',a=>tx`delete from erp_private.period_partner_share_lines where set_id=${off.set_id}`),/./);
});
