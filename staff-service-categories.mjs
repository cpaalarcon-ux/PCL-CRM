// Service categories and practice size, one click form (build 2843).
// The firm says how many practitioners it has. One practitioner: the Partner may put service categories (service templates) forward and approve them alone, recorded as a sole-Partner
// approval. Two or more: one person puts them forward and a different Partner or Manager approves. Several categories are ticked and put forward or approved in one go; each is checked on
// its own and the ones that cannot go ahead are listed with the reason. Nothing here edits a template.
// Build 2844: the same form retires several categories (a Partner, one reason) or proposes a new version of several (the same changes applied wherever the task exists). A new version is a draft
// that a different person approves.
// Build 2845: each version shows its effective-from and last-reviewed dates (an insert-only history). Dates can be recorded on their own for the ticked categories, or filled in with an approval or a new version.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>String(v||'').slice(0,10);

// Reads the three small text boxes into the structured changes the server takes. Returns {problem} when a line cannot be read.
export function parseChanges({drop='',due='',required='',suffix=''}={}){
 const parts=t=>String(t||'').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean);
 const out={drop_task_keys:parts(drop),due_days:{},mandatory:{},name_suffix:String(suffix||'').trim()};
 for(const x of parts(due)){const m=/^([a-z][a-z0-9_]*)\s*[=:]\s*(\d{1,3})$/.exec(x);if(!m)return {problem:`Due days: "${x}" should read like file_return=7.`};out.due_days[m[1]]=Number(m[2]);}
 for(const x of parts(required)){const m=/^([a-z][a-z0-9_]*)\s*[=:]\s*(required|optional)$/i.exec(x);if(!m)return {problem:`Required or optional: "${x}" should read like review_pack=optional.`};out.mandatory[m[1]]=m[2].toLowerCase()==='required';}
 return {values:out};
}
// The task keys across the ticked categories, with how many of the ticked ones have each, so the person can see what to type.
export function taskKeyHints(templates,ids){
 const pick=templates.filter(t=>ids.includes(t.template_id)),map=new Map();
 for(const t of pick)for(const k of t.task_list||[]){const e=map.get(k.task_key)||{task_key:k.task_key,task_name:k.task_name,count:0};e.count++;map.set(k.task_key,e);}
 return {ticked:pick.length,keys:[...map.values()].sort((a,b)=>b.count-a.count||a.task_key.localeCompare(b.task_key))};
}

export function practiceHtml(res,{esc=e0}={}){
 if(!res.firms.length)return '<p class="muted">No firm is available to your account.</p>';
 return `<p class="info">${esc(res.note)}</p>`+res.firms.map(f=>`<div class="card" data-firm="${esc(f.firm_id)}" data-mode="${esc(f.mode)}"><h3>${esc(f.legal_name)}</h3>
  <p><b>${esc(f.mode_label)}</b>${f.declared?`<br><span class="muted">Declared ${esc(f.declared.practitioners)} by ${esc(f.declared.declared_by_name||'')} on ${esc(day(f.declared.declared_at))}: ${esc(f.declared.reason)}</span>`:'<br><span class="muted">Nothing declared yet. The active Partners decide until a Partner declares.</span>'}<br><span class="muted">Active Partners with access: ${esc(f.active_partners)}</span></p>
  ${f.can_declare?`<form data-practice="${esc(f.firm_id)}" class="grid"><label>Number of practitioners<input type="number" name="practitioners" min="1" max="500" required value="${esc(f.declared?.practitioners??f.active_partners??1)}"></label><label class="full">Why (10 characters or more)<input name="reason" required minlength="10" maxlength="500" placeholder="Sole practitioner, no other Partner"></label><div class="actions full"><button type="submit">Declare</button></div></form>`:'<p class="muted">A Partner declares the number of practitioners.</p>'}
  ${f.history.length>1?`<details><summary>History (${f.history.length})</summary><ul>${f.history.map(h=>`<li>${esc(day(h.declared_at))}: ${esc(h.practitioners)} by ${esc(h.declared_by_name||'')}. ${esc(h.reason)}</li>`).join('')}</ul></details>`:''}</div>`).join('');
}

export function categoriesHtml(res,{esc=e0}={}){
 if(!res.templates.length)return '<p class="muted">There are no service categories yet.</p>';
 const state=t=>t.status==='Approved'?`<span class="badge ok">Approved</span><small>${esc(t.approved_by_name||'')} ${esc(day(t.approved_at))}</small>`:t.waiting?`<span class="badge warn">Waiting for approval</span><small>${t.submitted_by_name?'Put forward by '+esc(t.submitted_by_name):'Proposed by '+esc(t.proposed_by_name||'')}</small>`:'<span class="badge">Draft</span><small>Not yet put forward</small>';
 let group='',rows='';
 for(const t of res.templates){
  if(t.service_group!==group){group=t.service_group;rows+=`<tr class="group"><th colspan="4">${esc(group)}</th></tr>`;}
  const hint=t.status==='Draft'?[t.can_submit?'':t.submit_problem,t.can_approve?'':t.approve_problem].filter(Boolean).join(' '):t.can_propose?'':t.propose_problem||'';
  rows+=`<tr data-template="${esc(t.template_id)}" data-status="${esc(t.status)}"><td><input type="checkbox" data-sc-pick="${esc(t.template_id)}" data-submit="${t.can_submit?'1':'0'}" data-approve="${t.can_approve?'1':'0'}" data-retire="${t.can_retire?'1':'0'}" data-propose="${t.can_propose?'1':'0'}" aria-label="Select ${esc(t.name)}"></td><td><b>${esc(t.name)}</b><small>${esc(t.template_code)} version ${esc(t.version)}${t.source==='Starter'?' · starter':''}</small></td><td>${esc(t.tasks)} tasks<small>${esc(t.services)}</small></td><td>${state(t)}<small class="dates">${esc(t.dates_line||'No dates recorded')}</small>${hint?`<small class="muted">${esc(hint)}</small>`:''}</td></tr>`;
 }
 const drafts=res.templates.filter(t=>t.status==='Draft').length;
 return `<p class="info">${res.sole?'You are the only practitioner, so you may put forward and approve these yourself (recorded as a sole-Partner approval).':'Put them forward, then a different Partner or Manager approves. You cannot approve what you put forward yourself.'}</p>
  ${drafts?`<div class="actions"><button type="button" data-sc="all-submit">Tick all that can be put forward</button><button type="button" data-sc="all-approve">Tick all that can be approved</button><button type="button" data-sc="none">Clear ticks</button><span id="scCount" class="muted"></span></div>`:''}
  <div class="scroll"><table id="serviceCategories"><thead><tr><th></th><th>Service category</th><th>Tasks and services</th><th>State</th></tr></thead><tbody>${rows}</tbody></table></div>
  <fieldset id="scDates"><legend>Dates for the ticked categories</legend>
   <p class="muted">Effective from is when this version applies. Last reviewed is when someone last checked its tasks and due days. Fill in one or both. Press the button below to record them on the ticked categories, or leave them filled in and they are recorded with <b>Approve</b> and with <b>New version</b> as well. The earlier dates stay in the history.</p>
   <div class="grid"><label>Effective from<input type="date" id="scEffective"></label><label>Last reviewed<input type="date" id="scReviewed"></label>
   <label class="full">Note (optional)<input id="scDatesNote" maxlength="500" placeholder="for example Reviewed against the 2027 Finance Act changes"></label></div>
   <div class="actions"><button type="button" data-sc="check-dates">Check: record dates on ticked</button></div></fieldset>
  ${drafts?`<div class="actions"><button type="button" data-sc="check-submit">Check: put ticked forward</button><button type="button" class="primary" data-sc="check-approve">Check: approve ticked</button></div>`:''}
  <div class="actions"><button type="button" data-sc="all-propose">Tick all that can have a new version</button></div>
  <fieldset id="scVersion"><legend>New version of the ticked approved categories</legend>
   <p class="muted">The same changes are made to each ticked category wherever the task exists. A category without the task is left alone and the result says so. A new version is a draft: a different Partner or Manager approves it, and the version it replaces is retired only then.</p>
   <div class="grid"><label class="full">Tasks to remove (task keys, separated by commas)<input id="scDrop" placeholder="for example send_reminder"></label>
   <label class="full">Due days (key=days, 0 to 366)<input id="scDue" placeholder="for example file_return=7, review=3"></label>
   <label class="full">Required or optional (key=required or key=optional)<input id="scRequired" placeholder="for example review_pack=optional"></label>
   <label>Add to the name<input id="scSuffix" maxlength="60" placeholder="for example (2027)"></label></div>
   <div id="scKeys" class="muted"></div>
   <div class="actions"><button type="button" data-sc="check-propose">Check: propose a new version of ticked</button></div></fieldset>
  ${res.can_retire?`<fieldset id="scRetire"><legend>Retire the ticked categories</legend>
   <p class="muted">Only a Partner retires. The same reason is recorded on each. A retired category cannot be used for new engagements; engagements already set up keep their tasks.</p>
   <label class="full">Why (5 to 500 characters)<input id="scReason" maxlength="500" placeholder="for example Replaced by the 2027 service list"></label>
   <div class="actions"><button type="button" data-sc="check-retire">Check: retire ticked</button></div></fieldset>`:''}
  <div id="scResults" aria-live="polite"></div>`;
}

export function resultsHtml(r,{esc=e0}={}){
 const word={submit:'put forward',approve:'approved',retire:'retired',propose:'proposed as a new version',dates:'given dates'}[r.kind]||'done',s=r.summary;
 const line=x=>`<tr data-outcome="${esc(x.outcome)}"><td>${esc(x.label)}</td><td>${x.outcome==='Skipped'?esc(x.reason):`<span class="badge ok">${esc(x.outcome)}</span>${x.version?`<small>${r.dry?'Would be version '+esc(x.version)+', a draft for a different person to approve':'New version '+esc(x.version)+', a draft waiting for approval'}</small>`:''}${x.sole_approval?'<small>Sole-Partner approval, recorded</small>':''}${x.note?`<small>${esc(x.note)}</small>`:''}`}</td></tr>`;
 const good=r.results.filter(x=>x.outcome!=='Skipped'),bad=r.results.filter(x=>x.outcome==='Skipped');
 return `<div class="notice ${s.skipped?'warn':'info'}" id="scSummary" role="status"><b>${esc(s.total)} checked: ${esc(s.done)} ${r.dry?'ready to be '+word:word}, ${esc(s.skipped)} not.</b>${r.dry?' Nothing has changed yet.':''}</div>
  ${good.length?`<h3>${r.dry?'Ready':'Done'} (${good.length})</h3><div class="scroll"><table id="scGood"><tbody>${good.map(line).join('')}</tbody></table></div>`:''}
  ${bad.length?`<h3>Not done (${bad.length})</h3><div class="scroll"><table id="scBad"><tbody>${bad.map(line).join('')}</tbody></table></div>`:''}`;
}

export function createServiceCategoriesUI(ctx){
 const {$,esc,request,notice,show}=ctx;
 let pending=null,all=[];
 const host=()=>$('#editorBody');
 const ticked=()=>[...host().querySelectorAll('[data-sc-pick]:checked')].map(x=>x.dataset.scPick);
 async function load(){
  const [prac,cats]=await Promise.all([request({action:'practice_read'}),request({action:'service_category_read'})]);
  show('Service categories and practice size','<h2>Practice size</h2><div id="scPractice"></div><h2>Service categories</h2><div id="scCategories"></div>');
  all=cats.templates;const h=host();h.querySelector('#scPractice').innerHTML=practiceHtml(prac,{esc});h.querySelector('#scCategories').innerHTML=categoriesHtml(cats,{esc});
  pending=null;count();
  h.onsubmit=async ev=>{const f=ev.target.closest('[data-practice]');if(!f)return;ev.preventDefault();const d=new FormData(f);
   try{await request({action:'practice_declare',firm_id:f.dataset.practice,practitioners:d.get('practitioners'),reason:d.get('reason')});notice('Declared.');await load();}catch(err){notice(err.message,true);}};
  h.onchange=ev=>{if(ev.target.matches('[data-sc-pick]')){pending=null;count();hints();}};
  h.oninput=ev=>{if(ev.target.closest('#scVersion,#scRetire,#scDates'))pending=null;};
  h.onclick=async ev=>{const b=ev.target.closest('[data-sc]');if(!b)return;const k=b.dataset.sc;
   if(k==='none'){for(const x of h.querySelectorAll('[data-sc-pick]'))x.checked=false;pending=null;count();hints();}
   else if(k==='all-submit'||k==='all-approve'||k==='all-propose'){const a=k.slice(4);for(const x of h.querySelectorAll('[data-sc-pick]'))x.checked=x.dataset[a]==='1';pending=null;count();hints();}
   else if(k.startsWith('check-'))await check({'check-submit':'service_category_submit','check-approve':'service_category_approve','check-retire':'service_category_retire','check-propose':'service_category_propose','check-dates':'service_category_dates'}[k]);
   else if(k==='apply')await apply();
  };
 }
 function hints(){const el=host().querySelector('#scKeys');if(!el)return;const {ticked:n,keys}=taskKeyHints(all,ticked());el.innerHTML=n&&keys.length?`<details><summary>Task keys in the ${n} ticked (${keys.length})</summary><ul>${keys.map(k=>`<li><code>${esc(k.task_key)}</code> ${esc(k.task_name)} <small>${k.count} of ${n}</small></li>`).join('')}</ul></details>`:'';}
 // What is typed in the form for this action, as the server takes it. A problem is returned for a line that cannot be read.
 function extra(action){
  const h=host(),v=id=>h.querySelector(id)?.value||'';
  const dates={effective_from:v('#scEffective'),last_reviewed:v('#scReviewed'),dates_note:v('#scDatesNote')};
  if(action==='service_category_dates')return {values:dates};
  if(action==='service_category_approve')return {values:dates.effective_from||dates.last_reviewed?dates:{}};
  if(action==='service_category_retire')return {values:{reason:v('#scReason')}};
  if(action==='service_category_propose'){const c=parseChanges({drop:v('#scDrop'),due:v('#scDue'),required:v('#scRequired'),suffix:v('#scSuffix')});if(c.values&&(dates.effective_from||dates.last_reviewed))Object.assign(c.values,dates);return c;}
  return {values:{}};
 }
 function count(){const c=host().querySelector('#scCount');if(c)c.textContent=ticked().length+' ticked';}
 async function check(action){
  const ids=ticked();if(!ids.length){notice('Tick at least one service category.',true);return;}
  const x=extra(action);if(x.problem){notice(x.problem,true);return;}
  try{const r=await request({action,template_ids:ids,dry:true,...x.values});pending={action,ids,ready:r.summary.done,extra:JSON.stringify(x.values)};
   host().querySelector('#scResults').innerHTML=resultsHtml(r,{esc})+(r.summary.done?`<div class="actions"><label class="check"><input type="checkbox" id="scConfirm"> I have checked this list</label><button type="button" class="primary" data-sc="apply">${{service_category_submit:'Put forward',service_category_approve:'Approve',service_category_retire:'Retire',service_category_propose:'Propose a new version of',service_category_dates:'Record dates on'}[action]} ${esc(r.summary.done)} ready</button></div>`:'<p class="muted">Nothing is ready. Fix the reasons above.</p>');}
  catch(err){notice(err.message,true);}
 }
 async function apply(){
  const h=host(),cur=ticked().join(',');
  if(!pending||pending.ids.join(',')!==cur){notice('Check the list again: the ticks changed.',true);return;}
  if(!h.querySelector('#scConfirm')?.checked){notice('Tick the box to confirm you have checked the list.',true);return;}
  const x=extra(pending.action);if(x.problem||JSON.stringify(x.values)!==pending.extra){notice('Check the list again: what you typed changed.',true);return;}
  try{const r=await request({action:pending.action,template_ids:pending.ids,confirm:true,...x.values});notice(`${r.summary.done} done, ${r.summary.skipped} not.`);const keep=resultsHtml(r,{esc});await load();h.querySelector('#scResults').innerHTML=keep;}
  catch(err){notice(err.message,true);}
 }
 return {open:load};
}
