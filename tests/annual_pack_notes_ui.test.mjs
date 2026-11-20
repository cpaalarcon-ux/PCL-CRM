import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),shortDate:v=>String(v).slice(0,10),
 field:(n,l,v='',t='text',x='')=>`<label>${l}<input name="${n}" value="${esc(v)}" ${x}></label>`,form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createNotesUI}=await import('../staff-notes.mjs');
let changed=0;
const ui=createNotesUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const note={number:1,ref:'REVENUE',title:'Revenue',sections:[{line_code:'PL.REVENUE',label:'Revenue',statement:'Profit or loss',accounts:[{code:'40000',name:'Sales',amount:1000000}],rounding:0,total:1000000,face:1000000,prior:800000,ties:true}],ties:true,control:{source:'Posted trial balance',evidence:'System figures.',prior_year:'Caption only.'}};
const view=(v,o={})=>({set_id:'s'+v,version:v,status:'Draft',digest_matches:true,note_count:1,prepared_name:'Manager One',prepared_at:'2026-11-10T08:00:00Z',reviewed_name:'Partner One',reviewed_at:'2026-11-11T08:00:00Z',review_note:null,sole_partner_approval:false,...o});
const base={notes:[note],unit_label:'KES',problems:[],digest:'d',state:'none',approved:null,draft:null,history:[],can_prepare:true,can_review:false,drafted_by_me:false};
const click=async a=>{document.querySelector(`[data-notes="${a}"]`).click();await new Promise(r=>setTimeout(r,10));};

test('notes are shown by account with their total and the statement they agree to; nothing prepared shows as not prepared',async()=>{
 reply={ledger_notes_read:base};await ui.open();
 const t=document.querySelector('#out').textContent;
 assert.match(t,/Note 1\. Revenue/);assert.match(t,/40000 Sales/);assert.match(t,/Agrees to the statements/);assert.match(t,/Not prepared/);
 assert.ok(document.querySelector('[data-notes="prepare"]'));assert.equal(document.querySelector('[data-notes="approve"]'),null);
});
test('a note that does not agree says so and shows the statements figure',async()=>{
 const bad={...note,ties:false,sections:[{...note.sections[0],ties:false,face:999}]};
 reply={ledger_notes_read:{...base,notes:[bad],problems:['Note 1 Revenue differs.']}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Does not agree: the statements show 999/);assert.match(document.querySelector('#out').textContent,/Note 1 Revenue differs/);
});
test('a Manager can prepare; a Partner sees Approve Notes and Return only for a draft that matches the figures',async()=>{
 reply={ledger_notes_read:{...base,state:'draft',draft:view(1),can_review:true},ledger_notes_prepare:{set_id:'s2'}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Waiting for a Partner/);
 assert.ok(document.querySelector('[data-notes="approve"]'));assert.ok(document.querySelector('[data-notes="return"]'));
 await click('prepare');assert.ok(calls.some(c=>c.action==='ledger_notes_prepare'));assert.ok(changed>0);
 reply={ledger_notes_read:{...base,state:'draft',draft:view(1),can_review:false}};await ui.open();
 assert.equal(document.querySelector('[data-notes="approve"]'),null,'a Manager cannot approve');
});
test('approving a draft someone else prepared sends the decision; the approval and its approver are shown',async()=>{
 reply={ledger_notes_read:{...base,state:'draft',draft:view(3),can_review:true},ledger_notes_review:{status:'Approved'}};await ui.open();
 await click('approve');
 const rv=calls.filter(c=>c.action==='ledger_notes_review').at(-1);assert.equal(rv.decision,'Approved');assert.equal(rv.set_id,'s3');assert.equal(rv.sole_partner_approval,undefined);
 reply={ledger_notes_read:{...base,state:'approved',approved:view(3,{status:'Approved'}),can_prepare:true}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Approved by a Partner/);assert.match(document.querySelector('#out').textContent,/approved by Partner One on 2026-11-11/);
});
test('an approval that no longer matches the figures says so and offers to prepare again',async()=>{
 reply={ledger_notes_read:{...base,state:'stale',approved:view(3,{status:'Approved',digest_matches:false})}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Figures changed since it was prepared/);assert.ok(document.querySelector('[data-notes="prepare"]'));
});
test('a Partner who prepared the notes must confirm they are the only Partner; returning needs a reason',async()=>{
 reply={ledger_notes_read:{...base,state:'draft',draft:view(4),can_review:true,drafted_by_me:true}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/A different Partner approves them, unless/);
 await click('approve');const f=shown.at(-1);assert.match(f.h,/only Partner/);
 reply.ledger_notes_review={status:'Approved'};await f.submit({get:k=>k==='review_note'?'':null,has:k=>k==='sole'});
 const rv=calls.filter(c=>c.action==='ledger_notes_review').at(-1);assert.equal(rv.sole_partner_approval,true);
 reply={ledger_notes_read:{...base,state:'draft',draft:view(5),can_review:true}};await ui.open();await click('return');
 const g=shown.at(-1);assert.match(g.h,/minlength="10"/);await g.submit({get:k=>k==='review_note'?'Wrong depreciation figure':null,has:()=>false});
 const rr=calls.filter(c=>c.action==='ledger_notes_review').at(-1);assert.equal(rr.decision,'Returned');assert.equal(rr.review_note,'Wrong depreciation figure');
});
test('the ledger screen offers the notes and writes the note number on the statements, and the page module is cache-pinned',()=>{
 const led=fs.readFileSync(new URL('../staff-ledger.mjs',import.meta.url),'utf8');
 assert.match(led,/staff-notes\.mjs\?v=20261122-notes-v1/);assert.match(led,/btn\('notes','Notes to the statements'\)/);assert.match(led,/a==='notes'\)\{await notesScr\(\)\.open\(\)/);assert.match(led,/x\.note\?/);
});
