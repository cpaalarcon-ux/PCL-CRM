// Build 2790: a tax rule with no figures (for example the Significant economic presence tax placeholder) cannot be put into staging test, and says why.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
test('the screen offers "Enable staging test" only when the rule has figures',()=>{
 const ui=rd('staff-tax-config.mjs');
 assert.match(ui,/Object\.keys\(r\.parameters\|\|\{\}\)\.length\?button\('rate-test','Enable staging test',r\.rate_id\):'<small class="muted">No figures entered, so nothing to test yet\.<\/small>'/);
 assert.match(ui,/Edit draft/,'Edit draft is still offered, so a labelled test figure can be entered by a person');
});
test('the server refuses a rule with no figures before it checks the note, with a plain reason, and invents no figure',()=>{
 const src=rd(fx+'tax-config-actions.ts'),i=src.indexOf("p.action==='rate_test'"),block=src.slice(i,i+2600);
 const guard=block.indexOf('This rule has no figures yet, so there is nothing to test'),note=block.indexOf('testingAuthorizationIssue');
 assert.ok(guard>0&&note>0&&guard<note,'the no-figures check comes before the note check');
 assert.match(block,/written confirmation/);assert.doesNotMatch(block,/parameters\s*[:=]\s*\{\s*rate/,'no rate is written by this action');
 assert.doesNotMatch(rd('staff-tax-config.mjs')+block,/forensic|ISRS 4000/i);
});
test('wiring and build label',()=>{
 assert.match(rd('staff-suite.mjs'),/staff-tax-config\.mjs\?v=20261112-excise-v4/);assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261112-resources-v1/);
 assert.equal(JSON.parse(rd(fx+'release.json')).build,'2026-11-12.2796');assert.match(rd('staff-pilot.html'),/2026-11-12\.2796/);
});
