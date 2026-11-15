import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {reasonProblem,reopenBlockers,reopenNote,priorTotals,afterReopenAdvice,MIN_REASON} from '../supabase/functions/staff-workspace-v12/record-reopen-rules.mjs';
import {createRecordReopenUI} from '../staff-record-reopen.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('reason: at least 30 characters and a real sentence',()=>{
 assert.match(reasonProblem('short'),/at least 30/);assert.match(reasonProblem('a'.repeat(40)),/real reason/);assert.equal(reasonProblem('Wrong month was uploaded; found against the client payslips.'),'');assert.equal(MIN_REASON,30);
 assert.match(reasonProblem('x'.repeat(2001)+' reason words'),/too long|real/);
});
test('blockers: every cause is named, none is guessed',()=>{
 assert.deepEqual(reopenBlockers({status:'Confirmed',kind:'Sales',tax_open:true,entries:0,live_amendments:0}),[]);
 assert.match(reopenBlockers({status:'Submitted',kind:'Sales',tax_open:true}).join(' '),/Only a confirmed summary/);
 assert.match(reopenBlockers({status:'Confirmed',kind:'Sales',tax_open:false}).join(' '),/submitted or locked tax work/);
 assert.match(reopenBlockers({status:'Confirmed',kind:'Payroll',tax_open:true,entries:1}).join(' '),/1 accounting entry was prepared/);
 assert.match(reopenBlockers({status:'Confirmed',kind:'Payroll',tax_open:true,entries:3}).join(' '),/3 accounting entries were prepared/);
 assert.match(reopenBlockers({status:'Confirmed',kind:'Payroll',tax_open:true,live_amendments:1}).join(' '),/amendment is already in progress/);
 assert.match(reopenBlockers({status:'Confirmed',kind:'Purchases',tax_open:true}).join(' '),/Only sales and payroll/);
 assert.match(reopenBlockers({archived:true,status:'Confirmed',kind:'Sales',tax_open:true}).join(' '),/archived/);
 assert.ok(reopenBlockers({}).length>=2,'missing facts block rather than pass');
});
test('note, totals and advice',()=>{
 assert.equal(reopenNote('Wrong month was uploaded for this run.','A Partner'),'Partner exceptional reopen by A Partner: Wrong month was uploaded for this run.');
 assert.deepEqual(priorTotals('Payroll',{calculated:[{gross:100,net_pay:80},{gross:50,net_pay:40}]}),{employees:2,gross:150,net:120});
 assert.deepEqual(priorTotals('Sales',{groups:[{net:100,vat:16}]}),{net:100,vat:16,gross:116,categories:1});
 assert.match(afterReopenAdvice(1),/discard it and prepare the period again/);assert.match(afterReopenAdvice(0),/Submit it again/);
});
test('panel: a Partner sees the button only when the server says it can go ahead; others see nothing',()=>{
 const esc=v=>String(v??'').replace(/</g,'&lt;'),button=(a,l,id)=>`<button data-period-action="${a}" data-id="${id}">${l}</button>`;
 const ui=createRecordReopenUI({esc,form:()=>'',request:async()=>({})},{show:()=>{},button});
 assert.match(ui.panel({status:'Confirmed',import_id:'i1',can_reopen:true,blockers:[]}),/Reopen with a reason/);
 assert.equal(ui.panel({status:'Confirmed',import_id:'i1',partner_only:true,can_reopen:false,blockers:[]}),'');
 assert.match(ui.panel({status:'Confirmed',import_id:'i1',can_reopen:false,blockers:['1 accounting entry was prepared <b>']}),/not available[\s\S]*&lt;b>/);
 assert.equal(ui.panel(null),'');assert.equal(ui.isAction('record-reopen'),true);
 const imp=rd('staff-period-imports.mjs');assert.match(imp,/record_reopen_check/);assert.match(imp,/reopen\.isAction\(action\)/);assert.match(imp,/staff-record-reopen\.mjs\?v=20261116-reopen-v1/);
});
