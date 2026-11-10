// Step 7 (joined-practice review): the KRA notice screens, the server module, wiring and the rules it must not break.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {caseView,listView,flagListView,deadlineText,deadlineTone,bannerText,settingStatus,KRA_NOTE,FLAG_NAMES,SEVERITY_TONE,createKraUI} from '../staff-kra.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const button=(a,l,id='',x='')=>`<button data-suite="${a}" data-id="${id}" ${x}>${l}</button>`;
const me=(c,id='me')=>({category_code:c,staff_id:id});
const base=(o={})=>({case_id:'c1',client_id:'k1',client_name:'UAT <Fictional> Ltd',notice_reference:'KRA/AUD/1/2026',notice_type:'Audit notice',tax_head:'VAT',period_start:'2025-01-01',period_end:'2025-12-31',notice_date:'2026-11-01',received_on:'2026-11-02',
 deadline_date:'2026-11-20',days_left:11,status:'Open',summary:'Fictional audit of the 2025 VAT returns.',logged_by_name:'Ann Assistant',project_id:null,project_name:null,verification_task_id:null,task_urgent:false,revision:4,...o});
const mk=(c={},o={})=>({case:base(c),task:null,requests:[],flags:[],documents:[],projects:[],...o});
const flag=(o={})=>({flag_id:'f1',flag_code:'B',severity:'CRITICAL',detail:'The deadline is in 2 day(s) and the case is still open.',action_needed:'Mark the case as responded once the response is sent.',status:'Open',raised_on:'2026-11-09',...o});

test('wording helpers',()=>{
 assert.equal(deadlineText(5),'5 days left');assert.equal(deadlineText(1),'Due tomorrow');assert.equal(deadlineText(0),'Due today');assert.equal(deadlineText(-1),'Overdue by 1 day');assert.equal(deadlineText(-3),'Overdue by 3 days');assert.equal(deadlineText(null),'');
 assert.deepEqual([2,5,12].map(n=>deadlineTone(n,'Open')),['bad','warn','ok']);assert.equal(deadlineTone(-4,'Open'),'bad');assert.equal(deadlineTone(1,'Closed'),'muted');
 assert.equal(bannerText({cases_flagged:3}),'3 KRA Cases Flagged for Non-Compliance');assert.equal(bannerText({cases_flagged:1}),'1 KRA Case Flagged for Non-Compliance');assert.match(bannerText({cases_flagged:0}),/No KRA cases are flagged/);
 assert.equal(settingStatus({rule_status:'Suggested'}),'Default - not yet confirmed');assert.match(settingStatus({rule_status:'Confirmed',confirmed_at:'2026-11-09T10:00:00Z'}),/Confirmed on 2026-11-09/);
 assert.match(KRA_NOTE,/has not yet recorded the Tax Lead's confirmation/);assert.match(KRA_NOTE,/never creates the KRA project/);
 assert.deepEqual(Object.keys(FLAG_NAMES),['A','B','C','D']);assert.equal(SEVERITY_TONE.CRITICAL,'bad');
});

test('case: countdown, notice details, escaping, and the task',()=>{
 const h=caseView({r:mk(),me:me('MANAGER'),button});
 assert.match(h,/id="kraCountdown"[^]*11 days left[^]*Response due to KRA by 2026-11-20/);
 assert.match(h,/UAT &lt;Fictional&gt; Ltd/);assert.doesNotMatch(h,/<Fictional>/);
 assert.match(h,/id="kraNoTask"[^]*No verification task yet[^]*create it from the KRA template/);
 assert.match(h,/data-suite="kra-link"/,'a project can be linked');assert.doesNotMatch(h,/data-suite="kra-create/,'the system never creates the project');
 const t=caseView({r:mk({verification_task_id:'t1',task_urgent:true,task_basis:"Manager who owns the client's tax project"},{task:{task_name:'URGENT: Verify KRA notice KRA/AUD/1/2026 and tell the client',status:'Pending',due_at:'2026-11-12T14:00:00Z',assignee_name:'Mia Manager'}}),me:me('MANAGER'),button});
 assert.match(t,/id="kraTask"[^]*URGENT[^]*Mia Manager[^]*due 2026-11-12[^]*not yet confirmed by the Tax Lead/);assert.doesNotMatch(t,/kraNoTask/);
});
test('case: flags show what clears them; requests act by status',()=>{
 const r=mk({},{flags:[flag(),flag({flag_id:'f2',flag_code:'A',severity:'HIGH',status:'Resolved',resolved_at:'2026-11-09T09:00:00Z',resolved_by_name:'Mia Manager',resolved_how:'Action taken'})],
  requests:[{request_id:'q1',description:'Bank statements 2025',needed_by:'2026-11-20',status:'MISSING',revision:1},{request_id:'q2',description:'Payroll records',needed_by:'2026-11-20',status:'RECEIVED',file_name:'Payroll.pdf',revision:2},{request_id:'q3',description:'Old ledger',needed_by:'2026-11-20',status:'NOT_APPLICABLE',na_reason:'The client holds none.',revision:1}]});
 const m=caseView({r,me:me('MANAGER'),button});
 assert.match(m,/id="kraFlags"[^]*Flag B · CRITICAL[^]*To clear it:[^]*Mark the case as responded/);
 assert.match(m,/Cleared flags \(1\)[^]*Flag A · HIGH[^]*Cleared 2026-11-09 by Mia Manager/);assert.doesNotMatch(m,/data-suite="kra-flag-dismiss|Dismiss/,'a flag cannot be dismissed');
 assert.match(m,/data-suite="kra-attach" data-id="q1"/);assert.match(m,/data-suite="kra-na" data-id="q1"/);assert.match(m,/data-suite="kra-reopen" data-id="q2"/);assert.match(m,/data-suite="kra-reopen" data-id="q3"/);
 const a=caseView({r,me:me('ASSISTANT'),button});
 assert.match(a,/data-suite="kra-attach" data-id="q1"/);assert.doesNotMatch(a,/data-suite="kra-na"/,'only a Manager or Partner marks a document not applicable');
 assert.doesNotMatch(caseView({r:mk({},{flags:[]}),me:me('MANAGER'),button}),/Cleared flags/);assert.match(caseView({r:mk(),me:me('MANAGER'),button}),/No open non-compliance flags/);
});
test('case: actions by status and role',()=>{
 const open=caseView({r:mk(),me:me('ASSISTANT'),button});
 assert.match(open,/data-suite="kra-respond"/);assert.match(open,/data-suite="kra-edit"/);assert.doesNotMatch(open,/kra-cancel|kra-close|kra-return/);
 const resp=c=>caseView({r:mk({status:'Responded',responded_on:'2026-11-09',responded_by_name:'Ann Assistant',days_left:8}),me:me(c),button});
 assert.match(resp('PARTNER'),/data-suite="kra-close"[^]*Approve &amp; Close|data-suite="kra-close"/);assert.match(resp('PARTNER'),/data-suite="kra-return"/);
 assert.doesNotMatch(resp('MANAGER'),/data-suite="kra-close"/);assert.match(resp('MANAGER'),/Only a Partner can approve and close/);assert.match(resp('MANAGER'),/data-suite="kra-return"/);
 assert.doesNotMatch(resp('ASSISTANT'),/kra-return|kra-close/);
 const closed=caseView({r:mk({status:'Closed',closed_at:'2026-11-10T08:00:00Z',closed_by_name:'Pat Partner'}),me:me('PARTNER'),button});
 assert.doesNotMatch(closed,/data-suite="kra-(respond|edit|close|return|cancel|link|request-add)"/);assert.match(closed,/Approved and closed 2026-11-10 by Pat Partner/);
 assert.match(caseView({r:mk({status:'Cancelled',closed_at:'2026-11-10T08:00:00Z',closed_by_name:'Mia',close_note:'Wrong client.'}),me:me('MANAGER'),button}),/Cancelled 2026-11-10 by Mia: Wrong client\./);
});
test('list and the Partner list of flags',()=>{
 const r={cases:[{...base(),open_flags:'BC',missing_requests:2,total_requests:3,verification_task_id:'t1',task_assignee_name:'Mia Manager',task_status:'Pending',task_due_on:'2026-11-13',task_urgent:true},{...base({case_id:'c2',status:'Closed',days_left:-3}),open_flags:''}]};
 const h=listView({r,me:me('MANAGER'),button,status:null});
 assert.match(h,/id="kraCases"/);assert.match(h,/Flags[^]*<span class="badge bad">B<\/span> <span class="badge bad">C<\/span>/);assert.match(h,/2 documents missing/);assert.match(h,/URGENT/);assert.match(h,/data-suite="kra-case" data-id="c2"/);
 assert.match(h,/data-suite="kra-check"/);assert.match(h,/data-suite="kra-settings"/);assert.match(h,/data-suite="kra-new"/);
 const a=listView({r,me:me('ASSISTANT'),button,status:null});assert.doesNotMatch(a,/kra-check|kra-settings/);assert.match(a,/data-suite="kra-new"/);
 assert.match(listView({r:{cases:[]},me:me('MANAGER'),button}),/No KRA notices are logged/);
 const f=flagListView({r:{flags:[{flag_id:'f1',case_id:'c1',flag_code:'B',severity:'CRITICAL',detail:'The deadline is today and the case is still open.',action_needed:'Mark the case as responded.',client_name:'UAT Ltd',notice_reference:'KRA/1',days_left:0}]},severity:'CRITICAL',button});
 assert.match(f,/Critical only/);assert.match(f,/data-suite="kra-case" data-id="c1"[^>]*>Resolve</);assert.match(f,/Due today/);assert.match(f,/To clear it:/);
 assert.match(flagListView({r:{flags:[]},severity:null,button}),/No flags at this severity/);
});

test('banner: red button for the Partner, quiet text when nothing is flagged',async()=>{
 const box={innerHTML:'',querySelector:()=>({textContent:''})};
 const mkCtx=counts=>({$:s=>s==='#homeKraFlags'?box:null,field:()=>'',select:()=>'',form:()=>'',modal:()=>{},request:async()=>({counts,flags:[]}),notice:()=>{},button,area:()=>'',today:()=>'2026-11-09',data:()=>({me:me('PARTNER')})});
 await createKraUI(mkCtx({cases_flagged:3,critical_cases:2})).paintBanner();
 assert.match(box.innerHTML,/class="kra-banner bad"/);assert.match(box.innerHTML,/3 KRA Cases Flagged for Non-Compliance/);assert.match(box.innerHTML,/data-suite="kra-flags" data-id="CRITICAL"/);assert.match(box.innerHTML,/2 critical/);
 await createKraUI(mkCtx({cases_flagged:1,critical_cases:0})).paintBanner();assert.match(box.innerHTML,/data-id="ALL"/);
 await createKraUI(mkCtx({cases_flagged:0,critical_cases:0})).paintBanner();assert.doesNotMatch(box.innerHTML,/kra-banner/);assert.match(box.innerHTML,/No KRA cases are flagged/);
});
test('handler: only kra- actions, and a click on the banner asks for the critical list',async()=>{
 const sent=[];let shown='';
 const ui=createKraUI({$:()=>null,field:()=>'',select:()=>'',form:()=>'',modal:(t,h)=>{shown=t+' '+h;},request:async p=>{sent.push(p);return {counts:{cases_flagged:2},flags:[]};},notice:()=>{},button,area:()=>'',today:()=>'2026-11-09',data:()=>({me:me('PARTNER')})});
 assert.equal(await ui.handle('aup-open','x'),false);assert.equal(await ui.handle('finance-tab','x'),false);
 assert.equal(await ui.handle('kra-flags','CRITICAL'),true);assert.deepEqual(sent[0],{action:'kra_flags',severity:'CRITICAL'});assert.match(shown,/2 KRA Cases Flagged/);
 await ui.handle('kra-flags','ALL');assert.deepEqual(sent[1],{action:'kra_flags'});
});

test('server: every action is routed, mapped to an access area, and checks the same rules as the database',()=>{
 const ts=rd(fx+'kra-actions.ts'),idx=rd(fx+'index.ts');
 const actions=[...ts.matchAll(/p\.action==='(kra_[a-z_]+)'/g)].map(m=>m[1]);
 assert.equal(new Set(actions).size,19,'nineteen actions');
 for(const a of actions){assert.equal(areaForStaffAction(a),'projects',a+' has an access area');assert.match(ts,new RegExp("'"+a+"'"));}
 assert.match(idx,/import \{kraAction\} from '\.\/kra-actions\.ts'/);assert.match(idx,/const kra=await kraAction\(tx,a,p\);if\(kra!==undefined\)return kra;/);
 assert.ok(idx.indexOf('aupAction(tx,a,p)')<idx.indexOf('kraAction(tx,a,p)')&&idx.indexOf('kraAction(tx,a,p)')<idx.indexOf('auditAction(tx,a,p'),'registered after the procedures engine and before the audit file');
 assert.match(ts,/partnerOf\(a,'Only a Partner can approve and close a KRA case\.'\)/);
 assert.match(ts,/leaderOf\(a,'Only a Manager or Partner can mark a requested document not applicable\.'\)/);
 assert.match(ts,/partnerOf\(a,'Only a Partner can change a KRA check setting\.'\)/);
 assert.doesNotMatch(ts,/insert into erp_private\.projects|insert into erp_private\.tasks|delete from/i,'the server never creates the KRA project or a task, and never deletes');
 assert.doesNotMatch(ts,/kra_flag_dismiss|update erp_private\.kra_compliance_flags|insert into erp_private\.kra_compliance_flags/,'flags are written only by the database checks');
 const cfg=rd(fx+'tax-config-actions.ts');assert.match(cfg,/erp_private\.kra_counts\(\)/);assert.match(cfg,/\{aup,kra,incoming,\.\.\.rest\}/);
});
test('wiring: screen is imported, routed, reachable from Projects and from the Partner Home page',()=>{
 const su=rd('staff-suite.mjs'),pi=rd('staff-pilot.mjs'),dash=rd('staff-dashboard.mjs'),css=rd('staff-pilot.css');
 assert.match(su,/import \{createKraUI\} from '\.\/staff-kra\.mjs\?v=20261111-ticketkra-v1'/);
 assert.match(su,/const kra=createKraUI\(\{\.\.\.ctx,button,area,check\}\)/);assert.match(su,/if\(await kra\.handle\(action,id\)\)return;/);assert.match(su,/return \{[^}]*openReference,kra,incoming(,forensic)?(,deadlines)?\}/);
 assert.match(pi,/id="kraNoticesCard"[^]*suite\.button\('kra-open','Open the KRA notice log'\)/);
 assert.match(pi,/data\.me\.category_code==='PARTNER'\)\{void v6\.paintPartnerEscalations\(\);void suite\.kra\.paintBanner\(\);\}/);
 assert.match(dash,/role==='PARTNER'\?'<section class="home-kra" id="homeKraFlags"/);
 assert.match(css,/\.kra-banner\{[^}]*background:#b3261e/);
 const html=rd('staff-pilot.html'),rel=JSON.parse(rd(fx+'release.json'));
 assert.match(html,new RegExp('data-build="'+rel.build.replace(/\./g,'\\.')+'"'));assert.equal(rel.build,'2026-11-11.2778');
 for(const f of ['staff-pilot.mjs','staff-suite.mjs','staff-pilot-auth.js','staff-pilot.html','staff-improvements.mjs','staff-audit.mjs','staff-audit-home.mjs','staff-audit-reports.mjs'])assert.doesNotMatch(rd(f),/20261109-aup-v1/,f+' carries the new cache-buster');
});
test('migration: the rules that must not be loosened',()=>{
 const m=rd('supabase/migrations/20261109264000_kra_notices.sql');
 for(const frag of ['Only a Partner can approve and close a KRA case','The verification task is created by the system','A system update may only set the verification task','Only a Manager or Partner can mark a requested document not applicable','Only a Partner can change or confirm a KRA check setting','Only a Manager or Partner can cancel a case logged in error','A responded case cannot be edited'])assert.ok(m.includes(frag),frag);
 assert.doesNotMatch(m,/DELETE FROM erp_private\.kra_|INSERT INTO erp_private\.projects/i);
 assert.doesNotMatch(m,/ISRS 4000/);
 for(const t of ['kra_check_settings','kra_cases','kra_case_requests','kra_compliance_flags'])assert.match(m,new RegExp('ALTER TABLE erp_private\\.'+t+' ENABLE ROW LEVEL SECURITY;?\\s*ALTER TABLE erp_private\\.'+t+' FORCE ROW LEVEL SECURITY|ALTER TABLE erp_private\\.'+t+' FORCE ROW LEVEL SECURITY'),t);
 assert.match(m,/GRANT SELECT ON erp_private\.kra_compliance_flags TO erp_api/,'staff can only read flags');
 assert.match(m,/cron\.schedule\('pcl-kra-checks'/);
 const f=[...m.matchAll(/CREATE FUNCTION (erp_private\.kra_[a-z_]+)\(/g)].map(x=>x[1]);
 assert.ok(f.length>=20);for(const fn of f)assert.ok(new RegExp('SET search_path TO \'\'').test(m.slice(m.indexOf('CREATE FUNCTION '+fn+'('),m.indexOf('CREATE FUNCTION '+fn+'(')+3500)),fn+' pins the search path');
});
