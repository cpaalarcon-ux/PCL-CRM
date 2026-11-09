import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {homeModel,createHomeUI,sectionOf,sectionTabs,signoffStrip,paperStrip,SECTIONS} from '../staff-audit-home.mjs';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ready={framework_approved:true,current_tb_confirmed:true,current_tb_balanced:true,all_lines_mapped:true,workpapers_resolved:true,workpapers_present:true,completion_total:3,completion_reviewed:3};
const gateOk={materiality_approved:true,risks_open:2,fraud_risk_recorded:true,uncovered:[]};
const base=(o={})=>({file:{audit_file_id:'f1',file_status:'In Review',reporting_framework:'IFRS for SMEs',ends_on:'2026-12-31'},readiness:ready,planning_gate:gateOk,workpapers:[{audit_workpaper_id:'w1',workpaper_ref:'WP-1',status:'Approved',prepared_by:'a1'}],adjustments:[],lead_schedule:[],analytics_alerts:[],analytics_runs:[{run_id:'r'}],mgmt_points:[],reports:[],report_status:[],completion:[{status:'Reviewed'},{status:'Reviewed'},{status:'Reviewed'}],misstatements:{items:[],exceeds_overall:false,conclusion:null},time_summary:null,my_tasks:[],...o});
const partner={category_code:'PARTNER',staff_id:'p1'};

test('a clean file has no blockers, every section green, and the next step is the file stage', () => {
  const m=homeModel(base(),partner);
  assert.equal(m.blockers.length,0);
  assert.equal(m.next.kind,'stage');
  assert.match(m.next.action,/approve the file/i);
  assert.deepEqual(m.sections.map(s=>s.key),SECTIONS.map(s=>s.key));
  for(const k of ['setup','papers','completion'])assert.equal(m.sections.find(s=>s.key===k).tone,'ok',k);
  assert.equal(m.sections.find(s=>s.key==='archive').tone,'idle');
});

test('no file means no model', () => assert.equal(homeModel({file:null},partner),null));

test('the first blocker becomes the single next step, in working order', () => {
  const m=homeModel(base({readiness:{...ready,framework_approved:false},planning_gate:{...gateOk,materiality_approved:false}}),partner);
  assert.equal(m.next.kind,'framework');
  assert.equal(m.next.owner,'Partner');
  assert.equal(m.blockers[0].kind,'framework');
  assert.equal(m.blockers[1].kind,'materiality');
});

test('open analytics alerts, pending entries, missing and non-tying leads each block with a plain message', () => {
  const m=homeModel(base({
    analytics_alerts:[{status:'Open',severity:'High'},{status:'Open',severity:'Low'},{status:'Cleared',severity:'High'}],
    adjustments:[{status:'Draft'},{status:'Submitted'},{status:'Approved'}],
    lead_schedule:[{audit_area:'Cash',active:true,lead:null},{audit_area:'Revenue',active:true,lead:{tie:'Difference'}}]
  }),partner);
  const kinds=m.blockers.map(b=>b.kind);
  assert.deepEqual(kinds,['adjustments','leads','tie','analytics']);
  assert.match(m.blockers.find(b=>b.kind==='leads').detail,/Cash/);
  assert.match(m.blockers.find(b=>b.kind==='tie').detail,/Revenue/);
  assert.match(m.blockers.find(b=>b.kind==='analytics').detail,/2 open, 1 high/);
  assert.equal(m.sections.find(s=>s.key==='papers').tone,'bad');
  assert.equal(m.toolbar.find(t=>t.key==='issues').count,4);
  assert.equal(m.toolbar.find(t=>t.key==='adj').count,2);
});

test('stale and missing required reports block; an unrequired report does not', () => {
  const m=homeModel(base({report_status:[
    {kind:'Completion memorandum',required:true,approved_report_id:'x',current:false},
    {kind:'Audit summary',required:true,approved_report_id:null,current:false},
    {kind:'Management letter',required:false,approved_report_id:null,current:false}]}),partner);
  const r=m.blockers.filter(b=>b.kind==='report');
  assert.equal(r.length,2);
  assert.ok(r.some(b=>/Re-approve the completion memorandum/.test(b.action)));
  assert.ok(r.some(b=>/Approve the audit summary/.test(b.action)));
  assert.equal(m.toolbar.find(t=>t.key==='reports').count,2);
});

test('unadjusted misstatements over materiality need a current Partner conclusion', () => {
  const over=homeModel(base({misstatements:{exceeds_overall:true,conclusion:null}}),partner);
  assert.ok(over.blockers.some(b=>b.kind==='misstatement'));
  const stale=homeModel(base({misstatements:{exceeds_overall:true,conclusion:{current:false}}}),partner);
  assert.ok(stale.blockers.some(b=>b.kind==='misstatement'));
  const ok=homeModel(base({misstatements:{exceeds_overall:true,conclusion:{current:true}}}),partner);
  assert.ok(!ok.blockers.some(b=>b.kind==='misstatement'));
});

const sacco=(o={})=>({sacco_type:'DT_SACCO',financial_year:2026,eligible:true,eqcr:{required:true,approved:false},ratios:[{label:'Core capital to total assets',state:'Breach',value:'6.5%',acknowledged:false}],assembly:{days:60,anchor:'REPORT_DATE',anchor_date:null,deadline:null},
  issues:['Regulatory breach not acknowledged by a Partner: Core capital to total assets is 6.5%.','EQCR Partner approval required before final sign-off.'],...o});
test('SACCO gates feed the header, the blocker list and the next step', () => {
  const m=homeModel(base({sasra:sacco()}),partner);
  assert.equal(m.next.kind,'ratio');
  assert.match(m.next.action,/Acknowledge the regulatory breach/);
  assert.match(m.next.detail,/6\.5%/);
  assert.equal(m.blockers.at(-1).kind,'eqcr');
  const g=Object.fromEntries(m.header.gates.map(x=>[x.key,x]));
  assert.equal(g.sasra.state,'ok');
  assert.equal(g.eqcr.state,'pending');
  assert.match(g.lock.text,/set the report date/);
  assert.equal(m.header.sacco_type,'DT_SACCO');
});
test('SACCO lock gate shows the deadline once the report date is known', () => {
  const m=homeModel(base({sasra:sacco({assembly:{days:60,anchor:'REPORT_DATE',anchor_date:'2027-03-01',deadline:'2027-04-30'},issues:[]})}),partner);
  const lock=m.header.gates.find(x=>x.key==='lock');
  assert.equal(lock.state,'ok');
  assert.match(lock.text,/report date \+ 60 days = 2027-04-30/);
});
test('a non-SACCO file has no SASRA, EQCR or lock gates', () => {
  const m=homeModel(base(),partner);
  assert.deepEqual(m.header.gates.map(g=>g.key),['framework','materiality']);
});
test('an eligibility issue sits in Set-up, ahead of the trial balance', () => {
  const m=homeModel(base({readiness:{...ready,current_tb_confirmed:false},sasra:sacco({eligible:false,issues:['SASRA auditor eligibility for financial year 2026 is not confirmed by a Partner.']})}),partner);
  assert.equal(m.blockers[0].kind,'sasra');
  assert.equal(m.blockers[0].section,'setup');
  assert.equal(m.blockers[1].kind,'tb');
});

test('role view: an Assistant sees their own papers first', () => {
  const s=base({workpapers:[{workpaper_ref:'WP-1',status:'Returned',review_note:'Add the bank letter',prepared_by:'a1'},{workpaper_ref:'WP-2',status:'Draft',prepared_by:'a2'}],my_tasks:[{task_name:'Count stock'}]});
  const m=homeModel(s,{category_code:'ASSISTANT',staff_id:'a1'});
  assert.equal(m.focus.title,'My papers');
  assert.equal(m.focus.rows.length,2);
  assert.match(m.focus.rows[0].text,/WP-1 · returned: Add the bank letter/);
  assert.ok(!m.focus.rows.some(r=>/WP-2/.test(r.text)));
});
test('role view: a Manager sees a review queue and never their own work', () => {
  const s=base({workpapers:[{workpaper_ref:'WP-1',status:'Submitted',prepared_by:'a1'},{workpaper_ref:'WP-9',status:'Submitted',prepared_by:'m1'}],adjustments:[{adj_seq:1,status:'Submitted',prepared_by:'a1'}],mgmt_points:[{point_ref:'MP-1',status:'Open'}]});
  const m=homeModel(s,{category_code:'MANAGER',staff_id:'m1'});
  assert.equal(m.focus.title,'Review queue');
  const t=m.focus.rows.map(r=>r.text).join('|');
  assert.match(t,/Review WP-1/);assert.doesNotMatch(t,/WP-9/);
  assert.match(t,/audit entry 1/);assert.match(t,/MP-1/);
});
test('role view: a Partner sees gates and sign-offs', () => {
  const s=base({readiness:{...ready,framework_approved:false},planning_gate:{...gateOk,materiality_approved:false},sasra:sacco(),misstatements:{exceeds_overall:true,conclusion:null},reports:[{kind:'Audit summary',status:'Submitted',version_number:2}]});
  const m=homeModel(s,partner);
  assert.equal(m.focus.title,'Waiting for you');
  const t=m.focus.rows.map(r=>r.text).join('|');
  for(const re of [/Confirm the reporting framework/,/Approve materiality/,/Acknowledge the breach: Core capital/,/unadjusted misstatements/,/audit summary \(version 2\)/,/Approve or return the audit file/])assert.match(t,re);
});

test('sections map tabs, and the SASRA tab shows only on a SACCO file', () => {
  assert.equal(sectionOf('Trial balance'),'papers');
  assert.equal(sectionOf('Issues'),'managing');
  assert.equal(sectionOf('Overview'),'home');
  assert.deepEqual(sectionTabs('setup',false),['Materiality & risk']);
  assert.deepEqual(sectionTabs('setup',true),['Materiality & risk','SASRA & quality']);
  const all=SECTIONS.flatMap(s=>s.tabs);
  for(const t of ['Materiality & risk','Trial balance','Adjustments','Lead schedules','Analytics','Reports','Time & billing','Working papers','Completion','Template register','SASRA & quality'])assert.ok(all.includes(t),t);
});

test('sign-off strips: file level and per paper', () => {
  assert.deepEqual(signoffStrip({file_status:'Draft'},{}).map(c=>c.done),[false,false,false,null]);
  assert.deepEqual(signoffStrip({file_status:'Approved'},{sasra:{eqcr:{required:true,approved:true}}}).map(c=>c.done),[true,true,true,true]);
  assert.equal(signoffStrip({file_status:'Approved'},{sasra:{eqcr:{required:true,approved:false}}})[3].done,false);
  assert.deepEqual(paperStrip({status:'Submitted'}).map(c=>c.done),[true,false]);
  assert.deepEqual(paperStrip({status:'Approved'}).map(c=>c.done),[true,true]);
  assert.deepEqual(paperStrip({status:'Draft'}).map(c=>c.done),[false,false]);
});

test('the rendered home names the next step, links every item to a tab and escapes text', () => {
  const ui=createHomeUI({esc});
  const m=homeModel(base({readiness:{...ready,framework_approved:false},workpapers:[{workpaper_ref:'<b>WP</b>',status:'Draft',prepared_by:'a1'}]}),{category_code:'ASSISTANT',staff_id:'a1'});
  const head=ui.head(m.header&&{file_status:'In Review',reporting_framework:'IFRS',ends_on:'2026-12-31'},{company_name:'Acme & Sons'},m);
  assert.match(head,/Next step:<\/b> Confirm the reporting framework/);
  assert.match(head,/Acme &amp; Sons/);
  assert.match(head,/data-audit-tab="Issues"/);
  const home=ui.homePanel(m);
  assert.doesNotMatch(home,/<b>WP<\/b>/);
  assert.match(home,/&lt;b&gt;WP&lt;\/b&gt;/);
  assert.equal((home.match(/class="audit-section /g)||[]).length,5);
  const bar=ui.sectionBar(m,'Adjustments');
  assert.match(bar,/aria-selected="true" class="active" data-audit-tab="Trial balance"/);
  assert.match(bar,/audit-subtabs/);
  assert.match(ui.issuesPanel(m),/Issues blocking sign-off/);
  assert.match(ui.issuesPanel(m),/not tracked here yet/);
});

test('Reports data is no longer overwritten by empty placeholders in the file snapshot', () => {
  const src=readFileSync(new URL('../supabase/functions/staff-workspace-v12/audit-actions.ts',import.meta.url),'utf8');
  const lines=src.split('\n').filter(l=>l.includes('return {sasra,projects,project,file'));
  assert.equal(lines.length,1);
  assert.doesNotMatch(lines[0],/reports:\[\]|report_status:\[\]|mgmt_points:\[\]/);
  assert.match(lines[0],/reports,report_status,mgmt_points/);
});

test('the full audit screen renders every tab for a SACCO file without error', async () => {
  const {createAuditUI}=await import('../staff-audit.mjs');
  const snap={...base({sasra:sacco()}),projects:[{project_id:'p',company_name:'Acme',project_name:'AUD',firm_code:'F1'}],project:{project_id:'p',company_name:'Acme',project_name:'AUD 2026',firm_code:'F1',client_id:'c',handling_firm_id:'h'},imports:[],tb_lines:[],templates:[],file:{audit_file_id:'f1',file_status:'In Review',reporting_framework:'IFRS for SMEs',starts_on:'2026-01-01',ends_on:'2026-12-31',framework_status:'Approved',file_type:'First-year',revision:1},workpaper_versions:[],materiality:[],risks:[],risk_links:[],adjustment_lines:[],adjusted_tb:[],tb_accounts:[],analytics_runs:[],billing_link:null};
  const field=(n,l)=>`<input name="${n}" aria-label="${l}">`;
  const ctx={esc,field,select:(n)=>`<select name="${n}"></select>`,form:(b)=>`<form>${b}</form>`,modal(){},request:async()=>snap,notice(){},shortDate:v=>String(v||'').slice(0,10),empty:t=>`<p>${t}</p>`,data:()=>({me:partner,documents:[]})};
  const ui=createAuditUI(ctx);
  await ui.refresh('p');
  for(const tab of ['Overview','Issues','Materiality & risk','Trial balance','Adjustments','Lead schedules','Analytics','Reports','Time & billing','Working papers','Completion','Template register','SASRA & quality']){
    assert.ok(await ui.handle({hasAttribute:()=>false,dataset:{auditTab:tab}}),tab);
    const html=ui.render();
    assert.match(html,/Next step:/,tab);
    assert.match(html,/audit-subtabs|audit-tabs/,tab);
    assert.doesNotMatch(html,/undefined|\[object Object\]/,tab);
  }
  ui.handle({hasAttribute:()=>false,dataset:{auditTab:'Overview'}});
  const home=ui.render();
  assert.match(home,/File controls/);
  assert.doesNotMatch(home,/Readiness checks/);
  assert.match(home,/audit-strip/);
});
