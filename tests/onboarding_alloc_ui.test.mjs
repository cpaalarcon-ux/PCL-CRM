// Onboarding allocation screen: pick a person and clients, allocate, see the outcome, remove with a reason.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
import {defaultStaffAreas} from '../staff-access-control.mjs';
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

const reads=[];let allocated=[];
const people=[{staff_id:'00000000-0000-4000-8000-0000000000a1',full_name:'Fictional Assistant',category_code:'ASSISTANT',allocated:0}];
const clientRows=[{client_id:cid,company_name:'ACL Fictional One',kra_pin:'A123456789Z',allocated_to:'',already_this_person:false,total_count:1}];
const baseFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);
 if(p.action==='client_onboarding_alloc_read'){reads.push(p);return {ok:true,json:async()=>({preparers:people.map(x=>({...x,allocated:allocated.length})),files:[{file:'acl-batch.xlsx',clients:2}],allocations:p.staff_id?allocated:[]})};}
 if(p.action==='client_onboarding_alloc_clients'){return {ok:true,json:async()=>({clients:clientRows.map(c=>({...c,already_this_person:allocated.some(a=>a.client_id===c.client_id)})),total:1})};}
 if(p.action==='client_onboarding_alloc_assign'){reads.push(p);allocated=[{allocation_id:'x1',client_id:cid,company_name:'ACL Fictional One',allocated_at:'2026-11-23T07:00:00Z',source:p.file?'Import: '+p.file:'Selected',allocated_by_name:'Fictional Partner'}];return {ok:true,json:async()=>({ok:true,staff_name:'Fictional Assistant',requested:1,allocated:1,already_allocated:0,not_eligible:0})};}
 if(p.action==='client_onboarding_alloc_remove'){reads.push(p);allocated=[];return {ok:true,json:async()=>({ok:true,staff_name:'Fictional Assistant',ended:1})};}
 return baseFetch(url,opts);};
await import('../staff-pilot.mjs');
const editor=()=>document.querySelector('#editor');
test('the Manager or Partner allocates clients to a preparer and removes the allocation, with the outcome shown',async t=>{t.after(()=>dom.window.close());
 document.querySelector('#loginForm [name=login_id]').value='qa.partner';document.querySelector('#loginForm [name=password]').value='testing';document.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause(120);
 await click('[data-view="clients"]');
 assert.ok(document.querySelector('[data-onb-open]'),'a Partner sees the Onboarding allocation button on the Clients page');
 await click('[data-onb-open]');assert.ok(editor().open,'the allocation screen opened');
 assert.match(document.querySelector('#editorBody').textContent,/before any project exists/);
 assert.equal(document.querySelector('[data-onb="find"]').disabled,true,'finding clients waits for a person');
 const sel=document.querySelector('[name=onbStaff]');sel.value=people[0].staff_id;sel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(80);
 await click('[data-onb="find"]');
 const pick=document.querySelector('[data-onb-pick]');assert.ok(pick,'matching clients are listed');pick.checked=true;pick.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(40);
 assert.equal(document.querySelector('[data-onb="assign"]').disabled,false);
 await click('[data-onb="assign"]');
 const sent=reads.find(r=>r.action==='client_onboarding_alloc_assign');assert.deepEqual(sent.client_ids,[cid]);assert.equal(sent.staff_id,people[0].staff_id);
 assert.match(document.querySelector('#onbNotice').textContent,/Fictional Assistant: 1 allocated/);
 assert.match(document.querySelector('#editorBody').textContent,/ACL Fictional One/,'the allocation is listed');
 // Removing needs a reason.
 const held=document.querySelector('[data-onb-held]');held.checked=true;held.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(40);
 await click('[data-onb="remove"]');assert.match(document.querySelector('#onbNotice').textContent,/at least 5 characters/);
 assert.equal(reads.some(r=>r.action==='client_onboarding_alloc_remove'),false,'nothing was sent without a reason');
 document.querySelector('[name=onbReason]').value='Onboarding finished';
 await click('[data-onb="remove"]');
 assert.equal(reads.find(r=>r.action==='client_onboarding_alloc_remove').reason,'Onboarding finished');
 assert.match(document.querySelector('#onbNotice').textContent,/1 allocation ended/);
 await click('#closeEditor');assert.equal(editor().open,false,'Return to list closes it');
});
