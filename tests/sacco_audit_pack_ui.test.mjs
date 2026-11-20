// Audit build S6: the SACCO audit pack screen, the two report views, the server validators, the home model and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createPackUI,statutoryView,kamView,PACK_KINDS,NATURES as UI_NATURES,APPLIES as UI_APPLIES,RESULTS as UI_RESULTS,EFFECTS as UI_EFFECTS,METHODS as UI_METHODS} from '../staff-audit-pack.mjs';
import {packAction,NATURES,APPLIES,RESULTS,EFFECTS,METHODS,REPORT_KINDS} from '../supabase/functions/staff-workspace-v12/sacco-pack-actions.ts';
import {homeModel,sectionTabs} from '../staff-audit-home.mjs';
import {createReportsUI} from '../staff-audit-reports.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const P='11111111-1111-4111-8111-111111111111',I='22222222-2222-4222-8222-222222222222',M='33333333-3333-4333-8333-333333333333',F='44444444-4444-4444-8444-444444444444';
const step=(code,o={})=>({programme_id:P,step_code:code,audit_area:'Loans',assertion:'Existence',procedure:'Select a sample of loans and confirm the balance with members',required:true,sort_order:1,reference_code:null,...o});
const work=(o={})=>({sacco_type:'DT_SACCO',
 programmes:[{programme_id:P,code:'SACCO-STD',version:1,title:'Fictional <SACCO> audit programme',status:'Draft',source_note:'Written without a specimen',approved_by_name:null,steps:[step('L.LOANS'),step('C.CASH',{audit_area:'Cash',sort_order:2})]}],
 file_steps:[],workpapers:[{audit_workpaper_id:'w1',workpaper_ref:'WP-1',audit_area:'Loans'}],
 compliance_items:[{item_id:I,item_code:'SACCO-S7A',title:'Fictional <item> one',requirement:'As reported: a requirement',citation:'A section',nature:'Audit reporting matter',applies_to:['ALL_SACCO'],status:'Proposed',reference_code:'SACCO-ACT-2008',reference_verification:'Unverified'}],
 compliance:[],
 matters:[{matter_id:M,matter_ref:'TM-001',title:'Loan <book> quality',description:'The loan book was discussed with the board',communicated_on:'2025-12-01',method:'Meeting',communicated_to:'The board',response:'',status:'Active',decision:null,decision_stale:false}],
 policy:{key:'SACCO_DT_REQUIRES_STATUTORY_REPORT',value:'true',confirmed:false},statutory_required:true,statutory_blocking:['Not ready'],kam_blocking:[],issues:['The SACCO audit programme is not approved by a Partner.'],...o});
const snap=(o={})=>({file:{audit_file_id:F,project_id:'pr',file_status:'Prepared',ends_on:'2025-12-31'},pack:work(),...o});
const calls=[];
const ui=(me,s)=>createPackUI({esc,field:(n,l,v)=>`<input name="${n}" value="${esc(v)}">`,select:(n,l,o)=>`<select name="${n}">${(o||[]).map(x=>`<option>${Array.isArray(x)?x[0]:x}</option>`).join('')}</select>`,form:x=>x,modal:(...a)=>{calls.push({modal:a});},request:async a=>{calls.push({request:a});return {ok:true};},notice:(m,bad)=>calls.push({notice:m,bad}),shortDate:v=>String(v||'').slice(0,10),data:()=>({me}),snapshot:()=>s,refresh:async()=>{}});
const btn=attrs=>({dataset:Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),v])),hasAttribute:n=>n in attrs});
const partner={category_code:'PARTNER',staff_id:'s-p'},manager={category_code:'MANAGER',staff_id:'s-m'},assistant={category_code:'ASSISTANT',staff_id:'s-a'},intern={category_code:'INTERN',staff_id:'s-i'};

test('the screen and the server list the same choices, and the pack reports are Partner-only',()=>{
 assert.deepEqual(UI_NATURES,NATURES);assert.deepEqual(UI_RESULTS,RESULTS);assert.deepEqual(UI_METHODS,METHODS);assert.deepEqual(UI_APPLIES.map(x=>x[0]).sort(),[...APPLIES].sort());
 assert.deepEqual(UI_EFFECTS,EFFECTS.slice(1),'no "None" choice for a non-compliance');
 assert.deepEqual(PACK_KINDS,REPORT_KINDS);
});

test('the pack tab shows what blocks sign-off, the draft programme and the proposed items, and escapes names',()=>{
 const s=snap(),html=ui(partner,s).panel(s.file,s);
 assert.match(html,/What stops final sign-off from this pack/);assert.match(html,/The SACCO audit programme is not approved by a Partner/);
 assert.match(html,/Fictional &lt;item&gt; one/);assert.doesNotMatch(html,/<item>/);assert.match(html,/Loan &lt;book&gt; quality/);
 assert.match(html,/data-pack-programme-approve="/);assert.match(html,/data-pack-item-approve="/);assert.match(html,/data-pack-kam-decide="/);assert.match(html,/data-pack-policy/);
 assert.match(html,/default, not yet confirmed by a Partner/);assert.match(html,/None approved/);
});

test('buttons follow the role: only a Partner approves or decides; an assistant cannot edit the library',()=>{
 const s=snap();
 const m=ui(manager,s).panel(s.file,s);assert.doesNotMatch(m,/data-pack-programme-approve/);assert.doesNotMatch(m,/data-pack-item-approve/);assert.doesNotMatch(m,/data-pack-kam-decide/);assert.doesNotMatch(m,/data-pack-policy/);assert.match(m,/data-pack-step-new/);assert.match(m,/data-pack-item-new/);
 const a=ui(assistant,s).panel(s.file,s);assert.doesNotMatch(a,/data-pack-step-new/);assert.doesNotMatch(a,/data-pack-item-new/);assert.match(a,/data-pack-matter-new/);
 const closed=snap({file:{audit_file_id:F,project_id:'pr',file_status:'Approved',ends_on:'2025-12-31'}});
 assert.doesNotMatch(ui(partner,closed).panel(closed.file,closed),/data-pack-matter-new|data-pack-kam-decide/);
});

test('an adopted programme: perform for the team, review only by someone who did not perform',()=>{
 const fs1={...step('L.LOANS'),status:'Prepared',prepared_by:'s-a',prepared_by_name:'Alex',result_note:'Done and agreed to the ledger',applicable:true};
 const fs2={...step('C.CASH',{sort_order:2}),status:'Not started',applicable:true};
 const approved={programme_id:P,code:'SACCO-STD',version:1,title:'Fictional programme',status:'Approved',approved_by_name:'Pat',steps:[step('L.LOANS'),step('C.CASH')]};
 const s=snap({pack:work({programmes:[approved],file_steps:[fs1,fs2]})});
 const mgr=ui(manager,s).panel(s.file,s);assert.match(mgr,/data-pack-step-review="/);assert.match(mgr,/data-pack-step-prepare="/);assert.match(mgr,/0 of 2 steps reviewed/);
 const own=ui({category_code:'MANAGER',staff_id:'s-a'},s).panel(s.file,s);assert.doesNotMatch(own,/data-pack-step-review/,'the person who performed it cannot review it');
 const none=snap({pack:work({programmes:[approved],file_steps:[]})});
 assert.match(ui(assistant,none).panel(none.file,none),/data-pack-programme-adopt="/);
});

test('clicks send the right requests',async()=>{
 const s=snap(),u=ui(partner,s);calls.length=0;
 assert.equal(await u.handle(btn({'data-pack-programme-approve':P}),s.file),true);assert.equal(calls.at(-1).modal[0],'Partner · approve the audit programme');
 await calls.at(-1).modal[2](new Map([['note','Read all 26 steps']]));assert.deepEqual(calls.at(-1).request,{action:'audit_pack_programme_approve',programme_id:P,note:'Read all 26 steps'});
 await u.handle(btn({'data-pack-item-approve':I}),s.file);await calls.at(-1).modal[2](new Map([['note','Checked against the source']]));assert.deepEqual(calls.at(-1).request,{action:'audit_pack_item_approve',item_id:I,note:'Checked against the source'});
 await u.handle(btn({'data-pack-kam-decide':M}),s.file);
 await calls.at(-1).modal[2](new Map([['decision','KAM'],['significance_note','Most significant to the audit'],['heading','Loan book'],['how_addressed','Sample testing and confirmation'],['draft_text','x'.repeat(50)]]));
 const k=calls.at(-1).request;assert.equal(k.action,'audit_pack_kam_decide');assert.equal(k.matter_id,M);assert.equal(k.decision_data.decision,'KAM');assert.equal(k.decision_data.heading,'Loan book');
 await u.handle(btn({'data-pack-step-prepare':P+'|L.LOANS'}),s.file);
 const sp=snap({pack:work({file_steps:[{...step('L.LOANS'),status:'Not started',applicable:true}]})}),u2=ui(assistant,sp);await u2.handle(btn({'data-pack-step-prepare':P+'|L.LOANS'}),sp.file);
 await calls.at(-1).modal[2](new Map([['applicable','true'],['audit_workpaper_id',''],['note','Sampled and agreed']]));
 assert.deepEqual(calls.at(-1).request,{action:'audit_pack_step_prepare',audit_file_id:F,programme_id:P,step_code:'L.LOANS',applicable:true,audit_workpaper_id:null,note:'Sampled and agreed'});
 await u.handle(btn({'data-pack-matter-new':''}),s.file);
 await calls.at(-1).modal[2](new Map([['title','T'],['description','D'],['communicated_on','2025-12-01'],['method','Meeting'],['communicated_to','Board'],['response','']]));
 assert.equal(calls.at(-1).request.action,'audit_pack_matter_save');assert.equal(calls.at(-1).request.audit_file_id,F);assert.equal(calls.at(-1).request.matter.title,'T');
 await u.handle(btn({'data-pack-policy':''}),s.file);await calls.at(-1).modal[2](new Map([['value','false'],['note','Not needed for our clients']]));
 assert.deepEqual(calls.at(-1).request,{action:'audit_policy_save',key:'SACCO_DT_REQUIRES_STATUTORY_REPORT',value:'false',note:'Not needed for our clients'});
 assert.equal(await u.handle(btn({'data-other':''}),s.file),false);
});

test('a non-SACCO file has no pack',async()=>{
 const s=snap({pack:null}),u=ui(partner,s);assert.match(u.panel(s.file,s),/for SACCO audit files/);
 assert.equal(await u.handle(btn({'data-pack-policy':''}),s.file),false);
});

test('the two report views show the Partner wording, escape input and never invent a date',()=>{
 const html=statutoryView({entity:'Fictional <Mkopo>',sacco_type:'DT_SACCO',period_start:'2025-01-01',period_end:'2025-12-31',report_date:null,addressee:'The <Board>',partner_conclusion:'My own words <b>',eligibility:{financial_year:2025,confirmed:false},financial_statements:null,
  ratios:[],compliance:[{title:'Item <1>',citation:'s7A',result:'Not complied',effect:'Statutory report',note:'Found <x>'}],section10:[{caption:'Directors statement',status:'Reviewed',applicable:true,note:''}],
  calendar:{as_reported:'Within a period after year end',conflicting_wording:'',status:'Proposed',due:null},note:'Assembled'});
 assert.match(html,/Fictional &lt;Mkopo&gt;/);assert.match(html,/The &lt;Board&gt;/);assert.match(html,/My own words &lt;b&gt;/);assert.match(html,/not set/);assert.match(html,/a Partner has not confirmed the rule/);assert.match(html,/No SASRA ratio is confirmed/);
 assert.match(html,/Found &lt;x&gt;/);assert.doesNotMatch(html,/Found <x>/);
 const due=statutoryView({entity:'E',sacco_type:'NWDT_SACCO',period_start:'a',period_end:'b',addressee:'A',partner_conclusion:'C',eligibility:{},calendar:{as_reported:'x',status:'Confirmed',due:{date:'2026-06-30',direction:'Before'}}});
 assert.match(due,/Due 2026-06-30/);assert.equal(statutoryView(null),'');
 const k=kamView({entity:'E <x>',period_end:'2025-12-31',note:'n',items:[{matter_ref:'TM-001',matter_title:'T',communicated_on:'2025-12-01',communicated_to:'Board',method:'Meeting',heading:'Heading <h>',why_significant:'Why',how_addressed:'How',text:'Text'}],considered_not_kam:[{matter_ref:'TM-002',matter_title:'U',reason:'Routine'}]});
 assert.match(k,/Heading &lt;h&gt;/);assert.match(k,/Matters communicated but not key audit matters \(1\)/);assert.match(kamView({items:[],considered_not_kam:[]}),/No key audit matter/);
});

test('the Reports tab lists the pack reports only for a SACCO file and gives the statutory report its own draft form',async()=>{
 const rcalls=[];
 const mk=(me,s)=>createReportsUI({esc,field:(n,l,v)=>`<input name="${n}" value="${esc(v)}">`,select:()=>'',form:x=>x,modal:(...a)=>rcalls.push({modal:a}),request:async a=>{rcalls.push({request:a});return {ok:true};},notice:()=>{},shortDate:v=>String(v||''),data:()=>({me}),snapshot:()=>s,refresh:async()=>{}});
 const base={file:{audit_file_id:F,file_status:'Prepared'},reports:[],report_status:[],mgmt_points:[]};
 const general=mk(partner,base).panel(base.file,base);assert.doesNotMatch(general,/Statutory report to regulator/);
 const s={...base,pack:work()},html=mk(partner,s).panel(s.file,s);assert.match(html,/Statutory report to regulator/);assert.match(html,/Key audit matters/);
 const u=mk(partner,s);
 await u.handle(btn({'data-audit-report-draft':'Statutory report to regulator'}),s.file);assert.match(rcalls.at(-1).modal[0],/statutory report/);
 await rcalls.at(-1).modal[2](new Map([['addressee','SASRA'],['partner_conclusion','In our opinion']]));
 assert.deepEqual(rcalls.at(-1).request,{action:'audit_report_draft',audit_file_id:F,kind:'Statutory report to regulator',addressee:'SASRA',partner_conclusion:'In our opinion'});
 await u.handle(btn({'data-audit-report-draft':'Key audit matters'}),s.file);assert.deepEqual(rcalls.at(-1).request,{action:'audit_report_draft',audit_file_id:F,kind:'Key audit matters'});
 const sub={...s,reports:[{report_id:'r1',kind:'Key audit matters',version_number:1,status:'Submitted',prepared_by:'s-x',body:{items:[],considered_not_kam:[]}}],report_status:[{kind:'Key audit matters',required:true}]};
 assert.match(mk(manager,sub).panel(sub.file,sub),/Waiting for a Partner/);assert.match(mk(partner,sub).panel(sub.file,sub),/data-audit-report-review="r1"/);
});

test('server validators: Partner-only actions, codes, dates and unknown actions',async()=>{
 const tx=()=>{throw new Error('should not reach the database');};
 const run=(cat,p)=>packAction(tx,{category_code:cat},p);
 assert.equal(await run('PARTNER',{action:'audit_other'}),undefined);
 await assert.rejects(run('ASSISTANT',{action:'audit_pack_programme_approve',programme_id:P}),/Partner/);
 await assert.rejects(run('MANAGER',{action:'audit_pack_programme_approve',programme_id:P}),/Partner/);
 await assert.rejects(run('MANAGER',{action:'audit_pack_item_approve',item_id:I}),/Partner/);
 await assert.rejects(run('MANAGER',{action:'audit_pack_kam_decide',matter_id:M,decision_data:{decision:'KAM'}}),/Partner/);
 await assert.rejects(run('ASSISTANT',{action:'audit_pack_step_save',programme_id:P,step:{}}),/Manager or Partner/);
 await assert.rejects(run('ASSISTANT',{action:'audit_pack_step_review',audit_file_id:F,programme_id:P,step_code:'L.A',decision:'Accept'}),/Manager or Partner/);
 await assert.rejects(run('MANAGER',{action:'audit_pack_step_save',programme_id:P,step:{step_code:'bad code',audit_area:'a',assertion:'b',procedure:'x'.repeat(30),sort_order:1}}),/step code/);
 await assert.rejects(run('MANAGER',{action:'audit_pack_step_save',programme_id:P,step:{step_code:'L.OK',audit_area:'a',assertion:'b',procedure:'x'.repeat(30),sort_order:'one'}}),/whole number/);
 await assert.rejects(run('MANAGER',{action:'audit_pack_item_save',item:{item_code:'!!',title:'t',requirement:'r'.repeat(12),nature:'Other',applies_to:['ALL_SACCO']}}),/item code/);
 await assert.rejects(run('MANAGER',{action:'audit_pack_item_save',item:{item_code:'OK-1',title:'t',requirement:'r'.repeat(12),nature:'Made up',applies_to:['ALL_SACCO']}}));
 await assert.rejects(run('ASSISTANT',{action:'audit_pack_matter_save',audit_file_id:F,matter:{title:'t',description:'d',communicated_on:'01/12/2025',method:'Meeting',communicated_to:'b'}}),/date/);
 await assert.rejects(run('ASSISTANT',{action:'audit_pack_compliance_prepare',audit_file_id:F,item_id:I,result:'Not complied',effect:'None',note:'n'}));
 await assert.rejects(run('PARTNER',{action:'audit_pack_made_up'}),/Unknown/);
});

test('home model: tabs, section placement and the blocks the pack adds',()=>{
 const sasraTabs=sectionTabs('papers',true),plain=sectionTabs('papers',false);
 assert.ok(sasraTabs.includes('SACCO audit pack'));assert.ok(!plain.includes('SACCO audit pack'),'hidden for a file that is not a SACCO');
 const base={file:{audit_file_id:F,file_status:'Prepared'},readiness:{},workpapers:[],reports:[],report_status:[],sasra:{issues:['The SACCO audit programme is not approved by a Partner.','Matter TM-001 (x) has no key audit matter decision from a Partner.','Ratio table is not confirmed']}};
 const m=homeModel({...base,pack:work()},partner);const keys=m.blockers.map(b=>b.kind);
 assert.ok(keys.includes('programme')&&keys.includes('compliance')&&keys.includes('matters'),keys.join(','));
 const ratio=m.blockers.filter(b=>b.kind==='ratio');assert.equal(ratio.length,1,'pack issues are not reported as ratio problems');
 const focus=m.focus.rows.map(r=>r.text);assert.ok(focus.some(x=>/Approve the SACCO audit programme/.test(x)));assert.ok(focus.some(x=>/Approve proposed compliance items/.test(x)));assert.ok(focus.some(x=>/Decide whether TM-001/.test(x)));
 const none=homeModel(base,partner);assert.ok(!none.blockers.some(b=>['programme','compliance','matters'].includes(b.kind)));
 const ok=homeModel({...base,sasra:{issues:[]},pack:work({programmes:[{programme_id:P,status:'Approved',steps:[]}],compliance_items:[{item_id:I,status:'Approved'}],
   file_steps:[{...step('L.A'),status:'Reviewed'}],compliance:[{item_id:I,title:'t',status:'Reviewed'}],matters:[{matter_id:M,matter_ref:'TM-001',status:'Active',decision:'Not a KAM',decision_stale:false}]})},partner);
 assert.ok(!ok.blockers.some(b=>['programme','compliance','matters'].includes(b.kind)),'a finished pack blocks nothing');
});

test('wiring: migration, server, snapshot, tabs, report views and cache busters',()=>{
 const mig=rd('supabase/migrations/20261109255000_sacco_audit_pack.sql');
 assert.match(mig,/ALTER FUNCTION erp_private\.audit_report_build\(uuid,text,jsonb\) RENAME TO audit_report_build_standard/);assert.match(mig,/ALTER FUNCTION erp_private\.sasra_signoff_issues\(uuid\) RENAME TO sasra_signoff_issues_s4/);
 assert.match(mig,/CREATE TRIGGER pack_report_guard BEFORE UPDATE OF status ON erp_private\.audit_reports/);
 assert.doesNotMatch(mig,/\b(\d{1,2}(\.\d+)?)\s*%\s*(of|capital)/i,'no regulatory percentage is written into the migration');
 const act=rd(fx+'audit-actions.ts');
 assert.match(act,/packAction\(tx,a,p\)/);assert.match(act,/packWorkspace\(tx,file\.audit_file_id\)/);assert.match(act,/return \{sasra,sacco,pack,assembly,populations/);assert.match(act,/if\(!file\)return \{sacco:null,pack:null/);
 assert.match(rd(fx+'sasra-actions.ts'),/SACCO_DT_REQUIRES_STATUTORY_REPORT/);
 const aud=rd('staff-audit.mjs');
 assert.match(aud,/import \{createPackUI\} from '\.\/staff-audit-pack\.mjs\?v=/);assert.match(aud,/activeTab==='SACCO audit pack'\?auditPack\.panel\(file,s\)/);assert.match(aud,/await auditPack\.handle\(b,selectedFile\(\)\)/);
 const rep=rd('staff-audit-reports.mjs');assert.match(rep,/from '\.\/staff-audit-pack\.mjs\?v=/);
 const bust=new Set([...aud.matchAll(/staff-audit-(?:pack|sacco)\.mjs\?v=([\w-]+)/g)].map(x=>x[1]).concat([...rep.matchAll(/staff-audit-(?:pack|sacco)\.mjs\?v=([\w-]+)/g)].map(x=>x[1])));
 assert.equal(bust.size,1,'one cache buster everywhere: '+[...bust]);
});
