import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ACCESS_ROLES,APPROVAL_RULES,renderAccessGuide} from '../staff-access-guide.mjs';
import {areaForStaffAction,defaultStaffAreas,effectiveStaffAreas,filterWorkspaceAccess,scopeWorkspaceRecords,staffAreaCanUse} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';

const ui=fs.readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8');
const mapping=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/improvement-actions.ts',import.meta.url),'utf8');
const accounting=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/accounting-actions.ts',import.meta.url),'utf8');
const ledger=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/ledger-actions.ts',import.meta.url),'utf8');
const periods=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/period-import-actions.ts',import.meta.url),'utf8');
const audit=fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/audit-actions.ts',import.meta.url),'utf8');

test('home and staff access pages show the reconciled, role-based guide',()=>{
 assert.match(ui,/renderAccessGuide\(data\.me\.category_code,esc\)/);
 assert.deepEqual(ACCESS_ROLES.map(x=>x.code),['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']);
 assert.match(renderAccessGuide('ASSISTANT',x=>x),/Your access · Audit Assistant/);
 assert.match(renderAccessGuide('INTERN',x=>x),/Assigned task-level support work only/);
 assert.match(renderAccessGuide('MANAGER',x=>x),/can restrict ERP areas for an individual from Staff &amp; access/);
});

test('approval guide distinguishes different server approval boundaries',()=>{
 assert.ok(APPROVAL_RULES.some(([n,r])=>n==='Client account mappings'&&r==='Manager or Partner'));
 assert.ok(APPROVAL_RULES.some(([n,r])=>n==='Chart account activation'&&r==='Partner'));
 assert.ok(APPROVAL_RULES.some(([n,r])=>n==='Opening TB and client-ledger journals'&&r==='Manager or Partner'));
 assert.ok(APPROVAL_RULES.some(([n,r])=>n==='Designated period imports and reconciliations'&&r==='Supervisor, Manager or Partner'));
 assert.ok(APPROVAL_RULES.some(([n,r])=>n==='Audit framework and final audit file'&&r==='Partner'));
});

test('described approval boundaries remain present in server handlers',()=>{
 assert.match(mapping,/if\(p\.action==='v3_client_account_mapping_approve_batch'\)\{\s*leader\(a\)/);
 assert.match(accounting,/if\(p\.action==='accounting_account_approve'\)\{if\(a\.category_code!=='PARTNER'\)/);
 assert.match(ledger,/else\{leader\(a\);if\(j\.status!=='Submitted'\|\|\[j\.prepared_by,j\.last_prepared_by\]\.includes\(a\.staff_id\)\)/);
 assert.match(periods,/const reviewer=\(a:any\)=>\['PARTNER','MANAGER','SUPERVISOR'\]/);
 assert.match(audit,/if\(a\.category_code!=='PARTNER'\)fail\(403,'Only the Engagement Partner can approve the audit file\.'/);
});

test('individual access restrictions only narrow the current role baseline',()=>{
 for(const {code} of ACCESS_ROLES){
  const baseline=defaultStaffAreas(code),restricted=['projects','documents'];
  const effective=effectiveStaffAreas(code,restricted);
  assert.ok(effective.every(area=>baseline.includes(area)),`${code} must not gain an area through person-level access`);
  assert.equal(staffAreaCanUse(code,restricted,'projects'),false,`${code} must be denied a restricted area`);
  assert.equal(staffAreaCanUse(code,[], 'unknown'),false,'unknown areas are denied');
 }
 assert.equal(areaForStaffAction('v3_client_account_mapping_approve_batch'),'clients');
 assert.equal(areaForStaffAction('project_save'),'projects');
});

test('workspace filtering limits client and tax detail to the permitted area and linked work',()=>{
 const workspace={me:{staff_id:'a1'},clients:[
  {client_id:'c1',company_name:'Assigned Client',kra_pin:'P000000001A'},
  {client_id:'c2',company_name:'Other Client',kra_pin:'P000000002A'}
 ],projects:[{project_id:'p1',client_id:'c1'}],tasks:[{task_id:'t1',project_id:'p1',assigned_to:'a1'}],
  assignments:[],schedules:[],work_periods:[],work_period_tasks:[],task_procedures:[],sales_reviews:[],task_events:[],workbook_batches:[],documents:[],timesheets:[],notifications:[],
  suite:{tax_profiles:[{client_id:'c1',turnover:100}],compliance:[{client_id:'c1',risk_rating:'High'}]}};
 const scoped=scopeWorkspaceRecords(filterWorkspaceAccess(workspace,['clients','projects']), 'ASSISTANT','a1');
 assert.equal(scoped.clients.find(c=>c.client_id==='c1').details_visible,true);
 const other=scoped.clients.find(c=>c.client_id==='c2');
 assert.equal(other.details_visible,false);
 assert.equal(Object.hasOwn(other,'kra_pin'),false);
 assert.deepEqual(scoped.suite.tax_profiles.map(x=>x.client_id),['c1']);
 const noClientAccess=filterWorkspaceAccess(workspace,['projects']);
 assert.deepEqual(noClientAccess.suite.tax_profiles,[]);
 assert.deepEqual(noClientAccess.suite.compliance,[]);
});
