// Bank starter rules that wait for a tax ruling (Settings). A locked starter, today "excise duty on bank charges to expense 51070", opens for copying only after a
// PARTNER records that the Tax Lead confirmed it in writing: who, the date, and where it is written. Claude never records one. Managers can read; only a Partner records.
// Recording applies the rule to no client: a preparer still copies it as a Proposed rule and a different Manager or Partner still approves it.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const STARTER_CONFIRM_NOTE='A starter rule that depends on a tax ruling stays locked until a Partner records the Tax Lead\'s written confirmation here. Recording it does not apply the rule to any client: a preparer still copies it as a Proposed rule, and a different Manager or Partner still approves it.';
export const confirmState=s=>s.locked?'Locked: no Tax Lead confirmation recorded':`Unlocked: confirmed in writing by ${s.confirmation.confirmed_by_name} on ${day(s.confirmation.confirmed_on)}`;

export function startersView({starters,history,partner,button}){
 const rows=(starters||[]).map(s=>`<tr><td><b>${esc(s.label)}</b><small>“${esc(s.keyword)}” money out to ${esc(s.account_code)}. ${esc(s.why)}</small></td><td>${esc(s.needs)}</td><td><span class="badge ${s.locked?'warn':'ok'}">${esc(confirmState(s))}</span>${s.confirmation?`<small>Where it is written: ${esc(s.confirmation.source_note)}</small>`:''}</td><td>${partner?(s.locked?button('starter-confirm','Record confirmation',s.key):button('starter-withdraw','Withdraw',s.confirmation.confirmation_id)):''}</td></tr>`).join('');
 const past=(history||[]).filter(h=>h.status==='Withdrawn');
 return `<p class="info full">${esc(STARTER_CONFIRM_NOTE)}</p><div class="scroll full"><table id="starterConfirmTable"><thead><tr><th>Starter rule</th><th>Confirmation from</th><th>State</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="4">No starter rule is waiting for a confirmation.</td></tr>'}</tbody></table></div>${past.length?`<h3>Withdrawn confirmations</h3><ul>${past.map(h=>`<li>${esc(h.rule_key)}: ${esc(h.confirmed_by_name)}, ${esc(day(h.confirmed_on))}. Withdrawn ${esc(day(h.withdrawn_at))}: ${esc(h.withdrawn_reason)}</li>`).join('')}</ul>`:''}`;
}

export function createStarterConfirmUI(ctx){
 const {field,form,modal,request,button,area}=ctx,d=()=>ctx.data();
 let cur=null;
 const leaderRole=me=>['PARTNER','MANAGER'].includes(me?.category_code);
 const partner=()=>d().me?.category_code==='PARTNER';
 function card(){
  if(!leaderRole(d().me))return '';
  return `<section class="card section-space" id="starterConfirmCard"><div class="section-head"><h2>Bank starter rules waiting for the Tax Lead</h2>${button('starter-confirm-open','Open')}</div><p class="muted">Excise duty on bank charges is locked until a Partner records the Tax Lead's written confirmation.</p></section>`;
 }
 async function open(){
  const r=await request({action:'bank_starter_confirm_read'});cur=r;
  modal('Bank starter rules waiting for the Tax Lead',startersView({starters:r.starters,history:r.history,partner:partner(),button}));
 }
 async function handle(action,id){
  if(!action.startsWith('starter-'))return false;
  if(action==='starter-confirm-open'){await open();return true;}
  if(action==='starter-confirm'){
   const s=(cur?.starters||[]).find(x=>x.key===id);if(!s||!partner())return true;
   modal('Record confirmation · '+s.label,form(`<p class="info full">Record only what the Tax Lead has confirmed <b>in writing</b>: that “${esc(s.keyword)}” money out is treated as the expense account <b>${esc(s.account_code)}</b>. You are recording their confirmation, not making the decision.</p>`+field('confirmed_by_name','Name of the Tax Lead who confirmed *','','text','required maxlength="120"')+field('confirmed_on','Date of the written confirmation *','','date','required')+area('source_note','Where it is written, for example the email and its date *','',true)+'<label class="full check-row"><input type="checkbox" name="seen_in_writing" value="yes" required> I have seen the Tax Lead\'s written confirmation.</label>','Record confirmation'),
    f=>request({action:'bank_starter_confirm_record',rule_key:s.key,account_code:s.account_code,confirmed_by_name:f.get('confirmed_by_name'),confirmed_on:f.get('confirmed_on'),source_note:f.get('source_note'),seen_in_writing:f.get('seen_in_writing')==='yes'}),open);
   return true;
  }
  if(action==='starter-withdraw'){
   const h=(cur?.history||[]).find(x=>x.confirmation_id===id);if(!h||!partner())return true;
   modal('Withdraw confirmation',form('<p class="info full">Withdrawing locks the starter again for new copies. Rules already copied into a client keep their own approval and are not changed.</p>'+area('reason','Why is it being withdrawn? *','',true),'Withdraw'),
    f=>request({action:'bank_starter_confirm_withdraw',confirmation_id:id,revision:h.revision,reason:f.get('reason')}),open);
   return true;
  }
  return false;
 }
 return {card,handle,open};
}
