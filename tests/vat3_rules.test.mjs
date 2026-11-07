import test from 'node:test';import assert from 'node:assert/strict';
import {vat3Schedules,treatmentOf} from '../supabase/functions/staff-workspace-v12/vat3-rules.mjs';
const sale=(inv,amt,vat,key,decision='Confirmed')=>({dataset:'Sales',decision,vat_rate_key:key,normalized:{invoice:inv,date:'2026-09-05',party:'Fictional Duka Ltd',party_pin:'P000000001A',amount:amt,vat}});
const buy=(inv,amt,vat,key,pct=100,decision='Eligible',dataset='Purchases')=>({dataset,decision,vat_rate_key:key,deductible_percentage:pct,normalized:{invoice:inv,date:'2026-09-07',party:'Fictional Supplier',amount:amt,vat}});
test('rule keys map to treatments',()=>{
 assert.deepEqual(['KE_VAT_STANDARD','KE_VAT_ZERO','KE_VAT_EXEMPT','KE_VAT_OUTSIDE','KE_VAT_PETROLEUM_8','','X'].map(treatmentOf),['Standard','Zero-rated','Exempt','Outside scope','Standard','Unclassified','Unclassified']);
});
test('schedules split by treatment, count only reviewed rows, and tie to the case result',()=>{
 const rows=[sale('S1',1000,160,'KE_VAT_STANDARD'),sale('S2',500,80,'KE_VAT_STANDARD'),sale('S3',300,0,'KE_VAT_ZERO'),sale('S4',200,0,'KE_VAT_EXEMPT'),sale('S5',999,159.84,'KE_VAT_STANDARD','Pending'),
  buy('P1',2000,320,'KE_VAT_STANDARD'),buy('P2',1000,160,'KE_VAT_STANDARD',50,'Eligible','Expenditure'),buy('P3',400,0,'KE_VAT_EXEMPT'),buy('P4',100,16,'KE_VAT_STANDARD',100,'Excluded')];
 const result={output:240,eligible_input:400,opening_credit:0,withholding_credit:0,reverse_charge:0,adjustments:0,net:-160,payable:0,carry_forward:160};
 const r=vat3Schedules({rows,result,inputs:{}});
 const by=n=>r.sheets.find(s=>s[0].startsWith(n));
 assert.equal(by('B ')[2].length,3,'two invoices and a total');assert.equal(by('B ')[2].at(-1)[6],240);
 assert.equal(by('C ')[2].length,2);assert.equal(by('D ')[2].length,2);assert.equal(by('E ')[2].length,1,'empty schedule keeps its total row');
 assert.equal(by('F ')[2].at(-1)[8],400,'320 plus half of 160');assert.equal(by('I ')[2].length,2);
 assert.deepEqual(r.issues,[]);assert.equal(r.tie_out.output_difference,0);assert.equal(r.counts.skipped.sales,1);assert.equal(r.counts.skipped.purchases,1);
 const summary=by('M-O')[2];assert.equal(summary.find(x=>x[0]==='VAT payable')[1],0);assert.equal(summary.find(x=>x[0]==='Credit carried forward')[1],160);
});
test('a difference from the case or an unclassified line is reported',()=>{
 const r=vat3Schedules({rows:[sale('S1',1000,160,'KE_VAT_STANDARD'),sale('S2',100,16,'')],result:{output:100,eligible_input:0},inputs:{}});
 assert.equal(r.issues.length,2);assert.match(r.issues[0],/no recognised VAT rule/);assert.match(r.issues[1],/Output VAT/);
});
