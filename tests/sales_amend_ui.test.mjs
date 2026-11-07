import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createSalesAmendUI} from '../staff-sales-amend.mjs';

const ctx={esc:v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),select:()=>'',form:x=>x,request:async()=>({}),notice:()=>{},shortDate:v=>String(v).slice(0,10)};
const button=(a,l)=>`<button data-period-action="${a}">${l}</button>`;
const ui=createSalesAmendUI(ctx,{show:()=>{},button});
const am=(status,can={},extra={})=>({can_request:false,amendments:[{amendment:{status,outcome:'Replace',reason_type:'Wrong month',reason:'Entered as August',requested_by_name:'Asha',requested_at:'2026-11-06',original_totals:{net:1000,vat:160,gross:1160},...extra},journals:[{reference:'SALES-1',status:'Posted',reversal_id:'r1',reversal_status:'Draft'}],next:'Do the next thing.',can:{decide:false,prepare:false,complete:false,cancel:false,...can}}]});

test('a confirmed summary with no open amendment offers Amend this period',()=>{
 assert.match(ui.panel({can_request:true,amendments:[]}),/Amend this period/);
 assert.doesNotMatch(ui.panel({can_request:false,amendments:[]}),/data-period-action="amend-request"/);
 assert.equal(ui.panel(null),'');
});
test('each step shows only the button its person may use, and always says what comes next',()=>{
 const requested=ui.panel(am('Requested',{decide:true,cancel:true}));
 assert.match(requested,/amend-decide/);assert.match(requested,/amend-cancel/);assert.doesNotMatch(requested,/amend-prepare/);assert.match(requested,/Next:<\/b> Do the next thing/);
 assert.match(ui.panel(am('Approved',{prepare:true})),/amend-prepare/);
 const reversing=ui.panel(am('Reversing'));assert.doesNotMatch(reversing,/data-period-action/);assert.match(reversing,/reversal Draft/);
 assert.match(ui.panel(am('Ready',{complete:true},{outcome:'Withdraw'})),/amend-complete/);
});
test('the amendment actions are routed, rights-listed in both catalog copies, and shown on the summary screen',()=>{
 const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
 const idx=read('supabase/functions/staff-workspace-v12/index.ts');assert.match(idx,/salesAmendAction/);
 for(const f of ['staff-rights-catalog.mjs','supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs']){const c=read(f);for(const a of ['sales_amend_read','sales_amend_request','sales_amend_cancel','sales_amend_decide','sales_amend_prepare','sales_amend_complete'])assert.ok(c.includes(a),a+' in '+f);}
 const pi=read('staff-period-imports.mjs');assert.match(pi,/createSalesAmendUI/);assert.match(pi,/sales_amend_read/);assert.match(pi,/amend\.isAction/);
});
