import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('the payroll register is reachable from the payroll screen and starts a month from the register',()=>{
 const ui=rd('staff-period-imports.mjs');
 assert.match(ui,/staff-payroll-register\.mjs\?v=20261115-register-v1/);assert.match(ui,/button\('register','Payroll register'\)/);assert.match(ui,/register\.isAction\(action\)/);
 assert.match(ui,/Rolled forward from the payroll register/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-period-imports\.mjs\?v=20261115-redo-v1/);
 assert.match(rd('staff-pilot.mjs'),/staff-workspace-v6\.mjs\?v=20261115-holders-v1/);
});
test('the register screen sends the server actions and never saves a payroll',()=>{
 const ui=rd('staff-payroll-register.mjs');
 for(const a of ['payroll_register_read','payroll_register_add','payroll_register_pay','payroll_register_leave','payroll_register_draft'])assert.match(ui,new RegExp(a));
 assert.doesNotMatch(ui,/period_import_save|period_import_submit|ledger_/);
});
test('server wiring: actions are routed and classified under project access',()=>{
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/payrollRegisterAction\(tx,a,p\)/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/payroll_register_\|/);
});
test('the balance stylesheet block keeps the header from clipping',()=>{
 const css=rd('staff-pilot.css');
 assert.match(css,/Build 2804: balance and consistency/);assert.match(css,/\.workspace-topbar\{flex-wrap:wrap/);assert.match(css,/\.workspace-topbar \.header-tools\{flex:0 1 auto;flex-wrap:wrap/);
 assert.match(rd('staff-pilot.html'),/staff-pilot\.css\?v=20261115-balance-v1/);
});
