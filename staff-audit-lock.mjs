// The audit lock (build 2875): the annual statements stay DRAFT until the audit is complete. A Partner approves the notes first; then a Manager or Partner locks the pack with an in-house audit
// (a completed, approved audit file they did not prepare) or an external audit (the signed auditor's PDF in the client's document vault). Only a Partner ends a lock, with a reason.
// The server owns every rule; this file draws what it returns.
export function createAuditLockUI(ctx,{payload,show,onChange}){
 const {esc,form,field,request,notice,shortDate}=ctx;
 const btn=(a,l,id='')=>`<button type="button" data-audit="${a}" data-id="${esc(id)}">${esc(l)}</button>`;
 const opts=(list,sel='')=>list.map(([v,l])=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(l)}</option>`).join('');
 const sel=(name,label,list,v='')=>`<label class="full">${esc(label)} <select name="${name}" required>${opts(list,v)}</select></label>`;
 let data=null;
 const BADGE={locked:'<span class="badge good">Audited and locked</span>',stale:'<span class="badge red">Figures changed after the lock</span>',ready:'<span class="badge warn">Audit complete: ready to lock</span>',in_progress:'<span class="badge warn">In-house audit in progress</span>',not_started:'<span class="badge red">Not started</span>',external_pending:'<span class="badge warn">External auditor pending</span>',not_audited:'<span class="badge">Not audited</span>',not_declared:'<span class="badge">Audit arrangement not recorded</span>'};
 async function open(){
  data=await request(payload('ledger_audit_read'));
  const st=data.state,lk=data.lock,nt=data.notes;
  const status=`<p>${BADGE[st.status]||''} <b>Statements: ${esc(data.wording)}.</b></p>`;
  const notes=`<p>${nt.ok?`Notes approved by ${esc(nt.approved_name||'a Partner')}${nt.approved_at?' on '+esc(shortDate(nt.approved_at)):''}.`:'<span class="error" role="alert">The Partner has not approved the current notes. The pack cannot be locked until they do.</span>'}</p>`;
  const lock=lk?`<section class="card section-space"><h4>Locked ${lk.mode==='External audit'?'by the external auditor’s report':'by the in-house audit'}</h4><p>Locked by ${esc(lk.locked_name||'')} on ${esc(shortDate(lk.locked_at))}${lk.sole_partner_approval?' (the firm’s only Partner, who prepared the audit file)':''}.</p><p>Report ${esc(lk.report_reference)} dated ${esc(shortDate(lk.report_date))}. Opinion: ${esc(lk.opinion)}.${lk.auditor_name?` Auditor: ${esc(lk.auditor_name)}.`:''}</p></section>`:'';
  const arr=data.arrangement?`<p>Recorded as <b>${esc(data.arrangement.mode)}</b> by ${esc(data.arrangement.set_by_name||'')}.${data.arrangement.note?' '+esc(data.arrangement.note):''}</p>`:'<p class="muted">No audit arrangement is recorded for this year.</p>';
  const act=[data.can_declare?btn('declare','Record how the year is audited'):'',data.can_lock&&st.status!=='not_audited'?btn('lock',st.mode==='External audit'?'Upload External Audit Report and Lock':st.mode==='In-house audit'?'Lock with In-house Audit':'Lock the pack'):'',data.can_end?btn('end','End the lock',lk?.lock_id):''].join('');
  const hist=data.history.length?`<h4>Lock history</h4><ul>${data.history.map(h=>`<li>${esc(h.mode)}, ${esc(h.report_reference)}: locked by ${esc(h.locked_name||'')} on ${esc(shortDate(h.locked_at))}${h.ended_at?`; ended by ${esc(h.ended_name||'')} on ${esc(shortDate(h.ended_at))}: ${esc(h.end_reason||'')}`:' (live)'}</li>`).join('')}</ul>`:'';
  show('Audit status and lock',`<p class="info full">The statements stay a draft until the audit is complete. Order: a Partner approves the notes, then a Manager or Partner locks the pack. Any change to a figure or to the notes after that shows the pack as changed after the audit, and a Partner must end the lock first.</p>${status}${notes}${arr}${data.check.status==='Blocked'?`<p class="error" role="status">${esc(data.check.detail)}</p>`:`<p class="muted">${esc(data.check.detail)}</p>`}${lock}<div class="actions">${act}</div>${hist}`);
 }
 const handlers={
  declare(){
   show('How is this year audited?',form(sel('mode','Audit arrangement',data.arrangements.map(m=>[m,m]),data.arrangement?.mode||'In-house audit')+field('note','Note (optional)',data.arrangement?.note||'','text','maxlength="500"')+'<p class="muted full">Only a Partner records that a year is not audited.</p>','Save'),
    f=>request({...payload('ledger_audit_declare'),mode:f.get('mode'),note:f.get('note')||''}),async()=>{notice('Audit arrangement saved.');await open();onChange?.();});
  },
  lock(){
   const mode=data.state.mode||data.arrangement?.mode;
   const today=new Date().toISOString().slice(0,10);
   const common=sel('opinion','Opinion',data.opinions.map(o=>[o,o]),'Unmodified')+field('report_reference','Report reference','','text','required minlength="3" maxlength="200"')+field('report_date','Report date',today,'date',`required max="${today}"`);
   if(mode==='External audit'){
    if(!data.candidates.documents.length){notice('Upload the signed audit report (PDF) to this client’s documents first.',true);return;}
    show('Upload External Audit Report and Lock',form(sel('document_id','Signed audit report (PDF in the client’s documents)',data.candidates.documents.map(d=>[d.document_id,`${d.file_name} (${d.category}, ${d.uploaded_at})`]))+field('auditor_name','Auditor or audit firm','','text','required minlength="2" maxlength="160"')+common+'<p class="info full">This locks the pack against the current figures and the approved notes.</p>','Lock the pack'),
     f=>request({...payload('ledger_audit_lock'),mode:'External audit',document_id:f.get('document_id'),auditor_name:f.get('auditor_name'),report_reference:f.get('report_reference'),report_date:f.get('report_date'),opinion:f.get('opinion')}),async()=>{notice('The pack is locked.');await open();onChange?.();});
    return;
   }
   const files=data.candidates.audit_files.filter(x=>x.complete);
   if(!files.length){notice('There is no completed, approved audit file for this year.',true);return;}
   const mine=files.some(x=>x.prepared_by_me);
   show('Lock with In-house Audit',form(sel('audit_file_id','Audit file',files.map(x=>[x.audit_file_id,`${x.reporting_framework}, ${x.starts_on} to ${x.ends_on}, ${x.file_status}, prepared by ${x.prepared_name||''}`]))+common+(mine?'<label class="full"><input type="checkbox" name="sole"> I am my firm’s only Partner and I prepared this audit file.</label>':'')+'<p class="info full">A Manager or Partner who did not prepare the audit file locks the pack.</p>','Lock the pack'),
    f=>request({...payload('ledger_audit_lock'),mode:'In-house audit',audit_file_id:f.get('audit_file_id'),report_reference:f.get('report_reference'),report_date:f.get('report_date'),opinion:f.get('opinion'),sole_partner_approval:f.has('sole')}),async()=>{notice('The pack is locked.');await open();onChange?.();});
  },
  end(id){
   show('End the audit lock',form('<p class="error full" role="alert">The statements go back to a draft. The notes can change and must be approved again before the pack is locked again.</p><label class="full">Why is the lock being ended? (at least 10 characters) <textarea name="reason" required minlength="10" maxlength="500"></textarea></label>','End the lock'),
    f=>request({...payload('ledger_audit_end'),lock_id:id,reason:f.get('reason')}),async()=>{notice('The lock has ended.');await open();onChange?.();});
  }
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-audit]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.audit]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
