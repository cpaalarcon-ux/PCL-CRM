// Audit build A: materiality with Partner approval, and the risk register tied to working papers.
export const BENCHMARKS=['Revenue','Total assets','Profit before tax','Total expenses','Equity','Other'];
export const RISK_LEVELS=['Low','Medium','High'];
const WRITERS=['SUPERVISOR','MANAGER','PARTNER'];
// Overall materiality is a share of the benchmark; performance and clearly trivial are shares of overall materiality.
export function computeMateriality(base,overallPct,performancePct,trivialPct){
 const n=v=>Number(String(v??'').replace(/,/g,'')),b=n(base),o=n(overallPct),p=n(performancePct),t=n(trivialPct);
 if(![b,o,p,t].every(Number.isFinite)||b<=0||o<=0||p<=0||t<=0)return null;
 const r=v=>Math.round(v*100)/100,overall=r(b*o/100);
 return {overall,performance:r(overall*p/100),trivial:r(overall*t/100)};
}
export function planningGateSummary(gate){
 if(!gate)return {materiality:false,risksOpen:0,fraud:false,uncovered:[],ready:false};
 const uncovered=gate.uncovered||[];
 return {materiality:!!gate.materiality_approved,risksOpen:Number(gate.risks_open||0),fraud:!!gate.fraud_risk_recorded,uncovered,ready:!!gate.materiality_approved&&Number(gate.risks_open||0)>0&&!!gate.fraud_risk_recorded&&!uncovered.length};
}
export function createPlanningUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const money=v=>{const n=Number(v);return Number.isFinite(n)?n.toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2}):esc(v??'');};
 const textArea=(name,label,value='',max=2000)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" required>${esc(value||'')}</textarea></label>`;
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const editable=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 function panel(file,s){
  const role=staff().category_code,me=staff().staff_id,canWrite=WRITERS.includes(role)&&editable(file);
  const mats=s?.materiality||[],risks=s?.risks||[],links=s?.risk_links||[],wps=s?.workpapers||[],gate=planningGateSummary(s?.planning_gate);
  const approved=mats.find(m=>m.status==='Approved'),draft=mats.find(m=>m.status==='Draft');
  const wpRef=id=>wps.find(w=>w.audit_workpaper_id===id)?.workpaper_ref||'';
  const refsFor=r=>links.filter(l=>l.risk_id===r.risk_id).map(l=>wpRef(l.audit_workpaper_id)).filter(Boolean);
  const matCard=m=>`<article class="audit-check"><div><b>Version ${m.version_number} ${badge(m.status,m.status==='Approved'?'ok':'')}</b><small>${esc(m.benchmark==='Other'?m.benchmark_other:m.benchmark)} of KES ${money(m.base_amount)} · overall ${esc(m.overall_pct)}% · performance ${esc(m.performance_pct)}% of overall · clearly trivial ${esc(m.trivial_pct)}% of overall</small><small>Overall KES ${money(m.overall_amount)} · performance KES ${money(m.performance_amount)} · clearly trivial KES ${money(m.trivial_amount)}</small><small>${esc(m.rationale)}</small><small>Prepared by ${esc(m.prepared_by_name||'')}${m.approved_by_name?` · approved by ${esc(m.approved_by_name)} on ${esc(shortDate(m.approved_at))}`:''}</small></div><div class="actions">${m.status==='Draft'&&role==='PARTNER'&&m.prepared_by!==me?`<button class="primary" data-audit-mat-approve="${esc(m.materiality_id)}">Approve materiality</button>`:''}${m.status==='Draft'&&role==='PARTNER'&&m.prepared_by===me?'<small>Another Partner approves what you prepared.</small>':''}</div></article>`;
  const riskRow=r=>{const refs=refsFor(r);const cov=r.status==='Closed'?badge('Closed'):refs.length?badge('Covered by '+refs.join(', '),'ok'):badge('No working paper yet','warn');
   return `<tr><td><b>${esc(r.risk_ref)}</b></td><td>${esc(r.description)}<small>${esc(r.audit_area)} · ${esc(r.assertion)}</small><small>Response: ${esc(r.planned_response)}</small></td><td>${esc(r.risk_level)}${r.significant?' · significant':''}${r.fraud_risk?' · fraud':''}</td><td>${cov}</td><td class="actions">${r.status==='Open'&&canWrite?`<button data-audit-risk-edit="${esc(r.risk_id)}">Edit</button><button data-audit-risk-link="${esc(r.risk_id)}">Working papers</button>`:''}${r.status==='Open'&&['MANAGER','PARTNER'].includes(role)&&r.created_by!==me?`<button data-audit-risk-close="${esc(r.risk_id)}">Close</button>`:''}</td></tr>`;};
  return `<section class="card"><div class="section-head"><div><h3>Materiality</h3><p class="muted">The preparer sets the benchmark and percentages and explains the choice. A Partner who did not prepare it approves it. The file cannot be marked Prepared without an approved materiality.</p></div>${canWrite?`<button class="primary" data-audit-mat-new>${draft||approved?'New version':'Calculate materiality'}</button>`:''}</div>
   ${mats.length?mats.map(matCard).join(''):'<p class="missing">No materiality has been calculated yet.</p>'}</section>
  <section class="card section-space"><div class="section-head"><div><h3>Assessed risks</h3><p class="muted">Record each risk, then link the working paper that responds to it. Before review, every open risk needs a working paper and at least one fraud risk (management override of controls) must be recorded.</p></div>${canWrite?'<button class="primary" data-audit-risk-new>Add risk</button>':''}</div>
   <ul class="audit-readiness"><li>${gate.materiality?'✓':'○'} <span>Materiality approved by a Partner</span></li><li>${gate.risksOpen>0?'✓':'○'} <span>Risks recorded (${gate.risksOpen} open)</span></li><li>${gate.fraud?'✓':'○'} <span>Fraud risk recorded</span></li><li>${gate.uncovered.length?'○':'✓'} <span>${gate.uncovered.length?'Not covered by a working paper: '+esc(gate.uncovered.join(', ')):'Every open risk has a working paper'}</span></li></ul>
   ${risks.length?`<div class="scroll"><table><thead><tr><th>Ref</th><th>Risk</th><th>Level</th><th>Coverage</th><th>Action</th></tr></thead><tbody>${risks.map(riskRow).join('')}</tbody></table></div>`:'<p class="missing">No risks have been recorded yet.</p>'}</section>`;
 }
 function matForm(file,areas){
  const prior=(ctx.snapshot()?.materiality||[]).find(m=>m.status!=='Superseded')||{};
  const body=select('benchmark','Benchmark *',BENCHMARKS,prior.benchmark||'Revenue')+field('benchmark_other','If Other, name it',prior.benchmark_other||'','text','maxlength="120"')
   +field('base_amount','Benchmark amount (KES) *',prior.base_amount||'','text','required inputmode="decimal"')+field('overall_pct','Overall materiality, % of benchmark *',prior.overall_pct||'','text','required inputmode="decimal"')
   +field('performance_pct','Performance materiality, % of overall *',prior.performance_pct||'75','text','required inputmode="decimal"')+field('trivial_pct','Clearly trivial, % of overall *',prior.trivial_pct||'5','text','required inputmode="decimal"')
   +textArea('rationale','Why this benchmark and percentage suit the client (at least 30 characters) *','',2000)+'<p class="info full">The amounts are worked out when you save. Percentages are your judgement; the Partner approves them.</p>';
  modal('Calculate materiality',form(body,'Save for Partner approval'),f=>request({action:'audit_materiality_save',audit_file_id:file.audit_file_id,...Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});
 }
 function riskForm(file,areas,r=null){
  const body=(r?`<input type="hidden" name="risk_id" value="${esc(r.risk_id)}">`:'')+textArea('description','Risk *',r?.description||'',1500)+select('audit_area','Audit area *',areas,r?.audit_area||'')+field('assertion','Assertion affected *',r?.assertion||'','text','required maxlength="200" placeholder="For example occurrence, completeness, valuation"')
   +select('risk_level','Assessed level *',RISK_LEVELS,r?.risk_level||'Medium')+`<label class="check"><input type="checkbox" name="significant" ${r?.significant?'checked':''}> Significant risk</label><label class="check"><input type="checkbox" name="fraud_risk" ${r?.fraud_risk?'checked':''}> Fraud risk (always significant)</label>`+textArea('planned_response','Planned response *',r?.planned_response||'',1500);
  modal(r?'Edit risk '+r.risk_ref:'Add assessed risk',form(body,'Save risk'),f=>request({action:'audit_risk_save',audit_file_id:file.audit_file_id,...Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});
 }
 function linkForm(file,r){
  const s=ctx.snapshot(),wps=(s?.workpapers||[]),linked=new Set((s?.risk_links||[]).filter(l=>l.risk_id===r.risk_id).map(l=>l.audit_workpaper_id));
  const editableWp=wps.filter(w=>['Draft','Returned'].includes(w.status)),lockedLinked=wps.filter(w=>!['Draft','Returned'].includes(w.status)&&linked.has(w.audit_workpaper_id));
  const rows=editableWp.map(w=>`<label class="check"><input type="checkbox" name="wp" value="${esc(w.audit_workpaper_id)}" ${linked.has(w.audit_workpaper_id)?'checked':''}> ${esc(w.workpaper_ref)} · ${esc(w.audit_area)} · ${esc(w.status)}</label>`).join('');
  const body=`<p class="full"><b>${esc(r.risk_ref)}</b> · ${esc(r.description)}</p>${rows||'<p class="missing full">There is no draft working paper to link. Add a working paper first.</p>'}${lockedLinked.length?`<p class="muted full">Already linked and locked: ${lockedLinked.map(w=>esc(w.workpaper_ref)).join(', ')}</p>`:''}`;
  modal('Working papers for '+r.risk_ref,form(body,'Save links'),async f=>{const want=new Set(f.getAll('wp'));for(const w of editableWp){const has=linked.has(w.audit_workpaper_id),now=want.has(w.audit_workpaper_id);if(has!==now)await request({action:'audit_risk_link',audit_workpaper_id:w.audit_workpaper_id,risk_id:r.risk_id,link:now});}return {ok:true};},()=>ctx.refresh(),{refreshWorkspace:false});
 }
 async function handle(b,file,areas){
  const s=ctx.snapshot();
  if(b.hasAttribute('data-audit-mat-new')){matForm(file,areas);return true;}
  if(b.dataset.auditMatApprove){const id=b.dataset.auditMatApprove,m=(s?.materiality||[]).find(x=>x.materiality_id===id);modal('Partner approval · materiality',`<p>Overall materiality KES <b>${money(m?.overall_amount)}</b>, performance KES <b>${money(m?.performance_amount)}</b>, clearly trivial KES <b>${money(m?.trivial_amount)}</b>.</p><p class="info">Confirm that the benchmark and percentages are appropriate for this client. This is your professional judgement.</p><button class="primary" id="auditMatOk">Approve materiality</button>`);document.querySelector('#auditMatOk').onclick=async()=>{try{await request({action:'audit_materiality_approve',materiality_id:id});document.querySelector('dialog[open]')?.close();await ctx.refresh();}catch(e){notice(e.message||'Could not approve materiality.',true);}};return true;}
  if(b.hasAttribute('data-audit-risk-new')){riskForm(file,areas);return true;}
  if(b.dataset.auditRiskEdit){const r=(s?.risks||[]).find(x=>x.risk_id===b.dataset.auditRiskEdit);if(r)riskForm(file,areas,r);return true;}
  if(b.dataset.auditRiskLink){const r=(s?.risks||[]).find(x=>x.risk_id===b.dataset.auditRiskLink);if(r)linkForm(file,r);return true;}
  if(b.dataset.auditRiskClose){const r=(s?.risks||[]).find(x=>x.risk_id===b.dataset.auditRiskClose);if(r)modal('Close risk '+r.risk_ref,form(textArea('note','Why the risk no longer applies (at least 10 characters) *','',1000),'Close risk'),f=>request({action:'audit_risk_close',risk_id:r.risk_id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  return false;
 }
 return {panel,handle};
}
