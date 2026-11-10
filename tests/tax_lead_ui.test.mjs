// Tax period setup screen (build 2760): suggested KRA due date, the iTax confirmation, the explicit fallback, and the wording of amendments.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {suggestedKraDueDate} from '../staff-tax-period-defaults.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');

test('the ERP suggests the KRA due date but never confirms it',()=>{
 assert.equal(suggestedKraDueDate('PAYE','2026-09-30').date,'2026-10-09');
 assert.equal(suggestedKraDueDate('NSSF','2026-09-30').date,'2026-10-09');
 assert.equal(suggestedKraDueDate('VAT','2026-09-30').date,'2026-10-20');
 assert.equal(suggestedKraDueDate('TOT','2026-12-31').date,'2027-01-20','December rolls into the next year');
 for(const k of ['Company','Individual','Partnership','WHT','NITA'])assert.equal(suggestedKraDueDate(k,'2026-12-31').date,'','no local suggestion for '+k);
 assert.equal(suggestedKraDueDate('VAT','').date,'');
 assert.match(suggestedKraDueDate('VAT','2026-09-30').rule,/Check it against the KRA iTax calendar/);
 assert.match(suggestedKraDueDate('Company','2026-12-31').rule,/annual due-date rule/,'annual dates are looked up on the server');
 assert.match(suggestedKraDueDate('WHT','2026-12-31').rule,/task-date fallback/);
});
test('the new tax period form carries the due date, the iTax tick and the explicit fallback',()=>{
 const su=read('staff-suite.mjs');
 assert.match(su,/field\('kra_due_date','KRA return due date \(statutory\)'/);
 assert.match(su,/check\('itax_confirmed','I confirm this matches the KRA iTax calendar'\)/);
 assert.match(su,/check\('use_task_date_fallback','Use Task Date Fallback/);
 assert.match(su,/field\('fallback_reason'/);
 assert.match(su,/actionForm\('New tax review period',body,'tax_create',\{\},'Confirm Due Dates and create period'\)/);
 assert.match(su,/suggestedKraDueDate\(kind,ends\)/);assert.match(su,/action:'due_date_state'/);
 assert.match(su,/The filed return and its source rows \(eTIMS uploads, bank statements\) are never reopened or edited/);
 assert.match(su,/holds adjustments only/);
});
test('the server pieces are wired and the actions belong to the projects area',()=>{
 const idx=read('supabase/functions/staff-workspace-v12/index.ts');
 assert.match(idx,/import \{dueDateAction\} from '\.\/due-date-actions\.ts'/);assert.match(idx,/const dueDate=await dueDateAction\(tx,a,p\)/);
 for(const a of ['due_date_state','due_date_confirm','due_date_fallback'])assert.equal(areaForStaffAction(a),'projects');
 const rights=read('supabase/functions/staff-workspace-v12/staff-rights-actions.ts');
 assert.match(rights,/code:'APPROVE_TAX_RULES'/);
 const cfg=read('supabase/functions/staff-workspace-v12/tax-config-actions.ts');
 assert.match(cfg,/const leadOnly=\['VAT','Withholding tax'\]/);assert.match(cfg,/rateAuthority\(tx,a,r\)/);
 const rel=JSON.parse(read('supabase/functions/staff-workspace-v12/release.json'));
 assert.equal(rel.build,'2026-11-11.2775');assert.match(read('staff-pilot.html'),/data-build="2026-11-11\.2775"/);
 assert.match(read('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261110-taxrole-v3/);assert.match(read('staff-suite.mjs'),/staff-tax-period-defaults\.mjs\?v=20261110-taxrole-v3/);
});
test('wording: nothing here says a Partner confirmed anything, and the banned standard name never appears',()=>{
 for(const f of ['staff-suite.mjs','staff-tax-period-defaults.mjs','staff-deadlines.mjs','supabase/functions/staff-workspace-v12/due-date-actions.ts','supabase/migrations/20261110279000_tax_lead_due_dates_amendments.sql'])assert.doesNotMatch(read(f),/ISRS 4000/);
 assert.match(read('staff-deadlines.mjs'),/Until a Partner records the confirmation they show "Default - not yet confirmed"/);
 assert.match(read('staff-deadlines.mjs'),/Tax Lead, a Manager or a Partner has confirmed/);
});
