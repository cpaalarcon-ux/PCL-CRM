// Tax credit register screen (build 2730): what each person sees on an entry, the panel text and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {entryActions,panelView,appliesToKind,TYPES_FOR,CREDIT_LABELS,STATUS_TEXT} from '../staff-credits.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const btn=(a,l,id)=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const me=(cat,id)=>({category_code:cat,staff_id:id});
const vat={case_id:'c1',project_id:'p1',kind:'VAT',status:'Draft',starts_on:'2026-09-01',ends_on:'2026-09-30'};
const e=(o={})=>({credit_id:'e1',project_id:'p1',credit_type:'WHT_VAT',applies_to:'VAT',period_start:'2026-09-01',period_end:'2026-09-30',source_reference:'CERT-1',erp_amount:'1000.00',itax_amount:null,variance:null,status:'PENDING',entered_by:'u1',claimed_in_case_id:null,revision:'1',...o});
const names=x=>x.map(a=>a[0]);

test('tax kinds map to the right side: VAT credits and income-tax credits are never mixed',()=>{
 assert.equal(appliesToKind('VAT'),'VAT');for(const k of ['Company','Individual','Partnership'])assert.equal(appliesToKind(k),'INCOME_TAX');
 for(const k of ['PAYE','TOT','MRI','WHT','NSSF'])assert.equal(appliesToKind(k),null);
 assert.deepEqual(TYPES_FOR.VAT,['WHT_VAT','VAT_CARRIED_FORWARD']);assert.deepEqual(TYPES_FOR.INCOME_TAX,['WHT_INCOME_TAX','INSTALMENT_TAX','INCOME_TAX_CARRIED_FORWARD']);
 for(const t of [...TYPES_FOR.VAT,...TYPES_FOR.INCOME_TAX])assert.ok(CREDIT_LABELS[t]);
 for(const s of ['PENDING','RECONCILED','DISPUTED','MANAGER_APPROVED','REJECTED'])assert.ok(STATUS_TEXT[s]);
});
test('the person who entered a credit cannot check it or approve its difference',()=>{
 assert.deepEqual(names(entryActions(e(),me('MANAGER','u1'),vat)),['credit-reject'],'only rejecting remains for the person who entered it');
 assert.deepEqual(names(entryActions(e(),me('MANAGER','u2'),vat)),['credit-itax','credit-reject']);
 assert.deepEqual(names(entryActions(e(),me('ASSISTANT','u2'),vat)),['credit-itax'],'a preparer can check iTax but cannot reject');
 const d=e({status:'DISPUTED',itax_amount:'900.00',variance:'-100.00'});
 assert.deepEqual(names(entryActions(d,me('MANAGER','u1'),vat)),['credit-reject']);
 assert.deepEqual(names(entryActions(d,me('PARTNER','u3'),vat)),['credit-itax','credit-approve','credit-reject']);
 assert.deepEqual(names(entryActions(d,me('SUPERVISOR','u3'),vat)),['credit-itax']);
});
test('claiming is offered only for a settled credit and only while the return is a draft',()=>{
 for(const s of ['RECONCILED','MANAGER_APPROVED'])assert.deepEqual(names(entryActions(e({status:s}),me('ASSISTANT','u2'),vat)),['credit-claim']);
 assert.deepEqual(names(entryActions(e({status:'RECONCILED'}),me('ASSISTANT','u2'),{...vat,status:'Submitted'})),[],'not once submitted');
 assert.deepEqual(names(entryActions(e({status:'RECONCILED',claimed_in_case_id:'c1'}),me('ASSISTANT','u2'),vat)),['credit-release']);
 assert.deepEqual(names(entryActions(e({status:'RECONCILED',claimed_in_case_id:'c1'}),me('ASSISTANT','u2'),{...vat,status:'Locked'})),[],'a locked return keeps its credits');
 assert.deepEqual(names(entryActions(e({status:'RECONCILED',claimed_in_case_id:'other'}),me('ASSISTANT','u2'),vat)),[],'a credit claimed in another return offers nothing here');
});
test('the panel shows only credits of this tax and period, warns about open entries and totals the claim once',()=>{
 const credits=[e(),e({credit_id:'e2',status:'RECONCILED',itax_amount:'500.00',variance:'0.00',erp_amount:'500.00',source_reference:'CERT-2',claimed_in_case_id:'c1',claim_amount:'500.00'}),
  e({credit_id:'e3',credit_type:'INSTALMENT_TAX',applies_to:'INCOME_TAX',source_reference:'INST-1'}),e({credit_id:'e4',period_start:'2026-01-01',period_end:'2026-01-31',source_reference:'OLD-1'}),e({credit_id:'e5',status:'REJECTED',source_reference:'GONE-1'})];
 const html=panelView({credits,caseRec:vat,claimed:[{credit_type:'WHT_VAT',entries:1,claim_total:'500.00'}],me:me('MANAGER','u2'),button:btn});
 assert.match(html,/CERT-1/);assert.match(html,/CERT-2/);assert.doesNotMatch(html,/INST-1/,'an income-tax credit is not shown in a VAT return');assert.doesNotMatch(html,/OLD-1/,'another period');assert.doesNotMatch(html,/GONE-1/,'rejected entries are hidden');
 assert.match(html,/<b>1<\/b> credit entry needs the iTax check/);
 assert.match(html,/Claimed in this return — Withholding VAT credit: <b>[^<]*500[^<]*<\/b> \(1\)/);
 assert.equal(panelView({credits,caseRec:{...vat,kind:'PAYE'},claimed:[],me:me('MANAGER','u2'),button:btn}),'','no panel for returns without credits');
 assert.match(panelView({credits:[],caseRec:vat,claimed:[],me:me('MANAGER','u2'),button:btn}),/No credits recorded for this period yet/);
});
test('the case screen and suite are wired, and nothing computes a credit',()=>{
 const suite=read('staff-suite.mjs'),src=read('staff-credits.mjs');
 assert.match(suite,/createCreditUI\(\{\.\.\.ctx,button,area,check,openTax:id=>taxOpen\(id\)\}\)/);assert.match(suite,/credits\.handle\(action,id\)/);assert.match(suite,/credits\.panel\(c,r\.credits_claimed\)/);assert.match(suite,/\$\{saPanel\}\$\{creditPanel\}/);
 assert.doesNotMatch(src,/\*\s*0\.\d|rate|percent/i,'the screen applies no rate or formula');
 assert.ok(!/ISRS\s*4000/i.test(src));
});
