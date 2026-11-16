// Build 2852: Documents. Row actions grouped under one More menu; the wrong-file note folded. Layout only: same buttons, handlers and role rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const pilot=rd('staff-pilot.mjs'),css=rd('staff-pilot.css');
const cell=pilot.match(/<td><div class="actions"><button data-download="\$\{d\.document_id\}">Download<\/button>([^]*?)<\/div><\/td><\/tr>`;\}\)\.join/)[1];

test('Download stays in view; the other four actions sit in one More menu',()=>{
 assert.match(cell,/<details class="cc-more cc-more-wide">/);
 for(const needle of ["suite.button('docrev-open','Review & access',d.document_id)","suite.button('incoming-links','Linked records',d.document_id)",'data-v6="import" data-id="${d.document_id}">Review source','class="danger" data-archive-source="${d.document_id}">Remove upload'])assert.ok(cell.includes(needle),needle);
 assert.ok(cell.indexOf('<details')<cell.indexOf('docrev-open'),'the four are inside the menu');
 assert.match(cell,/\.filter\(Boolean\)/,'a row with nothing extra draws no menu');
});

test('the role rules on each moved action are unchanged',()=>{
 assert.match(cell,/!archivedView&&!\['INTERN','ADMIN'\]\.includes\(data\.me\.category_code\)\?suite\.button\('docrev-open'/);
 assert.match(cell,/\['PARTNER','MANAGER','SUPERVISOR'\]\.includes\(data\.me\.category_code\)&&!imported\?suite\.button\('incoming-links'/);
 assert.match(cell,/d\.project_id&&\/\\\.\(xlsx\|csv\|zip\)\$\/i\.test\(d\.file_name\)&&data\.me\.category_code!=='INTERN'/);
 assert.match(cell,/canArchive\?`<button type="button" class="danger" data-archive-source/);
 assert.match(pilot,/canArchive=!archivedView&&imported&&data\.me\.category_code!=='INTERN'&&\(isLeader\(\)\|\|d\.uploaded_by===data\.me\.staff_id\)/);
});

test('the wrong-file note is folded, not removed, and the table is not clipped',()=>{
 assert.match(pilot,/<details class="doc-note"><summary>Uploaded the wrong file\?<\/summary><p class="muted">If you uploaded the wrong file/);
 assert.match(pilot,/<div class="scroll doc-roster"><table data-views="Category">/);
 assert.match(css,/\.staff-roster,\.doc-roster\{overflow:visible\}/);assert.match(css,/\.doc-note>summary/);
});

test('the Incoming review card and the document handlers are untouched',()=>{
 assert.match(pilot,/incomingCardHtml\(data\.me,suite\.button\)\+'<div id="docGrantsCard"><\/div>'/);
 assert.match(pilot,/data-review-state="\$\{d\.document_id\}"/);
});

// Build 2853: Home. Practice figures (Managers and Partners) folded; every action list stays open and visible.
test('Home: Practice metrics sit in a closed fold for Managers and Partners only, with the same id for the painter',()=>{
 const dash=rd('staff-dashboard.mjs');
 assert.match(dash,/\['PARTNER','MANAGER'\]\.includes\(role\)\?'<details class="settings-fold home-fold" id="homeMetricsFold"><summary>Practice figures<\/summary><section id="homeMetrics" aria-live="polite">/);
 assert.doesNotMatch(dash.match(/id="homeMetricsFold"[^]*?<\/details>/)[0],/ open/,'closed by default');
 for(const id of ['homePool','homeHandovers','homeMyReviews','homeQueue','homePartnerEscalations'])assert.ok(dash.includes(`id="${id}"`),id+' is still drawn open');
 assert.match(rd('staff-pilot.mjs'),/staff-dashboard\.mjs\?v=20261120-home-v1/);
});
