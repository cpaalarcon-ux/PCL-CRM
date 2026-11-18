import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<dialog id="editor"><div id="editorBody"></div></dialog>',{url:'https://example.test/staff-pilot'});
globalThis.document=dom.window.document;
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const {suggestPeriod,stepState,inFirm,attachWizard}=await import('../staff-wizard.mjs');
const {createServiceSetupUI}=await import('../staff-service-setup.mjs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(n,l,v='',t='text',extra='')=>`<label>${l}<input name="${n}" value="${esc(v)}" type="${t}" ${extra}></label>`;
const select=(n,l,opts,v='',ph='')=>`<label>${l}<select name="${n}">${ph?`<option value="">${esc(ph)}</option>`:''}${opts.map(([k,t])=>`<option value="${esc(k)}"${k===v?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;
const form=(body,button='Save')=>`<form id="editForm" class="form-grid">${body}<button type="submit" class="primary full">${button}</button></form>`;

test('build 2869: the suggested period is the last financial year that has ended',()=>{
 assert.deepEqual(suggestPeriod(12,31,'2026-11-17'),{start:'2025-01-01',end:'2025-12-31'});
 assert.deepEqual(suggestPeriod(6,30,'2026-11-17'),{start:'2025-07-01',end:'2026-06-30'});
 assert.deepEqual(suggestPeriod(12,31,'2026-12-31'),{start:'2026-01-01',end:'2026-12-31'},'a year ending today has ended');
 assert.deepEqual(suggestPeriod(12,31,'2026-12-30'),{start:'2025-01-01',end:'2025-12-31'});
 assert.deepEqual(suggestPeriod(2,29,'2026-11-17'),{start:'2025-03-01',end:'2026-02-28'},'29 February falls back to 28 in a common year');
 assert.deepEqual(suggestPeriod(2,29,'2028-11-17'),{start:'2027-03-01',end:'2028-02-29'});
 for(const bad of [[null,null],[13,1],[0,5],[6,0],['x',1],[6,31],[undefined,undefined]])assert.ok(bad[0]===6&&bad[1]===31?suggestPeriod(...bad,'2026-11-17')!==undefined:suggestPeriod(bad[0],bad[1],'2026-11-17')===null,JSON.stringify(bad));
 assert.equal(suggestPeriod(6,30,'bad'),null);
 assert.equal(stepState(0,1),'done');assert.equal(stepState(1,1),'current');assert.equal(stepState(2,1),'todo');
 assert.equal(inFirm('s1|f1','f1'),true);assert.equal(inFirm('s1|f2','f1'),false);assert.equal(inFirm('s1|f2',''),true);assert.equal(inFirm('','f1'),true);
});

function mount(html){document.getElementById('editorBody').innerHTML=html;return document.getElementById('editForm');}
test('build 2869: a wizard form shows one step at a time, checks a step before moving on, and shows the submit button last',()=>{
 const f=mount(form(`<fieldset class="wz-step" data-title="One">${field('a','A *','','text','required')}</fieldset><fieldset class="wz-step" data-title="Two">${field('b','B *','','text','required')}</fieldset><fieldset class="wz-step" data-title="Three">${field('c','C')}</fieldset>`,'Go'));
 let submitted=0;f.addEventListener('submit',e=>{e.preventDefault();submitted++;});
 const w=attachWizard(f,{doc:document});assert.ok(w);
 const steps=[...f.querySelectorAll('.wz-step')],submit=f.querySelector('button[type=submit]'),next=f.querySelector('.wz-next'),back=f.querySelector('.wz-back'),dots=[...f.querySelectorAll('.wz-stepper li')];
 assert.deepEqual(steps.map(s=>s.hidden),[false,true,true]);assert.equal(dots.length,3);assert.equal(dots[0].dataset.state,'current');assert.equal(dots[1].dataset.state,'todo');
 assert.equal(back.hidden,true);assert.equal(next.hidden,false);assert.equal(submit.hidden,true);assert.equal(submit.parentElement.className.includes('wz-footer'),true,'the submit button sits in the footer');
 assert.equal(document.activeElement.name,'a','the first field of the step is focused');
 next.click();assert.equal(w.current,0,'an empty required field stops the step');
 f.elements.a.value='x';next.click();assert.equal(w.current,1);assert.equal(dots[0].dataset.state,'done');assert.equal(dots[1].getAttribute('aria-current'),'step');assert.equal(back.hidden,false);assert.equal(document.activeElement.name,'b');
 // Enter moves on instead of submitting.
 f.elements.b.value='y';f.elements.b.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(w.current,2);assert.equal(submitted,0,'Enter did not submit early');
 assert.equal(next.hidden,true);assert.equal(submit.hidden,false);assert.deepEqual(steps.map(s=>s.hidden),[true,true,false]);
 back.click();assert.equal(w.current,1);dots[0].click();assert.equal(w.current,0,'an earlier dot goes back');dots[2].click();assert.equal(w.current,0,'a later dot does nothing; Next checks each step');
 w.show(2);submit.click();assert.equal(submitted,1);
 // A form with fewer than two steps is left alone.
 assert.equal(attachWizard(mount(form(`<fieldset class="wz-step">${field('z','Z')}</fieldset>`)),{doc:document}),null);
});

test('build 2869: the service set-up is three steps with the period suggested from the year-end and the signed-in person as responsible',async()=>{
 let shown=null,calls=[];
 const options={client:{client_id:'c1',company_name:'Fictional client',year_end_month:12,year_end_day:31},firms:[{firm_id:'f1',legal_name:'Firm one'},{firm_id:'f2',legal_name:'Firm two'}],
  templates:[{template_id:'t1',version:1,name:'Template',service_group:'Tax',services:[{service_code:'TAX-COMP',service_name:'Tax compliance'}],tasks:[]}],
  staff:[{staff_id:'s1',full_name:'Fictional Manager',category_code:'MANAGER',firm_id:'f1'},{staff_id:'s2',full_name:'Fictional Partner',category_code:'PARTNER',firm_id:'f1'},{staff_id:'s3',full_name:'Other firm person',category_code:'MANAGER',firm_id:'f2'}],projects:[],client_template:null,note:'Choose the service yourself.'};
 const ui=createServiceSetupUI({esc,field,select,form,modal:(title,html,submit)=>{shown={title,html};document.getElementById('editorBody').innerHTML=html;},request:async p=>{calls.push(p.action);return p.action==='engagement_setup_options'?options:{setups:[]};},notice:()=>{},shortDate:x=>x,data:()=>({me:{category_code:'MANAGER',staff_id:'s1'}})});
 await ui.open('c1');
 const f=document.getElementById('editForm');assert.ok(f);
 const steps=[...f.querySelectorAll('.wz-step')];assert.deepEqual(steps.map(s=>s.dataset.title),['Service','Period and scope','People']);
 const y=new Date(Date.now()+3*3600000).getUTCFullYear();
 assert.equal(f.elements.period_start.value,`${y-1}-01-01`);assert.equal(f.elements.period_end.value,`${y-1}-12-31`);assert.match(shown.html,/data-period-hint/);assert.match(shown.html,/Suggested from the client's year-end/);
 assert.equal(f.elements.responsible.value,'s1|f1','the signed-in person is offered as responsible');assert.equal(f.elements.reviewer.value,'','the reviewer is not chosen for the person');
 assert.equal(f.elements.scope.value,'','the scope is never filled in for the person');
 // Only people of the chosen firm are offered.
 f.elements.firm_id.value='f1';f.elements.firm_id.dispatchEvent(new dom.window.Event('change'));
 const offered=sel=>[...sel.options].filter(o=>!o.disabled&&o.value).map(o=>o.value);
 assert.deepEqual(offered(f.elements.reviewer),['s1|f1','s2|f1']);
 f.elements.firm_id.value='f2';f.elements.firm_id.dispatchEvent(new dom.window.Event('change'));assert.deepEqual(offered(f.elements.reviewer),['s3|f2']);assert.equal(f.elements.responsible.value,'','a person from another firm is cleared');
 // The reviewer must differ from the responsible person.
 f.elements.firm_id.value='f1';f.elements.firm_id.dispatchEvent(new dom.window.Event('change'));
 f.elements.responsible.value='s1|f1';f.elements.reviewer.value='s1|f1';f.elements.reviewer.dispatchEvent(new dom.window.Event('change'));
 assert.equal(f.elements.reviewer.checkValidity(),false);f.elements.reviewer.value='s2|f1';f.elements.reviewer.dispatchEvent(new dom.window.Event('change'));assert.equal(f.elements.reviewer.checkValidity(),true);
 // No year-end recorded: nothing is suggested and the screen says so.
 options.client.year_end_month=null;await ui.open('c1');
 assert.equal(document.getElementById('editForm').elements.period_start.value,'');assert.match(shown.html,/year-end is not recorded/);
});

test('build 2869: wiring, styles and cache tokens',()=>{
 const css=rd('staff-pilot.css');for(const c of ['.wz-stepper','.wz-footer','.wz-step[hidden]'])assert.ok(css.includes(c),c);
 assert.match(rd('staff-pilot.html'),/staff-pilot\.css\?v=20261118-approval-board-v1/);
 assert.match(rd('staff-service-setup.mjs'),/staff-wizard\.mjs\?v=20261121-wiz-v1/);assert.match(rd('staff-improvements.mjs'),/staff-service-setup\.mjs\?v=20261121-wiz-v1/);assert.match(rd('staff-pilot.mjs'),/staff-improvements\.mjs\?v=20261122-loc-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/service-template-actions.ts'),/select client_id,company_name,year_end_month,year_end_day from erp_private\.clients/);
});
