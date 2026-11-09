// Audit build F: links to the rest of the firm. Time and WIP for the file, the draft invoice raised on approval, sign-off deadline, and Partner/Manager tiles.
const LEADERS=['MANAGER','PARTNER'];
export function tileSummary(t){
 if(!t)return null;
 return {overdue:t.deadlines?.overdue??0,due:t.deadlines?.due_14_days??0,notSet:t.deadlines?.not_set??0,rate:t.review_rate?.pct,stuck:Object.values(t.stuck?.by_stage||{}).reduce((s,x)=>s+Number(x),0),invoices:t.draft_invoices_waiting??0};
}
export function createFirmUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const money=v=>{if(v==null||v==='')return '—';const n=Number(v);if(!Number.isFinite(n))return esc(v);const t=Math.abs(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`(${t})`:t;};
 const hrs=v=>v==null?'—':Number(v).toLocaleString('en-KE',{maximumFractionDigits:2});
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 // Tiles on the audit home page. Only Managers and Partners are sent the figures.
 function tiles(t){
  const x=tileSummary(t);if(!x||!LEADERS.includes(staff().category_code))return '';
  const stuckList=(t.stuck?.files||[]).map(f=>`<li><button class="link" data-audit-open="${esc(f.project_id)}">${esc(f.client)}</button> · ${esc(f.status)} · no change for ${esc(f.idle_days)} days</li>`).join('');
  const nextList=(t.deadlines?.next||[]).map(f=>`<li><button class="link" data-audit-open="${esc(f.project_id)}">${esc(f.client)}</button> · ${esc(shortDate(f.due))} · ${f.days<0?esc(-f.days)+' days overdue':esc(f.days)+' days left'}</li>`).join('');
  return `<section class="audit-tiles" aria-label="Audit oversight"><div class="tile ${x.overdue?'warn':''}"><span>Sign-off deadlines</span><b>${x.overdue} overdue</b><small>${x.due} due in 14 days · ${x.notSet} with no deadline</small></div>
  <div class="tile"><span>Reviewed before sign-off</span><b>${x.rate==null?'—':esc(x.rate)+'%'}</b><small>${esc(t.review_rate?.reviewed??0)} of ${esc(t.review_rate?.sent_for_review??0)} working papers submitted, on files at review or later</small></div>
  <div class="tile ${x.stuck?'warn':''}"><span>Files stuck by stage</span><b>${x.stuck}</b><small>${Object.entries(t.stuck?.by_stage||{}).map(([k,v])=>esc(k)+' '+esc(v)).join(' · ')||'None'} · no change for ${esc(t.stuck?.days)} days</small></div>
  <div class="tile"><span>Draft invoices waiting</span><b>${x.invoices}</b><small>Raised when a file was approved. A Partner posts them.</small></div></section>
  ${nextList?`<details class="card section-space"><summary>Next deadlines</summary><ul>${nextList}</ul></details>`:''}${stuckList?`<details class="card section-space"><summary>Stuck files</summary><ul>${stuckList}</ul></details>`:''}`;
 }
 function panel(file,s){
  const role=staff().category_code,t=s?.time_summary,tasks=s?.my_tasks||[],bl=s?.billing_link;
  const canLog=role!=='INTERN'&&open(file)&&tasks.length>0,leader=LEADERS.includes(role);
  const budget=t&&t.budgeted_hours!=null?Number(t.budgeted_hours):null,used=t?Number(t.approved_hours)+Number(t.submitted_hours):0;
  return `<section class="card"><div class="section-head"><div><h3>Time and billing</h3><p class="muted">Audit hours are ordinary timesheets on this audit project. Once a Manager approves them they count in work in progress (WIP). Approving the audit file raises a draft invoice; nothing is posted automatically.</p></div><div class="actions">${canLog?'<button class="primary" data-audit-time-log>Log audit time</button>':''}</div></div>
  ${role!=='INTERN'&&open(file)&&!tasks.length?'<p class="info">To log time here you need an open task assigned to you on this audit project. Ask a Manager to assign one.</p>':''}
  ${t?`<dl class="audit-facts"><div><dt>Approved hours</dt><dd>${hrs(t.approved_hours)}</dd></div><div><dt>Waiting for approval</dt><dd>${hrs(t.submitted_hours)}</dd></div><div><dt>Draft hours</dt><dd>${hrs(t.draft_hours)}</dd></div><div><dt>Budgeted hours</dt><dd>${budget==null?'No budget':hrs(budget)}${budget?` · ${Math.round(used/budget*100)}% used`:''}</dd></div>
   ${t.money_visible?`<div><dt>Agreed fee</dt><dd>KES ${money(t.agreed_fee)}</dd></div><div><dt>Standard value of approved time</dt><dd>KES ${money(t.standard_value)}</dd></div><div><dt>Billed (posted, before VAT)</dt><dd>KES ${money(t.billed_net)}</dd></div><div><dt>Unbilled WIP</dt><dd>KES ${money(t.wip_unbilled)}</dd></div>`:''}</dl>
   ${Number(t.hours_without_rate)>0?`<p class="missing">${hrs(t.hours_without_rate)} approved billable hours have no staff rate, so they are left out of the value.</p>`:''}
   ${(t.by_staff||[]).length?`<div class="scroll"><table><thead><tr><th>Staff</th><th>Approved</th><th>Waiting</th><th>Draft</th></tr></thead><tbody>${t.by_staff.map(r=>`<tr><td>${esc(r.staff_name)}</td><td>${hrs(r.approved)}</td><td>${hrs(r.submitted)}</td><td>${hrs(r.draft)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No time recorded yet.</p>'}`:'<p class="muted">Time figures are not available.</p>'}</section>
  <section class="card section-space"><div class="section-head"><div><h3>Sign-off deadline</h3></div><div class="actions">${leader&&open(file)?'<button data-audit-deadline>Set deadline</button>':''}</div></div><p>${file?.signoff_due_on?esc(shortDate(file.signoff_due_on)):'No deadline set. The firm tiles count this file as having no deadline.'}</p></section>
  <section class="card section-space"><h3>Invoice on approval</h3>${bl?`<p>${badge(bl.outcome,bl.invoice_id?'ok':'warn')} ${bl.invoice_id?badge('Invoice '+bl.invoice_status,bl.invoice_status==='Posted'?'ok':''):''}</p><p class="muted">${esc(bl.note)}</p>${bl.invoice_id?`<p>Net KES ${money(bl.net_amount)} · VAT KES ${money(bl.vat_amount)}${bl.invoice_number?' · '+esc(bl.invoice_number):''}. Open Invoices to review it; a Partner posts it.</p>`:''}`:'<p class="muted">When this file is approved, a draft invoice is raised for the agreed fee not yet invoiced. It stays a draft until a Partner posts it. If the project has no agreed fee, no draft is raised.</p>'}</section>`;
 }
 async function handle(b,file){
  const s=ctx.snapshot();
  if(b.hasAttribute('data-audit-time-log')){
   const tasks=(s?.my_tasks||[]).map(x=>[x.task_id,x.task_name]),wps=(s?.workpapers||[]).map(w=>[w.workpaper_ref,w.workpaper_ref+' · '+w.audit_area]);
   modal('Log audit time',form(select('task_id','Your task *',tasks,tasks[0]?.[0]||'')+field('work_date','Work date *',new Date().toISOString().slice(0,10),'date','required')+field('hours','Hours *','','text','required inputmode="decimal"')+(wps.length?select('workpaper_ref','Working paper (optional)',wps,''):'')+field('description','What did you do? *','','text','required maxlength="300"'),'Submit time'),
    f=>request({action:'timesheet_save',task_id:f.get('task_id'),work_date:f.get('work_date'),hours:f.get('hours'),billable:true,status:'Submitted',description:`Audit${f.get('workpaper_ref')?' '+f.get('workpaper_ref'):''}: ${f.get('description')}`}),()=>ctx.refresh(),{refreshWorkspace:false});return true;
  }
  if(b.hasAttribute('data-audit-deadline')){
   modal('Sign-off deadline',form(field('signoff_due_on','Deadline (leave empty to clear)',file.signoff_due_on?String(file.signoff_due_on).slice(0,10):'','date')+'<p class="info full">Set by a Manager or Partner. It cannot be earlier than the end of the audit period.</p>','Save deadline'),f=>request({action:'audit_deadline_save',audit_file_id:file.audit_file_id,signoff_due_on:f.get('signoff_due_on')||null}),()=>ctx.refresh(),{refreshWorkspace:false});return true;
  }
  return false;
 }
 return {tiles,panel,handle};
}
