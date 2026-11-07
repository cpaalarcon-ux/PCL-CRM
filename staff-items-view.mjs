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
