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

test('the signed-in workspace has a fixed sidebar beside the shared workspace shell', () => {
  const document = dom.window.document;
  const workspace = document.querySelector('#workspace');
  assert.ok(workspace.querySelector(':scope > .workspace-main'));
  assert.ok(workspace.querySelector(':scope > aside#workspaceSidebar.workspace-sidebar nav#sideNav'));
  assert.ok(workspace.querySelector(':scope > aside .sidebar-brand .mark'));
  assert.equal(workspace.querySelector(':scope > aside').nextElementSibling, workspace.querySelector(':scope > .workspace-main'));
  assert.equal(workspace.querySelectorAll('#navScrim').length, 0);
  assert.ok(workspace.querySelector('#areasHome[data-view="home"]'));
  assert.ok(workspace.querySelector('#firmFilter'));
  assert.ok(workspace.querySelector('#workspaceSearch'));
  assert.ok(workspace.querySelector('#content'));
  assert.ok(workspace.querySelector('#presenceHub'));
  assert.ok(workspace.querySelector('#areasLauncher[hidden] #nav[aria-label="Workspace areas"]'));
});

test('the Home launcher lists integrated areas and filters by server-provided access areas', () => {
  assert.doesNotMatch(css, /workspace-nav-open|navScrim|navToggle|nav-more|erp-area-grid|erp-module|home-areas/);
  for (const label of ['Clients', 'Projects & Tasks', 'Time & Attendance', 'Documents', 'Communications Hub', 'Audit & assurance', 'Finance & Reports', 'Staff & access', 'Settings', 'Leads & Pipeline']) {
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
  assert.doesNotMatch(app, /workspace-nav-open|navScrim|navToggle/);
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

test('the sidebar keeps the original dark-green identity through named colour tokens', () => {
  const root = css.match(/:root\{([^}]*)\}/)[1];
  for (const token of ['--green:#0b3d2e', '--gold:#d4af37', '--navy:#1e3a8a', '--sidebar:#0a3d2c', '--sidebar-text:', '--sidebar-muted:', '--sidebar-line:', '--sidebar-hover:', '--sidebar-active:', '--sidebar-active-text:']) {
    assert.ok(root.includes(token), 'palette keeps ' + token);
  }
  const rule = name => css.match(new RegExp('(?:^|\\n)' + name.replace(/[.#\[\]=()]/g, '\\$&') + '\\{([^}]*)\\}'))?.[1] || '';
  assert.match(rule('.workspace-sidebar'), /background:var\(--sidebar\)/);
  assert.match(rule('.workspace-sidebar'), /color:var\(--sidebar-text\)/);
  assert.match(rule('.sidebar-nav .side-item[aria-current=page]'), /background:var\(--sidebar-active\)/);
  const outsideRoot = css.replace(/:root\{[^}]*\}/, '');
  assert.doesNotMatch(outsideRoot, /#0a3d2c/i, 'the sidebar hex lives only in :root');
  const tones = [...css.matchAll(/\.tone-([a-z]+) \.workspace-area-icon\{background:(#[0-9a-f]{6});color:(#[0-9a-f]{6})\}/g)].map(m => m[1]);
  assert.deepEqual(tones, ['green', 'blue', 'amber', 'violet', 'teal', 'rose', 'orange', 'cyan', 'slate', 'purple']);
});

test('the sidebar is built from the same permission-filtered catalog as the launcher', () => {
  assert.match(app, /by=v=>catalog\.find\(item=>item\.view===v&&canArea\(item\.area\)\)/);
  assert.match(app, /sideItems=\[\{view:'home',title:'Home',icon:'⌂',subs:\[\]\}/);
  assert.match(app, /\$\('#sideNav'\)\.innerHTML=sideItems\.map/);
  assert.match(html, /<aside id="workspaceSidebar"[^>]*aria-label="Main navigation">/);
  assert.match(css, /@media\(max-width:850px\)\{\s*body\.workspace-active>main>#workspace\{flex-direction:column\}/);
});
