import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {clientProgress,nextStep} from '../staff-client-cards.mjs';

const client={client_id:'c1',company_name:'UAT Fictional Neema',kra_pin:'A000000203N'};
const base=readiness=>clientProgress({client,missing:[],compliance:{verified_at:'2026-11-01'},contacts:[{client_id:'c1'}],taxProfiles:[{client_id:'c1',status:'Verified'}],readiness,stagedTB:false});

test('a client with no stock-carrying activity does not need a stock method or categories',()=>{
 const salon={activity_count:1,stock_required_count:0,stock_method_count:0,category_count:0,usable_account_count:3,approved_account_count:0};
 assert.equal(base(salon).activitiesOk,true);
 assert.equal(nextStep(base(salon)).key,'tb-stage');
});

test('a stock-carrying client needs both a stock method and a category',()=>{
 const shop={activity_count:1,stock_required_count:1,stock_method_count:1,category_count:0,usable_account_count:3};
 assert.equal(base(shop).activitiesOk,false);
 assert.equal(base({...shop,stock_method_count:0,category_count:2}).activitiesOk,false);
 assert.equal(base({...shop,category_count:2}).activitiesOk,true);
});

test('general mappings pending review count as usable; none at all still blocks',()=>{
 const r={activity_count:1,stock_required_count:0,approved_account_count:0};
 assert.equal(base({...r,usable_account_count:14}).activitiesOk,true);
 assert.equal(base({...r,usable_account_count:0}).activitiesOk,false);
});

test('older readiness rows without the new fields keep the strict rule',()=>{
 const old={activity_count:1,stock_method_count:1,category_count:0,approved_account_count:5};
 assert.equal(base(old).activitiesOk,false);
});

test('server readiness query reports usable mappings and stock-carrying activities',()=>{
 const src=readFileSync(new URL('../supabase/functions/staff-workspace-v12/improvement-actions.ts',import.meta.url),'utf8');
 assert.match(src,/usable_account_count/);
 assert.match(src,/stock_required_count/);
 assert.match(src,/x\.status in \('Active','Draft'\)/);
});

test('the stock form and action accept stock categories and save them with the policy',()=>{
 const ui=readFileSync(new URL('../staff-improvements.mjs',import.meta.url),'utf8');
 assert.match(ui,/area\('stock_categories'/);
 assert.match(ui,/select\('inventory_use'/);
 const src=readFileSync(new URL('../supabase/functions/staff-workspace-v12/improvement-actions.ts',import.meta.url),'utf8');
 assert.match(src,/insert into erp_private\.stock_categories\(client_id,activity_id,inventory_use,stock_class,created_by\)/);
 assert.match(src,/Enter at most 20 stock categories/);
});
