// "Delete and redo" (build 2806). One plain-language panel on every summary or payroll run: what can be done about a mistake right now, who has to do the
// rest, and what is kept. Nothing is deleted; the record stays in the history with who removed it, when and why.
export function createDeleteRedoUI(ctx,{show,button}){
 const {esc,form,request,notice}=ctx;
 const LABEL={discard:'Delete and redo',withdraw_discard:'Withdraw and redo',return_discard:'Return, delete and redo',return:'Return for correction'};
 let last=null;
 function panel(x){
  last=x||null;if(!x?.plan||['Discarded','Superseded'].includes(x.plan.stage)||x.plan.route==='amendment')return '';
  const p=x.plan,blockers=(p.blockers||[]).map(b=>`<li>${esc(b)}</li>`).join(''),steps=(p.steps||[]).map(s=>`<li>${esc(s)}</li>`).join('');
  return `<section class="info full" data-delete-redo><h3>Entered incorrectly?</h3>${p.who?`<p class="muted">Who: ${esc(p.who)}</p>`:''}${steps?`<ul>${steps}</ul>`:''}${blockers?`<ul class="error">${blockers}</ul>`:''}<p class="muted">${esc(p.keeps||'')}</p>${p.can_apply?`<div class="actions">${button('redo-apply',LABEL[p.apply]||'Remove and redo')}</div>`:''}</section>`;
 }
 const isAction=a=>a==='redo-apply';
 async function handle(action,r,pid,after){
  if(action!=='redo-apply'||!last?.plan?.can_apply)return;
  const p=last.plan;
  show(LABEL[p.apply]||'Remove and redo',form(`<p class="info full">${esc((p.steps||[]).join(' '))}</p><label class="full">Why is it being removed? *<textarea name="reason" required minlength="5" maxlength="1000" placeholder="For example, the wrong month was prepared"></textarea></label>${p.apply==='discard'||p.apply==='withdraw_discard'||p.apply==='return_discard'?'<label class="full"><input type="checkbox" name="remove_file" checked> Also remove the uploaded file from Import sources, if there is one</label>':''}`,LABEL[p.apply]||'Remove'),
   async f=>{
    const out=await request({action:'delete_redo_apply',project_id:pid,import_id:r.import_id,revision:last.revision,reason:f.get('reason')});
    let extra='';
    if(out.document_id&&f.has('remove_file')){try{await request({action:'document_archive',document_id:out.document_id,reason:'Summary removed: '+String(f.get('reason')).slice(0,900),confirmed:true});}catch(err){extra=' The uploaded file could not be removed: '+err.message;}}
    return {...out,extra};
   },
   async out=>{notice((out.status==='Returned'?'Returned for correction.':'Removed.')+' '+(out.redo||'')+(out.extra||''),!!out.extra);await after(pid);});
 }
 return {panel,handle,isAction};
}
