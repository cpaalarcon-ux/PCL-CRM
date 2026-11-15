// Client confirmation of a payroll month (build 2820): issue the report to the client, download it, record the client's answer with evidence, and see which version is current.
// The server (payroll-confirmation-actions.ts) owns every rule. This screen only shows the state and asks.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kes=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const CONFIRM_NOTE='Send the client the report so they can check who is on the payroll and what each person is paid. Record their answer here with the evidence. If anything changes afterwards, issue a new version: the payroll cannot go for review until the client has confirmed the figures as they now stand.';
const BADGE={Confirmed:'good','Awaiting client':'warn','Changes requested':'warn','Out of date':'bad','Not requested':'warn'};
export function confirmationView(r,esc=e0,button=()=>''){
 const g=r.gate||{},rows=(r.versions||[]).map(v=>`<tr><td>v${esc(v.version)}</td><td>${esc(v.status)}</td><td>${esc(String(v.issued_at||'').slice(0,10))} by ${esc(v.issued_by_name||'')}</td><td>${v.responder_name?esc(v.responder_name)+' on '+esc(v.responded_on)+(v.response_note?': '+esc(v.response_note):'')+(v.evidence_file_name?' · evidence: '+esc(v.evidence_file_name):''):'<span class="muted">No answer yet</span>'}</td><td class="num">${v.totals?kes(v.totals.net):''}</td><td>${button('payroll-confirm-pdf','Download report',v.confirmation_id)}${v.status==='Issued'&&r.can_record?button('payroll-confirm-record','Record client answer',v.confirmation_id):''}</td></tr>`).join('');
 return `<p class="info full">${esc(CONFIRM_NOTE)}</p><p><span class="badge ${BADGE[g.state]||'warn'}">${esc(g.state||'Not requested')}</span> ${esc(g.message||'')}</p>`+
  `<p>Run now: net pay ${kes(r.current_totals?.net)} for ${esc(r.current_totals?.employees||0)} employees.</p>`+
  (rows?`<div class="scroll"><table id="payrollConfirmationVersions"><thead><tr><th>Version</th><th>Status</th><th>Issued</th><th>Client answer</th><th class="num">Net pay</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">No report has been issued for this run.</p>');
}
export function createPayrollConfirmationUI(ctx,{show,button,reload}){
 const {esc,form,request,notice,projectName,today}=ctx;
 let pid='',cur=null,runId='';
 const b2=(a,l,id='')=>button(a,l,id);
 const download=r=>{const bytes=Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0)),u=URL.createObjectURL(new Blob([bytes],{type:r.mime_type})),a=document.createElement('a');a.href=u;a.download=r.file_name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
 async function panel(){
  cur=await request({action:'payroll_confirmation_read',project_id:pid,import_id:runId});
  show('Client confirmation · '+cur.month,confirmationView(cur,esc,b2)+`<div class="actions">${cur.can_issue?button('payroll-confirm-issue',cur.versions.length?'Issue a new version':'Issue report for the client'):''}${button('read','Back to the payroll run',runId)}</div>${cur.can_issue?'':'<p class="muted">A report is issued while the run is still being prepared.</p>'}`);
 }
 const handlers={
  async 'payroll-confirm'(id){runId=id;await panel();},
  async 'payroll-confirm-issue'(){
   const out=await request({action:'payroll_confirmation_issue',project_id:pid,import_id:runId});notice('Version '+out.version+' issued. Download it and send it to the client.');await panel();
  },
  async 'payroll-confirm-pdf'(id){download(await request({action:'payroll_confirmation_pdf',project_id:pid,import_id:runId,confirmation_id:id}));},
  async 'payroll-confirm-record'(id){
   const v=cur.versions.find(x=>x.confirmation_id===id),docs=(cur.documents||[]).map(d=>`<option value="${esc(d.document_id)}">${esc(d.file_name)}</option>`).join('');
   show('Record the client answer · version '+v.version,form(`<p class="full">${esc(projectName(pid))} · ${esc(cur.month)}</p>
    <label>Answer *<select name="decision" required><option>Confirmed</option><option>Changes requested</option></select></label>
    <label>Who answered at the client? *<input name="responder_name" required minlength="3" maxlength="120"></label>
    <label>Date of the answer *<input type="date" name="responded_on" required max="${esc(today())}" value="${esc(today())}"></label>
    <label>Evidence document<select name="evidence_document_id"><option value="">None attached</option>${docs}</select></label>
    <label class="full">Note: how they confirmed, or what they want changed *<textarea name="note" maxlength="1000" placeholder="For example: email from the finance manager, 3 October. Or: Kamau should be on 65,000."></textarea></label>
    <p class="info full">If you attach no evidence document, the note must say how and where the client confirmed. A change request starts a new version once the run is amended.</p>`,'Record answer'),
    async f=>request({action:'payroll_confirmation_record',project_id:pid,import_id:runId,confirmation_id:id,revision:v.revision,decision:f.get('decision'),responder_name:f.get('responder_name'),responded_on:f.get('responded_on'),evidence_document_id:f.get('evidence_document_id')||undefined,note:f.get('note')}),
    async()=>{notice('Client answer recorded.');await panel();});
  }
 };
 return {isAction:a=>Object.hasOwn(handlers,a),handle(a,id,el){pid=id;return handlers[a](el?.dataset.id,el);}};
}
