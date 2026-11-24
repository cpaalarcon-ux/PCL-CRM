// Compliance & Risk (build 2865). Anyone can raise a concern to the MLRO and is shown only its reference. The MLRO reads and decides restricted reports;
// every look at them is recorded by the database, and a refused attempt is recorded too. The annual compliance report is a dated obligation per firm.
// The server and the database enforce every rule again; this file only shows what they allow.
export function createComplianceUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate,button,area}=ctx,d=()=>ctx.data();
 const day=v=>String(v||'').slice(0,10);
 const long=v=>v?shortDate(v):'';
 const statusTone={Received:'warn','Under review':'warn','Reported to FRC':'good','Closed without report':'neutral',Note:'neutral'};
 const statusText=s=>s==='Reported to FRC'?'Reported to the Financial Reporting Centre':s;
 const badge=(s)=>`<span class="badge ${statusTone[s]||''}">${esc(statusText(s))}</span>`;
 const denied=r=>{modal('Restricted area',`<p class="info full">${esc(r.note)}</p>`);return true;};
 function annualTable(x,mlro){
  if(!x||!x.reports.length)return '<p class="muted">No annual compliance report is open yet. One is opened for each firm on 1 January, due on 31 January.</p>';
  return `<div class="scroll"><table><thead><tr><th>Firm</th><th>Covers</th><th>Due</th><th>With</th><th>State</th><th></th></tr></thead><tbody>${x.reports.map(r=>`<tr><td>${esc(r.firm_name)}</td><td>${esc(r.covers_year)}</td><td>${esc(long(r.due_on))}</td><td>${esc(r.assigned_name||'No MLRO appointed')}</td><td>${r.status==='Submitted'?`<span class="badge good">Submitted ${esc(long(r.submitted_on))}</span><small>${esc(r.receipt_reference||'')}</small>`:`<span class="badge ${r.overdue?'bad':'warn'}">${esc(r.status)}</span><small>${r.overdue?'Overdue by '+esc(Math.abs(r.days_left))+' day(s)':esc(r.days_left)+' day(s) left'}</small>`}</td><td>${mlro&&r.status!=='Submitted'?`${r.status==='Open'?button('annual-prepare','Mark prepared',r.annual_id)+' ':''}${button('annual-submit','Record submission',r.annual_id)}`:''}</td></tr>`).join('')}</tbody></table></div><p class="muted">${esc(x.rule)}</p>`;
 }
 async function open(){
  const menu=await request({action:'sar_menu'});
  const annual=await request({action:'sar_annual_read'}).catch(()=>null);
  const mlro=!!menu.mlro;
  modal('Compliance & Risk',`<h3>Raise a concern</h3><p class="info full">If you see something that looks unusual or suspicious, tell the MLRO. You will be given a reference. The MLRO decides what happens next, and you will not be told. Do not discuss it with the client or with colleagues.</p><div class="actions">${button('concern-new','Raise a concern to the MLRO')}</div>${mlro?`<h3>MLRO</h3><div class="actions"><button type="button" data-v3="aml-queue" data-id="">MLRO workspace</button>${button('sar-list','Restricted reports')}${button('sar-log','Who has looked at restricted reports')}</div>`:''}${annual?`<h3>Annual compliance report</h3>${annualTable(annual,mlro)}${mlro?`<div class="actions">${button('annual-add','Add a past year')}</div>`:''}`:''}`);
 }
 function concernNew(){
  const clients=(d().clients||[]).map(c=>[c.client_id,c.company_name]);
  modal('Raise a concern to the MLRO',form(`<p class="info full">Give facts: who, what, when, and why it seemed unusual. Do not tell the client or anyone else. You will be given a reference only.</p>${select('client_id','About which client (if any)',clients,'','Not about one client')}${area('summary','What did you see? *','',true)}`,'Send to the MLRO'),
   f=>request({action:'concern_raise',client_id:f.get('client_id')||undefined,summary:f.get('summary')}),
   r=>{modal('Passed to the MLRO',`<p class="info full">Your reference is <b>${esc(r.ref)}</b>.</p><p class="full">${esc(r.note)}</p>`);},{refreshWorkspace:false,successMessage:'Sent to the MLRO.'});
 }
 async function list(){
  const r=await request({action:'sar_list'});if(r.denied)return denied(r);
  modal('Restricted reports',`<p class="info full">Every time this list or a report is opened, the database records who looked and when.</p>${r.reports.length?`<div class="scroll"><table><thead><tr><th>Reference</th><th>Client</th><th>Raised</th><th>By</th><th>State</th><th></th></tr></thead><tbody>${r.reports.map(x=>`<tr><td>${esc(x.report_ref)}</td><td>${esc(x.company_name||'')}</td><td>${esc(long(x.raised_at))}</td><td>${esc(x.raised_by_name||'')}</td><td>${badge(x.status)}</td><td>${button('sar-read','Open',x.report_id)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No concern has been raised.</p>'}`);
  return true;
 }
 async function read(id){
  const r=await request({action:'sar_read',report_id:id});if(r.denied)return denied(r);
  const rep=r.report,ended=r.events.some(e=>['Reported to FRC','Closed without report'].includes(e.event_type));
  modal('Restricted report · '+rep.report_ref,`<p><b>${esc(rep.company_name||'No client named')}</b> · raised ${esc(long(rep.raised_at))} by ${esc(rep.raised_by_name||'')}</p><p class="full" style="white-space:pre-wrap">${esc(rep.summary)}</p><h4>History</h4><ul>${r.events.map(e=>`<li>${badge(e.event_type)} ${esc(long(e.at))} · ${esc(e.actor_name||'')}${e.note?'<br>'+esc(e.note):''}${e.frc_reference?`<br>FRC reference ${esc(e.frc_reference)}, reported ${esc(long(e.reported_on))}`:''}</li>`).join('')}</ul>${ended?'<p class="info full">This report is concluded and is not changed.</p>':form(`${select('event_type','What happened? *',[['Under review','I am reviewing it'],['Note','Add a note'],['Reported to FRC','Reported to the Financial Reporting Centre'],['Closed without report','Closed without a report']],'','Choose…')}${area('note','Note (needed for a note, and to close without a report)')}${field('frc_reference','Reference from the Financial Reporting Centre (when reported)','','text','maxlength="100"')}${field('reported_on','Date reported (when reported)','','date',`max="${new Date(Date.now()+3*3600000).toISOString().slice(0,10)}"`)}`,'Record')}`,
   f=>request({action:'sar_event',report_id:id,event_type:f.get('event_type'),note:f.get('note')||undefined,frc_reference:f.get('frc_reference')||undefined,reported_on:f.get('reported_on')||undefined}),
   async r2=>{if(r2.denied)denied(r2);else await read(id);},{refreshWorkspace:false,successMessage:'Recorded.'});
  return true;
 }
 async function log(){
  const r=await request({action:'sar_log'});if(r.denied)return denied(r);
  modal('Who has looked at restricted reports',`<p class="info full">Newest first. This list is itself recorded when opened.</p><div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Report</th></tr></thead><tbody>${r.log.map(x=>`<tr><td>${esc(String(x.at).slice(0,16).replace('T',' '))}</td><td>${esc(x.actor_name||'')}</td><td>${esc(x.action)}${x.detail?' · '+esc(x.detail):''}</td><td>${esc(x.report_ref||'')}</td></tr>`).join('')}</tbody></table></div>`);
  return true;
 }
 function annualPrepare(id){
  modal('Mark the annual report prepared',form(`${area('note','Note (optional)')}`,'Mark prepared'),f=>request({action:'sar_annual_move',annual_id:id,status:'Prepared',note:f.get('note')||undefined}),()=>open(),{refreshWorkspace:false,successMessage:'Marked prepared.'});
 }
 function annualSubmit(id){
  modal('Record the submission',form(`<p class="info full">Record it once it has been submitted. This does not file anything. A submitted report is not changed.</p>${field('submitted_on','Date submitted *','','date',`required max="${new Date(Date.now()+3*3600000).toISOString().slice(0,10)}"`)}${field('receipt_reference','Reference the regulator gave * ','','text','required minlength="3" maxlength="100"')}${area('note','Note (optional)')}`,'Record submission'),f=>request({action:'sar_annual_move',annual_id:id,status:'Submitted',submitted_on:f.get('submitted_on'),receipt_reference:f.get('receipt_reference'),note:f.get('note')||undefined}),()=>open(),{refreshWorkspace:false,successMessage:'Submission recorded.'});
 }
 function annualAdd(){
  const firms=(d().firms||[]).map(f=>[f.firm_id,f.legal_name||f.firm_code]),y=new Date().getFullYear()-1;
  modal('Add a past annual report',form(`<p class="info full">Use this for a year that ended before the automatic record began, for example a report that fell due earlier.</p>${select('firm_id','Firm *',firms,'','Choose…')}${field('covers_year','Year it covers *',String(y),'number',`required min="2000" max="${y}"`)}`,'Add'),f=>request({action:'sar_annual_add',firm_id:f.get('firm_id'),covers_year:Number(f.get('covers_year'))}),()=>open(),{refreshWorkspace:false,successMessage:'Added.'});
 }
 async function handle(action,id){
  if(action==='compliance-open'){await open();return true;}
  if(action==='concern-new'){concernNew();return true;}
  if(action==='sar-list')return await list();
  if(action==='sar-read')return await read(id);
  if(action==='sar-log')return await log();
  if(action==='annual-prepare'){annualPrepare(id);return true;}
  if(action==='annual-submit'){annualSubmit(id);return true;}
  if(action==='annual-add'){annualAdd();return true;}
  return false;
 }
 // The client file's AML scope tab: what POCAMLA asks of this client and of each service set up for it. A summary; the MLRO decides.
 async function paintScope(host,cid){
  host.innerHTML='<p class="muted">Loading…</p>';
  try{
   const r=await request({action:'aml_scope_read',client_id:cid});
   const p=r.profile;
   const stage=p?`${esc(p.stage)}${p.decision?' · '+esc(p.decision):''}${p.risk_rating?' · risk '+esc(p.risk_rating):''}${p.next_review?' · review by '+esc(long(p.next_review)):''}${p.edd_required?' · enhanced due diligence needed':''}`:'No AML profile started';
   host.innerHTML=`<p class="info">${esc(r.note)}</p><p><b>Profile:</b> ${stage} <button type="button" data-v3="aml" data-id="${esc(cid)}">Open the AML profile</button></p><p><b>MLRO for this client:</b> ${(r.mlros||[]).length?r.mlros.map(esc).join(', '):'<span class="muted">None named. Any MLRO or Partner can decide.</span>'}</p><p><b>Engagement gate:</b> ${r.gate_enforced?'On: work needs an approved AML profile where the MLRO has asked for one.':'Off: a Partner switches it on after recording approval of the MLRO lists.'}</p><h3>Services set up for this client (the ones on projects you can open)</h3>${r.services.length?`<div class="scroll"><table><thead><tr><th>Service</th><th>MLRO rule</th><th>What it means here</th></tr></thead><tbody>${r.services.map(s=>`<tr><td>${esc(s.service_name)}</td><td>${esc(s.applicability||'Not decided')}</td><td>${esc(s.line)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No service has been set up for this client yet.</p>'}${r.flags.length?`<h3>Raised for the MLRO</h3><ul>${r.flags.map(f=>`<li>${esc(f.service_name)} · raised ${esc(long(f.raised_at))} by ${esc(f.raised_by_name||'')} · ${f.answered?'answered by the MLRO decision':'waiting for the MLRO'}</li>`).join('')}</ul>`:''}`;
  }catch(e){host.innerHTML=`<p class="info">${esc(e.message||'The AML scope could not be loaded.')}</p>`;}
 }
 return {handle,paintScope,open};
}
