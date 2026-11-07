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
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
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
 assert.deepEqual(s.statements.problems,[]);assert.equal(s.readiness.ready,true);assert.equal(s.status,'Ready for review');
 const eq1=s.statements.changes_in_equity,cf1=s.statements.cash_flow;
 assert.equal(eq1.has_prior,true);assert.equal(eq1.prior.rows.find(r=>r.move==='DIVIDENDS_DRAWINGS').total,-60000);assert.equal(eq1.prior.rows.find(r=>r.move==='CLOSING').total,300000,'prior closing equals this year opening');assert.equal(eqRow(eq1,'OPENING').total,eq1.prior.rows.find(r=>r.move==='CLOSING').total);
 assert.equal(cf1.has_prior,true);assert.equal(cf1.reconciles,true);assert.equal(cf1.rows.find(r=>r.code==='CF.CASH_CLOSE').prior,120000);assert.equal(cf1.rows.find(r=>r.code==='CF.CASH_OPEN').current,cf1.rows.find(r=>r.code==='CF.CASH_CLOSE').prior,'prior closing cash is this year opening cash');
 assert.equal(s.reporting.rounding,'Whole shillings');assert.equal(s.reporting.edition,'Third Edition (2025)');

 // an account with a balance and no approved line stops the statements being complete, and the account is named
 const bad=await as('ASSISTANT',a=>A.statementsFrom(tx,per,{...data,tb:[...tb,row('99999','Fictional unmapped account',0,1000,0)]}));
 assert.equal(bad.status,'Draft - not ready');assert.match(bad.statements.problems.join(' '),/99999/);
});
