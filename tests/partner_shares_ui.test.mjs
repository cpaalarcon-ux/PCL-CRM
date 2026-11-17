import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:m=>notices.push(m),shortDate:v=>String(v).slice(0,10),
 field:(n,l,v='',t='text',x='')=>`<label>${l}<input name="${n}" value="${esc(v)}" ${x}></label>`,select:(n,l,o,v)=>`<label>${l}<select name="${n}">${o.map(([a,b])=>`<option value="${esc(a)}">${esc(b)}</option>`).join('')}</select></label>`,form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createPartnerSharesUI}=await import('../staff-partner-shares.mjs');
const ui=createPartnerSharesUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{}});
const set=(v,o={})=>({set_id:'s'+v,version:v,status:'Draft',document_id:null,source_reference:'Deed dated 3 March 2020',entered_name:'Manager One',entered_at:'2026-11-10T08:00:00Z',lines:[{partner_name:'A One',share_bp:6000,percent:'60%'},{partner_name:'B Two',share_bp:4000,percent:'40%'}],...o});
const base={eligible:true,approved:null,draft:null,history:[],documents:[{document_id:'d1',doc_ref:'DOC-1',file_name:'Deed.pdf'}],can_record:true,can_review:false,drafted_by_me:false};
const click=async a=>{document.querySelector(`[data-psh="${a}"]`).click();await new Promise(r=>setTimeout(r,10));};

test('lines of "name, percent" are read the way staff paste them',()=>{
 const {_parseRows}=ui;
 assert.deepEqual(_parseRows('A. Partner, 60\nB Partner\t40%\n\nC Partner | 12.5 %'),[{partner_name:'A. Partner',share_percent:'60'},{partner_name:'B Partner',share_percent:'40%'},{partner_name:'C Partner',share_percent:'12.5 %'}]);
 assert.deepEqual(_parseRows('No percentage here'),[{partner_name:'No percentage here',share_percent:''}]);
});
test('a non-partnership is told shares are not needed; a partnership with nothing recorded is told what is missing',async()=>{
 reply={ledger_partner_shares_read:{eligible:false,message:'Profit shares are recorded for a partnership.'}};await ui.open();assert.match(document.querySelector('#out').textContent,/recorded for a partnership/);
 reply={ledger_partner_shares_read:base};await ui.open();assert.match(document.querySelector('#out').textContent,/No shares are approved for this year/);assert.ok(document.querySelector('[data-psh="record"]'));assert.equal(document.querySelector('[data-psh="approve"]'),null);
});
test('a waiting draft shows its shares and the Partner can approve or return it; recording saves the parsed rows',async()=>{
 reply={ledger_partner_shares_read:{...base,draft:set(1),can_review:true}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/A One60%/);assert.match(document.querySelector('#out').textContent,/Waiting for a Partner/);
 reply.ledger_partner_shares_review={status:'Approved'};await click('approve');
 const rv=calls.filter(c=>c.action==='ledger_partner_shares_review').at(-1);assert.equal(rv.decision,'Approved');assert.equal(rv.set_id,'s1');
 reply.ledger_partner_shares_read={...base,draft:set(1),can_review:true};await ui.open();await click('record');
 const f=shown.at(-1);assert.match(f.h,/at least two partners/i);assert.match(f.h,/A One, 60/,'the last shares are the starting point');
 const fd=new Map([['partners','A One, 55\nB Two, 45'],['document_id','d1'],['ratio_only','on']]);fd.has=k=>fd.has_?.(k);const form={get:k=>fd.get(k)||null,has:k=>k==='ratio_only'};
 reply.ledger_partner_shares_save={set_id:'s2'};await f.submit(form);
 const sv=calls.filter(c=>c.action==='ledger_partner_shares_save').at(-1);assert.equal(sv.ratio_only,true);assert.equal(sv.document_id,'d1');assert.deepEqual(sv.partners,[{partner_name:'A One',share_percent:'55'},{partner_name:'B Two',share_percent:'45'}]);
});
test('a Partner who recorded the shares must confirm they are the only Partner',async()=>{
 reply={ledger_partner_shares_read:{...base,draft:set(2),can_review:true,drafted_by_me:true}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/A different Partner approves them, unless/);
 await click('approve');const f=shown.at(-1);assert.match(f.h,/only Partner/);
 reply.ledger_partner_shares_review={status:'Approved'};await f.submit({get:k=>k==='review_note'?'':null,has:k=>k==='sole'});
 const rv=calls.filter(c=>c.action==='ledger_partner_shares_review').at(-1);assert.equal(rv.sole_partner_approval,true);assert.equal(rv.decision,'Approved');
});
test('the ledger screen offers the shares only when the pack has that check, and the page module is cache-pinned',()=>{
 const led=fs.readFileSync(new URL('../staff-ledger.mjs',import.meta.url),'utf8');
 assert.match(led,/staff-partner-shares\.mjs\?v=20261122-pshare-v1/);assert.match(led,/c\.code==='PARTNER_SHARES'\)\?btn\('partner-shares'/);assert.match(led,/a==='partner-shares'\)\{await psh\(\)\.open\(\)/);
 assert.match(led,/st\.partner_allocation\?/);
});
