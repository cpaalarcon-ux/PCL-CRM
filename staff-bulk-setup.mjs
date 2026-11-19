// Bulk client set-up screen (build 2842): one set-up choice applied to many clients, with a preview, a check of every row, the rows that pass applied and the rest listed
// separately with the reason. Each row goes through the same single-client rules on the server; a bulk run approves nothing and posts nothing.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// What the form submits, as the request the server expects. Pure, so the screen and its tests agree on one shape.
export function buildPayload(state){
 const rows=(state.selected||[]).map(c=>({client_id:c.client_id,client_label:c.client_label||null,...(c.firm_id?{firm_id:c.firm_id}:{})}));
 if(state.operation==='ENGAGEMENT')return {operation:'ENGAGEMENT',template_id:state.template_id,service_code:state.service_code,period_start:state.period_start,period_end:state.period_end,scope:state.scope,responsible_staff:state.responsible_staff,reviewer_staff:state.reviewer_staff,rows};
 return {operation:'PAYROLL_RETURNS',return_codes:state.return_codes||[],effective_from:state.effective_from,note:state.note||'',rows};
}
// A preview counts only for exactly what was previewed: change anything and the apply button switches off again.
export const payloadKey=payload=>JSON.stringify(payload);

export function optionsHtml(opts,{esc=e0}={}){
 const staff=[...new Map((opts.staff||[]).map(s=>[s.staff_id,s])).values()];
 const sel=(name,label,list,ph)=>`<label>${esc(label)}<select name="${name}" required><option value="">${esc(ph)}</option>${list.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></label>`;
 return `<form id="bulkForm" class="grid" autocomplete="off">
  <p class="info full">${esc(opts.note)} Up to ${esc(opts.max_rows)} clients in one run.</p>
  ${sel('operation','What to set up',opts.operations.map(o=>[o.code,o.label]),'Choose')}
  <fieldset class="full" data-op="ENGAGEMENT" hidden><legend>Service from an approved template</legend>
   ${sel('template_id','Approved service template',(opts.templates||[]).map(t=>[t.template_id,`${t.name} (version ${t.version}${t.effective_from?', from '+t.effective_from:''}${t.last_reviewed?', reviewed '+t.last_reviewed:''})`]),'Choose')}
   <label>Service<select name="service_code" required><option value="">Choose the template first</option></select></label>
   <label>Period starts<input type="date" name="period_start" required></label><label>Period ends<input type="date" name="period_end" required></label>
   ${sel('responsible_staff','Responsible person',staff.map(s=>[s.staff_id,`${s.full_name} (${String(s.category_code).toLowerCase()})`]),'Choose')}
   ${sel('reviewer_staff','Reviewer (a different person)',staff.map(s=>[s.staff_id,`${s.full_name} (${String(s.category_code).toLowerCase()})`]),'Choose')}
   <label class="full">Scope<textarea name="scope" required minlength="10" maxlength="2000"></textarea></label>
   <p class="muted full">The template and the client’s confirmed profile decide which tasks are made. A client without an approved chart of accounts, or already set up for an overlapping period, is listed below with the reason.</p>
  </fieldset>
  <fieldset class="full" data-op="PAYROLL_RETURNS" hidden><legend>Payroll returns</legend>
   <div class="full">${(opts.returns||[]).map(r=>`<label class="check"><input type="checkbox" name="return_codes" value="${esc(r.return_code)}"> ${esc(r.label)}</label>`).join(' ')}</div>
   <label>First day it applies<input type="date" name="effective_from" required></label><label>Note (optional)<input name="note" maxlength="500"></label>
   <p class="muted full">A return can be chosen only when a firm export profile for it is published in Settings. A client that already has the return chosen is listed below as skipped.</p>
  </fieldset>
  <div class="full"><label>Find a client<input type="search" id="bulkSearch" placeholder="Type part of a name"></label>
   <div class="actions"><button type="button" data-bulk="all">Tick all shown</button><button type="button" data-bulk="none">Clear ticks</button><span id="bulkCount" class="muted"></span></div>
   <div class="scroll" id="bulkClients">${clientRows(opts.clients||[],{esc})}</div></div>
  <div class="actions full"><button type="button" class="primary" data-bulk="preview">Preview</button><button type="button" data-bulk="runs">Past runs</button></div>
  <div id="bulkResults" class="full" aria-live="polite"></div>
 </form>`;
}
export function clientRows(clients,{esc=e0,search=''}={}){
 const q=String(search||'').trim().toLowerCase(),list=clients.filter(c=>!q||String(c.company_name).toLowerCase().includes(q));
 if(!list.length)return '<p class="muted">No client matches.</p>';
 return `<table id="bulkClientTable"><thead><tr><th></th><th>Client</th><th>Handling firm</th></tr></thead><tbody>${list.map(c=>{
  const firms=c.firms||[];
  const firm=firms.length>1?`<select aria-label="Handling firm for ${esc(c.company_name||c.client_name||'this client')}" data-bulk-firm="${esc(c.client_id)}"><option value="">Choose</option>${firms.map(f=>`<option value="${esc(f.firm_id)}">${esc(f.legal_name)}</option>`).join('')}</select>`:firms.length===1?esc(firms[0].legal_name):'<span class="badge warn">Not linked</span>';
  return `<tr data-client="${esc(c.client_id)}"><td><input type="checkbox" data-bulk-pick="${esc(c.client_id)}" aria-label="Select ${esc(c.company_name)}"></td><td>${esc(c.company_name)}</td><td>${firm}</td></tr>`;}).join('')}</tbody></table>`;
}
// The result table of a preview or an apply: the rows that passed (or were applied) first, then the exceptions as their own list with the reason for each.
export function resultsHtml(res,{esc=e0}={}){
 const s=res.summary,good=res.results.filter(r=>r.outcome!=='Skipped'),bad=res.results.filter(r=>r.outcome==='Skipped');
 const word=res.applied?'applied':'ready to apply';
 const line=r=>`<tr data-outcome="${esc(r.outcome)}"><td>${esc(r.client_label||'Client not available')}</td><td>${esc(r.item)}</td><td>${r.outcome==='Applied'?'<span class="badge ok">Applied</span>':'<span class="badge ok">Ready</span>'}${r.note?`<small>${esc(r.note)}</small>`:''}</td></tr>`;
 const ex=r=>`<tr data-outcome="Skipped"><td>${esc(r.client_label||'Client not available')}</td><td>${esc(r.item)}</td><td>${esc(r.reason)}</td></tr>`;
 return `<div class="notice ${s.skipped?'warn':'info'}" id="bulkSummary" role="status"><b>${esc(s.total)} row${s.total===1?'':'s'} checked: ${esc(s.ready)} ${word}, ${esc(s.skipped)} not.</b>${res.applied?' Each client has its own record in the audit trail. Nothing was approved or posted.':' Nothing has been changed yet.'}</div>
  ${good.length?`<h3>${res.applied?'Applied':'Ready'} (${good.length})</h3><div class="scroll"><table id="bulkReady"><thead><tr><th>Client</th><th>Item</th><th>Result</th></tr></thead><tbody>${good.map(line).join('')}</tbody></table></div>`:''}
  ${bad.length?`<h3>Exceptions: not ${res.applied?'applied':'ready'} (${bad.length})</h3><p class="muted">Fix the reason and run these again on their own; they did not stop the others.</p><div class="scroll"><table id="bulkExceptions"><thead><tr><th>Client</th><th>Item</th><th>Why</th></tr></thead><tbody>${bad.map(ex).join('')}</tbody></table></div>`:''}`;
}
export function runsHtml(res,{esc=e0}={}){
 if(!res.runs.length)return '<p class="muted">No bulk run has been made yet.</p>';
 return `<div class="scroll"><table id="bulkRuns"><thead><tr><th>When</th><th>What</th><th>By</th><th>Applied</th><th>Not applied</th><th></th></tr></thead><tbody>${res.runs.map(r=>`<tr><td>${esc(String(r.created_at).slice(0,16).replace('T',' '))}</td><td>${esc(r.operation_label)}</td><td>${esc(r.created_by_name||'')}</td><td>${esc(r.applied_count)}</td><td>${esc(r.skipped_count)}</td><td><button type="button" data-bulk="run" data-id="${esc(r.run_id)}">Open</button></td></tr>`).join('')}</tbody></table></div>`;
}
export function runHtml(res,{esc=e0}={}){
 const results=res.rows.map(r=>({row_no:r.row_no,client_id:r.client_id,client_label:r.client_label,item:r.item,outcome:r.outcome,reason:r.reason,note:r.record_ref?'Record '+String(r.record_ref).slice(0,8):null}));
 return `<p><b>${esc(res.run.operation_label)}</b><br><span class="muted">${esc(String(res.run.created_at).slice(0,16).replace('T',' '))} by ${esc(res.run.created_by_name||'')}</span></p>`+resultsHtml({applied:true,results,summary:{total:res.summary.total,ready:res.summary.applied,skipped:res.summary.skipped}},{esc});
}

export function createBulkSetupUI(ctx){
 const {$,esc,request,notice,show}=ctx;
 let opts=null,previewed=null;
 const host=()=>$('#editorBody');
 const picked=()=>[...host().querySelectorAll('[data-bulk-pick]:checked')].map(x=>{const id=x.dataset.bulkPick,c=opts.clients.find(y=>y.client_id===id),firm=host().querySelector(`[data-bulk-firm="${id}"]`)?.value||'';return {client_id:id,client_label:c?.company_name||null,firm_id:firm||(c?.firms?.length===1?c.firms[0].firm_id:'')};});
 function state(){
  const f=new FormData(host().querySelector('#bulkForm')),o=f.get('operation')||'';
  return {operation:o,template_id:f.get('template_id')||'',service_code:f.get('service_code')||'',period_start:f.get('period_start')||'',period_end:f.get('period_end')||'',scope:f.get('scope')||'',responsible_staff:f.get('responsible_staff')||'',reviewer_staff:f.get('reviewer_staff')||'',return_codes:f.getAll('return_codes'),effective_from:f.get('effective_from')||'',note:f.get('note')||'',selected:picked()};
 }
 const sync=()=>{const h=host(),o=h.querySelector('[name=operation]').value;
  for(const fs of h.querySelectorAll('fieldset[data-op]')){const on=fs.dataset.op===o;fs.hidden=!on;for(const i of fs.querySelectorAll('input,select,textarea'))i.disabled=!on;}
  const t=opts.templates.find(x=>x.template_id===h.querySelector('[name=template_id]').value),sv=h.querySelector('[name=service_code]');
  if(o==='ENGAGEMENT'&&sv&&sv.dataset.for!==(t?.template_id||'')){sv.dataset.for=t?.template_id||'';sv.innerHTML=t?(t.services.length===1?'':'<option value="">Choose</option>')+t.services.map(s=>`<option value="${esc(s.service_code)}">${esc(s.service_name)}</option>`).join(''):'<option value="">Choose the template first</option>';}
  h.querySelector('#bulkCount').textContent=picked().length+' ticked';
  const apply=h.querySelector('[data-bulk="apply"]');if(apply){const ok=previewed&&previewed.key===payloadKey(buildPayload(state()))&&previewed.ready>0;apply.disabled=!ok;const box=h.querySelector('#bulkConfirm');if(box){box.disabled=!ok;if(!ok)box.checked=false;}}
 };
 async function open(){
  opts=await request({action:'bulk_setup_options'});previewed=null;
  show('Bulk client set-up',optionsHtml(opts,{esc}));
  const h=host();sync();
  h.oninput=ev=>{if(ev.target.id==='bulkSearch'){h.querySelector('#bulkClients').innerHTML=clientRows(opts.clients,{esc,search:ev.target.value});}sync();};
  h.onchange=sync;
  h.onclick=async ev=>{const b=ev.target.closest('[data-bulk]');if(!b)return;const k=b.dataset.bulk;
   if(k==='all'){for(const x of h.querySelectorAll('[data-bulk-pick]'))x.checked=true;sync();}
   else if(k==='none'){for(const x of h.querySelectorAll('[data-bulk-pick]'))x.checked=false;sync();}
   else if(k==='preview')await preview();
   else if(k==='apply')await apply();
   else if(k==='runs'){try{const r=await request({action:'bulk_setup_runs_read'});h.querySelector('#bulkResults').innerHTML='<h3>Past runs</h3>'+runsHtml(r,{esc});}catch(err){notice(err.message,true);}}
   else if(k==='run'){try{const r=await request({action:'bulk_setup_run_read',run_id:b.dataset.id});h.querySelector('#bulkResults').innerHTML='<h3>Run</h3>'+runHtml(r,{esc});}catch(err){notice(err.message,true);}}
  };
 }
 async function preview(){
  const h=host(),p=buildPayload(state());
  if(!p.operation){notice('Choose what to set up.',true);return;}if(!p.rows.length){notice('Tick at least one client.',true);return;}
  try{const r=await request({action:'bulk_setup_preview',...p});previewed={key:payloadKey(p),ready:r.summary.ready};
   h.querySelector('#bulkResults').innerHTML=resultsHtml(r,{esc})+(r.summary.ready?`<div class="actions"><label class="check"><input type="checkbox" id="bulkConfirm" disabled> I have checked this list</label><button type="button" class="primary" data-bulk="apply" disabled>Apply to ${esc(r.summary.ready)} ready row${r.summary.ready===1?'':'s'}</button></div>`:'<p class="muted">Nothing is ready to apply. Fix the reasons above and preview again.</p>');
   sync();}catch(err){notice(err.message,true);}
 }
 async function apply(){
  const h=host(),p=buildPayload(state());
  if(!previewed||previewed.key!==payloadKey(p)){notice('Preview again: the list or the choices changed.',true);return;}
  if(!h.querySelector('#bulkConfirm')?.checked){notice('Tick the box to confirm you have checked the list.',true);return;}
  try{const r=await request({action:'bulk_setup_apply',confirm:true,...p});previewed=null;
   h.querySelector('#bulkResults').innerHTML=resultsHtml(r,{esc});notice(`${r.summary.applied} applied, ${r.summary.skipped} not applied.`);sync();}catch(err){notice(err.message,true);}
 }
 return {open};
}
