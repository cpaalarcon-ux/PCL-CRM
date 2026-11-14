// Amend a confirmed sales summary: request, approval, reversal, then a corrected summary or a withdrawal. Every step shows who must do it.
export function createSalesAmendUI(ctx,{show,button}){
 const {esc,select,form,request,notice,shortDate}=ctx;
 const LIVE=['Requested','Approved','Reversing','Ready','Replacement saved'];
 const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const badge=s=>`<span class="badge ${['Complete','Ready'].includes(s)?'good':LIVE.includes(s)?'warn':''}">${esc(s)}</span>`;
 let last=null;
 const live=()=>(last?.amendments||[]).find(x=>LIVE.includes(x.amendment.status))||null;
 function panel(am){
  last=am;if(!am)return '';
  const v=live(),history=(am.amendments||[]).filter(x=>x!==v);
  const past=history.length?`<details><summary>Earlier amendments (${history.length})</summary><ul>${history.map(x=>`<li>${badge(x.amendment.status)} ${esc(x.amendment.reason_type)} · ${esc(x.amendment.outcome)} · requested ${esc(shortDate(x.amendment.requested_at))} by ${esc(x.amendment.requested_by_name||'')}</li>`).join('')}</ul></details>`:'';
  if(!v)return `<section class="info full"><h3>Entered incorrectly?</h3><p>A confirmed summary cannot be edited. Ask to amend it: a different Manager or Partner approves, the posted entries are reversed and reviewed, and then a corrected summary replaces it or the old one is withdrawn.</p>${am.can_request?`<div class="actions">${button('amend-request','Amend this period')}</div>`:'<p class="muted">An amendment can only be requested for a confirmed sales summary.</p>'}${past}</section>`;
  const a=v.amendment,t=a.original_totals||{},c=v.can,j=v.journals||[];
  return `<section class="info full" aria-live="polite"><h3>Amendment ${badge(a.status)}</h3><p><b>${esc(a.outcome==='Replace'?'Replace with a corrected summary':'Withdraw this summary')}</b> · ${esc(a.reason_type)}</p><p>${esc(a.reason)}</p><p class="muted">Requested by ${esc(a.requested_by_name||'')} on ${esc(shortDate(a.requested_at))}${a.decided_by_name?` · ${esc(a.status==='Rejected'?'Rejected':'Approved')} by ${esc(a.decided_by_name)}: ${esc(a.decision_note||'')}`:''}</p><p>Original: net ${money(t.net)} · VAT ${money(t.vat)} · gross ${money(t.gross)}</p>${j.length?`<p><b>Entries built from it</b></p><ul>${j.map(x=>`<li>${esc(x.reference)} · ${esc(x.status)}${x.reversal_id?` · reversal ${esc(x.reversal_status)}`:''}</li>`).join('')}</ul>`:''}<p><b>Next:</b> ${esc(v.next)}</p><div class="actions">${c.decide?button('amend-decide','Approve or reject'):''}${c.prepare?button('amend-prepare','Prepare reversals'):''}${c.complete?button('amend-complete','Withdraw the old summary'):''}${c.cancel?button('amend-cancel','Cancel the request'):''}</div></section>`;
 }
 const done=(r,reload)=>async()=>{await reload(r.import_id);};
 async function handle(action,r,pid,reload){
  const v=live(),a=v?.amendment,base=()=>({project_id:pid,amendment_id:a.amendment_id,revision:a.revision});
  if(action==='amend-request'){
   show('Amend this sales period',form(`<p class="info full">The summary stays as it is until the amendment is approved and the entries are reversed. Nothing is deleted.</p>`+select('outcome','What should happen?',[['Replace','Replace it with a corrected summary (same dates)'],['Withdraw','Withdraw it (wrong month, wrong client or wrong file)']],'Replace')+select('reason_type','What went wrong?',['Wrong amounts','Wrong month','Wrong file','Wrong client','Other'],'Wrong amounts')+'<label class="full">Explain what is wrong *<textarea name="reason" required minlength="10" maxlength="2000" placeholder="For example, the September file was uploaded as August"></textarea></label>','Send for approval'),
    f=>request({action:'sales_amend_request',project_id:pid,import_id:r.import_id,outcome:f.get('outcome'),reason_type:f.get('reason_type'),reason:f.get('reason')}),done(r,reload));return;
  }
  if(!a)return;
  if(action==='amend-decide'){
   show('Decide this amendment',form(`<p class="info full">You are approving a change to a confirmed period: ${esc(a.reason_type)}. ${esc(a.reason)}</p>`+select('decision','Decision',['Approved','Rejected'],'Approved')+'<label class="full">Reason for your decision *<textarea name="note" required minlength="10" maxlength="2000"></textarea></label>','Save decision'),
    f=>request({action:'sales_amend_decide',...base(),decision:f.get('decision'),note:f.get('note')}),done(r,reload));return;
  }
  if(action==='amend-prepare'){
   show('Prepare the reversals',form(`<p class="info full">This drafts a reversal of every posted entry built from this summary. A different Manager or Partner must then review and post each one in Client accounting → Entry register. Until then the summary cannot be replaced.</p>`,'Prepare reversals'),
    async()=>request({action:'sales_amend_prepare',...base()}),done(r,reload));return;
  }
  if(action==='amend-complete'){
   show('Withdraw the old summary',form(`<p class="info full">The posted entries are reversed. The old summary is set aside (kept in the history) and its dates are free for a correct upload.</p>`,'Withdraw summary'),
    async()=>request({action:'sales_amend_complete',...base()}),done(r,reload));return;
  }
  if(action==='amend-cancel'){
   show('Cancel the request',form(`<p class="info full">Nothing has been reversed yet. The summary stays confirmed.</p>`,'Cancel request'),
    async()=>request({action:'sales_amend_cancel',...base()}),done(r,reload));return;
  }
 }
 return {panel,handle,isAction:a=>String(a).startsWith('amend-')};
}
