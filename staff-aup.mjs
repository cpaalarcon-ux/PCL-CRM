// Step 6: procedures for Agreed-Upon Procedures and KRA Audit and Dispute Support projects. The rules live in the database
// (20261109263000_aup_engine.sql) and the server (aup-actions.ts); this file draws the screen and sends the requests.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const AUP_SERVICES=['ADV-AUP','TAX-KRA'];
export const AUP_NOTE='Library procedures and the report wording are defaults: nothing here is confirmed by a Partner or the Compliance Lead. Staff may always write a custom procedure. The scope must follow the signed engagement letter.';
export const STATUS_TONE={'Not started':'muted','In progress':'info','Completed':'ok','Exception':'warn','Not applicable':'muted'};
export const FINISHED=['Completed','Exception','Not applicable'];
const day=v=>v?String(v).slice(0,10):'';
const leaderRole=me=>['PARTNER','MANAGER'].includes(me?.category_code);
const reviewerRole=me=>['PARTNER','MANAGER','SUPERVISOR'].includes(me?.category_code);

export function scopeState(scope){return !scope?'No scope':scope.state==='Draft'?'Draft':scope.state==='Locked'?'Locked':'Report issued';}
export function progressLine(p){
 if(!p||!Number(p.total))return 'No procedures yet.';
 const done=Number(p.completed)+Number(p.exceptions)+Number(p.not_applicable);
 const bits=[`${done} of ${p.total} performed`,`${Number(p.total)-Number(p.unreviewed)-Number(p.open_items)} reviewed`];
 if(Number(p.exceptions))bits.push(`${p.exceptions} with exceptions`);
 if(Number(p.missing_evidence))bits.push(`${p.missing_evidence} missing evidence`);
 return bits.join(' · ')+'.';
}
// Can this person review this item? Mirrors the database rule: a Supervisor, Manager or Partner who did not perform it.
export function canReview(me,item){return reviewerRole(me)&&FINISHED.includes(item.exec_status)&&!item.reviewed_by&&item.performed_by!==me.staff_id;}

export function aupView({r,me,button}){
 const pr=r.project,scope=r.scope,state=scopeState(scope),leader=leaderRole(me),partner=me?.category_code==='PARTNER';
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 let html=`<p class="info full"><b>${esc(pr.service_name)}</b> · ${badge(state,state==='No scope'?'muted':state==='Draft'?'warn':'ok')} <span class="muted">${esc(AUP_NOTE)}</span></p>`;
 if(!scope){
  html+=leader?`<div class="actions full">${button('aup-start','Start scope from the template',pr.project_id)}${button('aup-start-empty','Start an empty scope',pr.project_id)}</div><p class="muted full">Staff create the project from the template and then amend the scope to the notice and the engagement letter. The system never creates the project for you.</p>`
   :'<p class="muted full">A Manager or Partner has not started the scope yet.</p>';
  return html+libraryBlock({r,leader,partner,button});
 }
 const items=r.items||[];
 html+=`<p class="full" id="aupProgress">${esc(progressLine(r.progress))}</p>`;
 if(scope.state==='Draft'){
  html+=`<p class="warn full">Draft. Add or remove procedures freely. A Partner locks the scope against the signed engagement letter; after that, changes need a Partner's approval.</p>`;
  if(!r.letter_ok)html+='<p class="missing full" id="aupLetterMissing">The signed engagement letter is not uploaded and verified yet. The scope cannot be locked, and invoices cannot be posted, until it is.</p>';
  html+=`<div class="scroll full"><table><thead><tr><th>#</th><th>Procedure</th><th>Evidence</th><th></th></tr></thead><tbody>${items.map(i=>`<tr><td>${esc(i.seq)}</td><td><b>${esc(i.title)}</b><br><small>${esc(i.description)}</small>${i.source==='Library'?' <small class="muted">(from the library)</small>':''}</td><td>${i.evidence_required?'Required':'Not required'}</td><td>${leader?button('aup-item-edit','Edit',i.item_id)+button('aup-item-remove','Remove',i.item_id):''}</td></tr>`).join('')||'<tr><td colspan="4" class="muted">No procedures yet.</td></tr>'}</tbody></table></div>`;
  if(leader)html+=`<div class="actions full">${button('aup-item-library','+ Add from the library',pr.project_id)}${button('aup-item-custom','+ Add a custom procedure',pr.project_id)}${button('aup-template','Add the template procedures',pr.project_id)}</div>`;
  if(partner)html+=`<div class="actions full">${button('aup-lock','Lock against the signed letter',pr.project_id,r.letter_ok?'':'disabled title="Upload and verify the signed engagement letter first"')}</div>`;
  else if(leader)html+='<p class="muted full">Only a Partner can lock the scope.</p>';
 }else{
  html+=`<p class="full muted" id="aupLock">Locked ${esc(day(scope.locked_at))} by ${esc(scope.locked_by_name||'a Partner')} against ${esc(scope.letter_file||'the signed engagement letter')} (${esc(scope.letter_reference||'')}). Scope hash ${esc(String(scope.scope_sha256||'').slice(0,12))}…</p>`;
  html+=`<ol class="aup-board full">${items.map(i=>{
   const fin=FINISHED.includes(i.exec_status),ev=i.evidence||[];
   return `<li class="aup-item"><b>${esc(i.seq)}. ${esc(i.title)}</b> ${badge(i.exec_status,STATUS_TONE[i.exec_status]||'')}${i.reviewed_by?' '+badge('Reviewed','ok'):fin?' '+badge('Awaiting review','warn'):''}${i.added_in_change?' <small class="muted">(added by a scope change)</small>':''}<br><small>${esc(i.description)}</small>`
    +(i.finding?`<p><b>Finding:</b> ${esc(i.finding)}</p>`:'')
    +`<p class="muted">Evidence ${i.evidence_required?'required':'not required'}: ${ev.length?ev.map(e=>`${esc(e.file_name)}${!fin&&scope.state==='Locked'?' '+button('aup-evidence-remove','Remove',e.evidence_id):''}`).join('; '):'none attached'}.${i.performed_by_name?` Performed by ${esc(i.performed_by_name)} on ${esc(day(i.performed_at))}.`:''}${i.reviewed_by_name?` Reviewed by ${esc(i.reviewed_by_name)} on ${esc(day(i.reviewed_at))}.`:''}</p>`
    +(scope.state==='Locked'?`<div class="actions">${button('aup-perform','Record result',i.item_id)}${button('aup-evidence','Attach evidence',i.item_id)}${canReview(me,i)?button('aup-review','Review this result',i.item_id):''}${leader?button('aup-change-remove','Ask to remove',i.item_id):''}</div>`:'')+'</li>';}).join('')}</ol>`;
  const changes=r.changes||[];
  html+=`<details class="full"><summary>Scope changes (${changes.length})</summary>${changes.length?`<ul>${changes.map(c=>`<li>${badge(c.status,c.status==='Approved'?'ok':c.status==='Rejected'?'muted':'warn')} ${c.kind==='Add'?'Add':'Remove'}: ${esc(c.kind==='Add'?c.proposed_title:c.item_title)} <small>requested by ${esc(c.requested_by_name||'')} on ${esc(day(c.requested_at))}: ${esc(c.reason)}</small>${c.decided_by_name?` <small>${esc(c.status)} by ${esc(c.decided_by_name)}: ${esc(c.decision_note)}</small>`:''}${partner&&c.status==='Requested'&&c.requested_by!==me.staff_id?button('aup-change-decide','Decide',c.change_id):''}</li>`).join('')}</ul>`:'<p class="muted">None.</p>'}${leader&&scope.state==='Locked'?`<p>${button('aup-change-add','Ask to add a procedure',pr.project_id)}</p>`:''}<p class="muted">A Manager or Partner asks; a Partner who did not ask decides. Approval applies the change.</p></details>`;
  if(scope.state==='Issued')html+=`<p class="ok full" id="aupIssued">Report issued ${esc(day(scope.report_issued_at))} by ${esc(scope.issued_by_name||'a Partner')}. Report hash ${esc(String(scope.report_sha256||'').slice(0,12))}…</p>`;
  html+=`<div class="actions full">${button('aup-report','View the report of factual findings',pr.project_id)}${partner&&scope.state==='Locked'?button('aup-issue','Issue the report',pr.project_id):''}</div>`;
 }
 return html+libraryBlock({r,leader,partner,button});
}
function libraryBlock({r,leader,partner,button}){
 const lib=r.library||[];
 return `<details class="full"><summary>Library of suggested procedures (${lib.length})</summary><ul>${lib.map(l=>`<li><b>${esc(l.code)}</b> ${esc(l.title)} <small>${l.rule_status==='Confirmed'?'Confirmed by the Compliance Lead, recorded by a Partner':'Suggested, not yet confirmed'}</small>${partner&&l.rule_status==='Suggested'?' '+button('aup-lib-confirm','Record confirmation',l.library_id):''}${partner?' '+button('aup-lib-retire','Retire',l.library_id):''}</li>`).join('')||'<li>None.</li>'}</ul>${leader?`<p>${button('aup-lib-add','+ Add a suggested procedure',r.project.project_id)}</p>`:''}</details>`;
}
export function reportView(rep,{sha,state}={}){
 if(!rep)return '<p class="muted">No report is available.</p>';
 const std=rep.standard?.text||'[STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]';
 return `<div class="info full" id="aupReport"><h3>Report of factual findings</h3><p><b>${esc(rep.client)}</b>${rep.client_pin?` (${esc(rep.client_pin)})`:''} · ${esc(rep.service)} · ${esc(rep.firm)}</p>`
  +`<p>Engagement letter: ${esc(rep.letter_file||'not recorded')}${rep.letter_reference?` (${esc(rep.letter_reference)})`:''}. Standard: ${esc(std)}</p>`
  +`<ol>${(rep.procedures||[]).map(p=>`<li><b>${esc(p.title)}</b> · ${esc(p.status)}<br>${esc(p.finding||'')}<br><small>${p.performed_by?`Performed by ${esc(p.performed_by)} on ${esc(day(p.performed_on))}. `:''}${p.reviewed_by?`Reviewed by ${esc(p.reviewed_by)}. `:''}Evidence: ${(p.evidence||[]).length?(p.evidence||[]).map(esc).join('; '):'none'}</small></li>`).join('')}</ol>`
  +((rep.scope_changes||[]).length?`<p><b>Changes to the agreed procedures:</b> ${(rep.scope_changes||[]).map(c=>`${esc(c.kind)} ${esc(c.title)} (${esc(c.reason)})`).join('; ')}</p>`:'')
  +`<p>${esc(rep.statement)}</p><p class="muted">${state==='Issued'?`Issued report. Hash ${esc(String(sha||'').slice(0,12))}…`:'Preview. The wording is a default that no Partner has confirmed.'}</p></div>`;
}

export function createAupUI(ctx){
 const {$,esc:_e,field,select,form,modal,request,button,area,check}=ctx,d=()=>ctx.data();
 let cur=null;
 const show=async pid=>{cur=await request({action:'aup_read',project_id:pid});modal('Procedures · '+cur.project.project_name,aupView({r:cur,me:d().me,button}));};
 // A ticked box is sent as true and an unticked box as false (a missing field would otherwise be read as the default).
 const send=(title,body,action,extra,label='Save',guard)=>modal(title,form(body,label),f=>{
  if(guard)guard(f);const o=Object.fromEntries(f),fm=$('#editForm');
  if(fm?.elements.evidence_required)o.evidence_required=f.has('evidence_required');
  if(fm?.elements.in_template)o.in_template=f.has('in_template');
  delete o.confirmed;
  return request({action,project_id:cur.project.project_id,...extra,...o});
 },()=>show(cur.project.project_id));
 const docOptions=()=>(cur.documents||[]).map(x=>[x.document_id,`${x.file_name} · ${x.category}`]);
 const wording=(i={})=>field('title','Procedure *',i.title||'','text','required minlength="5" maxlength="200"')+area('description','What the procedure does *',i.description||'',true)+check('evidence_required','Evidence is required before the result is recorded',i.evidence_required!==false);
 const item=id=>(cur.items||[]).find(x=>x.item_id===id);
 async function handle(action,id){
  if(!action.startsWith('aup-'))return false;
  const pid=cur?.project?.project_id||id;
  if(action==='aup-open'){await show(id);return true;}
  if(action==='aup-start'||action==='aup-start-empty'){await request({action:'aup_scope_start',project_id:id,use_template:action==='aup-start'});await show(id);return true;}
  if(action==='aup-template'){await request({action:'aup_scope_template',project_id:pid});await show(pid);return true;}
  if(action==='aup-item-library'){send('Add from the library',select('library_id','Procedure',(cur.library||[]).map(l=>[l.library_id,`${l.code} · ${l.title}`]),'')+'<p class="info full">The library wording is copied into the scope; you can edit it while the scope is a draft.</p>','aup_item_add',{});return true;}
  if(action==='aup-item-custom'){send('Add a custom procedure',wording(),'aup_item_add',{});return true;}
  if(action==='aup-item-edit'){const i=item(id);if(!i)return true;send('Edit procedure '+i.seq,wording(i),'aup_item_edit',{item_id:id,revision:i.revision});return true;}
  if(action==='aup-item-remove'){const i=item(id);if(!i)return true;send('Remove procedure '+i.seq,area('reason','Why it is removed *','',true)+'<p class="info full">The procedure stays on the record as removed; nothing is deleted.</p>','aup_item_remove',{item_id:id,revision:i.revision},'Remove');return true;}
  if(action==='aup-lock'){send('Lock the scope',field('letter_reference','Where the procedures are listed in the signed engagement letter *','','text','required maxlength="300" placeholder="For example Schedule 1, or clause 4"')+'<p class="info full">Locking records the verified signed letter, the time, and a hash of the procedure list. After this, procedures can be added or removed only through a scope change that a Partner approves.</p>','aup_scope_lock',{revision:cur.scope.revision},'Lock the scope');return true;}
  if(action==='aup-perform'){const i=item(id);if(!i)return true;send('Record result · '+i.title,select('exec_status','Status',['In progress','Completed','Exception','Not applicable'],i.exec_status==='Not started'?'In progress':i.exec_status)+area('finding','Factual finding (required for Completed; at least 10 characters for Exception or Not applicable)',i.finding||'')+(i.evidence_required?'<p class="info full">Evidence is required: attach a document before recording Completed or Exception.</p>':''),'aup_item_perform',{item_id:id,revision:i.revision});return true;}
  if(action==='aup-evidence'){const i=item(id);if(!i)return true;send('Attach evidence · '+i.title,select('document_id','Document filed on this project',docOptions(),'')+field('note','Note')+'<p class="muted full">Upload the document to the project first if it is not listed.</p>','aup_evidence_add',{item_id:id});return true;}
  if(action==='aup-evidence-remove'){const e=(cur.items||[]).flatMap(i=>i.evidence||[]).find(x=>x.evidence_id===id);if(!e)return true;await request({action:'aup_evidence_remove',project_id:pid,evidence_id:id,revision:e.revision});await show(pid);return true;}
  if(action==='aup-review'){const i=item(id);if(!i)return true;await request({action:'aup_item_review',project_id:pid,item_id:id,revision:i.revision});await show(pid);return true;}
  if(action==='aup-change-add'){send('Ask to add a procedure',select('library_id','From the library (or leave blank to write your own)',(cur.library||[]).map(l=>[l.library_id,`${l.code} · ${l.title}`]),'')+field('title','Procedure title (if not from the library)')+area('description','What it does (if not from the library)')+check('evidence_required','Evidence is required',true)+area('reason','Why the scope should change * (refer to the client\'s written request or the amended letter)','',true)+select('supporting_document_id','Supporting document (optional)',docOptions(),''),'aup_change_request',{kind:'Add'},'Send for approval');return true;}
  if(action==='aup-change-remove'){const i=item(id);if(!i)return true;send('Ask to remove · '+i.title,area('reason','Why it should be removed *','',true)+select('supporting_document_id','Supporting document (optional)',docOptions(),''),'aup_change_request',{kind:'Remove',item_id:id},'Send for approval');return true;}
  if(action==='aup-change-decide'){const c=(cur.changes||[]).find(x=>x.change_id===id);if(!c)return true;send('Decide the scope change',`<p class="full"><b>${esc(c.kind)}:</b> ${esc(c.kind==='Add'?c.proposed_title:c.item_title)}<br>${esc(c.reason)}</p>`+select('decision','Decision',['Approved','Rejected'],'Approved')+area('decision_note','Reason for the decision * (at least 10 characters)','',true),'aup_change_decide',{change_id:id,revision:c.revision},'Record decision');return true;}
  if(action==='aup-report'){const x=await request({action:'aup_report',project_id:pid});modal('Report of factual findings',reportView(x.report,{sha:x.report_sha256,state:x.state}));return true;}
  if(action==='aup-issue'){send('Issue the report',check('confirmed','I have read the report preview and every result has been reviewed',false)+'<p class="info full">Issuing stores the report as it is now, with a hash. The scope is then closed. The standard reference reads pending until the Compliance Lead\'s confirmation is recorded.</p>','aup_report_issue',{revision:cur.scope.revision},'Issue the report',f=>{if(!f.has('confirmed'))throw Error('Tick the box to confirm you have read the report preview.');});return true;}
  if(action==='aup-lib-add'){send('Add a suggested procedure',field('code','Code *','','text','required maxlength="10" placeholder="KRA-11"')+wording()+select('area','Area',['Tax','Payroll','Bank','Sales','Purchases','Ledger','Documents','General'],'General')+select('applies_to','Applies to',['Both','ADV-AUP','TAX-KRA'],'Both')+check('in_template','Include in the template',false)+'<p class="info full">It starts as Suggested. Record the Compliance Lead\'s written confirmation separately.</p>','aup_library_add',{});return true;}
  if(action==='aup-lib-confirm'){const l=(cur.library||[]).find(x=>x.library_id===id);if(!l)return true;send('Record confirmation',area('source_note','Where the Compliance Lead confirmed this in writing, for example a memo and its date * (at least 10 characters)','',true)+'<p class="info full">You are recording a confirmation made by the Compliance Lead; you are not making it yourself.</p>','aup_library_confirm',{library_id:id,rule_status:'Confirmed',revision:l.revision});return true;}
  if(action==='aup-lib-retire'){const l=(cur.library||[]).find(x=>x.library_id===id);if(!l)return true;send('Retire this procedure',area('source_note','Why it is retired * (at least 10 characters)','',true),'aup_library_confirm',{library_id:id,rule_status:'Retired',revision:l.revision},'Retire');return true;}
  return false;
 }
 return {handle,open:show};
}
