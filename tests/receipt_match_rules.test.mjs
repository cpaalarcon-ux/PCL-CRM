// Suggested matches between bank credits and open sales invoices (build 2784). The database path is in debtors_allocation.test.mjs.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {suggestReceipts,scoreMatch,MIN_SCORE,STRONG_SCORE,WEIGHTS} from '../supabase/functions/staff-workspace-v12/receipt-match-rules.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const inv=(o={})=>({row_id:'s1',invoice:'INV-1001',date:'2026-03-01',customer:'Mlima Fresh Foods Limited',pin:'A123456789B',open:5000,...o});
const rc=(o={})=>({row_id:'b1',date:'2026-03-10',reference:'x',text:'x',remaining:5000,...o});

test('an amount alone is never enough',()=>{
 assert.equal(scoreMatch(rc({text:'MPESA 1234'}),inv()).score,WEIGHTS.amount+WEIGHTS.recent);assert.ok(WEIGHTS.amount+WEIGHTS.recent<MIN_SCORE);
 assert.deepEqual(suggestReceipts({receipts:[rc({text:'MPESA 1234'})],invoices:[inv()]}).suggestions,[]);
 assert.deepEqual(suggestReceipts({receipts:[rc({text:'Mlima Fresh Foods payment',remaining:4000})],invoices:[inv()]}).suggestions,[],'a name alone is not enough either');
});

test('strong, possible and the reasons shown',()=>{
 const a=suggestReceipts({receipts:[rc({text:'PAYMENT INV-1001 MLIMA FRESH FOODS'})],invoices:[inv()]}).suggestions[0];
 assert.equal(a.confidence,'Strong');assert.ok(a.score>=STRONG_SCORE);assert.deepEqual(a.reasons.slice(0,2),['Invoice number appears in the narration','Customer name appears in the narration']);
 const b=suggestReceipts({receipts:[rc({text:'A123456789B rtgs'})],invoices:[inv()]}).suggestions[0];
 assert.equal(b.confidence,'Possible');assert.ok(b.score>=MIN_SCORE&&b.score<STRONG_SCORE);
 const c=suggestReceipts({receipts:[rc({text:'inv 1001 settlement',remaining:2000})],invoices:[inv()]}).suggestions[0];
 assert.match(c.note,/part payment/);assert.equal(c.amount,2000);
});

test('a receipt dated before the invoice is never suggested, matching the allocation rule',()=>{
 assert.deepEqual(suggestReceipts({receipts:[rc({date:'2026-02-01',text:'INV-1001'})],invoices:[inv()]}).suggestions,[]);
});

test('two equally good invoices make both only possible, with a warning',()=>{
 const r=suggestReceipts({receipts:[rc({text:'Mlima Fresh Foods A123456789B'})],invoices:[inv(),inv({row_id:'s2',invoice:'INV-1002',date:'2026-03-02'})]}).suggestions;
 assert.equal(r.length,2);assert.ok(r.every(x=>x.confidence==='Possible'&&/equally well/.test(x.note)));
});

test('settled invoices and used-up credits are ignored; at most three per credit',()=>{
 assert.deepEqual(suggestReceipts({receipts:[rc({text:'INV-1001',remaining:0})],invoices:[inv()]}).suggestions,[]);
 assert.deepEqual(suggestReceipts({receipts:[rc({text:'INV-1001'})],invoices:[inv({open:0})]}).suggestions,[]);
 const many=[1,2,3,4,5].map(i=>inv({row_id:'s'+i,invoice:'INV-'+i+'000',date:'2026-03-0'+i}));
 assert.equal(suggestReceipts({receipts:[rc({text:'Mlima Fresh Foods A123456789B'})],invoices:many}).suggestions.length,3);
});

test('wiring: UI shows pointers only, and the scoring is labelled a default',()=>{
 const ui=rd('staff-ledger.mjs');assert.match(ui,/receipt-suggest/);assert.match(ui,/Suggested matches/);assert.match(ui,/nothing is allocated until you open one/);assert.match(ui,/not a rule a Partner has confirmed/);
 assert.match(ui,/Confirm and allocate/);assert.match(ui,/ledger_receipt_allocate/);
 const src=rd('supabase/functions/staff-workspace-v12/receipt-match-rules.mjs');assert.doesNotMatch(src,/insert|update /i);assert.match(src,/not tax or accounting rules/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261111-bankfixit-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/release.json'),/2026-11-11\.2787/);assert.match(rd('staff-pilot.html'),/2026-11-11\.2787/);
});
