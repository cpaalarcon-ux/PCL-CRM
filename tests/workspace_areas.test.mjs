import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('staff-pilot.html');
const css = read('staff-pilot.css');
const app = read('staff-pilot.mjs');
const dashboard = read('staff-dashboard.mjs');
const uat = read('supabase/FULL_ERP_STAFF_UAT.md');
const alignment = read('supabase/ERP_ALIGNMENT_CONTROL.md');
const dom = new JSDOM(html);

test('the signed-in workspace has no sidebar and keeps the shared workspace shell', () => {
  const document = dom.window.document;
  const workspace = document.querySelector('#workspace');
  assert.ok(workspace.querySelector(':scope > .workspace-main'));
  assert.equal(workspace.querySelectorAll('aside, #workspaceSidebar, #navScrim').length, 0);
  assert.ok(workspace.querySelector('.workspace-brand'));
  assert.ok(workspace.querySelector('#areasHome[data-view="home"]'));
  assert.ok(workspace.querySelector('#firmFilter'));
  assert.ok(workspace.querySelector('#workspaceSearch'));
  assert.ok(workspace.querySelector('#content'));
  assert.ok(workspace.querySelector('#presenceHub'));
  assert.ok(workspace.querySelector('#areasLauncher[hidden] #nav[aria-label="Workspace areas"]'));
});

test('the Home launcher lists integrated areas and filters by server-provided access areas', () => {
  assert.doesNotMatch(css, /workspace-sidebar|workspace-nav-open|navScrim|navToggle|nav-more|erp-area-grid|erp-module|home-areas/);
  for (const label of ['Clients', 'Projects & tasks', 'Time & HR', 'Documents', 'Comms', 'Audit & assurance', 'Billing & WIP', 'Staff & access', 'Settings', 'Leads']) {
    assert.ok(app.includes("title:'" + label + "'"), 'launcher catalog includes ' + label);
  }
  assert.match(app, /catalog\.filter\(item=>canArea\(item\.area\)\)/);
  assert.match(app, /const canArea=area=>!!data&&/);
  assert.match(app, /const allowed=\['home'\]/);
  assert.doesNotMatch(dashboard, /home-areas|erp-module|ERP areas/);
  assert.match(app, /staff-dashboard\.mjs\?v=20261106-workspace-areas-v3/);
});

test('areas route through the existing ERP views and the topbar button returns Home', () => {
  assert.match(html, /id="areasHome"[^>]*data-view="home"/);
  assert.match(app, /if\(b\.dataset\.view\)[\s\S]{0,150}navigateWorkspace\(b\.dataset\.view\)/);
  assert.match(app, /\$\('#areasLauncher'\)\.hidden=view!=='home'/);
  assert.doesNotMatch(app, /workspace-nav-open|workspaceSidebar|navScrim|navToggle/);
});

test('the area grid uses six desktop, three tablet, and two mobile columns', () => {
  assert.match(css, /#workspace nav#nav\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:1050px\)[\s\S]*?#workspace nav#nav\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media\(max-width:600px\)[\s\S]*?#workspace nav#nav\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.workspace-area-card:hover\{transform:translateY\(-2px\)/);
  assert.match(css, /\.workspace-area-card:focus-visible\{/);
});

test('release documents separate automated launcher passes from pending manual role acceptance', () => {
  assert.match(uat, /^\| U71 \| Release identity \|.*\| Automated pass: hosted run .*staff role evidence still pending \|$/m);
  assert.match(uat, /^\| U77 \| Workspace-area launcher and role access \|.*\| Automated launcher flow passed .*direct-route checks remain Not checked \|$/m);
  assert.match(uat, /^\| U78 \| Visual launcher and navigation regression.*\| Automated regression passed .*manual viewport, keyboard and staff-workflow checks remain Not checked \|$/m);
  assert.doesNotMatch(uat, /\| U77 \| Shared sidebar navigation/);
  assert.match(alignment, /Current staging alignment — Workspace-area launcher \(build 2026-11-06\.75\)/);
  assert.match(alignment, /The runtime candidate verified by the exact success runs below/);
  assert.match(alignment, /U77\/U78 remain \*\*Not checked\*\*/);
  assert.match(alignment, /Production remains held/);
});
