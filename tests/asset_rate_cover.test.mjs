import test from 'node:test';import assert from 'node:assert/strict';
import {assetCalculation,rateCoveredTo} from '../supabase/functions/staff-workspace-v12/ledger-rules.mjs';
const row=(from,to,extra={})=>({rate_id:from,class_code:'COMPUTER',first_rate:25,annual_rate:25,later_basis_percentage:100,method:'Equal instalments',tax_cost_cap:null,expense_account:'67050',contra_account:'15940',effective_from:new Date(from+'T00:00:00Z'),effective_to:new Date(to+'T00:00:00Z'),...extra});
const y26=row('2026-01-01','2026-12-31'),y27=row('2027-01-01','2027-12-31');
const asset={cost:300000,business_percentage:100,first_use_date:'2026-07-01',opening_book_value:240000,opening_tax_value:240000};
test('a July to June year is not covered by a single calendar-year rate',()=>{
 assert.ok(assetCalculation(asset,y26,'2026-07-01','2027-06-30').issues.some(i=>/covering this financial year/.test(i)));
});
test('a following row with identical rates extends the cover to the next year',()=>{
 assert.equal(rateCoveredTo(y26,[y26,y27]),'2027-12-31');
 const x=assetCalculation(asset,{...y26,covered_to:rateCoveredTo(y26,[y26,y27])},'2026-07-01','2027-06-30');
 assert.deepEqual(x.issues,[]);assert.equal(x.book_annual,75000);
});
test('cover does not extend over a gap or a changed rate',()=>{
 assert.equal(rateCoveredTo(y26,[y26]),'2026-12-31');
 assert.equal(rateCoveredTo(y26,[y26,row('2027-02-01','2027-12-31')]),'2026-12-31');
 assert.equal(rateCoveredTo(y26,[y26,row('2027-01-01','2027-12-31',{annual_rate:30})]),'2026-12-31');
 assert.equal(rateCoveredTo(y26,[y26,row('2027-01-01','2027-12-31',{class_code:'FURNITURE'})]),'2026-12-31');
 const x=assetCalculation(asset,{...y26,covered_to:rateCoveredTo(y26,[y26])},'2026-07-01','2027-06-30');assert.ok(x.issues.length);
});
