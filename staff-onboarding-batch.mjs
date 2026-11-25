// MLRO onboarding template screen. Preparers upload the onboarding form (v3.1). Supervisors, Managers and Partners check and approve the proposals it created.
// The MLRO records the batch checks and each rating, accepts the complete clients, downloads the confirmation PDF and attaches the signed copy.
import {batchIssuesHtml} from './staff-proposals.mjs?v=20261109-kyc-v1&create-client=20261122-v1&batch=20261124-v2';
export function createOnboardingBatchUI(ctx){
 const {esc,modal,request,form,field,options,data,notice}=ctx;
 const me=()=>data().me?.category_code,preparer=()=>['ASSISTANT','SUPERVISOR'].includes(me()),leader=()=>['PARTNER','MANAGER'].includes(me());
 const chip=s=>`<span class="badge ${s==='Confirmed'?'ok':s==='Checks complete'?'info':'warn'}">${esc(s)}</span>`;
 async function list(){
  const r=await request({action:'onboarding_batch_read'});
  const rows=r.batches.map(b=>`<tr><td><button type="button" data-ob-open="${esc(b.batch_ref)}">${esc(b.batch_ref)}</button></td><td>${esc(b.file_name)}</td><td>${esc(b.client_count)}</td><td>${chip(b.status)}</td><td>${esc(b.created_by_name||'')}</td></tr>`).join('');
  modal('Client onboarding batches',`<p class="info">Upload the onboarding form (v3.1). Owners and contacts become proposals for an independent check and approval. The MLRO then records the batch checks and ratings and accepts the complete clients.</p>
   ${preparer()?'<div class="actions"><button type="button" class="primary" data-ob-upload>Upload onboarding form</button></div>':''}
   ${rows?`<div class="scroll"><table><thead><tr><th>Batch</th><th>File</th><th>Clients</th><th>Status</th><th>Uploaded by</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">No onboarding batches yet.</p>'}`,null,null,{refreshWorkspace:false});
  wire();
 }
 function upload(){
  const firms=data().firms||[];
  modal('Upload onboarding form',form('<p class="info full">Use the PCL client onboarding batch form (version 3.1). Every row is checked first; if one row has a problem, nothing is saved. No identity or passport number is read: the form records only that the document was sighted.</p>'+
   `<label>Handling firm *<select name="firm_id" required>${options(firms.map(f=>[f.firm_id,f.firm_code+' · '+f.legal_name]),firms.length===1?firms[0].firm_id:'')}</select></label>`+field('file','Form (.xlsx) *','','file','required accept=".xlsx"'),'Check and save'),async f=>{
   const file=f.get('file');if(!file||!file.name)throw Error('Choose the form.');
   const up=new FormData();up.set('firm_id',f.get('firm_id'));up.set('file',file);
   const out=await request(up,{file:true,uploadKind:'onboarding_template'});
   if(out.status==='VALIDATION_FAILED'){setTimeout(()=>modal('Nothing was saved',batchIssuesHtml(out,esc)),20);return;}
   setTimeout(()=>modal('Onboarding form saved',`<p class="info">${esc(out.message)}</p><p>Batch <b>${esc(out.batch_ref)}</b>. Already recorded and left unchanged: <b>${out.skipped_existing.length}</b>.</p>${out.notices?.length?`<ul>${out.notices.slice(0,40).map(n=>`<li>${n.row?'Row '+esc(n.row)+' · ':''}${esc(n.column)}: ${esc(n.issue)}</li>`).join('')}</ul>`:''}`),20);
  },undefined,{successMessage:'Form checked and saved.'});
 }
 const checksForm=b=>{
  const rows=b.checks_list.map(c=>{const v=(b.batch.checks||{})[c.key]||{};return `<tr><td>${esc(c.label)}</td><td><input type="date" aria-label="${esc(c.label)} date" name="on_${c.key}" value="${esc(v.on||'')}"></td><td><input aria-label="${esc(c.label)} done by" name="by_${c.key}" value="${esc(v.by||'')}" maxlength="120"></td><td><input aria-label="${esc(c.label)} method" name="method_${c.key}" value="${esc(v.method||'')}" maxlength="300"></td><td><input aria-label="${esc(c.label)} result" name="result_${c.key}" value="${esc(v.result||'')}" maxlength="300"></td></tr>`;}).join('');
  const bt=b.batch;
  return form(`<p class="info full">Fill each check from the evidence of what was done. Next screening (four months) and the full review (two years) are worked out from the decision date.</p><div class="scroll full"><table><thead><tr><th>Check</th><th>Carried out on</th><th>By</th><th>Lists or method</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>`+
   field('evidence_reference','Where the screening evidence is kept *',bt.evidence_reference||'','text','maxlength="300"')+field('uncovered_clients','Clients NOT covered by a check (write None if none) *',bt.uncovered_clients||'','text','maxlength="1000"')+
   field('staff_register_checked_on','Owner names checked against the staff register on *',bt.staff_register_checked_on||'','date')+field('exposure_instruction_on','Date of the firm’s instruction on exposure (if any)',bt.exposure_instruction_on||'','date')+
   `<label>All conditions cleared and evidenced? *<select name="conditions_cleared">${options(['Yes','No'],bt.conditions_cleared===true?'Yes':bt.conditions_cleared===false?'No':'')}</select></label>`+field('decision_date','Date of decision *',bt.decision_date||'','date'),'Save checks');
 };
 const fieldsOf=(f,b)=>({checks:Object.fromEntries(b.checks_list.map(c=>[c.key,{on:f.get('on_'+c.key),by:f.get('by_'+c.key),method:f.get('method_'+c.key),result:f.get('result_'+c.key)}])),evidence_reference:f.get('evidence_reference'),uncovered_clients:f.get('uncovered_clients'),staff_register_checked_on:f.get('staff_register_checked_on'),exposure_instruction_on:f.get('exposure_instruction_on'),conditions_cleared:f.get('conditions_cleared'),decision_date:f.get('decision_date')});
 async function open(ref){
  const b=await request({action:'onboarding_batch_read',batch_ref:ref}),bt=b.batch,mlro=b.can.mlro;
  const rows=b.clients.map(c=>`<tr><td>${esc(c.name)}<br><small>${esc(c.pin)}</small></td><td>${esc(c.owners_sighted)}/${esc(c.owners)}</td><td>${esc(c.decision||c.stage||'Not started')}</td>
   <td>${mlro?`<select aria-label="Risk rating for ${esc(c.name)}" data-ob-rating="${esc(c.client_id)}">${options(['Low','Medium','High'],c.rating||'','Rating…')}</select><input aria-label="Condition for ${esc(c.name)}" data-ob-cond="${esc(c.client_id)}" value="${esc(c.condition||'')}" placeholder="Condition or None" maxlength="1000">`:esc((c.rating||'—')+(c.condition?' · '+c.condition:''))}</td>
   <td>${c.ready?'<span class="badge ok">Complete</span>':c.hold.length?`<small>${c.hold.map(esc).join('<br>')}</small>`:''}</td></tr>`).join('');
  modal(`Onboarding batch ${esc(ref)}`,`<p>${chip(bt.status)} · ${esc(bt.client_count)} clients${bt.decision_date?` · decision ${esc(bt.decision_date)} · next screening ${esc(bt.next_screening_due)} · full review ${esc(bt.full_review_due)}`:''}</p>
   <div class="actions">${['SUPERVISOR','MANAGER','PARTNER'].includes(me())?`<button type="button" data-ob-do="check" data-ref="${esc(ref)}">Check all proposals</button>`:''}${leader()?`<button type="button" data-ob-do="approve" data-ref="${esc(ref)}">Approve all proposals</button>`:''}
   ${mlro?`<button type="button" data-ob-do="checks" data-ref="${esc(ref)}">MLRO checks</button><button type="button" data-ob-do="ratings" data-ref="${esc(ref)}">Save ratings</button><button type="button" class="primary" data-ob-do="accept" data-ref="${esc(ref)}">Accept complete clients</button><button type="button" data-ob-do="sign" data-ref="${esc(ref)}">Attach signed PDF</button>`:''}
   ${['SUPERVISOR','MANAGER','PARTNER'].includes(me())?`<button type="button" data-ob-do="pdf" data-ref="${esc(ref)}">Download confirmation PDF</button>`:''}<button type="button" data-ob-list>Back to batches</button></div>
   ${bt.signed_doc_ref?`<p class="info">Signed confirmation attached: ${esc(bt.signed_doc_ref)}.</p>`:''}
   <div class="scroll"><table><thead><tr><th>Client</th><th>Owners sighted</th><th>AML</th><th>Rating and condition</th><th>Held back because</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">${esc(b.note)}</p>`,null,null,{refreshWorkspace:false});
  wire(b);
 }
 const noteModal=(title,go,after)=>modal(title,form(field('note','Note * (at least 10 characters)','','text','required minlength="10" maxlength="1000"'),'Run'),async f=>{const out=await go(f.get('note'));setTimeout(()=>modal('Result',`<p>Done: <b>${out.done.length}</b> · Held back: <b>${out.held.length}</b></p>${out.held.length?`<ul>${out.held.map(x=>`<li>${esc(x.name)}: ${esc(x.reason||(x.reasons||[]).join(' '))}</li>`).join('')}</ul>`:''}`),20);},undefined,{successMessage:'Done.'});
 function wire(b){
  const root=document.querySelector('#editorBody');if(!root)return;
  root.querySelectorAll('[data-ob-open]').forEach(x=>x.onclick=()=>open(x.dataset.obOpen).catch(e=>notice(e.message,true)));
  root.querySelectorAll('[data-ob-upload]').forEach(x=>x.onclick=upload);
  root.querySelectorAll('[data-ob-list]').forEach(x=>x.onclick=()=>list().catch(e=>notice(e.message,true)));
  root.querySelectorAll('[data-ob-do]').forEach(x=>x.onclick=async()=>{
   const ref=x.dataset.ref,k=x.dataset.obDo;
   try{
    if(k==='check'||k==='approve')return noteModal(k==='check'?'Check every proposal in this batch':'Approve every proposal in this batch',note=>request({action:k==='check'?'onboarding_batch_check':'onboarding_batch_approve',batch_ref:ref,note}));
    if(k==='checks')return modal('MLRO checks',checksForm(b),async f=>{const out=await request({action:'onboarding_batch_checks_save',batch_ref:ref,fields:fieldsOf(f,b)});if(out.saved===false)throw Error(out.errors.map(e=>e.error).join(' '));},()=>open(ref),{successMessage:'Checks saved.'});
    if(k==='ratings'){const items=[...root.querySelectorAll('[data-ob-rating]')].filter(s=>s.value).map(s=>({client_id:s.dataset.obRating,risk_rating:s.value,condition:root.querySelector(`[data-ob-cond="${s.dataset.obRating}"]`)?.value||'None'}));if(!items.length)return notice('Choose a rating for at least one client.',true);await request({action:'onboarding_batch_ratings_save',batch_ref:ref,items});notice('Ratings saved.');return open(ref);}
    if(k==='accept'){const out=await request({action:'onboarding_batch_accept',batch_ref:ref});return modal('Acceptance result',`<p>Accepted: <b>${out.done.length}</b> · Held back: <b>${out.held.length}</b></p>${out.held.length?`<ul>${out.held.map(h=>`<li>${esc(h.name)}: ${esc(h.reasons.join(' '))}</li>`).join('')}</ul>`:''}<p class="muted">Held-back clients are decided one by one on their AML screen.</p>`,null,null,{refreshWorkspace:false});}
    if(k==='sign')return modal('Attach the signed confirmation',form('<p class="info full">Upload the signed PDF to one of this batch’s clients (Documents), then enter its DOC reference here. The batch is confirmed once every rated client is decided.</p>'+field('doc_ref','DOC reference *','','text','required maxlength="40" placeholder="DOC-…"'),'Attach and confirm'),async f=>{await request({action:'onboarding_batch_sign',batch_ref:ref,doc_ref:f.get('doc_ref')});},()=>open(ref),{successMessage:'Batch confirmed.'});
    if(k==='pdf'){const out=await request({action:'onboarding_batch_pdf',batch_ref:ref});const a=document.createElement('a');a.href='data:application/pdf;base64,'+out.base64;a.download=out.file_name;document.body.append(a);a.click();a.remove();notice('Confirmation PDF downloaded. Fingerprint '+out.fingerprint+'.');}
   }catch(e){notice(e.message||'This could not be done.',true);}
  });
 }
 return {open:()=>list()};
}
