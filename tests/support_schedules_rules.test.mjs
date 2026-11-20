import test from 'node:test';import assert from 'node:assert/strict';
import {buildStatements} from '../supabase/functions/staff-workspace-v12/annual-pack-statements.mjs';
import {buildNotes,canonicalNotes} from '../supabase/functions/staff-workspace-v12/annual-pack-notes.mjs';
import {packReadiness} from '../supabase/functions/staff-workspace-v12/annual-pack-rules.mjs';
import {annualGate} from '../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs';
import {KINDS,validateSchedule,tieOut,buildSupport,scheduleReadiness,schedulesCheck,kindForRef} from '../supabase/functions/staff-workspace-v12/annual-pack-schedules.mjs';
// Fictional figures only.
const L=(line_code,statement,section,label,sort_order,normal_side,note_ref=null)=>({line_code,statement,section,label,sort_order,normal_side,note_ref});
const lineDefs=[
 L('SFP.PPE','Financial position','Non-current assets','Property, plant and equipment',100,'Debit','PPE'),
 L('SFP.INVENTORY','Financial position','Current assets','Inventories',210,'Debit','INV'),
 L('SFP.TRADE_REC','Financial position','Current assets','Trade receivables',220,'Debit','REC'),
 L('SFP.CASH','Financial position','Current assets','Cash and cash equivalents',270,'Debit','CASH'),
 L('SFP.SHARE_CAP','Financial position','Equity','Share capital',300,'Credit','EQUITY'),
 L('SFP.RETAINED','Financial position','Equity','Retained earnings',370,'Credit',null),
 L('SFP.TRADE_PAY','Financial position','Current liabilities','Trade payables',500,'Credit','PAY'),
 L('PL.REVENUE','Profit or loss','Revenue','Revenue',1000,'Credit','REVENUE'),
 L('PL.COST_SALES','Profit or loss','Cost of sales','Cost of sales',1100,'Debit',null),
 L('PL.STAFF','Profit or loss','Operating costs','Staff costs',1300,'Debit','STAFF')
];
const map=(account_code,line_code)=>({account_code,line_code,effective_from:'2020-01-01',effective_to:null,status:'Approved'});
const maps=[map('10000','SFP.CASH'),map('10010','SFP.CASH'),map('10060','SFP.TRADE_REC'),map('10070','SFP.TRADE_REC'),map('10100','SFP.INVENTORY'),map('15005','SFP.PPE'),map('20000','SFP.TRADE_PAY'),map('30000','SFP.SHARE_CAP'),map('31000','SFP.RETAINED'),map('40000','PL.REVENUE'),map('50000','PL.COST_SALES'),map('60000','PL.STAFF')];
const bs=(code,net)=>({code,name:'A'+code,opening:net,movement_debit:0,movement_credit:0,net});
const pl=(code,debit,credit)=>({code,name:'A'+code,opening:0,movement_debit:debit,movement_credit:credit,net:debit-credit});
const tb=()=>[bs('10000',400000),bs('10010',100000.5),bs('10060',320000),bs('10070',-20000),bs('10100',250000),bs('15005',700000),bs('20000',-130000),bs('30000',-100000),bs('31000',-1520000.5),pl('40000',0,1000000),pl('50000',400000,0),pl('60000',150000,0)];
const build=(schedules=null,t=tb())=>{const s=buildStatements({lineDefs,maps,tb:t,startsOn:'2026-01-01',endsOn:'2026-12-31'});return buildNotes({statements:s,lineDefs,tb:t,maps,asOf:'2026-12-31',schedules});};
const sched=(lines,over={})=>({version:1,evidence:'Fictional count sheet at 31 December',lines,declared_name:'A',reviewed_name:'B',...over});
const ln=(category,description,account,amount,reference='')=>({category,description,account,amount,reference});

test('build 2886: every note family with a supporting schedule is listed once, with headings in a fixed order',()=>{
 assert.deepEqual(KINDS.map(k=>k.code),['STOCK','RECEIVABLES','PAYABLES','BANK','LOANS','TAX','PAYROLL','EQUITY']);
 assert.deepEqual(KINDS.map(k=>k.ref),['INV','REC','PAY','CASH','BORROW','TAX','STAFF','EQUITY']);
 assert.equal(kindForRef('PPE'),null,'property has its own register');assert.equal(kindForRef('REVENUE'),null);
 for(const k of KINDS){assert.ok(k.categories.length>=3);assert.equal(new Set(k.categories).size,k.categories.length);assert.ok(k.source.length>20);}
});
test('build 2886: a schedule is checked before it is saved',()=>{
 const ok={kind:'STOCK',evidence:'Fictional count sheet at 31 December',accounts:['10100'],lines:[ln('Goods for resale','Hardware stock','10100',250000)]};
 const good=validateSchedule(ok);assert.equal(good.error,undefined);assert.equal(good.lines[0].amount,250000);
 const bad=(over,re)=>assert.match(validateSchedule({...ok,...over}).error,re);
 bad({kind:'NOPE'},/Choose which schedule/);bad({evidence:'short'},/what supports/);bad({lines:[]},/at least one line/);
 bad({lines:[ln('Made up heading','Hardware stock','10100',5)]},/choose a heading/);
 bad({lines:[ln('Goods for resale','ab','10100',5)]},/3 to 120/);
 bad({lines:[ln('Goods for resale','Hardware stock','99999',5)]},/not one this note holds/);
 bad({lines:[ln('Goods for resale','Hardware stock','10100','')]},/enter the amount/);
 bad({lines:[ln('Goods for resale','Hardware stock','10100',1.005)]},/two decimal/);
 bad({lines:[ln('Goods for resale','Hardware stock','10100',0)]},/nil/);
 bad({lines:[ln('Goods for resale','Hardware stock','10100',5),ln('Goods for resale','hardware stock','10100',6)]},/listed twice/);
 bad({lines:Array.from({length:201},(_,i)=>ln('Goods for resale','Item '+i,'10100',1))},/at most 200/);
 assert.equal(validateSchedule({...ok,lines:[ln('Allowance for slow-moving stock','Slow lines','10100',-5.25)]}).lines[0].amount,-5.25,'a deduction is a negative line');
});
test('build 2886: the tie-out lists every account on either side and reports a difference to the cent',()=>{
 const basis=[{code:'10060',name:'Trade receivables',cents:32000000},{code:'10070',name:'Allowance',cents:-2000000}];
 const t=tieOut({basis,lines:[{account:'10060',amount:320000},{account:'10070',amount:-20000}]});assert.equal(t.ties,true);assert.equal(t.differences,0);
 const off=tieOut({basis,lines:[{account:'10060',amount:319999.99},{account:'10070',amount:-20000}]});
 assert.equal(off.ties,false);assert.deepEqual(off.rows.filter(r=>!r.ties).map(r=>[r.account,r.difference]),[['10060',-0.01]]);
 const missing=tieOut({basis,lines:[{account:'10060',amount:320000}]});assert.equal(missing.rows.find(r=>r.account==='10070').schedule,0,'an account the schedule leaves out is a difference');
 const extra=tieOut({basis,lines:[{account:'10060',amount:320000},{account:'10070',amount:-20000},{account:'10999',amount:5}]});assert.equal(extra.rows.find(r=>r.account==='10999').trial_balance,0);assert.equal(extra.ties,false);
 const split=tieOut({basis,lines:[{account:'10060',amount:100000.1},{account:'10060',amount:219999.9},{account:'10070',amount:-20000}]});assert.equal(split.ties,true,'lines on one account add up in cents');
});
test('build 2886: the notes engine attaches an approved schedule to its note and ties it to the same figures',()=>{
 const none=build();
 const rec=none.notes.find(n=>n.ref==='REC');assert.equal(rec.support,null,'nothing is printed until a schedule is approved');
 assert.deepEqual(rec.support_basis.accounts.map(a=>[a.code,a.cents]),[['10060',32000000],['10070',-2000000]]);
 assert.equal(none.notes.find(n=>n.ref==='PPE').support_basis,undefined,'property has no schedule of this kind');
 const withRec=build({RECEIVABLES:sched([ln('Trade receivables','Customers','10060',320000),ln('Allowance for expected credit losses','Allowance','10070',-20000)])});
 const n=withRec.notes.find(x=>x.ref==='REC');assert.equal(n.support.ties,true);assert.equal(n.support.total,300000);assert.deepEqual(n.support.categories.map(c=>[c.category,c.total]),[['Trade receivables',320000],['Allowance for expected credit losses',-20000]]);
 assert.equal(withRec.problems.length,0,'a schedule never adds a problem of its own; the gate reports it');
 const wrong=build({RECEIVABLES:sched([ln('Trade receivables','Customers','10060',310000),ln('Allowance for expected credit losses','Allowance','10070',-20000)])}).notes.find(x=>x.ref==='REC');
 assert.equal(wrong.support.ties,false);assert.equal(wrong.support.tie.rows.find(r=>!r.ties).difference,-10000);
});
test('build 2886: an approved schedule changes what a Partner approved, so the notes approval goes stale when it changes',()=>{
 const base=canonicalNotes(build().notes),a=canonicalNotes(build({STOCK:sched([ln('Goods for resale','Hardware','10100',250000)])}).notes),b=canonicalNotes(build({STOCK:sched([ln('Goods for resale','Hardware','10100',250000),],{version:2})}).notes);
 assert.notDeepEqual(base,a);assert.notDeepEqual(a,b,'a new version of the schedule is a new digest');
 const c=canonicalNotes(build({STOCK:sched([ln('Raw materials','Hardware','10100',250000)])}).notes);assert.notDeepEqual(a,c,'moving a line to another heading is a change');
 assert.deepEqual(canonicalNotes(build().notes),base,'the same figures give the same digest');
});
test('build 2886: the readiness of the schedules names each note that is not supported, and ignores notes with no balances',()=>{
 const nb=build(),r0=scheduleReadiness({notes:nb.notes,rows:{}});
 assert.equal(r0.ok,false);
 assert.deepEqual(r0.kinds.filter(k=>k.relevant).map(k=>k.kind).sort(),['BANK','EQUITY','PAYABLES','RECEIVABLES','STOCK'].concat(['PAYROLL']).sort());
 assert.match(r0.problems.join(' '),/Inventories \(note \d+\): no supporting schedule/);
 const rows={approved:{STOCK:1},draft:{PAYABLES:{}},returned:{RECEIVABLES:{}}};
 const r1=scheduleReadiness({notes:nb.notes,rows});
 assert.match(r1.problems.join(' '),/Trade and other payables \(note \d+\): the schedule waits for approval/);
 assert.match(r1.problems.join(' '),/Receivables and prepayments \(note \d+\): the schedule was returned/);
 const quiet=build(null,[bs('10000',100),bs('31000',-100)]);
 assert.deepEqual(scheduleReadiness({notes:quiet.notes,rows:{}}).kinds.filter(k=>k.relevant).map(k=>k.kind).sort(),['BANK'],'only notes with balances need one');
});
test('build 2886: with every schedule approved and agreeing, the check passes; one difference blocks and the message says which account',()=>{
 const good={STOCK:sched([ln('Goods for resale','Hardware','10100',250000)]),
  RECEIVABLES:sched([ln('Trade receivables','Customers','10060',320000),ln('Allowance for expected credit losses','Allowance','10070',-20000)]),
  PAYABLES:sched([ln('Trade payables','Suppliers','20000',130000)]),BANK:sched([ln('Bank balances','Bank','10000',400000),ln('Mobile money','Wallet','10010',100000.5)]),
  PAYROLL:sched([ln('Salaries and wages','Payroll','60000',150000)]),EQUITY:sched([ln('Share capital or capital introduced','Capital','30000',100000)])};
 const run=s=>{const nb=build(s),rows={approved:Object.fromEntries(Object.keys(s).map(k=>[k,1]))};return scheduleReadiness({notes:nb.notes,rows});};
 const ok=run(good);assert.equal(ok.ok,true,JSON.stringify(ok.problems));assert.equal(schedulesCheck(ok).status,'Pass');
 const bad=run({...good,PAYABLES:sched([ln('Trade payables','Suppliers','20000',129000)])});assert.equal(bad.ok,false);const c=schedulesCheck(bad);assert.equal(c.status,'Blocked');assert.match(c.detail,/account 20000 A20000 is 129,000\.00 on the schedule and 130,000\.00 in the trial balance/);
 assert.equal(schedulesCheck({relevant:0,ok:true,problems:[]}).status,'Info');
});
test('build 2886: the pack check is left out when the caller gives none, blocks before review when not met, and shows in the gate',()=>{
 const period={starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'};
 const run=schedules=>packReadiness({period,reporting:{},tb:tb(),maps,lines:lineDefs,issues:[],prior:{source:'Approved comparatives'},priorPeriodExists:true,asOf:'2026-12-31',schedules});
 assert.equal(run(null).checks.find(c=>c.code==='SUPPORT_SCHEDULES'),undefined);
 assert.equal(run({relevant:0,ok:true,problems:[]}).checks.find(c=>c.code==='SUPPORT_SCHEDULES'),undefined,'no note needs one');
 assert.equal(run({relevant:2,ok:true,problems:[]}).checks.find(c=>c.code==='SUPPORT_SCHEDULES').status,'Pass');
 const bad=run({relevant:2,ok:false,problems:['Inventories (note 3): no supporting schedule.']}),c=bad.checks.find(x=>x.code==='SUPPORT_SCHEDULES');assert.equal(c.status,'Blocked');
 const gate=annualGate({gate:{checks:[]},pack:bad,statementProblems:[]});const g=gate.checks.find(x=>x.code==='A_SUPPORT_SCHEDULES');
 assert.equal(g.ok,false);assert.equal(gate.ready_for_review,false,'missing schedules keep the pack out of review, unlike a Partner’s final approval');
});
test('build 2886: the printed schedule rounds to the statements’ unit and keeps a rounding line so it still adds up',()=>{
 const basis=[{code:'10100',name:'Stock',cents:25000000}];
 const s=buildSupport({kind:'STOCK',schedule:sched([ln('Goods for resale','Hardware','10100',100000.5),ln('Goods for resale','Tools','10100',149999.5)]),basis,rounding:'Whole shillings'});
 assert.equal(s.ties,true);assert.equal(s.total,250000);const c=s.categories[0];assert.equal(c.total,250000);assert.equal(c.rounding,-1,'two halves rounded up are one over');assert.equal(c.lines.reduce((n,l)=>n+l.amount,0)+c.rounding,c.total);
 assert.equal(buildSupport({kind:'STOCK',schedule:null,basis}),null);
});
