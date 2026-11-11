import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('the bank summary screen shows money out in groups with a tie-out line and drills into them',()=>{
 const ui=read('staff-ledger.mjs');
 assert.match(ui,/money_out_sections/);assert.match(ui,/id="bankTieOut"/);assert.match(ui,/Tie-out failed/);assert.match(ui,/is not yet mapped: map it in the Fix-It queue/);
 assert.match(ui,/\(bsum\.money_out_sections\|\|\[\]\)\.find/,'the Show lines button also finds money-out groups');
 assert.match(read('staff-workspace-v6.mjs'),/staff-ledger\.mjs\?v=20261111-bankout-v1/);
});
test('the server returns the groups and the tie-out, and no group is a guess',()=>{
 const m=read('supabase/functions/staff-workspace-v12/bank-statement.mjs');
 assert.match(m,/money_out_sections/);assert.match(m,/tie_out/);
 assert.doesNotMatch(m,/narrative|description.*includes/i,'money out is grouped by the account a person mapped, never by text');
 assert.match(read('supabase/functions/staff-workspace-v12/release.json'),/2026-11-11\.2782/);
});
