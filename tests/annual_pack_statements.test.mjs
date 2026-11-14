import test from 'node:test';import assert from 'node:assert/strict';
import {buildStatements,currentByLine} from '../supabase/functions/staff-workspace-v12/annual-pack-statements.mjs';
// Fictional figures only. A small slice of the real statement-line catalogue (same codes, sections, sort order and normal side).
const L=(line_code,statement,section,label,sort_order,normal_side)=>({line_code,statement,section,label,sort_order,normal_side});
const lineDefs=[
 L('SFP.PPE','Financial position','Non-current assets','Property, plant and equipment',100,'Debit'),
 L('SFP.TRADE_REC','Financial position','Current assets','Trade receivables',220,'Debit'),
 L('SFP.CASH','Financial position','Current assets','Cash and cash equivalents',270,'Debit'),
 L('SFP.SHARE_CAP','Financial position','Equity','Share capital',300,'Credit'),
 L('SFP.DRAWINGS','Financial position','Equity','Drawings',340,'Debit'),
 L('SFP.RETAINED','Financial position','Equity','Retained earnings',370,'Credit'),
 L('SFP.TRADE_PAY','Financial position','Current liabilities','Trade payables',500,'Credit'),
 L('PL.REVENUE','Profit or loss','Revenue','Revenue',1000,'Credit'),
 L('PL.COST_SALES','Profit or loss','Cost of sales','Cost of sales',1100,'Debit'),
 L('PL.STAFF','Profit or loss','Operating costs','Staff costs',1300,'Debit'),
 L('PL.OTHER_OPEX','Profit or loss','Operating costs','Other operating expenses',1330,'Debit'),
 L('PL.FIN_COSTS','Profit or loss','Finance','Finance costs',1410,'Debit'),
 L('PL.TAX','Profit or loss','Tax','Income tax expense',1500,'Debit'),
 L('PL.UNRESOLVED','Profit or loss','Unresolved','Unresolved review items',1900,'Debit'),
 L('EXC.LEGACY','Excluded','Excluded','Legacy',9000,'Debit')
];
const map=(account_code,line_code,extra={})=>({account_code,line_code,effective_from:'2020-01-01',effective_to:null,status:'Approved',...extra});
const maps=[map('10000','SFP.CASH'),map('10060','SFP.TRADE_REC'),map('15005','SFP.PPE'),map('20000','SFP.TRADE_PAY'),map('30000','SFP.SHARE_CAP'),map('31000','SFP.RETAINED'),
 map('40000','PL.REVENUE'),map('50000','PL.COST_SALES'),map('60000','PL.STAFF'),map('60100','PL.OTHER_OPEX'),map('70000','PL.FIN_COSTS'),map('80000','PL.TAX')];
const bs=(code,net)=>({code,name:'A'+code,opening:net,movement_debit:0,movement_credit:0,net});
const pl=(code,debit,credit)=>({code,name:'A'+code,opening:0,movement_debit:debit,movement_credit:credit,net:debit-credit});
const tb=()=>[bs('10000',500000),bs('10060',300000),bs('15005',700000),bs('20000',-130000),bs('30000',-100000),bs('31000',-1020000),
 pl('40000',0,1000000),pl('50000',400000,0),pl('60000',150000,0),pl('60100',100000,0),pl('70000',20000,0),pl('80000',80000,0)];
const priorPl=[['PL.REVENUE',800000],['PL.COST_SALES',300000],['PL.STAFF',120000],['PL.OTHER_OPEX',90000],['PL.FIN_COSTS',10000],['PL.TAX',60000]].map(([line_code,amount])=>({line_code,amount}));
const priorOpening=[['SFP.CASH',400000],['SFP.TRADE_REC',250000],['SFP.PPE',650000],['SFP.TRADE_PAY',-180000],['SFP.SHARE_CAP',-100000],['SFP.RETAINED',-1020000]].map(([line_code,net])=>({line_code,net}));
const base={lineDefs,maps,startsOn:'2026-01-01',endsOn:'2026-12-31'};
const row=(st,label)=>st.rows.find(r=>r.label===label&&r.kind!=='heading');

test('profit or loss subtotals foot, with costs shown as negatives',()=>{
 const s=buildStatements({...base,tb:tb(),priorPl,priorOpening});
 const p=s.profit_or_loss;
 assert.equal(row(p,'Revenue').current,1000000);assert.equal(row(p,'Cost of sales').current,-400000);
 assert.equal(row(p,'Gross profit').current,600000);assert.equal(row(p,'Operating profit').current,350000);
 assert.equal(row(p,'Profit before tax').current,330000);assert.equal(row(p,'Profit for the year').current,250000);
 assert.equal(p.profit,250000);
});
test('prior-year profit or loss comes from the approved comparatives and is not added to the current year',()=>{
 const p=buildStatements({...base,tb:tb(),priorPl,priorOpening}).profit_or_loss;
 assert.equal(p.has_prior,true);assert.equal(row(p,'Revenue').prior,800000);assert.equal(row(p,'Gross profit').prior,500000);
 assert.equal(row(p,'Operating profit').prior,290000);assert.equal(row(p,'Profit before tax').prior,280000);assert.equal(row(p,'Profit for the year').prior,220000);
 assert.equal(row(p,'Profit for the year').current,250000);
});
test('financial position balances and carries the year’s profit as its own equity line',()=>{
 const s=buildStatements({...base,tb:tb(),priorPl,priorOpening}),f=s.financial_position;
 assert.equal(row(f,'Total assets').current,1500000);assert.equal(row(f,'Total equity and liabilities').current,1500000);
 assert.equal(row(f,'Profit for the year').current,250000);assert.equal(row(f,'Total equity').current,1370000);
 assert.equal(row(f,'Total assets').prior,1300000);assert.equal(row(f,'Total equity and liabilities').prior,1300000);
 assert.equal(s.checks.balanced,true);assert.deepEqual(s.problems,[]);assert.equal(s.complete,true);
});
test('a drawing is shown as a negative within equity',()=>{
 const defsPlus=lineDefs,m=[...maps,map('32000','SFP.DRAWINGS')];
 const t=[...tb().map(r=>r.code==='15005'?bs('15005',650000):r),bs('32000',50000)];
 const f=buildStatements({lineDefs:defsPlus,maps:m,tb:t,startsOn:'2026-01-01',endsOn:'2026-12-31'}).financial_position;
 assert.equal(row(f,'Drawings').current,-50000);assert.equal(row(f,'Total assets').current,1450000);assert.equal(row(f,'Total equity and liabilities').current,1450000);
});
test('an account with no approved line is reported, never shown as zero, and blocks completeness',()=>{
 const t=[...tb(),bs('99999',1000)];
 const s=buildStatements({...base,tb:t,priorPl,priorOpening});
 assert.equal(s.checks.unmapped.length,1);assert.equal(s.checks.unmapped[0].code,'99999');assert.equal(s.complete,false);
 assert.match(s.problems.join(' '),/99999/);
});
test('a mapping that ended before the report date does not apply',()=>{
 const m=maps.map(x=>x.account_code==='40000'?{...x,effective_to:'2026-06-30'}:x);
 const s=buildStatements({...base,maps:m,tb:tb(),priorPl,priorOpening});
 assert.ok(s.checks.unmapped.some(u=>u.code==='40000'));
});
test('without approved comparatives the prior columns are absent and the reason is given',()=>{
 const s=buildStatements({...base,tb:tb()});
 assert.equal(s.profit_or_loss.has_prior,false);assert.equal(s.financial_position.has_prior,false);
 assert.ok(s.profit_or_loss.rows.every(r=>r.kind==='heading'||r.prior===null));
 assert.equal(s.complete,false);assert.match(s.problems.join(' '),/prior-year profit or loss/);assert.match(s.problems.join(' '),/prior-year opening balances/);
});
test('an out-of-balance trial balance is shown as a difference, not hidden',()=>{
 const t=tb().map(r=>r.code==='10000'?bs('10000',501000):r);
 const s=buildStatements({...base,tb:t,priorPl,priorOpening});
 assert.equal(s.checks.balanced,false);assert.equal(s.checks.difference,1000);assert.match(s.problems.join(' '),/out by KES 1000\.00/);
});
test('unresolved review items and legacy balances are named',()=>{
 const m=[...maps,map('90000','PL.UNRESOLVED'),map('91000','EXC.LEGACY')];
 const t=[...tb(),pl('90000',500,0),bs('91000',200)];
 const s=buildStatements({...base,maps:m,tb:t,priorPl,priorOpening});
 assert.equal(s.checks.unresolved,true);assert.equal(s.checks.excluded.length,1);assert.match(s.problems.join(' '),/unresolved review items/);assert.match(s.problems.join(' '),/excluded or legacy/);
});
test('thousands rounding is half away from zero and every total foots from the rounded lines',()=>{
 const t=tb().map(r=>r.code==='40000'?pl('40000',0,1000500):r.code==='50000'?pl('50000',402500,0):r);
 const p=buildStatements({...base,tb:t,rounding:'Thousands'}).profit_or_loss;
 assert.equal(row(p,'Revenue').current,1001);assert.equal(row(p,'Cost of sales').current,-403);
 const lines=p.rows.filter(r=>r.kind==='line').map(r=>r.current),total=row(p,'Profit for the year').current;
 assert.equal(lines.reduce((a,b)=>a+b,0),total);
});
test('whole-shilling rounding keeps cents out of the face of the statements',()=>{
 const t=tb().map(r=>r.code==='40000'?pl('40000',0,1000000.49):r);
 assert.equal(row(buildStatements({...base,tb:t}).profit_or_loss,'Revenue').current,1000000);
});
test('profit or loss lines use the year’s movement and balance sheet lines the closing balance',()=>{
 const {by}=currentByLine({tb:[{code:'10000',opening:100,movement_debit:50,movement_credit:20,net:130},{code:'40000',opening:0,movement_debit:10,movement_credit:60,net:-50}],maps,lineDefs,asOf:'2026-12-31'});
 assert.equal(by.get('SFP.CASH'),13000);assert.equal(by.get('PL.REVENUE'),5000);
});
test('the statements carry the period, currency and presentation unit for the heading',()=>{
 const s=buildStatements({...base,tb:tb(),rounding:'Thousands'});
 assert.equal(s.period.ends_on,'2026-12-31');assert.equal(s.presentation.unit_label,'KES thousands');assert.equal(s.presentation.currency,'KES');
});
