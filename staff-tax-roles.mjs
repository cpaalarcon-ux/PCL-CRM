// Tax Manager role and annual due-date rules (Settings). The rules live in the database (20261110280000_tax_manager_role_annual_rules.sql); this file draws the screen.
// A Partner assigns a Manager as the Tax Manager of an engagement and switches the role's APPROVE_TAX_RULES permission on (it starts off). Managers can read.
// Nothing on this screen approves a tax rule; approval stays on the tax rules screen, where the database checks this role again.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const ROLE_NOTE='The Tax Manager is a Manager a Partner assigns to a client engagement. VAT, credit and other tax rules can be approved only by a Tax Manager while a Partner has switched the APPROVE_TAX_RULES permission on for the role. A Partner cannot approve a VAT or credit rule without being assigned as it; no other staff member can approve one.';
export const RULES_NOTE='Annual KRA due dates are suggested from these rules: the months after the period end and the day of the month (blank means the last day of the month; a fixed day is capped at the last day if the month is shorter). The Tax Team still confirms each annual period\'s date by hand. A rule shows "Suggested" until a Partner records its confirmation.';
const KIND_LABEL={Individual:'Individual (resident)',Company:'Company',Partnership:'Partnership'};
export const permissionStatus=p=>p?.allowed?'On':'Off (default: not yet switched on by a Partner)';
export const ruleStatus=r=>r.rule_status==='Confirmed'?`Confirmed${r.confirmed_at?' on '+day(r.confirmed_at):''}`:'Suggested - not yet confirmed';

export function roleView({data,partner,button}){
 const p=data.permission,live=(data.assignments||[]).filter(x=>!x.ended_at),past=(data.assignments||[]).filter(x=>x.ended_at).slice(0,10);
 const rows=live.map(x=>`<tr><td>${esc(x.company_name)}<br><small>${esc(x.project_name)}</small></td><td>${esc(x.staff_name)}</td><td>${esc(day(x.assigned_at))}</td><td>${partner?button('taxrole-end','End',x.assignment_id):''}</td></tr>`).join('');
 return `<p class="info full">${esc(ROLE_NOTE)}</p>
 <div class="section-head"><h3>Permission for the Tax Manager role</h3></div>
 <p><b>APPROVE_TAX_RULES: ${esc(permissionStatus(p))}</b>${p?.changed_at?'<br><small>Last changed '+esc(day(p.changed_at))+'. '+esc(p.source_note||'')+'</small>':''}${partner?'<br>'+button('taxrole-permission',p?.allowed?'Switch off':'Switch on'):''}</p>
 <div class="section-head"><h3>Tax Managers by engagement</h3>${partner?button('taxrole-assign','+ Assign a Tax Manager'):''}</div>
 ${live.length?`<div class="scroll"><table id="taxManagerTable"><thead><tr><th>Engagement</th><th>Tax Manager</th><th>Since</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">No engagement has a Tax Manager yet.</p>'}
 ${past.length?`<p class="muted">Ended: ${past.map(x=>esc(x.staff_name)+' · '+esc(x.company_name)).join('; ')}</p>`:''}
 <p class="muted ${data.i_can_approve_tax_rules?'ok':''}">${data.i_can_approve_tax_rules?'You can approve tax rules.':'You cannot approve tax rules.'}</p>`;
}
export function rulesView({data,partner,button}){
 const rows=(data.rules||[]).map(r=>`<tr><td><b>${esc(KIND_LABEL[r.tax_kind]||r.tax_kind)}</b>${r.applies_from_period_end?'<br><small>periods ending on or after '+esc(day(r.applies_from_period_end))+'</small>':''}</td><td>${esc(r.due_month_offset)} months after the period end, ${r.external_deadline_day==null?'on the last day of that month':'day '+esc(r.external_deadline_day)}</td><td>${esc(r.internal_month_offset)} months after, day ${esc(r.internal_deadline_day)}</td><td><small class="${r.rule_status==='Confirmed'?'ok':'warn'}">${esc(ruleStatus(r))}</small><br><small>${esc(r.source_note||'')}</small>${partner?'<br>'+button('taxrole-rule-set','Change',r.rule_id)+(r.rule_status==='Confirmed'?'':' '+button('taxrole-rule-confirm','Record confirmation',r.rule_id)):''}</td></tr>`).join('');
 return `<p class="info full">${esc(RULES_NOTE)}</p><div class="scroll full"><table id="annualRulesTable"><thead><tr><th>Tax</th><th>KRA due date</th><th>Firm internal date</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function createTaxRolesUI(ctx){
 const {field,form,modal,request,button,area,select}=ctx,d=()=>ctx.data();
 let cur=null;
 const leaderRole=me=>['PARTNER','MANAGER'].includes(me?.category_code);
 function card(){
  if(!leaderRole(d().me))return '';
  return `<section class="card"><div class="section-head"><h2>Tax Manager role and annual due dates</h2>${button('taxrole-open','Open')}</div><p class="muted">Who may approve tax rules, and how the annual KRA due dates are suggested.</p></section>`;
 }
 async function open(){
  const data=await request({action:'tax_manager_read'}),partner=d().me?.category_code==='PARTNER';
  cur=data;
  modal('Tax Manager role and annual due dates',roleView({data,partner,button})+'<h3>Annual due-date rules</h3>'+rulesView({data,partner,button}));
 }
 async function handle(action,id){
  if(!action.startsWith('taxrole-'))return false;
  if(action==='taxrole-open'){await open();return true;}
  if(action==='taxrole-permission'){
   const p=cur?.permission;if(!p)return true;
   modal((p.allowed?'Switch off':'Switch on')+' · APPROVE_TAX_RULES for the Tax Manager role',form(`<p class="info full">${p.allowed?'The Tax Manager will no longer be able to approve tax rules.':'The assigned Tax Manager will be able to confirm and approve tax rules, including VAT and credit rules.'} Record who decided this and where it is written.</p>`+area('source_note','Who decided this, and where it is written *','',true),p.allowed?'Switch off':'Switch on'),
    f=>request({action:'tax_role_permission_set',allowed:!p.allowed,revision:p.revision,source_note:f.get('source_note')}),open);
   return true;
  }
  if(action==='taxrole-assign'){
   const projects=ctx.filtered().projects.map(p=>[p.project_id,`${(d().clients.find(c=>c.client_id===p.client_id)||{}).company_name||''} · ${p.project_name}`]),managers=(cur?.candidates||[]).map(m=>[m.staff_id,m.full_name]);
   modal('Assign a Tax Manager',form(select('project_id','Engagement *',projects)+select('staff_id','Manager *',managers)+area('reason','Why this Manager is the Tax Manager for the engagement *','',true),'Assign'),
    f=>request({action:'tax_manager_assign',project_id:f.get('project_id'),staff_id:f.get('staff_id'),reason:f.get('reason')}),open);
   return true;
  }
  if(action==='taxrole-end'){
   modal('End the Tax Manager assignment',form(area('reason','Why the assignment ends *','',true),'End assignment'),f=>request({action:'tax_manager_end',assignment_id:id,reason:f.get('reason')}),open);
   return true;
  }
  if(action==='taxrole-rule-set'){
   const r=(cur?.rules||[]).find(x=>x.rule_id===id);if(!r)return true;
   modal('Change the rule · '+(KIND_LABEL[r.tax_kind]||r.tax_kind),form(field('due_month_offset','KRA due date: months after the period end *',String(r.due_month_offset),'number','required min="1" max="12"')+field('external_deadline_day','KRA due date: day of the month (blank = the last day of the month)',r.external_deadline_day==null?'':String(r.external_deadline_day),'number','min="1" max="31"')+field('internal_month_offset','Internal date: months after the period end *',String(r.internal_month_offset),'number','required min="0" max="12"')+field('internal_deadline_day','Internal date: day of the month *',String(r.internal_deadline_day),'number','required min="1" max="31"')+'<p class="info full">Changing a rule withdraws its confirmation. A Partner then records the confirmation with its written source.</p>','Save'),
    f=>request({action:'annual_due_rule_set',rule_id:id,revision:r.revision,due_month_offset:f.get('due_month_offset'),external_deadline_day:f.get('external_deadline_day'),internal_month_offset:f.get('internal_month_offset'),internal_deadline_day:f.get('internal_deadline_day')}),open);
   return true;
  }
  if(action==='taxrole-rule-confirm'){
   const r=(cur?.rules||[]).find(x=>x.rule_id===id);if(!r)return true;
   modal('Record confirmation · '+(KIND_LABEL[r.tax_kind]||r.tax_kind),form(area('source_note','Who confirmed this rule, and where it is written (for example the Tax Lead\'s memo and its date) *','',true),'Record confirmation'),
    f=>request({action:'annual_due_rule_confirm',rule_id:id,revision:r.revision,source_note:f.get('source_note')}),open);
   return true;
  }
  return false;
 }
 return {card,handle,open};
}
