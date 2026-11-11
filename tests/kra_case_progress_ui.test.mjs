// KRA case upgrades, first slice (build 2782): the stage, the submission details, the timeline, the missing-documents list, the KPI cards and the wiring.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {caseView,listView,progressPanel,timelineView,missingView,dashboardView,FLAG_NAMES,OPEN_STAGES,SUBMITTED_STAGES,CHANNELS,CONTACT_KINDS} from '../staff-kra.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const button=(a,l,id='',x='')=>`<button data-suite="${a}" data-id="${id}" ${x}>${l}</button>`;
const me=c=>({category_code:c,staff_id:'me'});
const c0={case_id:'c1',status:'Open'};
const pg={stage:'Internal review',stage_changed_at:'2026-11-10T08:00:00Z',submitted_at:null};

test('lists of stages and options match the database',()=>{
 assert.deepEqual(OPEN_STAGES,['Received','Triage','In progress','Internal review','Approved to send']);
 assert.deepEqual(SUBMITTED_STAGES,['Submitted to KRA','Awaiting KRA','Further information requested','Dispute or appeal','Resolved']);
 assert.deepEqual(CHANNELS,['iTax portal','Email','Hand delivery','Courier','Other']);assert.deepEqual(CONTACT_KINDS,['Email','Call','Meeting','Letter','Note']);
 assert.equal(FLAG_NAMES.E,'Partner alert: deadline approaching');
 const sql=rd('supabase/migrations/20261111030000_kra_case_progress.sql');
 for(const s of [...OPEN_STAGES,...SUBMITTED_STAGES,...CHANNELS,...CONTACT_KINDS])assert.ok(sql.includes("'"+s+"'"),s+' is in the migration');
});

test('progress panel: stage, submission details and the acknowledgment',()=>{
 let h=progressPanel({c:c0,pg,me:me('ASSISTANT'),button});
 assert.match(h,/id="kraStage"[^]*Internal review[^]*data-suite="kra-stage"/);assert.doesNotMatch(h,/kraSubmission/);
 h=progressPanel({c:{case_id:'c1',status:'Responded'},pg:{...pg,stage:'Submitted to KRA',submitted_at:'2026-11-10T09:30:00Z',submission_channel:'iTax portal',submission_reference:'ITAX-ACK-1<x>'},me:me('MANAGER'),button});
 assert.match(h,/id="kraSubmission"[^]*iTax portal[^]*ITAX-ACK-1&lt;x&gt;[^]*not saved yet[^]*Save the acknowledgment/);assert.doesNotMatch(h,/<x>/);
 h=progressPanel({c:{case_id:'c1',status:'Responded'},pg:{...pg,submitted_at:'2026-11-10T09:30:00Z',submission_channel:'Email',submission_reference:'R-1',ack_file_name:'ack.pdf'},me:me('MANAGER'),button});
 assert.match(h,/ack\.pdf[^]*Change acknowledgment/);
 assert.doesNotMatch(progressPanel({c:{case_id:'c1',status:'Closed'},pg:{...pg,stage:'Resolved'},me:me('PARTNER'),button}),/data-suite="kra-stage"/,'a closed case has no stage control');
 assert.equal(progressPanel({c:c0,pg:null,me:me('MANAGER'),button}),'');
});

test('timeline: newest first, escaped, and only open cases can add',()=>{
 const ev=[{happened_at:'2026-11-09T08:00:00Z',kind:'Status',recorded_by_name:'Ann',summary:'Case logged'},{happened_at:'2026-11-10T08:00:00Z',kind:'Call',recorded_by_name:'Ben',summary:'Rang <b>KRA</b>',participants:'Ms Fictional'}];
 const h=timelineView({events:ev,button,c:c0});
 assert.match(h,/Timeline and contact log \(2\)/);assert.match(h,/data-suite="kra-contact"/);assert.ok(h.indexOf('Rang')<h.indexOf('Case logged'),'newest first');
 assert.match(h,/Rang &lt;b&gt;KRA&lt;\/b&gt;/);assert.doesNotMatch(h,/<b>KRA/);assert.match(h,/With Ms Fictional/);assert.match(h,/only added to/);
 assert.doesNotMatch(timelineView({events:ev,button,c:{case_id:'c1',status:'Closed'}}),/kra-contact/);
 assert.match(timelineView({events:[],button,c:c0}),/Nothing recorded yet/);
});

test('missing documents, KPI cards and the register',()=>{
 const m=missingView([{description:'Ledger <2025>',needed_by:'2026-11-20'}],'KRA/1',button);
 assert.match(m,/id="kraMissing"[^]*Ledger &lt;2025&gt;[^]*needed by 2026-11-20/);assert.match(missingView([],'KRA/1',button),/Nothing is missing/);
 const d=dashboardView({overdue:1,due_soon:2,unassigned:3,missing_documents:4,awaiting_kra:5,escalation_days:7});
 assert.match(d,/id="kraDashboard"[^]*Overdue[^]*Due soon \(within 7 days\)[^]*Unassigned[^]*Missing documents[^]*Awaiting KRA/);assert.equal(dashboardView(null),'');
 const list=listView({r:{cases:[{case_id:'c1',client_name:'A',notice_reference:'R1',notice_type:'Audit notice',tax_head:'VAT',period_start:'2025-01-01',period_end:'2025-12-31',deadline_date:'2026-11-20',days_left:5,status:'Open',stage:'Triage',open_flags:'C',missing_requests:2}]},me:me('MANAGER'),button,status:null,db:{overdue:0,due_soon:1,unassigned:0,missing_documents:2,awaiting_kra:0,escalation_days:7}});
 assert.match(list,/kraDashboard/);assert.match(list,/Triage/);assert.match(list,/data-suite="kra-missing"[^>]*>2 documents missing/);
});

test('case view uses the submission wording and shows the progress panel',()=>{
 const r={case:{case_id:'c1',client_id:'k',client_name:'A',notice_reference:'R1',notice_type:'Audit notice',tax_head:'VAT',period_start:'2025-01-01',period_end:'2025-12-31',notice_date:'2026-11-01',received_on:'2026-11-01',deadline_date:'2026-11-20',days_left:9,status:'Open',summary:'S',revision:1},task:null,requests:[],flags:[],documents:[],projects:[],progress:pg,events:[]};
 const h=caseView({r,me:me('MANAGER'),button});
 assert.match(h,/kraStage/);assert.match(h,/Mark as submitted to KRA/);assert.doesNotMatch(h,/Mark as responded/);
});

test('wiring: handlers, cache buster and the build label',()=>{
 const k=rd('staff-kra.mjs');
 for(const a of ['kra-respond','kra-missing','kra-stage','kra-ack','kra-contact'])assert.ok(k.includes("'"+a+"'"),a+' is handled');
 assert.match(rd('staff-suite.mjs'),/staff-kra\.mjs\?v=20261111-kraprog-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/release.json'),/2026-11-11\.2784/);assert.match(rd('staff-pilot.html'),/2026-11-11\.2784/);
 const sql=rd('supabase/migrations/20261111030000_kra_case_progress.sql');
 assert.doesNotMatch(sql,/ISRS 4000/);assert.doesNotMatch(sql,/DELETE FROM/i);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/kra_/);
});
