// Step 8: Incoming Review and linked documents (the internal side). The rules live in the database
// (20261109265000_incoming_review.sql) and the server (incoming-actions.ts); this file draws the screens and sends the requests.
// Live WhatsApp and mailbox connections need outside accounts and are not part of this step: staff log a received file by hand.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const SOURCES=['WhatsApp','Email','Hand delivered','Post or courier'];
export const INCOMING_NOTE='Who may accept a file, how identity (KYC) files are routed, who may handle Restricted files and how long archived files are kept are defaults. A Partner has not yet confirmed them. Nothing is ever deleted: a rejected file is archived with a reason. The live WhatsApp and mailbox connections are not set up; log each received file by hand.';
export const STATUS_TONE={Received:'info','Needs Review':'warn','Accepted and Linked':'ok',Archived:'muted'};
export const MATCH_TONE={'One match':'ok','No match':'warn','Several matches':'warn','Chosen by staff':'info'};
const ROLE_WORDS={SUPERVISOR:'Supervisor and above',MANAGER:'Manager and above',PARTNER:'Partner only',LEADERS_ONLY:'Managers and Partners only',SAME_QUEUE:'Same queue (a Supervisor accepts into KYC Pending)'};
const reviewerRole=me=>['PARTNER','MANAGER','SUPERVISOR'].includes(me?.category_code);
const leaderRole=me=>['PARTNER','MANAGER'].includes(me?.category_code);
const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;

export function sizeText(bytes){
 const n=Number(bytes);if(!Number.isFinite(n)||n<=0)return '';
 return n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
}
export function settingStatus(s){
 return s.rule_status==='Confirmed'?`Confirmed${s.confirmed_at?' on '+day(s.confirmed_at):''}`:'Default - not yet confirmed';
}
export function settingValue(s){
 if(s.int_value!==null&&s.int_value!==undefined)return `${s.int_value} days`;
 return ROLE_WORDS[s.text_value]||String(s.text_value??'');
}
// "Matched to Client Ltd through Jane", "Several clients use this number", "No client has this number or email".
export function matchText(i){
 if(i.match_result==='One match')return `Matched to ${i.client_name||'one client'}${i.contact_name?' through '+i.contact_name:''}`;
 if(i.match_result==='Several matches')return `${i.match_count} clients use this number or email. Choose the right one`;
 if(i.match_result==='No match')return 'No client contact has this number or email. Choose the client';
 return i.client_name?`Client chosen by staff: ${i.client_name}`:'Client chosen by staff';
}
export function duplicateText(i){
 const out=[];
 if(i.duplicate_document_id)out.push('This exact file is already filed for a client');
 if(i.duplicate_item_id)out.push('Another incoming item has the same file');
 return out;
}
export function bannerText(counts){
 const n=Number(counts?.incoming_waiting||0),r=Number(counts?.incoming_needs_review||0);
 if(!n)return 'No incoming files are waiting';
 return `${n} incoming file${n===1?'':'s'} waiting${r?`, ${r} need${r===1?'s':''} a closer look`:''}`;
}

export function queueView({r,me,button,archived}){
 const items=r.items||[],leader=leaderRole(me);
 let html=`<p class="info full">${esc(INCOMING_NOTE)}</p>`;
 html+=`<div class="actions full">${button('incoming-log','+ Log a received file','','class="primary"')} ${button('incoming-open','Waiting',archived?'':'',!archived?'class="primary"':'')} ${button('incoming-archived','Filed and archived','',archived?'class="primary"':'')} ${button('incoming-settings','Settings')}</div>`;
 if(!archived)html+=`<p class="muted full">${esc(bannerText(r.counts))}.</p>`;
 if(!items.length)return html+`<p class="muted full">${archived?'Nothing has been filed or archived yet.':'No incoming files are waiting.'}</p>`;
 html+=`<div class="scroll full"><table id="incomingQueue"><thead><tr><th>Received</th><th>File</th><th>Sender</th><th>Client</th><th>Status</th><th></th></tr></thead><tbody>${items.map(i=>{
  const flags=[i.is_kyc?badge('Identity / KYC','warn'):'',i.confidentiality==='Restricted'?badge('Restricted','bad'):'',duplicateText(i).length?badge('Duplicate','warn'):''].filter(Boolean).join(' ');
  return `<tr><td>${esc(day(i.received_at))}<br><small>${esc(i.source_type)}</small></td><td><b>${esc(i.subject)}</b><br><small>${esc(i.file_name)}${sizeText(i.file_size_bytes)?' · '+esc(sizeText(i.file_size_bytes)):''}</small></td>`
   +`<td>${esc(i.sender_name||'Not recorded')}<br><small>${esc(i.sender_address||'')}</small></td>`
   +`<td>${i.client_name?esc(i.client_name):'<span class="muted">Not known yet</span>'}<br>${badge(i.match_result,MATCH_TONE[i.match_result]||'')}</td>`
   +`<td>${badge(i.status,STATUS_TONE[i.status]||'')}${i.resolution&&i.status==='Archived'?'<br><small>'+esc(i.resolution)+(i.past_retention?' · past retention':'')+'</small>':''}${flags?'<br>'+flags:''}</td>`
   +`<td>${button('incoming-item','Review',i.item_id)}</td></tr>`;}).join('')}</tbody></table></div>`;
 return html+(leader?'':'<p class="muted full">Managers and Partners also see Restricted files and decide what happens to identity (KYC) files.</p>');
}

export function itemView({item:i,candidates=[],clients=[],me,button}){
 const waiting=['Received','Needs Review'].includes(i.status);
 let html=`<p class="full">${badge(i.status,STATUS_TONE[i.status]||'')} ${badge(i.source_type)} ${i.is_kyc?badge('Identity / KYC','warn'):''} ${i.confidentiality==='Restricted'?badge('Restricted','bad'):''}</p>`;
 html+=`<p class="full"><b>${esc(i.subject)}</b><br>Received ${esc(day(i.received_at))} by ${esc(i.source_type)} from <b>${esc(i.sender_name||'an unnamed sender')}</b>${i.sender_address?' ('+esc(i.sender_address)+')':''}<br><small>Logged by ${esc(i.logged_by_name||'')} on ${esc(day(i.logged_at))}</small></p>`;
 if(i.message_text)html+=`<p class="preserve-lines full">${esc(i.message_text)}</p>`;
 html+=`<p class="full">File: <b>${esc(i.file_name)}</b>${sizeText(i.file_size_bytes)?' · '+esc(sizeText(i.file_size_bytes)):''} ${button('incoming-file','Open the file',i.item_id)}</p>`;
 const dups=duplicateText(i);
 if(dups.length)html+=`<div class="info full"><b>Possible duplicate.</b> ${dups.map(esc).join('. ')}.</div>`;
 html+=`<p class="full">${badge(i.match_result,MATCH_TONE[i.match_result]||'')} ${esc(matchText(i))}</p>`;
 if(!waiting){
  html+=`<p class="full"><b>${esc(i.status==='Archived'?i.resolution:'Accepted')}</b> by ${esc(i.decided_by_name||'')} on ${esc(day(i.decided_at))}${i.decision_note?'<br><span class="preserve-lines">'+esc(i.decision_note)+'</span>':''}${i.category?'<br>Filed as '+esc(i.category):''}</p>`;
  if(i.document_id)html+=`<div class="actions full">${button('incoming-links','Linked records',i.document_id)}${i.client_id?' '+button('incoming-timeline','Client timeline',i.client_id):''}</div>`;
  return html;
 }
 if(candidates.length)html+=`<div class="full"><b>Clients that match this sender</b>${candidates.map(c=>`<div class="home-exception-row"><div>${esc(c.client_name)}<small>${esc(c.contact_name||'')}</small></div>${button('incoming-use-client','Use this client',c.client_id)}</div>`).join('')}</div>`;
 if(clients.length)html+=`<label class="full">${i.client_id?'Change the client':'Choose the client'}<select id="incomingClient"><option value="">Choose…</option>${clients.map(c=>`<option value="${esc(c.client_id)}"${c.client_id===i.client_id?' selected':''}>${esc(c.company_name)}</option>`).join('')}</select></label><div class="actions full">${button('incoming-pick-client','Save the client')}</div>`;
 html+=`<div class="actions full">${button('incoming-handling',i.confidentiality==='Restricted'?'Mark as Normal':'Mark as Restricted',i.confidentiality==='Restricted'?'Normal':'Restricted')} ${button('incoming-handling',i.is_kyc?'Not identity / KYC':'Mark as identity / KYC',i.is_kyc?'kyc-off':'kyc-on')}</div>`;
 html+=`<div class="actions full">${i.client_id?button('incoming-accept','Accept and link…',i.item_id,'class="primary"'):'<span class="muted">Choose the client to accept this file.</span>'} ${button('incoming-archive','Request a replacement','Replacement requested')} ${button('incoming-archive','Reject','Rejected')} ${button('incoming-archive','Mark as duplicate','Duplicate')} ${button('incoming-archive','Withdraw','Withdrawn')}${i.client_id?' '+button('incoming-timeline','Client timeline',i.client_id):''}</div>`;
 return html;
}

const CHANNEL_TONE={Email:'info',WhatsApp:'ok',Letter:'',Call:'',Meeting:'','Internal note':'muted',Visit:''};
export function timelineView({events=[],button}){
 if(!events.length)return '<p class="muted full">Nothing has been recorded for this client yet, or none of it is visible to you.</p>';
 return events.map(e=>{
  const head=e.kind==='Communication'?`${badge(e.channel,CHANNEL_TONE[e.channel]||'')}${e.direction?' '+badge(e.direction):''} <b>${esc(e.title)}</b><small> ${esc(e.reference||'')}${e.sender_address?' · '+esc(e.sender_address):''}${e.status?' · '+esc(e.status):''}</small>`
   :`${badge('Document','info')} <b>${esc(e.title)}</b><small> ${esc(e.category||'')}${e.source_type&&e.source_type!=='Upload'?' · received by '+esc(e.source_type):''}${e.confidentiality==='Restricted'?' · Restricted':''}</small>`;
  const docs=(e.documents||[]).map(d=>`<div class="timeline-doc"><small>${esc(d.file_name)} · ${esc(d.category)}</small> ${button('incoming-links','Linked records',d.document_id)}</div>`).join('');
  return `<div class="home-exception-row"><div><small>${esc(day(e.at))}</small><br>${head}${e.kind==='Communication'?docs:''}</div>${e.kind==='Document'?button('incoming-links','Linked records',e.id):''}</div>`;}).join('');
}

export function linksView({links=[],document,button}){
 const label=l=>l.communication_id?`Communication ${l.communication_reference||''} (${l.communication_channel||''})`:l.project_id?`Project ${l.project_name||''}`:l.task_id?`Task ${l.task_name||''}`:l.kra_case_id?`KRA notice ${l.notice_reference||''}`:`Period ${day(l.period_start)} to ${day(l.period_end)}`;
 const active=links.filter(l=>!l.removed_at),gone=links.filter(l=>l.removed_at);
 let html=`<p class="full"><b>${esc(document?.file_name||'')}</b> · ${esc(document?.category||'')}</p>`;
 html+=active.length?active.map(l=>`<div class="home-exception-row"><div>${esc(label(l))}${l.note?'<small>'+esc(l.note)+'</small>':''}</div>${button('incoming-link-remove','Remove',l.link_id)}</div>`).join(''):'<p class="muted full">This document has no extra links. Its client, project, task and originating message are shown on the document itself.</p>';
 if(gone.length)html+=`<p class="muted full">Removed: ${gone.map(l=>esc(label(l))+' ('+esc(l.removal_reason||'')+')').join('; ')}</p>`;
 html+=`<div class="actions full">${button('incoming-link-add','+ Add a link','','class="primary"')}</div>`;
 return html;
}

export function createIncomingUI(ctx){
 const {$,field,select,form,modal,request,notice,button,area,today}=ctx,d=()=>ctx.data();
 let archivedView=false,cur=null,clients=null,options=null,linkDoc=null;
 const checkbox=(name,label,checked=false)=>`<label class="full"><input type="checkbox" name="${name}" value="true"${checked?' checked':''}> ${esc(label)}</label>`;
 const showQueue=async(archived=archivedView)=>{archivedView=archived;const r=await request({action:'incoming_list',archived});modal(archived?'Incoming files: filed and archived':'Incoming review',queueView({r,me:d().me,button,archived}));};
 const loadClients=async()=>{if(!clients)clients=(await request({action:'incoming_clients'})).clients||[];return clients;};
 const showItem=async id=>{
  const r=await request({action:'incoming_list',archived:false}),a=await request({action:'incoming_list',archived:true});
  const item=[...(r.items||[]),...(a.items||[])].find(x=>x.item_id===id);
  if(!item){notice('That incoming file is no longer available to you.',true);return showQueue();}
  cur=item;
  const waiting=['Received','Needs Review'].includes(item.status);
  const cand=waiting&&['No match','Several matches'].includes(item.match_result)?(await request({action:'incoming_candidates',item_id:id})).candidates:[];
  modal('Incoming file · '+item.subject,itemView({item,candidates:cand,clients:waiting?await loadClients():[],me:d().me,button}));
 };
 const send=(title,body,action,extra,label='Save',after)=>modal(title,form(body,label),f=>request({action,...extra,...Object.fromEntries(f)}),after||(()=>showItem(cur.item_id)));
 function logForm(){
  loadClients().then(list=>{
   modal('Log a received file',form(`<p class="info full">Use this when a client sends a file by WhatsApp, email, hand or post. If you leave the client empty, the ERP looks for a client contact with the same phone number or email and, if there is exactly one, suggests that client. Nothing is filed until a Supervisor, Manager or Partner accepts it.</p>`
    +field('file','File *','','file','required accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.docx,.zip"')
    +select('source_type','How was it received? *',SOURCES,'WhatsApp')+field('received_on','Date received *',today(),'date',`required max="${today()}"`)
    +field('sender_name','Sender name','','text','maxlength="200"')+field('sender_address','Sender phone number or email','','text','maxlength="200"')
    +field('subject','Subject *','','text','required minlength="3" maxlength="200"')+area('message_text','Message that came with the file','',false)
    +select('client_id','Client (if you already know it)',list.map(c=>[c.client_id,c.company_name]),'','Not known yet: match by sender')
    +checkbox('is_kyc','This is identity or KYC evidence')+'<p class="muted full">Maximum 10 MB. PDF, PNG, JPEG, XLSX, CSV, DOCX or ZIP.</p>','Log the file'),
    f=>request(f,{file:true,uploadKind:'incoming'}),
    async r=>{notice(r.status==='Received'?'Logged and routed to '+(list.find(c=>c.client_id===r.client_id)?.company_name||'the client')+'. Review it to accept.':'Logged. It needs a closer look: '+(r.match_result==='Several matches'?'several clients use this number.':r.match_result==='No match'?'no client matches this sender.':'it may be a duplicate.'));await showQueue(false);});
  });
 }
 async function acceptForm(){
  options=await request({action:'incoming_options',client_id:cur.client_id});
  const o=options,kyc=cur.is_kyc;
  const firmItems=o.firms.map(f=>[f.firm_id,`${f.firm_code} · ${f.legal_name}`]);
  modal('Accept and link · '+cur.subject,form(
   `<p class="info full">${kyc?'Identity and KYC files are filed at client level: into the Permanent File when a Manager or Partner accepts, or into KYC Pending when a Supervisor does (a Manager or Partner then approves). ':''}Accepting turns the file into a document of <b>${esc(cur.client_name||'the client')}</b>. It is kept exactly as received (its SHA-256 is recorded).</p>`
   +(kyc?'':select('category','Document category *',o.categories,o.categories.includes('Correspondence')?'Correspondence':o.categories[0]))
   +select('firm_id','Handling firm *',firmItems,firmItems.length===1?firmItems[0][0]:'','Choose the firm')
   +select('project_id','Project (optional)',o.projects.map(p=>[p.project_id,`${p.project_name} · ${p.service_code}`]),'','Client level (no project)')
   +select('task_id','Task (optional)',[],'','No task')
   +select('kra_case_id','KRA notice (optional)',o.kra_cases.map(k=>[k.case_id,`${k.notice_reference} · ${k.status}`]),'','Not a KRA notice')
   +field('period_start','Period from (optional)','','date')+field('period_end','Period to','','date')
   +select('confidentiality','Confidentiality',['Normal','Restricted'],cur.confidentiality||'Normal')
   +select('communication_id','Link to an existing communication',o.communications.map(c=>[c.communication_id,`${day(c.communication_date)} · ${c.reference} · ${c.channel}${c.direction?' ('+c.direction.toLowerCase()+')':''} · ${c.subject}`]),'','None')
   +checkbox('create_communication','Record this message in the communications register (incoming '+cur.source_type+')',true)
   +(cur.duplicate_document_id?checkbox('confirm_duplicate','I know this exact file is already filed for this client. File it again.'):'')
   +area('note','Note (optional)','',false)
   +(o.project_required.length?`<p class="muted full">A Supervisor files ${esc(o.project_required.join(', '))} only under a project.</p>`:''),'Accept and link'),
   f=>{const v=Object.fromEntries(f),existing=v.communication_id||'';
    return request({action:'incoming_accept',item_id:cur.item_id,client_id:cur.client_id,firm_id:v.firm_id,category:v.category||'',project_id:v.project_id||'',task_id:v.task_id||'',kra_case_id:v.kra_case_id||'',
     period_start:v.period_start||'',period_end:v.period_end||'',confidentiality:v.confidentiality||'',communication_id:existing,create_communication:!existing&&v.create_communication==='true',
     confirm_duplicate:v.confirm_duplicate==='true',note:v.note||''});},
   async r=>{notice('Filed as '+r.category+(r.communication_id?' and recorded in the communications register.':'.'));await showQueue(false);});
  const fm=$('#editForm');if(!fm)return;
  const fillTasks=()=>{const pid=fm.elements.project_id.value;fm.elements.task_id.innerHTML='<option value="">No task</option>'+options.tasks.filter(t=>t.project_id===pid).map(t=>`<option value="${esc(t.task_id)}">${esc(t.task_name)}</option>`).join('');};
  fm.elements.project_id.addEventListener('change',fillTasks);fillTasks();
 }
 async function showLinks(docId){
  const r=await request({action:'document_links',document_id:docId});linkDoc=r.document;linkDoc.links=r.links;
  modal('Linked records',linksView({links:r.links,document:r.document,button}));
 }
 async function addLinkForm(){
  const o=await request({action:'incoming_options',client_id:linkDoc.client_id});options=o;
  modal('Add a link',form(select('kind','What do you want to link? *',[['communication','A communication'],['project','A project'],['task','A task'],['kra_case','A KRA notice'],['period','A period']],'communication')
   +select('communication_id','Communication',o.communications.map(c=>[c.communication_id,`${day(c.communication_date)} · ${c.reference} · ${c.channel} · ${c.subject}`]),'','Choose…')
   +select('project_id','Project',o.projects.map(p=>[p.project_id,p.project_name]),'','Choose…')
   +select('task_id','Task',o.tasks.map(t=>[t.task_id,t.task_name]),'','Choose…')
   +select('kra_case_id','KRA notice',o.kra_cases.map(k=>[k.case_id,k.notice_reference]),'','Choose…')
   +field('period_start','Period from','','date')+field('period_end','Period to','','date')+field('note','Note (optional)','','text','maxlength="500"')
   +'<p class="muted full">The record must belong to the same client and the same firm as the document. A link is removed with a reason; it is never deleted.</p>','Add the link'),
   f=>{const v=Object.fromEntries(f),k=v.kind,x={action:'document_link_add',document_id:linkDoc.document_id,note:v.note||''};
    if(k==='communication')x.communication_id=v.communication_id;if(k==='project')x.project_id=v.project_id;if(k==='task')x.task_id=v.task_id;if(k==='kra_case')x.kra_case_id=v.kra_case_id;
    if(k==='period'){x.period_start=v.period_start;x.period_end=v.period_end;}
    return request(x);},
   ()=>showLinks(linkDoc.document_id));
  const fm=$('#editForm');if(!fm)return;
  const show=()=>{const k=fm.elements.kind.value;for(const [n,when] of [['communication_id','communication'],['project_id','project'],['task_id','task'],['kra_case_id','kra_case'],['period_start','period'],['period_end','period']]){const l=fm.elements[n].closest('label');if(l)l.hidden=k!==when;}};
  fm.elements.kind.addEventListener('change',show);show();
 }
 async function showTimeline(clientId){
  const r=await request({action:'client_timeline',client_id:clientId});
  modal('Client timeline',`<p class="muted full">Emails, WhatsApp messages, letters, calls, meetings and notes, with the documents that came with them or were filed for the client. You see only what your role allows.</p>`+timelineView({events:r.events,button}));
 }
 async function pickTimeline(){
  const list=await loadClients();
  modal('Client timeline',form(select('client_id','Client *',list.map(c=>[c.client_id,c.company_name]),'','Choose…'),'Open the timeline'),f=>Promise.resolve(Object.fromEntries(f)),r=>showTimeline(r.client_id));
 }
 async function settings(){
  const r=await request({action:'incoming_settings_read'}),partner=d().me?.category_code==='PARTNER';
  cur={...(cur||{}),settings:r.settings};
  modal('Incoming review settings',`<p class="info full">${esc(INCOMING_NOTE)}</p><div class="scroll full"><table id="incomingSettings"><thead><tr><th>Setting</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${(r.settings||[]).map(s=>`<tr><td>${esc(s.label)}</td><td>${esc(settingValue(s))}</td><td>${badge(settingStatus(s),s.rule_status==='Confirmed'?'ok':'warn')}${s.source_note?'<br><small>'+esc(s.source_note)+'</small>':''}</td><td>${partner?button('incoming-setting-set','Change',s.setting_key)+(s.rule_status==='Suggested'?' '+button('incoming-setting-confirm','Confirm',s.setting_key):''):''}</td></tr>`).join('')}</tbody></table></div><p class="muted full">${partner?'Changing a value withdraws any confirmation. Confirming needs a written source.':'Only a Partner can change or confirm these.'} The Forensic level is not offered until the forensic file exists.</p><div class="actions full">${button('incoming-open','Back to the queue')}</div>`);
 }
 const SETTING_CHOICES={accept_min_role:['SUPERVISOR','MANAGER','PARTNER'],restricted_min_role:['MANAGER','PARTNER'],kyc_route:['LEADERS_ONLY','SAME_QUEUE']};
 async function handle(action,id){
  if(!action.startsWith('incoming-'))return false;
  if(action==='incoming-open'){await showQueue(false);return true;}
  if(action==='incoming-archived'){await showQueue(true);return true;}
  if(action==='incoming-log'){logForm();return true;}
  if(action==='incoming-item'){await showItem(id);return true;}
  if(action==='incoming-file'){
   const blob=await request({action:'incoming_download',item_id:id},{blob:true}),typed=new Blob([blob],{type:cur?.mime_type||'application/octet-stream'}),u=URL.createObjectURL(typed);
   if(/^(image\/|application\/pdf)/.test(cur?.mime_type||''))window.open(u,'_blank','noopener');else{const a=document.createElement('a');a.href=u;a.download=cur?.file_name||'incoming_file';a.click();}
   setTimeout(()=>URL.revokeObjectURL(u),60000);return true;
  }
  if(action==='incoming-use-client'){await request({action:'incoming_choose_client',item_id:cur.item_id,client_id:id});await showItem(cur.item_id);return true;}
  if(action==='incoming-pick-client'){const v=$('#incomingClient')?.value;if(!v){notice('Choose a client first.',true);return true;}await request({action:'incoming_choose_client',item_id:cur.item_id,client_id:v});await showItem(cur.item_id);return true;}
  if(action==='incoming-handling'){
   const level=id==='Restricted'?'Restricted':id==='Normal'?'Normal':cur.confidentiality,kyc=id==='kyc-on'?true:id==='kyc-off'?false:cur.is_kyc;
   await request({action:'incoming_set_handling',item_id:cur.item_id,confidentiality:level,is_kyc:kyc});
   if(level==='Restricted'&&!leaderRole(d().me)){notice('Marked Restricted. It now waits for a Manager or Partner.');await showQueue(false);}else await showItem(cur.item_id);
   return true;
  }
  if(action==='incoming-accept'){await acceptForm();return true;}
  if(action==='incoming-archive'){
   const title={Rejected:'Reject this file','Replacement requested':'Request a replacement',Duplicate:'Mark as duplicate',Withdrawn:'Withdraw this file'}[id]||'Archive';
   send(title,area('reason',id==='Replacement requested'?'What should the client send again, and why? *':'Why? *','',true)+'<p class="info full">The item is archived with this reason. The file stays in private storage; nothing is deleted.</p>','incoming_archive',{item_id:cur.item_id,resolution:id},'Archive',async()=>{notice('Archived.');await showQueue(false);});
   return true;
  }
  if(action==='incoming-settings'){await settings();return true;}
  if(action==='incoming-setting-set'){
   const s=(cur?.settings||[]).find(x=>x.setting_key===id);if(!s)return true;
   const choices=SETTING_CHOICES[id];
   modal('Change · '+s.label,form((choices?select('value','New value *',choices.map(c=>[c,ROLE_WORDS[c]||c]),String(s.text_value)):field('value','New value *',String(s.int_value),'number','required min="30" max="3650"'))+'<p class="info full">Changing a value withdraws any confirmation. A Partner then records the confirmation with its written source.</p>','Save'),
    f=>request({action:'incoming_setting_set',setting_key:id,revision:s.revision,value:f.get('value')}),settings);
   return true;
  }
  if(action==='incoming-setting-confirm'){
   const s=(cur?.settings||[]).find(x=>x.setting_key===id);if(!s)return true;
   modal('Record confirmation · '+s.label,form(area('source_note','Who confirmed this, and where it is written (for example the Partner minute and its date) *','',true),'Record confirmation'),
    f=>request({action:'incoming_setting_confirm',setting_key:id,revision:s.revision,source_note:f.get('source_note')}),settings);
   return true;
  }
  if(action==='incoming-timeline'){await showTimeline(id);return true;}
  if(action==='incoming-timeline-pick'){await pickTimeline();return true;}
  if(action==='incoming-links'){await showLinks(id);return true;}
  if(action==='incoming-link-add'){await addLinkForm();return true;}
  if(action==='incoming-link-remove'){
   modal('Remove this link',form(area('reason','Why is it removed? *','',true)+'<p class="info full">The link stays on the record as removed.</p>','Remove the link'),f=>request({action:'document_link_remove',link_id:id,reason:f.get('reason')}),()=>showLinks(linkDoc.document_id));
   return true;
  }
  return false;
 }
 // The count on the Documents page card.
 async function paintCard(){
  const box=$('#incomingCard');if(!box||!reviewerRole(d().me))return;
  const slot=box.querySelector('[data-incoming-count]');if(!slot)return;
  try{const r=await request({action:'incoming_list'});slot.textContent=bannerText(r.counts)+'.';}
  catch(e){slot.textContent='The incoming count could not be loaded.';}
 }
 return {handle,paintCard};
}
export const incomingCardHtml=(me,button)=>reviewerRole(me)?`<div class="card section-space" id="incomingCard"><div class="section-head"><h2>Incoming review</h2><div class="actions">${button('incoming-open','Open the incoming queue','','class="primary"')}${button('incoming-timeline-pick','Client timeline')}</div></div><p class="muted">Files that clients send by WhatsApp, email, hand or post wait here until a Supervisor, Manager or Partner confirms the client and files them. <span data-incoming-count></span></p></div>`:'';
