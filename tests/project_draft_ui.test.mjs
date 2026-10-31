import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const projectUi=fs.readFileSync(new URL('../staff-workspace-v6.mjs',import.meta.url),'utf8');
const appHtml=fs.readFileSync(new URL('../staff-pilot.html',import.meta.url),'utf8');

test('draft project explains that retained UAT tasks do not mean the project is active',()=>{
 assert.match(projectUi,/Schedule configured · task release held/);
 assert.match(projectUi,/Earlier UAT carry-over/);
 assert.match(projectUi,/Draft project:<\/b> the schedule is saved, but no new tasks are released/);
 assert.match(projectUi,/Existing UAT tasks remain visible from earlier testing but do not make this draft project active/);
 assert.match(projectUi,/financial outputs are not ready/);
});

test('staging build cache key changes with the setup guide',()=>{
 assert.match(appHtml,/2026-10-31\.6/);
 assert.match(appHtml,/20261031-setup-guide-v1/);
});
