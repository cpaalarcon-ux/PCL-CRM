import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {booksPack,stockStepDone,STOCK_PACKS,provisionalNote,parseProvisional,cleanReason,PROVISIONAL_MARK} from '../supabase/functions/staff-workspace-v12/books-pack-rules.mjs';
import {SETUP_ORDER,nextSetupStep} from '../staff-setup-order.mjs';
import {booksPackHtml,booksGapBanner,provisionalNoteHtml,approvalModalHtml,bindReasonGate,missingItems,BOOKS_PACK_CONFIRM} from '../staff-books-pack.mjs';
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
const esc=x=>String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),shortDate=x=>x;
test('the approver sees a warning banner at the top, naming each missing setting per activity',()=>{
 const ui=rd('staff-improvements.mjs');
 assert.match(ui,/const head=`\$\{booksGapBanner\(r\.books_pack,\{esc\}\)\}/,'the banner is the first thing on every chart screen');
 assert.match(ui,/booksPackHtml\(r\.books_pack,\{esc,shortDate,banner:false\}\)/,'the pack does not repeat the banner on the chart screens');
 const pack=booksPack({activities:[W,{...W,activity_id:'a3',activity_name:'Retail shop',pack_code:'Retail'},K],policies:[{activity_id:'a3',inventory_method:'Periodic',count_frequency:'Monthly',effective_from:'2026-01-02'}],at:'2026-03-01'});
 assert.deepEqual(missingItems(pack),[{activity:'Wholesale of hardware',items:['Stock update method','Count frequency','Stock categories']},{activity:'Retail shop',items:['Stock categories']},{activity:'The client',items:['VAT categories sold']}]);
 const b=booksGapBanner(pack,{esc});
 assert.match(b,/notice warn/);assert.match(b,/role="alert"/);assert.match(b,/Warning: stock settings are incomplete/);assert.match(b,/Wholesale of hardware<\/b>: Stock update method, Count frequency, Stock categories not set/);assert.match(b,/Retail shop<\/b>: Stock categories not set/);assert.match(b,/VAT categories sold not set/);assert.match(b,/still approve/);
 assert.equal(booksGapBanner(booksPack({activities:[K],at:'2026-03-01'}),{esc}),'','no warning when nothing is missing');
 assert.equal(booksGapBanner(null,{esc}),'');
 const full=booksPackHtml(pack,{esc,shortDate});assert.ok(full.indexOf('Warning: stock settings')<full.indexOf('<table'),'banner sits at the top of the pack');
 assert.ok(!booksPackHtml(pack,{esc,shortDate,banner:false}).includes('Warning: stock settings'));
 assert.equal(booksPackHtml(null,{esc,shortDate}),'');assert.ok(BOOKS_PACK_CONFIRM.includes('Books set-up pack'));
});
test('pressing Approve with stock settings missing opens a reason modal; Confirm Approval is disabled until the reason is long enough',()=>{
 const ui=rd('staff-improvements.mjs');
 assert.match(ui,/function gateProvisional\(r,id\)/);assert.match(ui,/gateProvisional\(r,id\);return;\}/);
 assert.match(ui,/fd\.get\('status'\)!=='Approved'\)return normal\.call\(f,e\)/,'a Return decision is not gated');
 assert.match(ui,/show\('Approve with stock settings provisional',approvalModalHtml\(r\.books_pack,\{esc\}\)/);assert.match(ui,/stock_gap_reason:g\.get\('stock_gap_reason'\)/);assert.match(ui,/bindReasonGate\(\$\('#editForm'\)\)/);
 assert.match(ui,/missingItems\(r\.books_pack\)\.length\?'<p class="info full">Stock settings are missing/,'the earlier tick is replaced by the reason when settings are missing');
 assert.match(ui,/r\.books_pack\?\.acknowledgement_required\?`<label class="full"><input type="checkbox" name="books_pack_reviewed">/,'the tick stays when nothing is missing');
 const pack=booksPack({activities:[W],at:'2026-03-01'}),html=approvalModalHtml(pack,{esc});
 assert.match(html,/These stock settings are missing/);assert.match(html,/Wholesale of hardware/);assert.match(html,/id="confirmApproval" disabled>Confirm Approval/);assert.match(html,/name="stock_gap_reason"[^>]*minlength="10"[^>]*required|minlength="10"[^>]*name="stock_gap_reason"/);
 const box={value:'',listeners:{},addEventListener(t,f){this.listeners[t]=f;}},btn={disabled:false};
 bindReasonGate({querySelector:q=>q.includes('stock_gap_reason')?box:q==='#confirmApproval'?btn:null});
 assert.equal(btn.disabled,true,'disabled at the start');
 for(const [v,off] of [['too short',true],['         x         ',true],['123456789',true],['1234567890',false],['Client will send the count policy',false]]){box.value=v;box.listeners.input();assert.equal(btn.disabled,off,JSON.stringify(v));}
 box.value='short';box.listeners.input();assert.equal(btn.disabled,true,'goes back to disabled when the reason is shortened');
});
test('the recorded warning is shown afterwards in the pack and the stock step',()=>{
 const n={reason:'Client has not sent the count policy',by:'Fictional Partner',at:'2026-11-19',missing:['No stock categories for Wholesale'],resolved:false};
 const h=provisionalNoteHtml(n,{esc,shortDate});assert.match(h,/Approved with stock settings provisional:<\/b> Client has not sent the count policy · by Fictional Partner, 2026-11-19/);assert.match(h,/Still to be resolved/);
 assert.match(provisionalNoteHtml({...n,resolved:true},{esc,shortDate}),/complete now/);assert.equal(provisionalNoteHtml(null,{esc,shortDate}),'');
 assert.match(booksPackHtml({...booksPack({activities:[W],at:'2026-03-01'}),provisional_note:n},{esc,shortDate}),/Approved with stock settings provisional/);
 const ui=rd('staff-improvements.mjs');assert.match(ui,/booksPackHtml\(pack,\{esc,shortDate\}\)\+\(lead/,'the stock step shows the pack, with the warning, to the staff who set the stock data');
});
test('the provisional note round-trips and cannot be forged by a typed note',()=>{
 const stored=provisionalNote('Chart checked and fine.',['No stock categories are set for A','VAT categories sold are not set'],'  Client   will send\nthe policy ');
 assert.match(stored,/^Chart checked and fine\.\n\n\[Stock settings provisional\] Reason: Client will send the policy\nMissing: /);
 assert.deepEqual(parseProvisional(stored),{reason:'Client will send the policy',missing:['No stock categories are set for A','VAT categories sold are not set']});
 assert.equal(parseProvisional('Chart checked and fine.'),null);assert.equal(parseProvisional(null),null);assert.equal(cleanReason(' a\n\n b '),'a b');
 const ts=rd('supabase/functions/staff-workspace-v12/client-chart.ts');assert.match(ts,/note\.includes\(PROVISIONAL_MARK\)\)fail/);
});
test('the server computes the missing list itself, never blocks, records the reason, and needs no new table',()=>{
 const ts=rd('supabase/functions/staff-workspace-v12/client-chart.ts');
 assert.match(ts,/pack=await booksPackFor\(tx,v\.client_id,day\(v\.effective_from\)\)/);assert.ok(!/p\.(missing|stock_gaps|gaps)/.test(ts),'no missing list is read from the request');
 assert.match(ts,/stockReason=cleanReason\(p\.stock_gap_reason\)/);assert.match(ts,/BOOKS_PACK_REVIEWED/);assert.match(ts,/provisional:pack\.gaps\.length>0/);assert.match(ts,/provisionalNote\(note,pack\.gaps,stockReason\)/);
 assert.ok(!fs.readdirSync(path.join(root,'supabase/migrations')).some(f=>f.startsWith('20261203110000')),'no migration for the Books set-up pack');
});
