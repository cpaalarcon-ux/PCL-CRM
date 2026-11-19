// Build 2903: the draft bar, Save draft & return, the leave question and resuming a saved draft, through the real staff screen.
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
await import('../staff-pilot.mjs');
const editor=()=>document.querySelector('#editor');
const typeCompany=v=>{const el=document.querySelector('#editForm [name=company_name]');assert.ok(el,'the client form is open');el.value=v;el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
test('a draft form shows its status line, saves and returns to the queue, asks before closing, and resumes from the work queue',async t=>{t.after(()=>dom.window.close());
 document.querySelector('#loginForm [name=login_id]').value='qa.partner';document.querySelector('#loginForm [name=password]').value='testing';document.querySelector('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await pause(120);
 await click('[data-view="clients"]');
 await click('[data-new="client"]');
 assert.ok(editor().open,'the client form opened');
 const bar=document.querySelector('#editorBody .draft-bar');assert.ok(bar,'the draft bar is shown on the client form');
 assert.equal(bar.querySelector('.draft-status').getAttribute('aria-live'),'polite');
 // 1. Save draft & return to queue
 typeCompany('Fictional Draft Trading Ltd');await pause(10);
 assert.match(bar.querySelector('.draft-status').textContent,/Unsaved changes/);
 bar.querySelector('.draft-return').click();await pause(80);
 const save=calls.filter(c=>c.action==='form_draft_save').pop();
 assert.ok(save,'the draft was sent to the server');assert.equal(save.form_kind,'client_edit');assert.equal(save.subject_key,'client:new');assert.equal(save.explicit,true);assert.equal(save.payload.fields.company_name,'Fictional Draft Trading Ltd');
 assert.equal(JSON.stringify(save.payload).match(/password|token|secret/i),null,'no secret in what was sent');
 assert.equal(editor().open,false,'the form closed');assert.equal(document.querySelector('#greeting').textContent,'My workspace','back on Home, where the queue is');
 // 2. closing with unsaved changes asks first
 await click('[data-view="clients"]');await click('[data-new="client"]');
 typeCompany('Another unsaved name');
 await click('#closeEditor');
 let dlg=document.querySelector('dialog.leave-dialog');assert.ok(dlg,'Return to list asks first');assert.match(dlg.textContent,/You have unsaved changes\. Are you sure you want to leave\?/);
 dlg.querySelector('[data-leave=stay]').click();await pause();assert.equal(editor().open,true,'Keep editing keeps the form open');assert.equal(document.querySelector('dialog.leave-dialog'),null);
 editor().dispatchEvent(new dom.window.Event('cancel',{cancelable:true}));await pause();
 dlg=document.querySelector('dialog.leave-dialog');assert.ok(dlg,'Escape asks too');
 dlg.querySelector('[data-leave=leave]').click();await pause(80);assert.equal(editor().open,false,'Leave without saving closes it');
 // 3. a draft in the work queue can be resumed and discarded
 readDraft={draft_id:'d1',form_kind:'client_edit',form_label:'Client set-up form',subject_key:'client:new',title:'Client set-up form · new client',client_id:null,project_id:null,saved_at:'2026-11-19T07:45:00Z',revision:'1',payload:{meta:{client_id:''},fields:{company_name:'Fictional Resumed Co Ltd'}}};
 queueItems=[{key:'draft:d1',kind:'draft',id:'d1',group:'To do',client_id:'',client_name:'',project_id:'',period_id:'',title:'Unfinished Client set-up form · new client',stage:'Saved draft: resume where you stopped',amount:null,revision:'1',at:'2026-11-19T07:45:00Z',can:[],own:true}];
 await click('[data-view="home"]');await pause(120);
 const row=document.querySelector('[data-wq-row="draft:d1"]');assert.ok(row,'the saved draft is in the work queue under To do');
 assert.match(row.textContent,/Unfinished Client set-up form/);
 row.querySelector('[data-draft-resume]').click();await pause(120);
 assert.ok(calls.some(c=>c.action==='form_draft_read'&&c.draft_id==='d1'));
 assert.equal(editor().open,true,'the form reopened');assert.equal(document.querySelector('#editForm [name=company_name]').value,'Fictional Resumed Co Ltd','with what the person had typed');
 assert.match(document.querySelector('#editorBody .draft-status').textContent,/All changes saved at 10:45 EAT/,'and it shows when it was saved');
 editor().close();
 await click('[data-view="home"]');await pause(120);
 document.querySelector('[data-wq-row="draft:d1"] [data-draft-discard]').click();await pause(30);
 dlg=document.querySelector('dialog.leave-dialog');assert.ok(dlg,'discarding asks first');assert.match(dlg.textContent,/removed for good/);
 dlg.querySelector('[data-leave=discard]').click();await pause(80);
 assert.ok(calls.some(c=>c.action==='form_draft_discard'&&c.draft_id==='d1'),'discarded on the server');
});
