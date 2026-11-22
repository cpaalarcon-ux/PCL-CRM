import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {managerResetTargets} from '../supabase/functions/staff-workspace-v12/manager-reset-targets.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {canUseAction, rightsForRequest} from '../supabase/functions/staff-workspace-v12/staff-action-rights.mjs';

const id = n => '00000000-0000-4000-8000-'+String(n).padStart(12, '0');
const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');

test('only another eligible manager can be selected for a peer password reset', async t => {
 const db = new PGlite();
 t.after(() => db.close());
 await db.exec(`
  create schema erp_private;
  create table erp_private.staff_members (
   staff_id uuid primary key, full_name text, category_code text, access_status text,
   auth_user_id uuid, deleted_at timestamptz, contract_end_date date
  );
  create table erp_private.firms (firm_id uuid primary key, is_active boolean, deleted_at timestamptz);
  create table erp_private.staff_firm_access (staff_id uuid, firm_id uuid, deleted_at timestamptz);
 `);
 const tx = async (parts, ...values) => {
  const query = parts.reduce((sql, part, i) => sql + (i ? '$'+i : '') + part, '');
  return (await db.query(query, values)).rows;
 };
 await tx`insert into erp_private.firms values (${id(21)},true,null),(${id(22)},true,null),(${id(23)},false,null)`;
 const staff = [
  [1,'Issuer','MANAGER','Active',id(101),null,null],
  [2,'Peer','MANAGER','Active',id(102),null,null],
  [3,'Waiting for new password','MANAGER','Pending setup',id(103),null,null],
  [4,'Different firm','MANAGER','Active',id(104),null,null],
  [5,'Peer with extra firm','MANAGER','Active',id(105),null,null],
  [6,'Partner','PARTNER','Active',id(106),null,null],
  [7,'Disabled','MANAGER','Inactive',id(107),null,null],
  [8,'New starter','MANAGER','Pending setup',null,null,null],
  [9,'Expired','MANAGER','Active',id(109),null,'2000-01-01'],
  [10,'Removed','MANAGER','Active',id(110),'2000-01-01',null],
  [11,'Inactive firm only','MANAGER','Active',id(111),null,null],
 ];
 for (const [number,name,role,status,auth,deleted,end] of staff) {
  await tx`insert into erp_private.staff_members values (${id(number)},${name},${role},${status},${auth},${deleted},${end})`;
  const firm = number === 4 ? 22 : number === 11 ? 23 : 21;
  await tx`insert into erp_private.staff_firm_access values (${id(number)},${id(firm)},null)`;
 }
 await tx`insert into erp_private.staff_firm_access values (${id(5)},${id(22)},null)`;

 assert.deepEqual(await managerResetTargets(tx,id(1)), [
  {staff_id:id(2),full_name:'Peer'},
  {staff_id:id(3),full_name:'Waiting for new password'},
 ]);
 for (const target of [1,4,5,6,7,8,9,10,11]) {
  assert.deepEqual(await managerResetTargets(tx,id(1),id(target)), []);
 }
 assert.deepEqual(await managerResetTargets(tx,id(6),id(2)), []);
 await tx`update erp_private.staff_firm_access set deleted_at=now() where staff_id=${id(2)}`;
 assert.deepEqual(await managerResetTargets(tx,id(1),id(2)), []);
});

test('peer discovery uses the existing staff setup right and profile management stays separate', () => {
 const request = {action:'manager_password_reset_targets'};
 assert.equal(areaForStaffAction(request.action), 'staff_access');
 assert.deepEqual(rightsForRequest(request,'staff_access'), ['staff.view','staff.setup']);
 assert.equal(canUseAction(['staff.setup'], request, 'staff_access'), false);
 const api = read('supabase/functions/staff-workspace-v12/index.ts');
 const issue = api.split('async function accountLink(')[1].split('async function managerPasswordResetTargets(')[0];
 assert.match(issue,/if\(staff\.staff_id===actor\.staff_id\)fail\(403/);
 assert.match(issue,/managerResetTargets\(tx,actor\.staff_id,staffId\)/);
 assert.match(issue,/else await canManageStaffRecord\(tx,actor,staff\)/);
 assert.match(issue,/SETUP_LINK_ISSUED.*manager_peer_reset/);
 const redeem = api.split('async function credentialLinkState(')[1].split('async function emailPartnerRecovery(')[0];
 assert.match(redeem,/issuer\?\.category_code!=='MANAGER'\|\|row\.category_code!=='MANAGER'/);
 assert.match(redeem,/managerResetTargets\(tx,issuer\.staff_id,row\.staff_id\)/);
 assert.match(redeem,/await credentialLinkState\(tx,rows\[0\]\)/);
});

test('Staff & access lets a manager select a peer and confirm before issuing a reset link', async t => {
 const dom = new JSDOM(read('staff-pilot.html'), {url:'https://example.test/staff-pilot#view=staff'});
 t.after(() => dom.window.close());
 for (const key of ['window','document','location','history','sessionStorage','localStorage','FormData','HTMLElement']) {
  globalThis[key] = dom.window[key];
 }
 dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
 dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
 const me = {staff_id:id(1),full_name:'Test manager',login_id:'qa-manager',category_code:'MANAGER',access_status:'Active'};
 const peer = {staff_id:id(2),full_name:'Test peer'};
 const fields = ['firms','staff_firms','clients','client_firms','projects','assignments','candidates','tasks','documents','services','sectors','schedules','timesheets','notifications','task_events','workbook_batches','task_procedures'];
 const suiteFields = ['leads','tax_profiles','rates','staff_rates','budgets','invoices','payments','communications','contacts','compliance','owners','engagements','tax_cases','leave','attendance','credentials','reviews','tickets'];
 const emptyLists = names => Object.fromEntries(names.map(name => [name, []]));
 const workspace = {...emptyLists(fields),me,staff:[me],suite:emptyLists(suiteFields)};
 const privateLink = 'https://example.test/staff-pilot#setup='+'a'.repeat(64);
 const replies = {
  login:{access_token:'qa',refresh_token:'refresh',expires_at:Date.now()/1000+3600,session_id:'qa'},
  workspace,
  manager_password_reset_targets:{targets:[peer]},
  account_link:{login_id:'qa-peer',setup_url:privateLink,expires_at:new Date(Date.now()+86400000).toISOString()},
  presence_heartbeat:{status:'Not clocked in',server_time:new Date().toISOString()},
 };
 const calls = [];
 t.mock.method(globalThis,'fetch',async (_url,request) => {
  const body = JSON.parse(request.body);
  calls.push(body);
  return Response.json(replies[body.action]||{});
 });
 const $ = selector => document.querySelector(selector);
 const visible = async selector => {
  for (let i=0;i<50;i++) {
   const el = $(selector);
   if (el) return el;
   await new Promise(resolve => setTimeout(resolve,10));
  }
  assert.fail('Missing '+selector);
 };
 await import('../staff-pilot.mjs');
 $('#loginForm [name=login_id]').value = 'qa-manager';
 $('#loginForm [name=password]').value = 'test-only';
 $('#loginForm').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 (await visible('[data-manager-password-reset]')).click();
 const select = await visible('#managerResetTarget');
 assert.deepEqual([...select.options].map(option => option.value), ['',peer.staff_id]);
 select.value = peer.staff_id;
 select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 $('#continueManagerReset').click();
 assert.match($('#editorBody').textContent,/Test peer/);
 assert.ok(!calls.some(call => call.action === 'account_link'));
 $('#confirmLink').click();
 assert.equal((await visible('#privateLink')).value, privateLink);
 assert.deepEqual(calls.filter(call => call.action === 'account_link'), [{action:'account_link',staff_id:peer.staff_id}]);
});
