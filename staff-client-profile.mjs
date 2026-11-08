// Client profile page: one place per client with six tabs. It reuses the data the workspace already loaded and the existing screens
// (edit client, KYC and contacts, tax profile, set-up guide, projects, tasks), so access rules do not change: the server already
// trims what each role receives. Tabs: Overview, Contacts, Projects & Tasks, Documents/KYC, Communication & Activity, Tax Obligations.
export const PROFILE_TABS=[['overview','Overview'],['contacts','Contacts'],['projects','Projects & Tasks'],['documents','Documents / KYC'],['activity','Communication & Activity'],['tax','Tax Obligations']];

export function clientProfile(ctx){
 const {data:d,clientId,tab='overview',esc,shortDate,badge,staffName,structureLabel,progress,status,step,leader}=ctx;
 const c=d.clients.find(x=>x.client_id===clientId);
 const back='<button type="button" data-view="clients">Back to clients</button>';
 if(!c)return `<section class="card"><h2>Client unavailable</h2><p>This client is not available in your current workspace. Refresh, or ask your Manager to check your assignment.</p>${back}</section>`;
 const id=esc(c.client_id),suite=d.suite||{},seen=!!c.details_visible;
 const cur=PROFILE_TABS.some(([k])=>k===tab)?tab:'overview';
 const btn=(attrs,label,cls='')=>`<button type="button" class="${cls}" ${attrs}>${esc(label)}</button>`;
 const projects=d.projects.filter(p=>p.client_id===c.client_id),pids=new Set(projects.map(p=>p.project_id));
 const open=t=>!['Completed','Cancelled'].includes(t.status),tasks=d.tasks.filter(t=>pids.has(t.project_id));
 const contacts=(suite.contacts||[]).filter(x=>x.client_id===c.client_id);
 const table=(heads,rows,empty)=>rows.length?`<div class="scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`:`<p class="empty">${esc(empty)}</p>`;
 const pane={
  overview:()=>{
   const fields=[['KRA PIN',c.kra_pin],['Sector',c.primary_sector],['Branch',c.branch_location],['Legal structure',structureLabel?structureLabel(c,esc).replace(/<[^>]*>/g,''):c.legal_structure],['Accounting family',c.legal_entity_type],['Financial year-end',c.year_end_month&&c.year_end_day?`${String(c.year_end_day).padStart(2,'0')}/${String(c.year_end_month).padStart(2,'0')}`:''],['Incorporation date',c.incorporation_date],['Entity evidence',c.entity_evidence],['Client owner',c.owner_staff_id?staffName(c.owner_staff_id):'']];
   const pills=leader&&progress?`<div class="cc-pills"><span class="cc-pill ${progress.kycOk?'ok':'warn'}"><i>${progress.kycOk?'✓':'!'}</i>KYC &amp; contacts</span><span class="cc-pill ${progress.taxOk?'ok':'warn'}"><i>${progress.taxOk?'✓':'!'}</i>Tax profile</span><span class="cc-pill ${progress.activitiesOk===null?'na':progress.activitiesOk?'ok':'warn'}"><i>${progress.activitiesOk===null?'…':progress.activitiesOk?'✓':'!'}</i>Entity &amp; activities</span></div>${step?`<p><b>Next step:</b> ${esc(step.title)}${step.detail?` · ${esc(step.detail)}`:''}</p>`:''}`:'';
   return `${pills}${seen?`<div class="scroll"><table><tbody>${fields.map(([l,v])=>`<tr><th>${esc(l)}</th><td>${esc(v||'Not recorded')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="info">Client details open once work for this client is allocated to you.</p>'}${leader?`<div class="actions section-space">${btn(`data-client="${id}"`,'Edit client details')}${btn(`data-setup-guide="${id}"`,'Open set-up guide','primary')}${btn(`data-client-accounts="${id}"`,'Client accounts')}</div>`:''}`;
  },
  contacts:()=>`${table(['Name','Position','Role','Email','Phone'],contacts.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.job_title||'')}</td><td>${esc(x.role_in_decision||'')}</td><td>${esc(x.email_address||'')}</td><td>${esc(x.phone_number||'')}</td></tr>`),'No contacts recorded yet.')}${leader?`<div class="actions section-space">${btn(`data-suite="compliance" data-id="${id}"`,'Add or edit contacts','primary')}</div>`:''}`,
  projects:()=>`${projects.length?projects.map(p=>{const mine=tasks.filter(t=>t.project_id===p.project_id),o=mine.filter(open);return `<div class="task"><div><b>${esc(p.project_name)}</b><small>${esc(p.status||'')} · ${o.length} open of ${mine.length} tasks</small></div>${btn(`data-open-project="${esc(p.project_id)}"`,'Open project')}</div>`;}).join(''):'<p class="empty">No project is linked to this client yet.</p>'}${tasks.filter(open).length?`<h3>Open tasks</h3>${table(['Task','Status','Due','Assigned to'],tasks.filter(open).slice(0,25).map(t=>`<tr><td>${btn(`data-open-task="${esc(t.task_id)}"`,t.task_name,'link')}</td><td>${badge(t.status)}</td><td>${esc(t.due_at?shortDate(t.due_at):'—')}</td><td>${esc(staffName(t.assigned_to))}</td></tr>`),'')}`:''}`,
  documents:()=>{
   const comp=(suite.compliance||[]).find(x=>x.client_id===c.client_id),ev=(suite.kyc_evidence||[]).filter(x=>x.client_id===c.client_id),files=d.documents.filter(x=>x.client_id===c.client_id&&!x.deleted_at);
   return `<p>${comp?.verified_at?`<span class="badge good">KYC verified</span> ${esc(shortDate(comp.verified_at))}`:'<span class="badge warn">KYC not verified</span>'}</p><h3>KYC evidence</h3>${table(['Document','Form','Covers'],ev.map(x=>`<tr><td>${esc(x.document_type||'')}</td><td>${esc(x.evidence_form||'')}</td><td>${esc(Array.isArray(x.covered_items)?x.covered_items.join(', '):x.covered_items||'')}</td></tr>`),'No KYC evidence recorded yet.')}${leader?`<div class="actions section-space">${btn(`data-suite="compliance" data-id="${id}"`,'Open KYC &amp; evidence'.replace('&amp;','&'),'primary')}</div>`:''}<h3>Files</h3>${table(['File','Category','Added','Action'],files.slice(0,50).map(f=>`<tr><td>${esc(f.file_name)}</td><td>${esc(f.category||'')}</td><td>${esc(f.uploaded_at?shortDate(f.uploaded_at):'')}</td><td>${btn(`data-download="${esc(f.document_id)}"`,'Download')}</td></tr>`),'No files linked to this client yet.')}`;
  },
  activity:()=>{
   const comms=(suite.communications||[]).filter(x=>x.client_id===c.client_id).map(x=>({at:x.communication_date,kind:x.channel,text:x.subject,note:x.channel==='Internal note'?'Internal':'Client communication'}));
   const kyc=(suite.kyc_changes||[]).filter(x=>x.client_id===c.client_id).map(x=>({at:x.recorded_at,kind:'KYC change',text:x.change_reason||'KYC record changed',note:'Internal'}));
   const items=[...comms,...kyc].sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,60);
   return items.length?items.map(i=>`<div class="task"><div><b>${esc(i.kind)}</b> · ${esc(i.text)}<small>${esc(shortDate(i.at))} · ${esc(i.note)}</small></div></div>`).join(''):'<p class="empty">No communication or changes recorded for this client yet.</p>';
  },
  tax:()=>{
   const tps=(suite.tax_profiles||[]).filter(x=>x.client_id===c.client_id);
   return `${table(['Status','From','To','Entity','Regime'],tps.map(x=>`<tr><td>${badge(x.status)}</td><td>${esc(shortDate(x.effective_from))}</td><td>${esc(x.effective_to?shortDate(x.effective_to):'Open')}</td><td>${esc(x.entity_type||'')}</td><td>${esc(x.regime||'')}</td></tr>`),'No tax profile recorded yet.')}${leader?`<div class="actions section-space">${btn(`data-suite="tax-profile" data-id="${id}"`,'Open tax profile','primary')}</div>`:''}<p class="muted">A tax profile says which returns apply. No tax rate is entered here; rates come from the dated rules register.</p>`;
  }
 }[cur]();
 const tabs=`<div class="tabs" role="tablist" aria-label="Client file sections">${PROFILE_TABS.map(([k,l])=>`<button type="button" role="tab" id="cptab-${k}" aria-selected="${k===cur}" aria-controls="cppane" data-cprofile-tab="${k}" class="${k===cur?'on':''}">${esc(l)}</button>`).join('')}</div>`;
 return `<div class="workspace-breadcrumb" role="navigation" aria-label="Client breadcrumb"><a href="#view=clients" data-workspace-view="clients">Clients</a><span aria-hidden="true">/</span><span aria-current="page">${esc(c.company_name)}</span></div>
 <section class="card client-profile" aria-labelledby="clientProfileTitle"><div class="section-head"><div><span class="eyebrow">CLIENT FILE</span><h2 id="clientProfileTitle" tabindex="-1">${esc(c.company_name)}</h2>${seen?`<p class="muted">${esc([c.kra_pin||'KRA PIN missing',structureLabel?structureLabel(c,esc).replace(/<[^>]*>/g,''):''].filter(Boolean).join(' · '))}</p>`:''}</div>${status?`<span class="badge ${esc(status.tone)}">${esc(status.label)}</span>`:''}</div>${tabs}<div id="cppane" role="tabpanel" aria-labelledby="cptab-${cur}" class="section-space">${pane}</div></section>`;
}
