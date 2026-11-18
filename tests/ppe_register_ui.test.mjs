import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const opt=(items)=>items.map(x=>Array.isArray(x)?x:[x,x]).map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('');
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),shortDate:v=>String(v).slice(0,10),
 field:(n,l,v='',t='text',x='')=>`<label>${l}<input name="${n}" type="${t}" value="${esc(v)}" ${x}></label>`,select:(n,l,items,v='')=>`<label>${l}<select name="${n}">${opt(items)}</select></label>`,form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createPpeUI}=await import('../staff-ppe.mjs');
let changed=0;
const ui=createPpeUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const fd=o=>{const m=new Map(Object.entries(o));return {get:k=>m.get(k),has:k=>m.has(k)};};
const click=async(a,id)=>{const el=id?document.querySelector(`[data-ppe="${a}"][data-id="${id}"]`):document.querySelector(`[data-ppe="${a}"]`);el.click();await new Promise(r=>setTimeout(r,10));};
const rec=(o={})=>({record_id:'r1',version:1,status:'Draft',asset_name:'Fictional delivery van',asset_account:'15100',class_code:'MOTOR',origin:'Added in the year',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:1000000,business_percentage:100,bf_as_of:null,evidence:'Invoice INV-001',prepared_name:'Assistant One',prepared_at:'2026-11-10T08:00:00Z',reviewed_name:null,review_note:null,sole_partner_approval:false,declared_by_me:false,...o});
const asset=(o={})=>({asset_key:'k1',state:'Waiting for approval',approved:null,draft:rec(),returned:null,name:'Fictional delivery van',disposal:{state:'None',approved:null,draft:null,returned:null},can_review:true,can_dispose:false,can_end:false,can_review_disposal:false,can_end_disposal:false,...o});
const row={asset_key:'k1',asset_name:'Fictional delivery van',asset_account:'15100',class_code:'MOTOR',opening_cost:0,additions:1000000,disposal_cost:0,closing_cost:1000000,opening_acc:0,charge:250000,released:0,closing_acc:250000,nbv:750000,tax_opening:0,tax_addition:1000000,tax_allowance:250000,tax_balancing_allowance:0,tax_balancing_charge:0,tax_closing:750000,proceeds:0,gain_loss:0,disposed:false};
const base=(o={})=>({year:{start:'2026-01-01',end:'2026-12-31',open:true},locked:false,register:{rows:[],totals:{},issues:[],policy:['No depreciation is charged in the year of disposal.']},reconciliation:{lines:[],ties:true,differences:0},readiness:{relevant:false,ok:true,problems:[],summary:''},schedule:null,assets:[],candidates:[],
 classes:[{code:'MOTOR',name:'Motor vehicles'}],accounts:[{code:'15100',name:'Motor vehicles'}],origins:['Added in the year','Brought forward'],kinds:['Sold','Scrapped','Lost or stolen','Donated'],can_declare:true,note:'A working schedule.',...o});
test('an empty register says there is nothing to schedule and offers to add an asset',async()=>{
 reply={ledger_ppe_read:base()};await ui.open();const t=document.querySelector('#out').textContent;
 assert.match(t,/No property, plant and equipment this year/);assert.ok(document.querySelector('[data-ppe="add"]'));assert.ok(document.querySelector('[data-ppe="add-bf"]'));assert.match(t,/No assets are recorded/);assert.match(t,/year of disposal/);
 reply={ledger_ppe_read:base({can_declare:false})};await ui.open();assert.equal(document.querySelector('[data-ppe="add"]'),null);
});
test('the register shows book and tax figures, and a difference to the trial balance is shown with the blocking problem',async()=>{
 const totals={opening_cost:0,additions:1000000,disposal_cost:0,closing_cost:1000000,opening_acc:0,charge:250000,released:0,closing_acc:250000,nbv:750000,gain_loss:0,tax_opening:0,tax_allowance:250000,tax_balancing_allowance:0,tax_balancing_charge:0,tax_closing:750000};
 reply={ledger_ppe_read:base({register:{rows:[row],totals,issues:[],policy:[]},readiness:{relevant:true,ok:false,problems:['The register is out by the amounts shown against the trial balance on 1 line.'],summary:''},
  reconciliation:{ties:false,differences:1,lines:[{kind:'Cost',account:'15100',name:'Motor vehicles',register:1000000,trial_balance:1100000,difference:-100000,ties:false},{kind:'Depreciation charge',account:'67030',name:'Depreciation',register:250000,trial_balance:250000,difference:0,ties:true}]},assets:[asset({state:'Approved',approved:rec({status:'Approved'}),draft:null,can_review:false})]})};
 await ui.open();const t=document.querySelector('#out').textContent;
 assert.match(t,/Not ready/);assert.match(t,/out by the amounts/);assert.match(t,/Book values/);assert.match(t,/Tax written-down values/);assert.match(t,/1,000,000\.00/);assert.match(t,/\(100,000\.00\)/);assert.match(t,/Fictional delivery van/);
 assert.equal(document.querySelectorAll('tr.missing').length,1,'only the line that does not agree is marked');
});
test('an asset waiting for approval offers Approve and Return only to a reviewer; the one who declared it needs the sole-Partner confirmation',async()=>{
 reply={ledger_wording_read:undefined,ledger_ppe_read:base({assets:[asset()]}),ledger_ppe_asset_review:{status:'Approved'}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Waiting for approval/);await click('approve','r1');
 const r=calls.filter(x=>x.action==='ledger_ppe_asset_review').at(-1);assert.equal(r.decision,'Approved');assert.equal(r.record_id,'r1');assert.equal(r.sole_partner_approval,undefined);
 reply={ledger_ppe_read:base({assets:[asset({draft:rec({declared_by_me:true})})]})};await ui.open();
 assert.match(document.querySelector('[data-ppe="approve"]').textContent,/only Partner/);await click('approve','r1');assert.match(shown.at(-1).h,/only Partner/);
 reply={ledger_ppe_read:base({assets:[asset({can_review:false})]})};await ui.open();assert.equal(document.querySelector('[data-ppe="approve"]'),null);assert.equal(document.querySelector('[data-ppe="return"]'),null);
});
test('adding an asset, adding one from a purchase, and a brought-forward asset send what the server needs',async()=>{
 reply={ledger_ppe_read:base({candidates:[{source_row_id:'row1',asset_account:'15100',asset_name:'Fictional lorry',acquired_on:'2026-04-02',cost:2000000,supplier:'Fictional Motors Ltd'}]}),ledger_ppe_asset_declare:{record_id:'n1'}};await ui.open();
 await click('add');let h=shown.at(-1).h;assert.doesNotMatch(h,/name="bf_as_of"/);
 await shown.at(-1).submit(fd({asset_name:'Fictional van',asset_account:'15100',class_code:'MOTOR',origin:'Added in the year',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:'1000000',business_percentage:'100',evidence:'Invoice INV-001'}));
 let c=calls.filter(x=>x.action==='ledger_ppe_asset_declare').at(-1);assert.equal(c.asset_name,'Fictional van');assert.equal(c.cost,'1000000');assert.equal(c.source_row_id,undefined);assert.equal(c.noncommercial_vehicle,false);assert.equal(c.bf_as_of,undefined);
 await shown.at(-1).done?.();assert.ok(changed>0);
 await ui.open();await click('from-purchase','row1');h=shown.at(-1).h;assert.match(h,/Fictional lorry/);assert.match(h,/value="2000000"/);
 await shown.at(-1).submit(fd({asset_name:'Fictional lorry',asset_account:'15100',class_code:'MOTOR',origin:'Added in the year',acquired_on:'2026-04-02',first_use_on:'2026-04-02',cost:'2000000',evidence:'Purchase row'}));
 c=calls.filter(x=>x.action==='ledger_ppe_asset_declare').at(-1);assert.equal(c.source_row_id,'row1');
 await ui.open();await click('add-bf');h=shown.at(-1).h;assert.match(h,/name="bf_as_of"/);assert.match(h,/name="bf_accumulated_depreciation"/);assert.match(h,/name="bf_tax_wdv"/);
 await shown.at(-1).submit(fd({asset_name:'Fictional old lorry',asset_account:'15100',class_code:'MOTOR',origin:'Brought forward',acquired_on:'2023-05-01',first_use_on:'2023-05-01',cost:'800000',bf_as_of:'2025-12-31',bf_accumulated_depreciation:'400000',bf_tax_wdv:'300000',evidence:'Prior-year schedule'}));
 c=calls.filter(x=>x.action==='ledger_ppe_asset_declare').at(-1);assert.equal(c.origin,'Brought forward');assert.equal(c.bf_accumulated_depreciation,'400000');assert.equal(c.bf_tax_wdv,'300000');
});
test('an approved asset can be changed as a new version, disposed of, or ended; a disposal waiting for approval is reviewed separately',async()=>{
 const ap=asset({state:'Approved',approved:rec({status:'Approved',reviewed_name:'Manager One'}),draft:null,can_review:false,can_dispose:true,can_end:true});
 reply={ledger_ppe_read:base({assets:[ap]}),ledger_ppe_disposal_declare:{record_id:'d1'},ledger_ppe_asset_end:{status:'Ended'}};await ui.open();
 await click('change','k1');assert.match(shown.at(-1).h,/value="Fictional delivery van"/);await shown.at(-1).submit(fd({asset_name:'Fictional delivery van',asset_account:'15100',class_code:'MOTOR',origin:'Added in the year',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:'1200000',evidence:'Corrected invoice'}));
 assert.equal(calls.filter(x=>x.action==='ledger_ppe_asset_declare').at(-1).asset_key,'k1');
 await ui.open();await click('dispose','k1');await shown.at(-1).submit(fd({kind:'Sold',disposed_on:'2026-11-01',proceeds:'350000',evidence:'Sale invoice SI-9'}));
 const d=calls.filter(x=>x.action==='ledger_ppe_disposal_declare').at(-1);assert.deepEqual([d.asset_key,d.kind,d.disposed_on,d.proceeds],['k1','Sold','2026-11-01','350000']);
 await ui.open();await click('end','k1');await shown.at(-1).submit(fd({reason:'Recorded in error, the asset is not ours.'}));assert.equal(calls.filter(x=>x.action==='ledger_ppe_asset_end').at(-1).asset_key,'k1');
 const dr={record_id:'d9',version:1,status:'Draft',disposed_on:'2026-11-01',proceeds:350000,kind:'Sold',evidence:'Sale invoice SI-9',prepared_name:'Assistant One',reviewed_name:null,review_note:null,declared_by_me:false};
 reply={ledger_ppe_read:base({assets:[{...ap,can_dispose:false,can_end:false,disposal:{state:'Waiting for approval',approved:null,draft:dr,returned:null},can_review_disposal:true}]}),ledger_ppe_disposal_review:{status:'Approved'}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Disposal Sold on 2026-11-01/);await click('d-approve','d9');assert.equal(calls.filter(x=>x.action==='ledger_ppe_disposal_review').at(-1).record_id,'d9');
});
test('the ledger screen offers the register and the new files carry fresh cache tokens',()=>{
 const led=rd('staff-ledger.mjs'),v6=rd('staff-workspace-v6.mjs');
 assert.match(led,/staff-ppe\.mjs\?v=20261128-rates-v1/);assert.match(led,/btn\('ppe','PPE register'\)/);assert.match(led,/a==='ppe'/);assert.match(v6,/staff-ledger\.mjs\?v=20261130-tbmulti-v1/);
});
