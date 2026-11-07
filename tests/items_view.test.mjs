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
