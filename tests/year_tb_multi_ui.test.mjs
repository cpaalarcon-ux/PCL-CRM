import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createTbMultiUI}=await import('../staff-tb-multi.mjs');
let changed=0;
const ui=createTbMultiUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const fd=o=>{const m=new Map(Object.entries(o));return {get:k=>{const v=m.get(k);return v===undefined?null:v;},has:k=>m.has(k)};};
const click=async a=>{document.querySelector(`[data-tbm="${a}"]`).click();await new Promise(r=>setTimeout(r,10));};
const yr=(o={})=>({as_of:'2025-12-31',role:'Year-end',expected:true,rows:5,total_debit:1200,total_credit:1200,difference:0,balanced:true,mapped_accounts:5,unmapped_accounts:0,unmapped_amount:0,unmapped:[],unmapped_more:0,unknown_accounts:0,duplicates:[],replaces:null,same_as_recorded:false,problems:[],state:'Ready',can_save:true,...o});
const pv=(o={})=>({version:'year-tb-multi-v1',ok:true,can_save:true,needs_unmapped_ack:false,parse_errors:[],years:[yr({as_of:'2024-12-31',role:'Opening',rows:3}),yr()],expected:{year_end:'2025-12-31',opening:'2024-12-31'},problems:[],warnings:[],closing_note:'Year-end columns are recorded as year-end trial balances.',saved:false,...o});
const TEXT='Code\t31/12/2024\t31/12/2025\n10000\t200\t600';

test('the entry form asks for the paste and sends it to be checked, recording nothing',async()=>{
 await ui.open();assert.match(shown.at(-1).h,/name="text"/);assert.match(shown.at(-1).h,/Nothing is recorded until you have seen the check/);
 reply={ledger_tb_multi_preview:pv()};const out=await shown.at(-1).submit(fd({text:TEXT}));
 assert.equal(calls.at(-1).action,'ledger_tb_multi_preview');assert.equal(calls.at(-1).text,TEXT);assert.equal(calls.filter(c=>c.action==='ledger_tb_multi_save').length,0);
 await shown.at(-1).done(out);const t=document.querySelector('#out').textContent;
 assert.match(t,/Opening trial balance/);assert.match(t,/Year-end trial balance/);assert.match(t,/Balanced/);assert.match(t,/Expected for this year: a year-end trial balance as of 2025-12-31 and an opening trial balance as of 2024-12-31/);
});
test('each year shows its balance, its mapped and unmapped accounts, and what it replaces',async()=>{
 const x=pv({needs_unmapped_ack:true,years:[yr({as_of:'2024-12-31',role:'Opening',replaces:{version:2}}),yr({unmapped_accounts:1,mapped_accounts:4,unmapped_amount:50,unmapped:[{code:'60000',name:'Other costs',amount:50}],state:'Accounts not mapped'})],warnings:['1 account balance(s) have no approved statement line (2025-12-31).']});
 await ui.open();await shown.at(-1).done(x);const t=document.querySelector('#out').textContent;
 assert.match(t,/Version 2/);assert.match(t,/Accounts not mapped/);assert.match(t,/1 account\(s\) with no approved statement line \(KES 50\.00 in balances\)/);assert.match(t,/60000 Other costs 50\.00/);assert.match(t,/To know before recording/);
 assert.ok(document.querySelector('input[name="accept_unmapped"]'),'an unmapped account has to be acknowledged');
});
test('a year that is blocked shows what to fix and offers no way to record',async()=>{
 const x=pv({can_save:false,ok:false,years:[yr({state:'Blocked',balanced:false,difference:100,can_save:false,problems:['Does not balance.']})],problems:['2025-12-31: Does not balance: debits KES 1,200.00, credits KES 1,100.00 (difference KES 100.00).']});
 await ui.open();await shown.at(-1).done(x);const t=document.querySelector('#out').textContent;assert.match(t,/Fix before recording/);assert.match(t,/Does not balance/);assert.match(t,/Out by 100\.00/);
 assert.equal(document.querySelector('input[name="source_reference"]'),null);assert.ok(document.querySelector('[data-tbm="again"]'));
 await click('again');assert.match(shown.at(-1).h,/name="text"/);assert.match(shown.at(-1).h,/Code/,'the paste is kept for correction');
});
test('a paste that cannot be read shows the reasons and nothing else',async()=>{
 await ui.open();await shown.at(-1).done(pv({can_save:false,ok:false,years:[],parse_errors:['Header column 3: "Total" is not a balance date.'],problems:['Header column 3: "Total" is not a balance date.']}));
 const t=document.querySelector('#out').textContent;assert.match(t,/"Total" is not a balance date/);assert.doesNotMatch(t,/Fix before recording/);
});
test('recording sends the same text again with the source and the taken-state, and refreshes the comparatives',async()=>{
 reply={ledger_tb_multi_preview:pv(),ledger_tb_multi_save:{ok:true,saved:true,recorded:[]}};await ui.open();const out=await shown.at(-1).submit(fd({text:TEXT}));await shown.at(-1).done(out);
 assert.match(shown.at(-1).h,/name="closing_state"/);assert.match(shown.at(-1).h,/Record 2 years/);
 await shown.at(-1).submit(fd({closing_state:'After year-end close',source_reference:'Signed accounts for 2024 and 2025 dated 30 April 2026'}));
 const c=calls.filter(x=>x.action==='ledger_tb_multi_save').at(-1);assert.equal(c.text,TEXT);assert.equal(c.closing_state,'After year-end close');assert.equal(c.source_reference,'Signed accounts for 2024 and 2025 dated 30 April 2026');assert.equal(c.accept_unmapped,false);
 await shown.at(-1).done();assert.ok(changed>0);
 await ui.open();await shown.at(-1).done(pv({needs_unmapped_ack:true}));await shown.at(-1).submit(fd({closing_state:'Before year-end close',source_reference:'Signed accounts dated 30 April 2026',accept_unmapped:'on'}));assert.equal(calls.filter(x=>x.action==='ledger_tb_multi_save').at(-1).accept_unmapped,true);
});
test('only opening columns need no taken-state question',async()=>{
 await ui.open();await shown.at(-1).done(pv({years:[yr({as_of:'2024-12-31',role:'Opening'})]}));assert.equal(document.querySelector('select[name="closing_state"]'),null);
});
test('the comparatives screen offers it and the ledger wires it with a fresh cache token',()=>{
 assert.match(rd('staff-year-tbs.mjs'),/btn\('tb-multi','Record several years at once'\)/);const s=rd('staff-ledger.mjs');assert.match(s,/createTbMultiUI/);assert.match(s,/staff-tb-multi\.mjs\?v=/);assert.match(s,/a==='tb-multi'/);assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261119-ppe-v1/);
});
test('screens escape what they show',async()=>{
 await ui.open();await shown.at(-1).done(pv({years:[yr({unmapped_accounts:1,unmapped:[{code:'<b>1</b>',name:'<script>x</script>',amount:1}],state:'Accounts not mapped'})],parse_errors:[],warnings:['<img src=x>']}));
 assert.equal(document.querySelector('#out script'),null);assert.equal(document.querySelector('#out img'),null);assert.match(document.querySelector('#out').textContent,/<script>x<\/script>/,'shown as text');assert.match(document.querySelector('#out').textContent,/<b>1<\/b>/);
});
