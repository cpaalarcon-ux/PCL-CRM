// Step 5 (joined-practice review): the service file section, the server actions, billing lock, release counts and wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {engineLine,checklistCounts,headline,billingBanner,serviceFileSection,referenceAddFields,REFERENCE_NOTE,STAGES} from '../staff-service-file.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const button=(a,l,id='')=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const item=(o)=>({item_key:'k'+Math.random(),stage:'Acceptance',label:'An item',check_kind:'Record',required:true,present:true,...o});

test('engine line wording',()=>{
 assert.match(engineLine({engine:'Audit file',engine_state:'Built',note:'Done.'}),/Runs on: Audit file \(built\)\. Done\./);
 assert.match(engineLine({engine:'Procedures engine',engine_state:'Planned',note:''}),/not built yet/);
 assert.match(engineLine({engine:'Ledger and statements',engine_state:'Partly built',note:''}),/partly built/);
 assert.match(engineLine(null),/No service profile/);
});
test('checklist counts and headline: optional items never count against the file',()=>{
 const items=[item({present:true}),item({present:false}),item({present:false,required:false})];
 assert.deepEqual(checklistCounts(items),{required:2,present:1,missing:1,optionalMissing:1});
 assert.equal(headline(items).tone,'warn');assert.match(headline(items).text,/1 of 2 required items are in place; 1 missing/);
 assert.equal(headline([item(),item({present:false,required:false})]).tone,'ok');
 assert.equal(headline([]).tone,'neutral');
});
test('billing banner appears only when locked',()=>{
 assert.match(billingBanner(true),/id="billingLocked"/);assert.match(billingBanner(true),/No invoice can be posted/);assert.equal(billingBanner(false),'');
});
test('section: stages, missing marks, escaping, references, Partner-only buttons',()=>{
 const data={service:{service_code:'TAX-KRA',service_name:'KRA <Audit>'},profile:{engine:'Procedures engine',engine_state:'Planned',note:'Not built.'},billing_locked:true,
  items:[item({stage:'Acceptance',label:'Client KYC verified',present:true}),item({stage:'Acceptance',item_key:'letter',label:'Signed letter',present:false}),item({stage:'Execution',label:'Working <papers>',check_kind:'Document',present:false}),item({stage:'Issue',label:'Optional thing',required:false,present:false})],
  references:[{reference_id:'r1',kind:'Law',reference:'Tax <Procedures> Act',rule_status:'Suggested',revision:1},{reference_id:'r2',kind:'Standard',reference:'ISRS 4400 (Revised)',rule_status:'Confirmed',revision:2}]};
 const html=serviceFileSection({data,partner:true,button});
 assert.match(html,/KRA &lt;Audit&gt;/);assert.doesNotMatch(html,/KRA <Audit>/);assert.match(html,/Working &lt;papers&gt;/);
 assert.match(html,/id="billingLocked"/);assert.match(html,/Missing: Signed letter/);assert.match(html,/✓ Client KYC verified/);assert.match(html,/Optional, not yet: Optional thing/);
 assert.match(html,/1 of 3 required items are in place; 2 missing/);
 assert.match(html,/Suggested, not yet confirmed/);assert.match(html,/Confirmed by the Compliance Lead, recorded by a Partner/);
 assert.match(html,/data-suite="reference-confirm" data-id="r1"/);assert.doesNotMatch(html,/data-suite="reference-confirm" data-id="r2"/,'a confirmed reference needs no second confirmation');
 assert.match(html,/data-suite="reference-retire" data-id="r2"/);assert.match(html,/data-suite="reference-add" data-id="TAX-KRA"/);
 assert.match(html,/Runs on: Procedures engine \(not built yet\)/);assert.ok(html.includes(REFERENCE_NOTE.replace(/&/g,'&amp;')));
 const manager=serviceFileSection({data:{...data,billing_locked:false},partner:false,button});
 assert.doesNotMatch(manager,/data-suite="reference-/);assert.doesNotMatch(manager,/id="billingLocked"/);
 assert.equal(serviceFileSection({data:null,partner:true,button}),'');
 assert.deepEqual(STAGES,['Acceptance','Execution','Issue']);
});
test('add-reference form',()=>{
 const f=(n)=>`<f ${n}>`,s=(n)=>`<s ${n}>`;const html=referenceAddFields({select:s,field:f});
 for(const n of ['kind','reference'])assert.match(html,new RegExp('<[fs] '+n+'>'));
});
test('server: checklist read, Partner-only reference actions, no tax rule',()=>{
 const s=rd(fx+'engagement-actions.ts');
 for(const act of ['engagement_checklist','reference_service_add','reference_service_confirm'])assert.match(s,new RegExp("p\\.action==='"+act+"'"));
 assert.match(s,/'licence_add','licence_end','engagement_checklist','reference_service_add','reference_service_confirm','engagement_read'/);
 assert.match(s,/erp_private\.project_allowed\(p\.project_id\)/,'the checklist is read only for projects the caller can see');
 assert.match(s,/billing_locked:!!letter&&!letter\.present/);
 const body=s.slice(s.indexOf("p.action==='reference_service_add'"),s.indexOf("p.action==='compliance_evidence_save'"));
 assert.equal((body.match(/a\.category_code!=='PARTNER'/g)||[]).length,2,'both reference actions are Partner-only');
 assert.match(body,/Record where the Compliance Lead confirmed this in writing/);assert.doesNotMatch(body,/delete from/);
});
test('actions fall in the right areas',()=>{
 assert.equal(areaForStaffAction('engagement_checklist'),'projects');
 assert.equal(areaForStaffAction('reference_service_add'),'settings');assert.equal(areaForStaffAction('reference_service_confirm'),'settings');
});
test('billing: an invoice cannot be posted without a verified, current letter',()=>{
 const s=rd(fx+'suite-actions.ts');
 assert.match(s,/Activate the verified engagement before posting its invoice\.'\);if\(!\(await tx`select erp_private\.project_letter_ok\(\$\{i\.project_id\}::uuid\) as ok`\)\[0\]\.ok\)fail\(400,'Billing is locked/);
});
test('release counts',()=>{
 const t=rd(fx+'tax-config-actions.ts');
 assert.match(t,/project_file_gaps\(\)\) projects_with_missing_required_items/);assert.match(t,/service_references where rule_status='Suggested'\) service_references_unconfirmed/);
});
test('screen wiring and build label',()=>{
 const s=rd('staff-suite.mjs');
 assert.match(s,/import \{serviceFileSection,referenceAddFields\} from '\.\/staff-service-file\.mjs\?v=\d{8}-[a-z0-9-]+'/);
 assert.match(s,/action:'engagement_checklist',project_id:pid/);assert.match(s,/serviceFileSection\(\{data:sf,partner:partner\(\),button\}\)/);
 for(const a of ['reference-add','reference-confirm','reference-retire'])assert.match(s,new RegExp("action==='"+a+"'"));
 assert.match(s,/'reference_service_add',\{service_code:id\}/);assert.match(s,/'reference_service_confirm',\{reference_id:id,rule_status:'Confirmed'/);
 const rel=JSON.parse(rd(fx+'release.json')).build;assert.match(rel,/^2026-11-\d\d\.\d{4}$/);assert.match(rd('staff-pilot.html'),new RegExp('data-build="'+rel.replace(/\./g,'\\.')+'"'));
});
test('migration: nothing confirmed, no delete, no ISRS 4000, new services outside the audit prefix',()=>{
 const m=rd('supabase/migrations/20261109262000_service_profiles.sql');
 assert.match(m,/CREATE TRIGGER no_delete BEFORE DELETE ON erp_private\.service_references/);assert.match(m,/FORCE ROW LEVEL SECURITY/);
 assert.doesNotMatch(m,/ISRS 4000/);assert.doesNotMatch(m,/rule_status[^;]*'Confirmed'[^;]*VALUES/i);
 assert.match(m,/\('ADV-AUP','Advisory & Consulting'/);assert.match(m,/\('TAX-KRA','Tax Services'/);
 assert.doesNotMatch(m,/DELETE FROM|UPDATE erp_private\.(projects|engagement_controls|documents)/i);
 assert.doesNotMatch(m,/EUR|\b750\b|5,?000,?000/,'no tax threshold is stored');
});
