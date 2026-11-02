import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ACCESS_ROLES,APPROVAL_RULES,renderAccessGuide} from '../staff-access-guide.mjs';

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
 assert.match(renderAccessGuide('MANAGER',x=>x),/individual permission overrides are not enabled/);
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
