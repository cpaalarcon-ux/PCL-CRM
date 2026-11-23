import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {areaForStaffAction,defaultStaffAreas,filterWorkspaceAccess,scopeWorkspaceRecords,staffAreaCanUse,STAFF_ACCESS_AREAS} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {ACTION_RIGHTS,canUseAction,rightsForRequest} from '../staff-action-rights.mjs';
import {actionsForCategory} from '../staff-access-guide.mjs';

// Step 3 of the access alignment: every one of the ten sections, for every category, checked against the real gates
// (area gate, rights catalogue, personal restrictions, workspace scoping). Record scope in the database is in category_record_scope.test.mjs.
const CATEGORIES=['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN','ADMIN'];
const AREAS=STAFF_ACCESS_AREAS.map(a=>a.code);
const dir=new URL('../supabase/functions/staff-workspace-v12/',import.meta.url);
const outsideSession=new Set(['release_info','login','refresh_session','setup','setup_status','request_partner_recovery','session_activity','workspace','logout']);
const actions=(()=>{
 const found=new Set();
 for(const name of fs.readdirSync(dir).filter(x=>/\.(?:ts|mjs)$/.test(x))){
  const source=fs.readFileSync(new URL(name,dir),'utf8');
  for(const m of source.matchAll(/(?:p|payload|body)\.action\s*===?\s*['"]([A-Za-z0-9_-]+)['"]/g))found.add(m[1]);
  for(const m of source.matchAll(/\[\s*((?:['"][A-Za-z0-9_-]+['"]\s*,?\s*)+)\]\.includes\((?:p|payload|body)\.action\)/g))
   for(const item of m[1].matchAll(/['"]([A-Za-z0-9_-]+)['"]/g))found.add(item[1]);
 }
 return [...found].filter(a=>!outsideSession.has(a)).sort();
})();
const reach=role=>actions.filter(a=>staffAreaCanUse(role,[],areaForStaffAction(a)));

test('there are ten sections and every server action belongs to exactly one of them',()=>{
 assert.equal(AREAS.length,10);
 assert.deepEqual([...AREAS].sort(),['audit','billing_wip','clients','communications','documents','leads','projects','settings','staff_access','time_hr']);
 assert.ok(actions.length>500,'the action list was read from the server files');
 const unclassified=actions.filter(a=>!areaForStaffAction(a));
 assert.deepEqual(unclassified,[]);
 for(const area of AREAS)assert.ok(actions.some(a=>areaForStaffAction(a)===area),`${area} has server actions`);
});

test('out of scope: the sections each category cannot reach block every action in them',()=>{
 const expected={
  PARTNER:AREAS,MANAGER:AREAS,
  SUPERVISOR:['clients','projects','time_hr','documents','communications','audit','leads'],
  ASSISTANT:['clients','projects','time_hr','documents','communications','audit','leads'],
  INTERN:['projects','time_hr','documents','communications'],
  ADMIN:['communications','staff_access','settings'],
 };
 for(const role of CATEGORIES){
  assert.deepEqual([...defaultStaffAreas(role)].sort(),[...expected[role]].sort(),`${role} sections`);
  const reachable=new Set(reach(role).map(areaForStaffAction));
  assert.deepEqual([...reachable].sort(),[...expected[role]].sort(),`${role} reaches actions only in its sections`);
  for(const area of AREAS.filter(x=>!expected[role].includes(x)))
   for(const a of actions.filter(x=>areaForStaffAction(x)===area))assert.equal(staffAreaCanUse(role,[],area),false,`${role} must not reach ${a}`);
 }
 // The sections a category lacks include the ones that hold money, access and firm settings.
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN']){
  for(const a of ['invoice_approve','payment_record','credit_note_issue','staff_save','firm_save'].filter(x=>actions.includes(x)))
   assert.equal(staffAreaCanUse(role,[],areaForStaffAction(a)),false,`${role}: ${a}`);
 }
 // A System Administrator never reaches client, project, document, ledger, audit, lead or billing work.
 for(const a of reach('ADMIN'))assert.ok(['communications','staff_access','settings'].includes(areaForStaffAction(a)),a);
 for(const area of ['clients','projects','documents','audit','leads','billing_wip','time_hr'])assert.equal(staffAreaCanUse('ADMIN',[],area),false,area);
});

test('allowed: a personal restriction removes a whole section from a category that otherwise holds it',()=>{
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN','ADMIN'])
  for(const area of defaultStaffAreas(role)){
   assert.equal(staffAreaCanUse(role,[],area),true,`${role} holds ${area}`);
   assert.equal(staffAreaCanUse(role,[area],area),false,`${role} restricted from ${area}`);
   for(const other of defaultStaffAreas(role).filter(x=>x!==area))assert.equal(staffAreaCanUse(role,[area],other),true,`${role}: restricting ${area} leaves ${other}`);
  }
});

const REVIEWER_ONLY=['Check / return','Approve','Void','Reset to draft','Reverse','Refund / transfer','Apply advance','Record eTIMS reference','Generate invoice drafts','Grant / revoke'];
const heldOps=(role,area)=>actionsForCategory(role,area)||[];

test('restricted actions: Assistants and Interns hold no check, approve, void, reverse, refund or grant right in any section',()=>{
 for(const role of ['ASSISTANT','INTERN'])
  for(const area of AREAS)for(const op of REVIEWER_ONLY)assert.equal(heldOps(role,area).includes(op),false,`${role} must not hold ${op} in ${area}`);
 // What they do hold is preparing work: view, record, edit and submit.
 for(const area of ['projects','time_hr','documents','communications'])for(const role of ['ASSISTANT','INTERN'])
  for(const op of ['View','Create / record','Edit','Submit'])assert.equal(heldOps(role,area).includes(op),true,`${role}: ${op} in ${area}`);
 // Posting is for chat messages only; no Assistant or Intern holds it for work records.
 for(const role of ['ASSISTANT','INTERN'])for(const area of AREAS.filter(a=>a!=='communications'))assert.equal(heldOps(role,area).includes('Post / activate'),false,`${role} post in ${area}`);
 assert.equal(heldOps('INTERN','communications').includes('Post / activate'),false);
});

test('restricted actions: a Supervisor checks and returns but never approves, voids, resets, refunds or grants',()=>{
 for(const area of AREAS)for(const op of ['Approve','Void','Reset to draft','Reverse','Refund / transfer','Apply advance','Record eTIMS reference','Generate invoice drafts','Grant / revoke','Issue setup link','Manage groups'])
  assert.equal(heldOps('SUPERVISOR',area).includes(op),false,`SUPERVISOR must not hold ${op} in ${area}`);
 for(const area of defaultStaffAreas('SUPERVISOR'))assert.equal(heldOps('SUPERVISOR',area).includes('Check / return'),true,`SUPERVISOR checks in ${area}`);
});

test('restricted actions: Partner-only decisions are not held by a Manager',()=>{
 for(const [area,op] of [['clients','Approve'],['billing_wip','Approve'],['billing_wip','Reset to draft'],['staff_access','Grant / revoke']]){
  assert.equal(heldOps('PARTNER',area).includes(op),true,`PARTNER ${op} in ${area}`);
  assert.equal(heldOps('MANAGER',area).includes(op),false,`MANAGER must not hold ${op} in ${area}`);
 }
 // A Manager does hold the delegated checks and posting.
 for(const [area,op] of [['clients','Check / return'],['billing_wip','Void'],['billing_wip','Refund / transfer'],['projects','Post / activate'],['staff_access','Issue setup link']])
  assert.equal(heldOps('MANAGER',area).includes(op),true,`MANAGER ${op} in ${area}`);
});

test('restricted actions: a switched-off right blocks exactly the actions routed to it, in every section',()=>{
 let checked=0;
 for(const area of AREAS){
  const inArea=actions.filter(a=>areaForStaffAction(a)===area);
  for(const a of inArea){
   const codes=rightsForRequest({action:a},area);
   // Every routed action maps to a right in its own section, or to none (view-only helpers).
   for(const code of codes){
    assert.equal(canUseAction([code],{action:a},area),false,`${a} must stop when ${code} is switched off`);
    assert.equal(canUseAction([],{action:a},area),true,`${a} is open when nothing is switched off`);
    checked++;
   }
  }
 }
 assert.ok(checked>300,'a large share of actions are covered by rights: '+checked);
 // Switching off the Check / return right for a Supervisor stops the proposal check and return, not proposing.
 const gate=(restricted,action)=>canUseAction(restricted,{action},areaForStaffAction(action));
 assert.equal(gate(['clientops.review'],'client_proposal_check'),false);
 assert.equal(gate(['clientops.review'],'client_proposal_return'),false);
 assert.equal(gate(['clientops.review'],'client_proposal_create'),true);
});

test('every right in the catalogue is held by a category that can reach its section',()=>{
 for(const r of ACTION_RIGHTS){
  assert.ok(AREAS.includes(r.area),`${r.code} area`);
  for(const role of r.roles)assert.equal(defaultStaffAreas(role).includes(r.area),true,`${role} holds ${r.code} but cannot reach ${r.area}`);
 }
});

const workspace=()=>({me:{staff_id:'s1'},clients:[{client_id:'c1',company_name:'Own Client',kra_pin:'P000000001A',owner_staff_id:'s1'},{client_id:'c2',company_name:'Other Client',kra_pin:'P000000002A'}],
 projects:[{project_id:'p1',client_id:'c1'}],tasks:[{task_id:'t1',project_id:'p1',assigned_to:'s1'},{task_id:'t2',project_id:'p1',assigned_to:'s2'}],
 assignments:[],schedules:[],work_periods:[],work_period_tasks:[],task_procedures:[],sales_reviews:[],task_events:[],workbook_batches:[],documents:[],timesheets:[],notifications:[],
 suite:{tax_profiles:[{client_id:'c1',turnover:100}],compliance:[{client_id:'c1',risk_rating:'High'}]}});

test('workspace data: a category sees client and tax detail only in the sections it holds',()=>{
 for(const role of CATEGORIES){
  const areas=defaultStaffAreas(role);
  const w=scopeWorkspaceRecords(filterWorkspaceAccess(workspace(),areas),role,'s1');
  const hasClients=areas.includes('clients');
  if(!hasClients){
   assert.deepEqual((w.suite?.tax_profiles||[]),[],`${role}: no tax profiles`);
   assert.deepEqual((w.suite?.compliance||[]),[],`${role}: no compliance records`);
   for(const c of w.clients||[])assert.equal(Object.hasOwn(c,'kra_pin'),false,`${role}: no client details`);
  }
  if(!areas.includes('projects')&&!areas.includes('clients'))assert.deepEqual(w.projects||[],[],`${role}: no projects`);
 }
 // An Assistant sees only their own task in the Projects section; a leader sees both.
 const assistant=scopeWorkspaceRecords(filterWorkspaceAccess(workspace(),defaultStaffAreas('ASSISTANT')),'ASSISTANT','s1');
 assert.deepEqual(assistant.tasks.map(t=>t.task_id),['t1']);
 const intern=scopeWorkspaceRecords(filterWorkspaceAccess(workspace(),defaultStaffAreas('INTERN')),'INTERN','s1');
 assert.deepEqual(intern.tasks.map(t=>t.task_id),['t1']);
 assert.deepEqual(intern.suite.tax_profiles,[]);
 const manager=scopeWorkspaceRecords(filterWorkspaceAccess(workspace(),defaultStaffAreas('MANAGER')),'MANAGER','s1');
 assert.deepEqual(manager.tasks.map(t=>t.task_id).sort(),['t1','t2']);
});
