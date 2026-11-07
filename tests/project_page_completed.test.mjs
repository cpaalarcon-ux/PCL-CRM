// The project page: summary cards, Open / Completed chips, and a read-only Completed view with a "Raise correction" button instead of a reopen.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<main id="content"></main><dialog id="editor"><h2 id="title"></h2><p id="editorNotice"></p><div id="editorBody"></div></dialog>',{url:'https://example.test/staff-pilot'});
globalThis.document=dom.window.document;globalThis.FormData=dom.window.FormData;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
const {createWorkspaceUI}=await import('../staff-workspace-v6.mjs');
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayStr=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
const plus=n=>new Date(Date.parse(todayStr+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const at=day=>day+'T17:00:00+03:00';
const mk=(id,name,status,dueDay,extra={})=>({task_id:id,project_id:'p1',assigned_to:'s-prep',task_name:name,status,due_at:at(dueDay),revision:1,template_key:'monthly-vat',period_start:'2026-10-01',period_end:'2026-10-31',...extra});
function mount(role){
 const data={me:{staff_id:'s-mgr',category_code:role},clients:[{client_id:'c1',company_name:'UAT Fictional Test Ltd'}],firms:[],services:[],candidates:[],
  projects:[{project_id:'p1',client_id:'c1',handling_firm_id:'f1',project_name:'KRA Tax Compliance — UAT Fictional Test Ltd',status:'Active',service_code:'TAX-COMP'}],
  schedules:[{project_id:'p1',frequency:'Monthly',enabled:true,starts_on:'2026-01-01',ends_on:'2026-12-31'}],work_periods:[],work_period_tasks:[],
  task_procedures:[{task_id:'t-done',project_id:'p1',profile:'Tax filing',stage:'Closed',prepared_by:'s-prep',reviewer_id:'s-rev',closed_by:'s-mgr',closed_at:'2026-11-06T10:00:00Z'}],
  tasks:[mk('t-late','Turnover tax · 2026-10-01','In Progress',plus(-2)),mk('t-week','VAT · 2026-10-01','In Review',plus(3)),mk('t-future','PAYE · 2026-11-01','Pending',plus(20)),mk('t-done','PAYE · 2026-10-01','Completed',plus(-10)),mk('t-done2','VAT · 2026-09-01','Completed',plus(-40),{period_start:'2026-09-01',period_end:'2026-09-30'})]};
 const names={'s-prep':'A. Otieno','s-rev':'S. Kamau','s-mgr':'J. Mwangi'},calls=[];
 const ctx={$,esc,field:(n,l,v='')=>`<label>${l}<input name="${n}" value="${esc(v)}"></label>`,select:(n,l,items,v)=>`<label>${l}<select name="${n}">${items.map(x=>`<option>${Array.isArray(x)?x[1]:x}</option>`).join('')}</select></label>`,form:b=>`<form id="editForm">${b}</form>`,modal:(t,h)=>{$('#title').textContent=t;$('#editorBody').innerHTML=h;},request:async p=>{calls.push(p);return {};},load:async()=>{},notice(){},shortDate:v=>String(v||'').slice(0,10),
  badge:v=>`<span class="badge">${esc(v)}</span>`,taskRows:l=>l.map(t=>`<div class="task-row">${esc(t.task_name)}</div>`).join(''),projectName:id=>id,staffName:id=>names[id]||'',clientName:id=>'UAT Fictional Test Ltd',firmName:()=>'PCL Kenya',today:()=>todayStr,empty:()=>'',data:()=>data,filtered:()=>data,firm:()=>'',
  render(){$('#content').innerHTML=ui.projects();ui.bind();}};
 const ui=createWorkspaceUI(ctx);ctx.render();
 const sel=$('#content [name=project]');sel.innerHTML='<option value="p1">x</option>';sel.value='p1';sel.onchange({target:sel});
 return {ui,ctx,calls,data};
}
test('Open is the default view: closed tasks are hidden, and the cards count open, overdue and due-this-week work',()=>{
 mount('MANAGER');const html=$('#content').innerHTML;
 assert.match(html,/class="project-stats"/);
 const stat=label=>new RegExp(`<small>${label}</small><strong>(\\d+)</strong>`).exec(html)[1];
 assert.equal(stat('Open tasks'),'3');assert.equal(stat('Overdue'),'1');assert.equal(stat('Due this week'),'1');
 assert.match(html,/Next deadline<\/small><strong>/);
 assert.deepEqual([...document.querySelectorAll('.task-row')].map(r=>r.textContent.split(' · ')[0]).sort(),['PAYE','Turnover tax','VAT']);
 assert.doesNotMatch(html,/completed-table/,'the completed table is not on the default view');
 assert.match(html,/data-filter="Completed"[^>]*>Completed<span class="n">2<\/span>/);assert.match(html,/data-filter="All"[^>]*>Open<span class="n">3<\/span>/);
 assert.match(html,/role="tablist"/);assert.doesNotMatch(html,/project-action-groups/,'the action buttons live in their own tabs, not above the tasks');
});
test('the Completed chip lists closed tasks with prepared, reviewed and closed-by sign-offs and offers Raise correction, never a reopen',()=>{
 const m=mount('MANAGER');document.querySelector('[data-filter="Completed"]').click();
 const html=$('#content').innerHTML;assert.match(html,/completed-table/);assert.match(html,/2 completed/);
 assert.match(html,/A\. Otieno/);assert.match(html,/S\. Kamau/);assert.match(html,/J\. Mwangi/);
 assert.match(html,/Raise correction/);assert.doesNotMatch(html,/>Reopen</);assert.doesNotMatch(document.querySelector('.completed-table').outerHTML,/Turnover tax/,'open work is not mixed into the completed list');
 assert.match(html,/audit-locked/);assert.match(html,/Nothing is deleted/);
 assert.ok(html.indexOf('Oct')<html.length,'grouped by period');
 document.querySelector('[data-v6="correction"][data-task="t-done"]').click();
 assert.equal($('#title').textContent,'Create task');assert.match($('#editorBody').innerHTML,/Correction · PAYE/);assert.match($('#editorBody').innerHTML,/audit-locked/);assert.match($('#editorBody').innerHTML,/t-done/,'the original task is referenced');
 assert.deepEqual(m.calls,[],'nothing is changed on the original task');
});
test('Overdue chip shows only late open work; switching back to Open restores the list',()=>{
 mount('SUPERVISOR');document.querySelector('[data-filter="Overdue"]').click();
 const rows=()=>[...document.querySelectorAll('.task-row')].map(r=>r.textContent);assert.deepEqual(rows().map(r=>r.split(' · ')[0]),['Turnover tax']);
 document.querySelector('[data-filter="All"]').click();assert.deepEqual(rows().map(r=>r.split(' · ')[0]).sort(),['PAYE','Turnover tax','VAT']);
});
test('the server-side payload carries who closed a task, and the build label moved together',()=>{
 assert.match(fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/workspace-read.ts',import.meta.url),'utf8'),/w\.closed_at,w\.closed_by,w\.revision/);
 const rel=JSON.parse(fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/release.json',import.meta.url),'utf8'));
 assert.match(JSON.stringify(rel),/2026-11-07\.95/);
});

test('tabs: Tasks opens first; each other tab shows only its own group of buttons; an Intern sees no import or accounting tab',()=>{
 mount('MANAGER');const tabs=()=>[...document.querySelectorAll('[data-v6="project-tab"]')].map(b=>b.dataset.tab);
 assert.deepEqual(tabs(),['Tasks','Schedule','Imports','Accounting & tax','Reports & team']);
 assert.equal(document.querySelector('.ptab.on').dataset.tab,'Tasks');assert.ok(document.querySelector('[data-filter="Completed"]'));assert.equal(document.querySelector('[data-v6="rows"]'),null);
 const open=name=>document.querySelector(`[data-v6="project-tab"][data-tab="${name}"]`).click();
 open('Imports');assert.ok(document.querySelector('[data-v6="rows"]'));assert.ok(document.querySelector('[data-period-import]'));assert.ok(document.querySelector('[data-purchase-ledger]'));assert.equal(document.querySelector('[data-ledger="open"]'),null);assert.equal(document.querySelector('[data-filter="Completed"]'),null);
 open('Accounting & tax');assert.ok(document.querySelector('[data-ledger="open"]'));assert.ok(document.querySelector('[data-accounting="reconciliations"]'));assert.equal(document.querySelector('[data-v6="rows"]'),null);
 open('Schedule');assert.ok(document.querySelector('[data-v6="project"]'));assert.ok(document.querySelector('[data-v6="preview"]'));assert.ok(document.querySelector('[data-v6="schedule-cancel"]'),'End recurrence is in the Schedule tab for a leader');assert.match($('#content').innerHTML,/How recurring work is scheduled/);
 open('Reports & team');assert.ok(document.querySelector('[data-v6="report"]'));assert.ok(document.querySelector('[data-chat-project]'));
 open('Tasks');assert.ok(document.querySelector('[data-filter="Completed"]'));
 assert.match($('#content').innerHTML,/class="project-stats"/,'the cards stay above the tabs on every tab');
});
test('an Intern gets only Tasks, Schedule and Reports; Supervisors and Managers see all five',()=>{
 mount('INTERN');assert.deepEqual([...document.querySelectorAll('[data-v6="project-tab"]')].map(b=>b.dataset.tab),['Tasks','Schedule','Reports & team']);
 mount('SUPERVISOR');assert.equal(document.querySelectorAll('[data-v6="project-tab"]').length,5);
});
test('switching to another project goes back to the Tasks tab (state is kept in the page module, reset per project)',()=>{
 const src=fs.readFileSync(new URL('../staff-workspace-v6.mjs',import.meta.url),'utf8');
 assert.match(src,/if\(selected!==tabProject\)\{tabProject=selected;projectTab='Tasks';\}/);
});
