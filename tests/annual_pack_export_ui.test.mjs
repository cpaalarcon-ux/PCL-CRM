import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e])};
const {createPackExportUI}=await import('../staff-pack-export.mjs');
const ui=createPackExportUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h)=>{shown.push({t,h});document.querySelector('#out').innerHTML=h;}});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const click=async a=>{document.querySelector(`[data-packx="${a}"]`).click();await new Promise(r=>setTimeout(r,10));};
const base=(o={})=>({status_word:'Subject to audit',watermark:'SUBJECT TO AUDIT',open_checks:['Audit complete and pack locked'],complete:false,problems:['Report of the directors: not declared yet.'],numbering:{note:'System note numbers are shifted by 3 so the leading wording notes come first.'},
 note_index:[{number:1,title:'General information'},{number:2,title:'Revenue'}],contents:[{code:'COVER',title:'Cover',ready:true},{code:'REPORT',title:'Report of the directors',ready:false}],attachments:[],fingerprint:'abcdef0123456789abcdef',...o});
test('the assembled pack shows the status word, why it is not final, what is not ready and the note sequence',async()=>{
 reply={ledger_pack_assemble_read:base()};await ui.open();
 const t=document.querySelector('#out').textContent;
 assert.match(t,/Subject to audit/);assert.match(t,/Watermark: SUBJECT TO AUDIT/);assert.match(t,/Audit complete and pack locked/);assert.match(t,/not declared yet/);assert.match(t,/Report of the directors\s*Not ready/);assert.match(t,/2\. Revenue/);assert.match(t,/shifted by 3/);assert.match(t,/Pack fingerprint abcdef0123456789/);
 assert.ok(document.querySelector('[data-packx="pdf"]'));assert.ok(document.querySelector('[data-packx="xlsx"]'));
});
test('an audited pack has no watermark and names the attached signed report',async()=>{
 reply={ledger_pack_assemble_read:base({status_word:'Audited',watermark:null,open_checks:[],problems:[],complete:true,attachments:[{file_name:'signed.pdf',sha256:'f'.repeat(64)}]})};await ui.open();
 const t=document.querySelector('#out').textContent;assert.match(t,/Audited/);assert.doesNotMatch(t,/Watermark/);assert.match(t,/Every check passes/);assert.match(t,/signed auditor’s report is added to the PDF exactly as signed \(signed\.pdf/);
});
test('downloading sends the format and saves the file the server returned',async()=>{
 const urls=[];globalThis.URL.createObjectURL=b=>{urls.push(b);return 'blob:x';};globalThis.URL.revokeObjectURL=()=>{};
 reply={ledger_pack_assemble_read:base(),ledger_pack_assemble:{base64:Buffer.from('%PDF-fake').toString('base64'),mime_type:'application/pdf',file_name:'Fictional_Annual_pack_2026-12-31_Subject_to_audit.pdf',status_word:'Subject to audit'}};await ui.open();
 await click('pdf');const c=calls.filter(x=>x.action==='ledger_pack_assemble').at(-1);assert.equal(c.format,'pdf');assert.equal(c.as_of,undefined);assert.equal(urls.length,1);assert.equal(urls[0].type,'application/pdf');assert.match(notices.at(-1)[0],/Subject to audit pack downloaded \(PDF\)/);
 await click('xlsx');assert.equal(calls.filter(x=>x.action==='ledger_pack_assemble').at(-1).format,'xlsx');
 reply.ledger_pack_assemble=async()=>{throw new Error('The signed report could not be read.');};await click('pdf');assert.equal(notices.at(-1)[1],true);assert.match(notices.at(-1)[0],/could not be read/);
});
test('wiring: the annual pack has the button and the cache token',()=>{
 const led=rd('staff-ledger.mjs');assert.match(led,/staff-pack-export\.mjs\?v=20261129-packx-v1/);assert.match(led,/btn\('packx','Assembled pack \(PDF or Excel\)'\)/);assert.match(led,/a==='packx'\)\{await packxScr\(\)\.open\(\);return;\}/);
 const srv=rd('supabase/functions/staff-workspace-v12/ledger-actions.ts');assert.match(srv,/ledger_pack_assemble_read/);assert.match(srv,/packAssembleAction/);
});
