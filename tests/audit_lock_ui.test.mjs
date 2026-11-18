import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),shortDate:v=>String(v).slice(0,10),
 field:(n,l,v='',t='text',x='')=>`<label>${l}<input name="${n}" type="${t}" value="${esc(v)}" ${x}></label>`,form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createAuditLockUI}=await import('../staff-audit-lock.mjs');
let changed=0;
const ui=createAuditLockUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const base={state:{status:'not_declared',label:'Audit arrangement not recorded',required:false,locked:false,stale:false,mode:null},check:{status:'Info',detail:'No audit is recorded for this year.'},wording:'Draft',arrangement:null,lock:null,history:[],
 notes:{status:'approved',approved_name:'Partner One',approved_at:'2026-11-11T08:00:00Z',ok:true},candidates:{audit_files:[],documents:[]},opinions:['Unmodified','Qualified','Adverse','Disclaimer of opinion'],arrangements:['In-house audit','External audit','Not audited'],
 can_declare:true,can_lock:true,can_end:false,problems:[]};
const click=async a=>{document.querySelector(`[data-audit="${a}"]`).click();await new Promise(r=>setTimeout(r,10));};
const txt=()=>document.querySelector('#out').textContent;
test('the screen says the statements are a draft and whether the notes are approved',async()=>{
 reply={ledger_audit_read:base};await ui.open();
 assert.match(txt(),/Statements: Draft/);assert.match(txt(),/Notes approved by Partner One on 2026-11-11/);assert.match(txt(),/Audit arrangement not recorded/);assert.ok(document.querySelector('[data-audit="declare"]'));
 reply={ledger_audit_read:{...base,notes:{status:'draft',ok:false},can_lock:false}};await ui.open();
 assert.match(txt(),/has not approved the current notes/);assert.equal(document.querySelector('[data-audit="lock"]'),null);
});
test('recording the arrangement sends the choice',async()=>{
 reply={ledger_audit_read:base,ledger_audit_declare:{mode:'External audit'}};await ui.open();await click('declare');
 const f=shown.at(-1);assert.match(f.h,/Not audited/);await f.submit({get:k=>({mode:'External audit',note:''}[k])});
 const c=calls.filter(x=>x.action==='ledger_audit_declare').at(-1);assert.equal(c.mode,'External audit');
});
test('in-house: Lock with In-house Audit offers only completed files, and a preparer who is the sole Partner must say so',async()=>{
 const files=[{audit_file_id:'f1',file_status:'Approved',reporting_framework:'IFRS for SMEs',starts_on:'2026-01-01',ends_on:'2026-12-31',prepared_name:'Manager One',complete:true,prepared_by_me:false},{audit_file_id:'f2',file_status:'Draft',reporting_framework:'x',starts_on:'2026-01-01',ends_on:'2026-12-31',prepared_name:'M',complete:false,prepared_by_me:false}];
 reply={ledger_audit_read:{...base,state:{...base.state,status:'ready',mode:'In-house audit',required:true},check:{status:'Blocked',detail:'The audit file is complete.'},candidates:{audit_files:files,documents:[]}},ledger_audit_lock:{lock_id:'l1'}};await ui.open();
 assert.match(txt(),/Lock with In-house Audit/);await click('lock');const f=shown.at(-1);assert.match(f.h,/f1/);assert.doesNotMatch(f.h,/f2/);assert.doesNotMatch(f.h,/only Partner/);
 await f.submit({get:k=>({audit_file_id:'f1',opinion:'Unmodified',report_reference:'AR-1',report_date:'2026-03-01'}[k]),has:()=>false});
 const c=calls.filter(x=>x.action==='ledger_audit_lock').at(-1);assert.equal(c.mode,'In-house audit');assert.equal(c.audit_file_id,'f1');assert.equal(c.sole_partner_approval,false);
 reply.ledger_audit_read.candidates.audit_files[0].prepared_by_me=true;await ui.open();await click('lock');assert.match(shown.at(-1).h,/only Partner/);
});
test('external: Upload External Audit Report and Lock needs a PDF in the vault and the auditor',async()=>{
 const st={...base,state:{...base.state,status:'external_pending',mode:'External audit',required:true},check:{status:'Blocked',detail:'The external auditor has not reported.'}};
 reply={ledger_audit_read:{...st,candidates:{audit_files:[],documents:[]}}};await ui.open();assert.match(txt(),/External auditor pending/);assert.match(txt(),/Upload External Audit Report and Lock/);
 const n=notices.length;await click('lock');assert.ok(notices.length>n);assert.equal(notices.at(-1)[1],true,'no PDF yet: a notice, not a form');
 reply={ledger_audit_read:{...st,candidates:{audit_files:[],documents:[{document_id:'d1',file_name:'Signed report.pdf',category:'Final Reports',uploaded_at:'2026-03-02'}]}},ledger_audit_lock:{lock_id:'l2'}};await ui.open();await click('lock');
 const f=shown.at(-1);assert.match(f.h,/Signed report\.pdf/);assert.match(f.h,/required minlength="2"/);
 await f.submit({get:k=>({document_id:'d1',auditor_name:'Fictional Auditors LLP',opinion:'Qualified',report_reference:'EXT-9',report_date:'2026-03-05'}[k])});
 const c=calls.filter(x=>x.action==='ledger_audit_lock').at(-1);assert.equal(c.mode,'External audit');assert.equal(c.document_id,'d1');assert.equal(c.auditor_name,'Fictional Auditors LLP');
});
test('a locked pack shows who locked it and the opinion; only a Partner can end the lock, with a reason',async()=>{
 const lk={lock_id:'l9',mode:'External audit',report_reference:'EXT-9',report_date:'2026-03-05',opinion:'Qualified',auditor_name:'Fictional Auditors LLP',locked_name:'Manager One',locked_at:'2026-03-06T08:00:00Z',sole_partner_approval:false};
 reply={ledger_audit_read:{...base,state:{status:'locked',label:'Audited: external auditor',required:true,locked:true,stale:false,mode:'External audit'},check:{status:'Pass',detail:'Locked.'},wording:'Audited',lock:lk,can_lock:false,can_end:true,can_declare:false},ledger_audit_end:{ended:true}};await ui.open();
 assert.match(txt(),/Statements: Audited/);assert.match(txt(),/Locked by Manager One on 2026-03-06/);assert.match(txt(),/Opinion: Qualified/);assert.equal(document.querySelector('[data-audit="lock"]'),null);
 await click('end');const f=shown.at(-1);assert.match(f.h,/minlength="10"/);await f.submit({get:k=>k==='reason'?'Fictional report withdrawn':null});
 const c=calls.filter(x=>x.action==='ledger_audit_end').at(-1);assert.equal(c.lock_id,'l9');assert.equal(c.reason,'Fictional report withdrawn');
 reply={ledger_audit_read:{...base,state:{status:'stale',label:'Figures changed after the audit was locked',required:true,locked:false,stale:true,mode:'External audit'},check:{status:'Blocked',detail:'The figures or the notes changed after the pack was locked.'},lock:lk,can_lock:false,can_end:true}};await ui.open();
 assert.match(txt(),/Figures changed after the lock/);assert.match(txt(),/Statements: Draft/);
});
test('the ledger screen offers the audit lock and the page module is cache-pinned',()=>{
 const led=fs.readFileSync(new URL('../staff-ledger.mjs',import.meta.url),'utf8'),v6=fs.readFileSync(new URL('../staff-workspace-v6.mjs',import.meta.url),'utf8');
 assert.match(led,/staff-audit-lock\.mjs\?v=20261124-audit-v1/);assert.match(led,/btn\('audit','Audit status and lock'\)/);assert.match(led,/a==='audit'\)\{await auditScr\(\)\.open\(\)/);assert.match(v6,/staff-ledger\.mjs\?v=20261130-tbmulti-v1/);
});
