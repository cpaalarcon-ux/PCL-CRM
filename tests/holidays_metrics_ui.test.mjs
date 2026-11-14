// Build .106 screens: Partner-only holidays card, Home metrics widget, notification bell, and timer-suggests / manual-hours-recorded flow.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
import {createHolidaysUI} from '../staff-holidays.mjs';import {createMetricsUI} from '../staff-metrics.mjs';import {createBell} from '../staff-bell.mjs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const setup=()=>{const dom=new JSDOM('<div id="bell"></div><section id="homeMetrics"></section><dialog id="editor"></dialog>');globalThis.window=dom.window;globalThis.document=dom.window.document;return dom;};
const tick=()=>new Promise(r=>setTimeout(r,5));
test('the holiday card is Partner only and lists dates with their status',async()=>{
 setup();let me='MANAGER',calls=[];
 const ui=createHolidaysUI({esc:String,request:async p=>{calls.push(p.action);return {holidays:[{holiday_date:'2026-12-25',name:'Christmas Day',is_working_day:false,confirmed:false,source_note:'Seeded'},{holiday_date:'2026-12-26',name:'Boxing Day / Utamaduni Day',is_working_day:true,confirmed:true,source_note:'Gazette notice 12',confirmed_by_name:'Fictional Partner',confirmed_at:'2026-11-08T10:00:00Z'}]};},notice(){},modal(){},form:x=>x,field:()=>'',data:()=>({me:{category_code:me}}),render(){}});
 assert.equal(ui.render(),'','a Manager sees no holiday card and no request is made');assert.deepEqual(calls,[]);
 me='PARTNER';assert.match(ui.render(),/Loading/);await tick();
 const html=ui.render();assert.match(html,/Christmas Day/);assert.match(html,/Unconfirmed/);assert.match(html,/Clocks paused/);assert.match(html,/Firm works/);assert.match(html,/Fictional Partner/);
});
test('the metrics widget shows realization and keeps cash and margin apart',async()=>{
 setup();let sent=null;
 const ui=createMetricsUI({esc:String,request:async p=>{sent=p;return {scope:'firm',client_count:2,billed_net:15000,standard_value:20000,realization_pct:75,hours_without_rate:1.5,wip_unbilled:5000,receivables_total:12400,ageing:{not_due:12400,d1_30:0,d31_60:0,d61_90:0,over_90:0},cash_collected:5000,staff_cost:6000,gross_margin:9000};}});
 await ui.paint();const box=document.querySelector('#homeMetrics').innerHTML;
 assert.equal(sent.action,'metrics_summary');assert.match(sent.period_from,/^\d{4}-01-01$/,'year to date by default');
 assert.match(box,/75\.0%/);assert.match(box,/Cash and margin/);assert.ok(box.indexOf('Realization')<box.indexOf('Cash and margin')<box.indexOf('Cash collected'),'cash and margin sit in their own block');
 assert.match(box,/no standard rate/);assert.match(box,/credit notes/);
});
test('a refused metrics request is explained, not hidden',async()=>{
 setup();const ui=createMetricsUI({esc:String,request:async()=>{throw new Error('Metrics are for Managers and Partners.');}});await ui.paint();
 assert.match(document.querySelector('#homeMetrics').innerHTML,/Metrics are for Managers and Partners/);
});
test('the bell counts unread alerts, opens a task and marks read',async()=>{
 setup();const sent=[];let opened=null,d={notifications:[{notification_id:'n1',task_id:'t1',message:'Task waiting 4 working hours',created_at:'2026-11-08T08:00:00Z'},{notification_id:'n2',message:'Another alert',created_at:'2026-11-08T09:00:00Z'}]};
 const bell=createBell({esc:String,request:async p=>{sent.push(p);return {};},notice(){},shortDate:x=>x.slice(0,10),load:async()=>{d={notifications:[]};},openTask:id=>{opened=id;},data:()=>d});
 bell.paint();assert.equal(document.querySelector('#bellBadge').textContent,'2');
 document.querySelector('#bellButton').click();bell.paint();assert.match(document.querySelector('#bellPanel').innerHTML,/Task waiting 4 working hours/);
 document.querySelector('[data-bell="task"]').click();await tick();await tick();
 assert.deepEqual(sent.map(x=>x.action),['notification_read']);assert.equal(sent[0].notification_id,'n1');assert.equal(opened,'t1');
 bell.paint();assert.equal(document.querySelector('#bellBadge').hidden,true);
});
test('the timer only suggests: stopping opens the manual form and the keyed hours are what is saved',()=>{
 const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8'),v6=rd('staff-workspace-v6.mjs'),pres=rd('staff-presence.mjs'),task=rd('staff-task-workspace.mjs');
 assert.match(pres,/logTime\(null,r\.suggested\.task_id,r\.suggested\)/,'stopping the timer opens the time form, it does not record');
 assert.doesNotMatch(pres,/if\(r\.timesheet_id\)logTime/);
 assert.match(v6,/The hours you key in are what is recorded/);assert.match(v6,/name="timer_seconds"/);
 assert.match(task,/data-v6="time" data-task-id/,'each own open task has a manual time button');assert.match(task,/data-presence="timer-start" data-id/,'and a Start timer button');
});
