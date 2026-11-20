// Partner policy sign-off. Until the Partner signs the Audit Assistant Data Entry Policy, Assistants cannot enter client data
// (the server returns 403). This file shows the sign-off card in Settings and the "locked" banner; the server and database enforce the rule.
export const ASSISTANT_ENTRY_POLICY='ASSISTANT_DATA_ENTRY';
export const LOCKED_TEXT='Data entry by Assistants is currently locked pending Partner authorization.';
export const policyOf=(data,code=ASSISTANT_ENTRY_POLICY)=>(data.policies||[]).find(p=>p.policy_code===code);
export const assistantEntryOpen=data=>policyOf(data)?.status==='Signed_Off';
export function assistantLockBanner(data,esc=v=>String(v??'')){
 if(data.me?.category_code!=='ASSISTANT'||assistantEntryOpen(data))return '';
 return `<div class="notice warn" id="assistantLockBanner" role="status"><b>${esc(LOCKED_TEXT)}</b> A Partner signs this under Settings › Compliance. Until then you can still see client records, but you cannot propose changes.</div>`;
}
// Review line shown under each policy: counts down to the review date once a go-live date is set, and stays paused until then.
const nairobiDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
export function reviewLine(p,esc=v=>String(v??''),today=nairobiDay()){
 if(p.status==='Pending')return '';
 const live=p.go_live_date?String(p.go_live_date).slice(0,10):'';
 if(p.status==='Expired')return `<p class="missing" role="status"><b>Expired.</b> The review was due on ${esc(String(p.review_due_date||'').slice(0,10))}. ${p.policy_code===ASSISTANT_ENTRY_POLICY?'Assistant data entry is blocked until a Partner signs it again.':'This policy is advisory: nothing is blocked. Sign it again to clear the warning.'}</p>`;
 if(!live||!p.review_due_date)return '<p class="muted">Review timer paused until Go-Live.</p>';
 const due=String(p.review_due_date).slice(0,10),days=Math.round((Date.parse(due+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);
 return `<p class="${days<=3?'missing':'muted'}">${days>0?`Review due in ${days} day${days===1?'':'s'}`:'Review due today'} (Based on Go-Live Date: ${esc(live)}).</p>`;
}
export function policyCard(data,esc=v=>String(v??''),fmt=v=>String(v||'').slice(0,10)){
 const p=policyOf(data);if(!p)return '';
 const partner=data.me?.category_code==='PARTNER',signed=p.status==='Signed_Off',expired=p.status==='Expired';
 const state=signed?`<span class="badge good">Active (Signed off)</span> by ${esc(p.signed_by_name||'a Partner')} on ${esc(fmt(p.signed_at))}`:expired?'<span class="badge bad">Expired</span> Assistants cannot enter client data until a Partner signs again.':'<span class="badge warn">Pending Partner sign-off</span> Assistants cannot enter client data yet.';
 const button=partner?(signed?`<button type="button" class="secondary" data-policy="revoke" data-code="${esc(p.policy_code)}" data-rev="${esc(p.revision)}">Withdraw authorization</button>`:`<button type="button" class="primary" data-policy="sign" data-code="${esc(p.policy_code)}" data-rev="${esc(p.revision)}">${expired?'Review and sign again':'Digitally Sign &amp; Authorize'}</button>`):'<p class="muted">Only a Partner can sign this policy.</p>';
 return `<div class="card" id="policyCard"><div class="section-head"><h2>Compliance</h2></div><h3>${esc(p.policy_name)}</h3><blockquote class="policy-statement">${esc(p.statement)}</blockquote><p class="muted">Entries made by Assistants are saved as proposals and take effect only after a Manager or Partner approves them. Withdrawing the authorization locks Assistant data entry again; nothing already approved is undone.</p><p>${state}</p>${reviewLine(p,esc)}${button}</div>`;
}
// The other Partner policies (assignment, leave and handover, security, and any added later). Each is a sign-off only; the wording cannot be edited.
export function otherPoliciesCard(data,esc=v=>String(v??''),fmt=v=>String(v||'').slice(0,10)){
 const list=(data.policies||[]).filter(p=>p.policy_code!==ASSISTANT_ENTRY_POLICY);if(!list.length)return '';
 const partner=data.me?.category_code==='PARTNER';
 const row=p=>{const signed=p.status==='Signed_Off',expired=p.status==='Expired',state=signed?`<span class="badge good">Active (Signed off)</span> by ${esc(p.signed_by_name||'a Partner')} on ${esc(fmt(p.signed_at))}`:expired?'<span class="badge bad">Expired</span>':'<span class="badge warn">Pending Partner sign-off</span>';
  const button=partner?(signed?`<button type="button" class="secondary" data-policy="revoke" data-code="${esc(p.policy_code)}" data-rev="${esc(p.revision)}">Withdraw sign-off</button>`:`<button type="button" class="primary" data-policy="sign" data-code="${esc(p.policy_code)}" data-rev="${esc(p.revision)}">${expired?'Review and sign again':'Digitally Sign &amp; Authorize'}</button>`):'';
  return `<div class="task"><div><h3>${esc(p.policy_name)}</h3><blockquote class="policy-statement">${esc(p.statement)}</blockquote><p>${state}</p>${reviewLine(p,esc)}${button}</div></div>`;};
 return `<div class="card" id="otherPoliciesCard"><div class="section-head"><h2>Partner policies</h2></div><p class="muted">${partner?'Read each policy, then sign it. Only a Partner can sign or withdraw. Your name and the time are recorded.':'Only a Partner can sign these policies.'}</p>${list.map(row).join('')}</div>`;
}
export function bindPolicies(ctx){
 const {esc,form,modal,request,data}=ctx;
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-policy]');if(!b)return;const p=policyOf(data(),b.dataset.code);if(!p)return;
  const base={policy_code:p.policy_code,revision:b.dataset.rev};
  if(b.dataset.policy==='sign')modal('Sign and authorize',form(`<p class="info full">${esc(p.statement)}</p><label class="full"><input type="checkbox" name="confirm" required> I confirm, as a Partner, that I authorize this policy.</label>`,'Digitally Sign & Authorize'),f=>request({action:'policy_sign',...base,confirm:f.get('confirm')==='on'||f.get('confirm')==='true'}),undefined,{successMessage:p.policy_code===ASSISTANT_ENTRY_POLICY?'Policy signed. Assistants can now propose client data.':'Policy signed. Your name and the time are recorded.'});
  else modal('Withdraw authorization',form(`<p class="info full">${p.policy_code===ASSISTANT_ENTRY_POLICY?'Assistants will no longer be able to propose client data. Nothing already approved is undone.':'This policy goes back to Pending. Nothing is deleted; the change is audit-logged.'}</p>`,'Withdraw authorization'),()=>request({action:'policy_revoke',...base}),undefined,{successMessage:'Authorization withdrawn. Assistant data entry is locked.'});
 });
}

// Partner-only go-live date. While it is empty (staging and UAT) policy review timers stay paused and nothing expires.
export function goLiveCard(data,esc=v=>String(v??'')){
 if(data.me?.category_code!=='PARTNER')return '';
 const live=(data.policies||[]).find(p=>p.go_live_date)?.go_live_date;
 return `<div class="card" id="goLiveCard"><div class="section-head"><div><h2>Go-live date</h2><p class="muted">${live?`Set to <b>${esc(String(live).slice(0,10))}</b>. Each signed policy is reviewed 14 days after this date. A policy that is not signed again by its review date expires, and what depends on it is blocked.`:'Not set. While the system is in staging or UAT, policy review timers are paused and nothing expires.'}</p></div><button type="button" class="primary" data-golive="edit" data-date="${esc(live?String(live).slice(0,10):'')}">${live?'Change go-live date':'Set go-live date'}</button></div></div>`;
}
export function bindGoLive(ctx){
 const {esc,form,modal,request,field}=ctx;
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-golive]');if(!b)return;
  modal('Go-live date',form(field('go_live_date','Go-live date (leave empty to pause the review timers)',b.dataset.date||'','date')+`<label class="full">Why? * <textarea name="note" required minlength="10" maxlength="1000"></textarea></label>`,'Save go-live date'),f=>request({action:'go_live_save',go_live_date:f.get('go_live_date')||null,note:f.get('note')}),undefined,{successMessage:'Go-live date saved. Policy review dates were recalculated.'});
 });
}

// Red warning on the Partner's Home for any policy that has expired (amber when a review is due within 3 days). Only the Assistant data entry
// policy blocks anything; for every other policy this is a reminder and no system function is stopped.
export function policyWarnings(data,esc=v=>String(v??''),today=nairobiDay()){
 if(data.me?.category_code!=='PARTNER')return '';
 const soon=p=>{if(p.status!=='Signed_Off'||!p.review_due_date)return false;const days=Math.round((Date.parse(String(p.review_due_date).slice(0,10)+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000);return days<=3;};
 const expired=(data.policies||[]).filter(p=>p.status==='Expired'),due=(data.policies||[]).filter(soon);
 if(!expired.length&&!due.length)return '';
 const row=p=>`<li><b>${esc(p.policy_name)}</b>${p.policy_code===ASSISTANT_ENTRY_POLICY?' — Assistant data entry is blocked until you sign it again':' — advisory, nothing is blocked'}</li>`;
 return `<div class="notice ${expired.length?'error':'warn'}" id="policyWarnings" role="alert">${expired.length?`<b>${expired.length===1?'A policy has':'Policies have'} expired.</b> Open Settings, read ${expired.length===1?'it':'each one'} and sign again.<ul>${expired.map(row).join('')}</ul>`:''}${due.length?`<b>Review due within 3 days:</b><ul>${due.map(p=>`<li>${esc(p.policy_name)} (${esc(String(p.review_due_date).slice(0,10))})</li>`).join('')}</ul>`:''}</div>`;
}
