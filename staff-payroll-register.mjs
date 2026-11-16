import {monthsPanel,resultPanel,idsForm,downloadCsv} from './staff-statutory-files.mjs?v=20261117-links-v1';
// Payroll register screens (build 2804): who is on a client's payroll and what they are paid, then "Start month from register".
// The server (payroll-register-actions.ts, payroll-register-rules.mjs) owns every rule. A month started here opens the typed payroll screen pre-filled;
// nothing is saved, submitted or posted from this screen.
export const REGISTER_NOTE='The register keeps who is on this client\'s payroll and their recurring pay, with the date each change takes effect and the reason. Each month starts as a draft from it. Overtime, bonuses, other deductions, the date a casual worker is paid and the evidence for the month are entered new. A month already submitted or approved keeps its own figures.';
const kes=v=>v==null?'':Number(v).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const REL_HELP='Owners and partners are paid through Drawings, so they are not added here.';
// Status of one person on the register: Active, Inactive for a period, a separation waiting for approval, or Separated. History is never removed.
export function personStatus(p,changes,today){
 const mine=(changes||[]).filter(c=>c.person_id===p.person_id);
 if(p.status==='Left')return {label:'Separated',cls:'',detail:p.left_on?'from '+p.left_on:''};
 const t=today||new Date().toISOString().slice(0,10);
 const inact=mine.find(c=>c.kind==='Inactive'&&c.status==='In force'&&c.starts_on<=t&&(!c.ends_on||c.ends_on>=t));
 const sep=mine.find(c=>c.kind==='Separation'&&c.status==='Requested');
 if(inact)return {label:'Inactive',cls:'warn',detail:'from '+inact.starts_on+(inact.ends_on?' to '+inact.ends_on:''),change:inact,sep};
 const future=mine.find(c=>c.kind==='Inactive'&&c.status==='In force'&&c.starts_on>t);
 return {label:sep?'Active, separation pending':'Active',cls:'good',detail:future?'inactive from '+future.starts_on:'',change:future||null,sep};
}
export function registerTable(r,esc,shortDate){
 const pay=new Map();for(const x of r.pays||[])if(!pay.has(x.person_id))pay.set(x.person_id,x);
 const rows=(r.people||[]).map(p=>{const cur=pay.get(p.person_id),st=personStatus(p,r.changes),
  btns=p.status==='Active'?`<button type="button" data-period-action="register-pay" data-id="${esc(p.person_id)}">Change pay</button><button type="button" data-period-action="register-ids" data-id="${esc(p.person_id)}" data-revision="${esc(p.revision)}">Statutory details</button>${st.change?`<button type="button" data-period-action="register-return" data-id="${esc(st.change.change_id)}">Return to active</button>`:`<button type="button" data-period-action="register-inactive" data-id="${esc(p.person_id)}">Make inactive</button>`}${st.sep?'':`<button type="button" data-period-action="register-leave" data-id="${esc(p.person_id)}" data-revision="${esc(p.revision)}">Remove from payroll</button>`}`:'';
  return `<tr><td>${esc(p.name)}<small>${esc(p.relationship)} · ${esc(p.employment_type)}</small></td><td>${esc(p.kra_pin||'No PIN')}</td><td>${esc(shortDate(p.started_on))}${p.left_on?`<small>separated ${esc(shortDate(p.left_on))}</small>`:''}</td><td class="num">${cur?kes(cur.gross):'—'}${cur?`<small>from ${esc(shortDate(cur.effective_from))}</small>`:''}</td><td><span class="badge ${st.cls}">${esc(st.label)}</span>${st.detail?`<small>${esc(st.detail)}</small>`:''}</td><td>${btns}</td></tr>`;}).join('');
 return rows?`<div class="scroll"><table id="payrollRegisterTable"><thead><tr><th>Person</th><th>KRA PIN</th><th>Started</th><th class="num">Gross pay</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">Nobody is on the register yet. Add the people on this client\'s payroll once; every later month starts from it.</p>';
}
// Separation requests waiting for a decision, and the history of inactive periods and separations.
export function changesPanel(r,esc,shortDate){
 const nameOf=id=>(r.people||[]).find(p=>p.person_id===id)?.name||'';
 const pending=(r.changes||[]).filter(c=>c.kind==='Separation'&&c.status==='Requested');
 const pend=pending.length?`<h4>Separations waiting for approval (${pending.length})</h4><ul>${pending.map(c=>`<li>${esc(nameOf(c.person_id))}: effective ${esc(shortDate(c.starts_on))}. ${esc(c.reason)} <small>Asked by ${esc(c.requested_by_name||'')}</small> ${c.requested_by===r.me?`<button type="button" data-period-action="register-sep-withdraw" data-id="${esc(c.change_id)}">Withdraw request</button>`:(r.can_decide?`<button type="button" data-period-action="register-sep-decide" data-id="${esc(c.change_id)}" data-decision="Approve">Approve</button><button type="button" data-period-action="register-sep-decide" data-id="${esc(c.change_id)}" data-decision="Reject">Reject</button>`:'<span class="muted">A Manager or Partner decides.</span>')}</li>`).join('')}</ul>`:'';
 const hist=(r.changes||[]).filter(c=>!(c.kind==='Separation'&&c.status==='Requested'));
 const rows=hist.map(c=>`<tr><td>${esc(nameOf(c.person_id))}</td><td>${esc(c.kind==='Inactive'?'Inactive period':'Separation')}</td><td>${esc(shortDate(c.starts_on))}${c.ends_on?' to '+esc(shortDate(c.ends_on)):''}${c.returned_on?`<small>returned ${esc(shortDate(c.returned_on))}: ${esc(c.returned_reason||'')}</small>`:''}</td><td>${esc(c.reason)}</td><td>${esc(c.status)}<small>${esc(c.requested_by_name||'')}${c.decided_by_name?' · decided by '+esc(c.decided_by_name):''}${c.returned_by_name?' · returned by '+esc(c.returned_by_name):''}</small></td></tr>`).join('');
 return pend+(rows?`<h4>History of status changes</h4><div class="scroll"><table><thead><tr><th>Person</th><th>Change</th><th>When</th><th>Reason</th><th>Status, by</th></tr></thead><tbody>${rows}</tbody></table></div>`:'');
}
export function draftSummary(x,esc,shortDate){
 const li=(items,f)=>items.length?`<ul>${items.map(i=>`<li>${f(i)}</li>`).join('')}</ul>`:'<p class="muted">None.</p>';
 const c=x.changes||{};
 return `<p class="info full">${esc(x.note||'')}</p><p><b>${esc(x.month)}</b> · ${x.lines.length} on the payroll${x.skipped.length?` · ${x.skipped.length} skipped`:''}</p>`+
  (x.existing_run?`<div class="info full error">A payroll for this month already exists (${esc(x.existing_run.status)}). Opening a new draft would repeat it. Open that payroll instead, or discard it first with a reason.</div>`:'')+
  (x.replacing_run?`<p class="info full">The confirmed run for this month is being amended and its posted entries are reversed. The new run replaces it when it is confirmed, and the old one stays in the history.</p>`:'')+
  (x.returned_run?`<p class="info full">An earlier version of this month was returned. The new run replaces it when it is confirmed, and the returned version stays in the history. Confirm the replacement when the preview asks.</p>`:'')+
  `<h4>New staff (${(c.new_staff||[]).length})</h4>${li(c.new_staff||[],i=>`${esc(i.name)}: gross ${kes(i.gross)}${i.by?` <small>Added by ${esc(i.by)}</small>`:''}`)}`+
  `<h4>Pay changes (${(c.pay_changes||[]).length})</h4>${li(c.pay_changes||[],i=>`${esc(i.name)}: ${kes(i.from)} to ${kes(i.to)} from ${esc(shortDate(i.effective_from))}. ${esc(i.reason)}${i.by?` <small>Recorded by ${esc(i.by)}</small>`:''}`)}`+
  `<h4>Separated since last month (${(c.left||[]).length})</h4>${li(c.left||[],i=>`${esc(i.name)}: separated ${esc(shortDate(i.left_on))}. ${esc(i.reason)}${i.approved_by?` Asked by ${esc(i.requested_by)}, approved by ${esc(i.approved_by)}.`:''}`)}`+
  `<h4>Inactive this month (${(c.inactive||[]).length})</h4>${li(c.inactive||[],i=>`${esc(i.name)}: from ${esc(shortDate(i.from))}${i.to?' to '+esc(shortDate(i.to)):''}. ${esc(i.reason)}`)}`+
  `<h4>Returned to active (${(c.returned||[]).length})</h4>${li(c.returned||[],i=>`${esc(i.name)}: ${esc(i.reason)}`)}`+
  ((c.pending_separations||[]).length?`<h4>Separations not yet approved (${c.pending_separations.length})</h4>${li(c.pending_separations,i=>`${esc(i.name)}: effective ${esc(shortDate(i.effective_on))}. They stay on this draft until a Manager or Partner approves.`)}`:'')+
  ((x.warnings||[]).length?`<h4>Check before saving (${x.warnings.length})</h4>${li(x.warnings,i=>`${esc(i.name)}: ${esc(i.detail)}`)}`:'')+
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
  show('Payroll register',`<p><b>${esc(projectName(pid))}</b></p><p class="info full">${esc(REGISTER_NOTE)}</p><div class="actions">${button('register-add','Add person')}${button('register-start','Start a month from the register')}${button('statutory-files','Statutory files')}${button('back','Back')}</div>${registerTable(r,esc,shortDate)}${changesPanel(r,esc,shortDate)}`);
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
   show('Remove from payroll',form(`<p class="info full">Removing someone stops them being carried into months from the effective date. Their record and every past payroll stay. A different Manager or Partner must approve the removal before it takes effect.</p>`+field('left_on','Effective date (last day on the payroll) *','','date','required')+`<label class="full">Reason *<textarea name="reason" required minlength="10" maxlength="500" placeholder="For example, resigned, notice served 31 August 2026"></textarea></label>`,'Request removal'),
    async f=>request({action:'payroll_register_leave',project_id:pid,person_id:id,revision:el?.dataset.revision,...Object.fromEntries(f)}),()=>{notice('Removal requested. The person stays on the payroll until it is approved.');return list();});
  },
  async 'register-inactive'(id){
   show('Make inactive for a period',form(`<p class="info full">An inactive person is not carried into the months they are inactive. Their record stays and they can be returned to active.</p>`+field('starts_on','First inactive day *','','date','required')+field('ends_on','Last inactive day (blank if not known yet)','','date')+`<label class="full">Reason *<textarea name="reason" required minlength="10" maxlength="500" placeholder="For example, unpaid leave agreed with the client from 1 October"></textarea></label><label class="full"><input type="checkbox" name="confirm" value="yes" required> I confirm this person is inactive for that period and the client has been told.</label>`,'Make inactive'),
    async f=>request({action:'payroll_register_inactive',project_id:pid,person_id:id,confirm:f.get('confirm')==='yes',starts_on:f.get('starts_on'),ends_on:f.get('ends_on')||null,reason:f.get('reason')}),out=>{notice('Marked inactive.'+((out?.affected_months||[]).length?' Submitted or approved months keep their figures: '+out.affected_months.map(m=>m.month).join(', ')+'.':''));return list();});
  },
  async 'register-return'(id){
   show('Return to active',form(field('returned_on','Active again from *','','date','required')+`<label class="full">Reason *<textarea name="reason" required minlength="10" maxlength="500" placeholder="For example, returned from unpaid leave on 1 January 2027"></textarea></label><label class="full"><input type="checkbox" name="confirm" value="yes" required> I confirm this person is back on the payroll from that date.</label>`,'Return to active'),
    async f=>request({action:'payroll_register_return',project_id:pid,change_id:id,confirm:f.get('confirm')==='yes',returned_on:f.get('returned_on'),reason:f.get('reason')}),()=>{notice('Returned to active. They carry forward from that month.');return list();});
  },
  async 'register-sep-decide'(id,el){
   const decision=el?.dataset.decision==='Reject'?'Reject':'Approve';
   show(decision+' removal from payroll',form(`<label class="full">${decision==='Reject'?'Reason for rejecting *':'Note (optional)'}<textarea name="note" ${decision==='Reject'?'required minlength="5"':''} maxlength="500"></textarea></label>`,decision),
    async f=>request({action:'payroll_register_separation_decide',project_id:pid,change_id:id,decision,note:f.get('note')||''}),out=>{notice(decision==='Approve'?'Removal approved. The person leaves the payroll from the effective date; past payrolls are unchanged.':'Removal rejected. The person stays on the payroll.');return list();});
  },
  async 'register-sep-withdraw'(id){
   await request({action:'payroll_register_separation_withdraw',project_id:pid,change_id:id});notice('Request withdrawn.');return list();
  },
  async 'register-ids'(id,el){
   const r=await request({action:'payroll_register_read',project_id:pid}),person=(r.people||[]).find(x=>x.person_id===id);if(!person)return list();
   show('Statutory details: '+person.name,form(idsForm(person,field,select,esc),'Save details'),
    async f=>request({action:'payroll_register_identifiers',project_id:pid,person_id:id,revision:String(person.revision),...Object.fromEntries(f),disability:f.get('disability')==='yes'}),()=>{notice('Statutory details saved.');return list();});
  },
  async 'statutory-files'(){
   const r=await request({action:'statutory_file_read',project_id:pid});
   show('Statutory files',monthsPanel(r,esc)+`<div class="actions">${button('register','Back to register')}</div>`);
  },
  async 'statutory-prepare'(id,el){
   const x=await request({action:'statutory_file_prepare',project_id:pid,import_id:id,kind:el?.dataset.kind});
   show('Statutory file',resultPanel(x,esc));
  },
  async 'statutory-release'(id,el){
   const x=await request({action:'statutory_file_prepare',project_id:pid,import_id:id,kind:el?.dataset.kind,release:true,confirm_defaults:!!$('#statutoryDefaults')?.checked});
   if(x.csv){downloadCsv(x.file_name,x.csv);for(const f of x.extra_files||[])downloadCsv(f.file_name,f.csv);notice('Released and downloaded: '+[x.file_name,...(x.extra_files||[]).map(f=>f.file_name)].join(', ')+'. The release is recorded.');}
   show('Statutory file',resultPanel({...x,csv:undefined},esc));
  },
  async 'register-open'(){
   if(!pendingDraft)return list();
   const {x,evidence}=pendingDraft;pendingDraft=null;
   return startManual({lines:x.lines.map(l=>({...l,evidence_reference:evidence})),month:x.month,starts_on:x.starts_on,ends_on:x.ends_on});
  },
  async 'register-start'(){
   const reg0=await request({action:'payroll_register_read',project_id:pid}),carry=reg0.people.filter(p=>p.status==='Active');
   show('Start a month from the register',form(field('month','Payroll month *',monthDefault(),'month','required')+(carry.length?`<fieldset class="full"><legend>Leave out of this draft (everyone else carries forward)</legend>${carry.map(p=>`<label><input type="checkbox" name="exclude" value="${esc(p.person_id)}"> ${esc(p.name)}</label>`).join(' ')}</fieldset>`:'')+`<label class="full">Evidence for this month's lines *<input name="evidence" required maxlength="300" placeholder="For example, payslip batch PS-2026-03 or signed payroll register"></label><p class="muted full">The same evidence reference is applied to every line. You can change a line afterwards.</p>`,'Prepare draft from register'),
    async f=>({x:await request({action:'payroll_register_draft',project_id:pid,month:f.get('month'),exclude_person_ids:f.getAll('exclude')}),evidence:f.get('evidence')}),
    ({x,evidence})=>{pendingDraft={x,evidence};show('Draft for '+x.month,draftSummary(x,esc,shortDate)+(x.existing_run?'':`<div class="actions">${button('register-open','Open the payroll lines')}${button('register','Back to register')}</div>`),null);},{refreshWorkspace:false,pendingLabel:'Preparing draft…',pendingMessage:'Reading the register. Nothing will be saved.',successMessage:'Draft ready.'});
  }
 };
 // The draft opens the typed payroll screen: the person adds the month's own items and the usual preview, review and posting follow.
 return {isAction:a=>Object.hasOwn(handlers,a),async handle(a,id,el){pid=id;return handlers[a](el?.dataset.id,el);},open(id){pid=id;return handlers.register();}};
}
