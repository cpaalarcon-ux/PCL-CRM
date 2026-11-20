// S3: Partner gates for SACCO audits. Home page: firm policy, SASRA eligibility, ratio table, figure definitions.
// Audit file tab "SASRA & quality": eligibility, report date and assembly deadline, prudential figures, ratio check, EQCR.
// No SASRA figure is stored in this file: the Partner enters every ratio from the source.
const POLICY=[['AUDIT_FILE_LOCK_DAYS','Days allowed to assemble the final file'],['AUDIT_FILE_LOCK_ANCHOR','Those days run from'],['SACCO_DT_REQUIRES_EQCR','Deposit-taking SACCOs need an EQCR (second Partner review)']];
const TYPES=[['DT_SACCO','Deposit-taking SACCO'],['NWDT_SACCO','Non-withdrawable-deposit-taking SACCO']];
export const typeLabel=t=>TYPES.find(x=>x[0]===t)?.[1]||'Not a SACCO';
export function policyText(row){
 if(!row)return '';
 if(row.key==='AUDIT_FILE_LOCK_DAYS')return `${row.value} days`;
 if(row.key==='AUDIT_FILE_LOCK_ANCHOR')return row.value==='YEAR_END'?'The financial year end':'The audit report date';
 return row.value==='true'?'Yes':'No';
}
export function ratioRule(r){
 const unit=r.measure==='Percentage'?'%':' KES';
 const of=r.measure==='Percentage'?` ${r.numerator_line} ÷ ${r.denominator_line}`:` ${r.numerator_line}`;
 return `${r.comparator} ${Number(r.threshold)}${unit}${of}`;
}
export function signoffSummary(sasra){
 if(!sasra)return null;
 const issues=sasra.issues||[];
 return {blocked:issues.length>0,count:issues.length,breaches:(sasra.ratios||[]).filter(r=>r.state==='Breach').length,unacknowledged:(sasra.ratios||[]).filter(r=>r.state==='Breach'&&!r.acknowledged).length};
}
export function createSasraUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{},role=()=>staff().category_code;
 const partner=()=>role()==='PARTNER',leader=()=>['PARTNER','MANAGER'].includes(role());
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const day=v=>v?esc(shortDate(v)):'—';
 const money=v=>{if(v==null||v==='')return '—';const n=Number(v);return Number.isFinite(n)?n.toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2}):esc(v);};
 const area=(name,label,value='',required=false,max=1000)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${required?'required':''}>${esc(value||'')}</textarea></label>`;
 const docsFor=clientId=>(ctx.data()?.documents||[]).filter(d=>d.client_id===clientId&&!d.archived_at).map(d=>[d.document_id,`${d.file_name} · ${d.category}`]);
 // ---------- Audit home ----------
 function homePanel(sasra,reg){
  if(!sasra)return '';
  const sum={rules:(sasra.ratios||[]).filter(r=>r.status==='Active').length,drafts:(sasra.ratios||[]).filter(r=>r.status==='Draft').length,saccos:(sasra.saccos||[]).length,undefinedLines:(sasra.lines||[]).filter(l=>!l.defined_by).length};
  return `<details class="card section-space audit-sasra"><summary><b>SACCO rules and firm policy</b> · ${sum.saccos} SACCO client(s) · ${sum.rules} active ratio(s), ${sum.drafts} draft · ${sum.undefinedLines} figure definition(s) to confirm</summary>
  <div class="info">A Partner sets these. The ERP holds no SASRA figure of its own: a ratio counts only after a Partner has entered it, linked a source verified from the primary text, and activated it. Defaults below are marked until a Partner confirms them.</div>
  ${policy(sasra)}${eligibility(sasra)}${ratios(sasra)}${lines(sasra)}</details>`;
 }
 function policy(sasra){
  return `<section class="section-space"><h3>Firm audit policy</h3><div class="scroll"><table><thead><tr><th>Setting</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${(sasra.policy||[]).map(r=>`<tr><td>${esc(POLICY.find(x=>x[0]===r.key)?.[1]||r.key)}</td><td><b>${esc(policyText(r))}</b></td>
   <td>${r.confirmed?badge('Confirmed','ok')+`<br><small>${esc(r.confirmed_by_name||'')} · ${day(r.updated_at)}</small>`:badge('Default — not yet confirmed by a Partner','warn')}</td><td class="actions">${partner()?`<button data-sasra-policy="${esc(r.key)}">Set</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>`;
 }
 function eligibility(sasra){
  const rows=sasra.saccos||[];
  return `<section class="section-space"><h3>SASRA auditor eligibility</h3><p class="muted">A SACCO statutory-audit project cannot be created until a Partner records, for the client and financial year, that the firm is on the SASRA approved auditor list, with the list attached.</p>
  <div class="scroll"><table><thead><tr><th>SACCO</th><th>Type</th><th>Eligibility records</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.company_name)}<br><small>${esc(c.firm_code)}</small></td><td>${esc(typeLabel(c.sacco_type))}</td>
   <td>${(c.records||[]).map(z=>`${badge('FY '+z.financial_year+(z.is_approved?' eligible':' not eligible'),z.is_approved?'ok':'bad')} <small>${esc(z.listing_reference)}</small>`).join('<br>')||badge('None recorded','bad')}</td>
   <td class="actions">${partner()?`<button data-sasra-elig="${esc(c.client_id)}|${esc(c.firm_id)}">Record eligibility</button>`:''}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No client is classified as a deposit-taking or non-withdrawable-deposit-taking SACCO yet. Set it in Edit client → Legal structure.</td></tr>'}</tbody></table></div></section>`;
 }
 function ratios(sasra){
  const rows=sasra.ratios||[];
  return `<section class="section-space"><div class="section-head"><h3>SASRA ratio table</h3><div class="actions">${leader()?'<button data-sasra-ratio="new">Add ratio</button>':''}</div></div>
  <div class="scroll"><table><thead><tr><th>Ratio</th><th>Applies to</th><th>Rule</th><th>Effective</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.label)}</b><br><small>${esc(r.ratio_code)}</small></td><td>${esc(typeLabel(r.sacco_type))}${r.client_name?`<br><small>Only ${esc(r.client_name)}</small>`:''}</td><td>${esc(ratioRule(r))}</td>
   <td>${day(r.effective_from)}${r.effective_to?' to '+day(r.effective_to):''}</td><td>${esc(r.reference_title||'—')}</td>
   <td>${r.status==='Active'?badge('Active','ok')+`<br><small>${esc(r.confirmed_by_name||'')} · ${day(r.confirmed_at)}</small>`:badge(r.status,r.status==='Draft'?'warn':'')}</td>
   <td class="actions">${r.status==='Draft'&&leader()?`<button data-sasra-ratio="${esc(r.ratio_id)}">Edit</button>`:''}${r.status==='Draft'&&partner()?`<button data-sasra-activate="${esc(r.ratio_id)}">Confirm &amp; activate</button>`:''}${r.status==='Active'&&partner()?`<button data-sasra-retire="${esc(r.ratio_id)}">Retire</button>`:''}</td></tr>`).join('')||'<tr><td colspan="7" class="muted">No ratio has been entered. Until a Partner confirms the ratios, a SACCO file cannot be signed off.</td></tr>'}</tbody></table></div></section>`;
 }
 function lines(sasra){
  return `<section class="section-space"><h3>What each figure means</h3><p class="muted">A ratio can be activated only when a Partner has written down what its figures include, against the Regulations in force.</p><div class="scroll"><table><thead><tr><th>Figure</th><th>Definition</th><th></th></tr></thead><tbody>${(sasra.lines||[]).map(l=>`<tr><td><b>${esc(l.label)}</b><br><small>${esc(l.line_code)}</small></td><td>${l.defined_by?esc(l.definition)+`<br><small>${esc(l.defined_by_name||'')} · ${day(l.defined_at)}</small>`:badge('Not defined yet','warn')}</td><td class="actions">${partner()?`<button data-sasra-line="${esc(l.line_code)}">${l.defined_by?'Change':'Define'}</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>`;
 }
 // ---------- Audit file tab ----------
 function filePanel(file,s){
  const x=s?.sasra;if(!x)return '<section class="card"><p class="muted">This file is not for a SACCO.</p></section>';
  const issues=x.issues||[],eq=x.eqcr||{},as=x.assembly||{},editable=['Draft','Prepared','Returned'].includes(file.file_status);
  return `<section class="card"><div class="section-head"><div><h3>SASRA and quality control</h3><p class="muted">${esc(typeLabel(x.sacco_type))} · financial year ${esc(x.financial_year)}</p></div></div>
  ${issues.length?`<div class="missing"><b>Final sign-off is blocked:</b><ul>${issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`:'<div class="info"><b>Nothing here blocks final sign-off.</b></div>'}</section>
  <section class="card section-space"><div class="section-head"><h3>SASRA auditor eligibility</h3><div class="actions">${partner()?`<button data-sasra-elig-file>Record eligibility</button>`:''}</div></div>
   <p>${x.eligible?badge('Eligible for FY '+x.financial_year,'ok'):badge('Not confirmed for FY '+x.financial_year,'bad')}</p>
   ${(x.eligibility_log||[]).length?`<div class="scroll"><table><thead><tr><th>Recorded</th><th>Result</th><th>Reference</th><th>Proof</th></tr></thead><tbody>${x.eligibility_log.map(l=>`<tr><td>${day(l.confirmed_at)}<br><small>${esc(l.confirmed_by_name)}</small></td><td>${l.is_approved?'Eligible':'Not eligible'}</td><td>${esc(l.listing_reference)}${l.appointment_reference?'<br><small>'+esc(l.appointment_reference)+'</small>':''}</td><td>${esc(l.proof_file_name||'—')}</td></tr>`).join('')}</tbody></table></div>`:''}</section>
  <section class="card section-space"><div class="section-head"><h3>Audit report date and file assembly</h3><div class="actions">${partner()?'<button data-sasra-report-date>Set report date</button>':''}</div></div>
   <dl class="audit-facts"><div><dt>Audit report date</dt><dd>${day(as.report_date)}</dd></div><div><dt>Days allowed</dt><dd>${esc(as.days)} ${as.days_confirmed?'':badge('default','warn')}</dd></div><div><dt>Counted from</dt><dd>${as.anchor==='YEAR_END'?'Financial year end':'Audit report date'} ${as.anchor_confirmed?'':badge('default','warn')}</dd></div><div><dt>Assembly deadline</dt><dd>${as.deadline?day(as.deadline):'Set once the audit report date is entered'}</dd></div></dl>
   <p class="muted">This shows the date. Locking the file at the deadline is a later build; until then nothing locks automatically.</p></section>
  <section class="card section-space"><div class="section-head"><h3>Prudential figures</h3></div><p class="muted">Enter each figure from the audited accounts with the working paper it comes from. The ERP compares them with the active ratios below.${editable?'':' Figures are locked once the file is sent for review.'}</p>
   <div class="scroll"><table><thead><tr><th>Figure</th><th>Amount (KES)</th><th>Source</th><th></th></tr></thead><tbody>${(x.figures||[]).map(g=>`<tr><td>${esc(g.label)}${g.defined?'':' '+badge('definition not confirmed','warn')}</td><td>${money(g.amount)}</td><td>${g.source_note?esc(g.source_note)+'<br><small>'+esc(g.entered_by_name||'')+' · '+day(g.entered_at)+'</small>':'—'}</td><td class="actions">${editable&&role()!=='INTERN'?`<button data-sasra-fig="${esc(g.line_code)}">${g.amount==null?'Enter':'Change'}</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="card section-space"><div class="section-head"><h3>Ratio check</h3></div>
   <div class="scroll"><table><thead><tr><th>Ratio</th><th>Required</th><th>This client</th><th>Result</th><th></th></tr></thead><tbody>${(x.ratios||[]).map(r=>`<tr><td>${esc(r.label)}${r.client_specific?' '+badge('client-specific','warn'):''}</td><td>${esc(r.comparator)} ${esc(Number(r.threshold))}${r.measure==='Percentage'?'%':' KES'}</td><td>${r.value==null?'—':esc(Number(r.value).toLocaleString('en-KE',{maximumFractionDigits:2}))+(r.measure==='Percentage'?'%':'')}</td>
    <td>${r.state==='Met'?badge('Met','ok'):r.state==='Breach'?badge('Regulatory breach','bad')+(r.acknowledged?'<br><small>Acknowledged by '+esc(r.ack_by||'')+' · '+day(r.ack_at)+'</small>':r.ack_stale?'<br><small>Acknowledgement is out of date: the figures changed</small>':''):badge(r.state,'warn')}</td>
    <td class="actions">${r.state==='Breach'&&!r.acknowledged&&partner()?`<button data-sasra-ack="${esc(r.ratio_id)}">Acknowledge breach</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No active ratio applies to this type of SACCO and year end. A Partner confirms the ratios under SACCO rules and firm policy on the Audit home.</td></tr>'}</tbody></table></div></section>
  ${eqcr(file,eq)}
  ${(x.quality_log||[]).length?`<section class="card section-space"><h3>Quality log</h3><ul>${x.quality_log.map(q=>`<li>${day(q.created_at)} · <b>${esc(q.kind)}</b>${q.by?' · '+esc(q.by):''}${q.note?' — '+esc(q.note):''}</li>`).join('')}</ul></section>`:''}`;
 }
 function eqcr(file,eq){
  if(!eq.required)return `<section class="card section-space"><h3>Engagement quality control review (EQCR)</h3><p class="muted">Not required for this file under the current firm policy.</p></section>`;
  const mine=(eq.my_conflicts||[]);
  return `<section class="card section-space"><div class="section-head"><h3>Engagement quality control review (EQCR)</h3><div class="actions">${eq.can_act?'<button class="primary" data-sasra-eqcr="Approve">Approve EQCR</button><button data-sasra-eqcr="Return">Return the file</button>':''}</div></div>
   <p>${eq.approved?badge('EQCR approved','ok')+` <small>${esc(eq.last_by||'')} · ${day(eq.last_at)}</small>`:badge(eq.last_kind==='EQCR approval void'?'Approval withdrawn: the file was returned':'EQCR approval needed','bad')}</p>
   <p class="muted">A second Partner who took no part in the engagement gives the EQCR while the file is In Review. Final sign-off stays blocked until then.</p>
   ${eq.eligible_partners===0?'<p class="missing">No Partner is free of a part in this engagement, so no one can give the EQCR. A Partner decision is needed (for example an external reviewer).</p>':`<p class="muted">${esc(eq.eligible_partners)} Partner(s) could give the EQCR.</p>`}
   ${partner()&&mine.length?`<p class="info">You cannot give the EQCR on this file: you ${esc(mine.join('; '))}.</p>`:''}
   ${partner()&&!mine.length&&!eq.can_act&&file.file_status!=='In Review'?'<p class="info">The EQCR is given when the file is In Review.</p>':''}</section>`;
 }
 // ---------- Actions ----------
 const refresh=()=>ctx.refresh();
 function eligibilityModal(clientId,firmId,year){
  const docs=docsFor(clientId);
  modal('Partner confirmation · SASRA auditor eligibility',form(`<p class="full">Upload the current SASRA approved auditor list to this client's documents first, then choose it here.</p>`+field('financial_year','Financial year (year it ends) *',year||new Date().getFullYear()-1,'number','required min="2000" max="2100"')+
   select('is_approved','Result *',[['true','The firm is listed'],['false','The firm is not listed']],'true')+select('proof_document_id','Approved auditor list (file) *',[['','Choose…'],...docs],'')+field('listing_reference','Where in the list (circular, page) *','','text','required maxlength="500"')+
   field('appointment_reference','AGM approval or SASRA appointment reference','','text','maxlength="500"')+area('independence_note','Independence and PIE assessment — what you checked *','',true,2000)+
   `<label class="full"><input type="checkbox" name="confirm" value="1"> I confirm PCL is listed on the SASRA approved auditor list for this financial year.</label>`,'Record'),
   f=>request({action:'audit_sasra_eligibility_record',client_id:clientId,firm_id:firmId,financial_year:f.get('financial_year'),is_approved:f.get('is_approved')==='true',proof_document_id:f.get('proof_document_id')||null,listing_reference:f.get('listing_reference'),appointment_reference:f.get('appointment_reference'),independence_note:f.get('independence_note'),confirm:f.get('confirm')==='1'}),()=>refresh());
 }
 async function handle(b,file){
  const H=ctx.sasra?.()||{},F=ctx.snapshot?.()?.sasra||null;
  if(b.dataset.sasraPolicy){
   const row=(H.policy||[]).find(r=>r.key===b.dataset.sasraPolicy);if(!row)return true;
   const input=row.key==='AUDIT_FILE_LOCK_DAYS'?field('value','Days (1 to 365) *',row.value,'number','required min="1" max="365"'):row.key==='AUDIT_FILE_LOCK_ANCHOR'?select('value','Count the days from *',[['REPORT_DATE','The audit report date'],['YEAR_END','The financial year end']],row.value):select('value','Needs an EQCR? *',[['true','Yes'],['false','No']],row.value);
   modal('Partner setting · '+(POLICY.find(x=>x[0]===row.key)?.[1]||row.key),form(input+area('note','Why this value *','',true),'Save setting'),f=>request({action:'audit_policy_save',key:row.key,value:f.get('value'),note:f.get('note')}),()=>refresh());return true;
  }
  if(b.dataset.sasraElig){const [c,fm]=b.dataset.sasraElig.split('|');eligibilityModal(c,fm);return true;}
  if(b.hasAttribute('data-sasra-elig-file')){eligibilityModal(file.client_id,file.handling_firm_id,F?.financial_year);return true;}
  if(b.dataset.sasraLine){
   const l=(H.lines||[]).find(x=>x.line_code===b.dataset.sasraLine);if(!l)return true;
   modal('Partner definition · '+l.label,form(area('definition','What this figure includes, and the Regulation it comes from *',l.definition||'',true,2000),'Save definition'),f=>request({action:'audit_sasra_line_define',line_code:l.line_code,definition:f.get('definition')}),()=>refresh());return true;
  }
  if(b.dataset.sasraRatio){
   const id=b.dataset.sasraRatio,r=id==='new'?{}:(H.ratios||[]).find(x=>x.ratio_id===id);if(id!=='new'&&!r)return true;
   const lineItems=(H.lines||[]).map(l=>[l.line_code,l.label]),refs=[['','None yet'],...((ctx.regulatoryRefs?.()||[]).map(x=>[x.ref_id,x.title+(x.verification==='Primary source verified'?'':' (not verified from primary source)')]))];
   modal(id==='new'?'Add SASRA ratio (draft)':'Edit draft ratio',form((id==='new'?field('ratio_code','Short code *','','text','required maxlength="60" placeholder="e.g. CORE_CAPITAL_TO_ASSETS"'):'')+field('label','Name *',r.label||'','text','required maxlength="200"')+select('sacco_type','Applies to *',TYPES,r.sacco_type||'DT_SACCO')+
    select('measure','Measure *',['Percentage','Amount KES'],r.measure||'Percentage')+select('comparator','Rule *',['At least','At most'],r.comparator||'At least')+field('threshold','Minimum or maximum (copy from the source) *',r.threshold??'','text','required inputmode="decimal"')+
    select('numerator_line','Figure (top line) *',lineItems,r.numerator_line||'CORE_CAPITAL')+select('denominator_line','Divided by (percentages only)',[['','—'],...lineItems],r.denominator_line||'')+field('effective_from','Takes effect on *',r.effective_from?String(r.effective_from).slice(0,10):'','date','required')+
    field('effective_to','Ends on (optional)',r.effective_to?String(r.effective_to).slice(0,10):'','date')+select('reference_id','Source (legal reference)',refs,r.reference_id||'')+'<p class="info full">Saved as a draft. A Partner confirms and activates it after checking the source.</p>','Save draft'),
    f=>request({action:'audit_sasra_ratio_save',ratio_id:id==='new'?null:id,revision:r.revision,ratio_code:f.get('ratio_code'),label:f.get('label'),sacco_type:f.get('sacco_type'),measure:f.get('measure'),comparator:f.get('comparator'),threshold:f.get('threshold'),numerator_line:f.get('numerator_line'),denominator_line:f.get('denominator_line')||null,effective_from:f.get('effective_from'),effective_to:f.get('effective_to')||null,reference_id:f.get('reference_id')||null}),()=>refresh());return true;
  }
  if(b.dataset.sasraActivate){
   const r=(H.ratios||[]).find(x=>x.ratio_id===b.dataset.sasraActivate);if(!r)return true;
   modal('Partner confirmation · '+r.label,form(`<p class="full"><b>${esc(ratioRule(r))}</b> · ${esc(typeLabel(r.sacco_type))} · from ${day(r.effective_from)}</p><p class="info full">Activate only after checking this figure against the source. The linked source must be verified from the primary text, and both figures must have a confirmed definition.</p>`+area('note','Source page or paragraph you checked *','',true),'Confirm & activate'),
    f=>request({action:'audit_sasra_ratio_activate',ratio_id:r.ratio_id,revision:r.revision,note:f.get('note')}),()=>refresh());return true;
  }
  if(b.dataset.sasraRetire){
   const r=(H.ratios||[]).find(x=>x.ratio_id===b.dataset.sasraRetire);if(!r)return true;
   modal('Retire ratio · '+r.label,form(field('effective_to','Last day it applies (optional)','','date')+area('note','Why *','',true),'Retire'),f=>request({action:'audit_sasra_ratio_retire',ratio_id:r.ratio_id,effective_to:f.get('effective_to')||null,note:f.get('note')}),()=>refresh());return true;
  }
  if(b.dataset.sasraFig){
   const g=(F?.figures||[]).find(x=>x.line_code===b.dataset.sasraFig);if(!g)return true;
   modal('Prudential figure · '+g.label,form(field('amount','Amount (KES) *',g.amount??'','text','required inputmode="decimal"')+field('source_note','Where it comes from (working paper, note) *',g.source_note||'','text','required maxlength="500"'),'Save figure'),f=>request({action:'audit_sasra_figure_save',audit_file_id:file.audit_file_id,line_code:g.line_code,amount:f.get('amount'),source_note:f.get('source_note')}),()=>refresh());return true;
  }
  if(b.dataset.sasraAck){
   const r=(F?.ratios||[]).find(x=>x.ratio_id===b.dataset.sasraAck);if(!r)return true;
   modal('Acknowledge regulatory breach',form(`<p class="full"><b>${esc(r.label)}</b>: ${esc(Number(r.value).toLocaleString('en-KE',{maximumFractionDigits:2}))}${r.measure==='Percentage'?'%':''} against ${esc(r.comparator.toLowerCase())} ${esc(Number(r.threshold))}${r.measure==='Percentage'?'%':''}.</p>`+area('note','How this affects the audit report and the statutory report to SASRA *','',true,2000),'Acknowledge'),f=>request({action:'audit_sasra_breach_ack',audit_file_id:file.audit_file_id,ratio_id:r.ratio_id,note:f.get('note')}),()=>refresh());return true;
  }
  if(b.hasAttribute('data-sasra-report-date')){
   modal('Audit report date',form(field('audit_report_date','Date of the audit report *',F?.assembly?.report_date?String(F.assembly.report_date).slice(0,10):'','date','required')+(F?.assembly?.report_date?area('note','Why the date is changing *','',true):''),'Save date'),f=>request({action:'audit_report_date_save',audit_file_id:file.audit_file_id,audit_report_date:f.get('audit_report_date'),note:f.get('note')}),()=>refresh());return true;
  }
  if(b.dataset.sasraEqcr){
   const approve=b.dataset.sasraEqcr==='Approve';
   modal(approve?'Approve EQCR':'Return the file',form(`<p class="info full">${approve?'You confirm you reviewed the significant judgments, the opinion and the SASRA matters, and took no part in the engagement.':'The file goes back to the preparer. Any earlier EQCR approval is withdrawn.'}</p>`+area('note','What you reviewed and concluded *','',true,2000),approve?'Approve EQCR':'Return file'),f=>request({action:'audit_eqcr_decide',audit_file_id:file.audit_file_id,decision:approve?'Approve':'Return',note:f.get('note')}),()=>refresh());return true;
  }
  return false;
 }
 return {homePanel,filePanel,handle};
}
