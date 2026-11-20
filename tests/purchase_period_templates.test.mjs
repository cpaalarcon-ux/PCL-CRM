// Build 2892: purchases by month or week with the four-sheet layout; sales with one month or more than one month.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {purchaseCategoryFromSheet,purchasePeriod,PURCHASE_CATEGORIES} from '../staff-purchase-period.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('the VAT category is taken from the sheet name, and only when the name is clear',()=>{
 assert.deepEqual(PURCHASE_CATEGORIES,['16%','8%','0%','Exempt']);
 for(const [n,c] of [['16%','16%'],['8%','8%'],['0%','0%'],['Exempt','Exempt'],['Gen Purchase Upload','16%'],['Other Purchase Upload','8%'],['Zero Purchase Upload','0%'],['Exempt Purchase Upload','Exempt'],['file.xlsx :: 8%','8%']])assert.equal(purchaseCategoryFromSheet(n),c,n);
 for(const n of ['Read first','Sheet1','','ERP account codes',null])assert.equal(purchaseCategoryFromSheet(n),'',String(n));
});
test('a month covers its first to last day, a week covers seven days, and bad input gives no dates',()=>{
 const m=purchasePeriod({kind:'Month',month:'2026-02',vat_category:'16%'});assert.equal(m.period_start,'2026-02-01');assert.equal(m.period_end,'2026-02-28');
 const l=purchasePeriod({kind:'Month',month:'2028-02'});assert.equal(l.period_end,'2028-02-29');
 const w=purchasePeriod({kind:'Week',weekStart:'2026-03-02',vat_category:'8%'});assert.equal(w.period_start,'2026-03-02');assert.equal(w.period_end,'2026-03-08');
 const x=purchasePeriod({kind:'Week',weekStart:'2026-12-28'});assert.equal(x.period_end,'2027-01-03');
 for(const bad of [{kind:'Month',month:''},{kind:'Month',month:'2026-13'},{kind:'Week',weekStart:''},{kind:'Week',weekStart:'not a date'}]){const r=purchasePeriod(bad);assert.ok(!r.period_start&&!r.period_end,JSON.stringify(bad));}
});
test('the purchase upload form offers a month or a week and prefills the category from the sheet',()=>{
 const s=rd('staff-standard-purchases.mjs');
 assert.match(s,/staff-purchase-period\.mjs\?v=20261118-purchperiod-v1/);assert.match(s,/period_kind/);assert.match(s,/week_start/);assert.match(s,/purchaseCategoryFromSheet/);assert.match(s,/A week/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-standard-purchases\.mjs\?v=20261119-alias-v1/);
});
test('the sales upload form asks whether the file holds one month or more than one month',()=>{
 const s=rd('staff-period-imports.mjs');
 assert.match(s,/months_covered/);assert.match(s,/More than one month/);assert.match(s,/Sales_Multi_Month_Template\.xlsx/);assert.match(s,/delete p\.months_covered/);
});
test('Resources and Documents point at the new templates',()=>{
 for(const f of ['templates/Purchases_Monthly_Four_Sheet_Template.xlsx','templates/Sales_Multi_Month_Template.xlsx'])assert.ok(fs.existsSync(new URL('../'+f,import.meta.url)),f);
 assert.match(rd('staff-resources.mjs'),/Sales_Multi_Month_Template/);assert.match(rd('staff-pilot.mjs'),/Purchases_Monthly_Four_Sheet_Template\.xlsx/);
});
