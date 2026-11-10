// Step 6 (joined-practice review): the procedures screen, the server module, wiring and the rules it must not break.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {aupView,reportView,progressLine,scopeState,canReview,AUP_SERVICES,AUP_NOTE,STATUS_TONE} from '../staff-aup.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const button=(a,l,id='',x='')=>`<button data-suite="${a}" data-id="${id}" ${x}>${l}</button>`;
const PID='11111111-1111-4111-8111-111111111111';
const project={project_id:PID,project_name:'UAT <KRA> audit',service_code:'TAX-KRA',service_name:'KRA Audit and Dispute Support',status:'Active'};
const lib=[{library_id:'L1',code:'KRA-01',title:'Agree VAT returns to the ledger',rule_status:'Suggested',revision:1},{library_id:'L2',code:'KRA-11',title:'Confirmed one',rule_status:'Confirmed',revision:2}];
const mk=(o={})=>({project,scope:null,items:[],changes:[],library:lib,documents:[],letter_ok:true,progress:null,...o});
const item=(o={})=>({item_id:'i'+Math.random(),seq:1,title:'Agree <debtors> to the ledger',description:'Compare the debtors to the ledger.',source:'Custom',evidence_required:true,exec_status:'Not started',finding:null,performed_by:null,reviewed_by:null,evidence:[],revision:1,...o});
const me=(c,id='me')=>({category_code:c,staff_id:id});
const draft=(o={})=>({state:'Draft',revision:1,...o}),locked=(o={})=>({state:'Locked',revision:3,locked_at:'2026-11-09T10:00:00Z',locked_by_name:'Pat Partner',letter_file:'Letter.pdf',letter_reference:'Schedule 1',scope_sha256:'a'.repeat(64),...o});

test('states, progress and tones',()=>{
 assert.deepEqual([null,draft(),locked(),{state:'Issued'}].map(scopeState),['No scope','Draft','Locked','Report issued']);
 assert.equal(progressLine(null),'No procedures yet.');
 assert.match(progressLine({total:4,completed:2,exceptions:1,not_applicable:0,open_items:1,unreviewed:2,missing_evidence:1}),/3 of 4 performed · 1 reviewed · 1 with exceptions · 1 missing evidence\./);
 assert.deepEqual(AUP_SERVICES,['ADV-AUP','TAX-KRA']);
 assert.equal(STATUS_TONE.Exception,'warn');
 assert.match(AUP_NOTE,/nothing here is confirmed/);
});
test('no scope: only a Manager or Partner can start; the system never creates the project',()=>{
 const m=aupView({r:mk(),me:me('MANAGER'),button});
 assert.match(m,/data-suite="aup-start"/);assert.match(m,/data-suite="aup-start-empty"/);assert.match(m,/never creates the project for you/);
 const a=aupView({r:mk(),me:me('ASSISTANT'),button});
 assert.doesNotMatch(a,/data-suite="aup-start/);assert.match(a,/has not started the scope/);
});
test('draft: leaders edit freely, only a Partner locks, the missing letter is explained',()=>{
 const r=mk({scope:draft(),items:[item({item_id:'i1',seq:1}),item({item_id:'i2',seq:2,source:'Library'})],progress:{total:2}});
 const m=aupView({r,me:me('MANAGER'),button});
 assert.match(m,/Agree &lt;debtors&gt;/);assert.doesNotMatch(m,/Agree <debtors>/);assert.match(m,/UAT|KRA Audit and Dispute Support/);
 assert.match(m,/data-suite="aup-item-edit" data-id="i1"/);assert.match(m,/data-suite="aup-item-remove" data-id="i2"/);
 assert.match(m,/data-suite="aup-item-library"/);assert.match(m,/data-suite="aup-item-custom"/);assert.match(m,/data-suite="aup-template"/);
 assert.doesNotMatch(m,/data-suite="aup-lock"/);assert.match(m,/Only a Partner can lock/);
 const p=aupView({r,me:me('PARTNER'),button});assert.match(p,/data-suite="aup-lock"[^>]*>Lock against the signed letter/);assert.doesNotMatch(p,/aup-lock"[^>]*disabled/);
 const noLetter=aupView({r:{...r,letter_ok:false},me:me('PARTNER'),button});
 assert.match(noLetter,/id="aupLetterMissing"/);assert.match(noLetter,/data-suite="aup-lock"[^>]*disabled/);
 const s=aupView({r,me:me('SUPERVISOR'),button});assert.doesNotMatch(s,/aup-item-edit|aup-item-remove|aup-item-library|aup-lock/);
});
test('locked: execution board, evidence, review rules, scope changes',()=>{
 const done=item({item_id:'d1',seq:1,exec_status:'Completed',finding:'Agreed',performed_by:'perf',performed_by_name:'Ann Assistant',performed_at:'2026-11-09T11:00:00Z',evidence:[{evidence_id:'e1',file_name:'Debtors.pdf',revision:1}]});
 const open=item({item_id:'o1',seq:2,exec_status:'In progress',evidence:[{evidence_id:'e2',file_name:'Draft.pdf',revision:1}]});
 const reviewed=item({item_id:'r1',seq:3,exec_status:'Exception',finding:'Differs',performed_by:'perf',reviewed_by:'rev',reviewed_by_name:'Sam Supervisor',reviewed_at:'2026-11-09T12:00:00Z'});
 const changes=[{change_id:'c1',kind:'Add',proposed_title:'Extra <work>',status:'Requested',requested_by:'mgr',requested_by_name:'Mia Manager',requested_at:'2026-11-09T09:00:00Z',reason:'Client asked'},{change_id:'c2',kind:'Remove',item_title:'Old one',status:'Approved',requested_by:'mgr',requested_at:'2026-11-09T09:00:00Z',reason:'Withdrawn',decided_by_name:'Pat',decision_note:'Agreed in writing'}];
 const r=mk({scope:locked(),items:[done,open,reviewed],changes,progress:{total:3,completed:1,exceptions:1,not_applicable:0,open_items:1,unreviewed:1,missing_evidence:0}});
 const sup=aupView({r,me:me('SUPERVISOR','sup'),button});
 assert.match(sup,/id="aupLock"/);assert.match(sup,/Schedule 1/);assert.match(sup,/aaaaaaaaaaaa…/);
 assert.match(sup,/data-suite="aup-perform" data-id="o1"/);assert.match(sup,/data-suite="aup-evidence" data-id="o1"/);
 assert.match(sup,/data-suite="aup-review" data-id="d1"/,'a Supervisor who did not perform it can review');
 assert.doesNotMatch(sup,/data-suite="aup-review" data-id="r1"/,'already reviewed');assert.doesNotMatch(sup,/data-suite="aup-review" data-id="o1"/,'not finished');
 assert.match(sup,/data-suite="aup-evidence-remove" data-id="e2"/);assert.doesNotMatch(sup,/data-suite="aup-evidence-remove" data-id="e1"/,'evidence on a finished result is removed only after reopening');
 assert.match(sup,/Extra &lt;work&gt;/);assert.doesNotMatch(sup,/data-suite="aup-change-decide"/,'only a Partner decides');
 assert.doesNotMatch(sup,/aup-change-add|aup-change-remove|aup-issue/);
 const asPerformer=aupView({r,me:me('SUPERVISOR','perf'),button});assert.doesNotMatch(asPerformer,/data-suite="aup-review" data-id="d1"/,'the performer cannot review their own result');
 const asst=aupView({r,me:me('ASSISTANT'),button});assert.doesNotMatch(asst,/data-suite="aup-review"/);assert.match(asst,/aup-perform/);
 const mgr=aupView({r,me:me('MANAGER','mgr'),button});assert.match(mgr,/data-suite="aup-change-add"/);assert.match(mgr,/data-suite="aup-change-remove" data-id="o1"/);assert.doesNotMatch(mgr,/data-suite="aup-change-decide"/,'not the requester');
 const par=aupView({r,me:me('PARTNER','pt'),button});assert.match(par,/data-suite="aup-change-decide" data-id="c1"/);assert.doesNotMatch(par,/data-suite="aup-change-decide" data-id="c2"/,'already decided');
 assert.match(par,/data-suite="aup-issue"/);assert.match(par,/data-suite="aup-report"/);
 const own=aupView({r,me:me('PARTNER','mgr'),button});assert.doesNotMatch(own,/data-suite="aup-change-decide"/,'a Partner cannot decide their own request');
 assert.equal(canReview(me('MANAGER','x'),done),true);assert.equal(canReview(me('MANAGER','perf'),done),false);assert.equal(canReview(me('ASSISTANT','x'),done),false);
});
test('issued: nothing to act on but the report',()=>{
 const r=mk({scope:locked({state:'Issued',report_issued_at:'2026-11-09T15:00:00Z',issued_by_name:'Pat',report_sha256:'b'.repeat(64)}),items:[item({exec_status:'Completed',finding:'Agreed',reviewed_by:'x'})]});
 const html=aupView({r,me:me('PARTNER'),button});
 assert.match(html,/id="aupIssued"/);assert.match(html,/bbbbbbbbbbbb…/);assert.doesNotMatch(html,/aup-issue|aup-perform|aup-evidence"/);assert.match(html,/data-suite="aup-report"/);
});
test('library: Suggested until a Partner records the confirmation',()=>{
 const m=aupView({r:mk(),me:me('MANAGER'),button}),p=aupView({r:mk(),me:me('PARTNER'),button});
 assert.match(m,/Suggested, not yet confirmed/);assert.match(m,/Confirmed by the Compliance Lead, recorded by a Partner/);
 assert.match(m,/data-suite="aup-lib-add"/);assert.doesNotMatch(m,/aup-lib-confirm|aup-lib-retire/);
 assert.match(p,/data-suite="aup-lib-confirm" data-id="L1"/);assert.doesNotMatch(p,/data-suite="aup-lib-confirm" data-id="L2"/);assert.match(p,/data-suite="aup-lib-retire" data-id="L2"/);
});
test('report view: pending placeholder, escaping, no unverified standard',()=>{
 const rep={client:'Client <A>',client_pin:'A1',service:'KRA',firm:'Firm',letter_file:'Letter.pdf',letter_reference:'Schedule 1',standard:{text:'[STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]'},
  procedures:[{title:'Proc <1>',status:'Completed',finding:'Agreed',performed_by:'Ann',performed_on:'2026-11-09',reviewed_by:'Sam',evidence:['A.pdf']}],scope_changes:[{kind:'Add',title:'Extra',reason:'Client asked'}],statement:'No assurance is expressed.'};
 const html=reportView(rep,{state:'Locked'});
 assert.match(html,/PENDING COMPLIANCE REVIEW/);assert.match(html,/Client &lt;A&gt;/);assert.match(html,/Proc &lt;1&gt;/);assert.match(html,/No assurance is expressed/);assert.match(html,/Preview\./);
 assert.match(reportView(rep,{state:'Issued',sha:'c'.repeat(64)}),/Issued report\. Hash cccccccccccc…/);
 assert.match(reportView(null),/No report is available/);
 for(const f of ['staff-aup.mjs',fx+'aup-actions.ts','supabase/migrations/20261109263000_aup_engine.sql'])assert.doesNotMatch(rd(f).replace(/ISRS 4000 is not used anywhere\./g,''),/ISRS 4000/,f+' cites no unverified standard');
});
test('server module: every action is routed, mapped to an area, and enforced',()=>{
 const s=rd(fx+'aup-actions.ts'),idx=rd(fx+'index.ts');
 const actions=[...s.matchAll(/'(aup_[a-z_]+)'/g)].map(m=>m[1]).filter((v,i,a)=>a.indexOf(v)===i);
 assert.ok(actions.length>=17,'all seventeen actions are listed');
 for(const a of actions){assert.equal(areaForStaffAction(a),'projects',a+' is a projects-area action');}
 assert.match(idx,/import \{aupAction\} from '\.\/aup-actions\.ts'/);assert.match(idx,/const aup=await aupAction\(tx,a,p\);if\(aup!==undefined\)return aup;/);
 assert.match(s,/erp_private\.project_allowed\(p\.project_id\)/,'every action starts from a project the caller may see');
 assert.match(s,/partnerOf\(a,'Only a Partner can lock the scope against the signed engagement letter\.'\)/);
 assert.match(s,/A scope change must be decided by a Partner other than the person who requested it/);
 assert.match(s,/if\(it\.project_id!==pid\)fail\(403/,'a record must belong to the project named in the request');
 assert.match(s,/Upload and verify the signed engagement letter before the scope is locked against it/);
 assert.match(s,/The person who performed a procedure cannot review it/);
 assert.match(s,/s\.state==='Issued'\?s\.report_snapshot/,'an issued report is read from its stored snapshot');
 const cfg=rd(fx+'tax-config-actions.ts');assert.match(cfg,/erp_private\.aup_counts\(\)/);
});
test('wiring: screen is imported, routed and reachable from the engagement page',()=>{
 const su=rd('staff-suite.mjs');
 assert.match(su,/import \{createAupUI,AUP_SERVICES\} from '\.\/staff-aup\.mjs\?v=20261110-taxrole-v3'/);
 assert.match(su,/const aup=createAupUI\(\{\.\.\.ctx,button,area,check\}\)/);
 assert.match(su,/if\(await aup\.handle\(action,id\)\)return;/);
 assert.match(su,/AUP_SERVICES\.includes\(p\.service_code\)\?button\('aup-open','Procedures, scope & report',pid\)/);
 const html=rd('staff-pilot.html'),rel=JSON.parse(rd(fx+'release.json'));
 assert.match(html,new RegExp('data-build="'+rel.build.replace(/\./g,'\\.')+'"'));assert.equal(rel.build,'2026-11-11.2775');
 for(const f of ['staff-pilot.mjs','staff-suite.mjs','staff-pilot-auth.js','staff-pilot.html'])assert.doesNotMatch(rd(f),/20261109-services-v1/,f+' carries the new cache-buster');
});
test('migration: the rules that must not be loosened',()=>{
 const m=rd('supabase/migrations/20261109263000_aup_engine.sql');
 for(const frag of ['Only a Partner can lock the scope','After the scope is locked, a procedure can be added only through a scope change that a Partner has approved','A scope change must be decided by a Partner other than the person who requested it','Attach the evidence for this procedure before recording the result','The person who performed a procedure cannot review it','[STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]'])assert.ok(m.includes(frag),frag);
 assert.doesNotMatch(m,/DELETE FROM erp_private\.aup_/i);
 for(const tname of ['aup_procedure_library','aup_scopes','aup_scope_items','aup_item_evidence','aup_scope_changes'])assert.match(m,new RegExp('ALTER TABLE erp_private\\.'+tname+' FORCE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY'));
 assert.match(m,/CREATE TRIGGER no_delete BEFORE DELETE ON erp_private\.aup_scope_items/);
});
