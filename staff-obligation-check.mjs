// Obligation check panel for the project form (build 2814).
// It shows, for each tax obligation chosen for the schedule, whether the client's verified tax profile confirms it (Confirmed, Not registered, Exempt,
// Needs verification). For any other state it takes a written reason to ask a Manager or Partner for an exception, and shows that Manager or Partner the
// pending request. The server makes every decision and every block; this panel only displays and asks.
const CLASS={Confirmed:'ok','Not registered':'bad',Exempt:'warn','Needs verification':'warn'};
const e=(esc,v)=>esc(String(v??''));
export function obligationPanelHtml(result,esc=v=>String(v??'')){
 const rows=(result&&result.rows)||[];
 if(!rows.length)return '<p class="muted">Choose a recurring tax service above to check it against the client’s verified tax profile.</p>';
 const me=result.me,canDecide=!!result.can_decide;
 const body=rows.map(r=>{
  const ex=r.exception;let action='';
  if(r.state==='Confirmed')action='<span class="muted">No exception needed.</span>';
  else if(r.exception_status==='Approved')action=`<span>Approved exception: ${e(esc,ex.reason)}</span>`;
  else if(r.exception_status==='Requested'){
   action=`<span>Exception awaiting approval: ${e(esc,ex.reason)}</span>`;
   if(canDecide&&ex.requested_by!==me)action+=` <span class="actions"><input data-ob-note="${e(esc,ex.exception_id)}" placeholder="Note (needed to reject)" maxlength="500"><button type="button" data-ob-decide="Approve" data-ob-id="${e(esc,ex.exception_id)}">Approve</button><button type="button" data-ob-decide="Reject" data-ob-id="${e(esc,ex.exception_id)}">Reject</button></span>`;
   else if(canDecide)action+=' <span class="muted">You asked for this; a different Manager or Partner decides.</span>';
  }else action=`<span class="actions"><input data-ob-reason="${e(esc,r.code)}" placeholder="Why is this task needed? (15+ characters)" maxlength="500"><button type="button" data-ob-request="${e(esc,r.code)}">Request exception</button></span>`;
  return `<tr><th scope="row">${e(esc,r.code)}</th><td><span class="badge ${CLASS[r.state]||'warn'}">${e(esc,r.state)}</span></td><td>${e(esc,r.reason)}</td><td>${action}</td></tr>`;
 }).join('');
 return `<table class="obligation-check"><thead><tr><th>Obligation</th><th>State</th><th>Why</th><th>Exception</th></tr></thead><tbody>${body}</tbody></table>${result.blocked?`<p class="info" role="status">${e(esc,result.blocked)}</p>`:'<p class="muted" role="status">Every selected obligation can be scheduled.</p>'}`;
}
// request(payload) is the workspace's request function; inputs() returns {client_id,starts_on,ends_on,frequency,obligations}.
export function mountObligationCheck(box,{request,esc,inputs,notify=()=>{}}){
 let timer=null,last=0;
 async function refresh(){
  const i=inputs(),mine=++last;
  if(!i.client_id||!i.starts_on||!i.ends_on||!(i.obligations||[]).length){box.innerHTML=obligationPanelHtml({rows:[]},esc);return;}
  try{const r=await request({action:'obligation_check',...i});if(mine===last)box.innerHTML=obligationPanelHtml(r,esc);}
  catch(err){if(mine===last)box.innerHTML=`<p class="error" role="alert">${e(esc,err&&err.message||'The obligation check could not be read.')}</p>`;}
 }
 box.addEventListener('click',async ev=>{
  const t=ev.target.closest('button');if(!t)return;const i=inputs();
  try{
   if(t.dataset.obRequest){
    const reason=box.querySelector(`[data-ob-reason="${t.dataset.obRequest}"]`)?.value||'';
    t.disabled=true;await request({action:'obligation_exception_request',client_id:i.client_id,obligation_code:t.dataset.obRequest,starts_on:i.starts_on,ends_on:i.ends_on,frequency:i.frequency,reason});notify('Exception requested. A different Manager or Partner approves it.');
   }else if(t.dataset.obDecide){
    const note=box.querySelector(`[data-ob-note="${t.dataset.obId}"]`)?.value||'';
    t.disabled=true;await request({action:'obligation_exception_decide',exception_id:t.dataset.obId,decision:t.dataset.obDecide,note});notify(t.dataset.obDecide==='Approve'?'Exception approved.':'Exception rejected.');
   }else return;
   await refresh();
  }catch(err){t.disabled=false;notify(err&&err.message||'That did not work.',true);}
 });
 return {refresh:()=>{clearTimeout(timer);timer=setTimeout(refresh,250);return Promise.resolve();},now:refresh};
}
