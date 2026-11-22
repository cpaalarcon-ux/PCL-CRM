// Actionable Settings approval board. The browser collects a review selection; the server
// rechecks every item through its existing typed handler in one transaction.
import {visibleRecords,STATE_FILTERS} from './staff-approvals-filter.mjs?v=20261117-actions-v1';
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(action,label,id='',extra='')=>`<button type="button" data-suite="${action}" data-id="${e0(id)}" ${extra}>${e0(label)}</button>`;
export const FILTER_DEFAULT=Object.freeze({mine:true,state:'',owner:'',scope:'',from:'',to:'',q:''});
const GROUP_TITLES={approve_tax_rates:'Tax rates',approve_chart:'Chart of Accounts',approve_statement_lines:'Statement-line mappings'};
const BULK_KEYS=new Set(Object.keys(GROUP_TITLES));
const groupItems=g=>g.key==='approve_statement_lines'?(g.items||[]).flatMap(x=>(x.items||[]).map(i=>({
 eligible:x.eligible,reason:x.reason,...i,group_label:x.label,group_id:x.group_id,group_kind:x.kind
}))):(g.items||[]);
const REVIEW_CONFIRMATIONS={approve_tax_rates:'I checked the figures, statutory basis, eligibility conditions and effective dates against the linked sources for every selected tax rate.',approve_chart:'I checked the proposed account codes, names, categories, routes and statement placement.',approve_statement_lines:'I reviewed every selected account against its proposed statement line.'};
const encoded=(key,id)=>`${key}|${id}`;
const period=i=>[i.effective_from,i.effective_to].filter(Boolean).join(' to ');
const number=new Intl.NumberFormat('en-KE',{maximumFractionDigits:8});
function figures(p,esc){
 const vals=Object.entries(p||{});
 if(!vals.length)return '<span class="muted">No figures recorded</span>';
 const value=v=>typeof v==='number'?number.format(v):v==null?'—':typeof v==='object'?JSON.stringify(v):String(v);
 return `<dl class="approval-figures">${vals.map(([k,v])=>{
  const displayed=k==='bands'&&Array.isArray(v)?v.map(b=>`${b.upper==null?'Above the last band':'Up to '+value(b.upper)} · ${value(b.rate)}%`).join(' / '):value(v);
  return `<dt>${esc(k.replaceAll('_',' '))}</dt><dd>${esc(displayed)}</dd>`;
 }).join('')}</dl>`;
}
function reviewSections(group){
 const sections=new Map();
 for(const i of groupItems(group)){
  const title=group.key==='approve_tax_rates'?[i.kind||'Other tax',period(i)].filter(Boolean).join(' · '):
   group.key==='approve_chart'?[i.kind||'Accounts',i.category_code].filter(Boolean).join(' · '):
   [i.group_label,i.group_kind].filter(Boolean).join(' · ');
  const key=group.key==='approve_statement_lines'?i.group_id:title;
  if(!sections.has(key))sections.set(key,{key:encoded(group.key,key),title,items:[]});
  sections.get(key).items.push(i);
 }
 return [...sections.values()];
}
const reviewCard=(g,selected,esc=e0)=>{
 const count=Number(g.actionable_count||0),waiting=Number(g.waiting_count||0),blocked=Number(g.blocked_count||0);
 const label=GROUP_TITLES[g.key];
 const foot=g.key==='approve_statement_lines'&&blocked?`${blocked} mapping${blocked===1?'':'s'} are outside the grouped approval path. ${g.blocked_note||'Review them individually.'}`:blocked?`${blocked} item${blocked===1?'':'s'} need a separate permission, source or maker-checker check.`:'';
 return `<article class="approval-action-card" data-approval-group="${esc(g.key)}"><label class="approval-group-select"><input type="checkbox" data-ap-group="${esc(g.key)}" ${selected.has(g.key)?'checked':''} ${count?'':'disabled'} aria-label="Include ${esc(label.toLowerCase())} in bulk review"><span>Include group in bulk review</span></label><div class="approval-card-title"><h3>${esc(label)}</h3><strong>${esc(count)}</strong></div><p>${esc(count)} ready for your review${waiting!==count?` · ${esc(waiting)} waiting in total`:''}</p>${foot?`<p class="muted">${esc(foot)}</p>`:'<p class="muted">The selected entries will be checked again before approval.</p>'}<div class="actions">${btn('ap-review',count?`Review ${count} eligible`:`View ${waiting} waiting`,g.key)} ${g.key==='approve_statement_lines'&&blocked?btn('stmt-review-open','Review exceptions'):''}</div></article>`;
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
 return `<section class="approval-board" id="approvalBoard"><div class="approval-needs-action"><div><p class="eyebrow">SETTINGS APPROVALS</p><h3>Needs my action</h3><p>Counts reflect approval queues and review records available to your role. Ineligible and self-prepared items are excluded from bulk selection.</p></div><strong>${esc(data.actionableTotal||0)}</strong></div><div class="approval-action-grid">${cards.map(g=>reviewCard(g,selectedGroups,esc)).join('')||'<p class="ok">No bulk approval groups are waiting.</p>'}</div><div class="approval-board-actions">${btn('ap-bulk-open','Review selected queues', '', `class="primary" ${selectedGroups.size?'':'disabled'}`)}<span class="muted">Select one or more groups, review the item details, then confirm before approval.</span></div></section>
 ${other.length?`<details class="approval-secondary"><summary>Other approval tasks</summary><p class="muted">These items keep their existing review screens and controls.</p>${queuesView(other,{mine:f.mine,esc})}</details>`:''}
 <details class="approval-secondary"><summary>Renewals and expiries (${esc(data.renewals?.length||0)})</summary>${renewalsView(data.renewals,{esc})}</details>
 <details class="approval-secondary"><summary>Search all settings records</summary><p class="muted">Use these filters when you need the history or current state of a specific record.</p>${filtersView(f,data,{esc})}<div id="apRecordsBody">${recordsView(recs,{esc})}</div></details>`;
}
function reviewRow(group,i,selected,{esc,canEditTax}){
 const key=encoded(group.key,i.id),tax=group.key==='approve_tax_rates';
 const label=[i.code,i.label].filter(Boolean).join(' · ');
 const action=tax?btn('ap-rate-open',canEditTax&&i.legal_review_status!=='Confirmed'?'Edit tax rule':'View tax rule',i.id):
  group.key==='approve_chart'?btn('ap-chart-open','Open account in chart',i.id):'';
 const taxEvidence=tax?`<div class="approval-comparison"><section><b>Proposed figures</b>${figures(i.parameters,esc)}</section><section><b>${esc(i.comparison_label||'Approved figures')}</b>${i.comparison?`<small>${esc(period(i.comparison))}</small>${figures(i.comparison.parameters,esc)}`:'<p class="muted">No comparable approved version</p>'}</section></div>
  ${i.legal_citation?`<span>Legal citation · ${esc(i.legal_citation)}</span>`:''}
  ${i.legal_review_status?`<span>Legal review · ${esc(i.legal_review_status)}${i.legal_review_reference?` · ${esc(i.legal_review_reference)}`:''}</span>`:''}
  ${i.source_note?`<span>${esc(i.source_note)}</span>`:''}
  ${/^https:\/\//i.test(i.source_url||'')?`<a href="${esc(i.source_url)}" target="_blank" rel="noopener noreferrer">${i.source_issue?'Open recorded source':'Open official source'}</a>`:''}
  ${i.source_issue&&i.source_issue!==i.reason?`<span class="error">${esc(i.source_issue)}</span>`:''}`:'';
 return `<article data-approval-item="${esc(key)}" class="approval-review-item ${i.eligible?'':'is-blocked'}">
  <label><input type="checkbox" data-ap-item="${esc(key)}" ${selected.has(String(i.id))&&i.eligible?'checked':''} ${i.eligible?'':'disabled'}><b>${esc(label)}</b></label>
  <div class="approval-item-detail">${period(i)?`<span>${esc(period(i))}</span>`:''}
  ${i.prepared_by?`<span>Prepared by ${esc(i.prepared_by)}</span>`:''}
  ${i.route?`<span>Posting route · ${esc(i.route)}</span>`:''}
  ${i.statement?`<span>Statement · ${esc(i.statement)}</span>`:''}
  ${i.tax_note?`<span>Tax treatment · ${esc(i.tax_note)}</span>`:''}
  ${i.evidence?`<span>Evidence · ${esc(i.evidence)}</span>`:''}
  ${i.notes?`<span>Proposal notes · ${esc(i.notes)}</span>`:''}
  ${taxEvidence}
  ${i.reason?`<span class="error">${esc(i.reason)}</span>`:''}${action?`<div>${action}</div>`:''}</div></article>`;
}
function mappingExceptions(g,esc){
 if(g.key!=='approve_statement_lines'||!g.blocked_count)return '';
 const exceptions=(g.exceptions||[]).map(x=>`<article class="approval-review-item is-blocked">
  <b>${esc(x.code)} · ${esc(x.label)}</b><div class="approval-item-detail">
  <span>Proposed line · ${esc(x.line)} · ${esc(x.statement)}</span>
  ${x.prepared_by?`<span>Prepared by ${esc(x.prepared_by)}</span>`:''}
  ${x.replaces?`<span>Replaces ${esc(x.replaces.line_code)} from ${esc(x.replaces.from)}</span>`:''}
  <span>${esc((x.reasons||[]).join(' '))}</span>
  <div>${btn('ap-map-open','Review this mapping',x.id)}</div></div></article>`).join('');
 return `<details class="approval-line-group"><summary>Individual review (${esc(g.exceptions?.length||0)})</summary>
  ${g.unchanged_count?`<p class="muted">${esc(g.unchanged_count)} draft mappings already have the same approved line.</p>`:''}
  ${exceptions}<p>${btn('ap-map-open','Open statement-line review')}</p></details>`;
}
export function drawerView(groups,selected,{esc=e0,failure=null,canEditTax=true,maxBatch=500,openSections=new Set()}={}){
 const selectedCount=[...selected.values()].reduce((n,ids)=>n+ids.size,0);
 const content=groups.map(g=>{
  const chosen=selected.get(g.key)||new Set(),sections=reviewSections(g);
  const body=sections.map(section=>{
   const eligible=section.items.filter(i=>i.eligible),count=eligible.filter(i=>chosen.has(String(i.id))).length;
   return `<details class="approval-line-group" data-ap-section="${esc(section.key)}" ${openSections.has(section.key)?'open':''}>
    <summary><b>${esc(section.title)}</b> · ${esc(eligible.length)} eligible · ${esc(section.items.length-eligible.length)} blocked</summary>
    ${eligible.length?`<label class="approval-section-select"><input type="checkbox" data-ap-section-select ${count===eligible.length?'checked':''}> Select all ${esc(eligible.length)} eligible in this group</label>`:''}
    ${section.items.map(i=>reviewRow(g,i,chosen,{esc,canEditTax})).join('')}</details>`;
  }).join('');
  return `<section class="approval-review-group"><div class="approval-review-heading"><h3>${esc(GROUP_TITLES[g.key])}</h3></div>${body||'<p class="muted">No records available for bulk approval.</p>'}${mappingExceptions(g,esc)}</section>`;
 }).join('');
 return `<div class="approval-drawer-content">
  ${failure?`<p class="info error" role="alert" tabindex="-1" id="apBatchError"><b>${esc(failure.title)}</b><br>${esc(failure.label?failure.label+' — ':'')}${esc(failure.message)}</p><div class="actions">${failure.action?btn(failure.action,'Open this record',failure.id):''}${btn('ap-review-reload','Reload Quick review')}</div>`:''}
  <div class="approval-drawer-tools"><p id="apSelectionStatus" aria-live="polite">${esc(selectedCount)} selected · Limit ${esc(maxBatch)} per batch</p>
   ${btn('ap-clear-selection','Clear selection','','disabled')}</div>
  ${content||'<p class="ok">No items are waiting in the selected groups.</p>'}
  <div class="approval-drawer-confirm">${btn('ap-preview-selected',`Preview selected (${selectedCount})`,'','class="primary" disabled')}</div></div>`;
}
function batchRows(groups,esc){
 return groups.map(g=>`<section><h3>${esc(GROUP_TITLES[g.key])} · ${esc(g.items.length)}</h3>
  <ul>${g.items.map(i=>`<li><b>${esc(i.code)} · ${esc(i.label)}</b>${i.statement_line?` · ${esc(i.statement_line)}`:''}
   ${period(i)?`<small>${esc(period(i))}</small>`:''}</li>`).join('')}</ul></section>`).join('');
}
export function batchPreviewView(groups,{esc=e0}={}){
 const count=groups.reduce((n,g)=>n+g.items.length,0);
 return `<div class="approval-batch"><p class="info">${esc(count)} selected records passed the batch checks.</p>
  ${batchRows(groups,esc)}
  <div class="approval-drawer-confirm"><ul>${groups.map(g=>`<li>${esc(REVIEW_CONFIRMATIONS[g.key])}</li>`).join('')}</ul>
   <label><input type="checkbox" data-ap-confirm> I confirm that I completed each applicable review above.</label>
   ${btn('ap-approve-selected',`Approve ${count} records`,'','class="primary" disabled')}</div></div>`;
}
export function batchReceiptView(result,{esc=e0}={}){
 const when=result.approved_at?new Intl.DateTimeFormat('en-KE',{timeZone:'Africa/Nairobi',dateStyle:'medium',timeStyle:'long'}).format(new Date(result.approved_at)):'';
 return `<div class="approval-batch"><p class="ok">${esc(result.total)} records approved</p><dl class="kv">
  <dt>Batch reference</dt><dd>${esc(result.batch_id)}</dd><dt>Reviewer</dt><dd>${esc(result.approved_by)}</dd><dt>Approved at</dt><dd>${esc(when)}</dd></dl>
  ${batchRows(result.groups,esc)}</div>`;
}
export function createMyApprovalsUI(ctx){
 const {request,modal}=ctx;
 let data=null,loading=false,failed='',f={...FILTER_DEFAULT},selectedGroups=new Set(),drawerGroups=[],drawerSelected=new Map();
 let maxBatch=500,batchBusy=false,reviewNeedsReload=false,preview=null,selectionView={};
 const el=id=>document.getElementById(id);
 const query=selector=>el('editorBody')?.querySelector(selector);
 async function load(){if(loading)return;loading=true;try{const r=await request({action:'settings_approvals_read'});if(!r||!Array.isArray(r.queues)||!Array.isArray(r.records)||!Array.isArray(r.actionGroups))throw Error('The approvals answer was not in the expected form.');data=r;failed='';}catch(e){failed=e.message||'My approvals could not be loaded.';}finally{loading=false;ctx.render();}}
 function card(){if(!['PARTNER','MANAGER'].includes(ctx.data().me?.category_code))return '';const wrap=inner=>`<section class="card settings-card" id="myApprovalsCard"><h2>Approval task board</h2>${inner}</section>`;if(!data&&!failed){queueMicrotask(load);return wrap('<p class="muted">Loading…</p>');}if(failed)return wrap(`<p class="error" role="alert">${e0(failed)}</p>`);return wrap(approvalsView(data,f,{esc:e0,selectedGroups}));}
 const selectionCount=()=>[...drawerSelected.values()].reduce((n,ids)=>n+ids.size,0);
 const selectionState=()=>({scroll:el('editorBody')?.scrollTop||0,openSections:new Set([...document.querySelectorAll('#editorBody [data-ap-section][open]')].map(section=>section.dataset.apSection))});
 function updateDrawerControls(){
  const count=selectionCount(),save=query('[data-suite="ap-preview-selected"]'),clear=query('[data-suite="ap-clear-selection"]'),label=el('apSelectionStatus');
  if(save){save.textContent=`Preview selected (${count})`;save.disabled=reviewNeedsReload||!count||count>maxBatch;}
  if(clear)clear.disabled=!count;
  if(label)label.textContent=count>maxBatch?`${count} selected · Remove ${count-maxBatch} to continue`:`${count} selected · Limit ${maxBatch} per batch`;
  for(const select of document.querySelectorAll('#editorBody [data-ap-section-select]')){
   const items=[...select.closest('[data-ap-section]').querySelectorAll('[data-ap-item]:not(:disabled)')],checked=items.filter(i=>i.checked).length;
   select.checked=items.length>0&&checked===items.length;
   select.indeterminate=checked>0&&checked<items.length;
  }
 }
 function paint(title,html,options={}){
  modal(title,html,null,null,{refreshWorkspace:false,...options});
  el('editor')?.classList.add('approval-drawer');
 }
 function paintDrawer({failure=null,scroll=0,focus=null,openSections=new Set()}={}){
  preview=null;
  const count=drawerGroups.length;
  paint(`Quick review · ${count} approval group${count===1?'':'s'}`,drawerView(drawerGroups,drawerSelected,{failure,maxBatch,openSections,canEditTax:ctx.canEditTax?.()??true}));
  const body=el('editorBody');
  if(body)body.scrollTop=scroll;
  if(focus){
   const row=[...body?.querySelectorAll('[data-approval-item]')||[]].find(node=>node.dataset.approvalItem===focus);
   if(row?.closest('details'))row.closest('details').open=true;
   (row?.querySelector('button')||row?.querySelector('input'))?.focus();
  }
  if(failure)el('apBatchError')?.focus();
  updateDrawerControls();
 }
 async function openReview(keys,{keepSelection=false,...view}={}){
  const r=await request({action:'settings_approval_items_read',queue_keys:keys}),next=r.groups||[];
  const previous=new Map(drawerGroups.map(g=>[g.key,new Map(groupItems(g).map(i=>[String(i.id),i.revision]))]));
  drawerSelected=new Map(next.map(g=>[g.key,new Set(groupItems(g).filter(i=>keepSelection&&i.eligible&&
   drawerSelected.get(g.key)?.has(String(i.id))&&String(previous.get(g.key)?.get(String(i.id)))===String(i.revision)).map(i=>String(i.id)))]));
  drawerGroups=next;
  maxBatch=Number(r.max_batch)||500;
  reviewNeedsReload=false;
  paintDrawer(view);
 }
 function selectInput(input,checked){
  const [key,id]=input.dataset.apItem.split('|'),ids=drawerSelected.get(key);
  if(!ids||input.disabled)return;
  input.checked=checked;
  if(checked)ids.add(id);else ids.delete(id);
 }
 if(typeof document!=='undefined')document.addEventListener('change',e=>{
  const k=e.target?.dataset?.ap;if(k&&data){f={...f,[k]:e.target.type==='checkbox'?e.target.checked:e.target.value};ctx.render();return;}
  if(e.target?.dataset?.apGroup){const key=e.target.dataset.apGroup;if(e.target.checked)selectedGroups.add(key);else selectedGroups.delete(key);ctx.render();return;}
  if(batchBusy)return;
  if(e.target?.dataset?.apItem){selectInput(e.target,e.target.checked);updateDrawerControls();return;}
  if(e.target?.hasAttribute('data-ap-section-select')){
   for(const input of e.target.closest('[data-ap-section]').querySelectorAll('[data-ap-item]:not(:disabled)'))selectInput(input,e.target.checked);
   updateDrawerControls();return;
  }
  if(e.target?.hasAttribute('data-ap-confirm')){const button=query('[data-suite="ap-approve-selected"]');if(button)button.disabled=!e.target.checked;}
 });
 if(typeof document!=='undefined')document.addEventListener('input',e=>{if(e.target?.dataset?.ap!=='q'||!data)return;f={...f,q:e.target.value};const body=el('apRecordsBody');if(body)body.innerHTML=recordsView(visibleRecords(data.records,f),{esc:e0});});
 const keys=()=>drawerGroups.map(g=>g.key);
 async function showRecord(action,id){
  const queue={ 'ap-rate-open':'approve_tax_rates','ap-chart-open':'approve_chart','ap-map-open':'approve_statement_lines' }[action];
  const group=drawerGroups.find(g=>g.key===queue),item=group&&groupItems(group).find(i=>String(i.id)===id);
  const state={...selectionState(),keepSelection:true,focus:id?encoded(queue,id):null};
  const back=()=>paintDrawer(state);
  if(action==='ap-map-open'){await ctx.openStatementReview({focusId:id,onBack:()=>openReview(keys(),state)});return;}
  if(!item)return;
  if(action==='ap-chart-open'){await ctx.openChartAccount(id,{onBack:()=>openReview(keys(),state)});return;}
  const saved=async()=>{
   try{await openReview(keys(),state);}catch(e){reviewNeedsReload=true;paintDrawer({...state,failure:{title:'The rule was saved. Quick review could not be refreshed.',message:e.message||'Reload Quick review to check the list.'}});}
   await load();
  };
  await ctx.openTaxRule(id,{onBack:back,afterSave:saved,focusSource:!!item.source_issue,readOnly:item.legal_review_status==='Confirmed'||ctx.canEditTax?.()===false});
 }
 function batchError(error,isPreview){
  const ref=error.approval_item,group=drawerGroups.find(g=>g.key===ref?.queue_key);
  const item=group&&groupItems(group).find(i=>String(i.id)===String(ref?.id));
  const rejected=error.status>=400&&error.status<500&&error.status!==408;
  reviewNeedsReload=error.status===409||(!isPreview&&!rejected);
  const action={approve_tax_rates:'ap-rate-open',approve_chart:'ap-chart-open',approve_statement_lines:'ap-map-open'}[ref?.queue_key];
  paintDrawer({...selectionView,failure:{
   title:isPreview?'The batch needs another check.':rejected?'Approval could not be completed. No items were approved.':'The approval result could not be verified.',
   label:item?[item.code,item.label].filter(Boolean).join(' · '):'',
   action:item?action:null,id:item?.id,
   message:error.status===504?'The server timed out. Reload Quick review to check which items are still waiting.':error.message||'Reload Quick review and try again.'
  }});
 }
 async function checkOrApprove(isPreview){
  const selections=isPreview?drawerGroups.map(g=>({queue_key:g.key,items:groupItems(g).filter(i=>i.eligible&&drawerSelected.get(g.key)?.has(String(i.id))).map(i=>({id:i.id,revision:i.revision}))})).filter(g=>g.items.length):preview?.selections;
  if(!selections?.length||reviewNeedsReload||batchBusy)return;
  if(isPreview&&selectionCount()>maxBatch)return;
  if(!isPreview&&!query('[data-ap-confirm]')?.checked)return;
  if(isPreview)selectionView=selectionState();
  const editor=el('editor'),body=el('editorBody'),back=el('closeEditor'),preventClose=e=>e.preventDefault();
  batchBusy=true;
  if(body){body.inert=true;body.setAttribute('aria-busy','true');}
  editor?.addEventListener('cancel',preventClose);
  if(back)back.disabled=true;
  try{
   const p=isPreview?{preview_only:true}:{review_confirmed:true,review_version:preview.version};
   const result=await request({action:'settings_approval_batch_approve',selections,...p});
   if(isPreview){
    if(!result.review_version||!Array.isArray(result.groups))throw Error('The batch preview could not be verified.');
    preview={selections,version:result.review_version};
    paint('Confirm batch approval',batchPreviewView(result.groups),{onBack:()=>paintDrawer(selectionView),backLabel:'Return to selection'});
   }else{
    paint('Approval receipt',batchReceiptView(result));
    preview=null;selectedGroups.clear();drawerGroups=[];drawerSelected.clear();data=null;failed='';ctx.render();await load();
   }
  }catch(error){batchError(error,isPreview);}
  finally{batchBusy=false;if(body){body.inert=false;body.removeAttribute('aria-busy');}editor?.removeEventListener('cancel',preventClose);if(back)back.disabled=false;}
 }
 async function handle(action,id){
  if(action==='ap-open'){const q=data?.queues.find(x=>x.key===id);if(q?.go)await ctx.openSection(q.go,q);return true;}
  if(['ap-rate-open','ap-chart-open','ap-map-open'].includes(action)){if(!batchBusy)await showRecord(action,id);return true;}
  if(action==='ap-review-reload'){if(!batchBusy)await openReview(keys(),{...selectionState(),keepSelection:true});return true;}
  if(action==='ap-review'){if(BULK_KEYS.has(id))await openReview([id]);return true;}
  if(action==='ap-bulk-open'){if(selectedGroups.size)await openReview([...selectedGroups]);return true;}
  if(action==='ap-clear-selection'){
   if(!batchBusy){for(const i of document.querySelectorAll('#editorBody [data-ap-item]:checked'))selectInput(i,false);updateDrawerControls();}
   return true;
  }
  if(action==='ap-preview-selected'||action==='ap-approve-selected'){await checkOrApprove(action==='ap-preview-selected');return true;}
  return false;
 }
 return {card,handle,refresh:()=>{data=null;failed='';}};
}
