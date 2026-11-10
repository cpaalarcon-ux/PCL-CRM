// Forensic restricted file. The rules live in the database (20261110266000_forensic_file.sql) and the server (forensic-actions.ts, index.ts);
// this file draws the screens and sends the requests. A forensic file is visible only to the people on its access list.
// Other Partners and administrators do not see it, and it appears in no "All work" view. It has its own list, opened from the menu.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
const when=v=>v?String(v).replace('T',' ').slice(0,16):'';
export const FORENSIC_NOTE='Only the lead Partner and the people the lead adds can see a forensic file. Other Partners and administrators cannot see it, and it is in no "All work" list. Every opening, download and change is recorded in the file’s own log.';
export const STANDARD_NOTE='The forensic standard reference stays a placeholder until the Compliance Lead has verified it in writing and a Partner records it in Settings. By default (a recommendation, not yet confirmed) a report cannot be issued while it is unverified.';
export const LEVEL_WORDS={Lead:'Lead Partner',Investigator:'Investigator (can add evidence, findings and the report)',Viewer:'Viewer (read only)'};
export const STATUS_TONE={Open:'info',Issued:'ok'};
export const CUSTODY_EVENTS=['Transferred','Examined','Copied','Sealed','Returned'];
const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
export const sizeText=bytes=>{const n=Number(bytes);if(!Number.isFinite(n)||n<=0)return '';return n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;};
export const settingStatus=s=>s.rule_status==='Confirmed'?`Confirmed${s.confirmed_at?' on '+day(s.confirmed_at):''}`:'Default - not yet confirmed';
export const canWrite=g=>['Lead','Investigator'].includes(g.my_level)&&g.case.status==='Open';
export const isLead=g=>g.my_level==='Lead';
export const holdActive=g=>(g.holds||[]).length>0&&g.holds[g.holds.length-1].action==='Set';
export function standardText(std){
 if(!std)return '';
 return std.status==='Confirmed'?`${std.reference} (verified)`:`${std.reference} (not verified)`;
}
export function issueBlocker(g){
 const live=(g.evidence||[]).filter(e=>!e.withdrawn_at),finds=(g.findings||[]).filter(f=>!f.withdrawn_at);
 if(g.case.status!=='Open')return 'The report has been issued and the file is locked.';
 if(!(g.reports||[]).length)return 'Save the report first.';
 if(!live.length)return 'Add at least one item of evidence first.';
 if(!finds.length)return 'Record at least one finding first.';
 if(g.standard?.needs_verified&&g.standard.status!=='Confirmed')return 'The forensic standard reference has not been verified yet (Settings).';
 return '';
}

export function listView({r,me,button}){
 const cases=r.cases||[];
 let html=`<p class="info full">${esc(FORENSIC_NOTE)}</p><div class="actions full">${r.can_open?button('forensic-new','+ Open a forensic file','','class="primary"'):''}${me?.category_code==='PARTNER'?button('forensic-settings','Settings'):''}</div>`;
 if(!cases.length)return html+`<p class="muted full">${r.can_open?'You are not on any forensic file yet.':'You are not on the access list of any forensic file.'}</p>`;
 return html+`<div class="scroll full"><table id="forensicList"><thead><tr><th>File</th><th>Client</th><th>Lead</th><th>Evidence</th><th>Findings</th><th>Status</th><th></th></tr></thead><tbody>${cases.map(c=>
  `<tr><td><b>${esc(c.case_ref)}</b><br><small>${esc(c.title)}</small></td><td>${esc(c.client_name)}<br><small>${esc(c.firm_code)}</small></td><td>${esc(c.lead_name)}<br><small>${esc(c.my_level==='Lead'?'You':'Your access: '+c.my_level)}</small></td>`
  +`<td>${esc(c.evidence_count)}</td><td>${esc(c.finding_count)}</td><td>${badge(c.status,STATUS_TONE[c.status]||'')}${c.hold_active?' '+badge('Litigation hold','warn'):''}</td><td>${button('forensic-case','Open',c.case_id)}</td></tr>`).join('')}</tbody></table></div>`;
}

export function accessView(g,button){
 const lead=isLead(g);
 return `<h3>People who can see this file</h3><div class="scroll"><table><thead><tr><th>Person</th><th>Access</th><th>Added</th><th></th></tr></thead><tbody>${(g.access||[]).map(x=>
  `<tr${x.removed_at?' class="muted"':''}><td>${esc(x.full_name)}<br><small>${esc(x.category_code)}</small></td><td>${esc(x.level)}${x.removed_at?' · removed '+esc(day(x.removed_at))+': '+esc(x.removed_reason):''}</td><td>${esc(day(x.added_at))}<br><small>by ${esc(x.added_by_name)}</small></td>`
  +`<td>${lead&&!x.removed_at&&x.level!=='Lead'?button('forensic-access-level','Change',x.staff_id)+' '+button('forensic-access-remove','Remove',x.staff_id):''}</td></tr>`).join('')}</tbody></table></div>`
  +(lead?`<div class="actions">${button('forensic-access-add','+ Add a person')}${button('forensic-lead-transfer','Hand over the lead')}</div>`:'');
}
export function evidenceView(g,button){
 const write=canWrite(g),lead=isLead(g)&&g.case.status==='Open',ev=g.evidence||[];
 return `<h3>Evidence</h3>${write?`<div class="actions">${button('forensic-evidence-add','+ Add evidence','','class="primary"')}</div>`:''}`
  +(ev.length?`<div class="scroll"><table id="forensicEvidence"><thead><tr><th>#</th><th>Item</th><th>SHA-256</th><th>Chain of custody</th><th></th></tr></thead><tbody>${ev.map(e=>
   `<tr${e.withdrawn_at?' class="muted"':''}><td>${esc(e.evidence_no)}</td><td><b>${esc(e.description)}</b><br><small>${esc(e.file_name)}${sizeText(e.file_size_bytes)?' · '+esc(sizeText(e.file_size_bytes)):''} · obtained ${esc(day(e.obtained_on))}<br>${esc(e.source_note)}</small>${e.withdrawn_at?'<br>'+badge('Withdrawn','muted')+' <small>'+esc(e.withdrawn_reason)+'</small>':''}</td>`
   +`<td><small style="word-break:break-all">${esc(e.sha256)}</small></td>`
   +`<td><details><summary>${esc((e.custody||[]).length)} entr${(e.custody||[]).length===1?'y':'ies'}</summary><ol>${(e.custody||[]).map(k=>`<li>${esc(when(k.event_at))} · <b>${esc(k.event_type)}</b>${k.from_holder?' from '+esc(k.from_holder):''}${k.to_holder?' to '+esc(k.to_holder):''}${k.note?' · '+esc(k.note):''}<br><small>recorded by ${esc(k.recorded_by_name)}</small></li>`).join('')}</ol></details></td>`
   +`<td>${button('forensic-evidence-file','Open',e.evidence_id)}${['Lead','Investigator'].includes(g.my_level)&&!e.withdrawn_at?' '+button('forensic-custody-add','Custody',e.evidence_id):''}${lead&&!e.withdrawn_at?' '+button('forensic-evidence-withdraw','Withdraw',e.evidence_id):''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No evidence has been added yet.</p>');
}
export function findingsView(g,button){
 const write=canWrite(g),lead=isLead(g)&&g.case.status==='Open',fs=g.findings||[];
 return `<h3>Findings</h3><p class="muted">Every finding must cite at least one item of evidence.</p>${write?`<div class="actions">${button('forensic-finding-add','+ Add a finding')}</div>`:''}`
  +(fs.length?`<ol>${fs.map(f=>`<li${f.withdrawn_at?' class="muted"':''}><b>${esc(f.title)}</b> ${badge('Evidence '+(f.evidence_nos||[]).join(', '))}${f.withdrawn_at?' '+badge('Withdrawn','muted'):''}<br>${esc(f.description)}<br><small>${esc(day(f.recorded_at))} by ${esc(f.recorded_by_name)}${f.withdrawn_at?' · withdrawn: '+esc(f.withdrawn_reason):''}</small>${lead&&!f.withdrawn_at?' '+button('forensic-finding-withdraw','Withdraw',f.finding_id):''}</li>`).join('')}</ol>`:'<p class="muted">No findings yet.</p>');
}
export function reportView(g,button){
 const write=canWrite(g),lead=isLead(g),blocker=issueBlocker(g),issued=g.case.status==='Issued';
 let html=`<h3>Report</h3><p class="info">${esc(STANDARD_NOTE)}</p><p><b>Standard reference:</b> ${esc(issued?g.case.issued_standard_reference:standardText(g.standard))}</p>`;
 html+=g.report_body?`<pre style="white-space:pre-wrap">${esc(g.report_body)}</pre>`:'<p class="muted">No report has been saved yet.</p>';
 html+=`<p class="muted">${(g.reports||[]).map(r=>`Version ${esc(r.version)} by ${esc(r.saved_by_name)} on ${esc(day(r.saved_at))}${r.issued?' (issued)':''}`).join(' · ')}</p>`;
 if(issued)html+=`<p>${badge('Issued','ok')} Issued by ${esc(g.case.issued_by_name)} on ${esc(day(g.case.issued_at))}. The file is locked. Report fingerprint: <small style="word-break:break-all">${esc(g.case.issued_report_sha256)}</small></p>`;
 else html+=`<div class="actions">${write?button('forensic-report-edit',g.report_body?'Edit the report (saves a new version)':'Write the report'):''}${lead?button('forensic-report-issue','Issue the report',g.case.case_id,blocker?'disabled title="'+esc(blocker)+'"':'class="primary"'):''}</div>${lead&&blocker?`<p class="muted">${esc(blocker)}</p>`:''}`;
 return html;
}
export function holdView(g,button){
 const lead=isLead(g),hs=g.holds||[];
 return `<h3>Litigation hold</h3>${holdActive(g)?`<p>${badge('In force','warn')} Nothing in this file is to be changed or destroyed. Nothing here is ever deleted.</p>`:'<p class="muted">No litigation hold is in force.</p>'}`
  +(hs.length?`<ul>${hs.map(h=>`<li><b>${esc(h.action)}</b> ${esc(when(h.recorded_at))} by ${esc(h.recorded_by_name)}: ${esc(h.note)}</li>`).join('')}</ul>`:'')
  +(lead?`<div class="actions">${holdActive(g)?button('forensic-hold-release','Release the hold'):button('forensic-hold-set','Set a litigation hold')}</div>`:'');
}
export function logView(g){
 return `<details><summary>Log of openings, downloads and changes (${esc((g.events||[]).length)})</summary><ul>${(g.events||[]).map(e=>`<li>${esc(when(e.occurred_at))} · ${esc(e.actor_name)} · <b>${esc(e.event_type)}</b>${e.detail?' · '+esc(e.detail):''}</li>`).join('')}</ul></details>`;
}
export function caseView({g,button}){
 const c=g.case;
 return `<p class="info full">${esc(FORENSIC_NOTE)}</p><p><b>${esc(c.case_ref)}</b> · ${badge(c.status,STATUS_TONE[c.status]||'')} ${holdActive(g)?badge('Litigation hold','warn'):''} · Client: ${esc(c.client_name)} (${esc(c.firm_code)}) · Lead: ${esc(c.lead_name)} · Your access: ${esc(LEVEL_WORDS[g.my_level]||g.my_level)}</p>`
  +`<h3>Mandate</h3><p>${esc(c.mandate_text)}</p><p class="muted">Mandate dated ${esc(day(c.mandate_date))}. Opened ${esc(day(c.opened_at))}.</p>`
  +holdView(g,button)+evidenceView(g,button)+findingsView(g,button)+reportView(g,button)+accessView(g,button)+logView(g);
}
export function settingsView({r,button}){
 return `<p class="info full">${esc(STANDARD_NOTE)}</p><div class="scroll full"><table id="forensicSettings"><thead><tr><th>Setting</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${(r.settings||[]).map(s=>
  `<tr><td>${esc(s.label)}</td><td>${esc(s.text_value)}</td><td>${badge(settingStatus(s),s.rule_status==='Confirmed'?'ok':'warn')}${s.source_note?'<br><small>'+esc(s.source_note)+'</small>':''}</td><td>${button('forensic-setting-set','Change',s.setting_key)}${s.rule_status!=='Confirmed'?' '+button('forensic-setting-confirm','Record confirmation',s.setting_key):''}</td></tr>`).join('')}</tbody></table></div>`;
}

export function createForensicUI(ctx){
 const {$,field,select,form,modal,request,notice,button,area,today}=ctx,d=()=>ctx.data();
 let cur=null,settingsCache=null;
 const checkbox=(name,label,checked=false)=>`<label class="full"><input type="checkbox" name="${name}" value="true"${checked?' checked':''}> ${esc(label)}</label>`;
 const showList=async()=>{const r=await request({action:'forensic_list'});modal('Forensic files',listView({r,me:d().me,button}));};
 const showCase=async id=>{cur=await request({action:'forensic_get',case_id:id});modal('Forensic file · '+cur.case.case_ref,caseView({g:cur,button}));};
 const send=(title,body,action,extra,label='Save',map=f=>Object.fromEntries(f))=>modal(title,form(body,label),f=>request({action,case_id:cur.case.case_id,...extra,...map(f)}),()=>showCase(cur.case.case_id));
 async function newForm(){
  const r=await request({action:'forensic_clients'}),combos=[];
  for(const c of r.clients||[])for(const f of (r.firms||[]).filter(x=>x.client_id===c.client_id))combos.push([c.client_id+'|'+f.firm_id,`${c.company_name} · ${f.firm_code}`]);
  modal('Open a forensic file',form(`<p class="info full">${esc(FORENSIC_NOTE)} You become the lead Partner and the first person on the list.</p>`
   +select('combo','Client and handling firm *',combos,'','Choose…')+field('title','Title *','','text','required minlength="5" maxlength="200"')
   +field('mandate_date','Date of the mandate *',today(),'date',`required max="${today()}"`)+area('mandate_text','The mandate: who instructed the firm, and what it must examine *','',true),'Open the file'),
   f=>{const [client_id,firm_id]=String(f.get('combo')||'').split('|');return request({action:'forensic_open',client_id,firm_id,title:f.get('title'),mandate_date:f.get('mandate_date'),mandate_text:f.get('mandate_text')});},
   r2=>showCase(r2.case_id));
 }
 async function handle(action,id){
  if(!action.startsWith('forensic-'))return false;
  if(action==='forensic-open'){await showList();return true;}
  if(action==='forensic-new'){await newForm();return true;}
  if(action==='forensic-case'){await showCase(id);return true;}
  if(action==='forensic-evidence-add'){
   modal('Add evidence',form(`<p class="info full">The file is stored privately with its SHA-256 fingerprint and a first chain-of-custody entry. Evidence is never deleted; a mistake is withdrawn with a reason.</p>`
    +field('file','Evidence file *','','file','required accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.docx,.zip"')+field('description','What is it? *','','text','required minlength="5" maxlength="1000"')
    +field('source_note','Where and from whom was it obtained? *','','text','required minlength="5" maxlength="500"')+field('obtained_on','Date obtained *',today(),'date',`required max="${today()}"`)+'<p class="muted full">Maximum 10 MB.</p>','Add the evidence'),
    f=>{f.set('case_id',cur.case.case_id);return request(f,{file:true,uploadKind:'forensic'});},()=>showCase(cur.case.case_id));
   return true;
  }
  if(action==='forensic-evidence-file'){
   const e=(cur.evidence||[]).find(x=>x.evidence_id===id);
   const blob=await request({action:'forensic_evidence_download',evidence_id:id},{blob:true}),typed=new Blob([blob],{type:e?.mime_type||'application/octet-stream'}),u=URL.createObjectURL(typed);
   if(/^(image\/|application\/pdf)/.test(e?.mime_type||''))window.open(u,'_blank','noopener');else{const a=document.createElement('a');a.href=u;a.download=e?.file_name||'evidence';a.click();}
   setTimeout(()=>URL.revokeObjectURL(u),60000);return true;
  }
  if(action==='forensic-evidence-withdraw'){send('Withdraw this evidence',area('reason','Why is it withdrawn? *','',true)+'<p class="info full">The item stays on the record as withdrawn. A finding that cites it must be withdrawn first.</p>','forensic_evidence_withdraw',{evidence_id:id},'Withdraw');return true;}
  if(action==='forensic-custody-add'){
   send('Chain of custody',select('event_type','What happened? *',CUSTODY_EVENTS,'Transferred')+field('from_holder','From (required for a transfer)','','text','maxlength="200"')+field('to_holder','To (required for a transfer)','','text','maxlength="200"')
    +field('event_at','When','','datetime-local')+area('note','Note','',false)+'<p class="info full">Entries are added, never changed.</p>','forensic_custody_add',{evidence_id:id},'Record the entry',f=>{const o=Object.fromEntries(f);if(o.event_at)o.event_at=new Date(o.event_at).toISOString();else delete o.event_at;return o;});
   return true;
  }
  if(action==='forensic-finding-add'){
   const live=(cur.evidence||[]).filter(e=>!e.withdrawn_at);
   if(!live.length){notice('Add evidence first. A finding must cite at least one item.',true);return true;}
   send('Add a finding',field('title','Title *','','text','required minlength="5" maxlength="200"')+area('description','The finding *','',true)
    +`<fieldset class="full"><legend>Evidence it rests on *</legend>${live.map(e=>`<label class="full"><input type="checkbox" name="ev" value="${esc(e.evidence_id)}"> ${esc(e.evidence_no)}. ${esc(e.description)}</label>`).join('')}</fieldset>`,
    'forensic_finding_add',{},'Add the finding',f=>({title:f.get('title'),description:f.get('description'),evidence_ids:f.getAll('ev')}));
   return true;
  }
  if(action==='forensic-finding-withdraw'){send('Withdraw this finding',area('reason','Why is it withdrawn? *','',true),'forensic_finding_withdraw',{finding_id:id},'Withdraw');return true;}
  if(action==='forensic-report-edit'){
   send('Report',area('body','Report *',cur.report_body||'',true)+`<p class="info full">Each save keeps the earlier version. The standard reference printed with the report is: ${esc(standardText(cur.standard))}.</p>`,'forensic_report_save',{},'Save a new version');
   return true;
  }
  if(action==='forensic-report-issue'){
   send('Issue the report',`<p class="full">Issuing records the report and its fingerprint, and <b>locks</b> the file: no evidence, findings or report changes after this. Custody entries, the hold and the access list can still change.</p>`
    +checkbox('confirm','I have read the report and the findings and I issue this report as the lead Partner')+`<p class="muted full">Standard reference: ${esc(standardText(cur.standard))}</p>`,'forensic_report_issue',{},'Issue and lock',f=>({confirm:f.get('confirm')==='true'}));
   return true;
  }
  if(action==='forensic-hold-set'){send('Set a litigation hold',area('note','What is held, and on whose instruction? *','',true),'forensic_hold_set',{},'Set the hold');return true;}
  if(action==='forensic-hold-release'){send('Release the hold',area('reason','Why is it released? *','',true),'forensic_hold_release',{},'Release');return true;}
  if(action==='forensic-access-add'){
   const r=await request({action:'forensic_staff_options',case_id:cur.case.case_id});
   if(!(r.staff||[]).length){notice('There is nobody else who can be added.',true);return true;}
   send('Add a person',select('staff_id','Person *',r.staff.map(s=>[s.staff_id,`${s.full_name} (${s.category_code})`]),'','Choose…')+select('level','Access *',[['Investigator',LEVEL_WORDS.Investigator],['Viewer',LEVEL_WORDS.Viewer]],'Viewer')+'<p class="info full">Only staff who work in this file’s firm can be added. Administrators and Interns cannot.</p>','forensic_access_add',{},'Add');
   return true;
  }
  if(action==='forensic-access-level'){send('Change access',select('level','Access *',[['Investigator',LEVEL_WORDS.Investigator],['Viewer',LEVEL_WORDS.Viewer]],'Viewer'),'forensic_access_level',{staff_id:id},'Change');return true;}
  if(action==='forensic-access-remove'){send('Remove from the list',area('reason','Why? *','',true)+'<p class="info full">The person stops seeing the file at once. The entry stays on the record.</p>','forensic_access_remove',{staff_id:id},'Remove');return true;}
  if(action==='forensic-lead-transfer'){
   const r=await request({action:'forensic_staff_options',case_id:cur.case.case_id}),partners=(r.staff||[]).filter(s=>s.category_code==='PARTNER');
   if(!partners.length){notice('There is no other active Partner to hand the lead to.',true);return true;}
   send('Hand over the lead',select('new_lead_id','New lead Partner *',partners.map(s=>[s.staff_id,s.full_name]),'','Choose…')+area('reason','Why? *','',true)+'<p class="info full">You stay on the list as an Investigator. Only the new lead can then manage the list and issue the report.</p>','forensic_lead_transfer',{},'Hand over');
   return true;
  }
  if(action==='forensic-settings'){
   const r=await request({action:'forensic_settings_read'});settingsCache=r.settings;modal('Forensic settings',settingsView({r,button}));return true;
  }
  if(action==='forensic-setting-set'){
   const s=(settingsCache||[]).find(x=>x.setting_key===id);if(!s)return true;
   const body=id==='report_needs_verified_standard'?select('value','New value *',['YES','NO'],s.text_value):field('value','New value *',s.text_value,'text','required minlength="5" maxlength="300"');
   modal('Change · '+s.label,form(body+'<p class="info full">Changing a value withdraws any confirmation. A Partner then records the confirmation with its written source.</p>','Save'),
    f=>request({action:'forensic_setting_set',setting_key:id,revision:s.revision,value:f.get('value')}),()=>handle('forensic-settings',''));
   return true;
  }
  if(action==='forensic-setting-confirm'){
   const s=(settingsCache||[]).find(x=>x.setting_key===id);if(!s)return true;
   modal('Record confirmation · '+s.label,form(area('source_note','Who confirmed this, and where it is written (for example the Compliance Lead’s email and its date) *','',true),'Record confirmation'),
    f=>request({action:'forensic_setting_confirm',setting_key:id,revision:s.revision,source_note:f.get('source_note')}),()=>handle('forensic-settings',''));
   return true;
  }
  return false;
 }
 return {handle};
}
