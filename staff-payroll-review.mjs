// Supervisor review of a payroll month (build 2805): one screen with totals, changes, exceptions, mapping, journal balance and the register comparison.
// A clean run is approved in one step; anything else says exactly why not, and the usual review (confirm with a note, or return) stays available.
// Approving confirms the payroll summary only. The accounting entry is prepared from approved mappings and posted by a different authorised reviewer.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kes=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const REVIEW_NOTE='Approving confirms this payroll summary only. The accounting entry is prepared from the approved mappings and posted by a different authorised reviewer.';
export function reviewView(r,esc=e0){
 const li=(items,f)=>items.length?`<ul>${items.map(i=>`<li>${f(i)}</li>`).join('')}</ul>`:'<p class="muted">None.</p>';
 const c=r.changes||{},d=r.drift||{};
 const verdict=r.clean?'<p><span class="badge good">Clean run</span> Nothing needs a decision. It can be approved in one step.</p>':`<div class="info full error" role="alert"><b>Not a clean run. Needs the usual review.</b>${li(r.blockers||[],x=>esc(x))}</div>`;
 const lines=(r.journal?.lines||[]).map(l=>`<tr><td>${esc(l.account_code)}</td><td>${esc(l.description)}</td><td class="num">${l.debit?kes(l.debit):''}</td><td class="num">${l.credit?kes(l.credit):''}</td></tr>`).join('');
 const cc=r.client_confirmation,ccLine=cc?`<p>Client confirmation: <span class="badge ${cc.state==='Confirmed'?'good':'warn'}">${esc(cc.state)}</span> ${esc(cc.message||'')}</p>`:'';
 return `<p class="info full">${esc(REVIEW_NOTE)}</p>${verdict}${ccLine}<h4>${esc(r.month||'')} · ${esc(r.employees||0)} employees</h4>`+
  `<table><tbody><tr><td>Gross pay</td><td class="num">${kes(r.totals?.gross)}</td></tr><tr><td>Deductions</td><td class="num">${kes(r.totals?.deductions)}</td></tr><tr><td>Net pay</td><td class="num">${kes(r.totals?.net)}</td></tr><tr><td>Employer cost</td><td class="num">${kes(r.totals?.employer_cost)}</td></tr></tbody></table>`+
  `<h4>New staff (${(c.new_staff||[]).length})</h4>${li(c.new_staff||[],x=>`${esc(x.name)}: gross ${kes(x.gross)}`)}`+
  `<h4>Salary changes (${(c.salary_changes||[]).length})</h4>${li(c.salary_changes||[],x=>`${esc(x.name)}: ${kes(x.from)} to ${kes(x.to)}`)}`+
  `<h4>No longer on the payroll (${(c.left||[]).length})</h4>${li(c.left||[],x=>`${esc(x.name)}: was ${kes(x.gross)}`)}`+
  `<h4>Exceptions (${(r.exceptions||[]).length})</h4>${li((r.exceptions||[]).slice(0,50),x=>`<b>${esc(x.kind)}</b>${x.name?' · '+esc(x.name):''}: ${esc(x.detail||'')}`)}`+
  (d.applicable?`<h4>Payroll register</h4>${(d.late_changes||[]).length?`<div class="info full error" role="alert">The register changed after this run was saved: ${(d.late_changes||[]).map(x=>`${esc(x.name)} ${kes(x.saved)} to ${kes(x.register)} from ${esc(x.effective_from)}`).join('; ')}.</div>`:''}${li(d.pay_differs||[],x=>`${esc(x.name)}: run ${kes(x.saved)}, register ${kes(x.register)} from ${esc(x.effective_from)}`)}<p class="muted">A difference can be overtime or another item for the month. Only a register change made after the run was saved blocks one-step approval.</p>`:'<p class="muted">No payroll register for this client, so the run is not compared with one.</p>')+
  `<h4>Journal ${r.journal?.balanced?'<span class="badge good">Balanced</span>':'<span class="badge warn">Not ready</span>'}</h4>`+
  (lines?`<table id="payrollReviewJournal"><thead><tr><th>Account</th><th>Line</th><th>Debit</th><th>Credit</th></tr></thead><tbody>${lines}<tr><td></td><td><b>Total</b></td><td class="num">${kes(r.journal.debit)}</td><td class="num">${kes(r.journal.credit)}</td></tr></tbody></table>`:'<p class="muted">No journal lines yet.</p>');
}
export function createPayrollReviewUI(ctx,{show,button,reload}){
 const {esc,form,request,notice,projectName}=ctx;
 let pid='',cur=null;
 const handlers={
  async 'payroll-review'(id,el){
   cur=await request({action:'payroll_review_summary',project_id:pid,import_id:id});
   const can=cur.can_review;
   show('Review payroll · '+cur.month,reviewView(cur,esc)+`<div class="actions">${can&&cur.clean?button('payroll-approve','Approve clean run'):''}${can?button('payroll-reopen','Return for a new version'):''}${button('read','Back','' + id)}</div>${can?'':'<p class="muted">A different Supervisor, Manager or Partner than the preparer reviews a submitted payroll.</p>'}`);
  },
  async 'payroll-approve'(){
   show('Approve clean run',form(`<p class="full">${esc(projectName(pid))} · ${esc(cur.month)}: ${esc(cur.employees)} employees, net ${kes(cur.totals.net)}.</p><p class="info full">${esc(REVIEW_NOTE)}</p>`,'Approve in one step'),
    async()=>request({action:'payroll_review_approve',project_id:pid,import_id:cur.import_id,revision:cur.revision}),()=>{notice('Payroll approved. Prepare the accounting entry from the payroll summary when ready.');return reload(cur.import_id);});
  },
  async 'payroll-reopen'(){
   show('Return for a new version',form(`<p class="full">The version returned stays in the history. The preparer starts the month again from the payroll register and the new run replaces this one when it is confirmed.</p><label class="full">Why? *<textarea name="reason" ${(cur.drift?.late_changes||[]).length?'':'required'} minlength="10" maxlength="1000" placeholder="For example, a salary change effective 15 September was recorded after this run"></textarea></label>`,'Return payroll'),
    async f=>request({action:'payroll_review_reopen',project_id:pid,import_id:cur.import_id,revision:cur.revision,reason:f.get('reason')}),out=>{notice('Payroll returned. '+(out?.note||''));return reload(cur.import_id);});
  }
 };
 return {isAction:a=>Object.hasOwn(handlers,a),handle(a,id,el){pid=id;return handlers[a](el?.dataset.id,el);}};
}
