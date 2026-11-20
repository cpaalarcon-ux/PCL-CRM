import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {STAFF_RIGHTS,rightForAction,defaultStaffRights,effectiveStaffRights,isRightCode} from '../supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs';
import {areaForStaffAction,defaultStaffAreas} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';

const dir='supabase/functions/staff-workspace-v12';
const read=f=>fs.readFileSync(f,'utf8');
const serverSource=fs.readdirSync(dir).filter(f=>/\.(ts|mjs)$/.test(f)&&f!=='staff-rights-catalog.mjs').map(f=>read(path.join(dir,f))).join('\n');

test('the server and screen copies of the rights catalogue are identical',()=>{
  assert.equal(read('staff-rights-catalog.mjs'),read(`${dir}/staff-rights-catalog.mjs`));
});

test('codes are unique, roles are known and every action maps to one right',()=>{
  const codes=STAFF_RIGHTS.map(r=>r.code);
  assert.equal(new Set(codes).size,codes.length);
  const seen=new Map();
  for(const r of STAFF_RIGHTS){
    assert.match(r.code,/^[a-z]+\.[a-z_]+$/);
    assert.ok(r.label.length>5&&r.group);
    for(const role of r.roles)assert.ok(['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN'].includes(role),`${r.code} ${role}`);
    for(const a of r.actions){assert.ok(!seen.has(a),`${a} appears in ${seen.get(a)} and ${r.code}`);seen.set(a,r.code);assert.equal(rightForAction(a),r.code);}
  }
});

test('every action named in the catalogue exists on the server and sits in the same area',()=>{
  for(const r of STAFF_RIGHTS)for(const a of r.actions){
    assert.ok(serverSource.includes(`'${a}'`),`${a} (${r.code}) is not an action on the server`);
    assert.equal(areaForStaffAction(a),r.area,`${a} belongs to ${areaForStaffAction(a)} but ${r.code} says ${r.area}`);
  }
});

test('roles only hold rights inside areas their role already has',()=>{
  for(const r of STAFF_RIGHTS)for(const role of r.roles)
    assert.ok(defaultStaffAreas(role).includes(r.area),`${role} holds ${r.code} but not the ${r.area} area`);
});

test('effective rights narrow only: denied rights and unticked areas remove, nothing is added',()=>{
  const base=defaultStaffRights('MANAGER');
  assert.ok(base.includes('kyc.verify'));
  assert.ok(!effectiveStaffRights('MANAGER',['kyc.verify']).includes('kyc.verify'));
  assert.equal(effectiveStaffRights('MANAGER',[],['clients']).some(c=>c.startsWith('acct.')),false);
  assert.ok(!effectiveStaffRights('ASSISTANT',[]).includes('kyc.verify'));
  assert.ok(!defaultStaffRights('ASSISTANT').includes('acct.journal_approve'));
  assert.ok(!defaultStaffRights('SUPERVISOR').includes('acct.journal_approve'));
  assert.ok(!defaultStaffRights('ADMIN').length);
  assert.ok(isRightCode('chart.check')&&!isRightCode('chart.finance'));
});

test('the server refuses a switched-off function and the save is narrow-only, reasoned and audited',()=>{
  const idx=read(`${dir}/index.ts`);
  assert.match(idx,/async function requireStaffRight/);
  assert.match(idx,/await requireStaffArea\(tx,a,requestArea\);await requireStaffRight\(tx,a,String\(p\.action\|\|''\)\)/);
  assert.match(idx,/Individual access can only narrow this role/);
  assert.match(idx,/STAFF_RIGHT_ACCESS_CHANGED/);
  assert.match(idx,/restricted_rights/);
  assert.match(idx,/\['staff_access_read','staff_access_save','staff_save','staff_disable'\]/);
  const mig=read('supabase/migrations/20261106060028_staff_right_restrictions.sql');
  assert.match(mig,/FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(mig,/GRANT[^;]*UPDATE/);
});

test('the staff screen shows grouped checkboxes with tick-all and sends the chosen functions',()=>{
  const ui=read('staff-pilot.mjs');
  assert.match(ui,/staff-rights-catalog\.mjs\?v=/);
  assert.match(ui,/name="allowed_rights"/);
  assert.match(ui,/Tick all/);
  assert.match(ui,/allowed_rights:f\.getAll\('allowed_rights'\)/);
  assert.match(ui,/Not part of this role/);
});
