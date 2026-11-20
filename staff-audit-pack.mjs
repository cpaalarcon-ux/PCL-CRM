// Audit build S6: SACCO audit pack.
// A programme a Partner approves and a file adopts; a compliance register a Partner approves and a file assesses; matters communicated to those
// charged with governance, with the Partner's key audit matter decision; and the views of the two report kinds this build adds.
// The server does every check and enforces every gate; this module shows the result and collects input. No regulatory figure is fixed here.
export const PACK_KINDS=['Statutory report to regulator','Key audit matters'];
export const NATURES=['Audit reporting matter','Governance - not audit reporting','AML/CFT/CPF','Regulatory return','Other'];
export const APPLIES=[['ALL_SACCO','All SACCOs'],['DT_SACCO','Deposit-taking SACCOs'],['NWDT_SACCO','Non-withdrawable-deposit-taking SACCOs']];
export const RESULTS=['Complied','Not complied','Not applicable'];
export const EFFECTS=['Management letter','Statutory report','Matter for those charged with governance'];
export const METHODS=['Meeting','Letter','Email','Written report'];
const MAKERS=['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
export const stepTone=s=>s.status==='Reviewed'?'ok':s.status==='Prepared'?'':s.status==='Returned'?'warn':'warn';
const statusText=s=>s.status==='Not started'?'Not started':s.status;
const money=v=>{if(v==null||v==='')return '—';const n=Number(v);if(!Number.isFinite(n))return esc(v);const t=Math.abs(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`(${t})`:t;};

// ---- Views of the two report kinds (used by the Reports tab) ---------------------------------------------------------------------------------
export function statutoryView(b){
 if(!b)return '';
 const rat=(b.ratios||[]).length?`<h4>Prudential ratios (Partner-confirmed table)</h4><div class="scroll"><table><thead><tr><th>Ratio</th><th>Requirement</th><th>This file</th><th>Result</th></tr></thead><tbody>${b.ratios.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.comparator)} ${esc(r.threshold)}${r.measure==='Percentage'?'%':''}</td><td>${r.value==null?'—':esc(r.value)}</td><td>${esc(r.state)}${r.state==='Breach'?(r.acknowledged?' · acknowledged by '+esc(r.ack_by||'a Partner'):' · not acknowledged'):''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="missing">No SASRA ratio is confirmed for this SACCO type and year end.</p>';
 const comp=(b.compliance||[]).length?`<h4>Compliance matters to report</h4><div class="scroll"><table><thead><tr><th>Item</th><th>Result</th><th>Reported in</th><th>What we found</th></tr></thead><tbody>${b.compliance.map(c=>`<tr><td><b>${esc(c.title)}</b><small>${esc(c.citation||'')}</small></td><td>${esc(c.result)}</td><td>${esc(c.effect)}</td><td>${esc(c.note)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No compliance item is marked for this report.</p>';
 const s10=(b.section10||[]).length?`<h4>Section 10 matters</h4><ul>${b.section10.map(x=>`<li>${esc(x.caption)} · ${esc(x.status)}${x.applicable===false?' · not applicable':''}${x.note?' · '+esc(x.note):''}</li>`).join('')}</ul>`:'';
 const cal=b.calendar?`<h4>Calendar wording for this report</h4><p>As reported: <i>${esc(b.calendar.as_reported)}</i></p>${b.calendar.conflicting_wording?`<p class="muted">Conflicting wording: ${esc(b.calendar.conflicting_wording)}</p>`:''}<p class="${b.calendar.due?'info':'missing'}">${b.calendar.due?`Due ${esc(b.calendar.due.date)} (${esc(b.calendar.due.direction)}), as confirmed by a Partner.`:'No date is computed: a Partner has not confirmed the rule.'}</p>`:'';
 const fs=b.financial_statements?`<p class="muted">Financial statements: approved version ${esc(b.financial_statements.approved_version)} (fingerprint ${esc(b.financial_statements.fingerprint)}).</p>`:'<p class="muted">No approved version of the financial statements yet.</p>';
 return `<p class="muted">${esc(b.entity)} · ${b.sacco_type==='DT_SACCO'?'deposit-taking SACCO':'non-withdrawable-deposit-taking SACCO'} · period ${esc(b.period_start)} to ${esc(b.period_end)} · audit report date ${esc(b.report_date||'not set')}</p>
  <p>To: <b>${esc(b.addressee)}</b></p><div class="audit-note"><b>Partner's conclusion (the Partner's own wording)</b><p>${esc(b.partner_conclusion)}</p></div>
  <p class="muted">SASRA auditor eligibility for ${esc(b.eligibility?.financial_year)}: ${b.eligibility?.confirmed?'confirmed':'not confirmed'}.</p>${fs}${rat}${comp}${s10}${cal}<p class="info">${esc(b.note||'')}</p>`;
}
export function kamView(b){
 if(!b)return '';
 return `<p class="muted">${esc(b.entity)} · period ended ${esc(b.period_end)}</p><p class="info">${esc(b.note||'')}</p>
  ${(b.items||[]).map(i=>`<article class="card section-space"><h4>${esc(i.heading)}</h4><p class="muted">From matter ${esc(i.matter_ref)} · ${esc(i.matter_title)} · communicated ${esc(i.communicated_on)} to ${esc(i.communicated_to)} (${esc(i.method)})</p><p><b>Why it was of most significance:</b> ${esc(i.why_significant)}</p><p><b>How the audit addressed it:</b> ${esc(i.how_addressed)}</p><p>${esc(i.text)}</p></article>`).join('')||'<p class="muted">No key audit matter.</p>'}
  ${(b.considered_not_kam||[]).length?`<details class="audit-history"><summary>Matters communicated but not key audit matters (${b.considered_not_kam.length})</summary><ul>${b.considered_not_kam.map(x=>`<li>${esc(x.matter_ref)} · ${esc(x.matter_title)} — ${esc(x.reason)}</li>`).join('')}</ul></details>`:''}`;
}

export function createPackUI(ctx){
 const {field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const textArea=(name,label,value='',max=1500,req=true)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${req?'required':''}>${esc(value||'')}</textarea></label>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);

 function issuesCard(w){
  const iss=w.issues||[];
  return `<section class="card"><div class="section-head"><div><h3>SACCO audit pack</h3><p class="muted">The audit programme, the compliance register, and the matters communicated to those charged with governance with the Partner's key audit matter decisions. The statutory report to the regulator and the key audit matters report are drafted on the Reports tab. Everything here that starts as a draft or a proposal needs a Partner to read and approve it first.</p></div></div>
   ${iss.length?`<div class="audit-note warn"><b>What stops final sign-off from this pack</b><ul>${iss.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'<p class="info">Nothing in the pack stops final sign-off.</p>'}</section>`;
 }

 function programmeCard(w,role,file){
  const leader=['MANAGER','PARTNER'].includes(role),can=MAKERS.includes(role)&&open(file),me=staff().staff_id;
  const progs=w.programmes||[],draft=progs.find(p=>p.status==='Draft'),inUse=progs.find(p=>p.status==='Approved'),fsteps=w.file_steps||[];
  const stepTable=(P,canEdit)=>`<div class="scroll"><table><thead><tr><th>Step</th><th>Area · assertion</th><th>Procedure</th><th>Required</th>${canEdit?'<th></th>':''}</tr></thead><tbody>${(P.steps||[]).map(x=>`<tr><td><b>${esc(x.step_code)}</b>${x.reference_code?`<small>${esc(x.reference_code)}</small>`:''}</td><td>${esc(x.audit_area)}<small>${esc(x.assertion)}</small></td><td>${esc(x.procedure)}</td><td>${x.required?'Yes':'No'}</td>${canEdit?`<td><button data-pack-step-edit="${esc(P.programme_id)}|${esc(x.step_code)}">Edit</button><button data-pack-step-remove="${esc(P.programme_id)}|${esc(x.step_code)}">Remove</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
  const adopted=fsteps.length>0;
  const fileTable=`<div class="scroll"><table><thead><tr><th>Step</th><th>Procedure</th><th>Status</th><th>Result</th><th></th></tr></thead><tbody>${fsteps.map(x=>{
   const key=esc(x.programme_id)+'|'+esc(x.step_code);
   return `<tr><td><b>${esc(x.step_code)}</b><small>${esc(x.audit_area)} · ${esc(x.assertion)}${x.required?'':' · optional'}</small></td><td>${esc(x.procedure)}</td><td>${badge(statusText(x),stepTone(x))}${x.status!=='Not started'&&x.applicable===false?' '+badge('Not applicable'):''}</td>
    <td>${x.result_note?esc(x.result_note)+`<small>${esc(x.prepared_by_name||'')}${x.workpaper_ref?' · '+esc(x.workpaper_ref):''}</small>`:''}${x.reviewer_name?`<small>Reviewed by ${esc(x.reviewer_name)}${x.review_note?': '+esc(x.review_note):''}</small>`:''}${x.status==='Returned'&&x.review_note?`<small class="missing">${esc(x.review_note)}</small>`:''}</td>
    <td>${can?`<button data-pack-step-prepare="${key}">${x.status==='Not started'?'Perform':'Perform again'}</button>`:''}${x.status==='Prepared'&&leader&&x.prepared_by!==me&&open(file)?`<button class="primary" data-pack-step-review="${key}">Review</button>`:''}</td></tr>`;}).join('')}</tbody></table></div>`;
  return `<section class="card section-space"><div class="section-head"><div><h3>Audit programme</h3><p class="muted">A versioned list of procedures. A Partner approves a version; the file adopts it (the steps are copied, so a later version never changes this file). One person performs each step, or marks it not applicable with the reason, and a Manager or Partner who did not perform it reviews. Version 1 is a draft: it names no regulatory percentage or amount and tells the team to use the rules a Partner has confirmed.</p></div>
    <div class="actions">${leader&&!draft&&progs.length?`<button data-pack-programme-copy="${esc(progs[0].code)}">Start a new version</button>`:''}</div></div>
   <p>Version in use: ${inUse?`<b>${esc(inUse.title)}</b> ${badge('Approved','ok')} <span class="muted">${esc(inUse.approved_by_name||'a Partner')}${inUse.approved_at?' · '+esc(shortDate(inUse.approved_at)):''}${inUse.approval_note?': '+esc(inUse.approval_note):''}</span>`:`${badge('None approved','warn')} <span class="muted">A Partner must approve the draft before a file can adopt it.</span>`}</p>
   ${draft?`<div class="audit-note"><b>Draft version ${esc(draft.version)}</b> · ${(draft.steps||[]).length} steps <small>${esc(draft.source_note||'')}</small><div class="actions">${leader?`<button data-pack-step-new="${esc(draft.programme_id)}">+ Add a step</button>`:''}${role==='PARTNER'?`<button class="primary" data-pack-programme-approve="${esc(draft.programme_id)}">Approve this programme</button>`:'<small>A Partner approves it.</small>'}</div></div>${stepTable(draft,leader)}`:(inUse?`<details class="audit-history"><summary>Steps in version ${esc(inUse.version)} · ${(inUse.steps||[]).length}</summary>${stepTable(inUse,false)}</details>`:'')}
   <h4>On this file</h4>
   ${adopted?`<p class="muted">${fsteps.filter(x=>x.status==='Reviewed').length} of ${fsteps.length} steps reviewed.</p>${fileTable}`:`<p class="muted">No programme has been adopted on this file.</p><div class="actions">${can&&inUse?`<button class="primary" data-pack-programme-adopt="${esc(inUse.programme_id)}">Adopt version ${esc(inUse.version)} on this file</button>`:''}</div>`}</section>`;
 }

 function complianceCard(w,role,file){
  const leader=['MANAGER','PARTNER'].includes(role),can=MAKERS.includes(role)&&open(file),me=staff().staff_id;
  const items=w.compliance_items||[],rows=w.compliance||[];
  const lib=`<div class="scroll"><table><thead><tr><th>Item</th><th>Nature</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>${items.map(i=>`<tr><td><b>${esc(i.title)}</b><small>${esc(i.item_code)} · ${esc(i.requirement)}</small></td><td>${esc(i.nature)}<small>${esc((i.applies_to||[]).join(', '))}</small></td><td>${esc(i.citation||'')}${i.reference_code?`<small>${esc(i.reference_code)} · ${esc(i.reference_verification||'')}</small>`:''}</td><td>${badge(i.status,i.status==='Approved'?'ok':'warn')}${i.approved_by_name?`<small>${esc(i.approved_by_name)}</small>`:''}</td>
   <td>${leader?`<button data-pack-item-edit="${esc(i.item_code)}">Edit</button>`:''}${role==='PARTNER'&&i.status==='Proposed'?`<button class="primary" data-pack-item-approve="${esc(i.item_id)}">Approve</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  const fileRows=`<div class="scroll"><table><thead><tr><th>Item</th><th>Result</th><th>Reported in</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(k=>`<tr><td><b>${esc(k.title)}</b><small>${esc(k.nature)}</small></td><td>${k.result?esc(k.result):'—'}${k.note?`<small>${esc(k.note)} — ${esc(k.prepared_by_name||'')}</small>`:''}</td><td>${k.result==='Not complied'?esc(k.reporting_effect):'—'}</td><td>${badge(statusText(k),stepTone(k))}${k.reviewer_name?`<small>Reviewed by ${esc(k.reviewer_name)}${k.review_note?': '+esc(k.review_note):''}</small>`:''}</td>
   <td>${can?`<button data-pack-compliance-prepare="${esc(k.item_id)}">${k.status==='Not started'?'Assess':'Assess again'}</button>`:''}${k.status==='Prepared'&&leader&&k.prepared_by!==me&&open(file)?`<button class="primary" data-pack-compliance-review="${esc(k.item_id)}">Review</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  return `<section class="card section-space"><div class="section-head"><div><h3>Compliance register</h3><p class="muted">A firm list of legal and regulatory requirements, each pointing at the legal reference register where it can. The wording is as reported and has not been checked against the primary text by the system: a Partner approves each item after reading the source. On a file, each item is assessed by one person and reviewed by someone else. A non-compliance must say where it is reported.</p></div>
    <div class="actions">${leader?'<button data-pack-item-new>+ Add an item</button>':''}</div></div>
   <details class="audit-history" ${items.some(i=>i.status==='Proposed')&&role==='PARTNER'?'open':''}><summary>Register of requirements · ${items.filter(i=>i.status==='Approved').length} approved, ${items.filter(i=>i.status==='Proposed').length} proposed</summary>${lib}</details>
   <h4>On this file</h4>${rows.length?`<p class="muted">${rows.filter(k=>k.status==='Reviewed').length} of ${rows.length} reviewed.</p>${fileRows}`:`<p class="muted">The approved items have not been added to this file.</p>`}
   <div class="actions">${can&&items.some(i=>i.status==='Approved')?'<button data-pack-compliance-adopt>Add the approved items to this file</button>':''}</div></section>`;
 }

 function mattersCard(w,role,file){
  const can=MAKERS.includes(role)&&open(file),ms=w.matters||[];
  return `<section class="card section-space"><div class="section-head"><div><h3>Matters communicated and key audit matters</h3><p class="muted">Record each matter communicated to those charged with governance, with the date and how. Only a Partner decides whether a matter is a key audit matter; a key audit matter is drafted from the matter itself, and no list is preset. If a matter changes after the Partner decided, the Partner must decide again.</p></div><div class="actions">${can?'<button data-pack-matter-new>+ Record a matter</button>':''}</div></div>
   ${ms.length?`<div class="scroll"><table><thead><tr><th>Matter</th><th>Communicated</th><th>Decision</th><th></th></tr></thead><tbody>${ms.map(m=>`<tr><td><b>${esc(m.matter_ref)}</b> ${esc(m.title)}<small>${esc(m.description)}</small>${m.response?`<small>Response: ${esc(m.response)}</small>`:''}${m.status==='Withdrawn'?`<small class="missing">Withdrawn: ${esc(m.withdraw_note)}</small>`:''}</td><td>${esc(m.communicated_on)}<small>${esc(m.method)} to ${esc(m.communicated_to)}</small></td>
    <td>${m.status==='Withdrawn'?'—':m.decision?badge(m.decision==='KAM'?'Key audit matter':'Not a KAM',m.decision==='KAM'?'ok':'')+(m.decision_stale?' '+badge('Changed since decided','warn'):'')+`<small>${esc(m.significance_note)} — ${esc(m.decided_by_name||'')}</small>`:badge('No decision','warn')}</td>
    <td>${m.status==='Active'&&can?`<button data-pack-matter-edit="${esc(m.matter_id)}">Edit</button><button data-pack-matter-withdraw="${esc(m.matter_id)}">Withdraw</button>`:''}${m.status==='Active'&&role==='PARTNER'&&open(file)?`<button class="primary" data-pack-kam-decide="${esc(m.matter_id)}">${m.decision?'Decide again':'Decide'}</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No matter recorded yet.</p>'}</section>`;
 }

 function reportsCard(w,role){
  const pol=w.policy;
  return `<section class="card section-space"><div class="section-head"><div><h3>Reports from this pack</h3><p class="muted">Draft and approve them on the Reports tab. Both are approved by a Partner only. The statutory report assembles the ratios, the compliance results and the section 10 matters, and carries the Partner's own written conclusion; the system states no legal test and computes no due date until a Partner has confirmed the rule in the regulatory calendar.</p></div></div>
   <p>Statutory report to the regulator: ${w.statutory_required?badge('Required before final sign-off','warn'):badge('Not required for this file')} ${pol?`<span class="muted">Setting for deposit-taking SACCOs: ${pol.value==='true'?'required':'not required'} — ${pol.confirmed?'confirmed by '+esc(pol.confirmed_by_name||'a Partner'):'default, not yet confirmed by a Partner'}</span>`:''} ${role==='PARTNER'&&pol?'<button data-pack-policy>Change the setting</button>':''}</p>
   ${(w.statutory_blocking||[]).length?`<div class="audit-note warn"><b>What stops the statutory report being submitted</b><ul>${w.statutory_blocking.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'<p class="info">Nothing stops the statutory report being submitted.</p>'}
   ${(w.kam_blocking||[]).length?`<div class="audit-note warn"><b>What stops the key audit matters report being submitted</b><ul>${w.kam_blocking.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'<p class="info">Nothing stops the key audit matters report being submitted.</p>'}</section>`;
 }

 function panel(file,s){
  const w=s?.pack;if(!w)return '<section class="card"><h3>SACCO audit pack</h3><p class="muted">This tab is for SACCO audit files.</p></section>';
  const role=staff().category_code;
  return `${issuesCard(w)}${programmeCard(w,role,file)}${complianceCard(w,role,file)}${mattersCard(w,role,file)}${reportsCard(w,role)}`;
 }

 function stepForm(prog,x=null){
  const body=field('step_code','Step code *',x?.step_code||'','text',`required maxlength="34" pattern="[A-Za-z]{1,3}\\.[A-Za-z0-9_]{2,30}" placeholder="L.LEDGER" ${x?'readonly':''}`)
   +field('audit_area','Audit area *',x?.audit_area||'','text','required maxlength="120"')+field('assertion','Assertion *',x?.assertion||'','text','required maxlength="120"')
   +textArea('procedure','Procedure * (at least 20 characters)',x?.procedure||'',2000)+field('reference_code','Legal reference code (optional)',x?.reference_code||'','text','maxlength="61"')
   +select('required','Required for sign-off? *',[['true','Yes'],['false','No']],x&&x.required===false?'false':'true')+field('sort_order','Order number *',String(x?.sort_order??''),'text','required inputmode="numeric"');
  modal(x?'Edit '+x.step_code:'Add a step',form(body,'Save step'),f=>{const o=Object.fromEntries(f);return request({action:'audit_pack_step_save',programme_id:prog.programme_id,step:{step_code:o.step_code,audit_area:o.audit_area,assertion:o.assertion,procedure:o.procedure,reference_code:o.reference_code||'',required:o.required==='true',sort_order:o.sort_order}});},()=>ctx.refresh(),{refreshWorkspace:false});
 }
 function itemForm(x=null){
  const body=field('item_code','Item code *',x?.item_code||'','text',`required maxlength="41" ${x?'readonly':''}`)+field('title','Title *',x?.title||'','text','required maxlength="200"')
   +textArea('requirement','The requirement, as reported * (at least 10 characters)',x?.requirement||'',2000)+field('citation','Citation',x?.citation||'','text','maxlength="300"')+field('reference_code','Legal reference code (optional)',x?.reference_code||'','text','maxlength="61"')
   +select('applies_to','Applies to *',APPLIES,(x?.applies_to||['ALL_SACCO'])[0])+select('nature','Nature *',NATURES,x?.nature||'Other')+field('sort_order','Order number',String(x?.sort_order??100),'text','inputmode="numeric"');
  modal(x?'Edit '+x.item_code:'Add a compliance item',form(body+'<p class="info full">Saving puts the item back to proposed. A Partner approves it after reading the source.</p>','Save item'),f=>{const o=Object.fromEntries(f);return request({action:'audit_pack_item_save',item:{item_code:o.item_code,title:o.title,requirement:o.requirement,citation:o.citation||'',reference_code:o.reference_code||'',applies_to:[o.applies_to],nature:o.nature,sort_order:o.sort_order||100}});},()=>ctx.refresh(),{refreshWorkspace:false});
 }
 function matterForm(file,m=null){
  const body=field('title','Title *',m?.title||'','text','required maxlength="200"')+textArea('description','What was communicated * (at least 20 characters)',m?.description||'',3000)
   +field('communicated_on','Date communicated *',m?.communicated_on||'','date','required')+select('method','How *',METHODS,m?.method||'Written report')+field('communicated_to','To whom *',m?.communicated_to||'','text','required maxlength="200"')+textArea('response','Response from those charged with governance',m?.response||'',2000,false);
  modal(m?'Edit '+m.matter_ref:'Record a matter communicated',form(body,'Save matter'),f=>request({action:'audit_pack_matter_save',audit_file_id:file.audit_file_id,matter_id:m?.matter_id||null,matter:Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});
 }

 async function handle(b,file){
  const s=ctx.snapshot(),w=s?.pack;
  const has=a=>b.hasAttribute&&b.hasAttribute(a);
  if(!w)return false;
  const draft=(w.programmes||[]).find(p=>p.status==='Draft');
  const pick=v=>String(v||'').split('|');
  if(b.dataset.packProgrammeCopy){const code=b.dataset.packProgrammeCopy;modal('Start a new programme version',`<p>This copies the latest version into a draft. Files that already adopted a version keep it. A Partner must approve the draft before new files can adopt it.</p><button class="primary" id="packCopyGo">Start the draft</button>`);
   document.querySelector('#packCopyGo').onclick=async()=>{try{await request({action:'audit_pack_programme_copy',code});document.querySelector('#editor').close();await ctx.refresh();}catch(e){document.querySelector('#editorNotice').textContent=e.message;}};return true;}
  if(b.dataset.packStepNew){if(draft)stepForm(draft);return true;}
  if(b.dataset.packStepEdit){const [pid,code]=pick(b.dataset.packStepEdit),P=(w.programmes||[]).find(p=>p.programme_id===pid),x=P?.steps.find(t=>t.step_code===code);if(P&&x)stepForm(P,x);return true;}
  if(b.dataset.packStepRemove){const [pid,code]=pick(b.dataset.packStepRemove);modal('Remove '+code,form('<p class="full">Remove this step from the draft programme.</p>','Remove step'),()=>request({action:'audit_pack_step_remove',programme_id:pid,step_code:code}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.packProgrammeApprove){const id=b.dataset.packProgrammeApprove;modal('Partner · approve the audit programme',form(`<p class="full">Approving makes this version the one new files adopt, and replaces the version now in use. Read every step first.</p>`+textArea('note','What did you check? (at least 10 characters) *','',1000),'Approve'),f=>request({action:'audit_pack_programme_approve',programme_id:id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.packProgrammeAdopt){const id=b.dataset.packProgrammeAdopt;modal('Adopt the programme on this file',`<p>The steps are copied onto this file. You cannot adopt another version of the same programme later.</p><button class="primary" id="packAdoptGo">Adopt</button>`);
   document.querySelector('#packAdoptGo').onclick=async()=>{try{await request({action:'audit_pack_programme_adopt',audit_file_id:file.audit_file_id,programme_id:id});document.querySelector('#editor').close();await ctx.refresh();}catch(e){document.querySelector('#editorNotice').textContent=e.message;}};return true;}
  if(b.dataset.packStepPrepare){const [pid,code]=pick(b.dataset.packStepPrepare),x=(w.file_steps||[]).find(t=>t.programme_id===pid&&t.step_code===code);if(!x)return true;
   const wp=[['','No working paper linked'],...(w.workpapers||[]).map(p=>[p.audit_workpaper_id,p.workpaper_ref+' · '+p.audit_area])];
   modal('Perform · '+x.step_code,form(`<p class="full">${esc(x.procedure)}</p>`+select('applicable','Does it apply to this SACCO? *',[['true','Yes, it applies'],['false','No, it does not apply']],x.applicable===false?'false':'true')+select('audit_workpaper_id','Working paper',wp,x.audit_workpaper_id||'')+textArea('note','What was done, or why it does not apply (at least 10 characters) *',x.result_note||'',2000),'Save'),
    f=>request({action:'audit_pack_step_prepare',audit_file_id:file.audit_file_id,programme_id:pid,step_code:code,applicable:f.get('applicable')==='true',audit_workpaper_id:f.get('audit_workpaper_id')||null,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.packStepReview){const [pid,code]=pick(b.dataset.packStepReview),x=(w.file_steps||[]).find(t=>t.programme_id===pid&&t.step_code===code);if(!x)return true;
   modal('Review · '+x.step_code,form(`<p class="full">${esc(x.result_note||'')}</p>`+select('decision','Decision *',['Accept','Return'],'Accept')+textArea('note','Review note (at least 5 characters to return)','',1000,false),'Save review'),f=>request({action:'audit_pack_step_review',audit_file_id:file.audit_file_id,programme_id:pid,step_code:code,decision:f.get('decision'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-pack-item-new')){itemForm();return true;}
  if(b.dataset.packItemEdit){const x=(w.compliance_items||[]).find(i=>i.item_code===b.dataset.packItemEdit);if(x)itemForm(x);return true;}
  if(b.dataset.packItemApprove){const id=b.dataset.packItemApprove,x=(w.compliance_items||[]).find(i=>i.item_id===id);modal('Partner · approve '+(x?.item_code||'item'),form(`<p class="full">${esc(x?.requirement||'')}</p><p class="full info">Approve only after reading the source. The system has not checked this wording against the primary text.</p>`+textArea('note','What did you check against the source? (at least 10 characters) *','',1000),'Approve'),f=>request({action:'audit_pack_item_approve',item_id:id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-pack-compliance-adopt')){try{const r=await request({action:'audit_pack_compliance_adopt',audit_file_id:file.audit_file_id});notice(r?.added?`${r.added} item${r.added===1?'':'s'} added to this file.`:'Nothing new to add.');await ctx.refresh();}catch(e){notice(e.message,true);}return true;}
  if(b.dataset.packCompliancePrepare){const id=b.dataset.packCompliancePrepare,k=(w.compliance||[]).find(t=>t.item_id===id);if(!k)return true;
   modal('Assess · '+k.title,form(`<p class="full">${esc(k.requirement||'')}</p>`+select('result','Result *',RESULTS,k.result||'Complied')+select('effect','If not complied, where is it reported? *',EFFECTS,k.reporting_effect&&k.reporting_effect!=='None'?k.reporting_effect:'Management letter')+textArea('note','What was checked, or what was found (at least 10 characters; 20 for a non-compliance) *',k.note||'',2000),'Save'),
    f=>request({action:'audit_pack_compliance_prepare',audit_file_id:file.audit_file_id,item_id:id,result:f.get('result'),effect:f.get('effect'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.packComplianceReview){const id=b.dataset.packComplianceReview,k=(w.compliance||[]).find(t=>t.item_id===id);if(!k)return true;
   modal('Review · '+k.title,form(`<p class="full">${esc(k.result||'')}: ${esc(k.note||'')}</p>`+select('decision','Decision *',['Accept','Return'],'Accept')+textArea('note','Review note (at least 5 characters to return)','',1000,false),'Save review'),f=>request({action:'audit_pack_compliance_review',audit_file_id:file.audit_file_id,item_id:id,decision:f.get('decision'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-pack-matter-new')){matterForm(file);return true;}
  if(b.dataset.packMatterEdit){const m=(w.matters||[]).find(t=>t.matter_id===b.dataset.packMatterEdit);if(m)matterForm(file,m);return true;}
  if(b.dataset.packMatterWithdraw){const id=b.dataset.packMatterWithdraw;modal('Withdraw matter',form(textArea('note','Why is it withdrawn? (at least 10 characters) *','',1000),'Withdraw'),f=>request({action:'audit_pack_matter_withdraw',matter_id:id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.packKamDecide){const id=b.dataset.packKamDecide,m=(w.matters||[]).find(t=>t.matter_id===id);if(!m)return true;
   modal('Partner · key audit matter decision for '+m.matter_ref,form(`<p class="full"><b>${esc(m.title)}</b><br>${esc(m.description)}</p>`+select('decision','Decision *',[['KAM','Key audit matter'],['Not a KAM','Not a key audit matter']],m.decision||'KAM')+textArea('significance_note','Why? (at least 20 characters) *',m.significance_note||'',3000)
     +field('heading','Heading (key audit matters only)',m.heading||'','text','maxlength="200"')+textArea('how_addressed','How the audit addressed it (key audit matters only; at least 20 characters)',m.how_addressed||'',3000,false)+textArea('draft_text','Draft text for the report (key audit matters only; at least 40 characters)',m.draft_text||'',5000,false),'Save decision'),
    f=>request({action:'audit_pack_kam_decide',matter_id:id,decision_data:{decision:f.get('decision'),significance_note:f.get('significance_note'),heading:f.get('heading')||'',how_addressed:f.get('how_addressed')||'',draft_text:f.get('draft_text')||''}}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-pack-policy')){const pol=w.policy;modal('Partner · statutory report setting',form(`<p class="full">Is an approved statutory report to the regulator required before a deposit-taking SACCO file can be signed off? The default is yes and is not confirmed until you save it.</p>`+select('value','Required? *',[['true','Yes, required'],['false','No, not required']],pol?.value||'true')+textArea('note','Why? (at least 10 characters) *','',1000),'Save setting'),f=>request({action:'audit_policy_save',key:'SACCO_DT_REQUIRES_STATUTORY_REPORT',value:f.get('value'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  return false;
 }
 return {panel,handle};
}
