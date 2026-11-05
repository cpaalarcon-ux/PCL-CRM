import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),fn='supabase/functions/staff-workspace-v12/';
test('draft project, client year, opening TB and chart proposal are gated on the classification and the approved chart',()=>{
 assert.match(read(fn+'workspace-actions.ts'),/requireRightChart\(tx,cid,'creating the draft project'\)/);
 assert.match(read(fn+'ledger-actions.ts'),/requireRightChart\(tx,project\.client_id,'creating the client year'\)/);
 assert.match(read(fn+'index.ts'),/requireRightChart\(tx,cid,'staging the opening TB'\)/);
 assert.match(read(fn+'client-chart.ts'),/requireClassified\(tx,cid,'proposing the chart of accounts'\)/);
 assert.match(read(fn+'engagement-actions.ts'),/!c\.legal_structure\|\|!c\.legal_subtype/,'KYC verification needs the subcategory too');
});
test('the checklist tells staff what unlocks project, client year and opening TB',()=>{
 assert.match(read('staff-setup-guide.mjs'),/stay locked until the Legal structure and Subcategory are set and the matching client chart of accounts is approved/);
});
test('the Classify clients screen is routed and offered to Managers and Partners with unclassified clients',()=>{
 assert.match(read(fn+'index.ts'),/client_classify_save'\)return await classifyClientsAction/);
 const pilot=read('staff-pilot.mjs');assert.match(pilot,/data-classify-clients/);assert.match(pilot,/action:'client_classify_save'/);assert.match(pilot,/Classify clients \(\$\{toClassify\}\)/);
});
