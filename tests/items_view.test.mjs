import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ITEM_MODES,ITEM_VIEW_KEY,normalizeMode,loadMode,saveMode,modeSwitch,groupColumns,kanban,listTable} from '../staff-items-view.mjs';

test('only Cards, List and Kanban are valid modes and unknown values fall back to Cards', () => {
  assert.deepEqual(ITEM_MODES.map(m => m[0]), ['cards', 'list', 'kanban']);
  assert.equal(normalizeMode('kanban'), 'kanban');
  for (const bad of [undefined, null, '', 'grid', '<script>']) assert.equal(normalizeMode(bad), 'cards');
});

test('the saved choice is a convenience: storage errors never break the page', () => {
  const store = new Map();
  const ok = {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)};
  saveMode(ok, 'list');
  assert.equal(store.get(ITEM_VIEW_KEY), 'list');
  assert.equal(loadMode(ok), 'list');
  saveMode(ok, 'nonsense');
  assert.equal(loadMode(ok), 'cards');
  const broken = {getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }};
  assert.equal(loadMode(broken), 'cards');
  assert.doesNotThrow(() => saveMode(broken, 'kanban'));
  assert.equal(loadMode(undefined), 'cards');
});

test('the switch marks exactly the active mode and is keyboard reachable', () => {
  const html = modeSwitch('list');
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(html, /data-mode="list"[^>]*aria-pressed="true"/);
  assert.match(html, /role="group" aria-label="Show items as"/);
  assert.equal((html.match(/<button type="button"/g) || []).length, 3);
});

test('kanban columns keep the known order, add unknown values and show empty columns', () => {
  const items = [{id: 1, s: 'Active'}, {id: 2, s: 'Draft'}, {id: 3, s: 'Zeta'}, {id: 4, s: 'Draft'}, {id: 5, s: ''}];
  const cols = groupColumns(items, i => i.s, ['Draft', 'Active', 'Inactive']);
  assert.deepEqual(cols.map(c => [c.name, c.items.length]), [['Draft', 2], ['Active', 1], ['Inactive', 0], ['Other', 1], ['Zeta', 1]]);
  const compact = groupColumns(items, i => i.s, ['Draft', 'Active', 'Inactive'], false);
  assert.deepEqual(compact.map(c => c.name), ['Draft', 'Active', 'Other', 'Zeta']);
  assert.equal(cols.reduce((n, c) => n + c.items.length, 0), items.length, 'no item is dropped');
});

test('kanban and list output escape what they are given by the caller and show counts', () => {
  const esc = v => String(v).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const html = kanban([{name: '<b>Draft</b>', items: [1, 2]}, {name: 'Active', items: []}], n => `<a>${n}</a>`, esc);
  assert.match(html, /&lt;b&gt;Draft&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Draft<\/b>/);
  assert.match(html, /<span>2<\/span>/);
  assert.match(html, /Nothing here/);
  const table = listTable(['Project', 'Status'], [['A', 'Draft'], ['B', 'Active']]);
  assert.equal((table.match(/<tr>/g) || []).length, 3);
  assert.match(table, /<th scope="col">Project<\/th>/);
});

test('the Projects & tasks screen uses the shared switch for projects and tasks', () => {
  const v6 = readFileSync(new URL('../staff-workspace-v6.mjs', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../staff-pilot.css', import.meta.url), 'utf8');
  assert.match(v6, /from '\.\/staff-items-view\.mjs\?v=/);
  assert.match(v6, /modeSwitch\(itemsView,esc\)/);
  assert.match(v6, /dataset\.v6==='items-view'/);
  assert.match(v6, /projectItems\(/);
  assert.match(v6, /normalizeMode\(itemsView\)==='kanban'\?taskKanban\(tasks\):groupedTasks\(tasks\)/);
  assert.match(css, /\.kanban-col>header\{[^}]*background:transparent[^}]*color:var\(--text\)/, 'column headers must not inherit the dark page header');
  for (const rule of ['.items-switch', '.kanban{', '.kanban-col', '.items-table']) assert.ok(css.includes(rule), rule);
});

// ---- record tables (cards, list, vertical Kanban) ----
import {JSDOM} from 'jsdom';
import {applyItemViews,bindItemViews,loadViewMode,saveViewMode,laneName} from '../staff-items-view.mjs';

const memory = () => { const m = new Map(); return {getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v)}; };
const page = (group = 'Status', extra = '') => {
  const dom = new JSDOM(`<main id="content"><div class="scroll"><table data-views="${group}"><thead><tr><th>Item</th><th>Firm</th><th>Status</th><th></th></tr></thead><tbody>
   <tr><td>Alpha</td><td>PCL</td><td><span class="badge">Draft</span></td><td><button id="b1">Open</button></td></tr>
   <tr><td>Beta</td><td></td><td><span class="badge">Posted</span></td><td><button id="b2">Open</button></td></tr>
   <tr><td>Gamma</td><td>ACL</td><td><span class="badge">Draft</span></td><td><button id="b3">Open</button></td></tr></tbody></table></div>${extra}</main>`);
  return {dom, root: dom.window.document.getElementById('content'), doc: dom.window.document};
};

test('list mode keeps the table untouched and shows the switch with all three modes', () => {
  const {root} = page();
  assert.equal(applyItemViews(root, {view: 'clients', storage: memory()}), 1);
  assert.equal(root.querySelectorAll('[data-views-mode]').length, 3);
  assert.equal(root.querySelectorAll('.rv').length, 0);
  assert.equal(root.querySelector('[data-views-mode=list]').getAttribute('aria-pressed'), 'true');
});

test('cards mode relabels cells, hides empty ones and keeps the very same row elements', () => {
  const {root} = page(), store = memory();
  const before = [...root.querySelectorAll('tbody tr')];
  saveViewMode(store, 'clients', 'cards');
  applyItemViews(root, {view: 'clients', storage: store});
  const table = root.querySelector('table');
  assert.ok(table.classList.contains('rv-cards'));
  assert.deepEqual([...root.querySelectorAll('tbody tr')], before, 'rows are not rebuilt or cloned');
  assert.equal(before[0].cells[1].getAttribute('data-label'), 'Firm');
  assert.ok(before[1].cells[1].classList.contains('rv-empty'));
  assert.ok(!before[1].cells[3].classList.contains('rv-empty'), 'a cell with only a button is kept');
  assert.equal(table.getAttribute('role'), 'table');
});

test('kanban mode stacks lanes by the chosen column, keeps every row and its buttons working', () => {
  const {root, doc} = page(), store = memory();
  let clicks = 0;doc.getElementById('b3').addEventListener('click', () => clicks++);
  const rows = new Set(root.querySelectorAll('tbody tr'));
  saveViewMode(store, 'clients', 'kanban');
  applyItemViews(root, {view: 'clients', storage: store});
  const heads = [...root.querySelectorAll('tr.lane-head')];
  assert.deepEqual(heads.map(h => h.textContent.replace(/\s+/g, ' ').trim()), ['Draft2', 'Posted1']);
  const body = [...root.querySelector('tbody').children].map(r => r.classList.contains('lane-head') ? 'H' : r.cells[0].textContent.trim());
  assert.deepEqual(body, ['H', 'Alpha', 'Gamma', 'H', 'Beta']);
  assert.equal([...root.querySelectorAll('tbody tr:not(.lane-head)')].filter(r => rows.has(r)).length, 3);
  doc.getElementById('b3').click();assert.equal(clicks, 1, 'the original button and its listener survive');
});

test('kanban is not offered when the table names no group column or the column is missing', () => {
  for (const group of ['', 'Nonexistent']) {
    const {root} = page(group), store = memory();
    saveViewMode(store, 'clients', 'kanban');
    applyItemViews(root, {view: 'clients', storage: store});
    assert.equal(root.querySelectorAll('[data-views-mode=kanban]').length, 0);
    assert.ok(root.querySelector('table').classList.contains('rv-cards'), 'falls back to cards');
    assert.equal(root.querySelectorAll('tr.lane-head').length, 0);
  }
});

test('tables with merged cells, no rows or no opt-in are left exactly as they are', () => {
  const dom = new JSDOM(`<main id="content"><table data-views="Status"><thead><tr><th>A</th><th>Status</th></tr></thead><tbody><tr><td colspan="2">One cell</td></tr></tbody></table><table data-views="Status"><thead><tr><th>A</th><th>Status</th></tr></thead><tbody></tbody></table><table><thead><tr><th>A</th><th>Status</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table></main>`);
  const root = dom.window.document.getElementById('content'), html = root.innerHTML;
  assert.equal(applyItemViews(root, {view: 'clients', storage: memory()}), 0);
  assert.equal(root.innerHTML, html);
});

test('the choice is remembered per section and a blocked store falls back to the table', () => {
  const store = memory();
  saveViewMode(store, 'clients', 'kanban');
  assert.equal(loadViewMode(store, 'clients'), 'kanban');
  assert.equal(loadViewMode(store, 'documents'), 'list');
  assert.equal(loadViewMode({getItem() { throw new Error('x'); }}, 'clients'), 'list');
  const {root} = page();
  assert.doesNotThrow(() => applyItemViews(root, {view: 'clients', storage: {getItem() { throw new Error('x'); }}}));
  assert.equal(laneName(new JSDOM('<td> </td>').window.document.querySelector('td') ?? {querySelector: () => null, textContent: ''}), 'Other');
});

test('clicking the switch saves the mode for the current section and redraws once', () => {
  const {dom, root, doc} = page(), store = memory();
  let renders = 0;
  bindItemViews({storage: store, getView: () => 'documents', render: () => renders++, doc});
  applyItemViews(root, {view: 'documents', storage: store});
  root.querySelector('[data-views-mode=kanban]').click();
  assert.equal(renders, 1);
  assert.equal(loadViewMode(store, 'documents'), 'kanban');
  assert.equal(loadViewMode(store, 'clients'), 'list');
  dom.window.close();
});

test('every record section opts in and the page applies the views after drawing it', () => {
  const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const pilot = read('staff-pilot.mjs');
  assert.match(pilot, /from '\.\/staff-items-view\.mjs\?v=/);
  assert.match(pilot, /\[view\]\)\(\);applyItemViews\(\$\('#content'\),\{view,storage:globalThis\.localStorage\}\);v6\.bind\(\);/);
  assert.match(pilot, /bindItemViews\(\{storage:globalThis\.localStorage,getView:\(\)=>view,render\}\)/);
  for (const [file, marker] of [['staff-pilot.mjs', 'data-views="Sector / branch"'], ['staff-pilot.mjs', 'data-views="ERP role"'], ['staff-pilot.mjs', 'data-views="Category"'], ['staff-leads.mjs', 'data-views="Stage / qualification"'], ['staff-workspace-v6.mjs', 'data-views="Status"'], ['staff-suite.mjs', 'data-views="${esc(group)}"']]) assert.ok(read(file).includes(marker), file + ' ' + marker);
  const suite = read('staff-suite.mjs');
  assert.equal((suite.match(/\]\),'Status'\)/g) || []).length, 3, 'invoices, letters and attendance');
  const css = read('staff-pilot.css');
  assert.match(css, /\.rv tbody\{display:grid/);
  assert.match(css, /\.kanban\{display:grid;gap:14px/, 'Kanban lanes are stacked vertically');
  assert.doesNotMatch(css, /grid-auto-flow:column/, 'no horizontal Kanban board');
});
