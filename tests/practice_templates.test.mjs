import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {declarationFields,practiceMode,templateGate,MAX_PRACTITIONERS} from '../supabase/functions/staff-workspace-v12/practice-rules.mjs';
import {practiceHtml,categoriesHtml,resultsHtml} from '../staff-service-categories.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const F='00000000-0000-4000-8000-000000000001',ME={staff_id:'m',category_code:'MANAGER'},PT={staff_id:'p',category_code:'PARTNER'};

test('declaring the number of practitioners: whole number, a reason, never invented',()=>{
 assert.match(declarationFields({firm_id:'x',practitioners:1,reason:'Sole practitioner here'}).problem,/Choose the firm/);
 for(const bad of ['','0','501','1.5','abc',-1])assert.ok(declarationFields({firm_id:F,practitioners:bad,reason:'Sole practitioner here'}).problem,String(bad));
 assert.match(declarationFields({firm_id:F,practitioners:1,reason:'short'}).problem,/10 to 500/);
 assert.deepEqual(declarationFields({firm_id:F,practitioners:'3',reason:'  Three  partners  in  the  firm '}).values,{firm_id:F,practitioners:3,reason:'Three partners in the firm'});
 assert.equal(MAX_PRACTITIONERS,500);
});

test('mode: a declaration of one counts only while one Partner is active; two or more is a team; nothing declared follows the real Partners',()=>{
 assert.equal(practiceMode(null,1).mode,'SOLE');assert.equal(practiceMode(null,1).declared,false);assert.equal(practiceMode(null,2).mode,'TEAM');
 assert.equal(practiceMode(1,1).mode,'SOLE');assert.equal(practiceMode(1,1).label,'Sole practitioner');
 assert.equal(practiceMode(1,2).mode,'TEAM','a declaration of one never overrides a second active Partner');
 assert.equal(practiceMode(2,1).mode,'TEAM');assert.match(practiceMode(5,3).label,/5 practitioners/);
});

test('who may put forward and approve a service category',()=>{
 const d={status:'Draft',proposed_by:null,submitted_by:null};
 assert.deepEqual(templateGate('submit',d,ME,false),{ok:true});
 assert.match(templateGate('submit',d,{staff_id:'a',category_code:'ASSISTANT'},false).problem,/Partner or a Manager/);
 assert.match(templateGate('submit',{...d,submitted_by:'x'},ME,false).problem,/already been put forward/);
 assert.match(templateGate('submit',{...d,proposed_by:'x'},ME,false).problem,/already waiting/);
 assert.match(templateGate('submit',{...d,status:'Approved'},ME,false).problem,/already approved/);
 assert.equal(templateGate('approve',d,PT,false).ok,true,'a starter nobody put forward can be approved');
 assert.match(templateGate('approve',{...d,submitted_by:'m'},ME,false).problem,/different Partner or Manager/,'the person who put it forward cannot approve it');
 assert.match(templateGate('approve',{...d,submitted_by:'p'},PT,false).problem,/only practitioner/);
 assert.deepEqual(templateGate('approve',{...d,submitted_by:'p'},PT,true),{ok:true,sole_approval:true},'the only practitioner may approve what they put forward, and it is recorded');
 assert.equal(templateGate('approve',{...d,proposed_by:'p'},PT,true).sole_approval,true);
 assert.equal(templateGate('approve',{...d,submitted_by:'m'},PT,true).sole_approval,false,'no sole flag when someone else put it forward');
});

test('the form: practice size and categories, escaped, with the reason beside what cannot be done',()=>{
 const firms={note:'N <b>',firms:[{firm_id:F,legal_name:'Firm <script>',active_partners:1,declared:{practitioners:1,reason:'Sole <i>',declared_at:'2026-11-16T10:00:00Z',declared_by_name:'P'},mode:'SOLE',mode_label:'Sole practitioner',history:[{practitioners:1,reason:'a',declared_at:'2026-11-16',declared_by_name:'P'},{practitioners:2,reason:'b',declared_at:'2026-11-01',declared_by_name:'P'}],can_declare:true},{firm_id:'2',legal_name:'Two',active_partners:2,declared:null,mode:'TEAM',mode_label:'2 active Partners (not declared)',history:[],can_declare:false}]};
 const p=practiceHtml(firms);assert.doesNotMatch(p,/<script>|N <b>|Sole <i>/);assert.match(p,/Firm &lt;script&gt;/);assert.match(p,/data-practice=/);assert.equal((p.match(/data-practice=/g)||[]).length,1,'only a Partner gets the form');assert.match(p,/History \(2\)/);assert.match(p,/A Partner declares/);
 const t=(o)=>({template_id:'t1',template_code:'ACC-MONTHLY',version:1,name:'Accounting <x>',service_group:'Accounting and Bookkeeping',source:'Starter',status:'Draft',tasks:5,services:'ACC-BOOK',waiting:false,can_submit:true,can_approve:true,...o});
 const c=categoriesHtml({sole:true,templates:[t({}),t({template_id:'t2',template_code:'TAX',name:'Tax',status:'Approved',approved_by_name:'P',approved_at:'2026-11-16',can_approve:false}),t({template_id:'t3',name:'Payroll',waiting:true,submitted_by_name:'Mgr',can_submit:false,submit_problem:'It has already been put forward.',can_approve:false,approve_problem:'You put this one forward.'})]});
 assert.doesNotMatch(c,/<x>/);assert.match(c,/only practitioner/);assert.equal((c.match(/data-sc-pick/g)||[]).length,3,'every category can be ticked (2844: approved ones for a new version or retiring)');assert.match(c,/Put forward by Mgr/);assert.match(c,/You put this one forward/);assert.match(c,/data-sc="check-approve"/);
 assert.match(categoriesHtml({sole:false,templates:[t({})]}),/You cannot approve what you put forward yourself/);assert.match(categoriesHtml({sole:false,templates:[]}),/no service categories/);
 const r=resultsHtml({dry:true,kind:'approve',summary:{total:2,done:1,skipped:1},results:[{label:'A',outcome:'Ready',sole_approval:true},{label:'B <q>',outcome:'Skipped',reason:'No <z>'}]});
 assert.match(r,/Nothing has changed yet/);assert.match(r,/id="scGood"/);assert.match(r,/id="scBad"/);assert.doesNotMatch(r,/<q>|<z>/);assert.match(r,/Sole-Partner approval, recorded/);
 assert.match(resultsHtml({dry:false,kind:'submit',summary:{total:1,done:1,skipped:0},results:[{label:'A',outcome:'Put forward'}]}),/put forward/);
});

test('wiring: actions routed and gated, database guards, button for leaders, build label',()=>{
 assert.match(rd(fx+'index.ts'),/const practiceTemplates=await practiceTemplateAction\(tx,a,p\);if\(practiceTemplates!==undefined\)return practiceTemplates;/);
 const ac=rd(fx+'staff-access-control.mjs');assert.match(ac,/practice_\|/);assert.match(ac,/service_template_\|service_category_\|/);
 const cat=rd(fx+'staff-rights-catalog.mjs');assert.match(cat,/actions:\['service_template_approve','service_category_approve'\]/);assert.equal(cat,rd('staff-rights-catalog.mjs'),'both copies of the rights catalogue are identical');
 const act=rd(fx+'practice-template-actions.ts');assert.match(act,/LEADERS=\['PARTNER','MANAGER'\]/);assert.match(act,/A Partner declares the number of practitioners/);assert.match(act,/service_template_approve/,'approval goes through the existing action');
 assert.doesNotMatch(act.replace(/\/\/[^\n]*/g,''),/update erp_private\.|delete from/i);
 const m=rd('supabase/migrations/20261118110000_practice_size_and_template_submissions.sql');
 assert.match(m,/GRANT SELECT,INSERT ON erp_private\.firm_practice_declarations TO erp_api/);assert.match(m,/GRANT SELECT,INSERT ON erp_private\.service_template_submissions TO erp_api/);assert.doesNotMatch(m,/GRANT[^;]*UPDATE/);
 assert.match(m,/FORCE ROW LEVEL SECURITY/);assert.match(m,/service_templates_submitter_guard/);assert.match(m,/practitioners>1/);assert.match(m,/cannot declare fewer practitioners/);
 const imp=rd('staff-improvements.mjs'),pilot=rd('staff-pilot.mjs');assert.match(imp,/staff-service-categories\.mjs\?v=20261116-dates-v1/);assert.match(imp,/if\(a==='categories'\)await categories\.open\(\)/);assert.match(pilot,/staff-improvements\.mjs\?v=20261122-loc-v1/);
 assert.ok(pilot.match(/isLeader\(\)\?'<div class="actions">'[^\n]*data-v3="categories"/),'the button is in the leaders\' row');
 assert.match(rd(fx+'release.json'),/2026-11-14\.2885/);assert.match(rd('staff-pilot.html'),/data-build="2026-11-14\.2885"/);
});
