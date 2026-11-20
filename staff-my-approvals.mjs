// Actionable Settings approval board. The browser collects a review selection; the server
// rechecks every item through its existing typed handler in one transaction.
import {visibleRecords,STATE_FILTERS} from './staff-approvals-filter.mjs?v=20261117-actions-v1';
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(action,label,id='',extra='')=>`<button type="button" data-suite="${action}" data-id="${e0(id)}" ${extra}>${e0(label)}</button>`;
export const FILTER_DEFAULT=Object.freeze({mine:true,state:'',owner:'',scope:'',from:'',to:'',q:''});
const BULK_KEYS=new Set(['approve_tax_rates','approve_chart','approve_statement_lines']);
const groupItems=g=>g.key==='approve_statement_lines'?(g.items||[]).flatMap(x=>(x.items||[]).map(i=>({...i,eligible:x.eligible,reason:x.reason,group_label:x.label,group_id:x.group_id,group_kind:x.kind}))):(g.items||[]);
const REVIEW_CONFIRMATIONS={approve_tax_rates:'I checked the figures, statutory basis, eligibility conditions and effective dates against the linked sources for every selected tax rate.',approve_chart:'I checked the proposed account codes, names, categories, routes and statement placement.',approve_statement_lines:'I reviewed every selected account against its proposed statement line.'};
const encoded=(key,id)=>`${key}|${id}`;
const reviewCard=(g,selected,esc=e0)=>{
 const count=Number(g.actionable_count||0),waiting=Number(g.waiting_count||0),blocked=Number(g.blocked_count||0);
 const label=g.key==='approve_tax_rates'?'Tax rates':g.key==='approve_chart'?'Chart of Accounts':'Statement-line mappings';
 const foot=g.key==='approve_statement_lines'&&blocked?`${blocked} mapping${blocked===1?'':'s'} are outside the grouped approval path. ${g.blocked_note||'Review them individually.'}`:blocked?`${blocked} item${blocked===1?'':'s'} need a separate permission, source or maker-checker check.`:'';
 return `<article class="approval-action-card" data-approval-group="${esc(g.key)}"><label class="approval-group-select"><input type="checkbox" data-ap-group="${esc(g.key)}" ${selected.has(g.key)?'checked':''} ${count?'':'disabled'} aria-label="Include all ${count} eligible ${esc(label.toLowerCase())} in bulk review"><span>Include group in bulk review</span></label><div class="approval-card-title"><h3>${esc(label)}</h3><strong>${esc(count)}</strong></div><p>${esc(count)} ready for your review${waiting!==count?` · ${esc(waiting)} waiting in total`:''}</p>${foot?`<p class="muted">${esc(foot)}</p>`:'<p class="muted">The selected entries will be checked again before approval.</p>'}<div class="actions">${btn('ap-review',count?`Review ${count} eligible`:`View ${waiting} waiting`,g.key)} ${g.key==='approve_statement_lines'&&blocked?btn('stmt-review-open','Review exceptions'):''}</div></article>`;
};
export function queuesView(queues,{mine,esc=e0}={}){
 const rows=mine?queues.filter(q=>q.needs_my_action):queues;
 if(!rows.length)return `<p class="${queues.length?'muted':'ok'}" id="apQueues">${queues.length?'No other approval queue needs your action.':'Nothing else is waiting for approval.'}</p>`;
 return `<div class="scroll"><table id="apQueues"><thead><tr><th>Approval task</th><th class="num">Waiting</th><th>Owner</th><th>Where</th><th></th></tr></thead><tbody>${rows.map(q=>`<tr><td><b>${esc(q.title)}</b>${q.needs_my_action?' <span class="badge warn">Needs my action</span>':''}</td><td class="num">${esc(q.count)}</td><td>${esc(q.owner_label||'')}</td><td><small>${esc(q.where)}</small></td><td>${btn('ap-open','Open',q.key)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function recordsView(items,{esc=e0}={}){
 if(!items.length)return '<p class="muted" id="apRecords">No records match these filters.</p>';
 return `<div class="scroll"><table id="apRecords"><thead><tr><th>Record</th><th>State</th><th>Scope</th><th>Owner</th><th>Effective from</th><th>Prepared by</th><th></th></tr></thead><tbody>${items.slice(0,200).map(i=>`<tr><td><b>${esc(i.label)}</b><small>${esc(i.area_label)}</small></td><td>${esc(i.state)}${i.needs_my_action?' <span class="badge warn">Needs my action</span>':''}</td><td>${esc(i.scope)}</td><td>${esc(i.owner_label||'')}</td><td>${esc(i.effective_from||'')}</td><td>${esc(i.prepared_by||'')}</td><td>${btn('settings-record','Open',i.area+':'+i.record_id)}</td></tr>`).join('')}</tbody></table></div>${items.length>200?`<p class="muted">Showing the first 200 of ${esc(items.length)}. Narrow the filters.</p>`:''}`;
}
export function renewalsView(items,{esc=e0}={}){
 if(!items||!items.length)return '<p class="ok" id="apRenewals">Nothing lapsed or ending within 60 days.</p>';
 const when=i=>i.lapsed?`Lapsed ${esc(-i.days)} day${i.days===-1?'':'s'} ago`:i.days===0?'Ends today':`Ends in ${esc(i.days)} day${i.days===1?'':'s'}`;
 return `<div class="scroll"><table id="apRenewals"><thead><tr><th>Record</th><th>What ends</th><th>Date</th><th>Owner</th><th></th></tr></thead><tbody>${items.map(i=>`<tr data-lapsed="${i.lapsed?'yes':'no'}"><td><b>${esc(i.label)}</b><small>${esc(i.area_label)}</small></td><td>${esc(i.what)}</td><td>${esc(i.date)} <span class="badge ${i.lapsed?'bad':'warn'}">${when(i)}</span></td><td>${esc(i.owner_label||'')}</td><td>${btn('settings-record','Open',i.area+':'+i.record_id)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function filtersView(f,data,{esc=e0}={}){
 const opt=(v,l,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(l)}</option>`;
 return `<div class="filters" id="apFilters"><label><input type="checkbox" data-ap="mine"${f.mine?' checked':''}> Needs my action</label><label>State<select data-ap="state">${opt('','Any',f.state)}${STATE_FILTERS.map(s=>opt(s,s,f.state)).join('')}</select></label><label>Owner<select data-ap="owner">${opt('','Any',f.owner)}${data.roles.map(r=>opt(r.code,r.label,f.owner)).join('')}</select></label><label>Firm or client<select data-ap="scope">${opt('','Any',f.scope)}${opt('firm','Firm-wide',f.scope)}${data.scopes.map(s=>opt(s,s,f.scope)).join('')}</select></label><label>Effective from<input type="date" data-ap="from" value="${esc(f.from)}"></label><label>Effective to<input type="date" data-ap="to" value="${esc(f.to)}"></label><label>Search<input type="search" data-ap="q" value="${esc(f.q)}" maxlength="60"></label></div>`;
}
export function approvalsView(data,f,{esc=e0,selectedGroups=new Set()}={}){
 const cards=(data.actionGroups||[]).filter(g=>Number(g.waiting_count||0)>0);
 const other=(data.queues||[]).filter(q=>!BULK_KEYS.has(q.key));
 const recs=visibleRecords(data.records,f);
 return `<section class="approval-board" id="approvalBoard"><div class="approval-needs-action"><div><p class="eyebrow">SETTINGS APPROVALS</p><h3>Needs my action</h3><p>Counts reflect approval queues and review records available to your role. Ineligible and self-prepared items are excluded from bulk selection.</p></div><strong>${esc(data.actionableTotal||0)}</strong></div><div class="approval-action-grid">${cards.map(g=>reviewCard(g,selectedGroups,esc)).join('')||'<p class="ok">No bulk approval groups are waiting.</p>'}</div><div class="approval-board-actions">${btn('ap-bulk-open','Bulk Approve Selected', '', `class="primary" ${selectedGroups.size?'':'disabled'}`)}<span class="muted">Select one or more groups, review the item details, then confirm before approval.</span></div></section>
 ${other.length?`<details class="approval-secondary"><summary>Other approval tasks</summary><p class="muted">These items keep their existing review screens and controls.</p>${queuesView(other,{mine:f.mine,esc})}</details>`:''}
 <details class="approval-secondary"><summary>Renewals and expiries (${esc(data.renewals?.length||0)})</summary>${renewalsView(data.renewals,{esc})}</details>
 <details class="approval-secondary"><summary>Search all settings records</summary><p class="muted">Use these filters when you need the history or current state of a specific record.</p>${filtersView(f,data,{esc})}<div id="apRecordsBody">${recordsView(recs,{esc})}</div></details>`;
}
export function drawerView(groups,selected,{esc=e0}={}){
 const flattened=groups.flatMap(g=>groupItems(g).map(i=>({...i,queue_key:g.key,type:g.type})));
 const eligible=flattened.filter(i=>i.eligible);
 const selectedCount=flattened.filter(i=>selected.get(i.queue_key)?.has(String(i.id))).length;
 const groupContent=groups.map(g=>{
  const items=groupItems(g),eligibleCount=items.filter(i=>i.eligible).length;
  const rows=items.map(i=>`<article class="approval-review-item ${i.eligible?'':'is-blocked'}"><label><input type="checkbox" data-ap-item="${esc(encoded(g.key,i.id))}" ${selected.get(g.key)?.has(String(i.id))?'checked':''} ${i.eligible?'':'disabled'}><span><b>${esc(i.code||'')} ${esc(i.label||'')}</b>${i.kind?`<small>${esc(i.kind)}</small>`:''}</span></label><div class="approval-item-detail">${i.effective_from?`<span>Effective ${esc(i.effective_from)}${i.effective_to?` to ${esc(i.effective_to)}`:''}</span>`:''}${i.prepared_by?`<span>Prepared by ${esc(i.prepared_by)}</span>`:''}${i.group_label?`<span>Statement line: ${esc(i.group_label)}</span>`:''}${i.route?`<span>Route ${esc(i.route)} · ${esc(i.category_code||'')}</span>`:''}${i.statement?`<span>${esc(i.statement)}</span>`:''}${i.tax_note?`<span>Tax treatment: ${esc(i.tax_note)}</span>`:''}${i.evidence?`<span>Evidence: ${esc(i.evidence)}</span>`:''}${i.notes?`<span>Proposal notes: ${esc(i.notes)}</span>`:''}${i.parameters&&Object.keys(i.parameters).length?`<span>Figures: ${esc(JSON.stringify(i.parameters))}</span>`:''}${i.legal_citation?`<span>Legal basis: ${esc(i.legal_citation)}</span>`:''}${i.legal_review_status?`<span>Legal review: ${esc(i.legal_review_status)}${i.legal_review_reference?` · ${esc(i.legal_review_reference)}`:''}</span>`:''}${i.source_note?`<span>${esc(i.source_note)}</span>`:''}${i.source_url?`<a href="${esc(i.source_url)}" target="_blank" rel="noopener noreferrer">Open official source</a>`:''}${i.reason?`<span class="error" role="alert">${esc(i.reason)}</span>`:''}</div></article>`).join('');
  const title=g.key==='approve_tax_rates'?'Tax rates':g.key==='approve_chart'?'Chart of Accounts additions':'Statement-line mapping groups';
  return `<section class="approval-review-group"><div class="approval-review-heading"><h3>${esc(title)}</h3><span>${esc(eligibleCount)} eligible · ${esc(items.length-eligibleCount)} blocked or unavailable</span></div>${g.key==='approve_statement_lines'?g.items.map(group=>`<details class="approval-line-group" open><summary><b>${esc(group.label)}</b> · ${esc(group.kind)} · ${esc(group.items.length)} accounts</summary>${group.items.map(i=>`<div class="approval-review-item"><label><input type="checkbox" data-ap-item="${esc(encoded(g.key,i.id))}" ${selected.get(g.key)?.has(String(i.id))?'checked':''} ${group.eligible?'':'disabled'}><span><b>${esc(i.code)} ${esc(i.label)}</b><small>${esc(i.origin)} · ${esc(i.effective_from)}</small></span></label>${group.reason?`<p class="error" role="alert">${esc(group.reason)}</p>`:''}</div>`).join('')}</details>`).join(''):rows}</section>`;
 }).join('');
 const allChecked=eligible.length>0&&selectedCount===eligible.length;
 const applicable=[...new Set(groups.filter(g=>selected.get(g.key)?.size).map(g=>g.key))].map(k=>REVIEW_CONFIRMATIONS[k]);
 return `<div class="approval-drawer-content"><p class="info">Review the source, effective dates, legal basis, account details and statement-line grouping shown below. The ERP rechecks each record and its current revision when you submit.</p><div class="approval-drawer-tools"><label><input type="checkbox" data-ap-selectall ${allChecked?'checked':''} ${eligible.length?'':'disabled'}> Select all ${esc(eligible.length)} eligible items</label><span>${esc(selectedCount)} selected</span></div>${groupContent||'<p class="ok">No items are waiting in the selected groups.</p>'}${groups.some(g=>g.key==='approve_statement_lines'&&g.blocked_count)?`<p class="info">Exceptions and unchanged mappings are excluded here. Open the statement-line review to decide those one by one.</p>${btn('stmt-review-open','Open statement-line exception review')}`:''}<div class="approval-drawer-confirm"><div><b>Review confirmation</b><ul>${applicable.map(x=>`<li>${esc(x)}</li>`).join('')||'<li>Select an eligible item to enable approval.</li>'}</ul></div><label><input type="checkbox" data-ap-confirm> I confirm that I completed each applicable review above.</label><button type="button" class="primary" data-suite="ap-approve-selected" disabled>Approve selected (<span id="apSelectedCount">${esc(selectedCount)}</span>)</button></div></div>`;
}
export function createMyApprovalsUI(ctx){
 const {request,modal,notice}=ctx;
 let data=null,loading=false,failed='',f={...FILTER_DEFAULT},selectedGroups=new Set(),drawerGroups=[],drawerSelected=new Map();
 async function load(){if(loading)return;loading=true;try{const r=await request({action:'settings_approvals_read'});if(!r||!Array.isArray(r.queues)||!Array.isArray(r.records)||!Array.isArray(r.actionGroups))throw Error('The approvals answer was not in the expected form.');data=r;failed='';}catch(e){failed=e.message||'My approvals could not be loaded.';}finally{loading=false;ctx.render();}}
 function card(){if(!['PARTNER','MANAGER'].includes(ctx.data().me?.category_code))return '';const wrap=inner=>`<section class="card settings-card" id="myApprovalsCard"><h2>Approval task board</h2>${inner}</section>`;if(!data&&!failed){queueMicrotask(load);return wrap('<p class="muted">Loading…</p>');}if(failed)return wrap(`<p class="error" role="alert">${e0(failed)}</p>`);return wrap(approvalsView(data,f,{esc:e0,selectedGroups}));}
 function selectedMap(groups){const map=new Map();for(const g of groups){const ids=groupItems(g).filter(i=>i.eligible).map(i=>String(i.id));map.set(g.key,new Set(ids));}return map;}
 function selectionCount(){let n=0;for(const ids of drawerSelected.values())n+=ids.size;return n;}
 function updateDrawerControls(){const count=selectionCount(),num=document.getElementById('apSelectedCount'),button=document.querySelector('[data-suite="ap-approve-selected"]');if(num)num.textContent=String(count);if(button)button.disabled=count===0||!document.querySelector('[data-ap-confirm]')?.checked;const all=[...document.querySelectorAll('[data-ap-item]:not(:disabled)')],check=document.querySelector('[data-ap-selectall]');if(check)check.checked=all.length>0&&all.every(x=>x.checked);const label=document.querySelector('.approval-drawer-tools span');if(label)label.textContent=`${count} selected`;}
 function paintDrawer(){modal(`Quick review · ${drawerGroups.length} approval group${drawerGroups.length===1?'':'s'}`,drawerView(drawerGroups,drawerSelected,{esc:e0}),null,null,{refreshWorkspace:false});document.querySelector('#editor')?.classList.add('approval-drawer');updateDrawerControls();}
 async function openReview(keys){try{const r=await request({action:'settings_approval_items_read',queue_keys:keys});drawerGroups=r.groups||[];drawerSelected=selectedMap(drawerGroups);paintDrawer();}catch(e){notice(e.message||'The quick review could not be opened.',true);}}
 if(typeof document!=='undefined')document.addEventListener('change',e=>{
  const k=e.target?.dataset?.ap;if(k&&data){f={...f,[k]:e.target.type==='checkbox'?e.target.checked:e.target.value};ctx.render();return;}
  if(e.target?.dataset?.apGroup){const key=e.target.dataset.apGroup;if(e.target.checked)selectedGroups.add(key);else selectedGroups.delete(key);ctx.render();return;}
  if(e.target?.dataset?.apItem){const [key,id]=String(e.target.dataset.apItem).split('|');const ids=drawerSelected.get(key)||new Set();if(e.target.checked)ids.add(id);else ids.delete(id);drawerSelected.set(key,ids);updateDrawerControls();return;}
  if(e.target?.hasAttribute('data-ap-selectall')){for(const g of drawerGroups){const ids=new Set(e.target.checked?groupItems(g).filter(i=>i.eligible).map(i=>String(i.id)):[]);drawerSelected.set(g.key,ids);}for(const input of document.querySelectorAll('[data-ap-item]:not(:disabled)'))input.checked=e.target.checked;updateDrawerControls();return;}
  if(e.target?.hasAttribute('data-ap-confirm'))updateDrawerControls();
 });
 if(typeof document!=='undefined')document.addEventListener('input',e=>{if(e.target?.dataset?.ap!=='q'||!data)return;f={...f,q:e.target.value};const body=document.getElementById('apRecordsBody');if(body)body.innerHTML=recordsView(visibleRecords(data.records,f),{esc:e0});});
 async function handle(action,id){
  if(action==='ap-open'){const q=data?.queues.find(x=>x.key===id);if(q?.go)ctx.openSection(q.go,q);return true;}
  if(action==='ap-review'){if(!BULK_KEYS.has(id))return true;await openReview([id]);return true;}
  if(action==='ap-bulk-open'){const keys=[...selectedGroups].filter(k=>BULK_KEYS.has(k));if(!keys.length){notice('Select at least one approval group first.',true);return true;}await openReview(keys);return true;}
  if(action==='ap-approve-selected'){
   const confirmed=!!document.querySelector('[data-ap-confirm]')?.checked;if(!confirmed){notice('Confirm that you reviewed the selected item details first.',true);return true;}
   const selections=drawerGroups.map(g=>({queue_key:g.key,items:groupItems(g).filter(i=>drawerSelected.get(g.key)?.has(String(i.id))).map(i=>({id:i.id,revision:i.revision}))})).filter(g=>g.items.length);
   if(!selections.length){notice('Select at least one eligible item.',true);return true;}
   const button=document.querySelector('[data-suite="ap-approve-selected"]');if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
   try{const r=await request({action:'settings_approval_batch_approve',selections,review_confirmed:true});const total=Number(r.total||0);notice(`${total} item${total===1?'':'s'} approved. The batch is recorded in the settings audit log.`);document.getElementById('editor')?.close?.();selectedGroups.clear();drawerGroups=[];data=null;failed='';ctx.render();await load();}
   catch(e){const message=e.message||'The approval batch did not go through. No item was approved.';const error=document.getElementById('editorNotice');if(error)error.textContent=message;else notice(message,true);if(button){button.disabled=false;button.removeAttribute('aria-busy');}}
   return true;
  }
  return false;
 }
 return {card,handle,refresh:()=>{data=null;failed='';}};
}
