// Audit build B: audit adjusting entries, the schedule of unadjusted misstatements and the adjusted trial balance.
// These entries belong to the audit file only. They never post to the client's bookkeeping ledger.
export const ENTRY_KINDS=['Adjusting','Unadjusted'];
export const MISSTATEMENT_TYPES=['Factual','Judgmental','Projected'];
const MAKERS=['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'];
const ROWS=6;
// Build the lines array from the numbered form fields. Rows with nothing in them are skipped.
export function collectLines(entries){
 const get=k=>String(entries[k]??'').trim(),lines=[];
 for(let i=1;i<=24;i++){
  const account=get('acct_'+i),debit=get('debit_'+i),credit=get('credit_'+i),memo=get('memo_'+i);
  if(!account&&!debit&&!credit&&!memo)continue;
  lines.push({audit_account_id:account,debit,credit,memo});
 }
 return lines;
}
export function entryBalance(lines){
 const n=v=>{const x=Number(String(v||'0').replace(/,/g,''));return Number.isFinite(x)?x:NaN;};
 const dr=Math.round(lines.reduce((s,l)=>s+(n(l.debit)||0),0)*100)/100,cr=Math.round(lines.reduce((s,l)=>s+(n(l.credit)||0),0)*100)/100;
 return {debit:dr,credit:cr,balanced:dr>0&&dr===cr};
}
export function createAdjustmentsUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const money=v=>{const n=Number(v);if(!Number.isFinite(n))return esc(v??'');const t=Math.abs(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`(${t})`:t;};
 const textArea=(name,label,value='',max=1500,req=true)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${req?'required':''}>${esc(value||'')}</textarea></label>`;
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 function panel(file,s){
  const role=staff().category_code,me=staff().staff_id,canMake=MAKERS.includes(role)&&open(file),canReview=['MANAGER','PARTNER'].includes(role);
  const entries=s?.adjustments||[],lines=s?.adjustment_lines||[],tb=s?.adjusted_tb||[],ms=s?.misstatements||null;
  const linesFor=id=>lines.filter(l=>l.adjustment_id===id);
  const row=e=>{
   const mine=e.prepared_by===me,canEdit=['Draft','Returned'].includes(e.status)&&(mine||canReview)&&open(file);
   const detail=linesFor(e.adjustment_id).map(l=>`<small>${esc(l.account_code)} ${esc(l.account_name)}: ${Number(l.debit)>0?'Dr '+money(l.debit):'Cr '+money(l.credit)}${l.memo?' · '+esc(l.memo):''}</small>`).join('');
   const tone=e.status==='Approved'?'ok':e.status==='Returned'?'warn':'';
   return `<tr><td><b>${esc(e.adj_ref)}</b><small>${esc(e.kind)}${e.misstatement_type?' · '+esc(e.misstatement_type):''}</small></td><td>${esc(e.description)}<small>Basis: ${esc(e.basis)}</small>${e.management_response?`<small>Management: ${esc(e.management_response)}</small>`:''}${detail}${e.review_note?`<small>Review: ${esc(e.review_note)}</small>`:''}</td><td>Profit ${money(e.profit_effect)}<small>Net assets ${money(e.net_assets_effect)}</small></td><td>${badge(e.status,tone)}<small>${esc(e.prepared_by_name||'')}${e.reviewer_name?' · reviewed by '+esc(e.reviewer_name):''}</small></td><td class="actions">${canEdit?`<button data-audit-adj-edit="${esc(e.adjustment_id)}">Edit</button><button class="primary" data-audit-adj-submit="${esc(e.adjustment_id)}">Submit</button><button data-audit-adj-withdraw="${esc(e.adjustment_id)}">Withdraw</button>`:''}${e.status==='Submitted'&&canReview&&!mine&&open(file)?`<button class="primary" data-audit-adj-review="${esc(e.adjustment_id)}">Review</button>`:''}${e.status==='Submitted'&&mine?'<small>Waiting for a different reviewer.</small>':''}</td></tr>`;};
  const schedule=ms?`<section class="card section-space"><div class="section-head"><div><h3>Unadjusted misstatements</h3><p class="muted">Approved misstatements that management has not corrected. Items at or below clearly trivial are listed but not accumulated.</p></div>${role==='PARTNER'&&open(file)&&s?.planning_gate?.materiality_approved?'<button data-audit-ms-conclude>Record Partner conclusion</button>':''}</div>
   ${ms.overall_materiality==null?'<p class="missing">Materiality has not been approved, so nothing can be compared yet.</p>':`<dl class="audit-facts"><div><dt>Accumulated (gross, before tax)</dt><dd>KES ${money(ms.gross_profit_effect)}</dd></div><div><dt>Accumulated (net)</dt><dd>KES ${money(ms.net_profit_effect)}</dd></div><div><dt>Overall materiality</dt><dd>KES ${money(ms.overall_materiality)} ${ms.exceeds_overall?badge('Exceeded','warn'):badge('Within','ok')}</dd></div><div><dt>Performance materiality</dt><dd>KES ${money(ms.performance_materiality)} ${ms.exceeds_performance?badge('Exceeded','warn'):badge('Within','ok')}</dd></div><div><dt>Clearly trivial</dt><dd>KES ${money(ms.clearly_trivial)}</dd></div></dl>`}
   ${ms.exceeds_overall?`<p class="${ms.conclusion?.current?'info':'missing'}">${ms.conclusion?.current?'Partner conclusion recorded: '+esc(ms.conclusion.note):'Unadjusted misstatements exceed overall materiality. A Partner must record a current conclusion before the file can be approved.'}</p>`:ms.conclusion?`<p class="muted">Partner conclusion: ${esc(ms.conclusion.note)}</p>`:''}
   ${(ms.items||[]).length?`<div class="scroll"><table><thead><tr><th>Ref</th><th>Item</th><th>Profit</th><th>Net assets</th><th>Status</th></tr></thead><tbody>${ms.items.map(i=>`<tr><td>${esc(i.adj_ref)}</td><td>${esc(i.description)}<small>${esc(i.misstatement_type||'')}</small></td><td>${money(i.profit_effect)}</td><td>${money(i.net_assets_effect)}</td><td>${badge(i.status,i.status==='Approved'?'ok':'')}${i.trivial?badge('Clearly trivial'):''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No unadjusted misstatements recorded.</p>'}</section>`:'';
  const tbTotal=tb.reduce((a,r)=>a+Number(r.adjusted_net||0),0);
  const adjTb=tb.length?`<section class="card section-space"><div class="section-head"><div><h3>Adjusted trial balance</h3><p class="muted">Confirmed current-year trial balance with approved adjusting entries applied. Debits positive, credits in brackets.</p></div>${badge(Math.abs(tbTotal)<0.005?'Balances':'Does not balance',Math.abs(tbTotal)<0.005?'ok':'warn')}</div><div class="scroll"><table><thead><tr><th>Account</th><th>Audit area</th><th>Trial balance</th><th>Adjustments</th><th>Adjusted</th></tr></thead><tbody>${tb.slice(0,400).map(r=>`<tr><td>${esc(r.account_code)} · ${esc(r.account_name)}<small>${esc(r.financial_statement_line)}</small></td><td>${esc(r.audit_area)}</td><td>${money(r.tb_net)}</td><td>${money(r.adjustment_net)}</td><td><b>${money(r.adjusted_net)}</b></td></tr>`).join('')}</tbody></table></div>${tb.length>400?`<p class="muted">Showing the first 400 of ${tb.length} accounts.</p>`:''}</section>`:'';
  return `<section class="card"><div class="section-head"><div><h3>Audit adjusting entries</h3><p class="muted">Proposed corrections found during the audit. A different Manager or Partner reviews each entry. Approved adjusting entries change the adjusted trial balance; they never post to the client's books.</p></div>${canMake?'<button class="primary" data-audit-adj-new>New entry</button>':''}</div>
   ${entries.length?`<div class="scroll"><table><thead><tr><th>Ref</th><th>Entry</th><th>Effect</th><th>Status</th><th>Action</th></tr></thead><tbody>${entries.map(row).join('')}</tbody></table></div>`:'<p class="missing">No audit entries yet.</p>'}</section>${schedule}${adjTb}`;
 }
 function entryForm(file,e=null){
  const s=ctx.snapshot(),accounts=(s?.tb_accounts||[]).map(a=>[a.audit_account_id,`${a.account_code} · ${a.account_name}`]);
  if(!accounts.length){notice('Confirm a mapped trial balance first. Entries are posted to mapped accounts.',true);return;}
  const have=e?(s?.adjustment_lines||[]).filter(l=>l.adjustment_id===e.adjustment_id):[],count=Math.min(24,Math.max(ROWS,have.length+2));
  const wps=(s?.workpapers||[]).map(w=>[w.audit_workpaper_id,`${w.workpaper_ref} · ${w.audit_area}`]);
  let rows='';
  for(let i=1;i<=count;i++){const l=have[i-1]||{};rows+=`<div class="line-row full">${select('acct_'+i,'Account '+i,accounts,l.audit_account_id||'')}${field('debit_'+i,'Debit',Number(l.debit)>0?String(l.debit):'','text','inputmode="decimal"')}${field('credit_'+i,'Credit',Number(l.credit)>0?String(l.credit):'','text','inputmode="decimal"')}${field('memo_'+i,'Note',l.memo||'','text','maxlength="300"')}</div>`;}
  const body=(e?`<input type="hidden" name="adjustment_id" value="${esc(e.adjustment_id)}"><input type="hidden" name="kind" value="${esc(e.kind)}"><p class="full"><b>${esc(e.adj_ref)}</b> · ${esc(e.kind)}</p>`:select('kind','Type *',ENTRY_KINDS,'Adjusting')+'<p class="info full">Adjusting: management agrees to correct it. Unadjusted: a misstatement found but not corrected.</p>')
   +textArea('description','What is the entry? *',e?.description||'',1000)+textArea('basis','Basis and evidence reference *',e?.basis||'',1500)
   +select('misstatement_type','Misstatement type (unadjusted only)',MISSTATEMENT_TYPES,e?.misstatement_type||'Factual')+textArea('management_response','Management response (needed for unadjusted)',e?.management_response||'',1500,false)
   +(wps.length?select('audit_workpaper_id','Related working paper',wps,e?.audit_workpaper_id||''):'')+rows+'<p class="info full">Debits must equal credits before you submit. Amounts are in KES.</p>';
  modal(e?'Edit '+e.adj_ref:'New audit entry',form(body,'Save draft'),f=>{const o=Object.fromEntries(f);return request({action:'audit_adjustment_save',audit_file_id:file.audit_file_id,adjustment_id:o.adjustment_id||undefined,kind:o.kind,description:o.description,basis:o.basis,misstatement_type:o.misstatement_type,management_response:o.management_response,audit_workpaper_id:o.audit_workpaper_id||undefined,lines:collectLines(o)});},()=>ctx.refresh(),{refreshWorkspace:false});
 }
 async function handle(b,file){
  const s=ctx.snapshot(),find=id=>(s?.adjustments||[]).find(x=>x.adjustment_id===id);
  if(b.hasAttribute('data-audit-adj-new')){entryForm(file);return true;}
  if(b.dataset.auditAdjEdit){const e=find(b.dataset.auditAdjEdit);if(e)entryForm(file,e);return true;}
  if(b.dataset.auditAdjSubmit){const id=b.dataset.auditAdjSubmit,e=find(id);modal('Submit '+(e?.adj_ref||'entry'),`<p>Submitting locks the entry for review by a Manager or Partner who did not prepare it.</p><button class="primary" id="auditAdjSubmit">Submit for review</button>`);document.querySelector('#auditAdjSubmit').onclick=async()=>{try{await request({action:'audit_adjustment_submit',adjustment_id:id});document.querySelector('dialog[open]')?.close();await ctx.refresh();}catch(err){notice(err.message||'Could not submit.',true);}};return true;}
  if(b.dataset.auditAdjWithdraw){const id=b.dataset.auditAdjWithdraw;modal('Withdraw entry',form(textArea('reason','Why is it withdrawn? (at least 10 characters) *','',1000),'Withdraw entry'),f=>request({action:'audit_adjustment_withdraw',adjustment_id:id,reason:f.get('reason')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.auditAdjReview){const id=b.dataset.auditAdjReview,e=find(id);modal('Review '+(e?.adj_ref||'entry'),form(select('decision','Decision *',['Approve','Return'],'')+textArea('note','Review note (at least 10 characters) *','',1000),'Save review'),f=>request({action:'audit_adjustment_review',adjustment_id:id,decision:f.get('decision'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.hasAttribute('data-audit-ms-conclude')){modal('Partner conclusion · unadjusted misstatements',form(textArea('note','Your conclusion on the accumulated unadjusted misstatements (at least 30 characters) *','',2000),'Record conclusion'),f=>request({action:'audit_misstatement_conclude',audit_file_id:file.audit_file_id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  return false;
 }
 return {panel,handle};
}
