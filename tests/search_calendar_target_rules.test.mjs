import test from 'node:test';import assert from 'node:assert/strict';
import {cleanQuery,queryProblem,likePattern,monthRange,shiftMonth,calendarEvents,byDay} from '../supabase/functions/staff-workspace-v12/search-calendar-rules.mjs';
import {summarise,entryIssues,ACTIVITIES} from '../supabase/functions/staff-workspace-v12/target-measure-rules.mjs';
test('search text is cleaned and wildcards are literal',()=>{
 assert.equal(cleanQuery('  a   b \n c '),'a b c');assert.equal(cleanQuery('x'.repeat(200)).length,80);
 assert.match(queryProblem('a'),/at least 2/);assert.equal(queryProblem('ab'),'');assert.equal(likePattern('50%_x\\'),'%50\\%\\_x\\\\%');
});
test('month ranges and shifting handle leap years and year ends',()=>{
 assert.deepEqual(monthRange('2028-02'),{from:'2028-02-01',to:'2028-02-29',days:29});assert.equal(monthRange('2026-13'),null);assert.equal(monthRange(''),null);
 assert.equal(shiftMonth('2026-12',1),'2027-01');assert.equal(shiftMonth('2026-01',-1),'2025-12');
});
test('the calendar combines tasks, KRA dates and period dates, and marks open items before today as overdue',()=>{
 const range=monthRange('2026-11'),today='2026-11-15';
 const ev=calendarEvents({range,today,
  tasks:[{task_name:'Open',due_at:'2026-11-05T09:00:00',status:'Pending',project_id:'p',client_name:'A'},{task_name:'Done',due_at:'2026-11-06T09:00:00',status:'Completed'},{task_name:'Later',due_at:'2026-12-01T09:00:00',status:'Pending'}],
  dues:[{status:'CONFIRMED',kra_due_date:'2026-11-20',filing_class:'PAYE',starts_on:'2026-10-01',ends_on:'2026-10-31',client_name:'A'},{status:'TASK_DATE_FALLBACK',suggested_due_date:'2026-11-20',filing_class:'VAT',starts_on:new Date('2026-10-01'),ends_on:new Date('2026-10-31'),client_name:'B'}],
  periods:[{return_due_date:'2026-11-30',internal_due_date:'2026-11-10',payment_due_date:null,starts_on:'2025-01-01',ends_on:'2025-12-31',client_name:'A'}]});
 assert.deepEqual(ev.map(e=>[e.date,e.kind,e.overdue]),[['2026-11-05','task',true],['2026-11-10','internal',true],['2026-11-20','kra',false],['2026-11-20','kra_suggested',false],['2026-11-30','return',false]]);
 assert.equal(byDay(ev).find(d=>d.date==='2026-11-20').items.length,2);
 assert.equal(ev.find(e=>e.kind==='kra_suggested').status,'Not confirmed on iTax');
});
const e=(o)=>({activity:'Payroll preparation',kind:'Current',period_label:'2026-10',minutes:10,first_pass:true,rework_minutes:0,missed_deadline:false,...o});
test('entry checks',()=>{
 assert.deepEqual(entryIssues({activity:'Payroll preparation',kind:'Baseline',period_label:'2026-06',minutes:90,method:'Timed'}),[]);
 assert.ok(entryIssues({activity:'Nope',kind:'Baseline',period_label:'2026-6',minutes:0,method:'Guess'}).length>=4);
 assert.match(entryIssues({activity:'Other',kind:'Baseline',period_label:'2026-06',minutes:5,method:'Estimated',note:'short'})[0],/estimate/);
 assert.ok(entryIssues({activity:'Other',kind:'Current',period_label:'2026-06',minutes:5,method:'Timed'}).some(x=>/review first time/.test(x)));
 assert.ok(entryIssues({activity:'Other',kind:'Current',period_label:'2026-06',minutes:5,method:'Timed',first_pass:true},{hasBaseline:false}).some(x=>/baseline/.test(x)));
});
test('the reduction is shown only after three periods and uses the latest three',()=>{
 const base=[e({kind:'Baseline',minutes:100,period_label:'2026-05',first_pass:null})];
 assert.equal(summarise(base).rows[0].state,'Nothing recorded'.replace('Nothing recorded','Needs 3 more periods'));
 const two=[...base,e({period_label:'2026-08',minutes:5}),e({period_label:'2026-09',minutes:5})];assert.equal(summarise(two).rows[0].state,'Needs 1 more period');assert.equal(summarise(two).overall,null);
 const old=[...two,e({period_label:'2026-07',minutes:90}),e({period_label:'2026-10',minutes:4}),e({period_label:'2026-11',minutes:3})];
 const r=summarise(old).rows[0];assert.deepEqual(r.periods_used,['2026-09','2026-10','2026-11']);assert.equal(r.current_minutes,4);assert.equal(r.reduction_pct,96);assert.equal(r.state,'Target reached');
 assert.equal(summarise(old,{target:97}).rows[0].state,'Below target');
 assert.equal(summarise([e({period_label:'2026-10'})]).rows[0].state,'No baseline');assert.equal(summarise([]).rows.length,0);
 assert.ok(ACTIVITIES.includes('Year rollover'));assert.match(summarise(old).note,/not a promise/);
});
test('accuracy is read beside the reduction',()=>{
 const rows=[e({kind:'Baseline',minutes:100,first_pass:null,period_label:'2026-05'}),...['2026-08','2026-09','2026-10'].map((m,i)=>e({period_label:m,minutes:5,first_pass:i!==0,missed_deadline:i===1,rework_minutes:i===0?30:0}))];
 const r=summarise(rows).rows[0];assert.equal(r.reduction_pct,95);assert.equal(r.rework_minutes,30);assert.equal(r.missed_deadlines,1);assert.equal(r.first_pass_rate,0.67);assert.match(r.accuracy_note,/1 missed deadline.*1 needed rework/);
});
