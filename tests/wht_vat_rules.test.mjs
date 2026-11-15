import test from 'node:test';import assert from 'node:assert/strict';
import {withheldVat,ruleOn,purchaseEligibility,agentLineIssues,certificateState,certificateLineIssues,scheduleSheets,RATE_KEY} from '../supabase/functions/staff-workspace-v12/wht-vat-rules.mjs';
test('withholding VAT arithmetic is exact: cents in the ledger, whole shillings (rounded up) in the KRA layout',()=>{
 assert.deepEqual(withheldVat(1000,2),{exact:20,whole:20});
 assert.deepEqual(withheldVat(333.33,2),{exact:6.67,whole:7});
 assert.deepEqual(withheldVat(100.5,2),{exact:2.01,whole:3});
 assert.deepEqual(withheldVat(0.01,2),{exact:0,whole:1},'a fraction of a cent still rounds up to a shilling in the layout, as CEILING does');
 assert.deepEqual(withheldVat(1234567890.12,5.625),{exact:69444443.82,whole:69444444},'no floating-point drift on large amounts or three-decimal rates');
 assert.deepEqual(withheldVat(0,2),{exact:0,whole:0});
});
test('the rate comes only from the rule in force on the payment date',()=>{
 const rule=(from,to,rate,extra={})=>({rate_key:RATE_KEY,effective_from:from,effective_to:to,parameters:{rate},label:'rule',...extra});
 assert.match(ruleOn([],'2026-11-05').error,/no approved withholding VAT rate covering 2026-11-05/);
 assert.equal(ruleOn([rule('2026-01-01','2026-12-31',2)],'2026-11-05').rate,2);
 assert.equal(ruleOn([rule(new Date('2026-01-01'),new Date('2026-12-31'),2)],'2026-12-31').rate,2,'dates read from the database are accepted');
 assert.ok(ruleOn([rule('2026-01-01','2026-12-31',2)],'2027-01-01').error);
 assert.match(ruleOn([rule('2026-01-01','2026-12-31',2),rule('2026-06-01','2026-12-31',3)],'2026-07-01').error,/More than one/);
 assert.match(ruleOn([rule('2026-01-01','2026-12-31',0)],'2026-07-01').error,/no usable rate/);
 assert.ok(ruleOn([{...rule('2026-01-01','2026-12-31',2),rate_key:'KE_OTHER'}],'2026-07-01').error,'another rule is never borrowed');
});
test('only invoices that carry VAT can be withheld on; the category is never inferred',()=>{
 assert.equal(purchaseEligibility({vat_category:'16%',document_type:'Invoice'}).ok,true);
 assert.equal(purchaseEligibility({vat_category:'8%',document_type:'Invoice'}).ok,true);
 assert.match(purchaseEligibility({vat_category:'0%',document_type:'Invoice'}).reason,/zero-rated/);
 assert.match(purchaseEligibility({vat_category:'Exempt',document_type:'Invoice'}).reason,/exempt/);
 assert.match(purchaseEligibility({vat_category:'16%',document_type:'Credit note'}).reason,/adjustment voucher/);
 assert.match(purchaseEligibility(null).reason,/not in the retained/);
});
test('line checks follow the KRA workbook validations',()=>{
 const ok={supplier_pin:'P000000001A',supplier_name:'Fictional Supplier',invoice_no:'0001',invoice_net:100,invoice_date:'2026-10-01',payment_date:'2026-11-05'};
 assert.deepEqual(agentLineIssues(ok,{clientPin:'P051234567Z',month:'2026-11'}),[]);
 assert.ok(agentLineIssues({...ok,supplier_pin:'P051234567Z'},{clientPin:'P051234567Z'}).some(x=>/own PIN/.test(x)));
 assert.ok(agentLineIssues({...ok,invoice_no:'x'.repeat(41)}).some(x=>/40 characters/.test(x)));
 assert.ok(agentLineIssues({...ok,payment_date:'2026-09-30'}).some(x=>/cannot be after the payment date/.test(x)));
 assert.ok(agentLineIssues(ok,{month:'2026-12'}).some(x=>/not in 2026-12/.test(x)));
 assert.ok(certificateLineIssues({withholder_pin:'bad',certificate_no:'',invoice_no:'1',invoice_net:1,vat_withheld:0}).length>=4);
});
test('a certificate counts only when its invoice lines add up to the credit',()=>{
 const credit={erp_amount:480};
 assert.equal(certificateState(credit,[],[]).complete,false);
 assert.match(certificateState(credit,[],[]).problems[0],/No sales invoices/);
 const part=certificateState(credit,[{vat_withheld:200,invoice_no:'000123'}],['000123']);assert.equal(part.difference,280);assert.equal(part.complete,false);
 const full=certificateState(credit,[{vat_withheld:200,invoice_no:'000123'},{vat_withheld:280,invoice_no:'000999'}],['000123']);
 assert.equal(full.complete,true);assert.deepEqual(full.not_in_sales_csv,['000999']);assert.equal(full.csv_checked,true);
 assert.equal(certificateState(credit,[{vat_withheld:480,invoice_no:'1'}],[]).csv_checked,false);
});
test('the schedule workbook has sections A and B, voided lines left out, and says what it cannot know',()=>{
 const lines=[{status:'Active',supplier_pin:'P000000001A',invoice_no:'0001',invoice_date:'2026-10-06',invoice_net:1000,payment_date:'2026-11-05',rate:2,vat_withheld:20},
  {status:'Active',supplier_pin:'P000000002B',invoice_no:'0002',invoice_date:'2026-10-07',invoice_net:333.33,payment_date:'2026-11-06',rate:2,vat_withheld:6.67},
  {status:'Voided',supplier_pin:'P000000003C',invoice_no:'0003',invoice_date:'2026-10-07',invoice_net:999,payment_date:'2026-11-06',rate:2,vat_withheld:19.98}];
 const s=scheduleSheets({lines,client:{kra_pin:'P051234567Z'},month:'2026-11'});
 assert.deepEqual(s.sheets.map(x=>x[0]),['A_Basic_Info','B_VAT_WHT_Dtls']);
 assert.deepEqual(s.sheets[0][2].map(r=>r[1]),['P051234567Z','VAT','Withholding - VAT','Self Assessment Tax']);
 const b=s.sheets[1][2];assert.deepEqual(b[0],['P000000001A','0001','06/10/2026',1000,'05/11/2026',2,20]);assert.deepEqual(b[1].slice(-1),[7]);
 assert.equal(b.length,2+4);assert.equal(s.totals.withheld_whole,27);assert.equal(s.totals.withheld_exact,26.67);
 assert.ok(s.issues.some(x=>/vouchers the ERP does not hold/.test(x)));
 assert.ok(scheduleSheets({lines:[],client:{kra_pin:'P1'},month:'2026-11'}).issues.some(x=>/at least one/.test(x)));
 assert.ok(scheduleSheets({lines:[{...lines[0],payment_date:'2026-12-02'},lines[1]],client:{kra_pin:'P051234567Z'}}).issues.some(x=>/more than one month/.test(x)));
});
