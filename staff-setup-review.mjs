// Client set-up review screens (build 2828). The preparer submits sections and carries on; a Manager or Partner reviews later, all at once.
// Every command is authorised again on the server. The Chart of Accounts and Opening Trial Balance keep their own mandatory approvals and are only shown here.
const BADGE={'Draft':'warn','Pending Review':'info','Approved':'good','Correction Required':'bad','Blocked':'bad'};
const KINDS=['BRS','KRA','Permanent file','Client document','Other approved source'];

export function statusBadge(status,esc,changed=false){return `<span class="badge ${BADGE[status]||'warn'}">${esc(status)}</span>${changed?' <span class="badge warn">Changed since review</span>':''}`;}

// Panel for one client: nine deferred sections the preparer submits, two mandatory approvals shown for information, and the two milestones.
export function panelHtml(r,{esc,shortDate}){
 const kindSelect=(code,value)=>`<select name="source_${esc(code)}" aria-label="Source of this information">${KINDS.map(k=>`<option value="${esc(k)}"${k===(value||'BRS')?' selected':''}>${esc(k)}</option>`).join('')}</select>`;
 const rows=r.sections.map(s=>{
  const canSubmit=['Draft','Correction Required'].includes(s.status)||s.changed;
  const detail=[s.submitted_by_name?`Submitted by ${esc(s.submitted_by_name)} ${esc(shortDate(s.submitted_at))}`:'',s.reviewed_by_name?`Reviewed by ${esc(s.reviewed_by_name)} ${esc(shortDate(s.reviewed_at))}`:'',s.unchanged_approval?'Approved again because nothing changed':''].filter(Boolean).join(' · ');
  return `<tr><td><label>${canSubmit?`<input type="checkbox" name="pick_${esc(s.code)}" value="1">`:''} <b>${esc(s.label)}</b></label><small>${esc(s.hint)}</small>${detail?`<small>${detail}</small>`:''}${s.status==='Correction Required'&&s.review_note?`<p class="missing"><b>Correction requested:</b> ${esc(s.review_note)}</p>`:''}</td><td>${statusBadge(s.status,esc,s.changed)}</td><td>${canSubmit?kindSelect(s.code,s.source_kind):esc(s.source_kind||'')}${s.source_note?`<small>${esc(s.source_note)}</small>`:''}</td></tr>`;
 }).join('');
 const mand=[r.chart,r.opening].map(m=>`<tr><td><b>${esc(m.label)}</b><small>${m.not_applicable?'The client confirmed there are no opening balances.':'Mandatory approval. Accounting work that depends on it waits for it; other set-up does not.'}</small></td><td>${statusBadge(m.status,esc)}</td><td>${esc(m.status==='Blocked'?'Needs the approved chart first':'')}</td></tr>`).join('');
 const m=r.milestones;
 return `<p><b>${esc(r.client.company_name)}</b></p>
  <div class="cc-pills"><span class="cc-pill ${m.data_entry_completed?'ok':'warn'}"><i>${m.data_entry_completed?'✓':'!'}</i>Setup data entry completed</span><span class="cc-pill ${m.fully_approved?'ok':'warn'}"><i>${m.fully_approved?'✓':'!'}</i>Setup fully approved</span></div>
  <p class="info">${esc(m.summary)} Submitting a section never stops you moving on. A Manager or Partner reviews the submitted sections together later.</p>
  <form id="setupSectionsForm"><div class="scroll"><table><thead><tr><th>Section</th><th>Status</th><th>Source of the information</th></tr></thead><tbody>${rows}</tbody></table></div>
  <label class="full">Note about the source (optional)<input name="source_note" maxlength="500" placeholder="For example: BRS search dated 12 Nov, PIN checklist from iTax"></label>
  <button type="submit" class="primary full">Submit ticked sections for review</button></form>
  <h3>Mandatory approvals</h3><div class="scroll"><table><thead><tr><th>Control</th><th>Status</th><th></th></tr></thead><tbody>${mand}</tbody></table></div>
  ${r.history.length?`<details><summary>History (${r.history.length})</summary><ul>${r.history.map(h=>`<li>${esc(shortDate(h.occurred_at))} · ${esc(h.actor_name)} · ${esc(h.action)} · ${esc(h.section_code)}${h.note?' — '+esc(h.note):''}</li>`).join('')}</ul></details>`:''}`;
}

// Everything the Manager has to review, grouped by client, with approve-selected and return-with-comment.
export function queueHtml(q,{esc,shortDate}){
 if(!q.total)return '<p class="info">No set-up sections are waiting for review.</p>';
 const groups=q.clients.map(c=>`<fieldset class="card"><legend>${esc(c.company_name)} · ${c.sections.length} pending</legend>${c.sections.map(s=>`<label class="obligation-choice"><input type="checkbox" data-pick="${esc(c.client_id)}|${esc(s.code)}"${s.mine&&!q.sole_partner?' disabled':''}> <b>${esc(s.label)}</b><small>${esc(s.source_kind||'')} · submitted by ${esc(s.submitted_by_name||'')} ${esc(shortDate(s.submitted_at))}${s.source_note?' · '+esc(s.source_note):''}${s.mine?(q.sole_partner?' · you submitted this; as your firm’s only Partner you may review it':' · you submitted this, a different Manager or Partner reviews it'):''}${s.edited_since_submission?' · <b>edited after it was submitted</b>':''}</small></label><input aria-label="Comment if you return this section" data-return-note="${esc(c.client_id)}|${esc(s.code)}" placeholder="Comment if you return this section" maxlength="1000">`).join('')}</fieldset>`).join('');
 return `<p class="info">${q.total} section${q.total===1?'':'s'} waiting. Approve the ones that are satisfactory in one action, or return specific sections with a comment. The preparer carries on in the meantime.</p>${groups}<div class="actions"><button type="button" class="primary" data-v3="setup-approve-ready" title="Approves every section that has not been edited since it was sent, after you check the list.">Approve all ready…</button><label><input type="checkbox" id="setupPickAll"> Tick every section I can review</label><button type="button" id="setupApprove" class="primary" title="Who: Manager or Partner who did not send these sections.">Approve ticked set-up (Manager or Partner, not the sender)</button><button type="button" id="setupReturn">Return ticked sections with comments</button></div>`;
}

// Collects the ticked sections from the panel into the request body.
export function collectSubmit(form){
 const sections=[],note=form.elements.namedItem('source_note')?.value||'';
 for(const el of form.querySelectorAll('input[type=checkbox][name^="pick_"]')){
  if(!el.checked)continue;
  const code=el.name.slice(5),kind=form.elements.namedItem('source_'+code)?.value||'';
  sections.push({section_code:code,source_kind:kind,source_note:kind==='Other approved source'||note?note:''});
 }
 return sections;
}

// Groups ticked queue entries by client so each client is decided in one request.
export function collectDecisions(host,outcome){
 const by=new Map();
 for(const el of host.querySelectorAll('input[data-pick]')){
  if(!el.checked)continue;
  const [client,code]=el.dataset.pick.split('|'),note=host.querySelector(`[data-return-note="${client}|${code}"]`)?.value||'';
  const list=by.get(client)||[];list.push({section_code:code,outcome,note});by.set(client,list);
 }
 return [...by.entries()].map(([client_id,decisions])=>({client_id,decisions}));
}

// Approve all ready (build 2910). The preview lists what would be approved and what is left for a person; nothing is saved until the reviewer ticks the box and confirms.
export function readyHtml(r,{esc}){
 const left=r.left||[];
 const leftList=left.length?`<details open><summary>Left for a person (${left.length})</summary><div class="scroll"><table><thead><tr><th>Client</th><th>Section</th><th>Why</th></tr></thead><tbody>${left.slice(0,200).map(x=>`<tr><td>${esc(x.company_name)}</td><td>${esc(x.label)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div>${left.length>200?`<p class="muted">Showing 200 of ${left.length}.</p>`:''}</details>`:'';
 if(!r.ready)return `<p class="info">Nothing is ready to approve.</p>${leftList}`;
 return `<p class="info"><b>${esc(r.ready)}</b> section${r.ready===1?'':'s'} across <b>${esc(r.clients)}</b> client${r.clients===1?'':'s'} ${r.ready===1?'is':'are'} ready: not edited since ${r.ready===1?'it was':'they were'} sent${r.sole_partner?', including any you sent yourself, as your firm’s only Partner':', and none sent by you'}.</p>${leftList}
  <label>Why you are approving these (at least 10 characters)<input id="readyNote" maxlength="1000" placeholder="For example: checked against the CR12 and KRA certificates on the physical files"></label>
  <div class="actions"><label class="check"><input type="checkbox" id="readyConfirm"> I have checked this list</label><button type="button" class="primary" id="readyApply" disabled>Approve ${esc(r.ready)} section${r.ready===1?'':'s'}</button></div>`;
}
export function readyDoneHtml(r,{esc}){
 return `<p class="info">Approved <b>${esc(r.approved)}</b> section${r.approved===1?'':'s'} across ${esc(r.clients)} client${r.clients===1?'':'s'}.${(r.left||[]).length?` ${esc(r.left.length)} left for a person.`:''}</p>`;
}
