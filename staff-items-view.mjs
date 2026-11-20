// Cards / List / Kanban display modes for project and task items. Presentation only: no data is changed or hidden.
export const ITEM_MODES=[['cards','Cards'],['list','List'],['kanban','Kanban']];
export const ITEM_VIEW_KEY='pclItemsView';
export const normalizeMode=v=>ITEM_MODES.some(m=>m[0]===v)?v:'cards';
export function loadMode(storage){try{return normalizeMode(storage?.getItem(ITEM_VIEW_KEY))}catch{return 'cards'}}
export function saveMode(storage,mode){try{storage?.setItem(ITEM_VIEW_KEY,normalizeMode(mode))}catch{/* the choice is only a convenience */}}
export function modeSwitch(mode,esc=String){
 const m=normalizeMode(mode);
 return `<div class="items-switch" role="group" aria-label="Show items as">${ITEM_MODES.map(([k,l])=>`<button type="button" data-v6="items-view" data-mode="${k}" aria-pressed="${k===m}"${k===m?' class="active"':''}>${esc(l)}</button>`).join('')}</div>`;
}
// Known columns first (in the given order, kept even when empty), then any other value alphabetically.
export function groupColumns(items,keyOf,order=[],keepEmpty=true){
 const map=new Map(order.map(k=>[k,[]]));
 for(const it of items){const k=keyOf(it)||'Other';if(!map.has(k))map.set(k,[]);map.get(k).push(it);}
 const known=order.filter(k=>keepEmpty||map.get(k).length),extra=[...map.keys()].filter(k=>!order.includes(k)).sort((a,b)=>a.localeCompare(b));
 return [...known,...extra].map(name=>({name,items:map.get(name)}));
}
export function kanban(columns,renderCard,esc=String){
 return `<div class="kanban" role="list">${columns.map(c=>`<section class="kanban-col" role="listitem" aria-label="${esc(c.name)}, ${c.items.length}"><header><b>${esc(c.name)}</b><span>${c.items.length}</span></header><div class="kanban-cards">${c.items.length?c.items.map(renderCard).join(''):'<p class="kanban-empty">Nothing here</p>'}</div></section>`).join('')}</div>`;
}
export function listTable(headers,rows){
 return `<div class="items-table-wrap"><table class="items-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// ---- Record tables: the same three display modes for every section that lists records -------------------------------
// A table opts in with data-views="<column to group by in Kanban>" (empty = no Kanban). The rows themselves are never
// cloned or rebuilt, only re-styled and, for Kanban, re-ordered under lane headings, so every button and link keeps working.
const viewKey=view=>`${ITEM_VIEW_KEY}:${view}`;
export function loadViewMode(storage,view){try{const v=storage?.getItem(viewKey(view));return ITEM_MODES.some(m=>m[0]===v)?v:'list'}catch{return 'list'}}
export function saveViewMode(storage,view,mode){try{storage?.setItem(viewKey(view),normalizeMode(mode))}catch{/* convenience only */}}
const flat=el=>(el?.textContent||'').replace(/\s+/g,' ').trim();
export function laneName(cell){const badge=cell.querySelector('.badge');const t=flat(badge||cell);return t?(t.length>48?t.slice(0,47)+'…':t):'Other';}
export function viewSwitch(mode,canKanban){
 const m=canKanban||mode!=='kanban'?normalizeMode(mode):'cards';
 return `<div class="items-bar" data-views-bar><span class="muted">Show items as</span><div class="items-switch" role="group" aria-label="Show items as">${ITEM_MODES.filter(([k])=>canKanban||k!=='kanban').map(([k,l])=>`<button type="button" data-views-mode="${k}" aria-pressed="${k===m}"${k===m?' class="active"':''}>${l}</button>`).join('')}</div></div>`;
}
function prepare(table){
 const headers=[...(table.tHead?.rows[0]?.cells||[])],rows=[...table.querySelectorAll(':scope>tbody>tr')];
 if(!headers.length||!rows.length)return null;
 if(rows.some(r=>r.cells.length!==headers.length||[...r.cells].some(c=>c.colSpan>1)))return null;
 const want=(table.getAttribute('data-views')||'').trim().toLowerCase(),groupIndex=want?headers.findIndex(h=>flat(h).toLowerCase()===want):-1;
 return {table,headers,rows,groupIndex};
}
export function applyItemViews(root,{view,storage}={}){
 if(!root)return 0;
 const prepared=[...root.querySelectorAll('table[data-views]')].map(prepare).filter(Boolean);
 if(!prepared.length)return 0;
 const canKanban=prepared.some(p=>p.groupIndex>=0);let mode=loadViewMode(storage,view);if(mode==='kanban'&&!canKanban)mode='cards';
 const first=prepared[0].table,anchor=first.closest('.scroll,.table-wrap,.items-table-wrap')||first;
 anchor.insertAdjacentHTML('beforebegin',viewSwitch(mode,canKanban));
 if(mode==='list')return prepared.length;
 const doc=root.ownerDocument;
 for(const {table,headers,rows,groupIndex} of prepared){
  const kanbanHere=mode==='kanban'&&groupIndex>=0;
  table.classList.add('rv',kanbanHere?'rv-kanban':'rv-cards');
  table.setAttribute('role','table');table.tHead.setAttribute('role','rowgroup');table.tBodies[0].setAttribute('role','rowgroup');
  headers.forEach(h=>h.setAttribute('role','columnheader'));
  for(const r of rows){r.setAttribute('role','row');[...r.cells].forEach((c,i)=>{c.setAttribute('role','cell');c.setAttribute('data-label',flat(headers[i]));if(!flat(c)&&!c.querySelector('button,a,input,select,textarea'))c.classList.add('rv-empty');});}
  if(!kanbanHere)continue;
  const lanes=new Map();for(const r of rows){const k=laneName(r.cells[groupIndex]);if(!lanes.has(k))lanes.set(k,[]);lanes.get(k).push(r);}
  const order=[...lanes.keys()].sort((a,b)=>(a==='Other')-(b==='Other')),body=table.tBodies[0];
  for(const name of order){const g=lanes.get(name),head=doc.createElement('tr'),cell=doc.createElement('td');head.className='lane-head';head.setAttribute('role','row');cell.setAttribute('role','columnheader');cell.colSpan=headers.length;cell.innerHTML='<b></b><span></span>';cell.firstChild.textContent=name;cell.lastChild.textContent=String(g.length);head.appendChild(cell);body.appendChild(head);for(const r of g)body.appendChild(r);}
 }
 return prepared.length;
}
export function bindItemViews({storage,getView,render,doc=globalThis.document}){
 doc.addEventListener('click',e=>{const b=e.target.closest?.('[data-views-mode]');if(!b)return;saveViewMode(storage,getView(),b.dataset.viewsMode);render();});
}
