// Tax Manager role and annual rules screen (build 2770).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {roleView,rulesView,permissionStatus,ruleStatus,ROLE_NOTE,RULES_NOTE} from '../staff-tax-roles.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const button=(a,l,id)=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const data=(o={})=>({permission:{allowed:false,revision:1,source_note:'Not enabled.'},assignments:[{assignment_id:'a1',staff_name:'Fictional <b>Manager</b>',company_name:'Fictional Co',project_name:'Tax',assigned_at:'2026-11-10T08:00:00Z'}],rules:[{rule_id:'r1',tax_kind:'Company',due_month_offset:6,external_deadline_day:null,internal_month_offset:5,internal_deadline_day:31,rule_status:'Suggested',source_note:'Partner answer',applies_from_period_end:null},{rule_id:'r2',tax_kind:'Individual',due_month_offset:4,external_deadline_day:30,internal_month_offset:3,internal_deadline_day:31,rule_status:'Confirmed',confirmed_at:'2026-11-11T00:00:00Z',source_note:'Memo',applies_from_period_end:'2026-12-31'}],i_can_approve_tax_rules:false,...o});
test('the permission starts off and only a Partner sees the buttons',()=>{
 assert.match(permissionStatus({allowed:false}),/Off/);assert.equal(permissionStatus({allowed:true}),'On');
 const p=roleView({data:data(),partner:true,button}),m=roleView({data:data(),partner:false,button});
 assert.match(p,/taxrole-permission/);assert.match(p,/Switch on/);assert.match(p,/taxrole-assign/);assert.match(p,/taxrole-end/);
 for(const x of ['taxrole-permission','taxrole-assign','taxrole-end'])assert.doesNotMatch(m,new RegExp(x));
 assert.match(m,/You cannot approve tax rules/);
 assert.match(roleView({data:data({i_can_approve_tax_rules:true}),partner:false,button}),/You can approve tax rules/);
 assert.match(roleView({data:data({permission:{allowed:true,revision:2}}),partner:true,button}),/Switch off/);
});
test('text is escaped and the empty state is plain',()=>{
 const h=roleView({data:data(),partner:true,button});assert.match(h,/Fictional &lt;b&gt;Manager&lt;\/b&gt;/);assert.doesNotMatch(h,/<b>Manager<\/b>/);
 assert.match(roleView({data:data({assignments:[]}),partner:true,button}),/No Tax Manager has been assigned yet/);
 assert.match(roleView({data:data({assignments:[{assignment_id:'a9',project_id:null,staff_name:'TEST <2>',company_name:null,project_name:null,assigned_at:'2026-11-10T20:00:00Z'}]}),partner:true,button}),/All clients and engagements<\/b><br><small>firm-wide[\s\S]*TEST &lt;2&gt;/);
 assert.match(ROLE_NOTE,/A Partner cannot approve a VAT or credit rule without being assigned as it/);
});
test('rules: status wording, Partner-only buttons, no claim of confirmation',()=>{
 const p=rulesView({data:data(),partner:true,button}),m=rulesView({data:data(),partner:false,button});
 assert.match(p,/Suggested - not yet confirmed/);assert.match(p,/Confirmed on 2026-11-11/);
 assert.match(p,/taxrole-rule-set" data-id="r1"/);assert.match(p,/taxrole-rule-confirm" data-id="r1"/);assert.doesNotMatch(p,/taxrole-rule-confirm" data-id="r2"/,'a confirmed rule has no confirm button');
 assert.doesNotMatch(m,/taxrole-rule/);assert.match(p,/periods ending on or after 2026-12-31/);assert.match(p,/6 months after the period end, on the last day of that month/);assert.match(p,/4 months after the period end, day 30/);
 assert.equal(ruleStatus({rule_status:'Suggested'}),'Suggested - not yet confirmed');assert.match(RULES_NOTE,/hand/);
});
test('wiring: server module, area, Settings card and cache busters',()=>{
 const su=read('staff-suite.mjs');
 assert.match(su,/import \{createTaxRolesUI\} from '\.\/staff-tax-roles\.mjs\?v=20261110-taxrole-v3'/);assert.match(su,/const taxRoles=createTaxRolesUI\(/);
 assert.match(su,/deadlines\.card\(\)\}\$\{taxRoles\.card\(\)\}/);assert.match(su,/if\(await taxRoles\.handle\(action,id\)\)return/);
 const idx=read('supabase/functions/staff-workspace-v12/index.ts');assert.match(idx,/const taxManager=await taxManagerAction\(tx,a,p\)/);
 assert.ok(idx.indexOf('taxManagerAction(tx,a,p)')<idx.indexOf('await taxAction(tx,a,p)'),'registered before the tax_ handler');
 for(const a of ['tax_manager_read','tax_manager_assign','tax_manager_end','tax_role_permission_set','annual_due_rule_set','annual_due_rule_confirm'])assert.equal(areaForStaffAction(a),'settings',a);
 assert.equal(areaForStaffAction('tax_create'),'projects');
 assert.equal(JSON.parse(read('supabase/functions/staff-workspace-v12/release.json')).build,'2026-11-11.2789');
 for(const f of ['staff-tax-roles.mjs','supabase/migrations/20261110280000_tax_manager_role_annual_rules.sql','supabase/functions/staff-workspace-v12/tax-manager-actions.ts'])assert.doesNotMatch(read(f),/ISRS 4000/);
});
