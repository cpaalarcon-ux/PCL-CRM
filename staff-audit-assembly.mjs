// Audit build S8: assembly lock, late changes and milestones with compare.
// The server decides what is locked and enforces it; this module shows the state and collects input.
// No retention period and no deadline is fixed here. The deadline lock is off until a Partner confirms the days, what they run from, and switches it on.
export const MANUAL_KINDS=['Planning complete','Fieldwork complete','Draft report issued','Other'];
export const POLICY_LABELS={AUDIT_FILE_LOCK_DAYS:'Days after the anchor date until the file locks',AUDIT_FILE_LOCK_ANCHOR:'What the lock days run from',AUDIT_DEADLINE_LOCK_ENFORCED:'Lock a file when its deadline passes'};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
export const anchorText=v=>v==='YEAR_END'?'the financial year end':v==='REPORT_DATE'?'the audit report date':'(not set)';
export const policyValueText=(key,v)=>key==='AUDIT_FILE_LOCK_ANCHOR'?anchorText(v):key==='AUDIT_DEADLINE_LOCK_ENFORCED'?(v==='true'?'On':'Off'):key==='AUDIT_FILE_LOCK_DAYS'?`${v} days`:String(v??'');
// The state the badge shows for a file.
export function lockState(w){
 const l=w?.lock;if(!l)return {label:'Unknown',tone:''};
 if(l.amendment_open)return {label:'Late change open',tone:'warn'};
 if(l.locked)return {label:l.locked_by==='Assembly complete'?'Locked: assembly complete':'Locked: deadline passed',tone:'ok'};
 return {label:'Open for work',tone:''};
}
// ---- The comparison, as a table of what changed -----------------------------------------------------------------------------------------
export function compareView(c){
 if(!c)return '';
 const rows=(c.components||[]).filter(x=>x.changed);
 const list=(label,arr,n)=>n?`<div><b>${label} (${n})</b>: ${(arr||[]).map(esc).join(', ')}${n>(arr||[]).length?', …':''}</div>`:'';
 return `<p class="muted">From <b>${esc(c.a?.label)}</b>${c.a?.taken_at?' · '+esc(String(c.a.taken_at).slice(0,10)):''} to <b>${esc(c.b?.label)}</b>${c.b?.milestone_id?(c.b.taken_at?' · '+esc(String(c.b.taken_at).slice(0,10)):''):''}</p>
  ${c.same?'<p class="info">Nothing on the file differs between the two.</p>':`<div class="scroll"><table><thead><tr><th>Part of the file</th><th>Before</th><th>After</th><th>What changed</th></tr></thead><tbody>${rows.map(x=>`<tr><td><b>${esc(x.title)}</b></td><td>${x.before}</td><td>${x.after}</td><td>${list('Added',x.added,x.n_added)}${list('Removed',x.removed,x.n_removed)}${list('Changed',x.edited,x.n_edited)}${!x.n_added&&!x.n_removed&&!x.n_edited?'<small>Records changed (not itemised for this part)</small>':''}</td></tr>`).join('')}</tbody></table></div>`}`;
}

export function createAssemblyUI(ctx){
 const {field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const textArea=(name,label,value='',max=1500,req=true)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${req?'required':''}>${esc(value||'')}</textarea></label>`;

 function lockCard(w,role,file){
  const l=w.lock||{},st=lockState(w),me=staff().staff_id;
  const open=(w.amendments||[]).find(x=>x.status==='Open');
  const sealable=role==='PARTNER'&&file?.file_status==='Completion'&&!l.sealed;
  return `<section class="card"><div class="section-head"><div><h3>Assembly and lock</h3><p class="muted">Assembling the file means finishing it and recording that nothing is outstanding. A Partner records that assembly is complete; from then the records on the file cannot change unless a Partner opens a late change, which is reviewed and closed by someone else. Archiving needs assembly recorded as complete.</p></div><div>${badge(st.label,st.tone)}</div></div>
   ${l.sealed&&w.seal?`<p>Assembly recorded complete by <b>${esc(w.seal.sealed_by_name)}</b>${w.seal.sealed_at?' on '+esc(shortDate(w.seal.sealed_at)):''}: ${esc(w.seal.note)}</p>
    ${w.seal_check?(w.seal_check.same?'<p class="info">Nothing on the file has changed since assembly.</p>':`<div class="audit-note warn"><b>The file differs from the way it was when assembly was recorded</b><ul>${(w.seal_check.changed||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul><small>Late changes explain these. Compare the milestones below for the detail.</small></div>`):''}`
    :`<p class="muted">Assembly has not been recorded as complete.${file?.file_status==='Completion'?'':' The file must be in completion first.'}</p>`}
   <p class="muted">Deadline: ${l.deadline?`<b>${esc(l.deadline)}</b> (${esc(l.days)} days after ${esc(anchorText(l.anchor))}${l.anchor_date?', '+esc(l.anchor_date):''})`:'not known yet: the audit report date is not set'}. ${l.enforced?(l.past_deadline?'The deadline has passed, so the file is locked.':'The file locks the day after the deadline.'):`<span>The deadline lock is not in force: ${esc(l.not_enforced_because||'')}</span>`}</p>
   ${open?`<div class="audit-note warn"><b>Late change ${esc(open.seq)} is open</b> · opened by ${esc(open.opened_by_name)}${open.opened_at?' on '+esc(shortDate(open.opened_at)):''}<br>${esc(open.reason)}<small>Someone other than ${esc(open.opened_by_name)} reviews it and closes it.</small></div>`:''}
   <div class="actions">${sealable?'<button class="primary" data-asm-seal>Record that assembly is complete</button>':''}${role==='PARTNER'&&l.locked&&file?.file_status!=='Archived'?'<button data-asm-amend-open>Open a late change</button>':''}${open&&['MANAGER','PARTNER'].includes(role)&&open.opened_by!==me?'<button class="primary" data-asm-amend-close>Review and close the late change</button>':''}</div>
   ${(w.archive_issues||[]).length&&file?.file_status!=='Archived'?`<div class="audit-note"><b>What stops the file being archived</b><ul>${w.archive_issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}</section>`;
 }
 function policyCard(w,role){
  const pol=w.policy||[];
  return `<section class="card section-space"><div class="section-head"><div><h3>Lock settings</h3><p class="muted">These are firm settings, set by a Partner. Nothing locks on a deadline until the days and what they run from have each been confirmed and the deadline lock is switched on. Assembly recorded by a Partner always locks the file. No retention period is set here.</p></div></div>
   <div class="scroll"><table><thead><tr><th>Setting</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${pol.map(x=>`<tr><td>${esc(POLICY_LABELS[x.key]||x.key)}</td><td><b>${esc(policyValueText(x.key,x.value))}</b></td><td>${x.confirmed?badge('Confirmed by '+(x.confirmed_by_name||'a Partner'),'ok'):badge('Default, not yet confirmed by a Partner','warn')}</td><td>${role==='PARTNER'?`<button data-asm-policy="${esc(x.key)}">Change</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>`;
 }
 function milestoneCard(w,role){
  const ms=w.milestones||[],leader=['MANAGER','PARTNER'].includes(role);
  return `<section class="card section-space"><div class="section-head"><div><h3>Milestones</h3><p class="muted">A saved, unchangeable picture of the file at a point in time. The file takes one when it is sent for review, approved, completed, sealed and archived. A Manager or Partner can take others. Compare any two, or a milestone with the file as it is now, to see what was added, removed or changed.</p></div><div class="actions">${leader?'<button data-asm-milestone-new>Take a milestone</button>':''}</div></div>
   ${ms.length?`<div class="scroll"><table><thead><tr><th>#</th><th>Milestone</th><th>File status</th><th>Taken</th><th>Fingerprint</th></tr></thead><tbody>${ms.map(m=>`<tr><td>${m.seq}</td><td><b>${esc(m.label)}</b><small>${esc(m.kind)}${m.note?' · '+esc(m.note):''}</small></td><td>${esc(m.file_status)}</td><td>${esc(shortDate(m.taken_at))}<small>${esc(m.taken_by_name)}</small></td><td><code>${esc(m.fingerprint)}</code></td></tr>`).join('')}</tbody></table></div>
    <div class="actions"><label>Compare <select id="asmA">${ms.map(m=>`<option value="${esc(m.milestone_id)}">${m.seq}. ${esc(m.label)}</option>`).join('')}</select></label>
     <label>with <select id="asmB"><option value="">The file as it is now</option>${ms.map(m=>`<option value="${esc(m.milestone_id)}">${m.seq}. ${esc(m.label)}</option>`).join('')}</select></label>
     <button data-asm-compare>Compare</button></div>`:'<p class="muted">No milestone yet.</p>'}</section>`;
 }
 function amendCard(w){
  const am=w.amendments||[];
  if(!am.length)return '';
  return `<section class="card section-space"><div class="section-head"><div><h3>Late changes</h3><p class="muted">Every change made after the file locked: who opened it and why, who reviewed it, and what differed between the milestone before and the milestone after.</p></div></div>
   ${am.map(a=>`<article class="card section-space"><div class="section-head"><div><h4>Late change ${esc(a.seq)}</h4><small>Opened by ${esc(a.opened_by_name)} on ${esc(shortDate(a.opened_at))}</small></div><div>${badge(a.status,a.status==='Closed'?'ok':'warn')}</div></div>
    <p>${esc(a.reason)}</p>${a.status==='Closed'?`<p class="muted">Reviewed and closed by ${esc(a.closed_by_name)} on ${esc(shortDate(a.closed_at))}: ${esc(a.close_note)}</p>${(a.changes||[]).length?`<ul>${a.changes.map(x=>`<li><b>${esc(x.title)}</b>: ${x.before} → ${x.after}${x.n_added?' · added '+x.added.map(esc).join(', '):''}${x.n_removed?' · removed '+x.removed.map(esc).join(', '):''}${x.n_edited?' · changed '+x.edited.map(esc).join(', '):''}</li>`).join('')}</ul>`:'<p class="info">No record on the file differed between the two milestones.</p>'}`:''}</article>`).join('')}</section>`;
 }

 function panel(file,s){
  const w=s?.assembly;
  if(!w)return '<section class="card"><h3>Assembly and milestones</h3><p class="muted">This tab shows once an audit file is open.</p></section>';
  const role=staff().category_code;
  return `${lockCard(w,role,file)}${milestoneCard(w,role)}${amendCard(w)}${policyCard(w,role)}`;
 }

 async function handle(b,file){
  const s=ctx.snapshot(),w=s?.assembly;
  const has=a=>b.hasAttribute&&b.hasAttribute(a);
  if(!w||!file)return false;
  if(has('data-asm-milestone-new')){
   modal('Take a milestone',form(select('kind','Which milestone? *',MANUAL_KINDS,'Planning complete')+field('label','Name *','','text','required minlength="3" maxlength="120"')+textArea('note','Note (optional)','',1000,false)+'<p class="info full">This saves a picture of every record on the file as it is now. It does not change the file.</p>','Take milestone'),
    f=>request({action:'audit_assembly_milestone_take',audit_file_id:file.audit_file_id,kind:f.get('kind'),label:f.get('label'),note:f.get('note')||''}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-asm-compare')){
   const a=document.querySelector('#asmA')?.value,bb=document.querySelector('#asmB')?.value||null;
   if(!a){notice('Choose a milestone to compare from.',true);return true;}
   try{const c=await request({action:'audit_assembly_compare',audit_file_id:file.audit_file_id,a,b:bb});modal('What changed',compareView(c));}catch(e){notice(e.message||'That did not work.',true);}
   return true;}
  if(has('data-asm-seal')){
   modal('Partner · record that assembly is complete',form(`<p class="full">Confirm that every record that belongs on the file is on it and nothing is outstanding. From now on the records cannot change unless you open a late change. The audit report date must be set.</p>`+textArea('note','What did you check? (at least 10 characters) *','',1000),'Record assembly complete'),
    f=>request({action:'audit_assembly_seal',audit_file_id:file.audit_file_id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-asm-amend-open')){
   modal('Partner · open a late change',form(`<p class="full">The file will unlock so that the work can be done on it. Everything changed is compared afterwards, and someone other than you reviews it and closes it.</p>`+textArea('reason','Why must the file change? (at least 20 characters) *','',1000),'Open late change'),
    f=>request({action:'audit_amend_open',audit_file_id:file.audit_file_id,reason:f.get('reason')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-asm-amend-close')){
   modal('Review and close the late change',form(`<p class="full">Closing locks the file again and saves what changed. Look at the comparison on the milestones first.</p>`+textArea('note','What did you review, and what do you conclude? (at least 20 characters) *','',1000),'Close late change'),
    f=>request({action:'audit_amend_close',audit_file_id:file.audit_file_id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.asmPolicy){
   const key=b.dataset.asmPolicy,x=(w.policy||[]).find(p=>p.key===key);if(!x)return true;
   const input=key==='AUDIT_FILE_LOCK_DAYS'?field('value','Days (1 to 365) *',x.value,'text','required inputmode="numeric"')
    :key==='AUDIT_FILE_LOCK_ANCHOR'?select('value','Runs from *',[['REPORT_DATE','The audit report date'],['YEAR_END','The financial year end']],x.value)
    :select('value','Lock files after the deadline? *',[['true','Yes'],['false','No']],x.value);
   modal('Partner · '+(POLICY_LABELS[key]||key),form(input+textArea('note','Why? (at least 10 characters) *','',1000),'Save setting'),
    f=>request({action:'audit_policy_save',key,value:f.get('value'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  return false;
 }
 return {panel,handle};
}
