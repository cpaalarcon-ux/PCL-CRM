import test from 'node:test';import assert from 'node:assert/strict';import {dashboardData,renderDashboard,drillHome} from '../staff-dashboard.mjs';
function fixture(){return {me:{staff_id:'me',category_code:'ASSISTANT'},staff:[{staff_id:'me',full_name:'Current reviewer'},{staff_id:'other',full_name:'Other preparer'}],projects:[{project_id:'p1',handling_firm_id:'f1',client_id:'c1',project_name:'VAT'},{project_id:'p2',handling_firm_id:'f2',client_id:'c2'}],tasks:[{task_id:'t1',project_id:'p1',assigned_to:'me',task_name:'KRA VAT',due_at:'2026-10-23T14:00:00Z',status:'In Review',requires_document:true},{task_id:'t2',project_id:'p1',assigned_to:'other',task_name:'PAYE',due_at:'2026-10-24T14:00:00Z',status:'Pending'},{task_id:'t3',project_id:'p2',assigned_to:'me',task_name:'VAT',due_at:'2026-10-27T14:00:00Z',status:'Pending'},{task_id:'done',project_id:'p1',assigned_to:'me',task_name:'VAT',due_at:'2026-10-21T14:00:00Z',status:'Completed'}],documents:[],timesheets:[{staff_id:'me',project_id:'p1',work_date:'2026-10-23',hours:2,status:'Draft'},{staff_id:'me',project_id:'p2',work_date:'2026-10-23',hours:4,status:'Approved'},{staff_id:'other',project_id:'p1',work_date:'2026-10-23',hours:7,status:'Approved'}],suite:{tax_cases:[],compliance:[],engagements:[]},sales_reviews:[],schedules:[],notifications:[]};}
test('dashboard keeps own time/tasks, firm filtering and completed items separate',()=>{const d=fixture(),x=dashboardData(d,'f1','2026-10-24');assert.deepEqual(x.deadlines.map(t=>t.task_id),['t1']);assert.equal(x.time_hours,2);assert.equal(x.pending.length,1);assert.equal(x.upcoming.length,0);assert.equal(dashboardData(d,'','2026-10-24').upcoming[0].task_id,'t3');assert.equal(x.awaiting[0].task_id,'t1');});
test('review count and Home labels match the task, tax and sales review sources',()=>{const d=fixture();d.me.category_code='MANAGER';d.tasks.push({task_id:'task-review',project_id:'p1',assigned_to:'other',task_name:'Review purchase mapping',status:'In Review'});d.schedules=[{project_id:'p1',reviewer_id:'me'}];d.suite.tax_cases=[{project_id:'p1',case_id:'own',prepared_by:'me',status:'Submitted'},{project_id:'p1',case_id:'other',prepared_by:'other',status:'Submitted'}];d.sales_reviews=[{project_id:'p1',reconciliation_id:'sales-review',review_type:'Monthly',status:'Submitted',prepared_by:'other'}];const x=dashboardData(d,'f1','2026-10-24');assert.deepEqual(x.tax_reviews.map(c=>c.case_id),['other']);assert.equal(x.deadlines.length,2);assert.equal(x.reviewCount,3);const html=renderDashboard({data:d,firm:'f1',today:'2026-10-24',esc:String,shortDate:String,empty:String,clientName:()=> 'Example client',projectName:()=> 'Example project'});assert.match(html,/Example client/);assert.match(html,/Task, tax &amp; sales reviews/);assert.match(html,/Ledger journals and opening balances are in/);assert.match(html,/Sales &amp; bank reconciliation alerts/);assert.doesNotMatch(html,/VAT reconciliation alerts/);});

test('the Audit & assurance area uses its existing route, and a shared breadcrumb is declared in the page and renderer',async()=>{
 const {readFileSync}=await import('node:fs');const root=new URL('..',import.meta.url).pathname;
 const dash=readFileSync(root+'staff-dashboard.mjs','utf8'),html=readFileSync(root+'staff-pilot.html','utf8'),app=readFileSync(root+'staff-pilot.mjs','utf8'),ledger=readFileSync(root+'staff-ledger.mjs','utf8');
 assert.match(app,/view:'audit',title:'Audit & assurance',area:'audit'/);
 assert.match(html,/<nav id="crumbs"[^>]+aria-label="Breadcrumb"/);
 assert.match(app,/function paintCrumbs\(\)/);assert.match(app,/paintCrumbs\(\);\$\('#greeting'\)/);
 assert.match(ledger,/workspace-breadcrumb[^`]+Client accounting/);
 assert.match(app,/data-period="\$\{esc\(x\.period_id\|\|''\)\}"/);assert.match(app,/myReview==='journal'/);
});

test('Home figures are buttons that drill into the list behind them',()=>{
 const d=fixture();d.me.category_code='MANAGER';const html=renderDashboard({data:d,firm:'',today:'2026-10-24',esc:s=>String(s??''),shortDate:s=>String(s),empty:s=>s,clientName:()=>'Client',projectName:()=>'Project'});
 for(const k of ['queue','reviews','overdue'])assert.match(html,new RegExp(`<button type="button" class="card metric[^"]*" data-drill="${k}"`),k);
 assert.match(html,/id="homeQueue"/);assert.match(html,/id="homeReviewQueue"/);
 const a=fixture();a.me.category_code='ASSISTANT';const ah=renderDashboard({data:a,firm:'',today:'2026-10-24',esc:s=>String(s??''),shortDate:s=>String(s),empty:s=>s,clientName:()=>'Client',projectName:()=>'Project'});
 assert.doesNotMatch(ah,/data-drill="reviews"/,'a role without the review list gets a plain figure, not a dead button');
 const el=(tag='DIV')=>({tagName:tag,open:false,scrolled:false,focused:false,scrollIntoView(){this.scrolled=true;},focus(){this.focused=true;}});
 const q=el(),rv=el('DETAILS'),first=el('DETAILS');first.querySelector=()=>({setAttribute(){}});
 q.querySelectorAll=()=>[];q.querySelector=s=>s==='.home-task.overdue'?first:null;
 const doc={querySelector:s=>({'#homeQueue':q,'#homeReviewQueue':rv})[s]||null};
 assert.equal(drillHome('queue',doc),true);assert.equal(q.scrolled&&q.focused,true);
 assert.equal(drillHome('reviews',doc),true);assert.equal(rv.open,true,'the review list opens');assert.equal(rv.scrolled,true);
 assert.equal(drillHome('overdue',doc),true);assert.equal(first.open,true,'the first overdue task opens');
 assert.equal(drillHome('nothing',doc),false);assert.equal(drillHome('reviews',{querySelector:()=>null}),false);
});

test('the shared dialog form validates field by field and places server errors beside the field',async()=>{
 const {readFileSync}=await import('node:fs');const app=readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8'),css=readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');
 assert.match(app,/from '\.\/staff-field-errors\.mjs\?v=/);
 assert.match(app,/form\.noValidate=true;watchForm\(form\)/);
 assert.match(app,/const issues=validateForm\(form\);if\(issues\.length\)\{[^}]*issues\[0\]\.el\.focus\(\)/);
 assert.match(app,/applyServerError\(form,err\.message\)\.notice/);
 assert.match(css,/\.field-error\{/);assert.match(css,/\[aria-invalid=true\]/);
});
