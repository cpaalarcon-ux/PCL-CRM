// Build 2794: the excise schedule screen. Only the month, the rule (a list), the quantity or value and the dates are keyed.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<!doctype html><dialog id="editor"><div id="editorBody"></div></dialog>');globalThis.document=dom.window.document;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(items,value,blank='Choose…')=>`<option value="">${esc(blank)}</option>`+items.map(x=>{let [v,l]=Array.isArray(x)?x:[x,x];return `<option value="${esc(v)}"${String(v)===String(value)?' selected':''}>${esc(l)}</option>`;}).join('');
const field=(name,label,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(name,label,items,value='',blank='Choose…')=>`<label>${label}<select name="${name}">${options(items,value,blank)}</select></label>`;
const {createExciseScheduleUI,monthBounds,previousMonth}=await import('../staff-excise-schedule.mjs');
const rates=[
 {rate_id:'a',rate_key:'KE_EXCISE_LPG',tax_type:'Excise duty',label:'Excise duty on LPG (rate pending)',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Kilogram',rate_per_unit:12.5}},
 {rate_id:'b',rate_key:'KE_EXCISE_PCT',tax_type:'Excise duty',label:'Percentage duty',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{excise_basis:'Percentage of value',product_code:'2402.20',rate:10}},
 {rate_id:'c',rate_key:'KE_EXCISE_NONE',tax_type:'Excise duty',label:'No figures yet (rate pending)',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{}},
 {rate_id:'d',rate_key:'KE_VAT_STD',tax_type:'VAT',label:'VAT',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{rate:16}},
];
let dueReply={state:null,task:null},me={category_code:'ASSISTANT',staff_id:'s1'},sent=[],schedules=[],submit=null,after=null,title='';
const ctx={$:s=>document.querySelector(s),esc,field,select,
 form:(b,l='Save')=>`<form id="editForm">${b}<button type="submit">${l}</button></form>`,
 modal:(t,h,fn,aft)=>{title=t;document.querySelector('#editorBody').innerHTML=h;submit=fn;after=aft;},
 request:async p=>{sent.push(p);if(p.action==='excise_schedule_read')return {schedules};if(p.action==='excise_schedule_due_state')return dueReply;if(p.action==='excise_schedule_preview')return {result:{lines:[{rate_key:'KE_EXCISE_LPG',label:'Excise duty on LPG',from:'2026-10-01',to:'2026-10-31',basis:'Amount per unit',quantity:100,unit:'Kilogram',rate_per_unit:12.5,product_code:'2711.19.00',duty:1250}],total_duty:1250,issues:[],notices:[],not_for_filing:true}};return {ok:true};},
 shortDate:v=>String(v).slice(0,10),badge:v=>`<span class="badge">${v}</span>`,today:()=>'2026-11-12',table:(h,rows)=>`<table><tr>${h.map(x=>`<th>${x}</th>`).join('')}</tr>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</table>`,
 button:(a,l,id='')=>`<button type="button" data-action="${a}" data-id="${id}">${l}</button>`,area:(n,l,v='')=>`<label>${l}<textarea name="${n}">${esc(v)}</textarea></label>`,check:(n,l,y=false)=>`<label><input type="checkbox" name="${n}" ${y?'checked':''}>${l}</label>`,
 data:()=>({me,suite:{rates},clients:[{client_id:'c1',company_name:'UAT Fictional LPG Distributors Ltd'}],projects:[{project_id:'p1',client_id:'c1',project_name:'UAT Tax engagement',status:'Active'},{project_id:'p2',client_id:'c1',project_name:'Old engagement',status:'Archived'},{project_id:'p3',client_id:'c2',project_name:'Other client engagement',status:'Active'}],staff:[{staff_id:'s1',full_name:'Fictional Preparer',category_code:'MANAGER'},{staff_id:'s2',full_name:'Fictional Reviewer',category_code:'MANAGER'}]})};
const ui=createExciseScheduleUI(ctx);const F=()=>document.querySelector('#editForm'),el=n=>F().elements[n];
const ch=(n,v)=>{el(n).value=v;el(n).dispatchEvent(new dom.window.Event('change',{bubbles:true}));};

test('helpers: month bounds and the default month', ()=>{
 assert.deepEqual(monthBounds('2026-02'),{starts_on:'2026-02-01',ends_on:'2026-02-28'});assert.equal(monthBounds('2028-02').ends_on,'2028-02-29');assert.equal(monthBounds(''),null);
 assert.equal(previousMonth('2026-11-12'),'2026-10');assert.equal(previousMonth('2026-01-05'),'2025-12');
});

test('new schedule: the month defaults to last month, the rule is a list, the box that appears follows the rule', async()=>{
 await ui.handle('xsched-new','c1');assert.equal(title,'New excise schedule');
 assert.equal(el('month').value,'2026-10');assert.equal(el('x_from_0').value,'2026-10-01');assert.equal(el('x_to_0').value,'2026-10-31');
 assert.deepEqual([...el('x_rule_0').options].map(o=>o.value),['','KE_EXCISE_LPG','KE_EXCISE_PCT','KE_EXCISE_NONE'],'only excise rules are offered');
 assert.match([...el('x_rule_0').options][1].textContent,/^Excise duty on LPG · KE_EXCISE_LPG$/,'the "(rate pending)" suffix is not repeated');
 assert.match(document.querySelector('[data-amt="0"]').textContent,/Choose the rule to see what to enter/);
 ch('x_rule_0','KE_EXCISE_LPG');assert.ok(el('qty_0').required);assert.match(document.querySelector('[data-amt="0"]').textContent,/Quantity sold \(Kilogram\)/);assert.ok(el('val_0')&&!el('val_0').required,'the sales value is optional on a per-unit rule, for the eTIMS check');assert.equal(el('qty_0').value,'','blank, never 0');
 ch('x_rule_0','KE_EXCISE_PCT');assert.ok(el('val_0').required);assert.equal(el('qty_0'),undefined);assert.match(document.querySelector('[data-amt="0"]').textContent,/Value of sales KES/);
 ch('x_rule_0','KE_EXCISE_NONE');assert.match(document.querySelector('[data-amt="0"]').textContent,/no figures yet/);
 assert.ok(!F().querySelector('[name*="rate_per_unit"],[name*="product"],[name*="duty"]'),'no rate, product code or duty box is ever typed');
});

test('lines: add, remove, dates follow the month, and preview and save send only what was keyed', async()=>{
 await ui.handle('xsched-new','c1');
 ch('x_rule_0','KE_EXCISE_LPG');el('qty_0').value='100';
 await ui.handle('xsched-line-add','');assert.ok(el('x_rule_1'));ch('x_rule_1','KE_EXCISE_PCT');el('val_1').value='5000';
 await ui.handle('xsched-line-add','');await ui.handle('xsched-line-remove','2');assert.equal(el('x_rule_2'),undefined);
 ch('month','2026-09');assert.equal(el('x_from_0').value,'2026-09-01');assert.equal(el('x_to_1').value,'2026-09-30','dates that followed the month keep following it');
 sent.length=0;await ui.handle('xsched-preview','');
 const pv=sent.at(-1);assert.equal(pv.action,'excise_schedule_preview');assert.equal(pv.client_id,'c1');assert.equal(pv.starts_on,'2026-09-01');assert.equal(pv.ends_on,'2026-09-30');
 assert.deepEqual(pv.lines.map(l=>[l.rate_key,l.quantity,l.value]),[['KE_EXCISE_LPG','100',''],['KE_EXCISE_PCT','','5000']]);
 assert.match(document.querySelector('#excisePreview').innerHTML,/TESTING — NOT FOR FILING/);assert.match(document.querySelector('#excisePreview').innerHTML,/Total excise duty: KES 1,250\.00/);
 await submit(new dom.window.FormData(F()));const sv=sent.at(-1);assert.equal(sv.action,'excise_schedule_save');assert.equal(sv.schedule_id,undefined);assert.ok(!('total_duty' in sv)&&!('result' in sv),'the browser never sends a figure for the duty');
 assert.equal(typeof after,'function','the list reopens after saving');
});

test('list and view: reviewer rules, withdraw, and who prepared it', async()=>{
 schedules=[{schedule_id:'d1',client_id:'c1',starts_on:'2026-10-01',ends_on:'2026-10-31',inputs:[{rate_key:'KE_EXCISE_LPG',quantity:100,from:'2026-10-01',to:'2026-10-31'}],result:{lines:[{rate_key:'KE_EXCISE_LPG',label:'Excise duty on LPG',from:'2026-10-01',to:'2026-10-31',basis:'Amount per unit',quantity:100,unit:'Kilogram',rate_per_unit:12.5,duty:1250}],total_duty:1250,issues:[],notices:[],not_for_filing:true},total_duty:'1250.00',rules_status:'TESTING',status:'Draft',created_by:'s1',prepared_by_name:null,created_at:'2026-11-12',revision:3}];
 me={category_code:'MANAGER',staff_id:'s1'};
 await ui.handle('xsched-schedule','c1');assert.match(document.querySelector('#editorBody').textContent,/2026-10.*1,250\.00.*Testing.*Fictional Preparer/,'the name falls back to the staff list');
 await ui.handle('xsched-view','d1');const t=()=>document.querySelector('#editorBody').textContent;
 assert.match(t(),/TESTING — NOT FOR FILING/);assert.match(t(),/A different Manager or Partner must review/);assert.ok(![...document.querySelectorAll('button')].some(b=>b.dataset.action==='xsched-review'),'the preparer sees no Review button');
 me={category_code:'MANAGER',staff_id:'s2'};await ui.handle('xsched-view','d1');
 const acts=[...document.querySelectorAll('button')].map(b=>b.dataset.action);assert.ok(acts.includes('xsched-review')&&acts.includes('xsched-withdraw')&&acts.includes('xsched-edit'));
 me={category_code:'ASSISTANT',staff_id:'s2'};await ui.handle('xsched-view','d1');const a2=[...document.querySelectorAll('button')].map(b=>b.dataset.action);assert.ok(!a2.includes('xsched-review')&&!a2.includes('xsched-withdraw'));
 me={category_code:'MANAGER',staff_id:'s2'};
 await ui.handle('xsched-review','d1');sent.length=0;const f=F();f.elements.review_note.value='Agreed to the fictional sales book';f.elements.confirmed.checked=true;await submit(new dom.window.FormData(f));
 assert.deepEqual({a:sent[0].action,id:sent[0].schedule_id,rev:sent[0].revision,note:sent[0].review_note,ok:sent[0].confirmed},{a:'excise_schedule_review',id:'d1',rev:3,note:'Agreed to the fictional sales book',ok:true});
 await ui.handle('xsched-withdraw','d1');sent.length=0;F().elements.reason.value='Fictional reason to withdraw';await submit(new dom.window.FormData(F()));assert.equal(sent[0].action,'excise_schedule_withdraw');assert.equal(sent[0].reason,'Fictional reason to withdraw');
 await ui.handle('xsched-edit','d1');assert.equal(title,'Edit draft excise schedule');assert.equal(el('month').readOnly,true);assert.equal(el('qty_0').value,'100');
 assert.equal(await ui.handle('other-action',''),false);
});

test('return and due date panel: confirm or fallback for leaders, the task for Partner, Manager or Supervisor, sales value is optional', async()=>{
 const box=()=>document.querySelector('#xsDueBox').textContent,acts=()=>[...document.querySelectorAll('#xsDueBox button')].map(b=>b.dataset.action);
 me={category_code:'MANAGER',staff_id:'s2'};
 dueReply={state:{filing_class:'VAT',suggested_due_date:'2026-11-20',status:null},task:null};
 await ui.handle('xsched-view','d1');
 assert.match(box(),/same record as this client's VAT, TOT and MRI due date/);assert.match(box(),/Due date not confirmed yet/);
 assert.ok(acts().includes('xsched-due-confirm')&&acts().includes('xsched-due-fallback'));assert.ok(!acts().includes('xsched-task-new'),'no task button until the date is confirmed or the fallback chosen');assert.match(box(),/Confirm the due date/);
 dueReply={state:{filing_class:'VAT',suggested_due_date:'2026-11-20',status:'CONFIRMED',kra_due_date:'2026-11-20',confirmed_at:'2026-11-12',confirmed_by_name:'Fictional Lead'},task:null};
 await ui.handle('xsched-view','d1');assert.ok(acts().includes('xsched-task-new'));assert.match(box(),/2026-11-20/);
 me={category_code:'ASSISTANT',staff_id:'s2'};await ui.handle('xsched-view','d1');assert.ok(!acts().includes('xsched-due-confirm')&&!acts().includes('xsched-task-new'),'an assistant cannot confirm or create');
 // the task form: only this client's active engagements; a confirmed date is not editable
 me={category_code:'MANAGER',staff_id:'s2'};await ui.handle('xsched-schedule','c1');await ui.handle('xsched-task-new','d1');
 assert.equal(title,'Create the excise return task');assert.deepEqual([...el('project_id').options].map(o=>o.value).filter(Boolean),['p1'],'archived and other clients\' engagements are not offered');assert.equal(el('due_date'),undefined,'a confirmed KRA date is used as it is');
 sent.length=0;ch('project_id','p1');ch('assigned_to','s2');await submit(new dom.window.FormData(F()));
 assert.deepEqual({a:sent[0].action,s:sent[0].schedule_id,p:sent[0].project_id,u:sent[0].assigned_to},{a:'excise_schedule_task_create',s:'d1',p:'p1',u:'s2'});
 // fallback: a date must be chosen
 dueReply={state:{filing_class:'VAT',status:'TASK_DATE_FALLBACK',fallback_reason:'Fictional reason',confirmed_at:'2026-11-12',confirmed_by_name:'Fictional Lead'},task:null};
 await ui.handle('xsched-task-new','d1');assert.ok(el('due_date'),'the fallback asks for the task due date');
 // a task already created is shown, with no second button
 dueReply={state:{filing_class:'VAT',status:'CONFIRMED',kra_due_date:'2026-11-20'},task:{task_name:'Excise return · 2026-10 · Fictional',status:'Pending',due_at:'2026-11-20T14:00:00Z',due_basis:'CONFIRMED'}};
 await ui.handle('xsched-view','d1');assert.match(box(),/Return task: Excise return · 2026-10/);assert.ok(!acts().includes('xsched-task-new'));
 // fallback and confirm forms send the right actions
 await ui.handle('xsched-due-fallback','d1');sent.length=0;F().elements.fallback_reason.value='Fictional: calendar not available';await submit(new dom.window.FormData(F()));assert.equal(sent[0].action,'excise_schedule_due_fallback');
 await ui.handle('xsched-due-confirm','d1');sent.length=0;F().elements.kra_due_date.value='2026-11-20';F().elements.itax_confirmed.checked=true;await submit(new dom.window.FormData(F()));assert.deepEqual({a:sent[0].action,d:sent[0].kra_due_date,t:sent[0].itax_confirmed},{a:'excise_schedule_due_confirm',d:'2026-11-20',t:true});
});
