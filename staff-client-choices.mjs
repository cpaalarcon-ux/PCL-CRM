// Client choices on the Client Setup screen (build 2841): which statutory returns a client's payroll service files, and client-specific exceptions to firm-wide tax rules.
// The firm approves each export format once in Settings; here a Manager or Partner only records which of them this client uses. A tax rule stays in the central library;
// an exception is a dated, approved position that needs a reason, a legal basis and a different approver. Nothing here changes a figure, a rate or a calculation.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>String(v||'').slice(0,10);

export function returnsHtml(res,{esc=e0}={}){
 const rows=res.offered.map(o=>{
  const act=!res.can_edit?'':o.chosen?`<button type="button" data-cc="end-return" data-id="${esc(o.selection_id)}">End</button>`:o.profile?`<button type="button" data-cc="choose-return" data-id="${esc(o.return_code)}">Choose</button>`:'<span class="muted">Publish a profile in Settings first</span>';
  return `<tr data-return="${esc(o.return_code)}" data-chosen="${o.chosen?'yes':'no'}"><td><b>${esc(o.label)}</b><small>${esc(o.authority)}</small></td><td>${o.profile?`Version ${esc(o.profile.version)} · template ${esc(o.profile.template_version)}<small>Checked ${esc(o.profile.verified_on)}</small>`:'<span class="badge warn">No published export profile</span>'}</td><td>${o.chosen?'<span class="badge ok">Chosen</span>':'Not chosen'}</td><td>${act}</td></tr>`;}).join('');
 const hist=res.history.length?`<h3>History</h3><div class="scroll"><table id="returnsHistory"><thead><tr><th>Return</th><th>From</th><th>To</th><th>Chosen by</th><th>Note</th></tr></thead><tbody>${res.history.map(h=>`<tr><td>${esc(h.return_label)}</td><td>${esc(h.effective_from)}</td><td>${h.effective_to?esc(h.effective_to):'Ongoing'}</td><td>${esc(h.selected_by_name||'')}</td><td>${esc(h.note||'')}${h.ended_reason?`<small>Ended: ${esc(h.ended_reason)}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:'';
 return `<p><b>${esc(res.client.company_name)}</b></p><p class="info">${res.configured?'Only the returns chosen here can be prepared for this client’s payroll files.':'No return has been chosen yet, so every return is offered, as before. Choose the ones this client files and only those will be offered.'} The format comes from the firm’s published export profile in force for the payroll month; choosing a return never changes a payroll figure.</p><div class="scroll"><table id="returnsTable"><thead><tr><th>Return</th><th>Firm export profile in force today</th><th>This client</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${hist}`;
}

export function exceptionsHtml(res,{esc=e0}={}){
 const acts=x=>{const out=[];
  if(x.status==='Draft'){if(res.can_approve&&!x.mine)out.push(`<button type="button" data-cc="approve-exception" data-id="${esc(x.exception_id)}" data-rev="${esc(x.revision)}">Approve</button>`);out.push(`<button type="button" data-cc="withdraw-exception" data-id="${esc(x.exception_id)}" data-rev="${esc(x.revision)}">Withdraw</button>`);}
  if(x.status==='Active')out.push(`<button type="button" data-cc="end-exception" data-id="${esc(x.exception_id)}" data-rev="${esc(x.revision)}">End on a date</button>`);
  return out.join(' ');};
 const state=x=>x.status==='Draft'?(x.mine?'Waiting for a different approver':'Waiting for approval'):x.status==='Active'?'Approved':x.status==='Ended'?'Ended':'Withdrawn';
 const rows=res.exceptions.map(x=>`<tr data-status="${esc(x.status)}"><td><b>${esc(x.rate_label)}</b><small>${esc(x.rate_key)}</small></td><td>${esc(x.kind_label)}<small>Reason: ${esc(x.reason)}</small><small>Legal basis: ${esc(x.legal_basis)}</small></td><td>${esc(x.effective_from)} to ${x.effective_to?esc(x.effective_to):'ongoing'}</td><td>${esc(state(x))}<small>Proposed by ${esc(x.created_by_name||'')}${x.approved_by_name?`; approved by ${esc(x.approved_by_name)}`:''}${x.closed_reason?`; closed: ${esc(x.closed_reason)}`:''}</small></td><td>${acts(x)}</td></tr>`).join('');
 return `<p><b>${esc(res.client.company_name)}</b></p><p class="info">${esc(res.note)} A Partner or the Tax Lead who did not propose it approves it.</p><div class="actions"><button type="button" data-cc="propose-exception">Propose an exception</button></div>${rows?`<div class="scroll"><table id="exceptionsTable"><thead><tr><th>Tax rule</th><th>Exception</th><th>Dates</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted" id="exceptionsNone">No exception recorded for this client. Every firm-wide rule applies as it stands.</p>'}`;
}

// Shown beside a tax calculation when the client has an approved exception to a rule the calculation used. It changes no rate and no figure.
export function exceptionsNotice(list,esc=e0){
 if(!Array.isArray(list)||!list.length)return '';
 return `<div class="notice info" id="clientExceptionNotice" role="status"><b>Approved client exception${list.length===1?'':'s'}</b><ul>${list.map(x=>`<li><b>${esc(x.rate_key)}</b>: ${esc(x.kind==='NOT_APPLICABLE'?'the firm-wide rule is recorded as not applying':'the rule applies with a variation')} (${esc(day(x.effective_from))} to ${x.effective_to?esc(day(x.effective_to)):'ongoing'}). Reason: ${esc(x.reason)} Legal basis: ${esc(x.legal_basis)}</li>`).join('')}</ul><p class="muted">The figures below use the firm-wide rule. The exception is a recorded position for the reviewer; apply it by hand where it matters.</p></div>`;
}
export function createClientChoicesUI(ctx){
 const {$,esc,field,select,form,modal,request,notice,show}=ctx;
 let cid='',cur=null;
 const area=(n,l,min)=>`<label class="full">${esc(l)}<textarea name="${n}" required minlength="${min}" maxlength="1000"></textarea></label>`;
 async function returns(clientId){cid=clientId;cur=await request({action:'client_setup_returns_read',client_id:cid});paintReturns();}
 function paintReturns(){
  show('Payroll returns',returnsHtml(cur,{esc})+'<div class="actions"><button type="button" data-v3="client" data-id="'+esc(cid)+'">Back to Client Setup</button></div>');
  const body=$('#editorBody');if(body)body.onclick=ev=>{const b=ev.target.closest('[data-cc]');if(!b)return;
   if(b.dataset.cc==='choose-return'){const o=cur.offered.find(x=>x.return_code===b.dataset.id);
    modal('Choose '+o.label,form(`<p class="info full">${esc(o.label)} will be offered for this client’s payroll files from the date below, using the firm’s published export profile for each month.</p>`+field('effective_from','First day it applies *','','date','required')+`<label class="full">Note (optional)<input name="note" maxlength="500"></label>`,'Choose'),f=>request({action:'client_setup_returns_choose',client_id:cid,return_code:o.return_code,effective_from:f.get('effective_from'),note:f.get('note')||null}),()=>returns(cid));}
   if(b.dataset.cc==='end-return'){const h=cur.history.find(x=>x.selection_id===b.dataset.id);
    modal('End this choice',form(field('effective_to','Last day it applies *','','date','required')+`<label class="full">Why? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>`,'End'),f=>request({action:'client_setup_returns_end',client_id:cid,selection_id:h.selection_id,revision:h.revision,effective_to:f.get('effective_to'),reason:f.get('reason')}),()=>returns(cid));}
  };
 }
 async function exceptions(clientId){cid=clientId;cur=await request({action:'client_setup_exceptions_read',client_id:cid});paintExceptions();}
 function paintExceptions(){
  show('Tax rule exceptions',exceptionsHtml(cur,{esc})+'<div class="actions"><button type="button" data-v3="client" data-id="'+esc(cid)+'">Back to Client Setup</button></div>');
  const body=$('#editorBody');if(body)body.onclick=ev=>{const b=ev.target.closest('[data-cc]');if(!b)return;const x=cur.exceptions.find(r=>r.exception_id===b.dataset.id),k=b.dataset.cc;
   if(k==='propose-exception')modal('Propose a tax rule exception',form(select('rate_key','Tax rule *',cur.rules.map(r=>[r.rate_key,`${r.label} (${r.rate_key})`]),'','Choose a rule')+select('kind','Exception *',cur.kinds.map(r=>[r.code,r.label]),'','Choose')+field('effective_from','First day *','','date','required')+field('effective_to','Last day (blank means ongoing)','','date')+area('reason','What is different about this client? * (20+ characters)',20)+area('legal_basis','Legal basis * (section, ruling or certificate)',10),'Propose'),f=>request({action:'client_setup_exception_propose',client_id:cid,rate_key:f.get('rate_key'),kind:f.get('kind'),effective_from:f.get('effective_from'),effective_to:f.get('effective_to')||null,reason:f.get('reason'),legal_basis:f.get('legal_basis')}),()=>exceptions(cid));
   if(k==='approve-exception')modal('Approve exception',form(`<p class="info full">You did not propose this. Approve only after checking the reason and the legal basis against the source. The rule itself does not change.</p><p class="full"><b>${esc(x.rate_label)}</b>: ${esc(x.kind_label)}<br>Reason: ${esc(x.reason)}<br>Legal basis: ${esc(x.legal_basis)}</p>`,'Approve'),()=>request({action:'client_setup_exception_decide',client_id:cid,exception_id:x.exception_id,revision:x.revision,outcome:'Approve'}),()=>exceptions(cid));
   if(k==='withdraw-exception')modal('Withdraw proposal',form(`<label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'Withdraw'),f=>request({action:'client_setup_exception_decide',client_id:cid,exception_id:x.exception_id,revision:x.revision,outcome:'Withdraw',reason:f.get('reason')}),()=>exceptions(cid));
   if(k==='end-exception')modal('End exception',form(field('effective_to','Last day it applies *','','date','required')+`<label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'End'),f=>request({action:'client_setup_exception_close',client_id:cid,exception_id:x.exception_id,revision:x.revision,effective_to:f.get('effective_to'),reason:f.get('reason')}),()=>exceptions(cid));
  };
 }
 return {returns,exceptions};
}
