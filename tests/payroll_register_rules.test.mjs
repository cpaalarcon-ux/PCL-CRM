import test from 'node:test';
import assert from 'node:assert/strict';
import {monthBounds,previousMonth,activeInMonth,payFor,personIssues,payIssues,draftLines,registerChanges,affectedMonths} from '../supabase/functions/staff-workspace-v12/payroll-register-rules.mjs';
import {registerTable,draftSummary} from '../staff-payroll-register.mjs';
const p=(id,name,o={})=>({person_id:id,name,kra_pin:'A00000000'+id+'Z',national_id:'',employment_type:'Permanent',relationship:'Employee',started_on:'2026-01-01',left_on:null,...o});
const pay=(person_id,gross,eff,extra={})=>({person_id,gross,taxable_benefits:0,other_pension:0,mortgage_interest:0,postretirement_medical:0,effective_from:eff,reason:'r',...extra});
test('month helpers',()=>{assert.deepEqual(monthBounds('2026-02'),{start:'2026-02-01',end:'2026-02-28'});assert.equal(monthBounds('2026-13'),null);assert.equal(previousMonth('2026-01'),'2025-12');});
test('a person is active from the start month until the month of leaving',()=>{
 const b=monthBounds('2026-03');
 assert.equal(activeInMonth(p('1','a',{started_on:'2026-03-31'}),b),true);assert.equal(activeInMonth(p('1','a',{started_on:'2026-04-01'}),b),false);
 assert.equal(activeInMonth(p('1','a',{left_on:'2026-03-01'}),b),true);assert.equal(activeInMonth(p('1','a',{left_on:'2026-02-28'}),b),false);
});
test('the pay in force is the latest change on or before the month end',()=>{
 const pays=[pay('1',100,'2026-01-01'),pay('1',120,'2026-03-10'),pay('1',150,'2026-06-01')];
 assert.equal(payFor(pays,'1',monthBounds('2026-02')).gross,100);assert.equal(payFor(pays,'1',monthBounds('2026-03')).gross,120);assert.equal(payFor(pays,'1',monthBounds('2026-07')).gross,150);assert.equal(payFor(pays,'1',monthBounds('2025-12')),null);
});
test('draft lines carry recurring pay only and skip people without pay',()=>{
 const r=draftLines([p('1','Asha'),p('2','Baraka')],[pay('1',100000,'2026-01-01')],'2026-03');
 assert.equal(r.lines.length,1);assert.equal(r.lines[0].gross,100000);assert.equal(r.lines[0].evidence_reference,'');assert.equal(r.lines[0].date_paid,'');assert.equal(r.skipped[0].name,'Baraka');
});
test('changes: new staff, leavers and pay changes against the previous month',()=>{
 const people=[p('1','Asha'),p('2','Baraka',{left_on:'2026-02-28',left_reason:'Resigned'}),p('3','Chege',{started_on:'2026-03-01'})];
 const pays=[pay('1',100,'2026-01-01'),pay('1',120,'2026-03-01'),pay('2',50,'2026-01-01'),pay('3',70,'2026-03-01')];
 const c=registerChanges(people,pays,'2026-03');
 assert.deepEqual(c.new_staff.map(x=>x.name),['Chege']);assert.deepEqual(c.pay_changes.map(x=>[x.name,x.from,x.to]),[['Asha',100,120]]);assert.deepEqual(c.left.map(x=>x.name),['Baraka'],'left in February, reported in March');
 assert.deepEqual(registerChanges(people,pays,'2026-02').left.map(x=>x.name),[],'leaving month still active');
 assert.deepEqual(registerChanges(people,pays,'2026-04').left.map(x=>x.name),[],'reported once');
});
test('person and pay rules',()=>{
 assert.ok(personIssues({name:'X',relationship:'Owner',employment_type:'Permanent',kra_pin:'A000000001Z'}).some(x=>/Drawings/.test(x)));
 assert.ok(personIssues({name:'X',relationship:'Casual worker',employment_type:'Casual'}).some(x=>/ID number/.test(x)));
 assert.ok(personIssues({name:'X',relationship:'Director',employment_type:'Permanent',kra_pin:'A000000001Z'}).some(x=>/board resolution/.test(x)));
 assert.deepEqual(personIssues({name:'X',relationship:'Employee',employment_type:'Permanent',kra_pin:'A000000001Z'}),[]);
 assert.ok(payIssues({gross:0,effective_from:'2026-01-01',reason:'long enough reason'}).issues.length);assert.ok(payIssues({gross:5,effective_from:'',reason:'short'}).issues.length>=2);
 assert.deepEqual(payIssues({gross:'1,000.50',effective_from:'2026-01-01',reason:'long enough reason'}).issues,[]);
});
test('months already submitted or approved that a change reaches are listed',()=>{
 const imports=[{import_id:'a',status:'Confirmed',starts_on:'2026-08-01',ends_on:'2026-08-31'},{import_id:'b',status:'Draft',starts_on:'2026-09-01',ends_on:'2026-09-30'},{import_id:'c',status:'Submitted',starts_on:'2026-10-01',ends_on:'2026-10-31'}];
 assert.deepEqual(affectedMonths(imports,'2026-09-01').map(x=>x.month),['2026-10']);assert.deepEqual(affectedMonths(imports,'2026-08-15').map(x=>x.month),['2026-08','2026-10']);
});
test('screens escape names and show the month summary',()=>{
 const esc=s=>String(s).replace(/</g,'&lt;'),sd=s=>String(s);
 const html=registerTable({people:[p('1','<b>x</b>',{revision:1,status:'Active'})],pays:[pay('1',1000,'2026-01-01')]},esc,sd);assert.ok(!html.includes('<b>x</b>'));assert.ok(html.includes('Change pay'));
 const s=draftSummary({month:'2026-03',lines:[{}],skipped:[],changes:{new_staff:[],pay_changes:[],left:[]},missing:[],issues:[],existing_run:{status:'Confirmed'},note:'n'},esc,sd);assert.ok(s.includes('already exists'));
});
