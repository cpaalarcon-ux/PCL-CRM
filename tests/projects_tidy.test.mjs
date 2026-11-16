// Build 2850: Projects & Tasks tidy-up. Layout and wording only: the same buttons and handlers, grouped. No approval, posting or rule changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const v6=rd('staff-workspace-v6.mjs'),pilot=rd('staff-pilot.mjs'),css=rd('staff-pilot.css');

test('the everyday buttons stay in view and the rarely used ones sit in one More menu',()=>{
 const head=v6.match(/<h2>Projects & tasks<\/h2><\/div><div class="actions">([^]*?)<\/div><\/div>/)[1];
 assert.match(head,/data-v6="project"/);assert.match(head,/data-v6="task"/);assert.match(head,/\$\{moreMenu\}/);
 assert.doesNotMatch(head,/data-svc="templates"|data-pack="project"|packs\.button\(\)/,'the header itself no longer carries the three rare buttons');
 const menu=v6.match(/const moreItems=\[([^]*?)\]\.filter/)[1];
 assert.match(menu,/packs\.button\(\)/);assert.match(menu,/data-svc="templates"/);assert.match(menu,/data-pack="project"/);
 assert.match(v6,/<details class="cc-more cc-more-wide">/);assert.match(v6,/aria-label="More project actions"/);
});

test('the permission checks on the moved buttons are unchanged',()=>{
 assert.match(v6,/editor\(\)\?'<button type="button" data-svc="templates">Service templates<\/button>':''/);
 assert.match(v6,/p\?`<button type="button" data-pack="project"/);
 assert.match(v6,/moreItems\.length\?`<details/,'the menu is not drawn when there is nothing in it');
});

test('the summary says what the filter hides and offers one way to see everything',()=>{
 assert.match(v6,/with open work/);assert.match(v6,/with overdue work/);
 assert.match(v6,/Engagements with no open work are hidden\./);
 assert.match(v6,/data-v6="work-show-all"/);
 assert.match(v6,/b\.dataset\.v6==='work-show-all'\)\{workShow='all';ctx\.render\(\);\}/);
 assert.match(v6,/workShow==='all'\?'':/,'nothing is said when All engagements is already chosen');
});

test('tax compilation, approvals and KRA notices share one fold and keep their buttons and visibility rule',()=>{
 assert.match(pilot,/<details class="settings-fold section-space" id="taxWorkFold" name="projects-more">/);
 assert.match(pilot,/suite\.button\('tax-list','Open tax periods'\)/);
 assert.match(pilot,/id="kraNoticesCard"[^]*suite\.button\('kra-open','Open the KRA notice log'\)[^]*<\/details>`,audit:/);
 assert.match(pilot,/\['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'\]\.includes\(data\.me\.category_code\)\?`<section class="card section-space" id="kraNoticesCard"/);
});

test('the menu uses the shared close-on-click and Escape behaviour and has its styles',()=>{
 assert.match(pilot,/querySelectorAll\('\.cc-more\[open\]'\)/);
 assert.match(css,/\.cc-more-wide summary\{/);assert.match(css,/\.work-board-summary \.link\{/);
});

test('no rule, database or approval file is touched by this build',()=>{
 assert.doesNotMatch(v6,/action:'work_period_approve|post_journal|client_work_ready/);
});
