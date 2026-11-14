// Payroll register screens (build 2804): who is on a client's payroll and what they are paid, then "Start month from register".
// The server (payroll-register-actions.ts, payroll-register-rules.mjs) owns every rule. A month started here opens the typed payroll screen pre-filled;
// nothing is saved, submitted or posted from this screen.
export const REGISTER_NOTE='The register keeps who is on this client\'s payroll and their recurring pay, with the date each change takes effect and the reason. Each month starts as a draft from it. Overtime, bonuses, other deductions, the date a casual worker is paid and the evidence for the month are entered new. A month already submitted or approved keeps its own figures.';
const kes=v=>v==null?'':Number(v).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const REL_HELP='Owners and partners are paid through Drawings, so they are not added here.';
export function registerTable(r,esc,shortDate){
 const pay=new Map();for(const x of r.pays||[])if(!pay.has(x.person_id))pay.set(x.person_id,x);
 const rows=(r.people||[]).map(p=>{const cur=pay.get(p.person_id),btns=p.status==='Active'?`<button type="button" data-period-action="register-pay" data-id="${esc(p.person_id)}">Change pay</button><button type="button" data-period-action="register-leave" data-id="${esc(p.person_id)}" data-revision="${esc(p.revision)}">Mark left</button>`:'';
  return `<tr><td>${esc(p.name)}<small>${esc(p.relationship)} · ${esc(p.employment_type)}</small></td><td>${esc(p.kra_pin||'No PIN')}</td><td>${esc(shortDate(p.started_on))}${p.left_on?`<small>left ${esc(shortDate(p.left_on))}</small>`:''}</td><td class="num">${cur?kes(cur.gross):'—'}${cur?`<small>from ${esc(shortDate(cur.effective_from))}</small>`:''}</td><td>${p.status==='Active'?'<span class="badge good">Active</span>':'<span class="badge">Left</span>'}</td><td>${btns}</td></tr>`;}).join('');
 return rows?`<div class="scroll"><table id="payrollRegisterTable"><thead><tr><th>Person</th><th>KRA PIN</th><th>Started</th><th class="num">Gross pay</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">Nobody is on the register yet. Add the people on this client\'s payroll once; every later month starts from it.</p>';
}
export function draftSummary(x,esc,shortDate){
 const li=(items,f)=>items.length?`<ul>${items.map(i=>`<li>${f(i)}</li>`).join('')}</ul>`:'<p class="muted">None.</p>';
 const c=x.changes||{};
 return `<p class="info full">${esc(x.note||'')}</p><p><b>${esc(x.month)}</b> · ${x.lines.length} on the payroll${x.skipped.length?` · ${x.skipped.length} skipped`:''}</p>`+
  (x.existing_run?`<div class="info full error">A payroll for this month already exists (${esc(x.existing_run.status)}). Opening a new draft would repeat it. Open that payroll instead, or discard it first with a reason.</div>`:'')+
  (x.replacing_run?`<p class="info full">The confirmed run for this month is being amended and its posted entries are reversed. The new run replaces it when it is confirmed, and the old one stays in the history.</p>`:'')+
  (x.returned_run?`<p class="info full">An earlier version of this month was returned. The new run replaces it when it is confirmed, and the returned version stays in the history. Confirm the replacement when the preview asks.</p>`:'')+
  `<h4>New staff (${(c.new_staff||[]).length})</h4>${li(c.new_staff||[],i=>`${esc(i.name)}: gross ${kes(i.gross)}`)}`+
  `<h4>Pay changes (${(c.pay_changes||[]).length})</h4>${li(c.pay_changes||[],i=>`${esc(i.name)}: ${kes(i.from)} to ${kes(i.to)} from ${esc(shortDate(i.effective_from))}. ${esc(i.reason)}`)}`+
  `<h4>Left since last month (${(c.left||[]).length})</h4>${li(c.left||[],i=>`${esc(i.name)}: left ${esc(shortDate(i.left_on))}`)}`+
  ((x.missing||[]).length?`<h4>Missing details (${x.missing.length})</h4>${li(x.missing,i=>`${esc(i.name)}: ${esc(i.missing.join(', '))}`)}`:'')+
  ((x.skipped||[]).length?`<h4>Skipped</h4>${li(x.skipped,i=>`${esc(i.name)}: ${esc(i.reason)}`)}`:'')+
  ((x.issues||[]).length?`<div class="info full error"><ul>${x.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`:'');
}
export function createPayrollRegisterUI(ctx,{show,button,startManual}){
 const {$,esc,field,select,form,request,notice,shortDate,projectName}=ctx;
 let pid='',pendingDraft=null;
 const personFields=()=>field('name','Name *','','text','required maxlength="160"')+field('kra_pin','KRA PIN','','text','maxlength="11"')+field('national_id','ID number','','text','maxlength="30"')+
  select('relationship','Relationship to the client *',['Employee','Casual worker','Director','Shareholder','Family member'].map(x=>[x,x]),'Employee')+select('employment_type','Employment type',[['Permanent','Permanent'],['Contract','Contract'],['Casual','Casual']],'Permanent')+
  select('resident','Residence',[['Resident','Resident'],['Non-resident','Non-resident']],'','Decide in the preview')+field('phone','Phone (casual)','','text','maxlength="20"')+field('approval_reference','Board resolution, contract or agreement (director, shareholder, family)','','text','maxlength="300"')+field('related_basis','Duties and basis of pay (family member)','','text','maxlength="500"');
 const payFields=()=>field('gross','Gross cash pay per month *','','number','required min="0.01" step="0.01"')+field('taxable_benefits','Taxable benefits','','number','min="0" step="0.01"')+field('other_pension','Other pension contribution','','number','min="0" step="0.01"')+field('mortgage_interest','Mortgage interest','','number','min="0" step="0.01"')+field('postretirement_medical','Post-retirement medical','','number','min="0" step="0.01"');
 async function list(){
  const r=await request({action:'payroll_register_read',project_id:pid});
  show('Payroll register',`<p><b>${esc(projectName(pid))}</b></p><p class="info full">${esc(REGISTER_NOTE)}</p><div class="actions">${button('register-add','Add person')}${button('register-start','Start a month from the register')}${button('back','Back')}</div>${registerTable(r,esc,shortDate)}`);
 }
 const monthDefault=()=>{const t=new Date();return t.toISOString().slice(0,7);};
 const handlers={
  async register(){await list();},
  async 'register-add'(){
   show('Add person to the payroll register',form(`<p class="muted full">${esc(REL_HELP)}</p>`+personFields()+field('started_on','Started on *','','date','required')+payFields()+field('effective_from','Pay takes effect on (blank = start date)','','date')+`<label class="full">Reason or basis for this pay *<textarea name="reason" required minlength="10" maxlength="500" placeholder="For example, contract of 1 March 2026"></textarea></label>`,'Add to register'),
    async f=>request({action:'payroll_register_add',project_id:pid,person:Object.fromEntries([...f].filter(([k])=>!['gross','taxable_benefits','other_pension','mortgage_interest','postretirement_medical','effective_from','reason'].includes(k))),pay:Object.fromEntries([...f].filter(([k])=>['gross','taxable_benefits','other_pension','mortgage_interest','postretirement_medical','effective_from','reason'].includes(k)))}),
    out=>{notice('Added to the payroll register.'+((out?.affected_months||[]).length?' Months already submitted or approved keep their figures: '+out.affected_months.map(m=>m.month).join(', ')+'.':''));return list();});
  },
  async 'register-pay'(id){
   show('Change pay',form(payFields()+field('effective_from','Takes effect on *','','date','required')+`<label class="full">Reason *<textarea name="reason" required minlength="10" maxlength="500" placeholder="For example, annual review approved 1 July 2026"></textarea></label><p class="muted full">The earlier pay stays on record. Months already submitted or approved keep their own figures.</p>`,'Save pay change'),
    async f=>request({action:'payroll_register_pay',project_id:pid,person_id:id,...Object.fromEntries(f)}),out=>{notice('Pay change recorded.'+((out?.affected_months||[]).length?' Affected submitted or approved months: '+out.affected_months.map(m=>m.month).join(', ')+'. Withdraw or amend them to use the change.':''));return list();});
  },
  async 'register-leave'(id,el){
   show('Mark as left',form(field('left_on','Last day on the payroll *','','date','required')+`<label class="full">Reason *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'Mark as left'),
    async f=>request({action:'payroll_register_leave',project_id:pid,person_id:id,revision:el?.dataset.revision,...Object.fromEntries(f)}),()=>{notice('Marked as left. Earlier months are unchanged.');return list();});
  },
  async 'register-open'(){
   if(!pendingDraft)return list();
   const {x,evidence}=pendingDraft;pendingDraft=null;
   return startManual({lines:x.lines.map(l=>({...l,evidence_reference:evidence})),month:x.month,starts_on:x.starts_on,ends_on:x.ends_on});
  },
  async 'register-start'(){
   show('Start a month from the register',form(field('month','Payroll month *',monthDefault(),'month','required')+`<label class="full">Evidence for this month's lines *<input name="evidence" required maxlength="300" placeholder="For example, payslip batch PS-2026-03 or signed payroll register"></label><p class="muted full">The same evidence reference is applied to every line. You can change a line afterwards.</p>`,'Prepare draft from register'),
    async f=>({x:await request({action:'payroll_register_draft',project_id:pid,month:f.get('month')}),evidence:f.get('evidence')}),
    ({x,evidence})=>{pendingDraft={x,evidence};show('Draft for '+x.month,draftSummary(x,esc,shortDate)+(x.existing_run?'':`<div class="actions">${button('register-open','Open the payroll lines')}${button('register','Back to register')}</div>`),null);},{refreshWorkspace:false,pendingLabel:'Preparing draft…',pendingMessage:'Reading the register. Nothing will be saved.',successMessage:'Draft ready.'});
  }
 };
 // The draft opens the typed payroll screen: the person adds the month's own items and the usual preview, review and posting follow.
 return {isAction:a=>Object.hasOwn(handlers,a),async handle(a,id,el){pid=id;return handlers[a](el?.dataset.id,el);},open(id){pid=id;return handlers.register();}};
}
