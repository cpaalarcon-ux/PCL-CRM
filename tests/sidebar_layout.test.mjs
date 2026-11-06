import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const html = read('staff-pilot.html');
const css = read('staff-pilot.css');
const app = read('staff-pilot.mjs');
const dom = new JSDOM(html);

test('one shared sidebar wraps every staff workspace section', () => {
  const document = dom.window.document;
  const workspace = document.querySelector('#workspace');
  const sidebar = workspace.querySelector(':scope > aside#workspaceSidebar');
  const content = workspace.querySelector(':scope > .workspace-main');
  assert.ok(sidebar, 'workspace has a dedicated navigation sidebar');
  assert.equal(sidebar.querySelector('#nav')?.tagName, 'NAV');
  assert.ok(sidebar.querySelector('.sidebar-brand'));
  assert.ok(content?.contains(document.querySelector('#firmFilter')));
  assert.ok(content?.contains(document.querySelector('#workspaceSearch')));
  assert.ok(content?.contains(document.querySelector('#content')));
  assert.ok(content?.contains(document.querySelector('#presenceHub')));
  assert.equal(workspace.querySelectorAll('#nav').length, 1);
  assert.match(app, /function render\(\)\{[\s\S]*?nav\(\);/);
});

test('sidebar retains permission-filtered areas and the More accordion', () => {
  for (const label of ['Clients', 'Projects & tasks', 'Time & HR', 'Documents', 'Comms', 'Audit & assurance', 'Billing & WIP', 'Staff & access', 'Settings']) {
    assert.ok(app.includes(label), `navigation catalog includes ${label}`);
  }
  assert.match(app, /filter\(\(\[, ,area\]\)=>canArea\(area\)\)/);
  assert.match(app, /<details class="nav-more"><summary/);
  assert.match(app, /navElement\.addEventListener\('click'/);
});

test('sidebar is vertical on desktop and collapsible on small screens', () => {
  assert.match(css, /grid-template-columns:252px minmax\(0,1fr\)/);
  assert.match(css, /#workspace nav#nav\{[^}]*flex-direction:column/);
  assert.match(css, /@media\(max-width:950px\)[\s\S]*?\.workspace-sidebar\{position:fixed/);
  assert.match(css, /\.nav-toggle\{display:inline-flex/);
  assert.match(html, /id="navToggle"[^>]*aria-controls="workspaceSidebar"/);
  assert.match(html, /id="navScrim"[^>]*aria-label="Close navigation"/);
  assert.match(app, /window\.matchMedia\('\(max-width: 950px\)'\)/);
});
