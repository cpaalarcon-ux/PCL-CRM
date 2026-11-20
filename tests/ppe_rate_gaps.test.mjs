// Build 2883: classes with no reviewed rate for a year are listed, and the prefill closes the gap without inventing a rate. Fictional assets and rates.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {registerYear,rateGapFill} from '../supabase/functions/staff-workspace-v12/ppe-register-rules.mjs';
const rate=(o={})=>({class_code:'MOTOR',name:'Motor vehicles',first_rate:25,annual_rate:25,later_basis_percentage:100,expense_account:'67030',contra_account:'15920',tax_cost_cap:3000000,effective_from:'2026-01-01',effective_to:'2026-12-31',scope:'Reference for testing',source_reference:'Fictional authority',source_checked_on:'2026-10-26',...o});
const A=(o={})=>({asset_key:'a1',asset_name:'Fictional van',asset_account:'15100',class_code:'MOTOR',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:1000000,business_percentage:100,noncommercial_vehicle:false,origin:'Added in the year',...o});
const B=(o={})=>A({asset_key:'b1',asset_name:'Fictional lorry',origin:'Brought forward',bf_as_of:'2025-12-31',bf_accumulated_depreciation:0,bf_tax_wdv:0,acquired_on:'2024-01-01',first_use_on:'2024-01-01',...o});
const reg=(assets,rates,y)=>registerYear({assets,disposals:[],rates,start:y+'-01-01',end:y+'-12-31'});

test('a year with a rate has no gap',()=>{assert.deepEqual(reg([A()],[rate()],2026).rate_gaps,[]);});
test('a year beyond the loaded rates is listed once per class and year, with the assets affected',()=>{
 const r=reg([A(),A({asset_key:'a2',asset_name:'Fictional pickup'})],[rate()],2027);
 assert.equal(r.rate_gaps.length,1);assert.deepEqual({c:r.rate_gaps[0].class_code,s:r.rate_gaps[0].start,e:r.rate_gaps[0].end,a:r.rate_gaps[0].assets},{c:'MOTOR',s:'2027-01-01',e:'2027-12-31',a:['Fictional van','Fictional pickup']});
 assert.match(r.issues[0].message,/No reviewed rate for class MOTOR/);
});
test('a brought-forward asset walked over two years lists each year that has no rate',()=>{
 const r=reg([B()],[rate()],2028);assert.deepEqual(r.rate_gaps.map(g=>g.start),['2027-01-01','2028-01-01']);
});
test('the register shows no depreciation for an unrated year and never invents one',()=>{
 const x=reg([A()],[rate()],2027).rows[0];assert.equal(x.charge,0);assert.equal(x.nbv,x.closing_cost-x.closing_acc);
});
test('the prefill copies the nearest row and closes the gap with the next calendar year',()=>{
 const f=rateGapFill([rate()],'MOTOR','2027-01-01','2027-12-31');
 assert.deepEqual({c:f.class_code,from:f.effective_from,to:f.effective_to,fr:f.first_rate,ar:f.annual_rate,lb:f.later_basis_percentage,cap:f.tax_cost_cap,e:f.expense_account,k:f.contra_account},{c:'MOTOR',from:'2027-01-01',to:'2027-12-31',fr:25,ar:25,lb:100,cap:3000000,e:'67030',k:'15920'});
 assert.equal(f.based_on.source_reference,'Fictional authority');assert.equal('source_reference' in f,false,'the authority is never copied across as if it had been checked for the new dates');
});
test('a July to June year that starts inside a rated year needs only the part after it',()=>{
 const f=rateGapFill([rate()],'MOTOR','2026-07-01','2027-06-30');assert.equal(f.effective_from,'2027-01-01');assert.equal(f.effective_to,'2027-12-31');
 const none=rateGapFill([rate(),rate({effective_from:'2027-01-01',effective_to:'2027-12-31'})],'MOTOR','2026-07-01','2027-06-30');assert.equal(none,null,'identical following rows already extend the cover');
});
test('a gap before the first rate closes up to the day before it, and an unknown class gives nothing',()=>{
 const f=rateGapFill([rate()],'MOTOR','2025-01-01','2025-12-31');assert.deepEqual([f.effective_from,f.effective_to],['2025-01-01','2025-12-31']);
 assert.equal(rateGapFill([rate()],'NOSUCH','2027-01-01','2027-12-31'),null);
 const part=rateGapFill([rate()],'MOTOR','2025-07-01','2026-06-30');assert.deepEqual([part.effective_from,part.effective_to],['2025-07-01','2025-12-31']);
});
test('the screen lists the missing rates and lets a Partner prepare one',()=>{
 const src=readFileSync(new URL('../staff-ppe.mjs',import.meta.url),'utf8');
 assert.match(src,/Rates needed/);assert.match(src,/data\.can_add_rate/);assert.match(src,/ledger_rate_add/);assert.match(src,/Nothing has been checked against the law for these dates/);
 assert.match(src,/name="source_reference" required/,'the authority is typed by the Partner');
});
