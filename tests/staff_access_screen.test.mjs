// Staff & access screen: one page with People, Allocations, Access & rights and Approvals tabs.
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
const aid='00000000-0000-4000-8000-0000000000a1',supId='00000000-0000-4000-8000-0000000000b1';
people.push({staff_id:supId,full_name:'Fictional Supervisor',category_code:'SUPERVISOR',allocated:0});
const baseFetch2=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);
 if(p.action==='client_onboarding_alloc_move'){reads.push(p);allocated=[];return {ok:true,json:async()=>({ok:true,to_name:'Fictional Supervisor',requested:1,moved:1,not_eligible:0})};}
 return baseFetch2(url,opts);};
data.staff=[me,
 {staff_id:'00000000-0000-4000-8000-0000000000b1',full_name:'Fictional Supervisor',staff_identifier:'QA-S1',login_id:'qa.sup',category_code:'SUPERVISOR',employment_type:'Permanent',access_status:'Active',restricted_areas:[],restricted_rights:[]},
 {staff_id:aid,full_name:'Fictional Assistant',staff_identifier:'QA-A1',login_id:'qa.asst',category_code:'ASSISTANT',employment_type:'Permanent',access_status:'Active',restricted_areas:['leads'],restricted_rights:[]},
 {staff_id:'00000000-0000-4000-8000-0000000000c1',full_name:'Fictional Intern',staff_identifier:'QA-I1',login_id:'qa.intern',category_code:'INTERN',employment_type:'Contract',access_status:'Pending setup',restricted_areas:[],restricted_rights:[]}];
await import('../staff-pilot.mjs');
import {tabsFor,normaliseTab,reachLine,emptyPeople,tabBarHtml} from '../staff-access-screen.mjs';
const rowsShown=()=>[...document.querySelectorAll('tr[data-staff-row]')].filter(r=>!r.hidden).map(r=>r.querySelector('small').textContent.split(' · ')[0]);
test('Staff & access is one page with four tabs, a filterable People list and inline Allocations',async t=>{t.after(()=>dom.window.close());
 document.querySelector('#loginForm [name=login_id]').value='qa.partner';document.querySelector('#loginForm [name=password]').value='testing';document.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause(200);
 await click('[data-view="staff"]');
 const tabs=[...document.querySelectorAll('.pcl-tabs [role=tab]')];
 assert.deepEqual(tabs.map(x=>x.textContent.replace(/\d+$/,'').trim()),['People','Allocations','Access & rights','Approvals']);
 assert.equal(tabs[0].getAttribute('aria-selected'),'true');assert.equal(tabs.filter(x=>x.tabIndex===0).length,1,'only the active tab is in the tab order');
 assert.ok(document.querySelector('#staffpane[role=tabpanel]'));
 assert.match(document.querySelector('#staffpane').textContent,/Fictional Supervisor/);
 assert.ok(document.querySelector('[data-new="staff"]'),'Add staff sits in the page header on the People tab');
 assert.doesNotMatch(document.body.textContent,/direct reports/,'the old reporting-line wording is gone');
 // Filters hide rows without a request.
 const sel=document.querySelector('#staffRole');sel.value='ASSISTANT';sel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.deepEqual(rowsShown(),['QA-A1']);assert.match(document.querySelector('#staffShown').textContent,/Showing 1 of 4/);
 sel.value='';sel.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 const q=document.querySelector('#staffQ');q.value='intern';q.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.deepEqual(rowsShown(),['QA-I1']);
 q.value='nobody';q.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(document.querySelector('#staffNone').hidden,false,'an empty result says so');
 q.value='';q.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 const custom=document.querySelector('#staffCustom');custom.checked=true;custom.dispatchEvent(new dom.window.Event('change',{bubbles:true}));assert.deepEqual(rowsShown(),['QA-A1'],'restricted access only');
 // Allocations: the same screen, drawn inside the page, not in a pop-up.
 await click('[data-staff-tab="allocations"]');await pause(80);
 assert.equal(document.querySelector('#editor').open,false,'no pop-up');
 assert.ok(document.querySelector('#staffpane [name=onbStaff]'),'the allocation picker is inside the tab');
 assert.equal(document.querySelector('[data-new="staff"]'),null,'Add staff belongs to People only');
 const pick=document.querySelector('[name=onbStaff]');pick.value=aid;pick.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(80);
 await click('[data-onb="find"]');
 const box=document.querySelector('[data-onb-pick]');assert.ok(box,'clients are listed in the tab');box.checked=true;box.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(40);
 // Bulk: select every client on the page, allocate everything a search finds, then reassign.
 const allBox=document.querySelector('[data-onb-all="pick"]');assert.ok(allBox,'a select-all box heads the client list');allBox.checked=false;box.checked=false;box.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(40);
 const allBox2=document.querySelector('[data-onb-all="pick"]');allBox2.checked=true;allBox2.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(40);
 assert.match(document.querySelector('[data-onb="assign"]').textContent,/Allocate selected \(1\)/,'select all picked the whole page');
 assert.match(document.querySelector('[data-onb="assign-match"]').textContent,/Allocate all 1 matching clients/);
 await click('[data-onb="assign-match"]');
 const bulkSent=reads.find(r=>r.action==='client_onboarding_alloc_assign'&&r.match);assert.deepEqual(bulkSent.match,{q:'',unallocated_only:true});assert.equal(bulkSent.client_ids,undefined,'the server resolves the matches');
 assert.match(document.querySelector('#onbNotice').textContent,/Fictional Assistant: 1 allocated/);
 // Reassign everything this person holds.
 assert.equal(document.querySelector('[data-onb="move-all"]').disabled,true,'choose who receives them first');
 const to=document.querySelector('[name=onbMoveTo]');to.value=supId;to.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await pause(40);
 document.querySelector('[name=onbReason]').value='';await click('[data-onb="move-all"]');
 assert.match(document.querySelector('#onbNotice').textContent,/at least 5 characters/);assert.equal(reads.some(r=>r.action==='client_onboarding_alloc_move'),false,'nothing moves without a reason');
 document.querySelector('[name=onbReason]').value='Assistant is leaving';await click('[data-onb="move-all"]');
 const mv=reads.find(r=>r.action==='client_onboarding_alloc_move');assert.deepEqual([mv.staff_id,mv.to_staff_id,mv.all,mv.reason],[aid,supId,true,'Assistant is leaving']);
 assert.match(document.querySelector('#onbNotice').textContent,/1 of 1 moved to Fictional Supervisor/);
 // Access & rights lists the restricted person and the role guide.
 await click('[data-staff-tab="access"]');
 assert.match(document.querySelector('#staffpane').textContent,/People with restricted access/);
 assert.match(document.querySelector('#staffpane').textContent,/Fictional Assistant/);
 assert.ok(document.querySelector('#staffpane [data-rights]'),'Edit access is one click from the list');
 assert.ok(document.querySelector('#staffpane table.category-matrix'),'the action matrix is on this tab');
 assert.ok(document.querySelector('[data-extra-rights]'),'a Partner keeps Additional rights');
 // Approvals.
 await click('[data-staff-tab="approvals"]');
 assert.match(document.querySelector('#staffpane').textContent,/Check and approve, by role/);
 assert.match(document.querySelector('#staffpane').textContent,/Chart account activation/);
 // Arrow keys move between tabs.
 document.querySelector('#stafftab-approvals').focus();document.querySelector('.pcl-tabs').dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));await pause(40);
 assert.equal(document.querySelector('.pcl-tab.on').dataset.staffTab,'access');
});
test('who sees which tabs, and what the screen says about reach',()=>{
 assert.deepEqual(tabsFor('PARTNER').map(x=>x.code),['people','allocations','access','approvals']);
 assert.deepEqual(tabsFor('MANAGER').map(x=>x.code),['people','allocations','access','approvals']);
 assert.deepEqual(tabsFor('ADMIN').map(x=>x.code),['people','access'],'an Administrator manages logins only');
 assert.equal(normaliseTab('allocations','ADMIN'),'people','a tab the person cannot use falls back to People');
 assert.match(reachLine('MANAGER'),/in the firms you work in, whoever they report to/);
 assert.match(emptyPeople('MANAGER'),/Ask a Partner to link staff to a firm/);
 assert.match(tabBarHtml(tabsFor('PARTNER'),'access',s=>s),/aria-selected="true"[^>]*aria-controls="staffpane"[^>]*tabindex="0"[^>]*data-staff-tab="access"/);
});
