// Build 2881: the PPE register rules (pure). Fictional assets and rates.
import test from 'node:test';import assert from 'node:assert/strict';
import {registerYear,reconcileRegister,noteSchedule,registerReadiness,assetIssues,addYears,yearsBetween,rateForYear} from '../supabase/functions/staff-workspace-v12/ppe-register-rules.mjs';
const rate=(o={})=>({class_code:'MOTOR',first_rate:25,annual_rate:25,later_basis_percentage:100,expense_account:'67030',contra_account:'15920',tax_cost_cap:3000000,effective_from:'2025-01-01',effective_to:'2027-12-31',...o});
const RATES=[rate()];
const A=(o={})=>({asset_key:'a1',asset_name:'Fictional delivery van',asset_account:'15100',class_code:'MOTOR',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:1000000,business_percentage:100,noncommercial_vehicle:false,origin:'Added in the year',...o});
const Y=y=>({start:y+'-01-01',end:y+'-12-31',rates:RATES});
const reg=(assets,disposals,y)=>registerYear({assets,disposals,rates:RATES,start:y+'-01-01',end:y+'-12-31'});
test('year arithmetic: month-end years stay month-end, and years walk back to the day after a date',()=>{
 assert.equal(addYears('2028-02-29',-1),'2027-02-28');assert.equal(addYears('2027-02-28',1),'2028-02-29');assert.equal(addYears('2026-06-30',-1),'2025-06-30');
 assert.deepEqual(yearsBetween('2027-12-31','2025-12-31'),[{start:'2026-01-01',end:'2026-12-31'},{start:'2027-01-01',end:'2027-12-31'}]);
});
test('an asset added in the year: cost is an addition, the first-use rate gives the charge, tax follows the same rate',()=>{
 const r=reg([A()],[],2026),x=r.rows[0];
 assert.deepEqual([x.opening_cost,x.additions,x.closing_cost,x.opening_acc,x.charge,x.closing_acc,x.nbv],[0,1000000,1000000,0,250000,250000,750000]);
 assert.deepEqual([x.tax_opening,x.tax_addition,x.tax_allowance,x.tax_closing],[0,1000000,250000,750000]);assert.equal(r.issues.length,0);assert.equal(r.expense_account,undefined);assert.equal(x.expense_account,'67030');
});
test('the next year rolls forward from the carrying amount; the charge is never more than what is left',()=>{
 const x=reg([A()],[],2027).rows[0];assert.deepEqual([x.opening_cost,x.additions,x.opening_acc,x.charge,x.closing_acc,x.nbv,x.tax_opening,x.tax_allowance,x.tax_closing],[1000000,0,250000,250000,500000,500000,750000,250000,500000]);
 const low=reg([A({cost:100000})],[],2027).rows[0];assert.equal(low.charge,25000);
 const y28=registerYear({assets:[A({cost:1000000,acquired_on:'2025-02-01',first_use_on:'2025-02-01'})],disposals:[],rates:[rate({effective_to:'2027-12-31'}),rate({effective_from:'2028-01-01',effective_to:'2028-12-31',first_rate:25,annual_rate:25})],start:'2028-01-01',end:'2028-12-31'}).rows[0];
 assert.equal(y28.closing_acc,1000000,'4 years at 25% of cost exhausts the cost, and the last year stops there');assert.equal(y28.nbv,0);
});
test('a brought-forward asset starts from the figures the Partner approved, not from a recalculation',()=>{
 const b=A({asset_key:'b1',origin:'Brought forward',bf_as_of:'2025-12-31',bf_accumulated_depreciation:400000,bf_tax_wdv:300000,cost:800000,acquired_on:'2024-01-10',first_use_on:'2024-01-10'});
 const x=reg([b],[],2026).rows[0];assert.deepEqual([x.opening_cost,x.additions,x.opening_acc,x.charge,x.closing_acc,x.nbv,x.tax_opening,x.tax_allowance,x.tax_closing],[800000,0,400000,200000,600000,200000,300000,200000,100000]);
 assert.equal(reg([b],[],2025).rows.length,0,'it is not in the register for a year before its brought-forward date');
 const bad=registerYear({assets:[{...b,bf_as_of:'2025-06-30'}],disposals:[],rates:RATES,start:'2026-01-01',end:'2026-12-31'});assert.match(bad.issues[0].message,/financial year end/);
});
test('a disposal: no charge in the year, gain or loss on the opening carrying amount, and a tax balancing figure on the opening written-down value',()=>{
 const d={asset_key:'a1',disposed_on:'2027-05-01',proceeds:600000},x=reg([A()],[d],2027).rows[0];
 assert.deepEqual([x.charge,x.released,x.disposal_cost,x.closing_cost,x.closing_acc,x.nbv,x.proceeds,x.gain_loss,x.tax_allowance,x.tax_balancing_allowance,x.tax_balancing_charge,x.tax_closing],[0,250000,1000000,0,0,0,600000,-150000,0,150000,0,0]);
 const gain=reg([A()],[{...d,proceeds:900000}],2027).rows[0];assert.equal(gain.gain_loss,150000);assert.equal(gain.tax_balancing_charge,150000);assert.equal(gain.tax_balancing_allowance,0);
 assert.equal(reg([A()],[d],2028).rows.length,0,'gone after the year of disposal');
});
test('business use only reduces the tax figures; a missing rate is reported, not guessed',()=>{
 const x=reg([A({business_percentage:50})],[],2026).rows[0];assert.deepEqual([x.charge,x.tax_addition,x.tax_allowance],[250000,500000,125000]);
 const none=registerYear({assets:[A()],disposals:[],rates:[],start:'2026-01-01',end:'2026-12-31'});assert.match(none.issues[0].message,/No reviewed rate/);
 assert.equal(rateForYear(RATES,'MOTOR','2026-01-01','2026-12-31').class_code,'MOTOR');assert.equal(rateForYear(RATES,'MOTOR','2028-01-01','2028-12-31'),null);
});
test('the register ties to the trial balance, or the difference is shown line by line',()=>{
 const r=reg([A()],[],2026),tb=[{code:'15100',name:'Motor vehicles',net:1000000},{code:'15920',name:'Accumulated depreciation, motor vehicles',net:-250000},{code:'67030',name:'Depreciation, motor vehicles',net:250000,movement_debit:250000,movement_credit:0}];
 const ok=reconcileRegister({register:r,tb,ppeCodes:['15100'],rates:RATES});assert.equal(ok.ties,true);assert.equal(ok.lines.length,3);
 const out=reconcileRegister({register:r,tb:[{...tb[0],net:1100000},tb[1],tb[2]],ppeCodes:['15100'],rates:RATES});assert.equal(out.ties,false);assert.equal(out.differences,1);assert.equal(out.lines[0].difference,-100000);
 const extra=reconcileRegister({register:r,tb:[...tb,{code:'15200',name:'Equipment',net:50000}],ppeCodes:['15100','15200'],rates:RATES});assert.equal(extra.ties,false,'a PPE balance with no register assets is a difference');
 const ready=registerReadiness({register:r,reconciliation:out,drafts:1,hasPpeBalances:true,hasAssets:true});assert.equal(ready.ok,false);assert.equal(ready.problems.length,2);
 assert.equal(registerReadiness({register:reg([],[],2026),reconciliation:{ties:true,differences:0},hasPpeBalances:false,hasAssets:false}).relevant,false);
 assert.match(registerReadiness({register:reg([],[],2026),reconciliation:{ties:true,differences:0},hasPpeBalances:true,hasAssets:false}).problems[0],/no approved assets/);
});
test('the note schedule groups by cost account and adds up',()=>{
 const r=reg([A(),A({asset_key:'a2',asset_name:'Fictional second van',cost:200000}),A({asset_key:'a3',asset_name:'Fictional press',asset_account:'15200',cost:100000})],[],2026),s=noteSchedule(r,new Map([['15100','Motor vehicles'],['15200','Plant']]));
 assert.deepEqual(s.classes.map(g=>[g.account,g.closing_cost,g.charge,g.nbv]),[['15100',1200000,300000,900000],['15200',100000,25000,75000]]);assert.equal(s.totals.nbv,975000);assert.equal(s.policy.length,3);
});
test('a proposed asset is checked before it is saved',()=>{
 const accounts=[{code:'15100',status:'Active',is_legacy:false,route:3},{code:'61000',status:'Active',is_legacy:false,route:2}];
 assert.deepEqual(assetIssues({...A(),evidence:'Invoice INV-001 and delivery note'},{accounts,rates:RATES}),[]);
 const bad=assetIssues({...A({asset_account:'61000',class_code:'NONE',cost:0,first_use_on:'2026-01-01',origin:'Brought forward'}),evidence:'x'},{accounts,rates:RATES}).join(' | ');
 for(const m of [/not an active property/,/reviewed rates/,/cost of the asset/,/first-use date cannot be before/,/brought-forward figures are at/,/accumulated depreciation brought forward/,/tax written-down/,/supports the cost/])assert.match(bad,m);
});
