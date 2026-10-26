import test from 'node:test';import assert from 'node:assert/strict';
import {mappingDates,inventoryMethod,inventoryAccountAllowed,stockChoices} from '../staff-inventory-options.mjs';
const activity={activity_id:'a',effective_from:'2026-01-01',effective_to:'2026-12-31'},data={policy:{inventory_method:'Periodic'},activities:[activity],policies:[{activity_id:'a',effective_from:'2026-07-01',inventory_method:'Perpetual'},{activity_id:'a',effective_from:'2026-01-01',inventory_method:'Periodic'}]};
test('mapping uses each selected reporting date and detects policy boundaries',()=>{
 const rows=[{normalized:{return_month:'2026-06-01',date:'2026-05-01'}},{normalized:{return_month:'2026-07-01'}}];assert.deepEqual(mappingDates(rows),['2026-06-01','2026-07-01']);
 assert.equal(inventoryMethod(data,'a',['2026-01-01']).method,'Periodic');assert.equal(inventoryMethod(data,'a',['2026-09-01']).method,'Perpetual');
 assert.match(inventoryMethod(data,'a',mappingDates(rows)).error,/different inventory methods/);
 assert.match(inventoryMethod(data,'a',['2025-01-01']).error,/covers every/);assert.match(inventoryMethod({...data,policy:null},'', ['2026-10-01']).error,/Manager/);
 assert.match(inventoryMethod({...data,policies:[data.policies[0]]},'a',['2026-02-01']).error,/Manager/);
 assert.deepEqual(mappingDates([],{mapping_dates:['2026-08-01','2026-07-01']}),['2026-07-01','2026-08-01']);
});
test('goods for resale excludes production and cost-of-sales accounts but retains landed costs',()=>{
 for(const code of ['10190','10240','50000','50020','50030','50040','50050','50060','50090'])assert.equal(inventoryAccountAllowed(code,'Goods for resale'),true);
 for(const code of ['10200','10210','10220','10230','50010','50070','50080','50100'])assert.equal(inventoryAccountAllowed(code,'Goods for resale'),false);
 assert.equal(inventoryAccountAllowed('50010','Construction raw materials'),true);assert.equal(inventoryAccountAllowed('50000','Other inventory'),false);
});
test('category choices respect activity and use and preserve an existing category only in its original context',()=>{
 const r={stock_categories:[{stock_class:'Groceries',activity_id:'a',inventory_use:'Goods for resale'},{stock_class:'Cement',activity_id:'b',inventory_use:'Construction raw materials'},{stock_class:'Merchandise',activity_id:null,inventory_use:'Goods for resale'}]},old=[{account_code:'50000',review_details:{stock_class:'Legacy group',activity_id:'a',inventory_use:'Goods for resale'}}];
 assert.deepEqual(stockChoices(r,'a','Goods for resale',old),['Groceries','Legacy group','Merchandise']);assert.deepEqual(stockChoices(r,'b','Goods for resale',old),['Merchandise']);assert.deepEqual(stockChoices(r,'b','Construction raw materials',old),['Cement']);
});
