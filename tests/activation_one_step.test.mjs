// Optional DOM integration regression: PCL_TEST_MODULES must contain jsdom.
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

let mode={checks:[],fail:null,status:'Draft'};const calls=[];
globalThis.fetch=async(url,opts)=>{const p=JSON.parse(opts.body);calls.push(p);
 if(p.action==='workspace'){data.projects[0].status=mode.status;await new Promise(r=>setTimeout(r,10));return {ok:true,json:async()=>data};}
 if(p.action==='engagement_read')return {ok:true,json:async()=>({controls:{revision:1},checks:mode.checks})};
 if((p.action==='engagement_save_activate'||p.action==='engagement_save')&&mode.fail)return {ok:false,status:400,json:async()=>({error:mode.fail})};
 if(p.action==='engagement_save_activate')return {ok:true,json:async()=>({ok:true,project_status:'Active',generated:48,warnings:[]})};
 const result=p.action==='login'?{access_token:'qa',refresh_token:'refresh',expires_at:Date.now()/1000+3600,session_id:'qa',idle_timeout_seconds:1800}:p.action==='statement'?{opening:0,closing:0,rows:[],currency:'KES'}:{ok:true};return {ok:true,json:async()=>result};};
const pause=()=>new Promise(r=>setTimeout(r,40));const click=async s=>{const b=document.querySelector(s);assert.ok(b,'Missing control '+s);b.click();await pause();};
await import('../staff-pilot.mjs');
const openReview=async()=>{document.querySelector('#editor').open&&document.querySelector('#editor').close();await click('[data-view="projects"]');const sel=document.querySelector('select[name=project]');sel.value=pid;sel.dispatchEvent(new dom.window.Event('change'));await pause();await click('[data-suite="engagement"]');await pause();};
const submit=async()=>{document.querySelector('#editForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();await pause();};
test('Review & activate is one clear step',async t=>{t.after(()=>dom.window.close());
 document.querySelector('#loginForm [name=login_id]').value='qa.partner';document.querySelector('#loginForm [name=password]').value='testing';document.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause();
 // 1. enhanced due diligence missing: the Partner gets the action button and the main button is switched off with a reason
 mode.checks=[{ok:true,label:'Current client KYC verified'},{ok:false,label:'Enhanced due diligence (if required)'},{ok:true,label:'Signed engagement letter uploaded and verified'}];
 await openReview();
 let body=document.querySelector('#editorBody');
 assert.match(body.textContent,/1 thing left before activation/);
 assert.ok(body.querySelector('[data-suite="edd"]'),'Partner can approve enhanced due diligence from here');
 let main=body.querySelector('button[type=submit]');assert.equal(main.disabled,true);assert.match(main.textContent,/Activate project/);
 assert.equal(/Activate saved controls/.test(body.textContent),false,'the old second button is gone');
 assert.equal(body.querySelector('[name=save_mode]').type,'hidden');
 // 2. everything ready: one button, one press, clear success
 mode.checks=[{ok:true,label:'Current client KYC verified'},{ok:true,label:'Enhanced due diligence (if required)'},{ok:true,label:'Signed engagement letter uploaded and verified'}];
 await openReview();
 body=document.querySelector('#editorBody');assert.match(body.textContent,/Ready to activate/);
 main=body.querySelector('button[type=submit]');assert.equal(main.disabled,false);assert.equal(main.textContent,'Activate project');
 calls.length=0;await click('#editorSave');await pause();
 assert.ok(calls.some(p=>p.action==='engagement_save_activate'),'one press saves and activates');
 assert.equal(calls.some(p=>p.action==='engagement_save'),false);
 assert.match(document.querySelector('#editorBody').textContent,/48 task\(s\) created/);assert.equal(document.querySelector('#editorTitle').textContent,'Project activated');
 // 3. save draft only is a separate, smaller choice
 await openReview();calls.length=0;document.querySelector('#engSaveDraft').click();await pause();await pause();
 assert.ok(calls.some(p=>p.action==='engagement_save'),'draft save does not activate');assert.equal(calls.some(p=>p.action==='engagement_save_activate'),false);
 // 4. a refusal stays visible at the top of the form and the form stays open
 mode.fail='Verify the current client KYC file before activation.';await openReview();
 const notes=document.querySelector('#editForm [name=notes]');
 notes.value='Retain these review notes';
 notes.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(document.querySelector('#editor').dispatchEvent(new dom.window.Event('cancel',{cancelable:true})),false,'Escape does not discard edited fields');
 await submit();
 assert.equal(notes.value,'Retain these review notes','failed save retains the notes');
 const err=document.querySelector('#engActivateError');assert.equal(err.hidden,false);assert.match(err.textContent,/Verify the current client KYC/);assert.equal(document.querySelector('#editor').open,true);
 // the hidden mode returns to activate after a failed draft save
 document.querySelector('#engSaveDraft').click();await pause();await pause();assert.equal(document.querySelector('[name=save_mode]').value,'activate');
 mode.fail=null;
 // 5. an active project has no activate button
 data.projects[0].status='Active';document.querySelector('#editor').open&&document.querySelector('#editor').close();const tmp=document.createElement('button');tmp.dataset.suite='engagement';tmp.dataset.id=pid;document.body.append(tmp);tmp.click();await pause();await pause();body=document.querySelector('#editorBody');assert.match(body.querySelector('button[type=submit]').textContent,/Save controls/);assert.equal(/Activate project/.test(body.querySelector('button[type=submit]').textContent),false);
});
