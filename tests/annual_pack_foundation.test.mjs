// Annual pack slice 1: statement-line map, reporting framework and edition, and the readiness gate.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const R=await import('../supabase/functions/staff-workspace-v12/annual-pack-rules.mjs');
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const root=path.resolve(import.meta.dirname,'..');

// ---- pure rules ----
test('default reporting is the 2025 Third Edition, KES, indirect cash flow; early application is flagged before 2027',()=>{
 const early=R.defaultReporting('2026-01-01'),late=R.defaultReporting('2027-01-01');
 assert.equal(early.edition,'Third Edition (2025)');assert.equal(early.presentation_currency,'KES');assert.equal(early.cash_flow_method,'Indirect');
 assert(early.early_application_note.length>=10);assert.equal(late.early_application_note,'');
 assert.deepEqual(R.validateReporting(early,'2026-01-01'),[]);assert.deepEqual(R.validateReporting(late,'2027-01-01'),[]);
});
test('edition rules: Second Edition ends for years beginning 1 Jan 2027; early application needs a note; indirect only',()=>{
 const base=R.defaultReporting('2026-01-01');
 assert(R.validateReporting({...base,edition:'Second Edition (2015, amended 2022)',early_application_note:''},'2027-01-01').some(x=>/Second Edition/.test(x)));
 assert.deepEqual(R.validateReporting({...base,edition:'Second Edition (2015, amended 2022)',early_application_note:''},'2026-01-01'),[]);
 assert(R.validateReporting({...base,early_application_note:''},'2026-12-31').some(x=>/early application/i.test(x)));
 assert(R.validateReporting({...base,cash_flow_method:'Direct'},'2026-01-01').some(x=>/indirect/i.test(x)));
 assert(R.validateReporting({...base,framework:'IFRS Accounting Standards'},'2026-01-01').some(x=>/does not belong/.test(x)));
 assert(R.validateReporting(null,'2026-01-01')[0].includes('No reporting framework'));
});
const lines=[{line_code:'SFP.CASH',statement:'Financial position'},{line_code:'SFP.SHARE_CAP',statement:'Financial position'},{line_code:'PL.REVENUE',statement:'Profit or loss'},{line_code:'PL.UNRESOLVED',statement:'Profit or loss'},{line_code:'EXCL.LEGACY',statement:'Excluded'}];
const ap=(code,line,status='Approved',from='2025-01-01')=>({account_code:code,line_code:line,status,effective_from:from,effective_to:null});
const tb=(code,net,name='x')=>({code,name,opening:0,movement_debit:net>0?net:0,movement_credit:net<0?-net:0,net});
const period={starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'};
const good={period,reporting:R.defaultReporting('2026-01-01'),tb:[tb('10020',100),tb('30000',-100)],maps:[ap('10020','SFP.CASH'),ap('30000','SFP.SHARE_CAP')],lines,issues:[],prior:{source:'Prior-year ledger'},priorPeriodExists:true};
test('readiness passes only when every check passes',()=>{
 const g=R.packReadiness(good);assert.equal(g.ready,true,JSON.stringify(g.checks.filter(c=>c.status==='Blocked')));assert.equal(g.status,'Ready for review');
});
test('Not ready: missing reporting basis, unmapped, draft-only, legacy, unresolved, unbalanced, ledger issues',()=>{
 assert.equal(R.packReadiness({...good,reporting:null}).ready,false);
 const miss=R.packReadiness({...good,maps:[ap('10020','SFP.CASH')]});assert.equal(miss.ready,false);assert(/30000/.test(miss.checks.find(c=>c.code==='MAP_APPROVED').detail));
 const draft=R.packReadiness({...good,maps:[ap('10020','SFP.CASH'),ap('30000','SFP.SHARE_CAP','Draft')]});assert(/Partner approval/.test(draft.checks.find(c=>c.code==='MAP_APPROVED').detail));
 const leg=R.packReadiness({...good,tb:[tb('10020',100),tb('11000',5),tb('30000',-105)],maps:[...good.maps,ap('11000','EXCL.LEGACY')]});assert.equal(leg.checks.find(c=>c.code==='NO_LEGACY').status,'Blocked');
 const unr=R.packReadiness({...good,tb:[tb('10020',100),tb('69900',7),tb('30000',-107)],maps:[...good.maps,ap('69900','PL.UNRESOLVED')]});assert.equal(unr.checks.find(c=>c.code==='NO_UNRESOLVED').status,'Blocked');
 const unb=R.packReadiness({...good,tb:[tb('10020',100),tb('30000',-90)]});assert.equal(unb.checks.find(c=>c.code==='TB_BALANCED').status,'Blocked');
 const iss=R.packReadiness({...good,issues:['2 journals await review']});assert.equal(iss.checks.find(c=>c.code==='LEDGER_REVIEW').status,'Blocked');
 assert(/^Not ready:/.test(iss.summary));
});
test('a mapping is judged on the date in force: a line starting after year end does not count',()=>{
 const late=R.packReadiness({...good,maps:[ap('10020','SFP.CASH','Approved','2027-01-01'),ap('30000','SFP.SHARE_CAP')]});assert.equal(late.checks.find(c=>c.code==='MAP_APPROVED').status,'Blocked');
 const ended=R.mapInForce([{...ap('10020','SFP.CASH'),effective_to:'2026-06-30'}],'10020','2026-12-31');assert.equal(ended,null);
});
test('comparatives: prior ledger required when chosen; first-period only when no prior year exists',()=>{
 const noPrior=R.packReadiness({...good,prior:{source:'Opening balances'}});assert.equal(noPrior.checks.find(c=>c.code==='COMPARATIVES').status,'Blocked');
 const first=R.packReadiness({...good,reporting:{...good.reporting,comparatives_basis:'First period - none'},prior:{source:'Opening balances'},priorPeriodExists:false});assert.equal(first.checks.find(c=>c.code==='COMPARATIVES').status,'Pass');
 const hidden=R.packReadiness({...good,reporting:{...good.reporting,comparatives_basis:'First period - none'},priorPeriodExists:true});assert.equal(hidden.checks.find(c=>c.code==='COMPARATIVES').status,'Blocked');
});

// ---- database ----
async function boot(t){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 return db;
}
test('every account in the chart is seeded onto a statement line, and the line agrees with the account',async t=>{
 const db=await boot(t);
 const un=(await db.query(`select c.code,c.name from erp_private.account_catalog c where not exists(select 1 from erp_private.account_statement_map m where m.account_code=c.code) order by 1`)).rows;
 assert.deepEqual(un,[],'unmapped accounts: '+JSON.stringify(un));
 const bad=(await db.query(`select c.code,c.name,c.statement,c.category_code,l.line_code,l.statement lstmt from erp_private.account_catalog c join erp_private.account_statement_map m on m.account_code=c.code join erp_private.statement_lines l using(line_code)
   where not c.is_legacy and l.statement<>'Excluded' and ((c.statement='Statement of financial position' and l.statement<>'Financial position') or (c.statement='Profit or loss' and l.statement<>'Profit or loss'))`)).rows;
 assert.deepEqual(bad,[],'statement disagrees: '+JSON.stringify(bad));
 const kinds=(await db.query(`select c.code,c.category_code,l.section from erp_private.account_catalog c join erp_private.account_statement_map m on m.account_code=c.code join erp_private.statement_lines l using(line_code) where not c.is_legacy and l.statement='Financial position'`)).rows;
 const wrong=kinds.filter(k=>(k.category_code==='ASSET'&&!/assets$/i.test(k.section))||(k.category_code==='LIAB'&&!/liabilities$/i.test(k.section))||(k.category_code==='EQUITY'&&k.section!=='Equity'));
 assert.deepEqual(wrong,[],'type/section mismatch: '+JSON.stringify(wrong));
 const legacy=(await db.query(`select c.code from erp_private.account_catalog c join erp_private.account_statement_map m on m.account_code=c.code where m.line_code='EXCL.LEGACY' order by 1`)).rows.map(r=>r.code);
 for(const c of ['11000','12000','13000','14000','21100','22000'])assert(legacy.includes(c),c+' must sit on the excluded legacy line');
 const spot={'10020':'SFP.CASH','15900':'SFP.PPE','15960':'SFP.ROU','21600':'SFP.PAYROLL_PAY','69930':'PL.UNRESOLVED','34320':'SFP.HEAD_OFFICE','36020':'SFP.DRAWINGS','35010':'SFP.DRAWINGS','62500':'PL.OTHER_OPEX','61300':'PL.PROGRAMME','40080':'PL.FIN_INCOME','40440':'PL.GRANTS','34310':'SFP.FUND_RESTR','20080':'SFP.OVERDRAFT'};
 for(const [code,line] of Object.entries(spot))assert.equal((await db.query(`select line_code from erp_private.account_statement_map where account_code=$1`,[code])).rows[0]?.line_code,line,code);
});
test('every seeded row starts as a Draft with no proposer; nothing is Approved without a Partner',async t=>{
 const db=await boot(t);
 const r=(await db.query(`select status,count(*)::int n,count(*) filter(where proposed_by is null)::int seeded from erp_private.account_statement_map group by 1`)).rows;
 assert.deepEqual(r.map(x=>x.status),['Draft']);assert.equal(r[0].n,r[0].seeded);
 const lines=(await db.query(`select count(*)::int n from erp_private.statement_lines`)).rows[0].n;assert(lines>40);
});
test('the map guard: one draft per account, review only once, no edits, no deletes',async t=>{
 const db=await boot(t);
 await assert.rejects(()=>db.query(`insert into erp_private.account_statement_map(account_code,line_code,effective_from,reason) values('10020','SFP.CASH','2026-01-01','duplicate draft')`),/duplicate|unique/i);
 await assert.rejects(()=>db.query(`update erp_private.account_statement_map set line_code='SFP.INV' where account_code='10020'`),/cannot be edited/);
 await assert.rejects(()=>db.query(`delete from erp_private.account_statement_map where account_code='10020'`),/delet/i);
 await assert.rejects(()=>db.query(`update erp_private.account_statement_map set status='Rejected',reviewed_at=now(),reviewed_by=null,review_note='short' where account_code='10020'`),/reviewer|reason/i);
});
test('reporting table: edition and early-application rules are enforced by the database too',async t=>{
 const db=await boot(t);
 const src=fs.readFileSync(root+'/supabase/migrations/'+fs.readdirSync(root+'/supabase/migrations').find(f=>/annual_pack_foundation/.test(f)),'utf8');
 assert(src.includes("'2027-01-01'")&&src.includes('early application'));
 assert(!/\d\s*%/.test(src.replace(/--[^\n]*/g,'')),'no tax rate stored');
 const cols=(await db.query(`select column_name from information_schema.columns where table_schema='erp_private' and table_name='ledger_period_reporting'`)).rows.map(r=>r.column_name);
 for(const c of ['framework','edition','early_application_note','presentation_currency','comparatives_basis','cash_flow_method'])assert(cols.includes(c),c);
 const def=(await db.query(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid='erp_private.ledger_period_reporting'::regclass and contype='c'`)).rows.map(r=>r.d).join(' ');
 assert(/cash_flow_method = 'Indirect'/.test(def),'only the indirect method is allowed');
});
