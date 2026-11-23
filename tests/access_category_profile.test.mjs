// Access alignment step 2: the category profile, reviewer-only Check / return, and the Edit access screen.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFile} from 'node:fs/promises';
import {defaultStaffAreas} from '../staff-access-control.mjs';
import {ACTION_RIGHTS,canUseAction,defaultActionRights,rightsForRequest} from '../staff-action-rights.mjs';
import {ACCESS_PROFILE,ACCESS_ROLES,actionsForCategory,categoryActionMatrix,categoryProfileBlock,renderAccessGuide} from '../staff-access-guide.mjs';
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

const asst={staff_id:'00000000-0000-4000-8000-0000000000b1',full_name:'Fictional Assistant',category_code:'ASSISTANT',revision:1,login_id:'qa.assistant',access_status:'Active'};
data.staff=[me,asst];data.staff_firms=[{staff_id:sid,firm_id:fid},{staff_id:asst.staff_id,firm_id:fid}];
const baseFetch=globalThis.fetch;
globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);
 if(p.action==='staff_access_read'){return {ok:true,json:async()=>({staff:{staff_id:asst.staff_id,full_name:asst.full_name,category_code:'ASSISTANT',revision:1},default_areas:defaultStaffAreas('ASSISTANT'),restricted_areas:[],allowed_areas:defaultStaffAreas('ASSISTANT'),default_rights:[],default_action_rights:defaultActionRights('ASSISTANT'),restricted_rights:[],access_stamp:'x'})};}
 return baseFetch(url,opts);};
await import('../staff-pilot.mjs');
const pause2=(ms=60)=>new Promise(r=>setTimeout(r,ms));
test('Check / return is reviewer-only by default and the category summary matches the rights the server uses',()=>{
 for(const role of ['ASSISTANT','INTERN','ADMIN'])assert.deepEqual(ACTION_RIGHTS.filter(r=>r.code.endsWith('.review')&&defaultActionRights(role).includes(r.code)).map(r=>r.code),[],role+' holds no Check / return by default');
 for(const role of ['SUPERVISOR','MANAGER','PARTNER'])assert.ok(defaultActionRights(role).includes('clientops.review')&&defaultActionRights(role).includes('compliance.review'),role+' keeps Check / return');
 // The preparer's own steps stay: Assistants still create, edit and submit.
 for(const code of ['client.create','kycfile.edit','contacts.create','clientops.submit'])assert.ok(defaultActionRights('ASSISTANT').includes(code),'Assistant keeps '+code);
 // The onboarding check and approval routes need a right an Assistant does not hold.
 for(const action of ['client_proposal_check','client_proposal_approve']){const need=rightsForRequest({action},'clients');assert.ok(need.some(c=>c.endsWith('.review')||c.endsWith('.approve')),action+' maps to a reviewer right');assert.ok(!need.every(c=>defaultActionRights('ASSISTANT').includes(c)),'an Assistant does not hold the right for '+action);}
 // Restricting Check / return for a person now stops the check and return routes too.
 assert.equal(canUseAction(['clientops.review'],{action:'client_proposal_check'},'clients'),false);assert.equal(canUseAction(['clientops.review'],{action:'client_proposal_return'},'clients'),false);assert.equal(canUseAction(['clientops.review'],{action:'client_proposal_create'},'clients'),true,'proposing is a separate right');
 // Every category has a profile with records, actions, check and approval.
 for(const r of ACCESS_ROLES){const p=ACCESS_PROFILE[r.code];assert.ok(p&&p.records&&p.actions&&p.check&&p.approve,r.code+' has a full profile');}
 assert.deepEqual(actionsForCategory('ASSISTANT','clients'),['View','Create / record','Edit','Submit']);assert.ok(actionsForCategory('SUPERVISOR','clients').includes('Check / return'));
 assert.equal(actionsForCategory('INTERN','clients'),null);assert.equal(actionsForCategory('ASSISTANT','billing_wip'),null);
 const esc=s=>String(s);const html=categoryActionMatrix(esc);assert.match(html,/Not in this category/);assert.match(html,/Audit Assistant/);
 assert.match(renderAccessGuide('ASSISTANT',esc),/Actions by category and area/);
 assert.match(categoryProfileBlock('SUPERVISOR',esc,'Audit Supervisor'),/Not the rest of the firm/);
 assert.match(categoryProfileBlock('ASSISTANT',esc),/reserved for a Supervisor, Manager or Partner/);
});
test('the Edit access screen shows the category summary and marks Check / return as reserved for an Assistant',async t=>{t.after(()=>dom.window.close());
 document.querySelector('#loginForm [name=login_id]').value='qa.partner';document.querySelector('#loginForm [name=password]').value='testing';document.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause2(140);
 const view=document.querySelector('[data-view="staff"]');assert.ok(view,'Staff & access is available to a Partner');view.click();await pause2();
 assert.match(document.querySelector('#content').textContent,/Actions by category and area/,'the guide shows the action matrix');
 const edit=document.querySelector(`[data-rights="${asst.staff_id}"]`);assert.ok(edit,'the Assistant row has an Edit access button');edit.click();await pause2(120);
 const body=document.querySelector('#editorBody');assert.match(body.textContent,/Audit Assistant: what this category can do/);assert.match(body.textContent,/Independent check:.*reserved for a Supervisor, Manager or Partner/);
 const reviewBoxes=[...body.querySelectorAll('fieldset.access-actions label')].filter(l=>/Check \/ return/.test(l.textContent));assert.ok(reviewBoxes.length>5,'Check / return appears in many groups');
 for(const l of reviewBoxes){assert.equal(l.querySelector('input').disabled,true,'the box is not ticked or editable');assert.equal(l.querySelector('input').checked,false);assert.match(l.textContent,/Reserved for Supervisors, Managers and Partners/);}
 const create=[...body.querySelectorAll('fieldset.access-actions label')].find(l=>/Create \/ record/.test(l.textContent)&&!l.classList.contains('muted'));assert.ok(create,'the preparer’s Create / record box stays ticked');
});
