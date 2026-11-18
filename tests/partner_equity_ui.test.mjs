import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),shortDate:v=>String(v).slice(0,10),form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createPartnerEquityUI}=await import('../staff-partner-equity.mjs');
let changed=0;
const ui=createPartnerEquityUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const fd=o=>{const m=new Map(Object.entries(o));return {get:k=>{const v=m.get(k);return v===undefined?null:v;},has:k=>m.has(k)};};
const click=async(a,id)=>{const el=id?document.querySelector(`[data-peq="${a}"][data-id="${id}"]`):document.querySelector(`[data-peq="${a}"]`);el.click();await new Promise(r=>setTimeout(r,10));};
const rows=()=>[{partner_name:'Fictional Amani',capital_opening:600000,capital_movement:50000,current_opening:60000,drawings:120000},{partner_name:'Fictional Zawadi',capital_opening:400000,capital_movement:0,current_opening:40000,drawings:80000}];
const rec=(o={})=>({equity_id:'e1',version:1,evidence:'Fictional partners ledger',rows:rows(),declared_name:'Assistant One',declared_at:'2026-11-10T08:00:00Z',reviewed_name:null,reviewed_at:null,review_note:null,sole_partner_approval:false,...o});
const matrix={columns:['Fictional Amani','Fictional Zawadi','Total'],rows:[{label:'Capital account: balance at the start of the year',cells:[600000,400000,1000000]},{label:'Total partners’ equity at the end of the year',cells:[890000,560000,1450000],total:true}]};
const tie=[{move:'DRAWINGS',label:'Drawings',partners:-200000,statement:-200000,difference:0,ties:true},{move:'CLOSING',label:'Closing equity',partners:1450000,statement:1440000,difference:10000,ties:false}];
const base=(o={})=>({version:'partner-equity-v1',partners:['Fictional Amani','Fictional Zawadi'],shares_status:'approved',approved:null,draft:null,returned:null,statement:null,matrix:null,tie:null,problems:['The partners’ capital and current accounts are not declared and approved.'],equity_rows:[{move:'OPENING',label:'Opening equity',total:1100000}],unit_label:'KES',locked:false,can_declare:true,can_review:false,note:'Enter, for each partner, the balances from the partners’ accounts.',...o});

test('without approved profit shares the screen says so and offers nothing to declare',async()=>{
 reply={ledger_partner_equity_read:base({shares_status:'none',partners:[],can_declare:false})};await ui.open();
 assert.match(document.querySelector('#out').textContent,/profit shares are not approved yet/);assert.equal(document.querySelector('[data-peq="declare"]'),null);
});
test('a year with nothing declared names what is missing and offers to declare',async()=>{
 reply={ledger_partner_equity_read:base()};await ui.open();const t=document.querySelector('#out').textContent;
 assert.match(t,/Not complete/);assert.match(t,/not declared and approved/);assert.match(t,/Fictional Amani, Fictional Zawadi/);assert.match(t,/Opening equity 1,100,000\.00/);assert.ok(document.querySelector('[data-peq="declare"]'));
});
test('an approved record shows the printed statement and the tie-out, and a difference is shown against the movement',async()=>{
 reply={ledger_partner_equity_read:base({approved:rec({reviewed_name:'Manager One',reviewed_at:'2026-11-11T08:00:00Z'}),statement:{built:true,ties:false},matrix,tie,problems:['Closing equity: the partners’ accounts give 1,450,000.00 and the statement of changes in equity 1,440,000.00.']})};await ui.open();
 const t=document.querySelector('#out').textContent;assert.match(t,/approved by Manager One/);assert.match(t,/Total partners’ equity at the end of the year/);assert.match(t,/10,000\.00/);assert.ok(document.querySelector('tr.error'));assert.match(t,/Not complete/);
 reply={ledger_partner_equity_read:base({approved:rec({reviewed_name:'Manager One'}),statement:{built:true,ties:true},matrix,tie:tie.map(x=>({...x,ties:true,difference:0})),problems:[]})};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Approved and agrees to the statement of changes in equity/);
});
test('declaring sends one line per partner with the figures as numbers and never a share of profit',async()=>{
 reply={ledger_partner_equity_read:base(),ledger_partner_equity_declare:{equity_id:'x'}};await ui.open();await click('declare');
 const h=shown.at(-1).h;assert.match(h,/name="evidence"/);assert.match(h,/Fictional Zawadi/);assert.doesNotMatch(h,/name="profit/,'there is no field for the share of profit');
 await shown.at(-1).submit(fd({evidence:'Fictional partners ledger at the year end',n:'2',p_0:'Fictional Amani',capital_opening_0:'600,000',capital_movement_0:'50000',current_opening_0:'60000.50',drawings_0:'120000',p_1:'Fictional Zawadi',capital_opening_1:'400000',capital_movement_1:'0',current_opening_1:'',drawings_1:'80000'}));
 const c=calls.filter(x=>x.action==='ledger_partner_equity_declare').at(-1);assert.equal(c.evidence,'Fictional partners ledger at the year end');
 assert.deepEqual(c.rows[0],{partner_name:'Fictional Amani',capital_opening:600000,capital_movement:50000,current_opening:60000.5,drawings:120000});assert.equal(c.rows[1].current_opening,'','a blank is sent as blank so the server asks for it rather than treating it as nil');
 await shown.at(-1).done?.();assert.ok(changed>0);
});
test('declaring again starts from the last record',async()=>{
 reply={ledger_partner_equity_read:base({approved:rec(),statement:{built:true,ties:true},matrix,tie:[]})};await ui.open();await click('declare');
 const h=shown.at(-1).h;assert.match(h,/value="600000"/);assert.match(h,/Fictional partners ledger/);
});
test('approving needs another person, a sole Partner confirms it, and returning needs a reason',async()=>{
 reply={ledger_partner_equity_read:base({draft:{...rec({equity_id:'e9'}),declared_by_me:false},can_review:true}),ledger_partner_equity_review:{status:'Approved'}};await ui.open();
 await click('approve','e9');const a=calls.filter(x=>x.action==='ledger_partner_equity_review').at(-1);assert.equal(a.decision,'Approved');assert.equal(a.equity_id,'e9');
 reply.ledger_partner_equity_read=base({draft:{...rec({equity_id:'e9'}),declared_by_me:true},can_review:true});await ui.open();
 assert.match(document.querySelector('#out').textContent,/as the only Partner/);await click('approve','e9');assert.match(shown.at(-1).t,/Approve what you declared/);
 await shown.at(-1).submit(fd({sole:'on'}));assert.equal(calls.filter(x=>x.action==='ledger_partner_equity_review').at(-1).sole_partner_approval,true);
 await ui.open();await click('return','e9');await shown.at(-1).submit(fd({review_note:'Drawings are 120,000 in the ledger.'}));const r=calls.filter(x=>x.action==='ledger_partner_equity_review').at(-1);assert.equal(r.decision,'Returned');assert.equal(r.review_note,'Drawings are 120,000 in the ledger.');
});
test('a locked year shows no declare or approve buttons and says why',async()=>{
 reply={ledger_partner_equity_read:base({locked:true,can_declare:false,can_review:false,draft:{...rec(),declared_by_me:false}})};await ui.open();
 assert.match(document.querySelector('#out').textContent,/locked by an audit/);assert.equal(document.querySelector('[data-peq="declare"]'),null);assert.equal(document.querySelector('[data-peq="approve"]'),null);
});
test('the ledger screen offers the partners accounts for a partnership',()=>{
 const s=rd('staff-ledger.mjs');assert.match(s,/btn\('peq','Partners’ capital and current accounts'\)/);assert.match(s,/createPartnerEquityUI/);assert.match(s,/staff-partner-equity\.mjs\?v=/);
});
