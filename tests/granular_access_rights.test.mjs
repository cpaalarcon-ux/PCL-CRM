import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {ACTION_RIGHTS,canUseAction,defaultActionRights,filterActionWorkspace,hasVisibleActionGroup,rightsForRequest} from '../staff-action-rights.mjs';
import {areaForStaffAction,defaultStaffAreas} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {workQueueAction} from '../supabase/functions/staff-workspace-v12/work-queue-actions.ts';
import {suiteAction} from '../supabase/functions/staff-workspace-v12/suite-actions.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('the staff screen and Edge Function share one catalogue covering all ten areas',()=>{
 assert.equal(read('staff-action-rights.mjs'),read('supabase/functions/staff-workspace-v12/staff-action-rights.mjs'));
 assert.equal(new Set(ACTION_RIGHTS.map(r=>r.code)).size,ACTION_RIGHTS.length);
 assert.equal(new Set(ACTION_RIGHTS.map(r=>r.area)).size,10);
 const routes=new Set();
 for(const r of ACTION_RIGHTS){
  assert.match(r.code,/^[a-z]+\.[a-z_]+$/);
  for(const role of r.roles)assert.ok(defaultStaffAreas(role).includes(r.area),r.code+' '+role);
  for(const action of r.routes){
   assert.equal(areaForStaffAction(action),r.area,action);
   assert.ok(!routes.has(action),action);routes.add(action);
  }
 }
 assert.ok(!defaultActionRights('ASSISTANT').includes('invoice.create'));
 assert.ok(!defaultActionRights('ASSISTANT').includes('journal.post'));
 assert.ok(defaultActionRights('MANAGER').includes('invoice.post'));
});

test('view, create, edit, post and reverse can be restricted independently',()=>{
 const p=action=>({action});
 assert.ok(canUseAction(['invoice.post'],p('invoice_save')));
 assert.ok(canUseAction(['invoice.create'],p('invoice_edit')));
 assert.ok(!canUseAction(['invoice.view'],p('invoice_edit')));
 assert.ok(!canUseAction(['invoice.edit'],p('invoice_edit')));
 assert.ok(!canUseAction(['invoice.create'],p('fee_schedule_generate_due')));
 assert.ok(canUseAction(['receipt.reverse'],p('payment_add')));
 assert.ok(!canUseAction(['receipt.view'],p('advance_receive')));
 assert.ok(!canUseAction(['invoice.view'],p('advance_apply')));
 assert.deepEqual(rightsForRequest({action:'ledger_journal_save',journal_id:'existing'}),['journal.view','journal.edit']);
 assert.ok(!canUseAction(['journal.edit'],{action:'ledger_payroll_create',journal_id:'existing'}));
 assert.ok(canUseAction(['journal.post'],{action:'ledger_journal_review',status:'Returned'}));
 assert.ok(!canUseAction(['journal.post'],{action:'ledger_journal_review',status:'Posted'}));
 assert.ok(!canUseAction(['journal.view'],p('ledger_account_read')));
 assert.ok(hasVisibleActionGroup('PARTNER','billing_wip',['invoice.view']));
 assert.ok(!hasVisibleActionGroup('PARTNER','billing_wip',['invoice.view','receipt.view','fee.view','wip.view','statement.view']));
});

test('remaining actions are mapped to their workflow or to the controlled functions in their area',()=>{
 for(const [action,expected] of [
  ['timesheet_review','timesheet.review'],['v3_stock_save','stock.edit'],['v3_client_account_mapping_approve','chart.review'],
  ['workbook_map_bulk','imports.edit'],['tax_credit_claim','taxwork.edit'],['forensic_get','forensic.view'],
  ['incoming_accept','incoming.edit'],['audit_file_archive','auditwork.edit'],['reference_download','reference.view'],
  ['metrics_wip','wip.view'],['account_link','staff.setup'],['staff_rights_read','access.view'],
 ]){
  const area=areaForStaffAction(action);
  assert.ok(area,action);
  const codes=rightsForRequest({action},area);
  assert.ok(codes.includes(expected),action+' '+codes.join(','));
  assert.ok(!canUseAction([codes[0]],{action},area));
 }
 assert.deepEqual(rightsForRequest({action:'workspace'}),[]);
});
test('server workspace omits restricted lists while keeping permitted data and record identity',()=>{
 const data={clients:[{client_id:'client',company_name:'Example',kra_pin:'synthetic-id'}],suite:{invoices:[{invoice_id:'invoice'}],payments:[{payment_id:'payment'}],advances:[{}],leads:[{}]}};
 const filtered=filterActionWorkspace(data,['invoice.view','client.view','lead.view']);
 assert.deepEqual(filtered.suite.invoices,[]);
 assert.equal(filtered.suite.payments.length,1);
 assert.deepEqual(filtered.suite.leads,[]);
 assert.deepEqual(filtered.clients,[{client_id:'client',company_name:'Example',details_visible:false}]);
 assert.equal(data.suite.invoices.length,1);
});

test('bulk journal decisions enforce both granular rights and existing checker restrictions before SQL',async()=>{
 const tx=async()=>assert.fail('a forbidden decision must never query journals');
 const partner={category_code:'PARTNER'};
 for(const denied of ['journal.post','journal.view','acct.journal_approve'])
  await assert.rejects(workQueueAction(tx,partner,{action:'work_queue_decide',decision:'approve'},null,[denied]),e=>e.status===403);
});

test('invoice editing requires a current draft and recalculates totals without changing its project',async()=>{
 const id='10000000-0000-4000-8000-000000000001',project='10000000-0000-4000-8000-000000000002';
 const original={invoice_id:id,project_id:project,status:'Draft',revision:4,request_id:'10000000-0000-4000-8000-000000000003'};
 const p={action:'invoice_edit',invoice_id:id,revision:'4',project_id:'forged',description:'Synthetic draft',invoice_date:'2026-01-01',due_date:'2026-01-31',
  lines:[{description:'Synthetic service',quantity:2,unit_price:116,includes_vat:true}]};
 let old=original,changes;
 const tx=async(parts,...params)=>{
  const sql=parts.join('?');
  if(sql.includes('from erp_private.invoices where invoice_id='))return [old];
  if(sql.includes('finance_allowed')){assert.equal(params[0],project);assert.equal(params[1],true);return [{project_id:project}];}
  if(sql.includes('select * from erp_private.projects'))return [{project_id:project}];
  if(sql.includes('update erp_private.invoices')){changes=params;assert.doesNotMatch(sql,/set project_id/);return [{invoice_id:id,revision:5}];}
  assert.fail(sql);
 };
 tx.json=value=>value;
 await assert.rejects(suiteAction(tx,{}, {...p,revision:'3'}),e=>e.status===409);
 old={...original,status:'Posted'};
 await assert.rejects(suiteAction(tx,{},p),e=>e.status===400&&/Only draft/.test(e.message));
 old=original;
 assert.deepEqual(await suiteAction(tx,{},p),{invoice_id:id,revision:5});
 assert.equal(changes[3][0].net,200);assert.equal(changes[3][0].vat,32);
 assert.equal(changes[4],200);assert.equal(changes[5],32);
});

test('the Edge dispatch and expandable Staff access editor share the permission checks',()=>{
 const edge=read('supabase/functions/staff-workspace-v12/index.ts'),ui=read('staff-pilot.mjs');
 assert.match(edge,/await requireActionRight\(tx,a,p,await loadActorRights\(\)\)/);
 assert.match(edge,/access_stamp:accessStamp\(denied,off\)/);
 assert.match(edge,/p\.rights_version===2\?defaultActionRights/);
 assert.match(ui,/<details><summary>Actions in/);
 assert.match(ui,/rights_version:2,access_stamp:access\.access_stamp/);
});
