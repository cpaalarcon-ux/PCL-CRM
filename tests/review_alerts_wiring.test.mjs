import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),fn='supabase/functions/staff-workspace-v12/';
test('every submit-for-review action alerts reviewers and every decision alerts the preparer',()=>{
 const setup=read(fn+'improvement-actions.ts'),chart=read(fn+'client-chart.ts'),ledger=read(fn+'ledger-actions.ts'),queue=read(fn+'review-queue.ts');
 assert.match(setup,/notifyReviewers\(tx,cid,`client activity change/,'activity change submit');assert.match(setup,/notifyOutcome\(tx,change\.submitted_by,cid,'client activity change'/,'activity change decision');
 assert.match(chart,/notifyReviewers\(tx,cid,`client chart of accounts/,'chart submit');assert.match(chart,/notifyOutcome\(tx,v\.prepared_by,v\.client_id,'client chart of accounts'/,'chart decision');
 assert.match(ledger,/notifyReviewers\(tx,l\.client_id,`\$\{kind\} report/,'report submit');assert.match(ledger,/notifyOutcome\(tx,r\.prepared_by,l\.client_id/,'report decision');
 assert.match(ledger,/notifyReviewers\(tx,l\.client_id,`\$\{j\.kind==='Opening'/,'journal submit');assert.match(ledger,/notifyOutcome\(tx,j\.last_prepared_by\|\|j\.prepared_by/,'journal decision');
 assert.match(queue,/client_setup_change_sets s join erp_private\.clients c[^`]*s\.status='Pending review' and s\.submitted_by<>\$\{a\.staff_id\}/,'setup changes join the Home list for everyone but the submitter');
 assert.match(queue,/kind:'setup'/);
});
test('Home opens a pending setup change and the checklist names the approval blocker',()=>{
 const pilot=read('staff-pilot.mjs'),guide=read('staff-setup-guide.mjs'),setup=read(fn+'improvement-actions.ts');
 assert.match(pilot,/myReview==='setup'\)await improvements\.client\(/);
 assert.match(setup,/pending_setup_changes:await tx`select s\.change_id[^`]*s\.client_id=\$\{cid\} and s\.status='Pending review'/);
 assert.match(guide,/Waiting for approval: a client activity change/);assert.match(guide,/!covered\.length&&!pendingSetup\.length/,'the generic "add a mapping" blocker no longer hides the real cause');
 assert.match(guide,/a==='setup-change'\)await ctx\.openClientSettings\(id\)/);
});
test('the alert functions are internal and only the API role can run them',()=>{
 const sql=read('supabase/migrations/20261105085343_review_alerts.sql');
 assert.match(sql,/REVOKE ALL ON FUNCTION erp_private\.notify_reviewers[^;]*FROM PUBLIC,anon,authenticated,service_role/);assert.match(sql,/GRANT EXECUTE ON FUNCTION erp_private\.notify_outcome[^;]*TO erp_api/);
 assert.match(sql,/ON CONFLICT \(event_key\) DO NOTHING/);
});
