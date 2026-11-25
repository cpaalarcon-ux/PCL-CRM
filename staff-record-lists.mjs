// Use native disclosures for record lists while keeping the screen's actions and filters available.
const collections = {
 '.audit-engagement-list': 'Engagement register',
 '.audit-workpaper-list': 'Working papers',
 '.client-project-list': 'Projects on this client',
 '.client-activity-list': 'Client activity',
 '.mywork-board': 'Work board',
 '.week-grid': 'Week overview',
};
const selectors = Object.keys(collections);
const targets = ['table', ...selectors].join(',');

function labelFor(table) {
 const label = table.getAttribute('aria-label') || table.caption?.textContent.trim();
 if (label) return label;
 const firstColumn = table.tHead.rows[0]?.cells[0]?.textContent.trim();
 return firstColumn ? `Records · ${firstColumn}` : 'Records';
}

export function foldRecordLists(root, scope = root) {
 if (scope.closest('details, form, .print-report')) return;
 const document = root.ownerDocument;
 const candidates = [...scope.querySelectorAll(targets)];
 if (scope.matches(targets)) candidates.unshift(scope);
 for (const list of candidates) {
  if (!root.contains(list) || list.closest('details, form, .print-report')) continue;
  const table = list.tagName === 'TABLE';
  if (table && (!list.tHead || !list.tBodies.length)) continue;
  const container = table ? list.closest('.scroll, .table-wrap, .items-table-wrap') : null;
  const anchor = container?.querySelectorAll('table').length === 1 ? container : list;
  if (anchor === root || !root.contains(anchor) || anchor.hidden) continue;
  const title = table ? labelFor(list) : collections[selectors.find(selector => list.matches(selector))];
  const key = `workspace-list-${encodeURIComponent(title)}`;
  let id = key;
  for (let index = 2; document.getElementById(id); index++) id = `${key}-${index}`;

  const disclosure = document.createElement('details');
  disclosure.id = id;
  disclosure.className = 'settings-fold';
  disclosure.dataset.preserveOpen = '';
  const summary = document.createElement('summary');
  summary.id = `${id}-summary`;
  summary.textContent = title;
  const contents = document.createElement('div');
  anchor.before(disclosure);
  disclosure.append(summary, contents);
  contents.append(anchor);
 }
}

export function observeRecordLists(root) {
 const {MutationObserver} = root.ownerDocument.defaultView;
 const observer = new MutationObserver(changes => {
  for (const change of changes) {
   for (const node of change.addedNodes) {
    if (node.nodeType === 1 && root.contains(node)) foldRecordLists(root, node);
   }
  }
 });
 observer.observe(root, {childList: true, subtree: true});
 return observer;
}
