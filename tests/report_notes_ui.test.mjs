import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createReportNotesUI}=await import('../staff-report-notes.mjs');
const ui=createReportNotesUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},defaults:()=>({as_of:'2026-01-31'})});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const fd=o=>{const m=new Map(Object.entries(o));return {get:k=>{const v=m.get(k);return v===undefined?null:v;},has:k=>m.has(k)};};
const click=async(a,id)=>{document.querySelector(`[data-rn="${a}"]${id?`[data-id="${id}"]`:''}`).click();await new Promise(r=>setTimeout(r,10));};
const FIELDS=[{key:'client_highlights',label:'Client highlights',prints:true,help:'What the client should notice. It prints on the report.'},{key:'information_required',label:'Information required',prints:true,help:'What we still need. It prints on the report.'},{key:'internal_notes',label:'Internal notes',prints:false,help:'For the firm only. It never prints.'}];
const nr=(o={})=>({version:'report-notes-v1',report_kind:'Month',as_of:'2026-01-31',fields:FIELDS,current:{version:2,client_highlights:'Sales up.',information_required:'',internal_notes:'Call the director.'},history:[{version:2,saved_name:'A. Staff',saved_at:'2026-02-01T08:00:00Z'},{version:1,saved_name:'A. Staff',saved_at:'2026-01-31T08:00:00Z'}],review:null,can_edit:true,printed_as:{client_highlights:'Sales up.',information_required:'None'},note:'Client highlights print.',...o});
const pk=(o={})=>({pack_id:'k1',pack_kind:'Monthly filing pack',report_kind:'Month',as_of:'2026-01-31',file_format:'xlsx',file_name:'Fictional_Month.xlsx',status_word:'FINAL',fingerprint:'a'.repeat(64),is_final:true,generated_name:'A. Staff',generated_at:'2026-02-01T08:00:00Z',status:'Generated',status_detail:'Every check passed.',signed_via:null,signed_name:null,signed_at:null,sole_partner_approval:false,filed_on:null,filed_reference:null,filed_name:null,...o});
const reg=(items,o={})=>({version:'report-notes-v1',items,summary:{total:items.length,Draft:0,Generated:0,Signed:0,Filed:0},can_sign:true,can_file:true,note:'Each file produced is listed once.',...o});

test('the screen asks for the report and its date, then shows the three notes with what prints',async()=>{
 ui.open();assert.match(shown.at(-1).h,/name="report_kind"/);assert.match(shown.at(-1).h,/value="2026-01-31"/);
 reply={ledger_report_notes_read:nr()};const out=await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'}));assert.equal(calls.at(-1).action,'ledger_report_notes_read');assert.equal(calls.at(-1).report_kind,'Month');
 await shown.at(-1).done(out);const t=document.querySelector('#out').textContent;
 for(const f of ['Client highlights','Information required','Internal notes'])assert.match(t,new RegExp(f));assert.match(t,/Never printed/);assert.match(t,/Prints on the report as/);assert.match(t,/Information required: None/);assert.match(t,/2 saved versions/);
 assert.equal(document.querySelector('textarea[name="internal_notes"]').value,'Call the director.');assert.equal(document.querySelectorAll('textarea').length,3);
});
test('saving sends all three notes for the same report, and says when a signed-off report needs review again',async()=>{
 reply={ledger_report_notes_read:nr(),ledger_report_notes_save:{saved:true,version:3,needs_review:true}};ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));
 await shown.at(-1).submit(fd({client_highlights:'New',information_required:'Bank statement',internal_notes:'Secret'}));
 const c=calls.filter(x=>x.action==='ledger_report_notes_save').at(-1);assert.deepEqual([c.report_kind,c.as_of,c.client_highlights,c.information_required,c.internal_notes],['Month','2026-01-31','New','Bank statement','Secret']);
 await shown.at(-1).done({saved:true,needs_review:true});assert.match(notices.at(-1)[0],/needs reviewing again/);
 reply.ledger_report_notes_save={saved:true,version:4,needs_review:false};await shown.at(-1).done({saved:true,needs_review:false});assert.match(notices.at(-1)[0],/Notes saved/);
});
test('a report that is signed off or waiting warns before the client notes are changed',async()=>{
 reply={ledger_report_notes_read:nr({review:{status:'Approved'}})};ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));
 assert.match(document.querySelector('#out').textContent,/This report is signed off\./);
 reply={ledger_report_notes_read:nr({review:{status:'Submitted'}})};ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));assert.match(document.querySelector('#out').textContent,/waiting for review/);
});
test('a person who cannot edit sees the notes but no way to save',async()=>{
 reply={ledger_report_notes_read:nr({can_edit:false})};ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));
 assert.equal(shown.at(-1).submit,undefined);assert.ok(document.querySelector('textarea[readonly]'));assert.equal(document.querySelector('button[type="submit"]'),null);
});
test('the register shows where each pack stands and offers only the step that is open',async()=>{
 reply={ledger_report_notes_read:nr(),ledger_report_packs_read:reg([pk(),pk({pack_id:'k2',status:'Signed',status_detail:'Signed off through the approved report review.',signed_name:'M. Manager',signed_at:'2026-02-02T08:00:00Z',signed_via:'report review',fingerprint:'b'.repeat(64)}),pk({pack_id:'k3',is_final:false,status:'Draft',status_word:'DRAFT'}),pk({pack_id:'k4',status:'Filed',signed_name:'M. Manager',signed_via:'audit lock',filed_on:'2026-02-05',filed_reference:'Portal acknowledgement 77',filed_name:'A. Staff'})],{summary:{total:4,Draft:1,Generated:1,Signed:1,Filed:1}})};
 ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));await click('register');
 const t=document.querySelector('#out').textContent;assert.match(t,/4 produced · 1 draft · 1 generated · 1 signed · 1 filed/);assert.match(t,/Portal acknowledgement 77/);assert.match(t,/report review/);assert.match(t,/audit lock/);
 assert.equal(document.querySelectorAll('[data-rn="sign"]').length,1,'only the generated pack can be signed');assert.equal(document.querySelectorAll('[data-rn="file"]').length,1,'only the signed pack can be filed');assert.ok(document.querySelector('[data-rn="sign"][data-id="k1"]'));assert.ok(document.querySelector('[data-rn="file"][data-id="k2"]'));
});
test('signing names the file and the person, and the sole Partner confirms on the record',async()=>{
 reply={ledger_report_packs_read:reg([pk()]),ledger_report_pack_sign:{status:'Signed'}};await click('back').catch(()=>{});
 ui.open();reply.ledger_report_notes_read=nr();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));await click('register');await click('sign','k1');
 assert.match(shown.at(-1).h,/under your own name/);assert.match(shown.at(-1).h,/Fictional_Month\.xlsx/);assert.match(shown.at(-1).h,/aaaaaaaaaaaa/);assert.match(shown.at(-1).h,/name="sole_partner_approval"/);
 await shown.at(-1).submit(fd({sole_partner_approval:'on'}));let c=calls.filter(x=>x.action==='ledger_report_pack_sign').at(-1);assert.equal(c.pack_id,'k1');assert.equal(c.sole_partner_approval,true);
 await shown.at(-1).submit(fd({}));c=calls.filter(x=>x.action==='ledger_report_pack_sign').at(-1);assert.equal(c.sole_partner_approval,false);
 await shown.at(-1).done();assert.equal(notices.at(-1)[0],'Signed.');
});
test('filing asks when and where, and sends them with the pack',async()=>{
 reply={ledger_report_notes_read:nr(),ledger_report_packs_read:reg([pk({status:'Signed',signed_name:'M. Manager',signed_via:'report review'})]),ledger_report_pack_file:{status:'Filed'}};
 ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));await click('register');await click('file','k1');
 assert.match(shown.at(-1).h,/name="filed_on"/);assert.match(shown.at(-1).h,/name="reference"/);
 await shown.at(-1).submit(fd({filed_on:'2026-02-05',reference:'Emailed to the director',note:''}));const c=calls.filter(x=>x.action==='ledger_report_pack_file').at(-1);assert.deepEqual([c.pack_id,c.filed_on,c.reference],['k1','2026-02-05','Emailed to the director']);
 await shown.at(-1).done();assert.equal(notices.at(-1)[0],'Recorded as filed.');
});
test('a person without the right sees no sign or file button',async()=>{
 reply={ledger_report_notes_read:nr(),ledger_report_packs_read:reg([pk(),pk({pack_id:'k2',status:'Signed',signed_name:'M',signed_via:'report review'})],{can_sign:false,can_file:false})};
 ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));await click('register');assert.equal(document.querySelectorAll('[data-rn="sign"],[data-rn="file"]').length,0);
});
test('a pack with nothing produced yet says so, and screens escape what they show',async()=>{
 reply={ledger_report_notes_read:nr({current:{version:1,client_highlights:'<script>x</script>',information_required:'',internal_notes:'<img src=x>'},printed_as:{client_highlights:'<script>x</script>',information_required:'None'}}),ledger_report_packs_read:reg([])};
 ui.open();await shown.at(-1).done(await shown.at(-1).submit(fd({report_kind:'Month',as_of:'2026-01-31'})));assert.equal(document.querySelector('#out script'),null);assert.equal(document.querySelector('#out img'),null);assert.match(document.querySelector('#out').textContent,/<script>x<\/script>/);
 await click('register');assert.match(document.querySelector('#out').textContent,/Nothing has been produced yet/);
});
test('the ledger offers it and wires it with a fresh cache token',()=>{
 const s=rd('staff-ledger.mjs');assert.match(s,/createReportNotesUI/);assert.match(s,/staff-report-notes\.mjs\?v=20261201-rnotes-v1/);assert.match(s,/btn\('report-notes','Report notes and packs'\)/);assert.match(s,/a==='report-notes'/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261119-fixes-v1/);
});
