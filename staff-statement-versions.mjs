// Statement versions (builds 2825 and 2826): Draft, Audit/Review Adjusted and Final Signed versions of one financial year's statements, each a locked snapshot,
// with links to the audit file, adjustment journals and KRA notice records. The server owns every rule; this file draws what it returns.
export function createStatementVersionsUI(ctx,{payload,show,onChange}){
 const {esc,field,select,form,request,notice,shortDate}=ctx;
 const KIND_HELP={'Draft':'Prepared from the client ledger. A Manager or Partner locks it.','Audit/Review Adjusted':'After the audit or review adjustments are posted. Needs its adjustment journals (or a statement that there were none) and the audit file or review engagement.','Final Signed':'As signed. A Partner locks it; it needs an approved audit file or a review engagement.'};
 const num=v=>v==null?'':Number(v).toLocaleString('en-KE',{maximumFractionDigits:2});
 const btn=(a,l,id='',extra='')=>`<button type="button" data-fsver="${a}" data-id="${esc(id)}" ${extra}>${esc(l)}</button>`;
 let data=null;
 async function open(){
  data=await request(payload('ledger_fsver_read'));
  const rows=data.versions;
  const step=data.next_steps.map(s=>`<li><b>${esc(s.kind)}</b>: ${esc(s.note)} ${btn('prepare','Prepare',s.kind,s.allowed?'':'disabled')}</li>`).join('');
  const card=v=>{
   const links=v.links.filter(l=>!l.ended_at);
   const linkText=l=>l.link_kind==='Audit file'?`Audit file (${esc(l.audit_file_status)}, ${esc(l.reporting_framework)})`:l.link_kind==='Adjustment journal'?`Journal ${esc(l.journal_reference)} (${esc(l.journal_date)})`:l.link_kind==='KRA notice'?`KRA notice ${esc(l.notice_reference)}: ${esc(l.notice_type)}, dated ${esc(l.notice_date)}, deadline ${esc(l.deadline_date)}, ${esc(l.notice_status)}`:`Review engagement: ${esc(l.review_project_name)}`;
   return `<section class="card section-space"><h4>${esc(v.kind)} · version ${v.seq} <span class="badge ${v.current&&!v.stale?(v.status==='Locked'?'good':'warn'):'red'}">${esc(v.state)}</span></h4>
    <p class="muted">As of ${esc(shortDate(v.as_of))} · prepared by ${esc(v.prepared_by_name)}${v.locked_by_name?` · locked by ${esc(v.locked_by_name)} on ${esc(shortDate(v.locked_at))}`:''} · digest ${esc(String(v.snapshot_digest).slice(0,12))}…</p>
    <p>${esc(v.basis_note)}${v.supersede_reason?`<br><small>Replaces version ${v.seq-1}: ${esc(v.supersede_reason)}</small>`:''}${v.no_adjustments?'<br><small>Recorded: there were no adjustments.</small>':''}${v.signer_name?`<br><small>Signed by ${esc(v.signer_name)} on ${esc(shortDate(v.signed_on))}, report ${esc(v.report_reference)}.</small>`:''}</p>
    ${v.kind!=='Draft'?(links.length?`<ul>${links.map(l=>`<li>${linkText(l)} ${v.status==='Prepared'?btn('unlink','End',l.link_id+'|'+v.version_id):''}</li>`).join('')}</ul>`:'<p class="missing">No links yet.</p>'):(links.length?`<ul>${links.map(l=>`<li>${linkText(l)}</li>`).join('')}</ul>`:'')}
    ${v.changes_from_base.length?`<details><summary>${v.changes_from_base.length} ${v.changes_from_base.length===1?'line differs':'lines differ'} from the version it was built on</summary><div class="scroll"><table><thead><tr><th>Statement</th><th>Line</th><th>Before</th><th>After</th></tr></thead><tbody>${v.changes_from_base.map(c=>`<tr><td>${esc(c.statement)}</td><td>${esc(c.label)}</td><td>${num(c.before)}</td><td>${num(c.after)}</td></tr>`).join('')}</tbody></table></div></details>`:''}
    <div class="actions">${v.current&&v.status==='Prepared'?btn('lock','Lock this version',v.version_id):''}${v.current&&(v.status==='Prepared'||v.kind!=='Draft')?btn('link','Link a record',v.version_id):''}</div></section>`;};
  show('Statement versions · '+esc(shortDate(data.period.starts_on))+' to '+esc(shortDate(data.period.ends_on)),
   `<p class="info full">Each version is a locked snapshot of the annual statements. A later version is built only on a locked earlier one. A correction is a new numbered version that replaces the old one with a reason; nothing is overwritten.</p><ul>${step}</ul>`+(rows.length?rows.slice().sort((a,b)=>a.kind.localeCompare(b.kind)||b.seq-a.seq).map(card).join(''):'<p class="muted">No versions yet.</p>'));
 }
 function prepare(kind){
  const latest=data.versions.filter(v=>v.kind===kind).sort((a,b)=>b.seq-a.seq)[0];
  show('Prepare the '+esc(kind)+' version',form(`<p class="full">${esc(KIND_HELP[kind])} The statements are captured as they are now.</p>`
   +field('basis_note',kind==='Draft'?'What is this prepared from? *':kind==='Final Signed'?'What is the signed version based on? *':'What are the adjustments? *','','text','required minlength="10" maxlength="1000"')
   +(kind==='Audit/Review Adjusted'?`<label class="full"><input type="checkbox" name="no_adjustments"> There were no adjustments</label>`:'')
   +(kind==='Final Signed'?field('signer_name','Signed by *','','text','required maxlength="160"')+field('signed_on','Date signed *','','date','required')+field('report_reference','Report reference *','','text','required maxlength="200"'):'')
   +(latest?field('supersede_reason','Why does this replace version '+latest.seq+'? *','','text','required minlength="10" maxlength="500"'):''),'Prepare version'),
   f=>request({...payload('ledger_fsver_prepare'),kind,basis_note:f.get('basis_note'),no_adjustments:f.has('no_adjustments'),signer_name:f.get('signer_name'),signed_on:f.get('signed_on'),report_reference:f.get('report_reference'),supersede_reason:f.get('supersede_reason')}),
   async()=>{notice('Version prepared. A different Manager or Partner locks it.');await open();onChange?.();});
 }
 function link(versionId){
  const v=data.versions.find(x=>x.version_id===versionId),c=data.candidates;
  const kinds=[...(v.kind==='Draft'?[]:['Audit file','Review engagement']),...(v.kind==='Audit/Review Adjusted'?['Adjustment journal']:[]),'KRA notice'].filter(k=>v.status==='Prepared'||k==='KRA notice');
  const opt=k=>k==='Audit file'?c.audit_files.map(x=>[x.audit_file_id,`${x.file_status} · ${x.reporting_framework} · ${x.starts_on} to ${x.ends_on}`]):k==='Adjustment journal'?c.journals.map(x=>[x.journal_id,`${x.reference} · ${x.journal_date} · ${x.kind}`]):k==='KRA notice'?c.kra_cases.map(x=>[x.case_id,`${x.notice_reference} · ${x.notice_type} · dated ${x.notice_date} · deadline ${x.deadline_date} · ${x.status}`]):c.engagements.map(x=>[x.project_id,`${x.project_name} (${x.service_code})`]);
  show('Link a record',form(`<p class="full">${esc(v.kind)} · version ${v.seq}. ${v.status==='Locked'?'Only KRA notices can be noted against a locked version.':'Links are checked against this client and financial year.'}</p>`
   +select('link_kind','What kind of record? *',kinds.map(k=>[k,k]),kinds[0])+`<div class="full" id="fsverTargets"></div>`+field('note','Note','','text','maxlength="500"'),'Link'),
   f=>request({...payload('ledger_fsver_link'),version_id:versionId,link_kind:f.get('link_kind'),target_id:f.get('target_id_'+f.get('link_kind').replace(/\W/g,'')),note:f.get('note')}),
   async()=>{notice('Linked.');await open();});
  const holder=document.querySelector('#fsverTargets');
  if(holder)holder.innerHTML=kinds.map(k=>{const o=opt(k);return `<label class="full" data-fsver-for="${esc(k)}">${esc(k)}<select name="target_id_${k.replace(/\W/g,'')}"><option value="">${o.length?'Choose…':'None available'}</option>${o.map(([id,l])=>`<option value="${esc(id)}">${esc(l)}</option>`).join('')}</select></label>`;}).join('');
 }
 const handlers={
  prepare:id=>prepare(id),link:id=>link(id),
  async lock(id){await request({...payload('ledger_fsver_lock'),version_id:id});notice('Version locked.');await open();onChange?.();},
  unlink(id){const [linkId,versionId]=id.split('|');show('End this link',form('<label class="full">Why is this link ended? * <textarea name="reason" required minlength="10" maxlength="500"></textarea></label>','End link'),f=>request({...payload('ledger_fsver_unlink'),version_id:versionId,link_id:linkId,reason:f.get('reason')}),async()=>{notice('Link ended.');await open();});}
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-fsver]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.fsver]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
