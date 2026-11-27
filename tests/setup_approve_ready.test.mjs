import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {planApproveReady,planApproveOnce} from '../supabase/functions/staff-workspace-v12/setup-review-rules.mjs';
import {queueHtml,readyHtml,readyDoneHtml} from '../staff-setup-review.mjs';
import {queueHtml as tasksHtml} from '../staff-setup-tasks.mjs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const esc=v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),shortDate=v=>String(v||'').slice(0,10);
const row=(o={})=>({client_id:'c1',company_name:'Mto Traders',section_code:'ownership',content_digest:'d1',now_digest:'d1',submitted_by:'liz',source_kind:'Permanent file',section_id:'s1',...o});

test('approve all ready: unchanged sections sent by someone else are ready',()=>{
 const r=planApproveReady([row(),row({section_id:'s2',section_code:'contacts'})],{staff_id:'partner'});
 assert.equal(r.ready.length,2);assert.equal(r.left.length,0);
});
test('approve all ready: a section edited after it was sent is left for a person',()=>{
 const r=planApproveReady([row({now_digest:'d2'})],{staff_id:'partner'});
 assert.equal(r.ready.length,0);assert.match(r.left[0].reason,/Edited after it was sent/);
});
test('approve all ready: your own sections are left unless you are the only Partner',()=>{
 assert.equal(planApproveReady([row({submitted_by:'partner'})],{staff_id:'partner'}).ready.length,0);
 assert.match(planApproveReady([row({submitted_by:'partner'})],{staff_id:'partner'}).left[0].reason,/You sent this/);
 assert.equal(planApproveReady([row({submitted_by:'partner'})],{staff_id:'partner',sole:true}).ready.length,1);
});
test('approve all ready: an edited section stays blocked even for the only Partner',()=>{
 assert.equal(planApproveReady([row({submitted_by:'partner',now_digest:'x'})],{staff_id:'partner',sole:true}).ready.length,0);
});

const sec=(o={})=>({section_id:'s1',section_code:'ownership',status:'Pending Review',content_digest:'a',submitted_by:'sheila',source_kind:'Permanent file',...o});
test('approve once: a pending, untouched section the change reached is approved with the change',()=>{
 const r=planApproveOnce({before:{ownership:'a',contacts:'k'},after:{ownership:'b',contacts:'k'},sections:[sec(),sec({section_id:'s2',section_code:'contacts',content_digest:'k'})],approver:'liz'});
 assert.deepEqual(r.map(x=>[x.section_code,x.digest]),[['ownership','b']]);
});
test('approve once: nothing is approved when another proposal for the client is still open',()=>{
 assert.equal(planApproveOnce({before:{ownership:'a'},after:{ownership:'b'},sections:[sec()],approver:'liz',otherOpenProposals:true}).length,0);
});
test('approve once: a section edited after it was sent is not approved',()=>{
 assert.equal(planApproveOnce({before:{ownership:'z'},after:{ownership:'b'},sections:[sec({content_digest:'a'})],approver:'liz'}).length,0);
});
test('approve once: the approver does not approve a section they sent, unless the only Partner',()=>{
 assert.equal(planApproveOnce({before:{ownership:'a'},after:{ownership:'b'},sections:[sec({submitted_by:'liz'})],approver:'liz'}).length,0);
 assert.equal(planApproveOnce({before:{ownership:'a'},after:{ownership:'b'},sections:[sec({submitted_by:'liz'})],approver:'liz',sole:true}).length,1);
});
test('approve once: a section the change did not reach, or one not pending, is left alone',()=>{
 assert.equal(planApproveOnce({before:{ownership:'a'},after:{ownership:'a'},sections:[sec()],approver:'liz'}).length,0);
 assert.equal(planApproveOnce({before:{ownership:'a'},after:{ownership:'b'},sections:[sec({status:'Approved'})],approver:'liz'}).length,0);
});

test('queue screen: the only Partner may tick their own sections; others may not',()=>{
 const q=sole=>({sole_partner:sole,total:1,clients:[{client_id:'c1',company_name:'A',sections:[{code:'ownership',label:'Owners',mine:true,source_kind:'Permanent file',submitted_by_name:'Me',submitted_at:'2026-11-27'}]}]});
 assert.match(queueHtml(q(false),{esc,shortDate}),/data-pick="c1\|ownership" disabled/);
 assert.doesNotMatch(queueHtml(q(true),{esc,shortDate}),/data-pick="c1\|ownership" disabled/);
 assert.match(queueHtml(q(true),{esc,shortDate}),/Approve all ready/);
});
test('to-do list: the Approve all ready button is shown to Managers and Partners only',()=>{
 const res=leader=>({tasks:[],clients_checked:1,clients_with_tasks:0,leader});
 assert.match(tasksHtml(res(true),{esc}),/data-v3="setup-approve-ready"/);
 assert.doesNotMatch(tasksHtml(res(false),{esc}),/setup-approve-ready/);
});
test('preview lists what is left and keeps Approve disabled until it is checked',()=>{
 const h=readyHtml({ready:3,clients:2,left:[{company_name:'B',label:'Owners',reason:'Edited after it was sent.'}],sole_partner:false},{esc});
 assert.match(h,/Left for a person \(1\)/);assert.match(h,/id="readyApply" disabled/);assert.match(h,/I have checked this list/);
 assert.match(readyHtml({ready:0,left:[]},{esc}),/Nothing is ready/);
 assert.match(readyDoneHtml({approved:3,clients:2,left:[]},{esc}),/Approved <b>3<\/b>/);
});
test('wiring: the server action exists, is leader-only, defaults to a dry run and needs a note to apply',()=>{
 const s=rd('supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');
 assert.match(s,/'client_setup_section_approve_ready'/);
 assert.match(s,/approve_ready'\)\{\s*if\(!LEADERS\.includes/);
 assert.match(s,/const apply=p\.dry_run===false/);assert.match(s,/at least 10 characters/);
 const p=rd('supabase/functions/staff-workspace-v12/proposal-actions.ts');
 assert.match(p,/planApproveOnce/);assert.match(p,/sections_approved/);
 assert.match(rd('staff-improvements.mjs'),/a==='setup-approve-ready'/);
});
