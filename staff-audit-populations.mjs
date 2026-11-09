// Audit build S5: populations and their reconciliation to the adjusted trial balance.
// A population is the listing that audit tests are drawn from. The file keeps its source, report, parameters, dates, preparer, row count and control total,
// and the server reconciles the control total to the adjusted trial balance of its audit area. The rows themselves are not stored here.
export const BALANCE_NATURES=['Debit','Credit'];
export const POPULATION_AREAS=['Cash and bank','Trade receivables','Inventories','Property, plant and equipment','Trade payables','Borrowings','Taxation','Revenue','Payroll and expenses','Equity','Commitments and contingencies'];
const MAKERS=['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'];
export function stateTone(state){return state==='Ties'?'ok':state==='Reconciled with note'?'':state==='Withdrawn'?'':'warn';}
// Which side the area's balance sits on in the adjusted trial balance (debit positive).
export function suggestNature(adjustedNet){return Number(adjustedNet)<0?'Credit':'Debit';}
export function collectPopulation(entries){
 const g=k=>String(entries[k]??'').trim();
 return {audit_area:g('audit_area'),title:g('title'),source_system:g('source_system'),report_name:g('report_name'),parameters:g('parameters'),as_at:g('as_at'),report_run_on:g('report_run_on'),row_count:g('row_count'),control_total:g('control_total'),balance_nature:g('balance_nature'),
  reconciling_amount:g('reconciling_amount'),reconciling_note:g('reconciling_note'),ipe_check:g('ipe_check'),evidence_document_id:g('evidence_document_id')||null};
}
export function createPopulationsUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const money=v=>{const n=Number(v);if(!Number.isFinite(n))return esc(v??'');const t=Math.abs(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`(${t})`:t;};
 const textArea=(name,label,value='',max=1500,req=true)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${req?'required':''}>${esc(value||'')}</textarea></label>`;
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 function panel(file,s){
  const role=staff().category_code,me=staff().staff_id,canMake=MAKERS.includes(role)&&open(file),canReview=['MANAGER','PARTNER'].includes(role);
  const pops=(s?.populations||[]),live=pops.filter(x=>x.status!=='Withdrawn'),withdrawn=pops.filter(x=>x.status==='Withdrawn'),policy=s?.population_policy||null,required=policy?.areas||[];
  const areas=(s?.lead_schedule||[]).filter(a=>a.active);
  const without=areas.filter(a=>!live.some(x=>x.audit_area===a.audit_area));
  const row=x=>{
   const mine=x.prepared_by===me,editable=['Draft','Returned'].includes(x.status)&&(mine||canReview)&&open(file);
   const difference=Number(x.residual);
   return `<tr><td><b>${esc(x.pop_ref)}</b><small>${esc(x.audit_area)}</small></td><td>${esc(x.title)}<small>${esc(x.source_system)} · ${esc(x.report_name)}</small><small>Parameters: ${esc(x.parameters)}</small><small>As at ${esc(shortDate(x.as_at))} · run ${esc(shortDate(x.report_run_on))} · prepared by ${esc(x.prepared_by_name)}</small>${x.ipe_check?`<small>Report checked: ${esc(x.ipe_check)}</small>`:'<small class="missing">Report completeness and accuracy not recorded yet</small>'}${x.evidence_file_name?`<small>Evidence: ${esc(x.evidence_file_name)}</small>`:''}</td>`
    +`<td>${x.row_count.toLocaleString('en-KE')}</td><td>${money(x.control_total)} ${esc(x.balance_nature==='Credit'?'Cr':'Dr')}${Number(x.reconciling_amount)?`<small>Reconciling items ${money(x.reconciling_amount)}</small>${x.reconciling_note?`<small>${esc(x.reconciling_note)}</small>`:''}`:''}</td>`
    +`<td>${money(x.gl_balance)}<small>Adjusted trial balance</small></td><td>${badge(x.state==='Difference'?`Difference ${money(difference)}`:x.state==='Needs note'?'Reconciling items need a note':x.state,stateTone(x.state))}<small>${esc(x.status)}${x.status==='Returned'&&x.review_note?': '+esc(x.review_note):''}</small></td>`
    +`<td><div class="actions">${editable?`<button data-audit-pop-edit="${esc(x.population_id)}">Edit</button><button class="primary" data-audit-pop-submit="${esc(x.population_id)}">Submit</button><button data-audit-pop-withdraw="${esc(x.population_id)}">Withdraw</button>`:''}${x.status==='Submitted'&&canReview&&!mine?`<button class="primary" data-audit-pop-review="${esc(x.population_id)}">Review</button>`:''}${x.status==='Approved'&&canReview&&open(file)?`<button data-audit-pop-reopen="${esc(x.population_id)}">Reopen</button>`:''}</div></td></tr>`;
  };
  const policyCard=`<section class="card section-space"><div class="section-head"><div><h3>Areas the firm requires a population for</h3><p class="muted">A required area cannot have its lead schedule approved, or the file approved, until it has an approved population that reconciles. Areas not listed can still have one.</p></div>${role==='PARTNER'?`<button data-audit-pop-policy>Set required areas</button>`:''}</div>
   <p>${required.length?required.map(a=>badge(a)).join(' '):'<span class="muted">No area is required.</span>'}</p>
   <p class="muted">${policy?.confirmed?`Confirmed by ${esc(policy.confirmed_by_name||'a Partner')}${policy.note?': '+esc(policy.note):''}.`:'Default — not yet confirmed by a Partner.'}</p></section>`;
  const missingCard=without.length?`<section class="card section-space"><h3>Areas with a balance and no population</h3><ul class="audit-readiness">${without.map(a=>`<li>${required.includes(a.audit_area)?'!':'○'} <span>${esc(a.audit_area)}<small> · adjusted balance ${money(a.adjusted_net)}</small></span>${required.includes(a.audit_area)?badge('Required','warn'):badge('Optional')}</li>`).join('')}</ul></section>`:'';
  return `<section class="card"><div class="section-head"><div><h3>Populations and reconciliations</h3><p class="muted">Record each listing the audit tests draw from, which report produced it and how it was checked. The control total is compared with the adjusted trial balance for its audit area as soon as you save. A Manager or Partner who did not prepare it approves it.</p></div>${canMake?`<button class="primary" data-audit-pop-new="${esc(file.audit_file_id)}">+ Record a population</button>`:''}</div>
   <div class="audit-note">The population is as at the financial year end. One live population is kept for each audit area. Only the summary and the evidence file are stored; the rows stay in the source system or evidence file.</div>
   ${live.length?`<div class="scroll"><table><thead><tr><th>Ref</th><th>Population</th><th>Rows</th><th>Control total</th><th>Per ledger</th><th>Reconciliation</th><th>Action</th></tr></thead><tbody>${live.map(row).join('')}</tbody></table></div>`:'<p class="missing">No population has been recorded yet.</p>'}
   ${withdrawn.length?`<details class="audit-history"><summary>Withdrawn · ${withdrawn.length}</summary>${withdrawn.map(x=>`<p><b>${esc(x.pop_ref)} · ${esc(x.audit_area)}</b><small>${esc(x.title)} · ${esc(x.review_note)}</small></p>`).join('')}</details>`:''}</section>${missingCard}${policyCard}`;
 }
 function popForm(file,x=null){
  const s=ctx.snapshot(),areas=(s?.lead_schedule||[]).filter(a=>a.active),area=x?areas.find(a=>a.audit_area===x.audit_area):null;
  const taken=new Set((s?.populations||[]).filter(p=>p.status!=='Withdrawn'&&(!x||p.population_id!==x.population_id)).map(p=>p.audit_area));
  const choices=areas.filter(a=>!taken.has(a.audit_area)).map(a=>[a.audit_area,`${a.audit_area} · adjusted balance ${money(a.adjusted_net)}`]);
  if(!x&&!choices.length){notice(areas.length?'Every audit area with a balance already has a population. Withdraw one first to replace it.':'Confirm and map a trial balance first. A population is reconciled to an audit area of the trial balance.',true);return;}
  const docs=(ctx.data()?.documents||[]).filter(d=>d.project_id===file.project_id&&!d.archived_at&&!d.deleted_at).map(d=>[d.document_id,d.file_name]);
  const body=(x?`<input type="hidden" name="population_id" value="${esc(x.population_id)}"><input type="hidden" name="audit_area" value="${esc(x.audit_area)}"><p class="full"><b>${esc(x.pop_ref)}</b> · ${esc(x.audit_area)}${area?` · adjusted balance ${money(area.adjusted_net)}`:''}</p>`:select('audit_area','Audit area *',choices,choices[0]?.[0]||''))
   +field('title','What is the population? *',x?.title||'','text','required maxlength="200" placeholder="For example: Supplier ledger at year end"')
   +field('source_system','Source system *',x?.source_system||'','text','required maxlength="200" placeholder="Where the data came from"')
   +field('report_name','Report used *',x?.report_name||'','text','required maxlength="200"')
   +textArea('parameters','Parameters the report was run with *',x?.parameters||'',1000)
   +field('as_at','Balance date *',x?.as_at?String(x.as_at).slice(0,10):String(file.ends_on).slice(0,10),'date','required')
   +field('report_run_on','Date the report was run *',x?.report_run_on?String(x.report_run_on).slice(0,10):'','date','required')
   +field('row_count','Number of rows *',x?String(x.row_count):'','text','required inputmode="numeric"')
   +field('control_total','Control total (KES, positive) *',x?String(x.control_total):'','text','required inputmode="decimal"')
   +select('balance_nature','The control total is a *',BALANCE_NATURES,x?.balance_nature||(area?suggestNature(area.adjusted_net):'Credit'))
   +field('reconciling_amount','Reconciling items (KES, add or subtract)',x&&Number(x.reconciling_amount)?String(x.reconciling_amount):'','text','inputmode="decimal"')
   +textArea('reconciling_note','What are the reconciling items? (at least 20 characters when there are any)',x?.reconciling_note||'',1500,false)
   +textArea('ipe_check','How did you check that the report is complete and accurate? (at least 20 characters, needed to submit)',x?.ipe_check||'',2000,false)
   +(docs.length?select('evidence_document_id','Evidence file (the report or listing)',docs,x?.evidence_document_id||'','No linked file'):'')
   +'<p class="info full">Control total plus reconciling items must equal the adjusted trial balance for the area. A population that does not reconcile cannot be submitted.</p>';
  modal(x?'Edit '+x.pop_ref:'Record a population',form(body,'Save draft'),f=>{const o=collectPopulation(Object.fromEntries(f));return request({action:'audit_population_save',audit_file_id:file.audit_file_id,population_id:Object.fromEntries(f).population_id||undefined,...o});},()=>ctx.refresh(),{refreshWorkspace:false});
 }
 async function handle(b,file){
  const s=ctx.snapshot(),find=id=>(s?.populations||[]).find(x=>x.population_id===id);
  if(b.dataset.auditPopNew){popForm(file);return true;}
  if(b.dataset.auditPopEdit){const x=find(b.dataset.auditPopEdit);if(x)popForm(file,x);return true;}
  if(b.dataset.auditPopSubmit){const id=b.dataset.auditPopSubmit,x=find(id);modal('Submit '+(x?.pop_ref||'population'),`<p>Submitting locks the population for review by a Manager or Partner who did not prepare it. The server checks that it reconciles first.</p><button class="primary" id="auditPopSubmit">Submit for review</button>`);document.querySelector('#auditPopSubmit').onclick=async()=>{try{await request({action:'audit_population_submit',population_id:id});document.querySelector('#editor').close();await ctx.refresh();}catch(e){document.querySelector('#editorNotice').textContent=e.message;}};return true;}
  if(b.dataset.auditPopWithdraw){const id=b.dataset.auditPopWithdraw;modal('Withdraw population',form(textArea('reason','Why is it withdrawn? (at least 10 characters) *','',1000),'Withdraw population'),f=>request({action:'audit_population_withdraw',population_id:id,reason:f.get('reason')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.auditPopReview){const id=b.dataset.auditPopReview,x=find(id);modal('Review '+(x?.pop_ref||'population'),form(select('decision','Decision *',['Approve','Return'],'')+textArea('note','Review note (at least 10 characters) *','',1000),'Save review'),f=>request({action:'audit_population_review',population_id:id,decision:f.get('decision'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.auditPopReopen){const id=b.dataset.auditPopReopen,x=find(id);modal('Reopen '+(x?.pop_ref||'population'),form(`<p class="full">Reopening returns the population to its preparer so the reconciling items can be updated, for example after an audit adjustment moved the balance. It must be submitted and approved again.</p>`+textArea('reason','Why is it reopened? (at least 10 characters) *','',1000),'Reopen population'),f=>request({action:'audit_population_reopen',population_id:id,reason:f.get('reason')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.hasAttribute('data-audit-pop-policy')){
   const current=new Set(s?.population_policy?.areas||[]);
   const boxes=POPULATION_AREAS.map(a=>`<label class="check"><input type="checkbox" name="area" value="${esc(a)}" ${current.has(a)?'checked':''}> ${esc(a)}</label>`).join('');
   modal('Partner · areas that need a population',form(`<p class="full">Tick each audit area that must have an approved, reconciled population. This is a firm decision; nothing is required until you record it.</p>${boxes}`+textArea('note','Why (at least 10 characters) *','',1000),'Save firm policy'),f=>request({action:'audit_population_policy_save',areas:f.getAll('area'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});
   return true;
  }
  return false;
 }
 return {panel,handle};
}
