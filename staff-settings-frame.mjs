// Settings record page and overview feeds (build 2837).
// One layout for every setting: breadcrumb, title, status and version, four tabs (Overview, Configuration, Versions & Approvals, Change History) and an action bar.
// The server (settings-overview-actions.ts, settings-state-rules.mjs) owns every rule. This module only draws what it is given and opens the setting's own screen.
// Nothing here edits a record. The action bar opens each setting's existing editor, and that editor's server decides who may approve.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateOf=v=>String(v||'').slice(0,10);

export const RECORD_TABS=Object.freeze([['overview','Overview'],['configuration','Configuration'],['versions','Versions & Approvals'],['history','Change History']]);
export const STATE_ORDER=Object.freeze(['Draft','In Review','Approved','Active','Suspended','Retired']);
export const STATE_NOTE=Object.freeze({
 Draft:'Being prepared. Not used for any calculation or file.',
 'In Review':'Waiting for a decision, a confirmation or a verification.',
 Approved:'Approved, but its start date has not come.',
 Active:'In force and used.',
 Suspended:'Lapsed (expired). It blocks use until it is renewed. There is no manual suspend yet.',
 Retired:'Ended or superseded. Kept for history. Never edited.'
});
export const FRAME_NOTE='Every setting keeps its own approval path. The six states are a shared reading of them. An approved record is never edited: a change starts a new draft version, and the earlier record is kept for the periods it was used in.';
const tone=s=>({Active:'ok',Approved:'ok','In Review':'warn',Suspended:'bad',Draft:'',Retired:'muted'}[s]??'');
export const stateBadge=s=>`<span class="badge ${tone(s)}">${esc(s)}</span>`;
const btn=(action,label,id='',extra='')=>`<button type="button" data-suite="${esc(action)}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
const recordKey=(area,id)=>`${area}:${id}`;
export const parseKey=k=>{const i=String(k||'').indexOf(':');return i<0?{area:'',id:''}:{area:k.slice(0,i),id:k.slice(i+1)};};

// ---- Overview feeds (Settings > Overview) ---------------------------------------------------------------------------------
export function feedsView(ov){
 const head=`<tr><th>Area</th>${STATE_ORDER.map(s=>`<th class="num">${esc(s)}</th>`).join('')}</tr>`;
 const body=ov.areas.map(a=>`<tr><td><b>${esc(a.label)}</b><small>${esc(a.group)}</small></td>${STATE_ORDER.map(s=>`<td class="num">${a.counts[s]?esc(a.counts[s]):'<span class="muted">0</span>'}</td>`).join('')}</tr>`).join('');
 const open=(i,text)=>btn('settings-record',text,recordKey(i.area,i.record_id),'class="link"');
 const pending=ov.pending.length?`<ul>${ov.pending.map(g=>`<li><b>${esc(g.count)}</b> ${esc(g.label.toLowerCase())}: ${g.items.map(i=>open(i,i.label)).join(', ')}${g.count>g.items.length?` <small class="muted">and ${esc(g.count-g.items.length)} more</small>`:''}</li>`).join('')}</ul>`:'<p class="ok">Nothing is waiting for a decision.</p>';
 const expiring=ov.expiring.length?`<ul>${ov.expiring.map(e=>`<li>${open(e,e.label)} <small>${esc(e.area_label)}: ${esc(e.what)} ${e.lapsed?`<b class="bad-text">ended ${esc(-e.days)} day${e.days===-1?'':'s'} ago</b>`:e.days===0?'<b>ends today</b>':`ends in ${esc(e.days)} day${e.days===1?'':'s'}`} (${esc(e.date)})</small></li>`).join('')}</ul>${ov.expiring_total>ov.expiring.length?`<p class="muted">${esc(ov.expiring_total-ov.expiring.length)} more not shown.</p>`:''}`:`<p class="ok">Nothing ends in the next ${esc(ov.horizon)} days.</p>`;
 const failing=ov.failing.length?`<ul>${ov.failing.map(f=>`<li>${open(f,f.label)} <small>${esc(f.area_label)}: ${esc(f.message)}</small></li>`).join('')}</ul>${ov.failing_total>ov.failing.length?`<p class="muted">${esc(ov.failing_total-ov.failing.length)} more not shown. Open a record to see its checks.</p>`:''}`:'<p class="ok">No setting fails its checks.</p>';
 const recent=ov.recent.length?`<ul>${ov.recent.map(c=>`<li>${open(c,c.label)} <small>${esc(c.area_label)}: ${esc(c.action.toLowerCase())}${c.status_before&&c.status_after&&c.status_before!==c.status_after?` from ${esc(c.status_before)} to ${esc(c.status_after)}`:c.status_after&&c.action==='Created'?` as ${esc(c.status_after)}`:''}${c.actor?` by ${esc(c.actor)}`:''}, ${esc(dateOf(c.occurred_at))}</small></li>`).join('')}</ul>`:'<p class="muted">No change has been recorded yet.</p>';
 return `<section class="card" id="settingsFeeds"><h2>Settings overview</h2><p class="muted">${esc(FRAME_NOTE)}</p>
 <div class="scroll"><table id="settingsStates"><thead>${head}</thead><tbody>${body}</tbody></table></div>
 <div class="grid two"><div id="feedPending"><h3>Waiting for a decision (${esc(ov.pending_total)})</h3>${pending}</div><div id="feedExpiring"><h3>Ending soon or ended (${esc(ov.expiring_total)})</h3>${expiring}</div></div>
 <div class="grid two"><div id="feedFailing"><h3>Failed checks (${esc(ov.failing_total)})</h3>${failing}</div><div id="feedRecent"><h3>Recent changes</h3>${recent}</div></div>
 <p class="muted">Per-client records (a client's chart, mappings and employees) are in that client's Setup, and a month's work is in its project, not here.</p></section>`;
}

// ---- Record page ------------------------------------------------------------------------------------------------------------
function statusBar(r){
 const parts=[stateBadge(r.state),`<span class="muted">${esc(r.native_status.replace('_',' '))}</span>`];
 if(r.version!=null)parts.push(`<span>Version ${esc(r.version)}</span>`);
 if(r.effective_from||r.effective_to)parts.push(`<span>Effective ${esc(r.effective_from||'from the start')} to ${esc(r.effective_to||'no end date')}</span>`);
 if(r.expires_on)parts.push(`<span>Expires ${esc(r.expires_on)}</span>`);
 parts.push(r.approver?`<span>Approved by ${esc(r.approver)}${r.approved_at?` on ${esc(dateOf(r.approved_at))}`:''}</span>`:`<span class="muted">Not approved yet${r.prepared_by?` (prepared by ${esc(r.prepared_by)})`:''}</span>`);
 return `<div class="status-bar" id="recordStatus">${parts.join(' · ')}</div>`;
}
function actionBar(actions){
 if(!actions.length)return '<p class="muted" id="recordActions">You can read this record. Managers and Partners can open its editor.</p>';
 const items=actions.map(a=>a.kind==='svc'?`<button type="button" data-svc="${esc(a.action)}" data-id="${esc(a.id)}" data-rev="${esc(a.rev??'')}"${a.key==='approve'?' class="primary"':''}>${esc(a.label)}</button>`:btn(a.action,a.label,a.id,a.key==='approve'?'class="primary"':''));
 const notes=[...new Set(actions.map(a=>a.note).filter(Boolean))];
 return `<div id="recordActions"><div class="actions">${items.join('')}</div><p class="muted">Save draft, Validate and Submit for review are the buttons inside each editor; this bar opens the editor. ${notes.map(esc).join(' ')}</p></div>`;
}
const checksView=c=>c.length?`<ul id="recordChecks">${c.map(x=>`<li>${x.ok?'<span class="badge ok">Pass</span>':'<span class="badge bad">Fix</span>'} ${esc(x.message)}</li>`).join('')}</ul>`:'<p class="muted" id="recordChecks">No check applies to this record.</p>';
function tabPanel(tab,d){
 const r=d.record;
 if(tab==='configuration'){
  const fields=`<dl class="kv" id="recordFields">${d.fields.map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  let tax='';
  if(d.tax){const p=Object.entries(d.tax.parameters||{}).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(typeof v==='object'?JSON.stringify(v):v)}</dd>`).join('');
   tax=`<h3>Rule figures and source</h3>${p?`<dl class="kv">${p}</dl>`:'<p class="muted">No figures are entered. They wait for the Tax Lead\'s written confirmation.</p>'}${d.tax.source_url?`<p>Source: <a href="${esc(d.tax.source_url)}" target="_blank" rel="noopener noreferrer">${esc(d.tax.source_url)}</a></p>`:''}${d.tax.source_note?`<p>${esc(d.tax.source_note)}</p>`:''}${d.tax.legal_citation?`<p>Legal basis: ${esc(d.tax.legal_citation)}</p>`:''}`;}
  return `${fields}${tax}<p class="muted">This tab reads only. To change something, use the action bar: an active record is never edited, a change starts a new draft.</p>`;
 }
 if(tab==='versions'){
  const rows=d.versions.map(v=>`<tr${v.current?' class="current"':''}><td>${v.current?'<b>This record</b>':btn('settings-record','Open',recordKey(r.area,v.record_id),'class="link"')}</td><td>${stateBadge(v.state)}</td><td>${esc(v.version??'')}</td><td>${esc(v.effective_from||'')} to ${esc(v.effective_to||'')}</td><td>${esc(v.prepared_by||'')}</td><td>${esc(v.approver||'')}${v.approved_at?`<small>${esc(dateOf(v.approved_at))}</small>`:''}</td></tr>`).join('');
  return `<div class="scroll"><table id="recordVersions"><thead><tr><th></th><th>State</th><th>Version</th><th>Effective</th><th>Prepared by</th><th>Approved by</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">The person who prepared a record never approves it. An earlier version stays in force for the periods it covers.</p>`;
 }
 if(tab==='history'){
  if(!d.history.length)return '<p class="muted" id="recordHistory">No change is recorded for this record yet.</p>';
  return `<div class="scroll"><table id="recordHistory"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Status</th><th>Fields changed</th></tr></thead><tbody>${d.history.map(h=>`<tr><td>${esc(dateOf(h.occurred_at))}<small>${esc(String(h.occurred_at).slice(11,16))} UTC</small></td><td>${esc(h.actor||'')}</td><td>${esc(h.action)}</td><td>${h.status_before&&h.status_after&&h.status_before!==h.status_after?`${esc(h.status_before)} to ${esc(h.status_after)}`:esc(h.status_after||'')}</td><td>${esc((h.fields||[]).join(', '))}</td></tr>`).join('')}</tbody></table></div>`;
 }
 return `<p>${esc(STATE_NOTE[r.state]||'')}</p><h3>Checks</h3>${checksView(d.checks)}`;
}
export function recordView(d,tab='overview'){
 const r=d.record,t=RECORD_TABS.some(x=>x[0]===tab)?tab:'overview';
 return `<section class="card" id="settingsRecord"><p class="muted settings-crumb">Settings → ${esc(d.group)} → ${esc(d.area_label)}</p>
 <div class="section-head"><h2>${esc(r.label)}</h2>${btn('settings-record-close','Back to Settings')}</div>${statusBar(r)}
 <div class="actions subnav" role="tablist" aria-label="Record sections">${RECORD_TABS.map(([c,l])=>btn('settings-record-tab',l,c,`role="tab" aria-selected="${c===t}" class="${c===t?'primary':''}"`)).join('')}</div>
 <div id="recordPanel" role="tabpanel">${tabPanel(t,d)}</div>${actionBar(d.actions)}</section>`;
}

// ---- "Configure this setting" -----------------------------------------------------------------------------------------------------
// A blocker in a piece of work names the setting that fixes it. The link takes the person to that setting and brings them back to the same place.
export const CONFIGURE_TARGETS=Object.freeze({
 export_profile:{area:'export_profile',label:'Statutory export profile',tab:'templates',where:'Settings → Upload & Export Templates → Statutory export profiles'},
 routing_map:{area:'routing_map',label:'Routing mapping',view:'clients',where:'Clients → open the client → Client Setup → Routing map'},
 eligibility:{area:'eligibility',label:'Service eligibility',tab:'services',where:'Settings → Service Catalogue → Service eligibility'},
 tax_rate:{area:'tax_rate',label:'Tax rule',tab:'accounting',where:'Settings → Accounting & Tax Rules → Tax rules'}
});
export function returnBar(ret){
 if(!ret)return '';
 return `<div class="notice info" id="configureReturn" role="status"><span>You came here from <b>${esc(ret.label)}</b>. ${ret.where?`Make the change in ${esc(ret.where)}, then go back.`:'Make the change, then go back.'}</span> ${btn('configure-return','Return to '+ret.label,'','class="primary"')} ${btn('configure-cancel','Stay in Settings')}</div>`;
}
export const configureButton=(kind,from,esc2=esc)=>CONFIGURE_TARGETS[kind]?`<button type="button" class="configure-link" data-suite="configure-go" data-id="${esc2(kind)}::${esc2(from)}">Configure this setting</button>`:'';
export function parseConfigure(id){const [kind,...rest]=String(id||'').split('::');return {kind,from:rest.join('::')||'your work',target:CONFIGURE_TARGETS[kind]||null};}

export function createSettingsFrameUI(ctx){
 const {request,notice}=ctx;
 let ov=null,failed='',loading=false,rec=null,tab='overview',ret=null,recFailed='';
 async function loadOverview(){
  if(loading)return;loading=true;
  try{const r=await request({action:'settings_overview_read'});if(!r||!Array.isArray(r.areas)||!Array.isArray(r.pending))throw Error('The settings overview answer was not in the expected form.');ov=r;failed='';}catch(e){failed=e.message||'The settings overview could not be loaded.';}
  finally{loading=false;ctx.render();}
 }
 function card(){
  if(!['PARTNER','MANAGER'].includes(ctx.data().me?.category_code))return '';
  if(!ov&&!failed){queueMicrotask(loadOverview);return '<section class="card" id="settingsFeeds"><h2>Settings overview</h2><p class="muted">Loading…</p></section>';}
  if(failed)return `<section class="card" id="settingsFeeds"><h2>Settings overview</h2><p class="error" role="alert">${esc(failed)}</p></section>`;
  return feedsView(ov);
 }
 const page=()=>rec?recordView(rec,tab):recFailed?`<section class="card" id="settingsRecord"><p class="error" role="alert">${esc(recFailed)}</p>${btn('settings-record-close','Back to Settings')}</section>`:'';
 const open=()=>!!rec||!!recFailed;
 const bar=()=>returnBar(ret);
 async function handle(action,id){
  if(action==='settings-record'){const {area,id:rid}=parseKey(id);recFailed='';try{rec=await request({action:'settings_record_read',area,record_id:rid});tab='overview';}catch(e){rec=null;recFailed=e.message||'The record could not be opened.';}ctx.render();return true;}
  if(action==='settings-record-tab'){tab=id;ctx.render();return true;}
  if(action==='settings-record-close'){const t=rec?.tab;rec=null;recFailed='';ov=null;if(t)ctx.setSettingsTab(t);ctx.render();return true;}
  if(action==='configure-go'){
   const {kind,from,target}=parseConfigure(id);if(!target){notice('That setting cannot be opened from here.');return true;}
   if(target.view){document.getElementById('editor')?.close?.();ctx.navigate(target.view);notice(`Opened Clients. ${target.label}: ${target.where}.`);return true;}
   ret={label:from,where:target.where,hash:ctx.currentHash()};rec=null;recFailed='';ctx.setSettingsTab(target.tab);
   document.getElementById('editor')?.close?.();ctx.navigate('firms');return true;
  }
  if(action==='configure-return'){const h=ret?.hash;ret=null;ov=null;ctx.goHash(h||'#view=home');return true;}
  if(action==='configure-cancel'){ret=null;ctx.render();return true;}
  return false;
 }
 return {card,page,open,bar,handle,refresh:()=>{ov=null;failed='';},returning:()=>!!ret};
}
