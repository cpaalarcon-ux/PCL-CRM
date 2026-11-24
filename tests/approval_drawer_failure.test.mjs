// Bulk approval failure: the drawer keeps its content, shows the error, and always closes back to the list.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
import {defaultStaffAreas} from '../staff-access-control.mjs';
import {staffReadRequestUrl} from '../staff-read-routing.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const html=await readFile(new URL('../staff-pilot.html',import.meta.url),'utf8');
const dom=new JSDOM(html,{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
for(const key of ['window','document','location','history','sessionStorage','localStorage','FormData','HTMLElement'])globalThis[key]=dom.window[key];
dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
const sid='00000000-0000-4000-8000-000000000001',fid='00000000-0000-4000-8000-000000000002',cid='00000000-0000-4000-8000-000000000003',pid='00000000-0000-4000-8000-000000000004';
const suite=Object.fromEntries(['leads','tax_profiles','rates','staff_rates','budgets','invoices','payments','communications','contacts','compliance','owners','engagements','tax_cases','leave','attendance','credentials','reviews','tickets'].map(k=>[k,[]]));
const me={staff_id:sid,full_name:'Fictional Partner',category_code:'PARTNER',login_id:'qa.partner',allowed_areas:defaultStaffAreas('PARTNER')};
const data={me,firms:[{firm_id:fid,firm_code:'QA',legal_name:'Fictional QA firm'}],staff:[me],staff_firms:[{staff_id:sid,firm_id:fid}],clients:[{client_id:cid,company_name:'Fictional Client',kra_pin:null,missing_fields:['KRA PIN']}],client_firms:[{client_id:cid,firm_id:fid}],projects:[{project_id:pid,client_id:cid,handling_firm_id:fid,project_name:'Fictional Tax Project',service_code:'TAX-COMP',status:'Draft',revision:1}],assignments:[],candidates:[{...me,firm_id:fid}],tasks:[],documents:[],services:[{service_code:'TAX-COMP',service_name:'Tax compilation'}],sectors:[],schedules:[],timesheets:[],notifications:[],task_events:[],workbook_batches:[],suite};

const calls=[];let queueItems=[],readDraft=null;
globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);calls.push(p);
 if(p.action==='workspace'){await new Promise(r=>setTimeout(r,10));return {ok:true,json:async()=>data};}
 if(p.action==='work_queue')return {ok:true,json:async()=>({ok:true,groups:['To do','In progress','Done'],counts:{'To do':queueItems.length,'In progress':0,'Done':0},items:queueItems,min_note:10})};
 if(p.action==='form_draft_save')return {ok:true,json:async()=>({ok:true,draft_id:'d1',saved_at:'2026-11-19T07:45:00Z',revision:'1'})};
 if(p.action==='form_draft_read')return {ok:true,json:async()=>({ok:true,draft:readDraft})};
 if(p.action==='form_draft_discard')return {ok:true,json:async()=>({ok:true,discarded:true})};
 const result=p.action==='login'?{access_token:'qa',refresh_token:'refresh',expires_at:Date.now()/1000+3600,session_id:'qa',idle_timeout_seconds:1800}:p.action==='statement'?{opening:0,closing:0,rows:[],currency:'KES'}:{ok:true};return {ok:true,json:async()=>result};};
const pause=(ms=40)=>new Promise(r=>setTimeout(r,ms));const click=async s=>{const b=document.querySelector(s);assert.ok(b,'Missing control '+s);b.click();await pause();};
let mode='fail',batchCalls=0;
const group={key:'approve_statement_lines',type:'statement',actionable_count:2,waiting_count:2,blocked_count:0,items:[{group_id:'g1',label:'Fictional receipts',kind:'Income',eligible:true,items:[{id:'m1',revision:null,code:'4000',label:'Fictional sales',origin:'Draft',effective_from:'2026-01-01'},{id:'m2',revision:null,code:'4010',label:'Fictional services',origin:'Draft',effective_from:'2026-01-01'}]}]};
const approvals={queues:[{key:'approve_statement_lines',title:'Statement-line mappings',count:2,needs_my_action:true,owner_label:'Partner'}],records:[],actionGroups:[group],renewals:[],actionableTotal:2,scopes:[],roles:[]};
const baseFetch=globalThis.fetch;
const approvalRequests=[];
globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);
 if(p.action.startsWith('settings_approval'))approvalRequests.push({action:p.action,region:new URL(url).searchParams.get('forceFunctionRegion')});
 if(p.action==='settings_approvals_read')return {ok:true,json:async()=>approvals};
 if(p.action==='settings_approval_items_read')return {ok:true,json:async()=>({ok:true,groups:[group]})};
 if(p.action==='settings_approval_batch_approve'&&p.preview_only)return {ok:true,json:async()=>({review_version:'verified',groups:[{...group,items:group.items[0].items}]})};
 if(p.action==='settings_approval_batch_approve'){batchCalls++;if(mode==='fail')return {ok:false,status:504,json:async()=>{throw Error('not json');}};return {ok:true,json:async()=>({ok:true,total:2,groups:[{...group,items:group.items[0].items}]})};}
 return baseFetch(url,opts);};
await import('../staff-pilot.mjs');
const editor=()=>document.querySelector('#editor');
async function openDrawer(){await click('[data-suite="ap-review"][data-id="approve_statement_lines"]');assert.ok(editor().open,'the quick review opened');}
function check(selector){const input=document.querySelector(selector);assert(input,selector);input.checked=true;input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}
async function confirmAndApprove(){
 for(const input of document.querySelectorAll('[data-ap-item]:not(:disabled)'))input.click();
 await click('[data-suite="ap-preview-selected"]');
 check('[data-ap-confirm]');
 await click('[data-suite="ap-approve-selected"]');
}
test('the Mumbai rollout applies only to the four measured read actions',()=>{
 const api='https://example.com/functions/v1/staff-workspace-v12';
 const reads=['settings_approvals_read','settings_approval_items_read','ledger_read','ledger_report_gate'];
 for(const action of reads){
  assert.equal(staffReadRequestUrl(api,action,'mumbai'),api+'?forceFunctionRegion=ap-south-1');
  assert.equal(staffReadRequestUrl(api,action,'automatic'),api);
 }
 for(const action of ['login','workspace','settings_approval_batch_approve','rate_approve','ledger_journal_review','ledger_report_export']){
  assert.equal(staffReadRequestUrl(api,action,'mumbai'),api);
 }
});
test('batch errors remain visible and Return to list works during and after approval',async t=>{t.after(()=>dom.window.close());
 document.querySelector('#loginForm [name=login_id]').value='qa.partner';document.querySelector('#loginForm [name=password]').value='testing';document.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause(120);
 await click('[data-view="firms"]');await pause(80);
 await openDrawer();
 assert.equal(approvalRequests.find(x=>x.action==='settings_approvals_read')?.region,'ap-south-1');
 assert.equal(approvalRequests.find(x=>x.action==='settings_approval_items_read')?.region,'ap-south-1');
 await confirmAndApprove();await pause(80);
 assert.equal(batchCalls,1);
 assert.ok(approvalRequests.filter(x=>x.action==='settings_approval_batch_approve').every(x=>x.region===null),'approval requests use automatic routing');
 assert.ok(editor().open,'the review stays open after a failure');
 assert.match(document.querySelector('#editorBody').textContent,/Fictional sales/,'the review content remains present');
 assert.match(document.querySelector('#apBatchError').textContent,/could not be verified/);
 assert.equal(document.querySelector('[data-suite="ap-preview-selected"]').disabled,true,'reload is required before retrying');
 await click('[data-suite="ap-review-reload"]');
 assert.equal(document.querySelector('[data-suite="ap-preview-selected"]').disabled,false);
 await click('#closeEditor');assert.equal(editor().open,false);

 await click('#openTimingLog');
 const route=document.querySelector('#staffReadRoute');
 assert.match(route.selectedOptions[0].textContent,/Rollout default \(Mumbai\)/);
 assert.match(document.querySelector('#editorBody').textContent,/Open approval details/);
 route.value='automatic';
 route.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 await click('#closeEditor');

 // A late failure after the user returns to the list remains visible outside the drawer.
 await openDrawer();
 assert.equal(approvalRequests.filter(x=>x.action==='settings_approval_items_read').at(-1)?.region,null);
 let release;const slow=new Promise(r=>{release=r;});const f0=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);if(p.action==='settings_approval_batch_approve'&&!p.preview_only){await slow;return {ok:false,status:504,json:async()=>{throw Error('x');}};}return f0(url,opts);};
 await confirmAndApprove();
 await click('#closeEditor');assert.equal(editor().open,false,'Return to list works while the request runs');
 release();await pause(80);
 assert.match(document.body.textContent,/approval result could not be verified/);

 // If the drawer body disappears while open, the failed result restores the review and error.
 await openDrawer();
 let wipe;const hold=new Promise(r=>{wipe=r;});
 globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);if(p.action==='settings_approval_batch_approve'&&!p.preview_only){await hold;document.querySelector('#editorBody').replaceChildren();return {ok:false,status:504,json:async()=>{throw Error('x');}};}return f0(url,opts);};
 await confirmAndApprove();wipe();await pause(80);
 assert.ok(editor().open);assert.match(document.querySelector('#editorBody').textContent,/Fictional sales/);
 assert.match(document.querySelector('#apBatchError').textContent,/could not be verified/);
 await click('#closeEditor');assert.equal(editor().open,false);

 globalThis.fetch=f0;mode='ok';
 await openDrawer();await confirmAndApprove();await pause(80);
 assert.match(document.querySelector('#editorTitle').textContent,/Approval receipt/);
});
