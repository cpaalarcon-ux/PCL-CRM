// Step 7: the KRA notice log, the verification task and the non-compliance flags. The rules live in the database
// (20261109264000_kra_notices.sql) and the server (kra-actions.ts); this file draws the screens and sends the requests.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const KRA_NOTE='The task dates, flag thresholds, severities and the owner rule are defaults from the Tax Lead\'s notes. A Partner has not yet recorded the Tax Lead\'s confirmation of them. The system never creates the KRA project: staff create it from the template and link it to the case.';
export const FLAG_NAMES={A:'No tax project or accounting year',B:'Deadline within days',C:'Requested document missing',D:'Responded, not closed',E:'Partner alert: deadline approaching'};
export const OPEN_STAGES=['Received','Triage','In progress','Internal review','Approved to send'];
export const SUBMITTED_STAGES=['Submitted to KRA','Awaiting KRA','Further information requested','Dispute or appeal','Resolved'];
export const CHANNELS=['iTax portal','Email','Hand delivery','Courier','Other'];
export const CONTACT_KINDS=['Email','Call','Meeting','Letter','Note'];
const stamp=v=>v?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Nairobi'}).format(new Date(v)):'';
export const nairobiNow=()=>new Date().toLocaleString('sv-SE',{timeZone:'Africa/Nairobi'}).slice(0,16).replace(' ','T');
export const SEVERITY_TONE={CRITICAL:'bad',HIGH:'warn',MEDIUM:'info'};
export const STATUS_TONE={Open:'warn',Responded:'info',Closed:'ok',Cancelled:'muted'};
const staffRole=me=>['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(me?.category_code);
const leaderRole=me=>['PARTNER','MANAGER'].includes(me?.category_code);

// "5 days left", "Due tomorrow", "Due today", "Overdue by 2 days".
export function deadlineText(days){
 if(days===null||days===undefined||days==='')return '';
 const n=Number(days);if(!Number.isFinite(n))return '';
 if(n<0)return `Overdue by ${-n} day${n===-1?'':'s'}`;
 if(n===0)return 'Due today';
 if(n===1)return 'Due tomorrow';
 return `${n} days left`;
}
export const deadlineTone=(days,status)=>['Closed','Cancelled'].includes(status)?'muted':Number(days)<=3?'bad':Number(days)<=7?'warn':'ok';
// The Partner banner: "3 KRA Cases Flagged for Non-Compliance".
export function bannerText(counts){
 const n=Number(counts?.cases_flagged||0);
 return n?`${n} KRA Case${n===1?'':'s'} Flagged for Non-Compliance`:'No KRA cases are flagged for non-compliance';
}
export function settingStatus(s){
 return s.rule_status==='Confirmed'?`Confirmed${s.confirmed_at?' on '+day(s.confirmed_at):''}`:'Default - not yet confirmed';
}

// What is missing, as a checklist. Clicking "N documents missing" opens this.
export function missingView(miss,ref,button){
 return `<p class="full">A case cannot be submitted to KRA while a requested document is missing. For notice <b>${esc(ref)}</b>:</p>`+(miss.length?`<ul class="full" id="kraMissing">${miss.map(q=>`<li>${esc(q.description)}${q.needed_by?` <small class="muted">needed by ${esc(day(q.needed_by))}</small>`:''}</li>`).join('')}</ul><p class="muted full">Attach each from the case, or have a Manager or Partner mark it not applicable with a reason.</p>`:'<p class="ok full">Nothing is missing.</p>');
}

// The KPI cards above the register.
export function dashboardView(db){
 if(!db)return '';
 const card=(label,n,hint)=>`<div><small>${esc(label)}${hint?' ('+esc(hint)+')':''}</small><strong>${esc(n)}</strong></div>`;
 return `<div class="ledger-kpis full" id="kraDashboard">${card('Overdue',db.overdue)}${card('Due soon',db.due_soon,'within '+db.escalation_days+' days')}${card('Unassigned',db.unassigned)}${card('Missing documents',db.missing_documents)}${card('Awaiting KRA',db.awaiting_kra)}</div>`;
}
// Stage, submission details and the stage control.
export function progressPanel({c,pg,me,button}){
 if(!pg)return '';
 const leader=leaderRole(me),open=c.status==='Open',live=['Open','Responded'].includes(c.status);
 let h=`<p class="full" id="kraStage"><b>Stage:</b> <span class="badge info">${esc(pg.stage)}</span> <small class="muted">since ${esc(stamp(pg.stage_changed_at))}</small>${live?' '+button('kra-stage','Change stage',c.case_id):''}</p>`;
 if(pg.submitted_at)h+=`<p class="full" id="kraSubmission"><b>Submitted to KRA:</b> ${esc(stamp(pg.submitted_at))} · ${esc(pg.submission_channel||'')} · reference <b>${esc(pg.submission_reference||'')}</b><br>Acknowledgment: ${pg.ack_file_name?esc(pg.ack_file_name):'<span class="warn">not saved yet</span>'} ${live?button('kra-ack',pg.ack_file_name?'Change acknowledgment':'Save the acknowledgment',c.case_id):''}</p>`;
 return h;
}
export function timelineView({events,button,c}){
 const rows=(events||[]).slice().reverse();
 return `<h3 class="full">Timeline and contact log (${rows.length})</h3>${['Open','Responded'].includes(c.status)?`<div class="actions full">${button('kra-contact','+ Log an email, call or note',c.case_id)}</div>`:''}`
  +(rows.length?`<div class="scroll full"><table id="kraTimeline"><thead><tr><th>When</th><th>What</th><th>By</th><th>Detail</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(stamp(e.happened_at))}</td><td>${esc(e.kind)}</td><td>${esc(e.recorded_by_name)}</td><td>${esc(e.summary)}${e.participants?`<br><small>With ${esc(e.participants)}</small>`:''}${e.file_name?`<br><small>${esc(e.file_name)}</small>`:''}</td></tr>`).join('')}</tbody></table></div><p class="muted full">The timeline is only added to; an entry cannot be changed or removed.</p>`:'<p class="muted full">Nothing recorded yet.</p>');
}

export function caseView({r,me,button}){
 const c=r.case,task=r.task,open=['Open','Responded'].includes(c.status),leader=leaderRole(me),partner=me?.category_code==='PARTNER';
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 let html=`<p class="full" id="kraCountdown">${badge(deadlineText(c.days_left),deadlineTone(c.days_left,c.status))} <b>Response due to KRA by ${esc(day(c.deadline_date))}</b> · ${badge(c.status,STATUS_TONE[c.status]||'')}</p>`;
 html+=progressPanel({c,pg:r.progress,me,button});
 html+=`<p class="full"><b>${esc(c.client_name)}</b> · ${esc(c.notice_type)} · ${esc(c.tax_head)} · period ${esc(day(c.period_start))} to ${esc(day(c.period_end))}<br>KRA reference <b>${esc(c.notice_reference)}</b> · dated ${esc(day(c.notice_date))} · received ${esc(day(c.received_on))} · logged by ${esc(c.logged_by_name||'')}<br>${esc(c.summary)}<br>Copy of the notice: ${c.notice_file?esc(c.notice_file):'<span class="muted">not attached</span>'}</p>`;
 if(c.status==='Responded')html+=`<p class="info full">Responded on ${esc(day(c.responded_on))}${c.responded_by_name?' by '+esc(c.responded_by_name):''}. A Partner approves and closes the case.</p>`;
 if(c.status==='Closed')html+=`<p class="ok full">Approved and closed ${esc(day(c.closed_at))} by ${esc(c.closed_by_name||'a Partner')}.</p>`;
 if(c.status==='Cancelled')html+=`<p class="muted full">Cancelled ${esc(day(c.closed_at))} by ${esc(c.closed_by_name||'')}: ${esc(c.close_note||'')}</p>`;
 if(c.return_note&&c.status==='Open')html+=`<p class="muted full">Returned to Open: ${esc(c.return_note)}</p>`;
 const openFlags=(r.flags||[]).filter(f=>f.status==='Open');
 html+=`<div class="full" id="kraFlags">${openFlags.length?openFlags.map(f=>`<div class="home-exception-row"><div><b>${badge('Flag '+f.flag_code+' · '+f.severity,SEVERITY_TONE[f.severity]||'')} ${esc(FLAG_NAMES[f.flag_code]||'')}</b><small>${esc(f.detail)}</small><span class="preserve-lines"><b>To clear it:</b> ${esc(f.action_needed)}</span></div></div>`).join(''):'<p class="ok">No open non-compliance flags.</p>'}</div>`;
 // The verification task.
 if(task){
  html+=`<p class="full" id="kraTask"><b>Verification task:</b> ${esc(task.task_name)}${c.task_urgent?' '+badge('URGENT','bad'):''}<br>Assigned to ${esc(task.assignee_name||'nobody')} · ${esc(task.status)} · due ${esc(day(task.due_at))}<br><small class="muted">Default owner rule (${esc(c.task_basis||'')}) is not yet confirmed by the Tax Lead. The task can be reassigned like any other.</small></p>`;
 }else if(open){
  html+=`<p class="warn full" id="kraNoTask">No verification task yet. A task needs a project to sit on: link the project below (or create it from the KRA template first). The Partners have been told.</p>`;
 }
 // The project.
 if(open){
  html+=`<p class="full" id="kraProject"><b>Project:</b> ${c.project_name?esc(c.project_name):'<span class="muted">not linked</span>'} ${button('kra-link','Link a project',c.case_id)}</p>`;
 }else if(c.project_name)html+=`<p class="full"><b>Project:</b> ${esc(c.project_name)}</p>`;
 // Document requests.
 const reqs=r.requests||[];
 html+=`<h3 class="full">Documents the notice asks for (${reqs.length})</h3>`;
 html+=reqs.length?`<div class="scroll full"><table id="kraRequests"><thead><tr><th>Document</th><th>Needed by</th><th>Status</th><th></th></tr></thead><tbody>${reqs.map(q=>{
  const tone=q.status==='MISSING'?'warn':q.status==='RECEIVED'?'ok':'muted';
  return `<tr><td>${esc(q.description)}${q.file_name?`<br><small>${esc(q.file_name)}</small>`:''}${q.na_reason?`<br><small>${esc(q.na_reason)}</small>`:''}</td><td>${esc(day(q.needed_by))}</td><td>${badge(q.status.replace('_',' '),tone)}</td><td>${c.status==='Open'?(q.status==='MISSING'?button('kra-attach','Attach a document',q.request_id)+(leader?' '+button('kra-na','Not applicable',q.request_id):''):button('kra-reopen','Return to missing',q.request_id)):''}</td></tr>`;}).join('')}</tbody></table></div>`:'<p class="muted full">No documents listed yet.</p>';
 if(c.status==='Open')html+=`<div class="actions full">${button('kra-request-add','+ Add a requested document',c.case_id)}</div>`;
 // Client support tickets linked to this notice (opened from Communications Hub > Client services).
 const tix=r.tickets||[];
 html+=`<h3 class="full">Client support tickets linked to this notice (${tix.length})</h3>`;
 html+=tix.length?`<div class="scroll full"><table id="kraTickets"><thead><tr><th>Ticket</th><th>Service</th><th>Status</th><th>Assigned to</th><th>Due</th></tr></thead><tbody>${tix.map(t=>`<tr><td>CST-${esc(t.ticket_number)}${t.priority&&t.priority!=='Medium'?`<small>${esc(t.priority)} priority</small>`:''}</td><td>${esc(t.service_name)}</td><td>${esc(t.status)}</td><td>${esc(t.assigned_name)}</td><td>${t.response_due_on?`<small>Respond by ${esc(day(t.response_due_on))}</small>`:''}${t.resolution_due_on?`<small>Resolve by ${esc(day(t.resolution_due_on))}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted full">No client support ticket is linked to this notice. Link one when you open or update a ticket under Communications Hub > Client services.</p>';
 html+=timelineView({events:r.events,button,c});
 // Actions.
 const actions=[];
 if(c.status==='Open'){actions.push(button('kra-respond','Mark as submitted to KRA',c.case_id,'class="primary"'));actions.push(button('kra-edit','Edit the notice details',c.case_id));}
 if(c.status==='Responded'&&leader)actions.push(button('kra-return','Return to Open',c.case_id));
 if(c.status==='Responded'&&partner)actions.push(button('kra-close','Approve & Close',c.case_id,'class="primary"'));
 if(c.status==='Responded'&&!partner)actions.push('<span class="muted">Only a Partner can approve and close.</span>');
 if(open&&leader)actions.push(button('kra-cancel','Cancel (logged in error)',c.case_id));
 if(actions.length)html+=`<div class="actions full">${actions.join(' ')}</div>`;
 const history=(r.flags||[]).filter(f=>f.status==='Resolved');
 if(history.length)html+=`<details class="full"><summary>Cleared flags (${history.length})</summary><ul>${history.map(f=>`<li>Flag ${esc(f.flag_code)} · ${esc(f.severity)}: ${esc(f.detail)} <small class="muted">Cleared ${esc(day(f.resolved_at))}${f.resolved_by_name?' by '+esc(f.resolved_by_name):''} (${esc(f.resolved_how||'')}).</small></li>`).join('')}</ul></details>`;
 return html;
}

export function listView({r,me,button,status,db}){
 const cases=r.cases||[],leader=leaderRole(me);
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 let html=`<p class="info full">${esc(KRA_NOTE)}</p>`;
 html+=`<div class="actions full">${button('kra-new','+ Log a KRA notice','','class="primary"')}${leader?' '+button('kra-check','Run the checks now'):''}${leader?' '+button('kra-settings','Task and flag settings'):''}${['Open','Responded','Closed','Cancelled'].map(s=>' '+button('kra-filter',s,s,status===s?'class="primary"':'')).join('')}${button('kra-filter','All','',!status?'class="primary"':'')}</div>`;
 html+=dashboardView(db);
 html+=cases.length?`<div class="scroll full"><table id="kraCases"><thead><tr><th>Client</th><th>KRA reference</th><th>Notice</th><th>Deadline</th><th>Status</th><th>Flags</th><th>Task</th><th></th></tr></thead><tbody>${cases.map(c=>`<tr><td>${esc(c.client_name)}</td><td>${esc(c.notice_reference)}</td><td>${esc(c.notice_type)}<br><small>${esc(c.tax_head)} · ${esc(day(c.period_start))} to ${esc(day(c.period_end))}</small></td><td>${esc(day(c.deadline_date))}<br>${badge(deadlineText(c.days_left),deadlineTone(c.days_left,c.status))}</td><td>${badge(c.status,STATUS_TONE[c.status]||'')}${c.stage?`<br><small>${esc(c.stage)}</small>`:''}</td><td>${c.open_flags?c.open_flags.split('').map(f=>badge(f,'bad')).join(' '):'<span class="muted">none</span>'}${c.missing_requests?`<br>${button('kra-missing',esc(c.missing_requests)+' document'+(c.missing_requests===1?'':'s')+' missing',c.case_id,'class="link-button"')}`:''}</td><td>${c.verification_task_id?`${esc(c.task_assignee_name||'')}${c.task_urgent?' '+badge('URGENT','bad'):''}<br><small>${esc(c.task_status||'')} · due ${esc(day(c.task_due_on))}</small>`:'<span class="muted">none yet</span>'}</td><td>${button('kra-case','Open',c.case_id)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted full">No KRA notices are logged.</p>';
 return html;
}

export function flagListView({r,button,severity}){
 const flags=r.flags||[];
 const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
 return `<div class="actions full">${button('kra-flag-filter','Critical only','CRITICAL',severity==='CRITICAL'?'class="primary"':'')} ${button('kra-flag-filter','All severities','',!severity?'class="primary"':'')}</div>`
  +(flags.length?flags.map(f=>`<div class="home-exception-row"><div><b>${esc(f.client_name)} · ${esc(f.notice_reference)}</b> ${badge(f.severity,SEVERITY_TONE[f.severity]||'')} ${badge('Flag '+f.flag_code)}<small>${esc(f.detail)} · ${esc(deadlineText(f.days_left))}</small><span class="preserve-lines"><b>To clear it:</b> ${esc(f.action_needed)}</span></div>${button('kra-case','Resolve',f.case_id)}</div>`).join(''):'<p class="muted compact-empty">No flags at this severity.</p>');
}

export function createKraUI(ctx){
 const {$,field,select,form,modal,request,notice,button,area,today}=ctx,d=()=>ctx.data();
 let cur=null,filter=null,flagSeverity='CRITICAL',options=null;
 const showCase=async id=>{cur=await request({action:'kra_read',case_id:id});modal('KRA notice · '+cur.case.notice_reference,caseView({r:cur,me:d().me,button}));};
 const showList=async(status=filter)=>{filter=status||null;const [r,dd]=await Promise.all([request({action:'kra_list',...(filter?{status:filter}:{})}),request({action:'kra_dashboard'}).catch(()=>({}))]);modal('KRA notices',listView({r,me:d().me,button,status:filter,db:dd.dashboard}));};
 const showFlags=async(sev=flagSeverity)=>{flagSeverity=sev||null;const r=await request({action:'kra_flags',...(flagSeverity?{severity:flagSeverity}:{})});modal(bannerText(r.counts),flagListView({r,severity:flagSeverity,button}));};
 const send=(title,body,action,extra,label='Save',after)=>modal(title,form(body,label),f=>request({action,...extra,...Object.fromEntries(f)}),after||(()=>showCase(cur.case.case_id)));
 const noticeFields=(c={})=>field('notice_reference','KRA reference on the notice *',c.notice_reference||'','text','required minlength="3" maxlength="80"')
  +select('notice_type','Type of notice *',(options?.types||['Audit notice','Assessment','Demand','Objection decision','Other']),c.notice_type||'Audit notice')
  +select('tax_head','Tax head *',(options?.tax_heads||['Income tax','VAT','PAYE','Withholding tax','Excise','Other']),c.tax_head||'VAT')
  +field('period_start','Period from *',day(c.period_start),'date','required')+field('period_end','Period to *',day(c.period_end),'date','required')
  +field('notice_date','Date on the notice *',day(c.notice_date),'date','required')+field('deadline_date','Response due to KRA by *',day(c.deadline_date),'date','required')
  +area('summary','What the notice asks for *',c.summary||'',true);
 async function logForm(){
  options=await request({action:'kra_form_options'});
  const clients=options.clients.map(c=>[c.client_id,c.company_name]);
  const firmName=id=>{const f=options.firms.find(x=>x.firm_id===id);return f?`${f.firm_code} · ${f.legal_name}`:id;};
  modal('Log a KRA notice',form(select('client_id','Client *',clients,'')+select('handling_firm_id','Handling firm *',[],'','Choose the client first')+noticeFields()
   +field('received_on','Date received (leave blank for today)','','date',`max="${today()}"`)
   +area('requests','Documents the notice asks for (one per line)','',false)
   +'<p class="info full">Logging the notice creates one verification task for the Manager who owns the client\'s tax project, otherwise the client owner. It is due 7 calendar days before the deadline, or 2 calendar days before and marked URGENT if the notice gives fewer than 7 days. These rules are not yet confirmed by the Tax Lead. Create the KRA project from the template yourself and link it on the case.</p>','Log the notice'),
   f=>{const o=Object.fromEntries(f);return request({action:'kra_log',...o});},
   async()=>{if(filter!==null)filter=null;await showList(null);});
  const fm=$('#editForm');if(!fm)return;
  const fill=()=>{const c=options.clients.find(x=>x.client_id===fm.elements.client_id.value);const ids=c?c.firm_ids:[];
   fm.elements.handling_firm_id.innerHTML=ids.map(i=>`<option value="${esc(i)}">${esc(firmName(i))}</option>`).join('')||'<option value="">No firm handles this client</option>';};
  fm.elements.client_id.addEventListener('change',fill);fill();
 }
 async function handle(action,id){
  if(!action.startsWith('kra-'))return false;
  const cid=cur?.case?.case_id||id;
  if(action==='kra-open'){filter=null;await showList(null);return true;}
  if(action==='kra-filter'){await showList(id||null);return true;}
  if(action==='kra-case'){await showCase(id);return true;}
  if(action==='kra-new'){await logForm();return true;}
  if(action==='kra-flags'){await showFlags(id==='ALL'?null:'CRITICAL');return true;}
  if(action==='kra-flag-filter'){await showFlags(id||null);return true;}
  if(action==='kra-check'){const r=await request({action:'kra_check_now'});notice(`Checked ${r.cases_checked} case${r.cases_checked===1?'':'s'}: ${r.flags_raised} new flag${r.flags_raised===1?'':'s'}, ${r.tasks_created} new task${r.tasks_created===1?'':'s'}.`);await showList(filter);return true;}
  if(action==='kra-edit'){send('Edit the notice details',noticeFields(cur.case)+select('notice_document_id','Copy of the notice (a document filed for this client)',(cur.documents||[]).map(x=>[x.document_id,`${x.file_name} · ${x.category}`]),cur.case.notice_document_id||'','None')+'<p class="muted full">Upload the notice to the client\'s documents first if it is not listed. The date received cannot change.</p>','kra_edit',{case_id:cur.case.case_id,revision:cur.case.revision,project_id:cur.case.project_id||''});return true;}
  if(action==='kra-link'){send('Link a project',select('project_id','Project of this client *',(cur.projects||[]).map(x=>[x.project_id,`${x.project_name} · ${x.service_code} · ${x.status}`]),cur.case.project_id||'')+'<p class="info full">The system does not create the KRA project. Create it from the AUP/KRA template, amend it to the notice, then link it here. Linking clears flag A and creates the verification task if there is none yet.</p>','kra_link_project',{case_id:cur.case.case_id,revision:cur.case.revision});return true;}
  if(action==='kra-respond'){
   const miss=(cur.requests||[]).filter(x=>x.status==='MISSING');
   if(miss.length){modal('Cannot submit yet · '+cur.case.notice_reference,missingView(miss,cur.case.notice_reference));return true;}
   send('Mark as submitted to KRA',field('submitted_at','Date and time submitted *',nairobiNow(),'datetime-local',`required max="${nairobiNow()}"`)+select('submission_channel','Channel *',CHANNELS.map(x=>[x,x]),'','Choose…')+field('submission_reference','KRA reference or iTax acknowledgment number *','','text','required minlength="3" maxlength="200"')+select('ack_document_id','Acknowledgment document (optional: upload it to the client\'s documents first)',(cur.documents||[]).map(x=>[x.document_id,`${x.file_name} · ${x.category}`]),'','Save it later')+'<p class="info full">A Partner then approves and closes the case. Flags B and E clear when you do this.</p>','kra_respond',{case_id:cur.case.case_id,revision:cur.case.revision},'Mark as submitted');return true;}
  if(action==='kra-missing'){const r=await request({action:'kra_read',case_id:id});cur=r;modal('Documents missing · '+r.case.notice_reference,missingView((r.requests||[]).filter(x=>x.status==='MISSING'),r.case.notice_reference,button));return true;}
  if(action==='kra-stage'){const live=cur.case.status==='Open'?OPEN_STAGES:SUBMITTED_STAGES.slice(1);send('Change stage',select('stage','Stage *',live.map(x=>[x,x]),cur.progress?.stage,'')+(cur.case.status==='Open'?'<p class="info full">Approved to send is set by a Manager or Partner. Submitting to KRA is done with Mark as submitted.</p>':'<p class="info full">Resolved is set by a Manager or Partner; a Partner still approves and closes the case.</p>'),'kra_stage',{case_id:cur.case.case_id,revision:cur.case.revision});return true;}
  if(action==='kra-ack'){send('Acknowledgment from KRA',select('document_id','Document filed for this client *',(cur.documents||[]).map(x=>[x.document_id,`${x.file_name} · ${x.category}`]),cur.progress?.ack_document_id||'')+'<p class="muted full">Upload the acknowledgment to the client\'s documents first if it is not listed.</p>','kra_ack',{case_id:cur.case.case_id,revision:cur.case.revision});return true;}
  if(action==='kra-contact'){send('Log a contact',select('kind','Type *',CONTACT_KINDS.map(x=>[x,x]),'Email','')+field('happened_at','When *',nairobiNow(),'datetime-local',`required max="${nairobiNow()}"`)+field('participants','With whom','','text','maxlength="300"')+area('summary','What was said or sent *','',true)+select('document_id','Attachment (optional)',(cur.documents||[]).map(x=>[x.document_id,`${x.file_name} · ${x.category}`]),'','None'),'kra_event_add',{case_id:cur.case.case_id,revision:cur.case.revision});return true;}
  if(action==='kra-return'){send('Return to Open',area('note','Why is it returned? *','',true),'kra_return',{case_id:cur.case.case_id,revision:cur.case.revision});return true;}
  if(action==='kra-close'){send('Approve & Close',`<p class="full">Approve the response to KRA for <b>${esc(cur.case.notice_reference)}</b> and close the case? A closed case can no longer change. Flag D clears.</p>`,'kra_close',{case_id:cur.case.case_id,revision:cur.case.revision},'Approve & Close');return true;}
  if(action==='kra-cancel'){send('Cancel this case',area('note','Why was it logged in error? *','',true)+'<p class="info full">The case stays on the record as cancelled; nothing is deleted.</p>','kra_cancel',{case_id:cur.case.case_id,revision:cur.case.revision},'Cancel the case',()=>showList(filter));return true;}
  if(action==='kra-request-add'){send('Add a requested document',field('description','Document the notice asks for *','','text','required minlength="5" maxlength="300"')+field('needed_by','Needed by (leave blank for the deadline)','','date'),'kra_request_add',{case_id:cur.case.case_id});return true;}
  if(action==='kra-attach'){const q=(cur.requests||[]).find(x=>x.request_id===id);if(!q)return true;send('Attach a document · '+q.description,select('document_id','Document filed for this client *',(cur.documents||[]).map(x=>[x.document_id,`${x.file_name} · ${x.category}`]),'')+'<p class="muted full">Upload the document to the client\'s documents first if it is not listed.</p>','kra_request_attach',{case_id:cur.case.case_id,request_id:id,revision:q.revision});return true;}
  if(action==='kra-na'){const q=(cur.requests||[]).find(x=>x.request_id===id);if(!q)return true;send('Not applicable · '+q.description,area('reason','Why does this not apply? *','',true),'kra_request_na',{case_id:cur.case.case_id,request_id:id,revision:q.revision});return true;}
  if(action==='kra-reopen'){const q=(cur.requests||[]).find(x=>x.request_id===id);if(!q)return true;await request({action:'kra_request_reopen',case_id:cur.case.case_id,request_id:id,revision:q.revision});await showCase(cur.case.case_id);return true;}
  if(action==='kra-settings'){
   const r=await request({action:'kra_settings_read'}),partner=d().me?.category_code==='PARTNER';
   modal('Task and flag settings',`<p class="info full">${esc(KRA_NOTE)}</p><div class="scroll full"><table id="kraSettings"><thead><tr><th>Setting</th><th>Value</th><th>Status</th><th></th></tr></thead><tbody>${(r.settings||[]).map(s=>`<tr><td>${esc(s.label)}</td><td>${esc(s.int_value??s.text_value)}</td><td>${esc(settingStatus(s))}${s.source_note?`<br><small>${esc(s.source_note)}</small>`:''}</td><td>${partner?button('kra-setting-set','Change',s.setting_key)+(s.rule_status==='Suggested'?' '+button('kra-setting-confirm','Record confirmation',s.setting_key):''):''}</td></tr>`).join('')}</tbody></table></div>`);
   cur={...(cur||{}),settings:r.settings};return true;
  }
  if(action==='kra-setting-set'){const s=(cur?.settings||[]).find(x=>x.setting_key===id);if(!s)return true;modal('Change · '+s.label,form(field('value','New value *',String(s.int_value??s.text_value),s.int_value!==null?'number':'text','required')+'<p class="info full">Changing a value withdraws any recorded confirmation.</p>'),f=>request({action:'kra_setting_set',setting_key:id,revision:s.revision,value:f.get('value')}),()=>handle('kra-settings'));return true;}
  if(action==='kra-setting-confirm'){const s=(cur?.settings||[]).find(x=>x.setting_key===id);if(!s)return true;modal('Record confirmation · '+s.label,form(area('source_note','Who confirmed this, and where it is written (for example the Tax Lead\'s email and its date) *','',true)),f=>request({action:'kra_setting_confirm',setting_key:id,revision:s.revision,source_note:f.get('source_note')}),()=>handle('kra-settings'));return true;}
  return false;
 }
 // The red banner on the Partner's Home page. It opens the list of critical flags; each row has a Resolve button that opens the case.
 async function paintBanner(){
  const box=$('#homeKraFlags');if(!box)return;
  let r;try{r=await request({action:'kra_flags',severity:'CRITICAL'});}catch(e){const p=box.querySelector('.compact-empty');if(p)p.textContent='KRA flags could not be loaded. Refresh Home to try again.';return;}
  const n=Number(r.counts?.cases_flagged||0),crit=Number(r.counts?.critical_cases||0);
  box.innerHTML=n?`<button type="button" class="kra-banner bad" data-suite="kra-flags" data-id="${crit?'CRITICAL':'ALL'}" aria-label="${esc(bannerText(r.counts))}"><b>${esc(bannerText(r.counts))}</b><span>${crit?`${crit} critical · `:''}Click to see the list and resolve each flag</span></button>`
   :`<p class="muted compact-empty">${esc(bannerText(r.counts))}.</p>`;
 }
 return {handle,paintBanner,openLog:()=>handle('kra-open','')};
}
