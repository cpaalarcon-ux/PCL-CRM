// Per-document review state, time-limited access grants and the malware-scan request on the Documents screen.
// The rules live in the database (20261110275000_document_review.sql); this file draws the screens and hides buttons the server would refuse.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
const when=v=>v?new Date(v).toLocaleString('en-KE',{timeZone:'Africa/Nairobi',dateStyle:'medium',timeStyle:'short'}):'';
export const STATE_TEXT={NOT_REVIEWED:'Not reviewed',APPROVED:'Approved',CHANGES_REQUESTED:'Changes requested',REJECTED:'Rejected'};
export const SCAN_TEXT={PENDING_MANUAL_REVIEW:'Scan pending manual review'};
export const DECISION_OPTIONS=[['APPROVED','Approve this file'],['CHANGES_REQUESTED','Ask for changes'],['REJECTED','Reject this file']];
const stateClass=s=>s==='APPROVED'?'ok':s==='NOT_REVIEWED'?'muted':'warn';
export const stateBadge=(s,reviewer)=>`<span class="badge ${stateClass(s)}">${esc(STATE_TEXT[s]||s)}</span>${reviewer&&s!=='NOT_REVIEWED'?`<small class="muted"> by ${esc(reviewer)}</small>`:''}`;

// The review screen for one document.
export function reviewView({r,me,button}){
 const d=r.document,rows=r.reviews.map(x=>`<tr><td>${esc(when(x.reviewed_at))}</td><td>${esc(x.reviewer)}</td><td>${esc(STATE_TEXT[x.decision]||x.decision)}${x.current_file?'':'<small class="muted"> an earlier file</small>'}</td><td>${esc(x.comment)}</td></tr>`).join('');
 const grants=r.can.grant?`<h3 class="section-space">Time-limited access</h3><p class="muted">Gives one colleague access to this single document for up to 30 days. It does not open the client or project, and a Restricted file stays closed to people who may not see it. Partners are told when access is given.</p>${r.grants.length?`<div class="scroll"><table><thead><tr><th>Person</th><th>Until</th><th>Why</th><th>Given by</th><th></th></tr></thead><tbody>${r.grants.map(g=>`<tr><td>${esc(g.grantee)}</td><td>${esc(when(g.expires_at))}</td><td>${esc(g.reason)}${g.revoked_at?`<small>Withdrawn ${esc(day(g.revoked_at))}: ${esc(g.revoke_reason)}</small>`:''}</td><td>${esc(g.granted_by)}</td><td>${g.revoked_at?'Withdrawn':new Date(g.expires_at)<new Date()?'Expired':button('docrev-revoke','Withdraw',g.grant_id)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No one has been given extra access to this document.</p>'}<div class="actions">${button('docrev-grant','Give access…',d.document_id)}</div>`:'';
 const scans=r.scans.length?r.scans.map(s=>`<li>${esc(when(s.requested_at))}: ${esc(SCAN_TEXT[s.status]||s.status)}${s.current_file?'':' (an earlier file)'}</li>`).join(''):'<li class="muted">No scan requested.</li>';
 return `<div class="detail-grid"><div><b>${esc(d.file_name)}</b><small>${esc(d.category)} · version ${esc(d.version)} · uploaded by ${esc(d.uploader||'—')} on ${esc(day(d.uploaded_at))}</small><small class="muted">File fingerprint ${esc(d.sha256.slice(0,16))}… A review applies to this exact file only; a new version starts as not reviewed.</small></div><div>Review state: ${stateBadge(r.state,r.reviews.find(x=>x.current_file)?.reviewer)}</div></div>
 <div class="actions">${r.can.review?button('docrev-decide','Record a review decision',d.document_id):d.uploaded_by===me.staff_id?'<small class="muted">You uploaded this file, so a colleague must review it.</small>':''}${r.can.scan?button('docrev-scan','Request malware scan',d.document_id):''}</div>
 <h3 class="section-space">Review history</h3>${rows?`<div class="scroll"><table><thead><tr><th>When</th><th>Reviewer</th><th>Decision</th><th>Comment</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">Nobody has reviewed this file yet.</p>'}
 <h3 class="section-space">Malware scan</h3><ul>${scans}</ul><small class="muted">No scanning service is connected yet; requests are queued for manual review.</small>${grants}`;
}

// "Shared with me": documents opened to this person by a Manager or Partner for a limited time.
export function grantsCardView({grants,button}){
 if(!grants.length)return '';
 return `<div class="card"><div class="section-head"><h2>Shared with you for a limited time</h2></div><div class="scroll"><table><thead><tr><th>File</th><th>Why</th><th>Given by</th><th>Access ends</th><th></th></tr></thead><tbody>${grants.map(g=>`<tr><td>${esc(g.file_name)}<small>${esc(g.category)}</small></td><td>${esc(g.reason)}</td><td>${esc(g.granted_by_name)}</td><td>${esc(when(g.expires_at))}</td><td><button data-download="${esc(g.document_id)}">Download</button></td></tr>`).join('')}</tbody></table></div></div>`;
}

export function createDocumentReviewUI(ctx){
 const {$,field,select,form,modal,request,button,area}=ctx,d=()=>ctx.data();
 let cur=null;
 const usesReview=()=>!['INTERN','ADMIN'].includes(d().me.category_code);
 const show=async id=>{const r=await request({action:'document_review_list',document_id:id});cur=r;modal('Document review',reviewView({r,me:d().me,button}));};
 // After the documents screen is drawn: fill in the review badge on each row and the "shared with you" card.
 async function paintStates(){
  if(!usesReview())return;
  const spans=[...document.querySelectorAll('[data-review-state]')];
  if(spans.length){try{const r=await request({action:'document_review_states',document_ids:spans.map(s=>s.dataset.reviewState)});const by=new Map(r.states.map(s=>[s.document_id,s]));for(const s of spans){const x=by.get(s.dataset.reviewState);if(x)s.innerHTML=stateBadge(x.state,x.reviewer)+(x.scan_status?`<small class="muted">${esc(SCAN_TEXT[x.scan_status]||x.scan_status)}</small>`:'');}}catch{}}
  const host=$('#docGrantsCard');
  if(host){try{const r=await request({action:'document_grants_mine'});host.innerHTML=grantsCardView({grants:r.grants,button});}catch{host.innerHTML='';}}
 }
 async function handle(action,id){
  if(!action.startsWith('docrev-'))return false;
  if(action==='docrev-open'){await show(id);return true;}
  if(action==='docrev-decide'){
   modal('Record a review decision',form(`<p class="full">${esc(cur.document.file_name)} · version ${esc(cur.document.version)}</p>`+select('decision','Decision *',DECISION_OPTIONS,'APPROVED')+area('comment','What did you check, and what is your finding? * (at least 10 characters)','',true),'Save decision'),
    f=>request({action:'document_review_submit',document_id:id,reviewed_sha256:cur.document.sha256,decision:f.get('decision'),comment:f.get('comment')}),()=>show(id));
   return true;
  }
  if(action==='docrev-scan'){
   const r=await request({action:'evidence_scan',document_id:id});
   $('#editorNotice')&&($('#editorNotice').textContent=r.message);await show(id);return true;
  }
  if(action==='docrev-grant'){
   const g=await request({action:'document_grantees',document_id:id}),t=new Date(Date.now()+86400000).toISOString().slice(0,10),max=new Date(Date.now()+29*86400000).toISOString().slice(0,10);
   modal('Give access to one document',form(`<p class="full">${esc(cur.document.file_name)}. The person sees only this file, only until the date you choose (at most 30 days).</p>`+select('grantee_id','Who needs access? *',g.staff.map(x=>[x.staff_id,`${x.full_name} (${x.category_code.toLowerCase()})`]),'','Choose…')+field('expires_on','Last day of access *',t,'date',`required min="${t}" max="${max}"`)+area('reason','Why does this person need it? * (at least 10 characters)','',true),'Give access'),
    f=>request({action:'document_grant_add',document_id:id,grantee_id:f.get('grantee_id'),expires_on:f.get('expires_on'),reason:f.get('reason')}),()=>show(cur.document.document_id));
   return true;
  }
  if(action==='docrev-revoke'){
   modal('Withdraw access',form(area('reason','Why is access withdrawn? * (at least 10 characters)','',true),'Withdraw'),f=>request({action:'document_grant_revoke',document_id:cur.document.document_id,grant_id:id,reason:f.get('reason')}),()=>show(cur.document.document_id));
   return true;
  }
  return false;
 }
 return {handle,paintStates,show,usesReview};
}
