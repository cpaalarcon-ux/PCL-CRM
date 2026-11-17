import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {columnOf,dueMatches,byUrgency,workItems,renderMyWork,setMyWork,resetMyWork,myWorkState,loadMyWorkMode,COLUMNS,MY_WORK_KEY} from '../staff-my-work.mjs?v=20261121-coa-v1';
import {renderDashboard} from '../staff-dashboard.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
const T='2026-11-17';
const projects=[{project_id:'p1',client_id:'c1',handling_firm_id:'f1',project_name:'VAT Alpha'},{project_id:'p2',client_id:'c2',handling_firm_id:'f1',project_name:'Audit Beta'}];
const names={c1:'Alpha Ltd',c2:'Beta Ltd'};
const task=(id,project_id,status,due,extra={})=>({task_id:id,project_id,assigned_to:'me',task_name:'Task '+id,status,due_at:due,...extra});
const mine=[task('a','p1','Pending','2026-11-20T09:00:00Z'),task('b','p2','In Progress','2026-11-10T09:00:00Z'),task('c','p1','Blocked',null,{blocked_reason:'Waiting for bank statement'}),task('d','p2','In Review','2026-11-18T09:00:00Z'),task('e','p1','Waiting on client','2026-11-30T09:00:00Z'),task('f','p2','Returned','2026-11-16T09:00:00Z'),task('g','p1','Some New Status','2026-11-25T09:00:00Z')];
const review=[task('r1','p2','In Review','2026-11-19T09:00:00Z',{assigned_to:'other'}),task('d','p2','In Review','2026-11-18T09:00:00Z')];
const ctx=(over={})=>({esc,shortDate:s=>String(s).slice(0,10),clientName:id=>names[id]||'?',projectName:id=>projects.find(p=>p.project_id===id)?.project_name||'?',today:T,mine,review,projects,...over});
test.beforeEach(()=>resetMyWork());

test('each task lands in one column by its status; an unknown status is not hidden',()=>{
 assert.deepEqual(['Pending','In Progress','In Review','Blocked','Waiting on client','Paused','Returned','Pending manager','Some New Status'].map(s=>columnOf({status:s})),['To do','In progress','In review','Blocked or waiting','Blocked or waiting','Blocked or waiting','Blocked or waiting','Blocked or waiting','To do']);
 assert.deepEqual(COLUMNS,['To do','In progress','Blocked or waiting','In review','For my review']);
});
test('every open task and every task waiting for my review appears once, across all clients, overdue first',()=>{
 const w=workItems({mine,review,projects,clientName:id=>names[id],filter:{client:'',due:'all'},today:T});
 assert.equal(w.items.length,mine.length+1,'a task that is both mine and in the review list is shown once, as mine');
 assert.equal(w.items.filter(i=>i.task.task_id==='d').length,1);assert.equal(w.items.find(i=>i.task.task_id==='d').kind,'mine');
 assert.equal(w.items.find(i=>i.task.task_id==='r1').column,'For my review');
 assert.deepEqual(w.columns.map(c=>c.name),COLUMNS);assert.equal(w.columns.reduce((n,c)=>n+c.items.length,0),w.items.length);
 assert.deepEqual(w.clients.map(c=>c[1]),['Alpha Ltd','Beta Ltd']);
 // overdue (b: 10 Nov, f: 16 Nov) come before due-soon, then no due date last
 assert.deepEqual(w.items.map(i=>i.task.task_id).slice(0,2),['b','f']);assert.equal(w.items.at(-1).task.task_id==='c'||w.items.at(-1).task.due_at===null,true);
 assert.ok(byUrgency(T)({task_id:'x',due_at:'2026-11-01T00:00:00Z'},{task_id:'y',due_at:'2026-11-30T00:00:00Z'})<0);
});
test('filters by client and by due date change what is shown and nothing else',()=>{
 const f=filter=>workItems({mine,review,projects,clientName:id=>names[id],filter,today:T}).items.map(i=>i.task.task_id).sort().join('');
 assert.equal(f({client:'c1',due:'all'}),'aceg');assert.equal(f({client:'c2',due:'all'}),'bdfr1');
 assert.equal(f({client:'',due:'overdue'}),'bf');assert.equal(f({client:'',due:'none'}),'c');assert.equal(f({client:'',due:'week'}),'adr1');
 assert.equal(dueMatches({due_at:'2026-11-17T20:30:00Z'},'overdue',T),false,'a task due today in Nairobi time is not overdue');
 assert.equal(dueMatches({due_at:'2026-11-17T22:30:00Z'},'week','2026-11-17'),true,'22:30 UTC is already the next day in Nairobi, still inside the week');
});
test('the board shows counts, the client, the engagement, an overdue mark, and only the existing buttons',()=>{
 setMyWork('mode','board');const r=renderMyWork(ctx());
 assert.equal(r.total,8);assert.deepEqual(r.counts,{'To do':2,'In progress':1,'Blocked or waiting':3,'In review':1,'For my review':1});
 assert.match(r.board,/Alpha Ltd/);assert.match(r.board,/Audit Beta/);assert.match(r.board,/Overdue/);assert.match(r.board,/Waiting for bank statement/);
 assert.match(r.board,/data-task="a"/);assert.match(r.board,/data-task-edit="a"/);
 assert.match(r.board,/data-task="r1"/);assert.doesNotMatch(r.board,/data-task-edit="r1"/,'work to review is opened, not re-statused by the reviewer from here');
 assert.match(r.board,/waiting for your review/);
 assert.match(r.bar,/data-my-work-select="client"/);assert.match(r.bar,/data-my-work-select="due"/);assert.match(r.bar,/aria-pressed="true"/);
 assert.doesNotMatch(r.board,/drag|draggable/i,'status is changed only through the existing task actions');
});
test('the list view hides the filters and the choice is kept per viewer, quietly failing without storage',()=>{
 const r=renderMyWork(ctx());assert.doesNotMatch(r.bar,/data-my-work-select/);assert.match(r.bar,/data-value="list"[^>]*aria-pressed="true"/);
 const mem={};const storage={setItem:(k,v)=>{mem[k]=v;},getItem:k=>mem[k]};
 setMyWork('mode','board',storage);assert.equal(mem[MY_WORK_KEY],'board');resetMyWork();assert.equal(loadMyWorkMode(storage),'board');
 resetMyWork();assert.equal(loadMyWorkMode({getItem(){throw new Error('blocked');}}),'list');setMyWork('mode','board',{setItem(){throw new Error('blocked');}});assert.equal(myWorkState().mode,'board');
 setMyWork('due','nonsense');assert.equal(myWorkState().due,'all');
 const none=renderMyWork(ctx({mine:[],review:[]}));assert.equal(none.total,0);
 setMyWork('mode','board');setMyWork('client','c1');setMyWork('due','none');assert.match(renderMyWork(ctx()).board,/Task c/);setMyWork('due','overdue');assert.match(renderMyWork(ctx()).board,/Nothing matches these filters/);
});
test('Home carries the switch, shows the board only when chosen, and the old list stays the default',()=>{
 const d={me:{staff_id:'me',category_code:'ASSISTANT'},staff:[{staff_id:'me',full_name:'Me'}],projects,tasks:mine,documents:[],timesheets:[],schedules:[],task_procedures:[],notifications:[],suite:{tax_cases:[],compliance:[],engagements:[],sales_reviews:[]},sales_reviews:[],variances:[],recon_reviews:[]};
 const base={data:d,firm:'',today:T,esc,shortDate:s=>String(s).slice(0,10),empty:s=>s,clientName:id=>names[id]||'?',projectName:id=>projects.find(p=>p.project_id===id)?.project_name||'?'};
 let html;try{html=renderDashboard(base);}catch(e){html=null;}
 assert.ok(html,'Home still renders');assert.match(html,/id="homeQueue"/);assert.match(html,/<h2>My Work<\/h2>/);assert.match(html,/data-my-work="mode" data-value="board"/);assert.doesNotMatch(html,/class="mywork-board"/);
 setMyWork('mode','board');const b=renderDashboard(base);assert.match(b,/class="mywork-board"/);assert.match(b,/Everything assigned to you, across every client/);assert.doesNotMatch(b,/class="home-task/,'one view at a time');
});
test('the controls are wired in the page, the cache tokens moved, and nothing here writes to the server',()=>{
 const pilot=rd('staff-pilot.mjs'),dash=rd('staff-dashboard.mjs'),mod=rd('staff-my-work.mjs'),css=rd('staff-pilot.css');
 assert.match(pilot,/b\?\.dataset\.myWork\)\{setMyWork\(b\.dataset\.myWork,b\.dataset\.value,globalThis\.localStorage\);render\(\)/);assert.match(pilot,/dataset\?\.myWorkSelect/);assert.match(pilot,/loadMyWorkMode\(globalThis\.localStorage\)/);
 assert.match(pilot,/staff-dashboard\.mjs\?v=20261121-coa-v1/);assert.match(dash,/staff-my-work\.mjs\?v=20261121-coa-v1/);assert.match(rd('staff-pilot.html'),/staff-pilot\.css\?v=20261121-fill-v1/);
 assert.doesNotMatch(mod,/request\(|fetch\(|action:/,'My Work reads the tasks already held and writes nothing');
 assert.match(css,/\.mywork-board \.kanban/);
});
