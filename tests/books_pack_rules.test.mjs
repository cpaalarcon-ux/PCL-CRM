import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {booksPack,stockStepDone,STOCK_PACKS} from '../supabase/functions/staff-workspace-v12/books-pack-rules.mjs';
import {SETUP_ORDER,nextSetupStep} from '../staff-setup-order.mjs';
import {booksPackHtml,BOOKS_PACK_CONFIRM} from '../staff-books-pack.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const W={activity_id:'a1',activity_name:'Wholesale of hardware',pack_code:'Wholesale',effective_from:'2026-01-01',effective_to:null},K={activity_id:'a2',activity_name:'Consultancy',pack_code:'Consultancy',effective_from:'2026-01-01',effective_to:null};

test('a client with no stock activity has no stock gaps and no acknowledgement is required',()=>{
 const p=booksPack({activities:[K],at:'2026-03-01'});
 assert.equal(p.stock_needed,false);assert.equal(p.complete,true);assert.deepEqual(p.gaps,[]);assert.equal(p.acknowledgement_required,false);assert.equal(stockStepDone(p),true);
});
test('a stock activity with nothing set shows named gaps; nothing is defaulted',()=>{
 const p=booksPack({activities:[W,K],at:'2026-03-01'});
 assert.equal(p.stock_needed,true);assert.equal(p.acknowledgement_required,true);assert.equal(p.complete,false);
 assert.deepEqual(p.gaps,['Stock update method and count frequency are not set for Wholesale of hardware','No stock categories are set for Wholesale of hardware','VAT categories sold are not set']);
 assert.equal(p.activities[0].policy,null);assert.equal(p.activities[1].needs_stock,false);assert.equal(stockStepDone(p),false);
});
test('the pack uses the latest settings in force on the date and the activity period',()=>{
 const pol=[{activity_id:'a1',inventory_method:'Periodic',count_frequency:'Annually',effective_from:'2026-01-02'},{activity_id:'a1',inventory_method:'Perpetual',count_frequency:'Weekly',effective_from:'2026-06-01'}];
 const cats=[{activity_id:'a1',inventory_use:'Goods for resale',stock_class:'Paint'}];
 const march=booksPack({activities:[W],policies:pol,categories:cats,vatCategories:['16%'],at:'2026-03-01'});
 assert.equal(march.activities[0].policy.inventory_method,'Periodic');assert.equal(march.complete,true);assert.equal(stockStepDone(march),true);
 assert.equal(booksPack({activities:[W],policies:pol,categories:cats,vatCategories:['16%'],at:'2026-07-01'}).activities[0].policy.count_frequency,'Weekly');
 assert.match(booksPack({activities:[W],policies:pol,categories:cats,vatCategories:['16%'],at:'2026-01-01'}).gaps[0],/start on 2026-01-02, after the date this chart applies from/);
 assert.deepEqual(booksPack({activities:[{...W,effective_to:'2026-02-28'}],at:'2026-03-01'}).activities,[],'an ended activity is not part of the pack');
 assert.equal(booksPack({activities:[W],policies:pol,categories:[{activity_id:null,inventory_use:'Other inventory',stock_class:'General'}],vatCategories:['0%'],at:'2026-03-01'}).complete,true,'a client-wide category counts');
});
test('the stock packs are the same list the readiness count uses',()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/functions/staff-workspace-v12/improvement-actions.ts'),'utf8');
 for(const p of STOCK_PACKS)assert.ok(sql.includes(`'${p}'`),p);
});
test('stock is asked in client set-up, between the activities and the chart',()=>{
 assert.deepEqual(SETUP_ORDER,['identity','activity','stock','chart','vat-cats']);assert.equal(nextSetupStep('activity'),'stock');assert.equal(nextSetupStep('stock'),'chart');
 const ui=rd('staff-improvements.mjs');
 assert.match(ui,/stock:\(\)=>stockDone/);assert.match(ui,/next==='stock'\)await stockStep\(id\)/);assert.match(ui,/v3_books_pack_read/);
 assert.match(ui,/policy\(\{step:true\}\)/);assert.match(ui,/options\.step\?afterStep\(id,'stock'\)/);
 assert.match(ui,/staff-books-pack\.mjs\?v=20261119-stock-v1/);assert.match(ui,/staff-setup-order\.mjs\?v=20261119-stock-v1/);
});
test('the approver sees the pack with the chart and must confirm it before approving',()=>{
 const ui=rd('staff-improvements.mjs');
 assert.match(ui,/\$\{booksPackHtml\(r\.books_pack,\{esc,shortDate\}\)\}/);
 assert.match(ui,/name="books_pack_reviewed"/);assert.match(ui,/books_pack_reviewed:f\.has\('books_pack_reviewed'\)/);assert.match(ui,/acknowledgement_required/);
 const esc=x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),shortDate=x=>x;
 const html=booksPackHtml(booksPack({activities:[W],at:'2026-03-01'}),{esc,shortDate});
 assert.match(html,/Books set-up pack/);assert.match(html,/Not set/);assert.match(html,/Still to be set/);assert.match(html,/Wholesale of hardware/);
 assert.ok(BOOKS_PACK_CONFIRM.includes('Books set-up pack'));
 assert.equal(booksPackHtml(null,{esc,shortDate}),'');
});
test('the server requires the confirmation, records what the approver saw, and needs no new table',()=>{
 const ts=rd('supabase/functions/staff-workspace-v12/client-chart.ts');
 assert.match(ts,/pack\.acknowledgement_required&&p\.books_pack_reviewed!==true/);assert.match(ts,/BOOKS_PACK_REVIEWED/);
 assert.ok(!fs.readdirSync(path.join(root,'supabase/migrations')).some(f=>f.startsWith('20261203110000')),'no migration for the Books set-up pack');
});
