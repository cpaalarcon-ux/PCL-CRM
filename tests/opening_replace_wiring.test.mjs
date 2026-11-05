import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),fn='supabase/functions/staff-workspace-v12/';
test('an unposted opening draft is replaced in place; submitted and posted entries stay locked',()=>{
 const src=read(fn+'ledger-actions.ts');
 assert.match(src,/waiting for independent review\. Ask the reviewer to return it, then upload the corrected TB/);
 assert.match(src,/already posted\. Posted opening corrections require a reviewed adjustment/);
 assert.match(src,/writeLines\(tx,openingDraft,parsed\)/);assert.match(src,/replaced:true/);
});
test('removing an opening upload is blocked only while its opening entry is submitted or posted',()=>{
 const idx=read(fn+'index.ts');
 assert.match(idx,/source_snapshot->>'document_id'/);
 assert.match(idx,/waiting for independent review\. Ask the reviewer to return it, then remove the upload and upload the corrected TB/);
});
test('Step 3 offers Remove this upload and Upload corrected TB while the opening is not posted or in review',()=>{
 const guide=read('staff-setup-guide.mjs'),pilot=read('staff-pilot.mjs');
 assert.match(guide,/remove-opening-source/);assert.match(guide,/Remove this upload \(wrong or refused file\)/);assert.match(guide,/Upload corrected TB & replace draft/);
 assert.match(guide,/!opening\.posted&&!opening\.awaitingReview/);
 assert.match(pilot,/function removeImportSource\(documentId,after\)/);assert.match(pilot,/removeOpeningSource:/);
});
