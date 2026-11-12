// Build 2791: the tax rule form. The person keys only dates and figures; the rule is chosen from a list or shown as fixed text; rate boxes start blank.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const dom=new JSDOM('<!doctype html><dialog id="editor"><div id="editorBody"></div></dialog>');globalThis.document=dom.window.document;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const options=(items,value,blank='Choose…')=>`<option value="">${esc(blank)}</option>`+items.map(x=>{let [v,l]=Array.isArray(x)?x:[x,x];return `<option value="${esc(v)}"${String(v)===String(value)?' selected':''}>${esc(l)}</option>`;}).join('');
const field=(name,label,value='',type='text',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const select=(name,label,items,value='',blank='Choose…')=>`<label>${label}<select name="${name}">${options(items,value,blank)}</select></label>`;
const rates=[
 {rate_id:'r1',rate_key:'KE_VAT_FICTIONAL',tax_type:'VAT',label:'Fictional VAT standard',effective_from:'2025-01-01',effective_to:'2025-12-31',parameters:{rate:7,treatment:'Standard'},status:'Approved',revision:3},
 {rate_id:'r2',rate_key:'KE_SEPT',tax_type:'Significant economic presence tax',label:'Significant economic presence tax (rate pending)',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{},status:'Draft',legal_review_status:'Pending',revision:1},
];
let modalHtml='',submit=null,sent=[];
const ctx={$:s=>document.querySelector(s),esc,field,select,
 form:(body,button='Save')=>`<form id="editForm" class="form-grid">${body}<button type="submit">${button}</button></form>`,
 modal:(title,html,fn)=>{modalHtml=title;document.querySelector('#editorBody').innerHTML=html;submit=fn;},
 request:async p=>{sent.push(p);return {ok:true};},shortDate:v=>v,badge:v=>v,today:()=>'2026-11-12',table:()=>'',button:(a,l)=>`<button>${l}</button>`,
 area:(n,l,v='',req=false)=>`<label class="full">${l}<textarea name="${n}">${esc(v)}</textarea></label>`,check:(n,l,y=false)=>`<label><input type="checkbox" name="${n}" ${y?'checked':''}>${l}</label>`,
 data:()=>({me:{category_code:'MANAGER',staff_id:'m1'},suite:{rates,release:null},clients:[],firms:[]}),render(){}};
const {createTaxConfigUI}=await import('../staff-tax-config.mjs');
const ui=createTaxConfigUI(ctx);
const F=()=>document.querySelector('#editForm'),el=n=>F().elements[n];
const send=async()=>{const f=new dom.window.FormData(F());return submit(f);};
const change=(n,v)=>{el(n).value=v;el(n).dispatchEvent(new dom.window.Event('change'));};

test('Add dated rule: the rule is chosen from a list, nothing about the rule is typed, and dates are suggested',async()=>{
 await ui.handle('rate-new','');assert.equal(modalHtml,'Add dated rule');
 const choice=el('rule_choice');assert.ok(choice,'a dropdown picks the rule');
 const opts=[...choice.options].map(o=>o.value);assert.deepEqual(opts,['','KE_VAT_FICTIONAL','KE_SEPT','__new__']);
 assert.match([...choice.options].find(o=>o.value==='KE_SEPT').textContent,/^Significant economic presence tax · Significant economic presence tax$/,'the "(rate pending)" suffix is not repeated in the list');
 assert.equal(document.querySelector('#newRuleFields').hidden,true,'the new-rule fields stay hidden unless asked for');
 assert.ok(!document.querySelector('#newRuleFields [required]'),'hidden boxes never block saving');
 await assert.rejects(()=>send(),/Choose the rule first/);
 change('rule_choice','KE_VAT_FICTIONAL');
 assert.equal(el('rate_key').value,'KE_VAT_FICTIONAL');assert.equal(el('tax_type').value,'VAT');assert.equal(el('label').value,'Fictional VAT standard');
 assert.equal(el('effective_from').value,'2026-01-01','a new version starts the day after the last one ends');assert.equal(el('effective_to').value,'2026-12-31');
 assert.equal(el('rate').value,'','a rate box is blank, never 0');assert.equal(el('rate').max,'100');assert.ok(el('rate').required);assert.ok(el('treatment'));
 el('rate').value='9';await send();
 const p=sent.at(-1);assert.equal(p.action,'rate_save');assert.equal(p.rate_key,'KE_VAT_FICTIONAL');assert.equal(p.tax_type,'VAT');assert.equal(p.parameters.rate,9);assert.equal(p.effective_from,'2026-01-01');assert.ok(!('rule_choice' in p));assert.equal(p.rate_id,null);
});

test('dates: reviewed-through cannot be before effective-from',async()=>{
 await ui.handle('rate-new','');change('rule_choice','KE_VAT_FICTIONAL');el('rate').value='9';
 change('effective_from','2027-03-01');assert.equal(el('effective_to').value,'2027-12-31','reviewed-through follows the start to the year end');assert.equal(el('effective_to').min,'2027-03-01');
 el('effective_to').value='2027-01-01';await assert.rejects(()=>send(),/on or after Effective from/);
});

test('a rule that is not in the list opens the code fields, with a format hint',async()=>{
 await ui.handle('rate-new','');change('rule_choice','__new__');
 assert.equal(document.querySelector('#newRuleFields').hidden,false);assert.match(el('rate_key').getAttribute('pattern'),/A-Z/);assert.match(el('rate_key').title,/capital letters/);
 el('rate_key').value='KE_FICTIONAL_NEW';el('label').value='Fictional new rule';el('tax_type').value='Levy';el('rate').value='1';await send();
 assert.equal(sent.at(-1).rate_key,'KE_FICTIONAL_NEW');
});

test('Edit draft: the rule is fixed text, the placeholder rate box is blank, figures are typed',async()=>{
 await ui.handle('rate-edit','r2');assert.equal(modalHtml,'Edit draft rule');
 assert.ok(!el('rule_choice'),'no rule dropdown when editing');assert.equal(el('rate_key').type,'hidden');assert.equal(el('tax_type').type,'hidden');
 assert.match(document.querySelector('#editorBody').textContent,/Significant economic presence tax · Significant economic presence tax · code KE_SEPT/);
 assert.equal(el('rate').value,'','the placeholder has no rate, so the box is blank and not 0');
 el('rate').value='4';await send();const p=sent.at(-1);assert.equal(p.rate_id,'r2');assert.equal(p.revision,1);assert.equal(p.parameters.rate,4);assert.equal(p.rate_key,'KE_SEPT');
 await ui.handle('rate-edit','r1');assert.equal(el('rate').value,'7','an existing figure is shown');
});

test('New dated version: rule fixed, start is the day after the last version, nothing pre-filled for the figures except the old values',async()=>{
 await ui.handle('rate-version','r1');assert.equal(modalHtml,'New dated rule version');
 assert.equal(el('effective_from').value,'2026-01-01');assert.equal(el('effective_to').value,'2026-12-31');assert.ok(!el('rule_choice'));
 el('rate').value='8';await send();const p=sent.at(-1);assert.equal(p.rate_id,null);assert.equal(p.parameters.rate,8);
});

test('the other free text is only approval notes; wiring and label',()=>{
 const src=rd('staff-tax-config.mjs');assert.match(src,/<legend>Approval notes<\/legend>/);assert.match(src,/<summary>Advanced<\/summary>/);
 assert.doesNotMatch(src,/Stable rule code \*/,'the code is no longer a required typed field');
 assert.match(rd('staff-suite.mjs'),/staff-tax-config\.mjs\?v=20261112-excise-v3/);assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261112-excise-v3/);
 assert.equal(JSON.parse(rd('supabase/functions/staff-workspace-v12/release.json')).build,'2026-11-12.2794');assert.match(rd('staff-pilot.html'),/2026-11-12\.2794/);
 assert.doesNotMatch(src,/forensic|ISRS 4000/i);
});

test('server: a bad figure names the box, and the rules are unchanged',async()=>{
 const {number,amount}=await import('../supabase/functions/staff-workspace-v12/suite-rules.mjs');
 const {registryParameters}=await import('../supabase/functions/staff-workspace-v12/tax-registry.mjs');
 assert.throws(()=>number('',0,100),/Enter a valid number within the permitted range\./,'no label: the old message');
 assert.throws(()=>number('',0,100,'the rate (%)'),/Enter the rate \(%\) as a number from 0 to 100\./);
 assert.throws(()=>registryParameters('Levy',{}),/Enter the rate \(%\) as a number from 0 to 100\./,'a missing rate is named, as in the screenshot case');
 assert.throws(()=>registryParameters('Levy',{rate:101}),/the rate \(%\)/);
 assert.throws(()=>registryParameters('Registration threshold',{threshold:''}),/the annual threshold \(KES\)/);
 assert.throws(()=>registryParameters('NSSF',{employee_rate:'x',employer_rate:6,lower_limit:1,upper_limit:2}),/the employee rate \(%\)/);
 assert.equal(registryParameters('Levy',{rate:5}).rate,5);assert.equal(amount('12.345'),12.35);assert.throws(()=>amount('-1'),/valid number/);
});
