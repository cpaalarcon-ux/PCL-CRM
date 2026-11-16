import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const L=await import('../staff-configure-links.mjs');
const J=await import('../staff-payroll-journal.mjs');
const F=await import('../staff-settings-frame.mjs');
const src=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');

test('blockers that a setting fixes name that setting; others get no link',()=>{
 assert.deepEqual(L.blockerKinds(['No published export profile is in force for this return and month.']),['export_profile']);
 assert.deepEqual(L.blockerKinds(['No approved payroll mapping for NSSF_EMP.']),['routing_map']);
 assert.deepEqual(L.blockerKinds('These payroll codes have no approved mapping for 2026-10, so the entry stays unprepared: BASIC.'),['routing_map']);
 assert.deepEqual(L.blockerKinds(['No approved revenue account is set for this sales category and date.']),['routing_map']);
 assert.deepEqual(L.blockerKinds(['Applicable approved rate missing: KE_PAYE_BANDS (2026-10-01 to 2026-10-31).']),['tax_rate']);
 assert.deepEqual(L.blockerKinds(['The previously selected rate is unavailable or test-only. Preview and save the current applicable rules.']),['tax_rate']);
 // Things a setting cannot fix: no link.
 for(const t of ['Upload the sales source for this period.','Complete independent monthly sales and bank reconciliation before tax submission.','3 employee PAYE differences need correction.','Multiple approved versions of KE_VAT cover this period.'])assert.deepEqual(L.blockerKinds([t]),[],t);
 assert.deepEqual(L.blockerKinds(undefined),[]);assert.deepEqual(L.blockerKinds([]),[]);
 // Several blockers: one link each, in a steady order, never twice.
 assert.deepEqual(L.blockerKinds(['Applicable approved rate missing: X','No approved payroll mapping for A','No approved payroll mapping for B','No published export profile …']),['export_profile','routing_map','tax_rate']);
});

test('every kind a blocker can name has a Settings target, and the link is escaped',()=>{
 for(const s of L.BLOCKER_SETTINGS)assert.ok(F.CONFIGURE_TARGETS[s.kind],s.kind);
 const html=L.configureLinksHtml(['Applicable approved rate missing: K'],'the <tax> calculation',esc);
 assert.match(html,/data-suite="configure-go" data-id="tax_rate::the &lt;tax> calculation"/);assert.match(html,/Configure this setting \(tax rule\)/);
 assert.equal(L.configureLinksHtml(['Upload the sales source'],'x',esc),'');
 const p=F.parseConfigure('tax_rate::the tax calculation');assert.equal(p.target.tab,'accounting');assert.equal(p.from,'the tax calculation');
});

test('payroll journal "not prepared" box offers the routing mapping, and a ready journal does not',()=>{
 const base={month:'2026-10',employees:2,totals:{},changes:{first_month:true},exceptions:[],journal:{lines:[],balanced:false}};
 const blocked=J.payrollPreviewView({...base,unmapped:[{code:'BASIC',reason:'No approved mapping for the dates'}]},esc);
 assert.match(blocked,/data-id="routing_map::the payroll journal"/);
 const ready=J.payrollPreviewView({...base,unmapped:[]},esc);assert.doesNotMatch(ready,/configure-go/);
});

test('screens wire the links and the server wording still matches the rules',()=>{
 for(const f of ['staff-suite.mjs','staff-period-imports.mjs','staff-payroll-journal.mjs','staff-statutory-files.mjs'])assert.match(src(f),/staff-configure-links\.mjs\?v=20261117-links-v1/,f);
 assert.match(src('staff-suite.mjs'),/configureLinksHtml\(r\.issues,'the tax calculation',esc\)/);
 assert.match(src('staff-period-imports.mjs'),/configureLinksHtml\(issues,'the '\+x\.kind\.toLowerCase\(\)\+' import',esc\)/);
 // The wording the rules match must still be what the server says.
 const v12=f=>src('supabase/functions/staff-workspace-v12/'+f);
 assert.match(v12('tax-registry.mjs'),/Applicable approved rate missing/);
 assert.match(v12('tax-review-actions.ts'),/previously selected rate is unavailable or test-only/);
 assert.match(v12('ledger-actions.ts'),/have no approved mapping for/);
 assert.match(v12('ledger-actions.ts'),/No approved revenue account is set/);
 assert.match(v12('statutory-file-rules.mjs'),/No published export profile/);
});
