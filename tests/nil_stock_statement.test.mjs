import test from 'node:test';import assert from 'node:assert/strict';
import {nilStockStatement,stockValues} from '../supabase/functions/staff-workspace-v12/improvement-rules.mjs';
const policy={variance_threshold:1000};
const inputs={opening_value:'0',cost_of_sales:'0',cost_basis:'Supported actual cost',evidence_reference:'No 0% purchases in the period (supplier ledger)',reconciliation_note:'No stock held or bought in this VAT category.'};
const src={selected_count:0,resale_purchases:0,landed_costs:0};
test('a category with no purchases can submit only as a complete nil-stock statement',()=>{
 const r=stockValues({...inputs,resale_purchases:0,landed_costs:0},policy);
 assert.equal(r.closing_value,0);
 assert.equal(nilStockStatement(r,src,inputs),true);
 assert.equal(nilStockStatement(r,{...src,selected_count:2},inputs),false);
 assert.equal(nilStockStatement(r,{...src,resale_purchases:100},inputs),false);
 assert.equal(nilStockStatement(stockValues({...inputs,opening_value:'500',resale_purchases:0},policy),src,{...inputs,opening_value:'500'}),false);
 assert.equal(nilStockStatement(r,src,{...inputs,reconciliation_note:'nil'}),false);
 assert.equal(nilStockStatement(r,src,{...inputs,evidence_reference:''}),false);
 assert.equal(nilStockStatement(stockValues({...inputs,opening_value:''},policy),src,{...inputs,opening_value:''}),false);
});
