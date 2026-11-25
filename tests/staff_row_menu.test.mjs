// Build 2851: Staff & access roster. Row actions grouped into one More menu. Layout only: same buttons, same handlers, same permission rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const pilot=rd('staff-pilot.mjs'),css=rd('staff-pilot.css');
const row=pilot.match(/s\.staff_id!==data\.me\.staff_id\?`<div class="actions">([^]*?)<\/div><\/details><\/div>`:'Your account'/);

test('each staff row keeps Edit access in view and puts the other two actions in a More menu',()=>{
 assert.ok(row,'the actions cell is built as one visible button plus one menu');
 const cell=row[1];
 assert.match(cell,/^<button data-rights="\$\{s\.staff_id\}">Edit access<\/button><details class="cc-more cc-more-wide">/);
 const menu=cell.slice(cell.indexOf('<div class="cc-menu"'));
 assert.match(menu,/data-link="\$\{s\.staff_id\}">\$\{s\.access_status==='Active'\?'Reset password':'Generate login link'\}/);
 assert.match(menu,/class="danger" data-disable="\$\{s\.staff_id\}">Disable access/);
 assert.doesNotMatch(cell.slice(0,cell.indexOf('<details')),/data-link|data-disable/,'nothing else sits beside Edit access');
});

test('your own row still shows no actions, and the handlers are unchanged',()=>{
 assert.match(pilot,/:'Your account'\}<\/td>/);
 assert.match(pilot,/if\(b\.dataset\.link\)await credentials\(b\.dataset\.link\)/);
 assert.match(pilot,/if\(b\.dataset\.disable\)\{const id=b\.dataset\.disable;modal\('Disable staff access'/);
 assert.match(pilot,/action:'staff_disable'/);assert.match(pilot,/Confirm disable/,'disabling still needs a confirmation');
 assert.match(pilot,/if\(b\.dataset\.rights\)await editStaffAccess/);
});

test('the menu names the person for screen readers and is not clipped by the table wrapper',()=>{
 assert.match(pilot,/aria-label="More actions for \$\{esc\(s\.full_name\)\}"/);
 assert.match(pilot,/<div class="scroll staff-roster"><table data-views="ERP role" aria-label="Staff roster">/);
 assert.match(css,/\.staff-roster,\.doc-roster\{overflow:visible\}/);assert.match(css,/\.cc-menu button\.danger\{/);
});

test('this build touches no server, approval or database file',()=>{
 assert.doesNotMatch(pilot.match(/function staff\(\)\{[^]*?\n/)[0],/request\(/);
});
