// Settings hub (Settings page, top card). One list of every settings section, who should own it, and how much is still a default or waiting for approval.
// Read only: it changes nothing and links to nothing it does not name. Managers and Partners only.
import {searchSections} from './staff-settings-hub-rules.mjs?v=20261117-actions-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const OPEN_LABEL=o=>o?.view?'Go to the area':'Open';
// Owner column: the confirmed owner when a Partner has confirmed one, otherwise the build's suggestion, labelled as a suggestion (build 2839).
export const ownerText=s=>s.confirmed_owner?`${s.confirmed_owner.owner_label||s.confirmed_owner.owner_role}${s.confirmed_owner.staff_name?' · '+s.confirmed_owner.staff_name:''} (confirmed)`:`${s.owner} (suggested)`;
export const openButton=s=>s.go?`<button type="button" data-suite="hub-open" data-id="${esc(s.key)}" class="link">${OPEN_LABEL(s.go)}</button>`:'';
export function waitingView(hub){
 if(!hub.waiting.length)return '<p class="ok" id="hubWaiting">Nothing is waiting for approval.</p>';
 return `<div id="hubWaiting"><h3>Needs approval (${hub.waiting.reduce((n,s)=>n+s.pending,0)})</h3><ul>${hub.waiting.map(s=>`<li><b>${esc(s.pending)}</b> ${esc(s.title.toLowerCase())}: <small>${esc(s.where)}. ${esc(ownerText(s))}.</small> ${openButton(s)}</li>`).join('')}</ul></div>`;
}
export function tableView(sections){
 if(!sections.length)return '<p class="info">No settings section matches that search.</p>';
 let last='';
 return `<div class="scroll"><table id="hubTable"><thead><tr><th>Section</th><th>Owner</th><th>State</th><th>Where</th><th></th></tr></thead><tbody>${sections.map(s=>{
  const head=s.group!==last?(last=s.group,`<tr class="hub-group"><th colspan="5">${esc(s.group)}</th></tr>`):'';
  return `${head}<tr><td><b>${esc(s.title)}</b><small>${esc(s.about)}</small></td><td>${esc(ownerText(s))}</td><td><span class="badge ${s.pending?'warn':'ok'}">${esc(s.status)}</span></td><td>${esc(s.where)}</td><td>${openButton(s)}</td></tr>`;}).join('')}</tbody></table></div>`;
}
export function hubView(hub,q=''){
 return `<h2>Settings hub</h2><p class="muted">Every settings section in one list. A default is a value taken from a note or a suggestion that no Partner has yet confirmed in writing; it stays labelled until someone does. Use the Open button on a row to go straight to that setting. Owners are confirmed in the Owner Matrix under Access & Approvals.</p><p class="info">${esc(hub.note)}</p><p><b>${hub.defaults}</b> setting${hub.defaults===1?' is':'s are'} still a default.</p>${waitingView(hub)}<label class="full">Search settings<input id="hubSearch" type="search" value="${esc(q)}" maxlength="60" placeholder="For example: deadline, bank, licence"></label><div id="hubBody">${tableView(searchSections(hub.sections,q))}</div>`;
}

export function createSettingsHubUI(ctx){
 const {request}=ctx;
 let hub=null,loading=false,failed='',q='';
 async function load(){
  if(loading)return;loading=true;
  try{const r=await request({action:'settings_hub_read'});if(!r||!Array.isArray(r.sections)||!Array.isArray(r.waiting))throw Error('The settings hub answer was not in the expected form.');hub=r;failed='';}catch(e){failed=e.message||'The settings hub could not be loaded.';}
  finally{loading=false;ctx.render();}
 }
 function card(){
  if(!['PARTNER','MANAGER'].includes(ctx.data().me?.category_code))return '';
  if(!hub&&!failed){queueMicrotask(load);return '<section class="card" id="settingsHub"><h2>Settings hub</h2><p class="muted">Loading…</p></section>';}
  if(failed)return `<section class="card" id="settingsHub"><h2>Settings hub</h2><p class="error" role="alert">${esc(failed)}</p></section>`;
  return `<section class="card" id="settingsHub">${hubView(hub,q)}</section>`;
 }
 // The search box redraws only the table, so typing keeps its focus.
 if(typeof document!=='undefined')document.addEventListener('input',e=>{if(e.target?.id!=='hubSearch'||!hub)return;q=e.target.value;const body=document.getElementById('hubBody');if(body)body.innerHTML=tableView(searchSections(hub.sections,q));});
 async function handle(action,id){
  if(action!=='hub-open')return false;
  const s=hub?.sections.find(x=>x.key===id);if(s?.go)ctx.openSection(s.go,s);return true;
 }
 return {card,handle,refresh:()=>{hub=null;failed='';}};
}
