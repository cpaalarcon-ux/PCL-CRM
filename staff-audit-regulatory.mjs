// S2: legal reference, regulatory calendar and legislative monitoring registers, shown on the Audit home page.
// Nothing here is legal advice. A date is shown only after a Partner has confirmed the rule against a primary-source reference.
const APPLIES=[['DT_SACCO','Deposit-taking SACCOs'],['NWDT_SACCO','Non-withdrawable-deposit-taking SACCOs'],['ALL_SACCO','All SACCOs'],['OTHER','Other entities']];
const INSTRUMENTS=['Act','Regulation','Circular','Guidance','Standard','Bill','Other'];
const LEGAL=['Not yet confirmed','In force','Binding direction','Guidance only','Consultation','Proposed (Bill)','Repealed'];
const VERIFY=['Unverified','Secondary source','Primary source verified'];
const RULES=['Unresolved','Period after year end','Fixed date each year'];
const DIRECTIONS=[['','Not set'],['On or before','On or before (a limit)'],['Not earlier than','Not earlier than (an earliest date)'],['On','On the date']];
const MONITOR=['Bill','Regulation change','Circular','Consultation','Court decision','Standard','Other'];
const OUTCOMES=['No change','Changed - needs review','Action needed','Closed'];
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const appliesLabel=list=>(list||[]).map(x=>APPLIES.find(a=>a[0]===x)?.[1]||x).join(', ');
export function ruleSummary(c){
 if(!c||c.rule_type==='Unresolved')return 'Rule not entered yet';
 const dir=c.direction||'direction not set';
 if(c.rule_type==='Period after year end')return `${[c.offset_months!=null?c.offset_months+' month(s)':'',c.offset_days!=null?c.offset_days+' day(s)':''].filter(Boolean).join(' and ')} after the year end · ${dir}`;
 return `${c.fixed_day} ${MONTHS[(c.fixed_month||1)-1]} each year · ${dir}`;
}
export function registerSummary(reg){
 if(!reg)return null;
 const refs=reg.references||[],cal=reg.calendar||[],mon=reg.monitor||[];
 return {references:refs.length,unverifiedRefs:refs.filter(r=>r.verification!=='Primary source verified').length,
  rulesConfirmed:cal.filter(c=>c.status==='Confirmed').length,rulesTotal:cal.length,monitorOverdue:mon.filter(m=>m.overdue).length,monitorOpen:mon.filter(m=>m.status!=='Closed').length};
}
export function createRegulatoryUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const leader=()=>['MANAGER','PARTNER'].includes(staff().category_code),partner=()=>staff().category_code==='PARTNER';
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 const day=v=>v?esc(shortDate(v)):'—';
 const area=(name,label,value='',required=false,max=1000)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${required?'required':''}>${esc(value||'')}</textarea></label>`;
 const appliesBoxes=(current=['ALL_SACCO'])=>`<fieldset class="full"><legend>Applies to *</legend>${APPLIES.map(([v,l])=>`<label class="inline"><input type="checkbox" name="applies_to" value="${v}" ${current.includes(v)?'checked':''}> ${esc(l)}</label>`).join(' ')}</fieldset>`;
 const verifTone=v=>v==='Primary source verified'?'ok':v==='Secondary source'?'warn':'bad';
 function panel(reg){
  if(!reg)return '';
  const s=registerSummary(reg);
  return `<details class="card section-space audit-registers"><summary><b>Legal and regulatory registers</b> · ${s.references} references (${s.unverifiedRefs} not verified from the primary source) · ${s.rulesConfirmed}/${s.rulesTotal} calendar rules confirmed · ${s.monitorOverdue} monitoring checks due</summary>
  <div class="info">These registers are the firm's own record. They are not legal advice. The ERP shows a deadline only after a Partner has confirmed the rule against a reference verified from the primary source, and it keeps each rule's wording exactly as it was reported.</div>
  ${references(reg)}${calendar(reg)}${monitor(reg)}</details>`;
 }
 function references(reg){
  const rows=reg.references||[];
  return `<section class="section-space"><div class="section-head"><h3>Legal references</h3><div class="actions">${leader()?'<button data-reg-ref-edit="new">Add reference</button>':''}</div></div>
  <div class="scroll"><table><thead><tr><th>Reference</th><th>Type</th><th>Legal status</th><th>Applies to</th><th>Verification</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.title)}</b><br><small>${esc(r.ref_code)}${r.citation?' · '+esc(r.citation):''}</small>${r.summary?`<br><small class="muted">${esc(r.summary)}</small>`:''}</td><td>${esc(r.instrument_type)}</td><td>${badge(r.legal_status,r.legal_status==='Proposed (Bill)'?'warn':'')}</td><td>${esc(appliesLabel(r.applies_to))}</td>
   <td>${badge(r.verification,verifTone(r.verification))}${r.verified_at?`<br><small>${esc(r.verified_by_name||'')} · ${day(r.verified_at)}</small>`:''}${r.source_url?`<br><a href="${esc(r.source_url)}" target="_blank" rel="noopener noreferrer">Source</a>`:''}</td>
   <td class="actions">${leader()?`<button data-reg-ref-edit="${esc(r.ref_id)}">Edit</button>`:''}${partner()?`<button data-reg-ref-verify="${esc(r.ref_id)}">Verify</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">No references yet.</td></tr>'}</tbody></table></div></section>`;
 }
 function calendar(reg){
  const rows=reg.calendar||[];
  return `<section class="section-space"><div class="section-head"><h3>Regulatory calendar</h3><div class="actions">${leader()?'<button data-reg-cal-edit="new">Add item</button>':''}</div></div>
  <div class="scroll"><table><thead><tr><th>Obligation</th><th>As reported (verbatim)</th><th>Rule</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td><b>${esc(c.title)}</b><br><small>${esc(appliesLabel(c.applies_to))}${c.reference_title?' · '+esc(c.reference_title):''}</small></td>
   <td>${esc(c.as_reported)}${c.conflicting_wording?`<br><small class="missing">${esc(c.conflicting_wording)}</small>`:''}</td><td>${esc(ruleSummary(c))}</td>
   <td>${c.status==='Confirmed'?badge('Confirmed','ok')+`<br><small>${esc(c.confirmed_by_name||'')} · ${day(c.confirmed_at)}</small>`:badge('Unconfirmed — no date shown','warn')}</td>
   <td class="actions">${leader()?`<button data-reg-cal-edit="${esc(c.item_id)}">Edit</button>`:''}${c.status==='Confirmed'?`<button data-reg-cal-due="${esc(c.item_id)}">Date for a year end</button>`:''}${partner()&&c.status!=='Confirmed'?`<button data-reg-cal-confirm="${esc(c.item_id)}">Confirm rule</button>`:''}${partner()&&c.status==='Confirmed'?`<button data-reg-cal-withdraw="${esc(c.item_id)}">Withdraw</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="muted">No items yet.</td></tr>'}</tbody></table></div></section>`;
 }
 function monitor(reg){
  const rows=reg.monitor||[];
  return `<section class="section-space"><div class="section-head"><h3>Legislative monitoring</h3><div class="actions">${leader()?'<button data-reg-mon-edit="new">Add item to watch</button>':''}</div></div>
  <div class="scroll"><table><thead><tr><th>Item</th><th>Status</th><th>Last checked</th><th>Next check</th><th>Owner</th><th></th></tr></thead><tbody>${rows.map(m=>`<tr><td><b>${esc(m.title)}</b><br><small>${esc(m.item_type)}${m.source_body?' · '+esc(m.source_body):''}</small>${m.note?`<br><small class="muted">${esc(m.note)}</small>`:''}</td>
   <td>${badge(m.status,m.status==='Reviewed - action needed'?'bad':m.status==='Closed'?'':'warn')}</td><td>${day(m.last_checked_on)}</td><td>${m.status==='Closed'?'—':m.next_check_due?day(m.next_check_due)+(m.overdue?' '+badge('Due','bad'):''):badge('Not scheduled','bad')}</td><td>${esc(m.owner_name||'—')}</td>
   <td class="actions">${leader()&&m.status!=='Closed'?`<button data-reg-mon-check="${esc(m.entry_id)}">Log check</button><button data-reg-mon-edit="${esc(m.entry_id)}">Edit</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">Nothing is being watched yet.</td></tr>'}</tbody></table></div></section>`;
 }
 async function handle(b){
  const R=ctx.register?.();
  if(b.dataset.regRefEdit){
   const id=b.dataset.regRefEdit,r=id==='new'?{}:(R?.references||[]).find(x=>x.ref_id===id);if(id!=='new'&&!r)return true;
   const warn=r.verification&&r.verification!=='Unverified'?'<p class="info full">Changing the substance of a verified reference sends it back to Unverified, and any calendar rule that depends on it back to Unconfirmed.</p>':'';
   modal(id==='new'?'Add legal reference':'Edit legal reference',form(warn+(id==='new'?field('ref_code','Short code *','','text','required maxlength="60" placeholder="e.g. SACCO-ACT-2008"'):'')+field('title','Title *',r.title||'','text','required maxlength="300"')+select('instrument_type','Type *',INSTRUMENTS,r.instrument_type||'Act')+select('legal_status','Legal status',LEGAL,r.legal_status||'Not yet confirmed')+
    field('citation','Citation (section, regulation, page)',r.citation||'','text','maxlength="500"')+field('issuing_body','Issued by',r.issuing_body||'','text','maxlength="200"')+appliesBoxes(r.applies_to||['ALL_SACCO'])+field('source_url','Primary-source web address',r.source_url||'','url','maxlength="500"')+area('summary','Summary (no figures unless checked)',r.summary||'',false,2000),'Save reference'),
    f=>request({action:'audit_reg_reference_save',ref_id:id==='new'?null:id,revision:r.revision,ref_code:f.get('ref_code'),title:f.get('title'),instrument_type:f.get('instrument_type'),legal_status:f.get('legal_status'),citation:f.get('citation'),issuing_body:f.get('issuing_body'),applies_to:f.getAll('applies_to'),source_url:f.get('source_url'),summary:f.get('summary')}),()=>ctx.refresh());
   return true;
  }
  if(b.dataset.regRefVerify){
   const r=(R?.references||[]).find(x=>x.ref_id===b.dataset.regRefVerify);if(!r)return true;
   modal('Partner verification · '+r.title,form(`<p class="full">Set how far this reference has been checked. <b>Primary source verified</b> means you read the Act, regulation or circular itself (for example on the Kenya Law or SASRA site), not a summary of it. It needs the web address and a legal status.</p>`+select('level','Verification level *',VERIFY,r.verification)+area('note','What you checked and where *',r.verification_note||'',true),'Record verification'),
    f=>request({action:'audit_reg_reference_verify',ref_id:r.ref_id,revision:r.revision,level:f.get('level'),note:f.get('note')}),res=>{if(res?.rules_unconfirmed)notice?.(`${res.rules_unconfirmed} calendar rule(s) went back to Unconfirmed.`);ctx.refresh();});
   return true;
  }
  if(b.dataset.regCalEdit){
   const id=b.dataset.regCalEdit,c=id==='new'?{}:(R?.calendar||[]).find(x=>x.item_id===id);if(id!=='new'&&!c)return true;
   const refs=(R?.references||[]).map(x=>[x.ref_id,x.title+(x.verification==='Primary source verified'?'':' (not verified from primary source)')]);
   modal(id==='new'?'Add calendar item':'Edit calendar item',form((c.status==='Confirmed'?'<p class="info full">Changing the rule sends it back to Unconfirmed until a Partner confirms it again.</p>':'')+(id==='new'?field('item_code','Short code *','','text','required maxlength="60" placeholder="e.g. AGM"'):'')+field('title','Obligation *',c.title||'','text','required maxlength="300"')+
    select('reference_id','Legal reference',[['','None yet'],...refs],c.reference_id||'')+appliesBoxes(c.applies_to||['ALL_SACCO'])+area('as_reported','Wording as reported — keep it verbatim *',c.as_reported||'',true)+area('conflicting_wording','Conflicting wording or doubt, if any',c.conflicting_wording||'')+
    select('rule_type','Rule type',RULES,c.rule_type||'Unresolved')+field('offset_months','Months after year end',c.offset_months??'','number','min="0" max="24"')+field('offset_days','Extra days',c.offset_days??'','number','min="0" max="366"')+
    select('fixed_month','Month (fixed date)',[['','—'],...MONTHS.map((m,i)=>[String(i+1),m])],c.fixed_month?String(c.fixed_month):'')+field('fixed_day','Day (fixed date)',c.fixed_day??'','number','min="1" max="31"')+select('direction','Direction',DIRECTIONS,c.direction||''),'Save item'),
    f=>request({action:'audit_reg_calendar_save',item_id:id==='new'?null:id,revision:c.revision,item_code:f.get('item_code'),title:f.get('title'),reference_id:f.get('reference_id')||null,applies_to:f.getAll('applies_to'),as_reported:f.get('as_reported'),conflicting_wording:f.get('conflicting_wording'),
     rule_type:f.get('rule_type'),offset_months:f.get('offset_months'),offset_days:f.get('offset_days'),fixed_month:f.get('fixed_month'),fixed_day:f.get('fixed_day'),direction:f.get('direction')||null}),()=>ctx.refresh());
   return true;
  }
  if(b.dataset.regCalConfirm){
   const c=(R?.calendar||[]).find(x=>x.item_id===b.dataset.regCalConfirm);if(!c)return true;
   modal('Partner confirmation · '+c.title,form(`<p class="full"><b>As reported:</b> ${esc(c.as_reported)}</p><p class="full"><b>Rule entered:</b> ${esc(ruleSummary(c))}</p><p class="info full">Confirm only after reading the primary text. The linked reference must be verified from the primary source.</p>`+area('note','How you confirmed the rule *','',true),'Confirm rule'),
    f=>request({action:'audit_reg_calendar_confirm',item_id:c.item_id,revision:c.revision,note:f.get('note')}),()=>ctx.refresh());
   return true;
  }
  if(b.dataset.regCalWithdraw){
   const c=(R?.calendar||[]).find(x=>x.item_id===b.dataset.regCalWithdraw);if(!c)return true;
   modal('Withdraw confirmation · '+c.title,form(area('note','Why is the rule being withdrawn? *','',true),'Withdraw'),f=>request({action:'audit_reg_calendar_withdraw',item_id:c.item_id,note:f.get('note')}),()=>ctx.refresh());
   return true;
  }
  if(b.dataset.regCalDue){
   const c=(R?.calendar||[]).find(x=>x.item_id===b.dataset.regCalDue);if(!c)return true;
   modal('Date for a financial year · '+c.title,form(field('year_end','Financial year end *','','date','required')+`<p class="info full">${esc(ruleSummary(c))}. Wording as reported: ${esc(c.as_reported)}</p>`,'Show date'),
    f=>request({action:'audit_reg_due_date',item_id:c.item_id,year_end:f.get('year_end')}),res=>notice?.(res?.due?`${res.due.direction}: ${shortDate(res.due.date)}`:'No date: the rule is not confirmed.'),{refreshWorkspace:false});
   return true;
  }
  if(b.dataset.regMonEdit){
   const id=b.dataset.regMonEdit,m=id==='new'?{}:(R?.monitor||[]).find(x=>x.entry_id===id);if(id!=='new'&&!m)return true;
   const refs=[['','None'],...(R?.references||[]).map(x=>[x.ref_id,x.title])];
   modal(id==='new'?'Add item to watch':'Edit monitored item',form(field('title','What are we watching? *',m.title||'','text','required maxlength="300"')+select('item_type','Type *',MONITOR,m.item_type||'Bill')+field('source_body','Where it is published',m.source_body||'','text','maxlength="200"')+select('reference_id','Related reference',refs,m.reference_id||'')+
    field('next_check_due','Next check *',m.next_check_due?String(m.next_check_due).slice(0,10):'','date','required')+area('note','Note',m.note||'',false,2000),'Save'),
    f=>request({action:'audit_reg_monitor_save',entry_id:id==='new'?null:id,revision:m.revision,title:f.get('title'),item_type:f.get('item_type'),source_body:f.get('source_body'),reference_id:f.get('reference_id')||null,next_check_due:f.get('next_check_due'),note:f.get('note')}),()=>ctx.refresh());
   return true;
  }
  if(b.dataset.regMonCheck){
   const m=(R?.monitor||[]).find(x=>x.entry_id===b.dataset.regMonCheck);if(!m)return true;
   modal('Log a check · '+m.title,form(select('outcome','Outcome *',OUTCOMES.filter(o=>o!=='Closed'||partner()),'No change')+area('note','What you looked at and found *','',true)+field('next_check_due','Next check (not needed when closing)','','date')+'<p class="info full">Only a Partner can close an item. A change or an action needed alerts the Partners.</p>','Log check'),
    f=>request({action:'audit_reg_monitor_check',entry_id:m.entry_id,outcome:f.get('outcome'),note:f.get('note'),next_check_due:f.get('next_check_due')||null}),()=>ctx.refresh());
   return true;
  }
  return false;
 }
 return {panel,handle};
}
