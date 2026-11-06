// "Withdraw from review": the preparer pulls their own submitted work back to Draft before anyone has checked or reviewed it.
// The server and the database enforce the same rule; this file only shows the button and asks for a short reason.
export const WITHDRAW_HELP='Use this if you spotted a mistake after submitting. It goes back to Draft, the reviewer is told, and nothing is lost. You can edit it and submit it again. It is not available once a reviewer has started on it.';
export function withdrawButton(kind,id,revision,esc=v=>String(v??'')){
 return `<button type="button" class="secondary" data-withdraw="${esc(kind)}" data-id="${esc(id)}" data-rev="${esc(revision)}" title="${esc(WITHDRAW_HELP)}">Withdraw from review</button>`;
}
// Shown only to the person who prepared it, while it is still waiting and nobody has acted on it.
export function canWithdraw(record,meId,{checked=false,preparers=['prepared_by']}={}){
 return !!record&&record.status==='Submitted'&&!record.reviewed_by&&!(checked&&record.checked_by)&&preparers.some(c=>record[c]===meId);
}
export function bindWithdraw(ctx,kinds,after){
 const {$,esc,form,modal,request}=ctx;
 document.addEventListener('click',e=>{
  const b=e.target.closest('[data-withdraw]');if(!b||!kinds.includes(b.dataset.withdraw))return;
  const {withdraw:kind,id,rev}=b.dataset;
  if($('#editor').open)$('#editor').close();
  modal('Withdraw from review',form(`<p class="info full">${esc(WITHDRAW_HELP)}</p><label class="full">Why are you withdrawing it? *<textarea name="reason" required minlength="3" maxlength="1000" placeholder="For example: wrong credit-note amount for the 16% category"></textarea></label>`,'Withdraw and return to draft'),
   f=>request({action:'work_withdraw',kind,record_id:id,revision:rev,reason:f.get('reason')}),
   async()=>{await after(kind,id);},{refreshWorkspace:false,successMessage:'Withdrawn. It is back in Draft and the reviewer has been told.'});
 });
}
