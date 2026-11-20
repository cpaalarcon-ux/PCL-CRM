// Audit build C: lead schedules built from the mapped trial balance, with a tie-out to the adjusted balance.
export function parseBalance(v){
 const raw=String(v??'').trim().replace(/,/g,'');if(!raw)return null;
 const neg=/^\(.*\)$/.test(raw),n=Number(neg?'-'+raw.slice(1,-1):raw);return Number.isFinite(n)?n:null;
}
export function tieTone(tie){return tie==='Ties'?'ok':tie==='Reconciled with note'?'':'warn';}
export function createLeadsUI(ctx){
 const {esc,field,form,modal,request,notice}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const money=v=>{const n=Number(v);if(!Number.isFinite(n))return esc(v??'');const t=Math.abs(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`(${t})`:t;};
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 function panel(file,s){
  const role=staff().category_code,me=staff().staff_id,canMake=role!=='INTERN'&&open(file),areas=s?.lead_schedule||[];
  const wps=s?.workpapers||[];
  const card=a=>{
   const lead=a.lead,w=lead?wps.find(x=>x.audit_workpaper_id===lead.audit_workpaper_id):null,editable=lead&&['Draft','Returned'].includes(lead.status)&&canMake&&((w&&w.prepared_by===me)||['SUPERVISOR','MANAGER','PARTNER'].includes(role));
   return `<article class="card section-space"><div class="section-head"><div><h4>${esc(a.audit_area)}</h4><small>${a.accounts} account${a.accounts===1?'':'s'}${a.active?'':' · no balance'}</small></div><div>${lead?badge(lead.workpaper_ref)+' '+badge(lead.status,lead.status==='Approved'?'ok':'')+' '+badge(lead.tie==='Not stated'?'Tie-out not stated':lead.tie,tieTone(lead.tie)):a.active?badge('No lead schedule','warn'):''}</div></div>
   <div class="scroll"><table><thead><tr><th>Account</th><th>Trial balance</th><th>Adjustments</th><th>Adjusted</th></tr></thead><tbody>${a.detail.map(d=>`<tr><td>${esc(d.account_code)} · ${esc(d.account_name)}</td><td>${money(d.tb_net)}</td><td>${money(d.adjustment_net)}</td><td>${money(d.adjusted_net)}</td></tr>`).join('')}<tr><td><b>Total</b></td><td><b>${money(a.tb_net)}</b></td><td><b>${money(a.adjustment_net)}</b></td><td><b>${money(a.adjusted_net)}</b></td></tr></tbody></table></div>
   ${lead?`<p class="muted">Balance supported by evidence: <b>${lead.supported_balance==null?'not stated yet':money(lead.supported_balance)}</b>${lead.difference!=null&&Number(lead.difference)!==0?` · difference ${money(lead.difference)}`:''}${lead.reconciling_note?`<br>Reconciling note: ${esc(lead.reconciling_note)}`:''}</p>`:''}
   <div class="actions">${!lead&&canMake&&a.active?`<button class="primary" data-audit-lead-create="${esc(a.audit_area)}">Create lead schedule</button>`:''}${editable?`<button data-audit-lead-tie="${esc(lead.audit_workpaper_id)}">Record tie-out</button>`:''}${lead?'<small>Submit and review it in Working papers.</small>':''}</div></article>`;};
  return `<section class="card"><div class="section-head"><div><h3>Lead schedules</h3><p class="muted">Built from the mapped trial balance with approved adjusting entries applied (debits positive, credits in brackets). Each active area needs a lead schedule. The preparer states the balance the evidence supports. It cannot be approved while that differs from the adjusted balance, unless a reconciling note explains why.</p></div></div>
   ${areas.length?'':'<p class="missing">Confirm a mapped trial balance first. Lead schedules appear here by audit area.</p>'}</section>${areas.map(card).join('')}`;
 }
 function tieForm(a){
  const lead=a.lead,body=`<input type="hidden" name="audit_workpaper_id" value="${esc(lead.audit_workpaper_id)}"><p class="full"><b>${esc(a.audit_area)}</b> · adjusted trial balance <b>${money(a.adjusted_net)}</b></p>`
   +field('supported_balance','Balance supported by your evidence (credits as minus or in brackets) *',lead.supported_balance==null?'':String(lead.supported_balance),'text','required inputmode="decimal"')
   +`<label class="full">Reconciling note (needed if it does not equal the adjusted balance; at least 20 characters)<textarea name="reconciling_note" maxlength="1500">${esc(lead.reconciling_note||'')}</textarea></label>`;
  modal('Tie-out · '+a.audit_area,form(body,'Save tie-out'),f=>request({action:'audit_lead_tieout_save',...Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});
 }
 async function handle(b,file){
  const s=ctx.snapshot();
  if(b.dataset.auditLeadCreate){try{await request({action:'audit_lead_create',audit_file_id:file.audit_file_id,audit_area:b.dataset.auditLeadCreate});await ctx.refresh();}catch(e){notice(e.message||'Could not create the lead schedule.',true);}return true;}
  if(b.dataset.auditLeadTie){const a=(s?.lead_schedule||[]).find(x=>x.lead&&x.lead.audit_workpaper_id===b.dataset.auditLeadTie);if(a)tieForm(a);return true;}
  return false;
 }
 return {panel,handle};
}
