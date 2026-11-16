import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {mandatoryState,buildClientTasks,clientConfigurationItems,CLIENT_INPUT_SECTIONS,TASK_ORDER} from '../supabase/functions/staff-workspace-v12/client-setup-tasks-rules.mjs';
import {linkHtml,filterTasks,queueHtml,queueBody,configurationHtml,taskRow} from '../staff-setup-tasks.mjs';
import {renewalsView,approvalsView,FILTER_DEFAULT} from '../staff-my-approvals.mjs';
import {CONFIGURE_TARGETS} from '../staff-settings-frame.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const me={staff_id:'m1',leader:true},C1='c1',C2='c2';
const base=o=>({clients:[{client_id:C1,company_name:'Alpha Fictional Ltd'},{client_id:C2,company_name:'Beta Fictional Ltd'}],sections:[],versions:{},journals:{},openingStatus:{},routing:[],engagements:[],me,...o});
const approvedAll=c=>['identity','registration','tax','ownership','activities','year_end','contacts','permanent_file','engagement'].map(code=>({client_id:c,section_code:code,status:'Approved',submitted_by:'x'}));

test('the chart and opening trial balance state is one shared rule',()=>{
 assert.deepEqual(mandatoryState([],[],null),{chart:'Draft',opening:'Blocked',opening_not_applicable:false});
 assert.equal(mandatoryState([{status:'Draft'}],[],null).chart,'Pending Review');
 assert.equal(mandatoryState([{status:'Returned'}],[],null).chart,'Correction Required');
 assert.equal(mandatoryState([{status:'Approved'},{status:'Draft'}],[],null).chart,'Approved');
 assert.equal(mandatoryState([{status:'Approved'}],[],null).opening,'Draft');
 assert.equal(mandatoryState([{status:'Approved'}],[{status:'Submitted'}],null).opening,'Pending Review');
 assert.equal(mandatoryState([{status:'Approved'}],[{status:'Posted'}],null).opening,'Approved');
 assert.equal(mandatoryState([{status:'Approved'}],[{status:'Returned'}],null).opening,'Correction Required');
 const none=mandatoryState([],[],'No opening balances');assert.equal(none.opening,'Approved');assert.equal(none.opening_not_applicable,true);
});

test('only what is recorded as unfinished becomes a task, and a finished client has none',()=>{
 const done=buildClientTasks(base({sections:approvedAll(C1),versions:{[C1]:[{status:'Approved'}]},journals:{[C1]:[{status:'Posted'}]}}));
 assert.deepEqual(done.filter(t=>t.client_id===C1),[],'a fully approved client has no task');
 assert.ok(done.some(t=>t.client_id===C2),'a client with nothing recorded has tasks');
 const none=buildClientTasks(base({clients:[]}));assert.deepEqual(none,[]);
});

test('sections: not started or returned are to prepare, pending are to review, and the submitter cannot review their own',()=>{
 const sections=[...approvedAll(C1).filter(s=>!['identity','tax','contacts'].includes(s.section_code)),
  {client_id:C1,section_code:'identity',status:'Pending Review',submitted_by:'m1'},
  {client_id:C1,section_code:'tax',status:'Pending Review',submitted_by:'other'},
  {client_id:C1,section_code:'contacts',status:'Correction Required',submitted_by:'other'}];
 const t=buildClientTasks(base({clients:[{client_id:C1,company_name:'Alpha'}],sections,versions:{[C1]:[{status:'Approved'}]},journals:{[C1]:[{status:'Posted'}]}}));
 assert.deepEqual(t.map(x=>x.kind),['section_prepare','section_review']);
 const prep=t[0],rev=t[1];
 assert.equal(prep.count,1);assert.equal(prep.items[0].code,'contacts');assert.equal(prep.items[0].needs_client,true);
 assert.equal(rev.count,2);assert.equal(rev.blocked_mine,1);assert.equal(rev.needs_me,true,'one of the two can be decided by this reviewer');
 const solo=buildClientTasks(base({clients:[{client_id:C1,company_name:'Alpha'}],sections:[{client_id:C1,section_code:'identity',status:'Pending Review',submitted_by:'m1'}],versions:{[C1]:[{status:'Approved'}]},journals:{[C1]:[{status:'Posted'}]}})).find(x=>x.kind==='section_review');
 assert.equal(solo.needs_me,false,'all pending sections are the reviewer\'s own');
 const asst=buildClientTasks(base({clients:[{client_id:C1,company_name:'Alpha'}],me:{staff_id:'a',leader:false},sections:[{client_id:C1,section_code:'identity',status:'Pending Review',submitted_by:'m1'}],versions:{[C1]:[{status:'Approved'}]},journals:{[C1]:[{status:'Posted'}]}})).find(x=>x.kind==='section_review');
 assert.equal(asst.needs_me,false,'only a Manager or Partner reviews');
});

test('chart, opening trial balance, routing mappings and service set-ups each give one specific task',()=>{
 const one=o=>buildClientTasks(base({clients:[{client_id:C1,company_name:'Alpha'}],sections:approvedAll(C1),...o}));
 assert.deepEqual(one({versions:{[C1]:[{status:'Draft'}]}}).map(x=>x.kind),['chart_review']);
 assert.deepEqual(one({versions:{[C1]:[{status:'Returned'}]}}).map(x=>x.kind),['chart_prepare']);
 assert.deepEqual(one({versions:{[C1]:[{status:'Approved'}]}}).map(x=>x.kind),['opening_prepare']);
 assert.deepEqual(one({versions:{[C1]:[{status:'Approved'}]},journals:{[C1]:[{status:'Submitted'}]}}).map(x=>x.kind),['opening_review']);
 assert.deepEqual(one({versions:{[C1]:[{status:'Approved'}]},openingStatus:{[C1]:'No opening balances'}}).map(x=>x.kind),[]);
 const ok={versions:{[C1]:[{status:'Approved'}]},openingStatus:{[C1]:'No opening balances'}};
 const r=one({...ok,routing:[{client_id:C1,status:'Draft',created_by:'m1'},{client_id:C1,status:'Draft',created_by:'z'},{client_id:C1,status:'Active',created_by:'z'},{client_id:C2,status:'Draft',created_by:'z'}]});
 assert.deepEqual(r.map(x=>[x.kind,x.count,x.blocked_mine,x.needs_me]),[['routing_review',2,1,true]],'only this client\'s drafts count; an active mapping is not a task');
 const e=one({...ok,engagements:[{client_id:C1,service_code:'TAX-COMP',period_start:'2026-01-01',period_end:'2026-12-31',status:'Waiting'},{client_id:C1,service_code:'AUD-STAT',period_start:'2026-01-01',period_end:'2026-12-31',status:'Released'}]});
 assert.deepEqual(e.map(x=>[x.kind,x.count]),[['engagement_waiting',1]]);assert.match(e[0].detail,/TAX-COMP 2026-01-01 to 2026-12-31/);
 assert.deepEqual(TASK_ORDER.filter(k=>!['section_prepare','chart_prepare','opening_prepare','engagement_waiting','section_review','chart_review','opening_review','routing_review','exception_review'].includes(k)),[]);
});

test('the client configuration list holds only what needs the client, one specific line each',()=>{
 const t=buildClientTasks(base({clients:[{client_id:C1,company_name:'Alpha'}],sections:[{client_id:C1,section_code:'tax',status:'Correction Required',submitted_by:'z'},{client_id:C1,section_code:'engagement',status:'Draft'}],versions:{[C1]:[{status:'Approved'}]},journals:{[C1]:[]}}));
 const items=clientConfigurationItems(t);
 assert.ok(items.some(i=>i.code==='tax'&&/corrected/.test(i.reason)));
 assert.ok(items.some(i=>i.code==='opening'&&/Opening balances/.test(i.reason)));
 assert.ok(!items.some(i=>i.code==='engagement'),'who is assigned is internal');
 assert.ok(!items.some(i=>i.code==='chart'),'the chart is the firm\'s work');
 assert.ok(CLIENT_INPUT_SECTIONS.every(c=>c!=='engagement'));
 const pending=buildClientTasks(base({clients:[{client_id:C1,company_name:'Alpha'}],sections:[{client_id:C1,section_code:'tax',status:'Pending Review',submitted_by:'z'}]}));
 assert.ok(!clientConfigurationItems(pending).some(i=>i.code==='tax'),'submitted and waiting for review is no longer waiting on the client');
});

test('the queue screen: search, filters, links and the separation from firm-wide approvals',()=>{
 const tasks=buildClientTasks(base({sections:[{client_id:C1,section_code:'identity',status:'Pending Review',submitted_by:'z'}],routing:[{client_id:C2,status:'Draft',created_by:'z'}]}));
 const res={tasks,configuration:clientConfigurationItems(tasks),clients_checked:2,clients_with_tasks:2,leader:true};
 const html=queueHtml(res,{});
 assert.match(html,/id="setupTaskSearch"/);assert.match(html,/firm-wide approvals in Settings/);assert.match(html,/Needs my action/);
 assert.equal(filterTasks(tasks,{search:'alpha'}).every(t=>t.company_name.startsWith('Alpha')),true);
 assert.equal(filterTasks(tasks,{search:'alpha beta'}).length,0,'every word must match');
 assert.ok(filterTasks(tasks,{search:'routing'}).every(t=>t.kind==='routing_review'));
 assert.ok(filterTasks(tasks,{who:'Reviewer'}).every(t=>t.who==='Reviewer'));
 assert.ok(filterTasks(tasks,{who:'mine'}).every(t=>t.needs_me));
 assert.match(queueBody(res,{search:'zzz'}),/Nothing matches/);
 assert.match(queueBody({tasks:[],clients_checked:3,clients_with_tasks:0},{}),/No client has unfinished set-up\. 3 active clients checked/);
 const L=g=>linkHtml({client_id:'c9',go:g},{leader:true});
 assert.match(L('setup'),/data-v3="setup-review" data-id="c9"/);assert.match(L('review'),/data-v3="setup-queue"/);assert.match(L('chart'),/data-v3="chart" data-id="c9"/);
 assert.match(L('opening'),/data-client-open="c9" data-client-tab="projects"/);assert.match(L('routing'),/data-suite="routing-map-open" data-id="c9"/);assert.match(L('engagement'),/data-v3="setup" data-id="c9"/);
 assert.doesNotMatch(linkHtml({client_id:'c9',go:'review'},{leader:false}),/<button/,'a non-reviewer gets no review button');
 assert.match(taskRow({client_id:'c9',company_name:'<b>X</b>',kind:'routing_review',who:'Reviewer',title:'t',count:3,detail:'d',blocked_mine:1,go:'routing'},{}),/&lt;b&gt;X&lt;\/b&gt;.*3.*1 of these was prepared by you/s,'text is escaped and own work is explained');
 const cfg=configurationHtml(res,{});assert.match(cfg,/Client configuration/);assert.match(cfg,/id="clientConfiguration"/);
 assert.match(configurationHtml({tasks:[],configuration:[],leader:true},{}),/Nothing is waiting on the client/);
 assert.equal(configurationHtml(null,{}),'','no section when the read was refused');
});

test('screens: buttons, the routing map leaves Settings, and the Configure link goes to Clients',()=>{
 const imp=rd('staff-improvements.mjs'),pilot=rd('staff-pilot.mjs'),suite=rd('staff-suite.mjs'),rmap=rd('staff-routing-map.mjs'),layout=rd('staff-settings-layout.mjs');
 assert.match(imp,/action:'client_setup_tasks_read'/);assert.match(imp,/a==='setup-tasks'\)await setupTasks\(\)/);assert.match(imp,/\$\{configurationHtml\(cfg,\{esc\}\)\}/);
 assert.match(imp,/data-suite="routing-map-open" data-id="\$\{esc\(id\)\}">Routing map/);
 assert.equal((pilot.match(/data-v3="setup-tasks"/g)||[]).length,2,'on the Clients screen for everyone with client access');
 assert.match(pilot,/if\(b\.dataset\.clientOpen\)\{if\(b\.closest\('#editor'\)&&\$\('#editor'\)\.open\)\$\('#editor'\)\.close\(\)/);
 assert.doesNotMatch(suite,/routingMapCard/);assert.doesNotMatch(layout,/routingMapCard/);assert.doesNotMatch(rmap,/settingsCard|id:'routingMapCard'/);
 assert.match(rmap,/async function handle\(action,id\)/);assert.match(rmap,/if\(id\)\{if\(\$\('#editor'\)\?\.open\)\$\('#editor'\)\.close\(\);await open\(id\);return true;\}/);
 assert.equal(CONFIGURE_TARGETS.routing_map.view,'clients');assert.equal(CONFIGURE_TARGETS.routing_map.tab,undefined);assert.match(CONFIGURE_TARGETS.routing_map.where,/Client Setup → Routing map/);
 assert.match(rd('staff-settings-frame.mjs'),/if\(target\.view\)\{[^}]*ctx\.navigate\(target\.view\)/);
 for(const f of ['staff-routing-map.mjs','staff-settings-frame.mjs','staff-settings-layout.mjs','staff-suite.mjs','staff-improvements.mjs','staff-my-approvals.mjs','staff-accounting.mjs','staff-workspace-v6.mjs'])assert.match(suite+imp+pilot+rd('staff-accounting.mjs')+rd('staff-workspace-v6.mjs'),new RegExp(f.replace('.','\\.')+'\\?v=20261116-(setuptasks|choices|bulk|practice|versions|dates)-v1'),f+' has a fresh cache token');
});

test('renewals: lapsed and ending soon, oldest first, with owner and a link to the record',()=>{
 const items=[{area:'eligibility',area_label:'Service eligibility',record_id:'r1',label:'Fictional licence',date:'2026-11-01',days:-15,what:'authorisation',lapsed:true,owner_label:'Partner'},{area:'tax_rate',area_label:'Tax rules',record_id:'r2',label:'Fictional rate',date:'2026-12-20',days:34,what:'period',lapsed:false,owner_label:''}];
 const h=renewalsView(items,{});
 assert.match(h,/data-lapsed="yes"/);assert.match(h,/Lapsed 15 days ago/);assert.match(h,/Ends in 34 days/);assert.match(h,/data-suite="settings-record" data-id="eligibility:r1"/);
 assert.match(renewalsView([],{}),/Nothing lapsed or ending within 60 days/);
 const page=approvalsView({note:'n',queues:[],records:[],renewals:items,scopes:[],roles:[]},{...FILTER_DEFAULT},{});
 assert.match(page,/<h3>Renewals<\/h3>/);assert.match(page,/data-v3="setup-tasks"/);assert.match(page,/separate queue/);
 assert.match(rd('supabase/functions/staff-workspace-v12/settings-owner-actions.ts'),/buildOverview\(Array\.isArray\(reg\)\?reg:\[\],\[\],t\)\.expiring/);
});

test('the server action is wired and refuses what it should',()=>{
 const a=rd('supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');
 assert.match(a,/'client_setup_tasks_read'/);assert.match(a,/service_status='Active' and record_status<>'Archived'/);
 assert.match(a,/mandatoryState\(v,j,c\?\.opening_balance_status\)/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/client_setup_/);
});
