import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),shortDate:v=>String(v).slice(0,10),
 field:(n,l,v='',t='text',x='')=>`<label>${l}<input name="${n}" value="${esc(v)}" ${x}></label>`,form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createWordingUI}=await import('../staff-wording.mjs');
let changed=0;
const ui=createWordingUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const dec=(code,title,o={})=>({code,title,hint:'Say it.',allow_nothing:true,inline:false,state:'Not declared',approved:null,draft:null,returned:null,can_review:false,declared_by_me:false,...o});
const v=(o={})=>({disclosure_id:'d1',version:1,state:'Text',body:'Fictional text.',declared_name:'Assistant One',declared_at:'2026-11-10T08:00:00Z',reviewed_name:null,reviewed_at:null,review_note:null,sole_partner_approval:false,...o});
const base=(o={})=>({sections:[{key:'REPORTING_ENTITY',kind:'standard',group:'General information',title:'Reporting entity',text:'Fictional Co is a company.'},{key:'GOING_CONCERN',kind:'disclosure',group:'Other disclosures',title:'Going concern',text:null}],problems:['"Going concern" has not been declared.'],complete:false,
 disclosures:[dec('GOING_CONCERN','Going concern',{allow_nothing:false}),dec('RELATED_PARTIES','Related party transactions')],order:['GOING_CONCERN','RELATED_PARTIES'],framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',legal_form:'Company',locked:false,can_declare:true,can_order:false,note:'Built from approved wording.',...o});
const click=async(a,id)=>{const el=id?document.querySelector(`[data-wording="${a}"][data-id="${id}"]`):document.querySelector(`[data-wording="${a}"]`);el.click();await new Promise(r=>setTimeout(r,10));};

test('the year shows each disclosure, what is missing, and text that is not ready is not shown as ready',async()=>{
 reply={ledger_wording_read:base()};await ui.open();
 const t=document.querySelector('#out').textContent;
 assert.match(t,/Going concern/);assert.match(t,/Not declared/);assert.match(t,/Not complete/);assert.match(t,/has not been declared/);assert.match(t,/“Nothing to report” is not allowed here/);
 assert.match(t,/Fictional Co is a company/);assert.match(t,/Not ready: see the list above/);
 assert.ok(document.querySelector('[data-wording="declare"][data-id="GOING_CONCERN"]'));assert.equal(document.querySelector('[data-wording="up"]'),null,'only a Manager or Partner can reorder');
 assert.ok(document.querySelector('[data-wording="library"]'));
});
test('a declaration with nothing to report is offered only where it is allowed, and sends the state and text',async()=>{
 reply={ledger_wording_read:base(),ledger_disclosure_declare:{disclosure_id:'x'}};await ui.open();
 await click('declare','GOING_CONCERN');let h=shown.at(-1).h;assert.doesNotMatch(h,/Nothing to report/);
 await ui.open();await click('declare','RELATED_PARTIES');h=shown.at(-1).h;assert.match(h,/Nothing to report/);
 const f=new Map([['state','Nothing to report'],['body','']]);f.has=k=>f.get(k)!==undefined;
 await shown.at(-1).submit({get:k=>f.get(k),has:k=>f.has(k)});
 const c=calls.filter(x=>x.action==='ledger_disclosure_declare').at(-1);assert.equal(c.code,'RELATED_PARTIES');assert.equal(c.state,'Nothing to report');assert.equal(c.body,undefined);
 await shown.at(-1).done?.();assert.ok(changed>0);
});
test('a disclosure waiting for approval shows Approve and Return only to a reviewer; one the reviewer declared needs the sole-Partner confirmation',async()=>{
 const d=dec('GOING_CONCERN','Going concern',{state:'Waiting for approval',draft:v(),can_review:true});
 reply={ledger_wording_read:base({disclosures:[d]}),ledger_disclosure_review:{status:'Approved'}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Waiting for approval/);
 await click('approve','d1');const r=calls.filter(x=>x.action==='ledger_disclosure_review').at(-1);assert.equal(r.decision,'Approved');assert.equal(r.disclosure_id,'d1');assert.equal(r.sole_partner_approval,undefined);
 reply={ledger_wording_read:base({disclosures:[{...d,declared_by_me:true}]})};await ui.open();
 assert.match(document.querySelector('[data-wording="approve"]').textContent,/only Partner/);await click('approve','d1');assert.match(shown.at(-1).h,/only Partner/);
 reply={ledger_wording_read:base({disclosures:[{...d,can_review:false}]})};await ui.open();assert.equal(document.querySelector('[data-wording="approve"]'),null);
});
test('an approved disclosure shows its text, who approved it, and a pending newer version',async()=>{
 const d=dec('RELATED_PARTIES','Related party transactions',{state:'Approved',approved:v({state:'Nothing to report',body:null,reviewed_name:'Manager One',reviewed_at:'2026-11-11T08:00:00Z'}),draft:v({disclosure_id:'d2',version:2})});
 reply={ledger_wording_read:base({disclosures:[d],complete:true,problems:[]})};await ui.open();
 const t=document.querySelector('#out').textContent;assert.match(t,/Nothing to report\./);assert.match(t,/approved by Manager One/);assert.match(t,/approved text stands until then/);assert.match(t,/All wording and disclosures approved/);
});
test('a Manager can reorder; each move sends the whole new order',async()=>{
 reply={ledger_wording_read:base({can_order:true}),ledger_disclosure_order:{order:[]}};await ui.open();
 assert.ok(document.querySelector('[data-wording="up"][data-id="GOING_CONCERN"]').disabled,'the first cannot move up');
 await click('down','GOING_CONCERN');assert.deepEqual(calls.filter(x=>x.action==='ledger_disclosure_order').at(-1).codes,['RELATED_PARTIES','GOING_CONCERN']);
});
test('a locked year says so and offers no changes',async()=>{
 reply={ledger_wording_read:base({locked:true,can_declare:false,can_order:false})};await ui.open();
 assert.match(document.querySelector('#out').textContent,/locked by an audit/);assert.equal(document.querySelector('[data-wording="declare"]'),null);
});
const entry=(code,o={})=>({code,variant:'All',title:code,group:'Accounting policies',applies_when:null,forms:null,review_hint:null,built_in:'Built-in draft text for the entry.',state:'Not prepared',approved:null,draft:null,returned:null,drafted_by_me:false,...o});
const lw=(o={})=>({framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',has_built_in:true,entries:[entry('POLICY_CASH'),entry('POLICY_REVENUE',{review_hint:'Compare with the edition.'})],can_prepare:true,can_review:false,note:'The built-in text is a draft.',approved_count:0,total:2,...o});
test('the library offers to prepare every built-in draft and says nothing is used until a Partner approves it',async()=>{
 reply={ledger_wording_read:base(),wording_library_read:lw(),wording_library_prepare_all:{prepared:2}};await ui.open();await click('library');
 let t=document.querySelector('#out').textContent;assert.match(t,/0 of 2 approved/);assert.match(t,/not used until a Partner approves it/);assert.match(t,/Compare with the edition/);
 assert.equal(calls.filter(x=>x.action==='wording_library_read').at(-1).edition,'Third Edition (2025)');
 await click('lib-prepare-all');assert.equal(calls.filter(x=>x.action==='wording_library_prepare_all').at(-1).framework,'IFRS for SMEs Accounting Standard');assert.match(notices.at(-1)[0],/2 built-in drafts prepared/);
 assert.equal(document.querySelector('[data-wording="lib-approve"]'),null,'a Manager cannot approve');
});
test('a Partner selects drafts to approve in one step; a draft they prepared needs the sole-Partner confirmation',async()=>{
 const drafts=lw({can_review:true,entries:[entry('POLICY_CASH',{state:'Waiting for a Partner',draft:{wording_id:'w1',version:1,origin:'Built-in draft',body:'Cash text.',prepared_name:'Manager One',prepared_at:'2026-11-10T08:00:00Z'}}),entry('POLICY_PAYABLES',{state:'Waiting for a Partner',draft:{wording_id:'w2',version:1,origin:'Edited',body:'Payables text.',prepared_name:'Partner One',prepared_at:'2026-11-10T08:00:00Z'}})]});
 reply={ledger_wording_read:base(),wording_library_read:drafts,wording_library_review:{reviewed:[]}};await ui.open();await click('library');
 await click('lib-approve');assert.match(notices.at(-1)[0],/Select the wording/);assert.equal(notices.at(-1)[1],true);
 document.querySelector('[data-wsel][value="w1"]').checked=true;await click('lib-approve');
 const r=calls.filter(x=>x.action==='wording_library_review').at(-1);assert.deepEqual(r.wording_ids,['w1']);assert.equal(r.decision,'Approved');assert.equal(r.sole_partner_approval,undefined);
 reply.wording_library_read={...drafts,entries:drafts.entries.map(e=>e.code==='POLICY_PAYABLES'?{...e,drafted_by_me:true}:e)};await click('back');await click('library');
 document.querySelector('[data-wsel][value="w2"]').checked=true;await click('lib-approve');assert.match(shown.at(-1).h,/only Partner/);
 document.querySelector('#out').innerHTML=shown.at(-1).h;
});
test('wiring: the annual pack has the button, the cache token and the build label agree',()=>{
 const led=rd('staff-ledger.mjs'),v6=rd('staff-workspace-v6.mjs');
 assert.match(led,/staff-wording\.mjs\?v=20261126-wording-v1/);assert.match(led,/btn\('wording','Wording and disclosures'\)/);assert.match(led,/a==='wording'\)\{await wordScr\(\)\.open\(\);return;\}/);
 assert.match(v6,/staff-ledger\.mjs\?v=20261129-packx-v1/);
 assert.equal(JSON.parse(rd('supabase/functions/staff-workspace-v12/release.json')).build,'2026-11-14.2885');assert.match(rd('staff-pilot.html'),/data-build="2026-11-14\.2885"/);
});
