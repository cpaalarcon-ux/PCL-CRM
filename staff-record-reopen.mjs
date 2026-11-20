// Partner exceptional reopen panel (build 2823). Shown to a Partner on a confirmed sales or payroll summary.
// The server decides what blocks it; this panel only shows the blockers and takes the written reason.
export function createRecordReopenUI(ctx,{show,button}){
 const {esc,form,request}=ctx;
 let last=null;
 function panel(check){
  last=check;
  if(!check)return '';
  if(check.partner_only||check.status!=='Confirmed')return '';
  if(check.can_reopen)return `<section class="info full"><h3>Partner exceptional reopen</h3><p>Nothing has been posted from this confirmed summary, so a Partner can send it back to the preparer. It needs a written reason, is recorded permanently, and must be confirmed again by an independent reviewer.</p><div class="actions">${button('record-reopen','Reopen with a reason',check.import_id)}</div></section>`;
  return `<section class="info full"><h3>Partner exceptional reopen is not available</h3><ul>${(check.blockers||[]).map(b=>`<li>${esc(b)}</li>`).join('')}</ul></section>`;
 }
 const isAction=a=>a==='record-reopen';
 async function handle(action,r,pid,reload){
  if(action!=='record-reopen')return;
  show('Partner exceptional reopen',form(`<p class="info full">This sends the confirmed summary back to the preparer. Its period is released until it is confirmed again. The original review and totals are kept in the record. This does not change anything already posted: there is nothing posted from this summary.</p><label class="full">Why is it being reopened? What was wrong and how was it found (at least 30 characters)<textarea name="reason" required minlength="30" maxlength="2000"></textarea></label>`,'Reopen this summary'),
   f=>request({action:'record_reopen_apply',project_id:pid,import_id:r.import_id,revision:r.revision,reason:f.get('reason')}),async()=>{await reload(r.import_id);});
 }
 return {panel,isAction,handle,last:()=>last};
}
