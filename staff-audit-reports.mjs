// Audit build D: draft financial statements, management letter, representation letter and completion memorandum.
// Reports are built on the server from the adjusted trial balance and the file's records. Each is a saved version with a different reviewer.
import {saccoFsView} from './staff-audit-sacco.mjs?v=20261109-licences-v1';
import {PACK_KINDS,statutoryView,kamView} from './staff-audit-pack.mjs?v=20261109-licences-v1';
export const KINDS=['Financial statements','Management letter','Representation letter','Completion memorandum'];
const PARTNER_ONLY=['Financial statements','Representation letter',...PACK_KINDS];
const MAKERS=['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'];
export const reportTitle=r=>`${r.kind} · version ${r.version_number}`;
export function createReportsUI(ctx){
 const {esc,field,select,form,modal,request,notice}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const money=v=>{if(v==null||v==='')return '';const n=Number(v);if(!Number.isFinite(n))return esc(v);const t=Math.abs(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`(${t})`:t;};
 const textArea=(name,label,value='',max=1500,req=true)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${req?'required':''}>${esc(value||'')}</textarea></label>`;
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 const canReviewKind=(role,kind)=>PARTNER_ONLY.includes(kind)?role==='PARTNER':['MANAGER','PARTNER'].includes(role);

 function fsView(b){
  if(b.layout==='SACCO')return saccoFsView(b);
  const t=b.totals||{};
  const sec=s=>`<tr><td colspan="3"><b>${esc(s.line)}</b></td></tr>${(s.items||[]).map(i=>`<tr><td>${esc(i.account_code)} · ${esc(i.account_name)}</td><td>${money(i.current)}</td><td>${i.comparative==null?'':money(i.comparative)}</td></tr>`).join('')}<tr><td><b>Total ${esc(s.line.toLowerCase())}</b></td><td><b>${money(s.total)}</b></td><td>${s.comparative_total==null?'':'<b>'+money(s.comparative_total)+'</b>'}</td></tr>`;
  return `<p class="muted">${esc(b.entity)} · period ended ${esc(b.period_end)} · ${esc(b.framework)} · framework ${esc(b.framework_status)}</p>
  <div class="scroll"><table><thead><tr><th>Caption</th><th>Current year</th><th>${b.comparative_available?'Prior year':''}</th></tr></thead><tbody>${(b.sections||[]).map(sec).join('')}</tbody></table></div>
  <dl class="audit-facts"><div><dt>Profit for the year</dt><dd>${money(t.profit_for_the_year)}</dd></div><div><dt>Total assets</dt><dd>${money(t.total_assets)}</dd></div><div><dt>Liabilities and equity (incl. profit)</dt><dd>${money(Number(t.total_liabilities||0)+Number(t.equity_including_profit||0))}</dd></div><div><dt>Difference</dt><dd>${money(t.difference)}</dd></div></dl>
  ${b.balances?'':'<p class="missing">The statements do not balance. Check the trial balance mapping before submitting.</p>'}${b.unmapped_tb_lines?`<p class="missing">${esc(b.unmapped_tb_lines)} trial-balance lines are not mapped and are left out.</p>`:''}<p class="info">${esc(b.note||'')}</p>`;
 }
 function mlView(b){
  const pts=b.points||[];
  return `<p class="muted">To: ${esc(b.addressee)}</p><p>${esc(b.introduction)}</p>${pts.length?pts.map(p=>`<article class="card section-space"><h4>${esc(p.ref)} · ${esc(p.title)} ${badge(p.rating,p.rating==='High'?'warn':'')}</h4><p>${esc(p.observation)}</p>${p.implication?`<p><b>Implication:</b> ${esc(p.implication)}</p>`:''}${p.recommendation?`<p><b>Recommendation:</b> ${esc(p.recommendation)}</p>`:''}${p.management_response?`<p><b>Management response:</b> ${esc(p.management_response)}</p>`:''}</article>`).join(''):'<p class="muted">No matters are included in this letter.</p>'}`;
 }
 function rlView(b){
  return `<p class="muted">To: ${esc(b.addressee)} · ${esc(b.entity)} · period ended ${esc(b.period_end)}</p><ol>${(b.paragraphs||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>
  ${(b.uncorrected_misstatements||[]).length?`<ul>${b.uncorrected_misstatements.map(m=>`<li>${esc(m.ref)} · ${esc(m.description)} (${money(m.profit_effect)})</li>`).join('')}</ul>`:''}
  <p>Signed for management: <b>${esc(b.signatory_name)}</b>, ${esc(b.signatory_title)}${b.letter_date?' · '+esc(b.letter_date):' · date to be completed'}</p>`;
 }
 function cmView(b){
  const flagged=b.flagged_matters||[],m=b.materiality;
  return `<p class="muted">${esc(b.entity)} · ${esc(b.framework)} · ${esc(b.period_start)} to ${esc(b.period_end)}</p>
  <h4>Matters flagged for the Partner</h4>${flagged.length?`<ul>${flagged.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'<p class="muted">Nothing was flagged.</p>'}
  <p>${m?`Materiality: overall ${money(m.overall)}, performance ${money(m.performance)}, clearly trivial ${money(m.trivial)} (${esc(m.benchmark)}).`:'Materiality has not been approved.'}</p>
  <p>Risks: ${(b.risks||[]).length} recorded, ${(b.risks||[]).filter(r=>r.status==='Open').length} open. Working papers: ${Object.entries(b.workpapers||{}).map(([k,v])=>esc(k)+' '+esc(v)).join(', ')||'none'}.</p>
  <p>Audit adjustments approved: ${esc(b.audit_adjustments?.approved??0)} (net profit effect ${money(b.audit_adjustments?.net_profit_effect)}). Unadjusted misstatements accumulated: ${money(b.misstatements?.accumulated)}.</p>
  ${(b.completion_items||[]).length?`<ul>${b.completion_items.map(i=>`<li>${esc(i.label)} · ${esc(i.status)}${i.note?' · '+esc(i.note):''}</li>`).join('')}</ul>`:''}
  ${b.overall_conclusion?`<p><b>Overall conclusion:</b> ${esc(b.overall_conclusion)}</p>`:'<p class="muted">No overall conclusion recorded yet.</p>'}`;
 }
 const VIEW={'Financial statements':fsView,'Management letter':mlView,'Representation letter':rlView,'Completion memorandum':cmView,'Statutory report to regulator':statutoryView,'Key audit matters':kamView};

 function panel(file,s){
  const role=staff().category_code,me=staff().staff_id,canMake=MAKERS.includes(role)&&open(file),leader=['MANAGER','PARTNER'].includes(role)&&open(file);
  const status=s?.report_status||[],reports=s?.reports||[],points=s?.mgmt_points||[];
  const latest=k=>reports.filter(r=>r.kind===k).sort((a,b)=>b.version_number-a.version_number)[0];
  const kindCard=k=>{
   const st=status.find(x=>x.kind===k)||{},r=latest(k),tone=st.approved_report_id&&st.current?'ok':'warn';
   const state=st.approved_report_id?(st.current?`Approved version ${st.approved_version}`:`Approved version ${st.approved_version} is out of date`):(st.required===false?'Not needed yet':'Not approved');
   const actions=[canMake?`<button data-audit-report-draft="${esc(k)}">${r?'Draft a new version':'Draft'}</button>`:'',
    r&&['Draft','Returned'].includes(r.status)&&open(file)&&(r.prepared_by===me||['MANAGER','PARTNER'].includes(role))?`<button class="primary" data-audit-report-submit="${esc(r.report_id)}">Submit for review</button>`:'',
    r&&r.status==='Submitted'&&open(file)&&r.prepared_by!==me&&canReviewKind(role,k)?`<button class="primary" data-audit-report-review="${esc(r.report_id)}">Review</button>`:'',
    r&&r.status==='Submitted'&&r.prepared_by!==me&&!canReviewKind(role,k)?`<small>Waiting for a ${PARTNER_ONLY.includes(k)?'Partner':'Manager or Partner'}.</small>`:''].join('');
   return `<article class="card section-space"><div class="section-head"><div><h4>${esc(k)}</h4><small>${esc(state)}${st.open_points?` · ${esc(st.open_points)} point${st.open_points===1?'':'s'} undecided`:''}</small></div><div>${badge(state,tone)}${r?' '+badge(reportTitle(r))+' '+badge(r.status,r.status==='Approved'?'ok':r.status==='Returned'?'warn':''):''}</div></div>
   ${r?`<p class="muted">Prepared by ${esc(r.prepared_by_name||'')}${r.reviewer_name?' · reviewed by '+esc(r.reviewer_name):''}${r.review_note?' · '+esc(r.review_note):''}${r.current===false?' · figures have changed since this version':''}</p>${(VIEW[k]||(()=> ''))(r.body||{})}`:'<p class="muted">No version yet.</p>'}
   <div class="actions">${actions}</div></article>`;
  };
  const pointRow=p=>`<tr><td><b>${esc(p.point_ref)}</b><small>${esc(p.source_kind)}</small></td><td>${esc(p.title)}<small>${esc(p.observation)}</small>${p.management_response?`<small>Management: ${esc(p.management_response)}</small>`:''}</td><td>${badge(p.rating,p.rating==='High'?'warn':'')}</td><td>${badge(p.status,p.status==='Included'?'ok':'')}${p.decision_note?`<small>${esc(p.decision_note)}</small>`:''}</td><td>${canMake?`<button data-audit-point-edit="${esc(p.point_id)}">Edit</button>`:''}${leader?`<button data-audit-point-decide="${esc(p.point_id)}">Decide</button>`:''}</td></tr>`;
  return `<section class="card"><div class="section-head"><div><h3>Reports</h3><p class="muted">Built from the adjusted trial balance and this file's records. Each version is saved and cannot be edited. The financial statements and representation letter (and, for a SACCO, the statutory report to the regulator and the key audit matters report) are approved by a Partner; the management letter and completion memorandum by a Manager or Partner. The file cannot be approved until the required reports are approved and still current.</p></div></div></section>
  ${KINDS.map(kindCard).join('')}${s?.pack?PACK_KINDS.map(kindCard).join(''):''}
  <section class="card section-space"><div class="section-head"><div><h3>Management letter points</h3><p class="muted">Suggested from adjustments, uncorrected misstatements, reconciling differences and deviations. A Manager or Partner includes or drops each one.</p></div><div class="actions">${canMake?'<button data-audit-points-suggest>Suggest points</button><button data-audit-point-new>Add a point</button>':''}</div></div>
   ${points.length?`<div class="scroll"><table><thead><tr><th>Ref</th><th>Matter</th><th>Rating</th><th>Status</th><th></th></tr></thead><tbody>${points.map(pointRow).join('')}</tbody></table></div>`:'<p class="muted">No points yet.</p>'}</section>`;
 }

 function pointForm(file,p){
  const body=(p?`<input type="hidden" name="point_id" value="${esc(p.point_id)}">`:'')+field('title','Title *',p?.title||'','text','required maxlength="200"')+select('rating','Rating *',['Low','Medium','High'],p?.rating||'Medium')
   +textArea('observation','What we found *',p?.observation||'',2000)+textArea('implication','What it means',p?.implication||'',1000,false)+textArea('recommendation','Recommendation',p?.recommendation||'',1000,false)+textArea('management_response','Management response',p?.management_response||'',1000,false);
  modal(p?'Edit '+p.point_ref:'Add a management-letter point',form(body,'Save point'),f=>request({action:'audit_mgmt_point_save',audit_file_id:file.audit_file_id,...Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});
 }
 async function run(req,ok){try{await request(req);await ctx.refresh();if(ok)notice(ok);}catch(e){notice(e.message||'That did not work.',true);}}
 async function handle(b,file){
  const s=ctx.snapshot();
  if(b.dataset.auditReportDraft!==undefined&&b.hasAttribute('data-audit-report-draft')){
   const kind=b.dataset.auditReportDraft;
   if(kind==='Representation letter'){modal('Draft the representation letter',form(field('signatory_name','Name of the person signing for management *','','text','required maxlength="120"')+field('signatory_title','Their title *','','text','required maxlength="120"')+field('letter_date','Date of the letter','','date')+field('addressee','Addressed to (default: the firm)','','text','maxlength="200"'),'Draft letter'),f=>request({action:'audit_report_draft',audit_file_id:file.audit_file_id,kind,...Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
   if(kind==='Completion memorandum'){modal('Draft the completion memorandum',form(textArea('overall_conclusion','Overall conclusion (optional; the Partner can complete it later)','',3000,false),'Draft memorandum'),f=>request({action:'audit_report_draft',audit_file_id:file.audit_file_id,kind,overall_conclusion:f.get('overall_conclusion')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
   if(kind==='Statutory report to regulator'){modal('Draft the statutory report to the regulator',form(field('addressee','Addressed to *','','text','required maxlength="200"')+textArea('partner_conclusion','The Partner\'s conclusion, in the Partner\'s own words *','',3000)+'<p class="info full">The system assembles the ratios, compliance results and section 10 matters. It does not write the conclusion or state the legal test.</p>','Draft report'),f=>request({action:'audit_report_draft',audit_file_id:file.audit_file_id,kind,addressee:f.get('addressee'),partner_conclusion:f.get('partner_conclusion')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
   await run({action:'audit_report_draft',audit_file_id:file.audit_file_id,kind});return true;
  }
  if(b.dataset.auditReportSubmit){await run({action:'audit_report_submit',report_id:b.dataset.auditReportSubmit});return true;}
  if(b.dataset.auditReportReview){const id=b.dataset.auditReportReview,r=(s?.reports||[]).find(x=>x.report_id===id);modal('Review '+(r?reportTitle(r):'report'),form(select('decision','Decision *',['Approve','Return'],'')+textArea('note','Review note (at least 10 characters) *','',1000),'Save review'),f=>request({action:'audit_report_review',report_id:id,decision:f.get('decision'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.hasAttribute('data-audit-points-suggest')){await run({action:'audit_mgmt_points_suggest',audit_file_id:file.audit_file_id});return true;}
  if(b.hasAttribute('data-audit-point-new')){pointForm(file);return true;}
  if(b.dataset.auditPointEdit){const p=(s?.mgmt_points||[]).find(x=>x.point_id===b.dataset.auditPointEdit);if(p)pointForm(file,p);return true;}
  if(b.dataset.auditPointDecide){const id=b.dataset.auditPointDecide,p=(s?.mgmt_points||[]).find(x=>x.point_id===id);modal('Decide '+(p?.point_ref||'point'),form(select('decision','Decision *',['Include','Drop','Reopen'],'')+textArea('note','Note (needed to drop a point, at least 10 characters)','',1000,false),'Save decision'),f=>request({action:'audit_mgmt_point_decide',point_id:id,decision:f.get('decision'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  return false;
 }
 return {panel,handle};
}
