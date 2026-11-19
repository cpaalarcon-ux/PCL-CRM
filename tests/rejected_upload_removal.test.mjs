import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');

test('the tax review lists a rejected-only upload with a one-step removal that uses the existing archive action',()=>{
 const ui=rd('staff-suite.mjs'),srv=rd('supabase/functions/staff-workspace-v12/tax-review-actions.ts');
 // Server: only an upload that staged no rows and holds no pending credits is offered, and the list rides on the tax read.
 assert.match(srv,/b\.rejected_count>0\s+and not exists\(select 1 from erp_private\.workbook_rows r where r\.batch_id=b\.batch_id\)/);
 assert.match(srv,/raw_values \? '_pending_purchase'/);
 assert.match(srv,/rejected_count:rejected,rejected_uploads,unreviewed,unmapped/);
 // Screen: the panel shows only while the case can still change, and the button needs a reason and a ticked confirmation (never pre-ticked).
 assert.match(ui,/rejectedUploadsPanel=\(list,c\)=>\{if\(!list\?\.length\|\|!\['Draft','Returned'\]\.includes\(c\.status\)\)return ''/);
 assert.match(ui,/\$\{rejectedUploadsPanel\(r\.rejected_uploads,c\)\}/);
 assert.match(ui,/name="confirm_remove" type="checkbox" required>/);assert.doesNotMatch(ui,/name="confirm_remove" type="checkbox" checked/);
 // It reuses the Documents-list removal: reason required, confirmation sent, nothing deleted. It never touches the database directly.
 assert.match(ui,/request\(\{action:'document_archive',document_id:id,reason:f\.get\('reason'\),confirmed:f\.has\('confirm_remove'\)\}\)/);
 assert.match(ui,/await taxOpen\(caseId\)/,'the review reopens so the blocker count is fresh');
});
