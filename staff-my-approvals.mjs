// My Approvals (build 2839), on the Settings overview. What is waiting for a decision, in two lists: queues (counts by setting type) and individual records,
// with filters: needs my action, state, owner, firm or client scope, effective date and a search. It only reads. Every row opens the setting's own screen, where that
// setting's own rule decides who may approve. "Needs my action" means it is waiting, you may act on that kind of item, and you did not prepare it.
import {visibleRecords,STATE_FILTERS} from './staff-approvals-filter.mjs?v=20261117-actions-v1';
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(action,label,id='',extra='')=>`<button type="button" data-suite="${action}" data-id="${e0(id)}" ${extra}>${e0(label)}</button>`;
export const FILTER_DEFAULT=Object.freeze({mine:true,state:'',owner:'',scope:'',from:'',to:'',q:''});
export function queuesView(queues,{mine,esc=e0}={}){
 const rows=(mine?queues.filter(q=>q.needs_my_action):queues);
 if(!rows.length)return `<p class="${queues.length?'muted':'ok'}" id="apQueues">${queues.length?'None of the waiting queues need your action.':'Nothing is waiting for approval.'}</p>`;
 return `<div class="scroll"><table id="apQueues"><thead><tr><th>Setting type</th><th class="num">Waiting</th><th>Owner</th><th>Where</th><th></th></tr></thead><tbody>${rows.map(q=>`<tr><td><b>${esc(q.title)}</b>${q.needs_my_action?' <span class="badge warn">Needs my action</span>':''}</td><td class="num">${esc(q.count)}</td><td>${esc(q.owner_label||'')}</td><td><small>${esc(q.where)}</small></td><td>${btn('ap-open','Open',q.key)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function recordsView(items,{esc=e0}={}){
 if(!items.length)return '<p class="muted" id="apRecords">No records match these filters.</p>';
 return `<div class="scroll"><table id="apRecords"><thead><tr><th>Record</th><th>State</th><th>Scope</th><th>Owner</th><th>Effective from</th><th>Prepared by</th><th></th></tr></thead><tbody>${items.slice(0,200).map(i=>`<tr><td><b>${esc(i.label)}</b><small>${esc(i.area_label)}</small></td><td>${esc(i.state)}${i.needs_my_action?' <span class="badge warn">Needs my action</span>':''}</td><td>${esc(i.scope)}</td><td>${esc(i.owner_label||'')}</td><td>${esc(i.effective_from||'')}</td><td>${esc(i.prepared_by||'')}</td><td>${btn('settings-record','Open',i.area+':'+i.record_id)}</td></tr>`).join('')}</tbody></table></div>${items.length>200?`<p class="muted">Showing the first 200 of ${esc(items.length)}. Narrow the filters.</p>`:''}`;
}
// Renewals (build 2840): lapsed or ending within 60 days. A lapsed authorisation or rule period blocks the work that uses it until it is renewed, so these come first.
export function renewalsView(items,{esc=e0}={}){
 if(!items||!items.length)return '<p class="ok" id="apRenewals">Nothing lapsed or ending within 60 days.</p>';
 const when=i=>i.lapsed?`Lapsed ${esc(-i.days)} day${i.days===-1?'':'s'} ago`:i.days===0?'Ends today':`Ends in ${esc(i.days)} day${i.days===1?'':'s'}`;
 return `<div class="scroll"><table id="apRenewals"><thead><tr><th>Record</th><th>What ends</th><th>Date</th><th>Owner</th><th></th></tr></thead><tbody>${items.map(i=>`<tr data-lapsed="${i.lapsed?'yes':'no'}"><td><b>${esc(i.label)}</b><small>${esc(i.area_label)}</small></td><td>${esc(i.what)}</td><td>${esc(i.date)} <span class="badge ${i.lapsed?'bad':'warn'}">${when(i)}</span></td><td>${esc(i.owner_label||'')}</td><td>${btn('settings-record','Open',i.area+':'+i.record_id)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function filtersView(f,data,{esc=e0}={}){
 const opt=(v,l,sel)=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(l)}</option>`;
 return `<div class="filters" id="apFilters"><label><input type="checkbox" data-ap="mine"${f.mine?' checked':''}> Needs my action</label>
  <label>State<select data-ap="state">${opt('','Any',f.state)}${STATE_FILTERS.map(s=>opt(s,s,f.state)).join('')}</select></label>
  <label>Owner<select data-ap="owner">${opt('','Any',f.owner)}${data.roles.map(r=>opt(r.code,r.label,f.owner)).join('')}</select></label>
  <label>Firm or client<select data-ap="scope">${opt('','Any',f.scope)}${opt('firm','Firm-wide',f.scope)}${data.scopes.map(s=>opt(s,s,f.scope)).join('')}</select></label>
  <label>Effective from<input type="date" data-ap="from" value="${esc(f.from)}"></label><label>Effective to<input type="date" data-ap="to" value="${esc(f.to)}"></label>
  <label>Search<input type="search" data-ap="q" value="${esc(f.q)}" maxlength="60"></label></div>`;
}
export function approvalsView(data,f,{esc=e0}={}){
 const recs=visibleRecords(data.records,f);
 return `<p class="muted">${esc(data.note)}</p><p class="muted">These are firm-wide settings. Client set-up (sections, charts, opening balances, routing mappings and service set-ups) is a separate queue. <button type="button" data-v3="setup-tasks">Open Client Setup Tasks</button></p>${filtersView(f,data,{esc})}<h3>Waiting by setting type</h3>${queuesView(data.queues,{mine:f.mine,esc})}<h3>Renewals</h3>${renewalsView(data.renewals,{esc})}<h3>Records</h3><p class="muted">Draft and In Review records. Choose another state to see approved, active, suspended or retired records.</p><div id="apRecordsBody">${recordsView(recs,{esc})}</div>`;
}
export function createMyApprovalsUI(ctx){
 const {request}=ctx;
 let data=null,loading=false,failed='',f={...FILTER_DEFAULT};
 async function load(){
  if(loading)return;loading=true;
  try{const r=await request({action:'settings_approvals_read'});if(!r||!Array.isArray(r.queues)||!Array.isArray(r.records))throw Error('The approvals answer was not in the expected form.');data=r;failed='';}catch(e){failed=e.message||'My approvals could not be loaded.';}
  finally{loading=false;ctx.render();}
 }
 function card(){
  if(!['PARTNER','MANAGER'].includes(ctx.data().me?.category_code))return '';
  const wrap=inner=>`<section class="card settings-card" id="myApprovalsCard"><h2>My approvals</h2>${inner}</section>`;
  if(!data&&!failed){queueMicrotask(load);return wrap('<p class="muted">Loading…</p>');}
  if(failed)return wrap(`<p class="error" role="alert">${e0(failed)}</p>`);
  return wrap(approvalsView(data,f));
 }
 if(typeof document!=='undefined')document.addEventListener('change',e=>{
  const k=e.target?.dataset?.ap;if(!k||!data)return;
  f={...f,[k]:e.target.type==='checkbox'?e.target.checked:e.target.value};ctx.render();
 });
 if(typeof document!=='undefined')document.addEventListener('input',e=>{
  if(e.target?.dataset?.ap!=='q'||!data)return;f={...f,q:e.target.value};
  const body=document.getElementById('apRecordsBody');if(body)body.innerHTML=recordsView(visibleRecords(data.records,f),{esc:e0});
 });
 async function handle(action,id){
  if(action!=='ap-open')return false;
  const q=data?.queues.find(x=>x.key===id);if(q?.go)ctx.openSection(q.go,q);return true;
 }
 return {card,handle,refresh:()=>{data=null;failed='';}};
}
