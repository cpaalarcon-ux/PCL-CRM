import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
test('the schedule screen draws the server figures, offers only what is allowed, and holds no rate',async()=>{
 const listeners=[];globalThis.document={addEventListener:(t,fn)=>listeners.push(fn),querySelectorAll:()=>[]};
 const {createWhtVatUI,WHTVAT_NOTE}=await import('../staff-whtvat.mjs');
 let html='',reqs=[];const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const data={client_pin:'P051234567Z',rate:{rate:2,label:'Withholding VAT agent',effective_from:'2026-01-01',effective_to:'2026-12-31'},
  schedule:[{line_id:'l1',status:'Active',supplier_name:'Fictional Supplier',supplier_pin:'P000000001A',invoice_no:'0001',invoice_date:'2026-10-06',invoice_net:1000,payment_date:'2026-11-05',rate:2,vat_withheld:20,vat_basis:'KRA purchases CSV'},
   {line_id:'l2',status:'Voided',void_reason:'Paid on a later date.',supplier_name:'Other',supplier_pin:'P000000002B',invoice_no:'0002',invoice_date:'2026-10-07',invoice_net:333.33,payment_date:'2026-11-06',rate:2,vat_withheld:6.67,vat_basis:'Invoice sighted'}],
  schedule_totals:{active:1,exact:20,whole:20},candidates:[{line_id:'c1',invoice_no:'0003',party_name:'Fictional Three',net:500,invoice_date:'2026-10-08'}]};
 const ctx={$:()=>({open:false,classList:{add(){}}}),esc,field:(n,l,v)=>`<input name="${n}" value="${v}">`,select:(n,l,o)=>`<select name="${n}">${o.map(x=>`<option>${esc(x[1])}</option>`).join('')}</select>`,form:h=>h,modal:(t,h)=>{html=h;},request:async x=>{reqs.push(x.action);return data;},notice(){},projectName:()=>'Fictional project'};
 const ui=createWhtVatUI(ctx,{back(){}});await ui.open('p1','2026-11');
 assert.deepEqual(reqs,['whtvat_read']);
 assert.match(html,/Rate in force at the end of 2026-11: <b>2%<\/b>/);assert.match(html,/Fictional Supplier/);assert.match(html,/Voided: Paid on a later date\./);
 assert.match(html,/data-whtvat="void" data-id="l1"/);assert.doesNotMatch(html,/data-whtvat="void" data-id="l2"/,'a voided line offers nothing');
 assert.match(html,/1 line · VAT withheld to the cent <b>20\.00<\/b> · in the KRA file \(whole shillings\) <b>20\.00<\/b>/);
 assert.doesNotMatch(html,/data-whtvat="add"[^>]*disabled/);assert.match(html,/data-whtvat="export"/);
 // With no rule, nothing can be added and the reason is shown instead of a guess.
 data.rate={error:'There is no approved withholding VAT rate covering 2026-11-30.'};data.schedule=[];data.schedule_totals={active:0,exact:0,whole:0};
 await ui.open('p1','2026-11');
 assert.match(html,/There is no approved withholding VAT rate/);assert.match(html,/data-whtvat="add"[^>]*disabled/);assert.match(html,/data-whtvat="manual"[^>]*disabled/);assert.match(html,/data-whtvat="export"[^>]*disabled/);
 assert.match(WHTVAT_NOTE,/rule in force on that date/);
});
test('the screens are wired, the chain is cache-busted, and no rate or formula lives in the browser code',()=>{
 const ui=rd('staff-whtvat.mjs'),wh=rd('staff-withholding.mjs'),cr=rd('staff-credits.mjs');
 assert.match(wh,/staff-whtvat\.mjs\?v=20261116-whtvat-v1/);assert.match(wh,/data-wht="whtvat"|button\('whtvat'/);assert.match(wh,/whtvat\.open\(/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-withholding\.mjs\?v=20261116-whtvat-v1/);assert.match(rd('staff-pilot.mjs'),/staff-workspace-v6\.mjs\?v=20261116-whtvat-v1/);
 assert.match(rd('staff-suite.mjs'),/staff-credits\.mjs\?v=20261116-whtvat-v1/);assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261116-whtvat-v1/);
 for(const a of ['whtvat_read','whtvat_agent_add','whtvat_agent_void','whtvat_agent_export'])assert.match(ui,new RegExp(a));
 assert.match(cr,/whtvat_certificate_line/);assert.match(cr,/whtvat_read/);
 assert.doesNotMatch(ui,/Math\.ceil|Math\.round|\*\s*rate|rate\s*\*/,'the browser shows server amounts; it never computes one');
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/whtvat_/);
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/whtVatAction\(tx,a,p\)/);
 assert.match(rd('supabase/functions/staff-workspace-v12/credit-actions.ts'),/certificateState/);
});
