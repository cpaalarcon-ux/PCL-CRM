import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createNonEtimsUI} from '../staff-non-etims.mjs';

const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<dialog id="editor"><h2 id="title"></h2><div id="editorBody"></div></dialog><form id="editForm"><div id="neException"></div><button type="submit">Save</button></form>',{url:'https://example.test/staff-pilot'});
globalThis.document=dom.window.document;
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bases=[{basis_id:'b1',basis_code:'NE-TICKET',legal_category:'Travel',label:'Ticket',guidance:'g',legal_reference:'ref',status:'Active',revision:1,used:2}];
const calls=[];
const request=p=>{calls.push(p);if(p.action==='non_etims_bases')return Promise.resolve({bases,categories:['Travel'],can_approve:false,can_edit:false});if(p.action==='non_etims_check')return Promise.resolve({duplicates:{},window_days:30});return Promise.resolve({});};
const shown=[];
const ctx={$,esc,request,data:()=>({documents:[],me:{staff_id:'s1'}}),modal:(title,body,submit,after,options)=>{shown.push({title,body,options});$('#title').textContent=title;$('#editorBody').innerHTML=body;},form:b=>b,field:()=>'',select:()=>'',area:()=>'',check:()=>'',button:(a,l)=>`<button data-x="${a}">${l}</button>`,table:(h,rows)=>`<table>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`,shortDate:x=>x};

test('two instances of the register screen (purchases panel and tax rules page) share one reused list and one Return target',async()=>{
 const a=createNonEtimsUI(ctx),b=createNonEtimsUI(ctx);
 const f=$('#editForm'),row=[{row_id:'r1',source_row:5,normalized:{date:'2026-01-05'}}];
 await a.exceptionFields(f,row,'p1',null);
 await b.exceptionFields(f,row,'p1',null);
 assert.equal(calls.filter(c=>c.action==='non_etims_bases'&&c.light===true).length,1,'the second instance reuses the first instance\'s list');
 const back=()=>{};
 await a.adminBases(back);
 assert.equal(shown.at(-1).options.onBack,back,'Return from the register goes back to the purchases panel that opened it');
 assert.equal(calls.filter(c=>c.action==='non_etims_bases'&&!c.light).length,1,'the full list is read fresh when the register opens');
 await b.exceptionFields(f,row,'p1',null);
 assert.equal(calls.filter(c=>c.action==='non_etims_bases'&&c.light===true).length,2,'opening the register clears the shared copy, so the next mapping form reads again');
});

test('the reused list is never handed to a different signed-in person',async()=>{
 const other=createNonEtimsUI({...ctx,data:()=>({documents:[],me:{staff_id:'s2'}})});
 const before=calls.filter(c=>c.action==='non_etims_bases'&&c.light===true).length;
 await other.exceptionFields($('#editForm'),[{row_id:'r1',source_row:5,normalized:{date:'2026-01-05'}}],'p1',null);
 assert.equal(calls.filter(c=>c.action==='non_etims_bases'&&c.light===true).length,before+1,'a different person asks again');
});

test('a non-leader opening the register sees the list without edit buttons',async()=>{
 const ui=createNonEtimsUI(ctx);await ui.adminBases(null);
 assert.match(shown.at(-1).body,/NE-TICKET/);assert.doesNotMatch(shown.at(-1).body,/ne-new|ne-approve|ne-retire|ne-edit/,'read only for someone who cannot edit');
});

test('the purchases panel has a Non-eTIMS legal bases button for everyone who can open it, with the reason text, and the import result points non-eTIMS rows to it',()=>{
 const acc=rd('staff-accounting.mjs'),v6=rd('staff-workspace-v6.mjs');
 assert.match(acc,/btn\('non-etims-bases','Non-eTIMS legal bases',pid\)/);
 assert.match(acc,/id="neBasesNote"/);assert.match(acc,/Open the list of legal bases to add one for approval; a Partner approves it\./);assert.match(acc,/You can read the approved legal bases here\. A Manager or Partner adds one and a Partner approves it\./);
 assert.match(acc,/if\(a==='non-etims-bases'\)\{const back=id\|\|pid;await nonEtims\.adminBases\(\(\)=>imported\(back\)\);return;\}/,'the button opens the register and Return comes back to the panel');
 assert.match(v6,/t\?\.dataset==='Non-eTIMS'&&result\.new_count/);assert.match(v6,/Next for these non-eTIMS rows:<\/b> each needs an approved legal basis and evidence before it can stay in the working\. VAT is nil\./);assert.match(v6,/data-accounting="non-etims-bases"/);
 assert.match(rd('staff-non-etims.mjs'),/^let basesCopy=null,returnToReview=null;$/m,'the reused list and the Return target are shared by every screen');
});

test('the purchases import intro says what the code does now',()=>{
 const s=rd('staff-standard-purchases.mjs');
 assert.match(s,/Keep all 14 columns in order: A–L are purchase details, M is the ERP routing code and N is the ERP TB item code\./);
 for(const fact of [/routing code and TB code together match a mapping a Partner approved/,/alias a Partner approved/,/Nothing is matched by similar wording/,/stays unmapped as a draft with the reason shown/,/Mapping never approves VAT or posts anything/,/cannot be sent for review until the person who prepared it has opened “Summary of this upload”/,/press the same button again: the same file is not imported twice/,/no VAT column, month names such as Nov or November 2026 are read, and VAT is nil/])assert.match(s,fact);
 assert.doesNotMatch(s,/suggested for staff confirmation|suggested for confirmation/,'the old wording that only suggested codes is gone');
});

test('the intro facts match the code they describe',async()=>{
 const {purchaseUploadHeaders}=await import('../supabase/functions/staff-workspace-v12/purchase-upload.mjs');
 assert.equal(purchaseUploadHeaders.length,14);assert.equal(purchaseUploadHeaders[12],'ERP routing code');assert.equal(purchaseUploadHeaders[13],'ERP TB item code');
 const {gateIssue}=await import('../supabase/functions/staff-workspace-v12/upload-summary-gate-rules.mjs');
 assert.match(gateIssue({kind:'Input VAT',costRowsInPeriod:3,fingerprint:'x',views:[]})||'',/Open "Summary of this upload".*before sending this case for review/,'the gate the intro describes refuses a case sent for review before the summary is opened');
 assert.equal(gateIssue({kind:'Input VAT',costRowsInPeriod:3,fingerprint:'x',views:[{fingerprint:'x'}]}),null);
 const safety=await import('../supabase/functions/staff-workspace-v12/upload-safety-rules.mjs');assert.ok(Object.keys(safety).length>0,'the retry-safety rules the intro describes exist');
 const alias=await import('../supabase/functions/staff-workspace-v12/routing-map-rules.mjs');assert.equal(typeof alias.resolveAlias,'function','approved supplier aliases are resolved exactly, never by similar wording');
});

test('the changed modules carry a new cache token up the chain',()=>{
 assert.match(rd('staff-accounting.mjs'),/staff-non-etims\.mjs\?v=20261119-(?:fixes|drafts2)-v1&rev=20261119-(?:legal|2905)/);assert.match(rd('staff-tax-config.mjs'),/staff-non-etims\.mjs\?v=20261119-(?:fixes|drafts2)-v1&rev=20261119-(?:legal|2905)/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-accounting\.mjs\?v=20261119-(?:fixes|drafts2)-v1&rev=20261119-(?:legal|2905)/);assert.match(rd('staff-workspace-v6.mjs'),/staff-standard-purchases\.mjs\?v=20261119-alias-v1&rev=20261119-(?:legal|2905)/);
 assert.match(rd('staff-pilot.mjs'),/staff-workspace-v6\.mjs\?v=20261119-(?:draft|drafts2)-v1&rev=20261119-(?:legal|2905)/);assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261119-(?:fixes|drafts2)-v1&rev=20261119-(?:legal|2905)/);
 assert.match(rd('staff-suite.mjs'),/staff-tax-config\.mjs\?v=20261119-(?:fixes|drafts2)-v1&rev=20261119-(?:legal|2905)/);assert.match(rd('staff-pilot-auth.js'),/staff-pilot\.mjs\?v=20261114-setupguide-v1&rev=20261119-(?:legal|2905)/);assert.match(rd('staff-pilot.html'),/staff-pilot-auth\.js\?v=20261109-cf-v1&amp;rev=20261119-(?:legal|2905)/);
});
