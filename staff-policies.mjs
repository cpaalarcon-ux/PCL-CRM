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
export function policyCard(data,esc=v=>String(v??''),fmt=v=>String(v||'').slice(0,10)){
 const p=policyOf(data);if(!p)return '';
 const partner=data.me?.category_code==='PARTNER',signed=p.status==='Signed_Off';
 const state=signed?`<span class="badge good">Signed off</span> by ${esc(p.signed_by_name||'a Partner')} on ${esc(fmt(p.signed_at))}`:'<span class="badge warn">Pending Partner sign-off</span> Assistants cannot enter client data yet.';
 const button=partner?(signed?`<button type="button" class="secondary" data-policy="revoke" data-code="${esc(p.policy_code)}" data-rev="${esc(p.revision)}">Withdraw authorization</button>`:`<button type="button" class="primary" data-policy="sign" data-code="${esc(p.policy_code)}" data-rev="${esc(p.revision)}">Digitally Sign &amp; Authorize</button>`):'<p class="muted">Only a Partner can sign this policy.</p>';
 return `<div class="card" id="policyCard"><div class="section-head"><h2>Compliance</h2></div><h3>${esc(p.policy_name)}</h3><blockquote class="policy-statement">${esc(p.statement)}</blockquote><p class="muted">Entries made by Assistants are saved as proposals and take effect only after a Manager or Partner approves them. Withdrawing the authorization locks Assistant data entry again; nothing already approved is undone.</p><p>${state}</p>${button}</div>`;
}
export function bindPolicies(ctx){
 const {esc,form,modal,request,data}=ctx;
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-policy]');if(!b)return;const p=policyOf(data(),b.dataset.code);if(!p)return;
  const base={policy_code:p.policy_code,revision:b.dataset.rev};
  if(b.dataset.policy==='sign')modal('Sign and authorize',form(`<p class="info full">${esc(p.statement)}</p><label class="full"><input type="checkbox" name="confirm" required> I confirm, as a Partner, that I authorize this policy.</label>`,'Digitally Sign & Authorize'),f=>request({action:'policy_sign',...base,confirm:f.get('confirm')==='on'||f.get('confirm')==='true'}),undefined,{successMessage:'Policy signed. Assistants can now propose client data.'});
  else modal('Withdraw authorization',form(`<p class="info full">Assistants will no longer be able to propose client data. Nothing already approved is undone.</p>`,'Withdraw authorization'),()=>request({action:'policy_revoke',...base}),undefined,{successMessage:'Authorization withdrawn. Assistant data entry is locked.'});
 });
}
