// Audit build E: analytics on the client's posted ledger journals. Results are alerts that a Supervisor or above clears with a note.
export const TESTS=['Duplicate','Sequence gap','Benford','Round amounts','Weekend or holiday posting','Unusual preparer','Just under threshold'];
const MAKERS=['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'],CLEARERS=['SUPERVISOR','MANAGER','PARTNER'];
export function alertSummary(alerts){
 const open=alerts.filter(a=>a.status==='Open');
 return {open:open.length,high:open.filter(a=>a.severity==='High').length,cleared:alerts.length-open.length};
}
export function createAnalyticsUI(ctx){
 const {esc,field,form,modal,request,notice}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const textArea=(name,label,max=1000)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" required></textarea></label>`;
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 const detail=a=>{const d=a.detail||{};return a.test_kind==='Benford'?`<small>Population ${esc(d.population)}, chi-square ${esc(d.chi_square)} (limit ${esc(d.critical)}). ${esc(d.note||'')}</small>`:a.test_kind==='Sequence gap'?`<small>Missing: ${esc((d.missing_sample||[]).join(', '))}${d.missing_count>(d.missing_sample||[]).length?' and more':''}. ${esc(d.note||'')}</small>`:a.test_kind==='Round amounts'?`<small>${(d.samples||[]).map(x=>esc(x.reference)+' '+esc(x.amount)).join(' · ')}</small>`:'';};
 function panel(file,s){
  const role=staff().category_code,canRun=MAKERS.includes(role)&&open(file),canClear=CLEARERS.includes(role)&&open(file);
  const alerts=s?.analytics_alerts||[],runs=s?.analytics_runs||[],sum=alertSummary(alerts),last=runs[0];
  const testRow=t=>{const r=last?.tests?.[t];return `<tr><td>${esc(t)}</td><td>${!last?'':r?.ran===false?badge('Not run'):badge('Run','ok')}</td><td>${r?esc(r.found??''):''}</td><td>${r?esc(r.added??''):''}</td><td>${r?.reason?esc(r.reason):''}</td></tr>`;};
  const row=a=>`<tr><td>${esc(a.test_kind)}</td><td>${badge(a.severity,a.severity==='High'?'warn':'')}</td><td>${esc(a.title)}${detail(a)}${a.status==='Cleared'?`<small>Cleared by ${esc(a.cleared_by_name||'')}: ${esc(a.clear_note)}</small>`:''}</td><td>${badge(a.status,a.status==='Cleared'?'ok':'warn')}</td><td>${a.status==='Open'&&canClear?`<button data-audit-alert-clear="${esc(a.alert_id)}">Clear with a note</button>`:''}</td></tr>`;
  return `<section class="card"><div class="section-head"><div><h3>Analytics</h3><p class="muted">Tests run on the client's posted journals for the audit period. A result is a prompt to look closer, not proof of error. The file cannot go to review while an alert is open.</p></div><div class="actions">${canRun?'<button class="primary" data-audit-analytics-run>Run analytics</button>':''}</div></div>
  <dl class="audit-facts"><div><dt>Open alerts</dt><dd>${sum.open}</dd></div><div><dt>High severity open</dt><dd>${sum.high}</dd></div><div><dt>Cleared</dt><dd>${sum.cleared}</dd></div><div><dt>Last run</dt><dd>${last?esc(String(last.run_at).slice(0,10))+' · '+esc(last.population_journals)+' journals':'Not run'}</dd></div></dl>
  ${last?`<div class="scroll"><table><thead><tr><th>Test</th><th>Status</th><th>Found</th><th>New alerts</th><th>Note</th></tr></thead><tbody>${TESTS.map(testRow).join('')}</tbody></table></div>`:'<p class="muted">No run yet.</p>'}
  ${last?.tests?.population?.reason?`<p class="info">${esc(last.tests.population.reason)}</p>`:''}</section>
  <section class="card section-space"><h3>Alerts</h3>${alerts.length?`<div class="scroll"><table><thead><tr><th>Test</th><th>Severity</th><th>Alert</th><th>Status</th><th></th></tr></thead><tbody>${alerts.map(row).join('')}</tbody></table></div>`:'<p class="muted">No alerts.</p>'}</section>`;
 }
 async function handle(b,file){
  if(b.hasAttribute('data-audit-analytics-run')){
   modal('Run analytics',form(field('thresholds','Approval thresholds to test for amounts just under them (optional, comma separated; approved materiality is always included)','','text','inputmode="decimal"')+field('dup_min_amount','Smallest amount to test for duplicates (KES)','1000','text','inputmode="decimal"')+field('round_base','Round amounts are multiples of (KES)','1000','text','inputmode="decimal"')+'<p class="info full">Parameters are saved with the run.</p>','Run tests'),f=>request({action:'audit_analytics_run',audit_file_id:file.audit_file_id,...Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});return true;
  }
  if(b.dataset.auditAlertClear){const id=b.dataset.auditAlertClear;modal('Clear alert',form(textArea('note','What did you do to clear it? (at least 20 characters) *'),'Clear alert'),f=>request({action:'audit_analytic_clear',alert_id:id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  return false;
 }
 return {panel,handle};
}
