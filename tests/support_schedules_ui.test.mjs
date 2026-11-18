import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),shortDate:v=>String(v).slice(0,10),
 field:(n,l,v='',t='text',x='')=>`<label>${l}<input name="${n}" value="${esc(v)}" ${x}></label>`,form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createSchedulesUI}=await import('../staff-schedules.mjs');
let changed=0;
const ui=createSchedulesUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const fd=o=>{const m=new Map(Object.entries(o));return {get:k=>{const v=m.get(k);return Array.isArray(v)?v[0]:v===undefined?null:v;},getAll:k=>{const v=m.get(k);return v===undefined?[]:Array.isArray(v)?v:[v];},has:k=>m.has(k)};};
const click=async(a,id)=>{const el=id?document.querySelector(`[data-sched="${a}"][data-id="${id}"]`):document.querySelector(`[data-sched="${a}"]`);el.click();await new Promise(r=>setTimeout(r,10));};
const kind=(code,title,o={})=>({kind:code,title,categories:['Goods for resale','Raw materials'],source_hint:'The stock count sheet.',has_note:true,note_number:1,relevant:true,state:'Not declared',accounts:[{code:'10100',name:'Stock',amount:250000}],approved:null,draft:null,returned:null,tie:null,can_prefill:false,can_review:false,...o});
const sv=(o={})=>({schedule_id:'s1',version:1,evidence:'Fictional count sheet',lines:[{category:'Goods for resale',description:'Hardware',account:'10100',reference:'',amount:250000}],declared_name:'Assistant One',declared_at:'2026-11-10T08:00:00Z',reviewed_name:null,reviewed_at:null,review_note:null,sole_partner_approval:false,...o});
const base=(o={})=>({version:'support-schedules-v1',kinds:[kind('STOCK','Inventories'),kind('RECEIVABLES','Receivables and prepayments',{note_number:2,can_prefill:true,accounts:[{code:'10060',name:'Trade receivables',amount:320000}]}),kind('LOANS','Borrowings',{has_note:false,note_number:null,relevant:false,state:'No note',accounts:[]})],relevant:2,ok:false,problems:['Inventories (note 1): no supporting schedule.'],locked:false,can_declare:true,max_lines:200,note:'A schedule says what is inside each account of a note.',...o});

test('the screen lists the schedules the year needs, names what is missing and hides a schedule for a note the year does not have',async()=>{
 reply={ledger_schedules_read:base()};await ui.open();
 const t=document.querySelector('#out').textContent;
 assert.match(t,/Inventories \(note 1\)/);assert.match(t,/Receivables and prepayments \(note 2\)/);assert.match(t,/no supporting schedule/);assert.match(t,/Not complete/);assert.doesNotMatch(t,/Borrowings/);
 assert.ok(document.querySelector('[data-sched="declare"][data-id="STOCK"]'));assert.ok(document.querySelector('[data-sched="prefill"][data-id="RECEIVABLES"]'),'a register exists for receivables');assert.equal(document.querySelector('[data-sched="prefill"][data-id="STOCK"]'),null,'stock has no register to start from');
});
test('an approved schedule shows its lines and the tie-out, and a difference is shown against the account',async()=>{
 const tie={ties:false,differences:1,rows:[{account:'10100',name:'Stock',schedule:249000,trial_balance:250000,difference:-1000,ties:false}]};
 reply={ledger_schedules_read:base({kinds:[kind('STOCK','Inventories',{state:'Approved',approved:sv({reviewed_name:'Manager One',reviewed_at:'2026-11-11T08:00:00Z'}),tie})]})};await ui.open();
 const t=document.querySelector('#out').textContent;assert.match(t,/Hardware/);assert.match(t,/approved by Manager One/);assert.match(t,/249,000\.00/);assert.match(t,/-1,000\.00/);assert.ok(document.querySelector('tr.error'));
 reply={ledger_schedules_read:base({ok:true,problems:[],kinds:[kind('STOCK','Inventories',{state:'Approved',approved:sv({reviewed_name:'Manager One'}),tie:{ties:true,differences:0,rows:[{account:'10100',name:'Stock',schedule:250000,trial_balance:250000,difference:0,ties:true}]}})]})};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Agrees/);assert.match(document.querySelector('#out').textContent,/Every schedule needed is approved/);
});
test('declaring sends the lines from the rows that were filled in and skips blank rows',async()=>{
 reply={ledger_schedules_read:base(),ledger_schedule_declare:{schedule_id:'x'}};await ui.open();await click('declare','STOCK');
 const h=shown.at(-1).h;assert.match(h,/name="evidence"/);assert.match(h,/value="10100"/);assert.match(h,/The stock count sheet\./);assert.equal((h.match(/name="d_\d+"/g)||[]).length,8,'eight rows to start');
 await shown.at(-1).submit(fd({evidence:'Fictional count sheet signed at the year end',n:'8',c_0:'Goods for resale',d_0:'Hardware',a_0:'10100',r_0:'Count sheet p1',m_0:'240,000.50',c_1:'Raw materials',d_1:'Timber',a_1:'10100',r_1:'',m_1:'9999.5'}));
 const c=calls.filter(x=>x.action==='ledger_schedule_declare').at(-1);assert.equal(c.kind,'STOCK');assert.equal(c.evidence,'Fictional count sheet signed at the year end');
 assert.deepEqual(c.lines,[{category:'Goods for resale',description:'Hardware',account:'10100',reference:'Count sheet p1',amount:240000.5},{category:'Raw materials',description:'Timber',account:'10100',reference:'',amount:9999.5}]);
 await shown.at(-1).done?.();assert.ok(changed>0);
});
test('starting from the register shows the proposal as editable rows and says nothing is saved yet',async()=>{
 reply={ledger_schedules_read:base(),ledger_schedule_prefill:{kind:'RECEIVABLES',saved:false,note:'These lines are a proposal from the register. Nothing is saved yet.',evidence:'Debtors ageing from the sales register at 2026-12-31.',lines:[{category:'Trade receivables',description:'Customers owing current (0–30 days)',account:'10060',reference:'',amount:116000}]},ledger_schedule_declare:{schedule_id:'x'}};
 const before=calls.filter(x=>x.action==='ledger_schedule_declare').length;await ui.open();await click('prefill','RECEIVABLES');const h=shown.at(-1).h;assert.match(h,/Nothing is saved yet/);assert.match(h,/Customers owing current/);assert.match(h,/Debtors ageing from the sales register/);assert.match(h,/value="116000"/);
 assert.equal(calls.filter(x=>x.action==='ledger_schedule_declare').length,before,'nothing is declared by opening a proposal');
});
test('approving needs another person, and a sole Partner confirms it; returning needs a reason',async()=>{
 const dr=sv({schedule_id:'s9'});
 reply={ledger_schedules_read:base({kinds:[kind('STOCK','Inventories',{state:'Waiting for approval',draft:{...dr,declared_by_me:false},can_review:true})]}),ledger_schedule_review:{status:'Approved'}};await ui.open();
 await click('approve','s9');assert.equal(calls.filter(x=>x.action==='ledger_schedule_review').at(-1).decision,'Approved');assert.equal(calls.filter(x=>x.action==='ledger_schedule_review').at(-1).schedule_id,'s9');
 reply.ledger_schedules_read=base({kinds:[kind('STOCK','Inventories',{state:'Waiting for approval',draft:{...dr,declared_by_me:true},can_review:true})]});await ui.open();
 assert.match(document.querySelector('#out').textContent,/as the only Partner/);await click('approve','s9');assert.match(shown.at(-1).t,/Approve a schedule you declared/);
 await shown.at(-1).submit(fd({sole:'on'}));assert.equal(calls.filter(x=>x.action==='ledger_schedule_review').at(-1).sole_partner_approval,true);
 await ui.open();await click('return','s9');await shown.at(-1).submit(fd({review_note:'The count sheet total is 250,000.'}));const r=calls.filter(x=>x.action==='ledger_schedule_review').at(-1);assert.equal(r.decision,'Returned');assert.equal(r.review_note,'The count sheet total is 250,000.');
});
test('a locked year shows no declare or approve buttons and says why',async()=>{
 reply={ledger_schedules_read:base({locked:true,can_declare:false})};await ui.open();
 assert.match(document.querySelector('#out').textContent,/locked by an audit/);assert.equal(document.querySelector('[data-sched="declare"]'),null);
});
test('the ledger screen offers the schedules beside the PPE register',()=>{
 const s=rd('staff-ledger.mjs');assert.match(s,/btn\('schedules','Supporting schedules'\)/);assert.match(s,/createSchedulesUI/);assert.match(s,/staff-schedules\.mjs\?v=/);
});
