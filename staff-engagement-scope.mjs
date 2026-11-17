// Engagement scope (build 2864). The engagement date (when we were appointed, which may be backdated to the signed letter) is kept apart from the scope start (the first
// period we are engaged to work on). Work before the scope start is blocked unless a Partner approves a scope override for that period, with a reason.
// Opening balances and prior-year trial balances are reference data and are never blocked. Every step is authorised again on the server.
export function createScopeUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx,d=()=>ctx.data();
 const day=v=>String(v||'').slice(0,10);
 const tone={Requested:'warn',Approved:'good',Rejected:'bad'};
 const badge=s=>`<span class="badge ${tone[s]||''}">${esc(s)}</span>`;
 const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
 const long=v=>v?shortDate(v):'';
 const headline=s=>s?`Engagement scope: from ${long(s.scope_start_date)}${s.scope_end_date?' to '+long(s.scope_end_date):''}. Appointed on ${long(s.engagement_date)}.`:'Engagement scope not recorded. Work is not limited by date until a Manager or Partner records it.';
 function view(x){
  const firmName=new Map(x.firms.map(f=>[f.firm_id,f.legal_name]));
  const live=x.firms.map(f=>{const s=x.live.find(l=>l.firm_id===f.firm_id);return `<li><b>${esc(f.legal_name)}</b>: ${esc(headline(s))}${s&&s.note?`<small>${esc(s.note)}</small>`:''}${s?`<small>Recorded by ${esc(s.recorded_by_name||'a colleague')} on ${esc(long(s.recorded_at))}</small>`:''}</li>`;}).join('');
  const notes=x.notes.map(n=>`<p class="notice" data-pre-engagement>${esc(n.note)}</p>`).join('');
  const open=x.overrides.filter(o=>o.status==='Requested');
  const ovRows=x.overrides.length?`<div class="scroll"><table><thead><tr><th>Period</th><th>Why</th><th>State</th><th></th></tr></thead><tbody>${x.overrides.map(o=>`<tr><td>${esc(long(o.from_date))} to ${esc(long(o.to_date))}<small>${esc(firmName.get(o.firm_id)||'')}</small></td><td>${esc(o.reason)}<small>Asked by ${esc(o.requested_by_name||'a colleague')} on ${esc(long(o.requested_at))}</small></td><td>${badge(o.status)}${o.decided_by_name?`<small>${esc(o.decided_by_name)} on ${esc(long(o.decided_at))}${o.sole_partner_approval?' as the firm’s only Partner (also the requester)':''}${o.decision_note?': '+esc(o.decision_note):''}</small>`:''}</td><td>${o.status==='Requested'&&x.can_decide?`<button type="button" data-scope="decide" data-id="${esc(o.override_id)}" data-client="${esc(x.client.client_id)}" data-decision="Approve">Approve</button> <button type="button" data-scope="decide" data-id="${esc(o.override_id)}" data-client="${esc(x.client.client_id)}" data-decision="Reject">Reject</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No scope overrides have been asked for.</p>';
  const hist=x.scopes.filter(s=>s.ended_at).length?`<details><summary>Earlier scopes (${x.scopes.filter(s=>s.ended_at).length})</summary><ul>${x.scopes.filter(s=>s.ended_at).map(s=>`<li>${esc(firmName.get(s.firm_id)||'')}: from ${esc(long(s.scope_start_date))}${s.scope_end_date?' to '+esc(long(s.scope_end_date)):''}, appointed ${esc(long(s.engagement_date))}. Ended ${esc(long(s.ended_at))}: ${esc(s.ended_reason)}</li>`).join('')}</ul></details>`:'';
  const replacing=x.live.length>0;
   const rec=x.can_record?`<details${replacing?'':' open'}><summary>${replacing?'Replace the engagement scope':'Record the engagement scope'}</summary>${form((x.firms.length>1?select('firm_id','Handling firm *',x.firms.map(f=>[f.firm_id,f.legal_name]),'','Choose the firm…'):`<input type="hidden" name="firm_id" value="${esc(x.firms[0]?.firm_id||'')}">`)+field('engagement_date','Engagement date * (the letter date; it may be in the past)',x.live[0]?day(x.live[0].engagement_date):'','date',`required max="${today()}"`)+field('scope_start_date','Scope starts * (the earliest period we are engaged to work on)',x.live[0]?day(x.live[0].scope_start_date):'','date','required')+field('scope_end_date','Scope ends (optional)',x.live[0]?.scope_end_date?day(x.live[0].scope_end_date):'','date')+select('letter_document_id','Signed engagement letter',x.letters.map(l=>[l.document_id,l.file_name]),'','No letter linked')+`<label class="full">Note<textarea name="note" maxlength="500" placeholder="For example, engaged to file the outstanding 2024 and 2025 returns"></textarea></label>`+(replacing?`<label class="full">Why replace it? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>`:'')+`<p class="info full">The scope start usually equals the engagement date. A scope that starts earlier, to allow late filings, or a replacement of a recorded scope, is a Partner’s decision.</p>`,'Save scope')}</details>`:'';
  modal('Engagement scope · '+x.client.company_name,`<p class="info full">${esc(x.note)}</p><ul>${live}</ul>${notes}${rec}<h4>Scope overrides${open.length?` (${open.length} waiting)`:''}</h4>${ovRows}${hist}`,
   f=>request({action:'client_scope_record',client_id:x.client.client_id,firm_id:f.get('firm_id'),engagement_date:f.get('engagement_date'),scope_start_date:f.get('scope_start_date'),scope_end_date:f.get('scope_end_date')||undefined,letter_document_id:f.get('letter_document_id')||undefined,note:f.get('note')||undefined,reason:f.get('reason')||undefined}),
   ()=>open(x.client.client_id),{refreshWorkspace:false,successMessage:'Engagement scope recorded.'});
 }
 async function open(cid){view(await request({action:'client_scope_read',client_id:cid}));}
 // Asking for a period outside the scope. The reason is mandatory and goes to a Partner; nothing is allowed until it is approved.
 function requestOverride(ds){
  modal('Request a scope override',form(`<p class="info full">${esc(ds.reason||'This period is before our engagement scope.')} The work cannot go ahead until a Partner approves it.</p><p class="full"><b>Period:</b> ${esc(long(ds.from))} to ${esc(long(ds.to))}</p><label class="full">Reason for doing this work *<textarea name="reason" required minlength="5" maxlength="500" placeholder="For example, the client engaged us to file outstanding 2024 returns"></textarea></label>`,'Send to a Partner'),
   f=>request({action:'client_scope_override_request',client_id:ds.client,firm_id:ds.firm,from_date:ds.from,to_date:ds.to,reason:f.get('reason')}),
   null,{refreshWorkspace:false,successMessage:'Sent to a Partner. Nothing is allowed until it is approved.'});
 }
 async function handle(a,id,ds={}){
  if(a==='open')return open(id);
  if(a==='override-request')return requestOverride(ds);
  if(a==='decide'){
   const approve=ds.decision==='Approve';
   return modal(approve?'Approve this scope override':'Reject this scope override',form(`<label class="full">${approve?'Note (optional)':'Why is it rejected? *'}<textarea name="note" ${approve?'':'required minlength="3"'} maxlength="500"></textarea></label><p class="info full">${approve?'Approving allows work in that period for this client. It is recorded under your name.':'The work in that period stays blocked.'}</p>`,approve?'Approve override':'Reject override'),
    f=>request({action:'client_scope_override_decide',client_id:ds.client,override_id:id,decision:ds.decision,note:f.get('note')||undefined}),()=>open(ds.client),{refreshWorkspace:false,successMessage:approve?'Override approved.':'Override rejected.'});
  }
 }
 if(typeof document!=='undefined')document.addEventListener('click',async e=>{const b=e.target.closest?.('[data-scope]');if(!b)return;e.preventDefault();b.disabled=true;try{await handle(b.dataset.scope,b.dataset.id,{client:b.dataset.client,firm:b.dataset.firm,from:b.dataset.from,to:b.dataset.to,reason:b.dataset.reason,decision:b.dataset.decision});}catch(err){ctx.notice(err.message,true);}finally{b.disabled=false;}});
 return {open,handle,headline,button:cid=>`<button type="button" data-scope="open" data-id="${esc(cid)}">Engagement scope</button>`,overrideButton:s=>s&&s.needs_override?`<button type="button" data-scope="override-request" data-client="${esc(s.client_id)}" data-firm="${esc(s.firm_id)}" data-from="${esc(day(s.from_date))}" data-to="${esc(day(s.to_date))}" data-reason="${esc(s.reason)}">Request scope override</button>`:''};
}
