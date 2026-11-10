// Document review screen (build 2740): state badges, review history, grants, the scan stub answer and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {reviewView,grantsCardView,stateBadge,STATE_TEXT,SCAN_TEXT,DECISION_OPTIONS} from '../staff-document-review.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {STAFF_RIGHTS} from '../staff-rights-catalog.mjs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const button=(a,l,id)=>`<button data-suite="${a}" data-id="${id}">${l}</button>`;
const doc={document_id:'d1',file_name:'Return <ack>.pdf',category:'Tax Returns',version:1,uploader:'Sam Supervisor',uploaded_at:'2026-11-10T08:00:00Z',uploaded_by:'u-sup',sha256:'a'.repeat(64)};
const base=(o={})=>({document:doc,state:'NOT_REVIEWED',reviews:[],grants:[],scans:[],can:{review:true,grant:true,scan:true},...o});

test('state badge says what the file is and who decided',()=>{
 assert.match(stateBadge('NOT_REVIEWED'),/Not reviewed/);
 assert.match(stateBadge('APPROVED','Mary Manager'),/Approved.*by Mary Manager/);
 assert.deepEqual(Object.keys(STATE_TEXT),['NOT_REVIEWED','APPROVED','CHANGES_REQUESTED','REJECTED']);
 assert.deepEqual(DECISION_OPTIONS.map(x=>x[0]),['APPROVED','CHANGES_REQUESTED','REJECTED']);
});
test('review screen: buttons follow the role, text is escaped, history and scan are shown',()=>{
 const me={staff_id:'u-mgr',category_code:'MANAGER'};
 const h=reviewView({r:base({reviews:[{reviewer:'Mary',decision:'APPROVED',comment:'Checked <b>everything</b>',reviewed_at:'2026-11-10T09:00:00Z',current_file:true},{reviewer:'Paul',decision:'CHANGES_REQUESTED',comment:'Older note about page two',reviewed_at:'2026-11-09T09:00:00Z',current_file:false}],state:'APPROVED',scans:[{status:'PENDING_MANUAL_REVIEW',requested_at:'2026-11-10T09:30:00Z',current_file:true}]}),me,button});
 assert.match(h,/Return &lt;ack&gt;\.pdf/);assert.doesNotMatch(h,/<ack>/);assert.match(h,/Checked &lt;b&gt;everything&lt;\/b&gt;/);
 assert.match(h,/an earlier file/);assert.match(h,/Scan pending manual review/);assert.match(h,/No scanning service is connected yet/);
 for(const a of ['docrev-decide','docrev-scan','docrev-grant'])assert.match(h,new RegExp(a));
 const sup=reviewView({r:base({can:{review:true,grant:false,scan:true}}),me:{staff_id:'u-x',category_code:'SUPERVISOR'},button});
 assert.doesNotMatch(sup,/docrev-grant|Time-limited access/,'only a Manager or Partner sees the grant section');
 const own=reviewView({r:base({can:{review:false,grant:false,scan:true}}),me:{staff_id:'u-sup',category_code:'SUPERVISOR'},button});
 assert.doesNotMatch(own,/docrev-decide/);assert.match(own,/You uploaded this file/,'the uploader is told why there is no review button');
});
test('grants: live ones can be withdrawn, withdrawn and expired ones cannot',()=>{
 const future=new Date(Date.now()+5*86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
 const g=(id,o)=>({grant_id:id,grantee:'Ann Assistant',granted_by:'Mary',reason:'Prepare the KRA reply',granted_at:past,expires_at:future,revoked_at:null,...o});
 const h=reviewView({r:base({grants:[g('g1',{}),g('g2',{revoked_at:past,revoke_reason:'Query closed for good'}),g('g3',{expires_at:past})]}),me:{staff_id:'u-mgr',category_code:'MANAGER'},button});
 assert.match(h,/data-id="g1"/);assert.doesNotMatch(h,/data-id="g2"/);assert.doesNotMatch(h,/data-id="g3"/);
 assert.match(h,/Withdrawn/);assert.match(h,/Expired/);assert.match(h,/at most 30 days|up to 30 days/);
});
test('"shared with you" card lists only what exists and links to the normal download',()=>{
 assert.equal(grantsCardView({grants:[],button}),'');
 const h=grantsCardView({grants:[{document_id:'d9',file_name:'Letter.pdf',category:'Tax Returns',reason:'Reply to KRA',granted_by_name:'Mary',expires_at:'2026-11-20T20:59:59Z'}],button});
 assert.match(h,/data-download="d9"/);assert.match(h,/Shared with you for a limited time/);
});
test('wiring: documents screen, suite dispatch, cache busters, server action and rights',()=>{
 const pilot=read('staff-pilot.mjs'),suite=read('staff-suite.mjs'),server=read('supabase/functions/staff-workspace-v12/document-review-actions.ts'),index=read('supabase/functions/staff-workspace-v12/index.ts');
 assert.match(pilot,/data-review-state/);assert.match(pilot,/id="docGrantsCard"/);assert.match(pilot,/docrev-open/);assert.match(pilot,/suite\.docReview\.paintStates\(\)/);
 assert.match(suite,/createDocumentReviewUI/);assert.match(suite,/docReview\.handle\(action,id\)/);
 assert.match(index,/documentReviewAction/);
 assert.match(server,/PENDING_MANUAL_REVIEW/);assert.match(server,/provider:null/);assert.doesNotMatch(server,/virustotal\.com|guardduty\.amazonaws/i,'no scanner is called yet');
 assert.equal(areaForStaffAction('evidence_scan'),'documents','the scan request is a Documents-area action');
 assert.equal(areaForStaffAction('document_grant_add'),'documents');
 const codes=Object.fromEntries(STAFF_RIGHTS.map(r=>[r.code,r]));
 assert.deepEqual(codes['document.grant'].roles,['PARTNER','MANAGER']);assert.ok(!codes['document.review'].roles.includes('ASSISTANT'));
 assert.equal(read('staff-rights-catalog.mjs'),read('supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs'));
 for(const f of ['staff-pilot.mjs','staff-suite.mjs'])assert.match(read(f),/20261110-taxlead-v1/);
 assert.equal(SCAN_TEXT.PENDING_MANUAL_REVIEW,'Scan pending manual review');
});
