import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {SECTIONS,SECTION_CODES,sourceProblem,submitPlan,decidePlan,sectionState,milestones,mandatoryBlockers,nextSetupStep,SETUP_ORDER} from '../supabase/functions/staff-workspace-v12/setup-review-rules.mjs';
import {panelHtml,queueHtml,collectSubmit,collectDecisions,statusBadge} from '../staff-setup-review.mjs';
import * as order from '../staff-setup-order.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),shortDate=v=>String(v||'').slice(0,10);

test('nine deferred sections, and the two mandatory controls are not among them',()=>{
 assert.equal(SECTIONS.length,9);assert.ok(!SECTION_CODES.includes('chart'));assert.ok(!SECTION_CODES.includes('opening_tb'));
});
test('the source must be named',()=>{
 assert.match(sourceProblem('',''),/where this information came from/);assert.match(sourceProblem('Other approved source','x'),/Name the other approved source/);
 assert.equal(sourceProblem('BRS',''),'');assert.equal(sourceProblem('KRA',''),'');
});
test('change-based review: unchanged data is not reviewed again',()=>{
 assert.deepEqual(submitPlan(null,'a'),{action:'submit'});
 assert.deepEqual(submitPlan({status:'Approved',approved_digest:'a',content_digest:'a'},'a'),{action:'none'});
 assert.deepEqual(submitPlan({status:'Correction Required',approved_digest:'a',content_digest:'b'},'a'),{action:'approve_unchanged'});
 assert.deepEqual(submitPlan({status:'Approved',approved_digest:'a',content_digest:'a'},'b'),{action:'submit'});
});
test('a decision needs a pending section, a comment on return, and the data that was submitted',()=>{
 const row={status:'Pending Review',content_digest:'a'};
 assert.equal(decidePlan(null,'Approved','', 'a').ok,false);assert.equal(decidePlan({status:'Draft'},'Approved','','a').ok,false);
 assert.match(decidePlan(row,'Returned','short','a').problem,/at least 10/);assert.equal(decidePlan(row,'Returned','Correct the PIN please','a').ok,true);
 assert.match(decidePlan(row,'Approved','','b').problem,/changed after it was submitted/);assert.equal(decidePlan(row,'Approved','','a').ok,true);
 assert.equal(decidePlan(row,'Maybe','','a').ok,false);
});
test('a section approved and then edited shows as changed',()=>{
 assert.equal(sectionState({status:'Approved',approved_digest:'a'},'b').changed,true);assert.equal(sectionState({status:'Approved',approved_digest:'a'},'a').changed,false);
 assert.equal(sectionState({status:'Pending Review',content_digest:'a'},'b').changed,true);assert.equal(sectionState(null,'a').status,'Draft');
});
test('two milestones are separate, and fully approved needs everything including the two controls',()=>{
 const all=st=>SECTION_CODES.map(c=>({code:c,status:st,changed:false}));
 let m=milestones(all('Pending Review'),{status:'Draft'},{status:'Blocked'});
 assert.equal(m.data_entry_completed,true);assert.equal(m.fully_approved,false);assert.match(m.summary,/Chart of Accounts and Opening Trial Balance still need/);
 m=milestones(all('Approved'),{status:'Approved'},{status:'Pending Review'});assert.equal(m.fully_approved,false);
 m=milestones(all('Approved'),{status:'Approved'},{status:'Approved'});assert.equal(m.fully_approved,true);
 m=milestones([...all('Approved').slice(1),{code:'identity',status:'Correction Required',changed:false}],{status:'Approved'},{status:'Approved'});assert.equal(m.data_entry_completed,false);
 m=milestones([{code:'identity',status:'Approved',changed:true},...all('Approved').slice(1)],{status:'Approved'},{status:'Approved'});assert.equal(m.fully_approved,false,'edited after approval is not approved');
 assert.equal(mandatoryBlockers({status:'Approved'},{status:'Approved'}).length,0);assert.equal(mandatoryBlockers({status:'Draft'},{status:'Approved'}).length,1);
});
test('after saving a sub-step the next one opens, in one order the browser and server share',()=>{
 assert.deepEqual(SETUP_ORDER,order.SETUP_ORDER);assert.equal(nextSetupStep('identity'),'activity');assert.equal(nextSetupStep('chart'),'vat-cats');assert.equal(nextSetupStep('vat-cats'),null);assert.equal(order.nextSetupStep('identity'),'activity');
});
test('the panel and queue show status, source and what is mandatory',()=>{
 const r={client:{company_name:'Fictional Ltd'},sections:SECTIONS.map((s,i)=>({code:s.code,label:s.label,hint:s.hint,status:i===0||i===2?'Approved':i===1?'Correction Required':'Draft',changed:i===0,review_note:i===1?'Fix the registration number.':null,source_kind:null,source_note:null,submitted_by_name:null,unchanged_approval:false})),chart:{status:'Approved',label:'Chart of Accounts'},opening:{status:'Blocked',label:'Opening Trial Balance'},milestones:{data_entry_completed:false,fully_approved:false,summary:'Setup data entry in progress.'},history:[]};
 const html=panelHtml(r,{esc,shortDate});
 assert.match(html,/Changed since review/);assert.match(html,/Correction requested:<\/b> Fix the registration number/);assert.match(html,/Mandatory approvals/);assert.match(html,/Needs the approved chart first/);assert.match(html,/Setup data entry completed/);assert.match(html,/never stops you moving on/);
 assert.equal((html.match(/name="pick_/g)||[]).length,8,'the approved, unchanged section cannot be submitted again but the changed one can');
 assert.match(statusBadge('Pending Review',esc),/info/);
 const q=queueHtml({total:2,clients:[{client_id:'c1',company_name:'Fictional Ltd',sections:[{code:'identity',label:'Client identification and legal structure',source_kind:'BRS',submitted_by_name:'Staff A',submitted_at:'2026-11-15',mine:false,edited_since_submission:true},{code:'tax',label:'KRA PIN and tax obligations',source_kind:'KRA',submitted_by_name:'Me',submitted_at:'2026-11-15',mine:true,edited_since_submission:false}]}]},{esc,shortDate});
 assert.match(q,/Approve ticked sections/);assert.match(q,/edited after it was submitted/);assert.match(q,/disabled/);assert.match(queueHtml({total:0,clients:[]},{esc,shortDate}),/No set-up sections are waiting/);
});
test('ticked sections become requests; decisions are grouped by client',()=>{
 const els=[{checked:true,name:'pick_identity'},{checked:false,name:'pick_tax'}],form={querySelectorAll:()=>els,elements:{namedItem:n=>n==='source_note'?{value:'BRS search 12 Nov'}:n==='source_identity'?{value:'BRS'}:null}};
 assert.deepEqual(collectSubmit(form),[{section_code:'identity',source_kind:'BRS',source_note:'BRS search 12 Nov'}]);
 const host={querySelectorAll:()=>[{checked:true,dataset:{pick:'c1|identity'}},{checked:true,dataset:{pick:'c1|tax'}},{checked:true,dataset:{pick:'c2|identity'}},{checked:false,dataset:{pick:'c2|tax'}}],querySelector:sel=>sel.includes('c1|tax')?{value:'Fix the PIN'}:{value:''}};
 const g=collectDecisions(host,'Returned');assert.equal(g.length,2);assert.equal(g[0].decisions.length,2);assert.equal(g[0].decisions[1].note,'Fix the PIN');
});
test('the screens are wired in, and the setup hub and sub-steps move on without returning to the main page',()=>{
 const ui=rd('staff-improvements.mjs');
 assert.match(ui,/client_setup_review_read/);assert.match(ui,/client_setup_section_submit/);assert.match(ui,/client_setup_review_queue/);assert.match(ui,/client_setup_section_decide/);
 assert.match(ui,/button\('setup-review','Setup review',id\)/);assert.match(ui,/leader\(\)\?button\('setup-queue'/);
 assert.match(ui,/'v3_identity_save'[^\n]*afterStep\(c\.client_id,'identity'\)/);assert.match(ui,/v3_vat_categories_save[^\n]*afterStep\(c\.client_id,'vat-cats'\)/);assert.match(ui,/v3_client_chart_propose[^\n]*afterStep\(id,'chart'\)/);
 assert.match(ui,/Back to setup checklist/);assert.match(ui,/Skip to the next step/);
 assert.match(rd('staff-pilot.mjs'),/staff-improvements\.mjs\?v=20261116-versions-v1/);
 const eng=rd('supabase/functions/staff-workspace-v12/engagement-actions.ts');assert.ok(!/Complete that client setup review before activating the engagement/.test(eng),'a pending activity change no longer blocks activation');assert.match(eng,/pendingSetupChange\?\[/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/client_setup_/);
});
