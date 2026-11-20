import test from 'node:test';
import assert from 'node:assert/strict';
import {monthBounds,previousMonth,activeInMonth,payFor,personIssues,payIssues,draftLines,registerChanges,affectedMonths} from '../supabase/functions/staff-workspace-v12/payroll-register-rules.mjs';
import {registerTable,draftSummary,changesPanel} from '../staff-payroll-register.mjs';
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

// ---- Build 2819 ----
test('inactive periods: whole month out, part of a month flagged, return ends the period the day before',async()=>{
 const R=await import('../supabase/functions/staff-workspace-v12/payroll-register-rules.mjs');
 const b=R.monthBounds('2026-11'),ch=(o)=>({person_id:'p1',kind:'Inactive',status:'In force',starts_on:'2026-11-01',ends_on:'2026-12-31',reason:'Unpaid leave agreed',...o});
 assert.equal(R.inactivity([ch({})],'p1',b).state,'full');
 assert.equal(R.inactivity([ch({starts_on:'2026-11-10',ends_on:'2026-11-20'})],'p1',b).state,'partial');
 assert.equal(R.inactivity([ch({starts_on:'2026-11-10',ends_on:null})],'p1',b).state,'partial');
 assert.equal(R.inactivity([ch({ends_on:null})],'p1',b).state,'full','open-ended inactive covers the month');
 assert.equal(R.inactivity([ch({})],'p2',b),null);
 assert.equal(R.inactivity([ch({starts_on:'2026-12-01'})],'p1',b),null);
 // Returned on 15 Nov: inactive through 14 Nov, so November is partial; December is clear.
 const back=ch({status:'Returned',returned_on:'2026-11-15'});assert.equal(R.inactivity([back],'p1',b).state,'partial');assert.equal(R.inactivity([back],'p1',R.monthBounds('2026-12')),null);
 assert.deepEqual(R.inactiveSpan(back),{start:'2026-11-01',end:'2026-11-14'});
 // Separation requests and ended periods are not inactive.
 assert.equal(R.inactivity([{...ch({}),kind:'Separation',status:'Requested'}],'p1',b),null);
});
test('the register table shows Active, Inactive, separation pending and Separated, with the right buttons',()=>{
 const esc=s=>String(s).replace(/</g,'&lt;'),sd=s=>String(s);
 const people=[{person_id:'a',name:'A',relationship:'Employee',employment_type:'Permanent',status:'Active',started_on:'2026-01-01',revision:1},{person_id:'b',name:'B',relationship:'Employee',employment_type:'Permanent',status:'Active',started_on:'2026-01-01',revision:1},{person_id:'c',name:'C',relationship:'Employee',employment_type:'Permanent',status:'Left',started_on:'2026-01-01',left_on:'2026-05-31',revision:2}];
 const changes=[{change_id:'x1',person_id:'a',kind:'Inactive',status:'In force',starts_on:'2020-01-01',ends_on:null},{change_id:'x2',person_id:'b',kind:'Separation',status:'Requested',starts_on:'2026-12-31',requested_by:'m',requested_by_name:'Mary',reason:'Resigned, notice served',revision:'1'}];
 const html=registerTable({people,pays:[],changes},esc,sd);
 assert.match(html,/Inactive/);assert.match(html,/data-period-action="register-return" data-id="x1"/);assert.match(html,/Active, separation pending/);assert.match(html,/Separated/);
 assert.doesNotMatch(html,/register-leave" data-id="b"/,'a person with a pending separation is not asked twice');assert.match(html,/register-leave" data-id="a"/);assert.match(html,/register-inactive" data-id="b"/);
 const panel=changesPanel({people,changes,me:'z',can_decide:true},esc,sd);assert.match(panel,/Separations waiting for approval \(1\)/);assert.match(panel,/data-decision="Approve"/);assert.match(panel,/data-decision="Reject"/);
 assert.doesNotMatch(changesPanel({people,changes,me:'m',can_decide:true},esc,sd),/data-decision="Approve"/);assert.match(changesPanel({people,changes,me:'m',can_decide:true},esc,sd),/Withdraw request/);
 assert.doesNotMatch(changesPanel({people,changes,me:'z',can_decide:false},esc,sd),/data-decision/);
 const s=draftSummary({month:'2026-03',lines:[{}],skipped:[],changes:{new_staff:[],pay_changes:[],left:[{name:'C',left_on:'2026-02-28',reason:'Resigned',requested_by:'Mary',approved_by:'Peter'}],inactive:[{name:'A',from:'2026-03-01',to:null,reason:'Leave'}],returned:[],pending_separations:[{name:'B',effective_on:'2026-03-31'}]},warnings:[{name:'D',detail:'Inactive for part'}],missing:[],issues:[],note:'n'},esc,sd);
 assert.match(s,/approved by Peter/);assert.match(s,/Inactive this month \(1\)/);assert.match(s,/Separations not yet approved/);assert.match(s,/Check before saving/);
});
