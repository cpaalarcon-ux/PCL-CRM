// Annual pack step 2: prior-year comparatives for a first ERP year - parsing, reconciliation, maker-checker, versions, readiness.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const C=await import('../supabase/functions/staff-workspace-v12/annual-pack-comparatives.mjs');
const R=await import('../supabase/functions/staff-workspace-v12/annual-pack-rules.mjs');
const A=await import('../supabase/functions/staff-workspace-v12/annual-pack.ts');
const root=path.resolve(import.meta.dirname,'..');

const defs=[['PL.REVENUE','Profit or loss','Revenue','Credit'],['PL.COST_SALES','Profit or loss','Cost of sales','Debit'],['PL.STAFF','Profit or loss','Operating costs','Debit'],['PL.OTHER_OPEX','Profit or loss','Operating costs','Debit'],['PL.TAX','Profit or loss','Tax','Debit'],['PL.UNRESOLVED','Profit or loss','Unresolved','Debit'],
 ['SFP.SHARE_CAP','Financial position','Equity','Credit'],['SFP.RETAINED','Financial position','Equity','Credit'],['SFP.CASH','Financial position','Current assets','Debit'],['SFP.OVERDRAFT','Financial position','Current liabilities','Credit'],['SFP.PPE','Financial position','Non-current assets','Debit']].map(([line_code,statement,section,normal_side])=>({line_code,statement,section,normal_side,label:line_code}));
const PL='PL.REVENUE\t1,000,000\nPL.COST_SALES\t400,000\nPL.STAFF\t200,000\nPL.OTHER_OPEX\t100,000\nPL.TAX\t90,000';
const EQ='SFP.SHARE_CAP, OPENING, 100,000\nSFP.RETAINED, OPENING, 50,000\nSFP.RETAINED, PROFIT, 210,000\nSFP.RETAINED, DIVIDENDS_DRAWINGS, (60,000)';
const CF='CF.PBT\t300,000\nCF.DEPREC\t20,000\nCF.WC_REC\t(30,000)\nCF.TAX_PAID\t(80,000)\nCF.PPE_PURCHASE\t(50,000)\nCF.DIVIDENDS_PAID\t(60,000)\nCF.CASH_OPEN\t20,000\nCF.CASH_CLOSE\t120,000';
const parse=(pl=PL,eq=EQ,cf=CF)=>[...C.parseComparativeText('Profit or loss',pl).rows,...C.parseComparativeText('Changes in equity',eq).rows,...C.parseComparativeText('Cash flow',cf).rows];
const opening=[{line_code:'SFP.SHARE_CAP',net:-100000},{line_code:'SFP.RETAINED',net:-200000},{line_code:'SFP.CASH',net:120000},{line_code:'SFP.PPE',net:180000}];

test('amounts and rows parse from typed or pasted text',()=>{
 assert.equal(C.parseAmount('(1,234.50)'),-1234.5);assert.equal(C.parseAmount('KES 1 234'),1234);assert.equal(C.parseAmount('12.345'),null);assert.equal(C.parseAmount(''),null);
 const p=C.parseComparativeText('Profit or loss',PL);assert.equal(p.errors.length,0);assert.equal(p.rows.length,5);assert.equal(p.rows[0].amount,1000000);
 assert.equal(C.parseComparativeText('Changes in equity','SFP.RETAINED OTHER x').errors.length,1);
 assert(C.parseComparativeText('Changes in equity','SFP.RETAINED, NOTAMOVE, 5').errors[0].includes('movement'));
 const back=C.formatComparativeText('Profit or loss',parse());assert.equal(C.parseComparativeText('Profit or loss',back).rows.length,5);
});
test('a complete, consistent set reconciles to the opening balances',()=>{
 const r=C.reconcileComparatives({lines:parse(),lineDefs:defs,opening});assert.deepEqual(r.problems,[]);assert.equal(r.ok,true);assert.equal(r.figures.profit,210000);assert.equal(r.figures.profit_before_tax,300000);
});
test('each reconciliation fails on its own and names the difference',()=>{
 const run=(over)=>C.reconcileComparatives({lines:parse(...over),lineDefs:defs,opening});
 assert(run([PL,EQ.replace('210,000','200,000'),CF]).problems.some(p=>/Profit or loss for the year in changes in equity/.test(p)));
 assert(run([PL,EQ.replace('(60,000)','(50,000)'),CF]).problems.some(p=>/closing equity/.test(p)));
 assert(run([PL,EQ,CF.replace('CF.CASH_CLOSE\t120,000','CF.CASH_CLOSE\t110,000')]).problems.some(p=>/does not equal cash at the end|differs from cash/.test(p)));
 assert(run([PL,EQ,CF.replace('CF.PBT\t300,000','CF.PBT\t310,000').replace('CF.CASH_CLOSE\t120,000','CF.CASH_CLOSE\t130,000')]).problems.some(p=>/Profit before tax in the cash flow/.test(p)));
 assert(run([PL,EQ.split('\n').slice(1).join('\n'),CF]).problems.length>0);
 assert(run(['PL.UNRESOLVED\t5\n'+PL,EQ,CF]).problems.some(p=>/not a profit or loss line/.test(p)));
 assert(run([PL+'\nPL.REVENUE\t1',EQ,CF]).problems.some(p=>/twice/.test(p)));
 const missing=C.reconcileComparatives({lines:parse(PL,'',''),lineDefs:defs,opening});assert.equal(missing.ok,false);assert.equal(missing.present.eq,false);
 const noCash=C.reconcileComparatives({lines:parse(PL,EQ,'CF.PBT\t300,000'),lineDefs:defs,opening});assert(noCash.problems.some(p=>/needs/.test(p)));
});
test('overdraft counts against cash in the opening balances',()=>{
 const r=C.reconcileComparatives({lines:parse(),lineDefs:defs,opening:[...opening,{line_code:'SFP.OVERDRAFT',net:-10000}]});assert(r.problems.some(p=>/cash less overdraft/.test(p)));
});
test('comparatives status names every missing statement and passes only when all four are present',()=>{
 const base={basis:'Approved opening balances',prior:{source:'Opening balances'},priorPeriodExists:false};
 const none=C.comparativesStatus({...base,approved:null,draft:null,recon:null});assert.equal(none.pass,false);assert(/profit or loss, changes in equity, cash flow/.test(none.detail));
 const waiting=C.comparativesStatus({...base,approved:null,draft:{},recon:null});assert(waiting.statements.some(s=>s.state==='Waiting for Partner approval'));
 const recon=C.reconcileComparatives({lines:parse(),lineDefs:defs,opening});
 const done=C.comparativesStatus({...base,approved:{},draft:null,recon});assert.equal(done.pass,true);
 const partial=C.comparativesStatus({...base,approved:{},draft:null,recon:C.reconcileComparatives({lines:parse(PL,'',''),lineDefs:defs,opening})});assert.equal(partial.pass,false);
 assert.equal(C.comparativesStatus({basis:'Approved opening balances',prior:{source:'Prior-year ledger'},priorPeriodExists:true}).pass,false);
 assert.equal(C.comparativesStatus({basis:'Prior year ledger',prior:{source:'Prior-year ledger'},priorPeriodExists:true}).pass,true);
});

// ---- database and actions ----
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('comparatives through the actions: roles, versions, maker-checker, reconciliation gate, readiness',async t=>{
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
 const tb=[{code:'30000',opening:-100000},{code:'31000',opening:-200000},{code:'10020',opening:120000},{code:'15004',opening:180000}].map(r=>({...r,name:'x',movement_debit:0,movement_credit:0,net:r.opening}));
 const data={as_of:'2026-12-31',tb,issues:[],prior_year:{source:'Opening balances'}};
 const save=(role,over={})=>as(role,a=>A.comparativesSave(tx,a,per,{source_kind:'Signed prior-year financial statements',source_reference:'Fictional signed accounts for 2025, dated 14 March 2026',pl:PL,eq:EQ,cf:CF,...over}));
 const review=(role,p)=>as(role,a=>A.comparativesReview(tx,a,per,p,data));
 const read=role=>as(role,a=>A.comparativesRead(tx,a,per,data));

 await assert.rejects(()=>save('ASSISTANT'),/Manager or Partner/);
 await assert.rejects(()=>save('MANAGER',{source_reference:'short'}),/at least 10/);
 await assert.rejects(()=>save('MANAGER',{pl:'PL.REVENUE\tabc'}),/not an amount/);
 await assert.rejects(()=>save('MANAGER',{pl:'PL.UNRESOLVED\t5'}),/not a profit or loss line/);
 const v1=await save('MANAGER');assert.equal(v1.version,1);assert.equal(v1.lines,17);
 let r=await read('ASSISTANT');assert.equal(r.draft.recon.ok,true);assert.equal(r.approved,null);assert(r.texts.pl.includes('PL.REVENUE'));
 assert.equal(r.prior_ledger.can_build,false);// assistants cannot build; the offer is for leaders
 r=await read('MANAGER');assert.equal(r.prior_ledger.prior_year_end,'2025-12-31');assert.equal(r.prior_ledger.prior_year_start,'2025-01-01');assert.equal(r.prior_ledger.can_build,true);

 // readiness before approval names what is waiting; after approval it passes
 const reporting={framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',presentation_currency:'KES',rounding:'Whole shillings',comparatives_basis:'Approved opening balances',early_application_note:'Fictional early application note for the year'};
 await as('MANAGER',a=>A.reportingSave(tx,a,per,reporting));
 let ready=await as('MANAGER',()=>A.packReadinessFrom(tx,per,data));const cmp=()=>ready.checks.find(c=>c.code==='COMPARATIVES');
 assert.equal(cmp().status,'Blocked');assert(ready.comparatives.statements.some(s=>s.state==='Waiting for Partner approval'));
 await assert.rejects(()=>review('MANAGER',{set_id:v1.set_id,decision:'Approved'}),/Only a Partner/);
 // maker-checker: a Partner cannot approve what they entered themselves
 const own=await save('PARTNER');assert.equal(own.version,2);
 assert.equal((await tx`select status from erp_private.period_comparative_sets where set_id=${v1.set_id}`)[0].status,'Superseded');
 await assert.rejects(()=>review('PARTNER',{set_id:own.set_id,decision:'Approved'}),/other than the person who entered/);
 await assert.rejects(()=>review('PARTNER2',{set_id:v1.set_id,decision:'Approved'}),/changed/);
 // an unreconciled set cannot be approved
 const bad=await save('MANAGER',{eq:EQ.replace('210,000','200,000')});
 await assert.rejects(()=>review('PARTNER2',{set_id:bad.set_id,decision:'Approved'}),/do not reconcile/);
 await assert.rejects(()=>review('PARTNER2',{set_id:bad.set_id,decision:'Returned',review_note:'short'}),/at least 10/);
 await review('PARTNER2',{set_id:bad.set_id,decision:'Returned',review_note:'Fictional: profit does not agree to the profit and loss'});
 const good=await save('MANAGER');const ok=await review('PARTNER2',{set_id:good.set_id,decision:'Approved',review_note:'Fictional agreed to signed accounts'});assert.equal(ok.status,'Approved');
 ready=await as('MANAGER',()=>A.packReadinessFrom(tx,per,data));assert.equal(cmp().status,'Pass',cmp().detail);
 // a newer approved version replaces it; the old one stays on record
 const v5=await save('MANAGER',{source_reference:'Fictional re-issued accounts dated 2 April 2026'});await review('PARTNER2',{set_id:v5.set_id,decision:'Approved'});
 const st=(await tx`select version,status from erp_private.period_comparative_sets order by version`).map(x=>x.version+':'+x.status);
 assert.deepEqual(st,['1:Superseded','2:Superseded','3:Returned','4:Superseded','5:Approved']);
 // if the opening balances change so the set no longer reconciles, readiness blocks again
 ready=await as('MANAGER',()=>A.packReadinessFrom(tx,per,{...data,tb:tb.map(r=>r.code==='31000'?{...r,opening:-250000,net:-250000}:r)}));assert.equal(cmp().status,'Blocked');assert(/closing equity/.test(cmp().detail));

 // versions and lines are never edited or deleted
 await assert.rejects(()=>db.query(`update erp_private.period_comparative_lines set amount=1`),/immutable|cannot|audit/i);
 await assert.rejects(()=>db.query(`delete from erp_private.period_comparative_lines`),/delet/i);
 await assert.rejects(()=>db.query(`update erp_private.period_comparative_sets set source_reference='Edited after approval text' where status='Approved'`),/cannot be edited/);
 await assert.rejects(()=>db.query(`update erp_private.period_comparative_sets set status='Draft' where status='Approved'`),/superseded/i);
 await assert.rejects(()=>as('MANAGER',a=>A.comparativesReview(tx,a,per,{set_id:v5.set_id,decision:'Approved'},data)),/Only a Partner/);
 const src=fs.readFileSync(root+'/supabase/migrations/'+fs.readdirSync(root+'/supabase/migrations').find(f=>/period_comparatives/.test(f)),'utf8');
 assert(!/\d\s*%/.test(src.replace(/--[^\n]*/g,'')),'no tax rate stored');
});
