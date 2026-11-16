// Service categories and practice size, one click form (build 2843).
// The firm says how many practitioners it has. One practitioner: the Partner may put service categories (service templates) forward and approve them alone, recorded as a sole-Partner
// approval. Two or more: one person puts them forward and a different Partner or Manager approves. Several categories are ticked and put forward or approved in one go; each is checked on
// its own and the ones that cannot go ahead are listed with the reason. Nothing here edits a template.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>String(v||'').slice(0,10);

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
  const hint=t.status==='Draft'?[t.can_submit?'':t.submit_problem,t.can_approve?'':t.approve_problem].filter(Boolean).join(' '):'';
  rows+=`<tr data-template="${esc(t.template_id)}" data-status="${esc(t.status)}"><td>${t.status==='Draft'?`<input type="checkbox" data-sc-pick="${esc(t.template_id)}" data-submit="${t.can_submit?'1':'0'}" data-approve="${t.can_approve?'1':'0'}" aria-label="Select ${esc(t.name)}">`:''}</td><td><b>${esc(t.name)}</b><small>${esc(t.template_code)} version ${esc(t.version)}${t.source==='Starter'?' · starter':''}</small></td><td>${esc(t.tasks)} tasks<small>${esc(t.services)}</small></td><td>${state(t)}${hint?`<small class="muted">${esc(hint)}</small>`:''}</td></tr>`;
 }
 const drafts=res.templates.filter(t=>t.status==='Draft').length;
 return `<p class="info">${res.sole?'You are the only practitioner, so you may put forward and approve these yourself (recorded as a sole-Partner approval).':'Put them forward, then a different Partner or Manager approves. You cannot approve what you put forward yourself.'}</p>
  ${drafts?`<div class="actions"><button type="button" data-sc="all-submit">Tick all that can be put forward</button><button type="button" data-sc="all-approve">Tick all that can be approved</button><button type="button" data-sc="none">Clear ticks</button><span id="scCount" class="muted"></span></div>`:''}
  <div class="scroll"><table id="serviceCategories"><thead><tr><th></th><th>Service category</th><th>Tasks and services</th><th>State</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${drafts?`<div class="actions"><button type="button" data-sc="check-submit">Check: put ticked forward</button><button type="button" class="primary" data-sc="check-approve">Check: approve ticked</button></div>`:''}
  <div id="scResults" aria-live="polite"></div>`;
}

export function resultsHtml(r,{esc=e0}={}){
 const word=r.kind==='submit'?'put forward':'approved',s=r.summary;
 const line=x=>`<tr data-outcome="${esc(x.outcome)}"><td>${esc(x.label)}</td><td>${x.outcome==='Skipped'?esc(x.reason):`<span class="badge ok">${esc(x.outcome)}</span>${x.sole_approval?'<small>Sole-Partner approval, recorded</small>':''}`}</td></tr>`;
 const good=r.results.filter(x=>x.outcome!=='Skipped'),bad=r.results.filter(x=>x.outcome==='Skipped');
 return `<div class="notice ${s.skipped?'warn':'info'}" id="scSummary" role="status"><b>${esc(s.total)} checked: ${esc(s.done)} ${r.dry?'ready to be '+word:word}, ${esc(s.skipped)} not.</b>${r.dry?' Nothing has changed yet.':''}</div>
  ${good.length?`<h3>${r.dry?'Ready':'Done'} (${good.length})</h3><div class="scroll"><table id="scGood"><tbody>${good.map(line).join('')}</tbody></table></div>`:''}
  ${bad.length?`<h3>Not done (${bad.length})</h3><div class="scroll"><table id="scBad"><tbody>${bad.map(line).join('')}</tbody></table></div>`:''}`;
}

export function createServiceCategoriesUI(ctx){
 const {$,esc,request,notice,show}=ctx;
 let pending=null;
 const host=()=>$('#editorBody');
 const ticked=()=>[...host().querySelectorAll('[data-sc-pick]:checked')].map(x=>x.dataset.scPick);
 async function load(){
  const [prac,cats]=await Promise.all([request({action:'practice_read'}),request({action:'service_category_read'})]);
  show('Service categories and practice size','<h2>Practice size</h2><div id="scPractice"></div><h2>Service categories</h2><div id="scCategories"></div>');
  const h=host();h.querySelector('#scPractice').innerHTML=practiceHtml(prac,{esc});h.querySelector('#scCategories').innerHTML=categoriesHtml(cats,{esc});
  pending=null;count();
  h.onsubmit=async ev=>{const f=ev.target.closest('[data-practice]');if(!f)return;ev.preventDefault();const d=new FormData(f);
   try{await request({action:'practice_declare',firm_id:f.dataset.practice,practitioners:d.get('practitioners'),reason:d.get('reason')});notice('Declared.');await load();}catch(err){notice(err.message,true);}};
  h.onchange=ev=>{if(ev.target.matches('[data-sc-pick]')){pending=null;count();}};
  h.onclick=async ev=>{const b=ev.target.closest('[data-sc]');if(!b)return;const k=b.dataset.sc;
   if(k==='none'){for(const x of h.querySelectorAll('[data-sc-pick]'))x.checked=false;pending=null;count();}
   else if(k==='all-submit'||k==='all-approve'){const a=k==='all-submit'?'submit':'approve';for(const x of h.querySelectorAll('[data-sc-pick]'))x.checked=x.dataset[a]==='1';pending=null;count();}
   else if(k==='check-submit'||k==='check-approve')await check(k==='check-submit'?'service_category_submit':'service_category_approve');
   else if(k==='apply')await apply();
  };
 }
 function count(){const c=host().querySelector('#scCount');if(c)c.textContent=ticked().length+' ticked';}
 async function check(action){
  const ids=ticked();if(!ids.length){notice('Tick at least one service category.',true);return;}
  try{const r=await request({action,template_ids:ids,dry:true});pending={action,ids,ready:r.summary.done};
   host().querySelector('#scResults').innerHTML=resultsHtml(r,{esc})+(r.summary.done?`<div class="actions"><label class="check"><input type="checkbox" id="scConfirm"> I have checked this list</label><button type="button" class="primary" data-sc="apply">${action==='service_category_submit'?'Put forward':'Approve'} ${esc(r.summary.done)} ready</button></div>`:'<p class="muted">Nothing is ready. Fix the reasons above.</p>');}
  catch(err){notice(err.message,true);}
 }
 async function apply(){
  const h=host(),cur=ticked().join(',');
  if(!pending||pending.ids.join(',')!==cur){notice('Check the list again: the ticks changed.',true);return;}
  if(!h.querySelector('#scConfirm')?.checked){notice('Tick the box to confirm you have checked the list.',true);return;}
  try{const r=await request({action:pending.action,template_ids:pending.ids,confirm:true});notice(`${r.summary.done} done, ${r.summary.skipped} not.`);const keep=resultsHtml(r,{esc});await load();h.querySelector('#scResults').innerHTML=keep;}
  catch(err){notice(err.message,true);}
 }
 return {open:load};
}
