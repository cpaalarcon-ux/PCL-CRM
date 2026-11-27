// Client status and contact routing, as pure functions the client file and the register call.
// Three statuses. Active: the engagement is ongoing. Inactive: no active engagement, can be renewed. Dormant: the client has left; the record is kept.
// Manager or Partner: Active and Inactive. Partner only: Dormant, and bringing a Dormant client back.
// The database enforces every rule and carries the change to projects, tasks and invoices; these functions only decide what to show.
export const STATUS_WORDS={
 Active:{title:'Set client Active',verb:'Set Active',hint:'The client\'s projects and tasks come back as they were and recurring tasks and invoices start again. Months the client was not Active are not billed. Tasks whose due date has passed are listed for you to give new dates.'},
 Inactive:{title:'Set client Inactive',verb:'Set Inactive',hint:'Use this when there is no active engagement but it may be renewed. All open projects and tasks of this client are put on hold: they leave work queues, send no alerts, and no recurring tasks or invoices are created. Nothing is deleted. Set the client Active to bring everything back.'},
 Dormant:{title:'Set client Dormant',verb:'Set Dormant',hint:'Use this when the client has left. The client and all its projects and tasks are archived and read-only, and leave the registers and dashboards. All details, owners, KYC and history are kept in case the client returns. Partners are told.'}};
// Kept for older callers: the earlier action names and the status each one now sets.
export const LIFECYCLE_WORDS={Pause:STATUS_WORDS.Inactive,Resume:STATUS_WORDS.Active,Archive:STATUS_WORDS.Dormant,Restore:STATUS_WORDS.Active};

export const isArchived=c=>c?.record_status==='Archived';
export const clientStatus=c=>c?.client_status||(isArchived(c)?'Dormant':(c?.service_status&&c.service_status!=='Active'?'Inactive':'Active'));
export const serviceLabel=c=>{const s=clientStatus(c);return s==='Active'?'':s;};

// The statuses this person may move the client to.
export function lifecycleActions(c,category){
 if(!c||!['PARTNER','MANAGER'].includes(category))return [];
 const partner=category==='PARTNER',s=clientStatus(c);
 if(s==='Dormant')return partner?['Active']:[];
 return [s==='Active'?'Inactive':'Active',...(partner?['Dormant']:[])];
}

export function lifecycleBadge(c,esc){
 const l=serviceLabel(c);if(!l)return '';
 return ` <span class="badge ${l==='Inactive'?'warn':'bad'}" data-lifecycle-badge="${esc(l)}">${esc(l)}</span>`;
}

export function lifecycleBar(c,category,esc,shortDate){
 const acts=lifecycleActions(c,category),s=clientStatus(c),l=serviceLabel(c);
 const why=s==='Dormant'?c.archive_reason:s==='Inactive'?c.lifecycle_reason:'';
 const when=s==='Dormant'?c.archived_at:c.lifecycle_changed_at;
 const effect=s==='Inactive'?' Projects and tasks are on hold; no alerts, recurring tasks or recurring invoices.':s==='Dormant'?' The record and its work are archived and read-only.':'';
 const note=l?`<p class="info" role="status"><b>${esc(l)}.</b> ${esc(why||'')}${when?` <small>${esc(shortDate(when))}${c.lifecycle_changed_by_name&&s!=='Dormant'?' · '+esc(c.lifecycle_changed_by_name):''}</small>`:''}${effect}</p>`:'';
 const id=esc(c.client_id);
 const btns=acts.map(a=>`<button type="button" class="${a==='Dormant'?'danger':''}" data-client-status="${a}" data-id="${id}" title="${a==='Dormant'||s==='Dormant'?'Who: Partner.':'Who: Partner or Manager.'}">${esc(STATUS_WORDS[a].verb)}</button>`).join('');
 const held=['PARTNER','MANAGER','SUPERVISOR'].includes(category)?`<button type="button" data-client-held="${id}" title="Who: Partner, Manager or Supervisor. Projects and tasks on hold, tasks needing new dates, and every status change.">Status history and held work</button>`:'';
 return `${note}${btns||held?`<div class="actions" aria-label="Client status">${btns}${held}</div>`:''}`;
}

// The form for one change. A Dormant client coming back needs a choice about the earlier work.
export function lifecycleForm(target,esc,from=''){
 const w=STATUS_WORDS[target]||LIFECYCLE_WORDS[target];
 const back=target==='Active'&&from==='Dormant'?`<fieldset class="full"><legend>Earlier projects and tasks *</legend><label><input type="radio" name="old_work" value="Resume" required> Resume them: the archived projects and their open tasks come back as they were</label><label><input type="radio" name="old_work" value="Leave archived" required> Leave them archived: they stay as history, and new projects are created for the new engagement</label></fieldset>`:'';
 return `<p class="info full">${esc(w.hint)}</p>${back}<label class="full">Reason * <textarea name="reason" required minlength="10" maxlength="1000" placeholder="At least 10 characters. This is kept in the record of status changes."></textarea></label>`;
}

// The held work of one client and the record of its status changes.
export function heldWorkHtml(r,esc,shortDate){
 const none=t=>`<p class="empty">${esc(t)}</p>`,hold=h=>h==='Archived'?'Left archived':h==='Dormant'?'Archived (Dormant)':'On hold (Inactive)';
 const table=(head,rows)=>`<div class="scroll"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
 const redate=(r.to_redate||[]).length?`<h3>Tasks needing a new date (${r.to_redate.length})</h3><p class="info">Their due date passed while the client was not Active. No overdue alert is sent until each is given a new date.</p>`+table(['Task','Was due','Assigned to'],r.to_redate.map(t=>`<tr><td>${esc(t.task_name)}</td><td>${esc(shortDate(t.due_at))}</td><td>${esc(t.assigned_name||'')}</td></tr>`)):'';
 const projects=`<h3>Projects on hold (${(r.projects||[]).length})</h3>`+((r.projects||[]).length?table(['Project','State'],r.projects.map(p=>`<tr><td>${esc(p.project_name)}</td><td>${esc(hold(p.client_hold))}</td></tr>`)):none('No project is on hold.'));
 const tasks=`<h3>Tasks on hold (${(r.tasks||[]).length})</h3>`+((r.tasks||[]).length?table(['Task','Status when held','Due','Assigned to','State'],r.tasks.map(t=>`<tr><td>${esc(t.task_name)}</td><td>${esc(t.status)}</td><td>${t.due_at?esc(shortDate(t.due_at)):''}</td><td>${esc(t.assigned_name||'')}</td><td>${esc(hold(t.client_hold))}</td></tr>`)):none('No task is on hold.'));
 const history=`<h3>Status changes</h3>`+((r.history||[]).length?table(['Date','Change','By','Reason','Work affected'],r.history.map(h=>`<tr><td>${esc(shortDate(h.changed_at))}</td><td>${esc(h.from_status)} to ${esc(h.to_status)}${h.old_work?`<small>Earlier work: ${esc(h.old_work.toLowerCase())}</small>`:''}</td><td>${esc(h.changed_by||'')}</td><td>${esc(h.reason)}</td><td>${h.projects} project${h.projects===1?'':'s'}, ${h.tasks} task${h.tasks===1?'':'s'}</td></tr>`)):none('No status change has been recorded.'));
 return `<p class="info">This client is <b>${esc(r.status)}</b>. Held work is read-only and does not appear in work queues or dashboards.</p>${redate}${projects}${tasks}${history}`;
}

// Which saved contact receives document requests and which receives reports.
export function routingCard(c,contacts,leader,esc){
 const mine=contacts.filter(x=>x.client_id===c.client_id);
 const name=id=>mine.find(x=>x.contact_id===id)?.full_name;
 const read=`<p class="muted">Document requests go to <b>${esc(name(c.doc_request_contact_id)||'no one chosen')}</b>. Reports go to <b>${esc(name(c.report_delivery_contact_id)||'no one chosen')}</b>.</p>`;
 if(!leader)return `<h3>Contact routing</h3>${read}`;
 if(!mine.length)return `<h3>Contact routing</h3><p class="empty">Add a contact first, then choose who receives document requests and reports.</p>`;
 const sel=(field,cur)=>`<select name="${field}" aria-label="${esc(String(field).replace(/_/g,' '))}"><option value="">No one chosen</option>${mine.map(x=>`<option value="${esc(x.contact_id)}"${x.contact_id===cur?' selected':''}>${esc(x.full_name)}${x.email_address?' · '+esc(x.email_address):''}</option>`).join('')}</select>`;
 return `<h3>Contact routing</h3>${read}<form data-routing-form="${esc(c.client_id)}" class="form-grid"><label>Receives document requests ${sel('doc_request_contact_id',c.doc_request_contact_id)}</label><label>Receives reports ${sel('report_delivery_contact_id',c.report_delivery_contact_id)}</label><button type="submit" class="primary full">Save routing</button></form>`;
}

// Communication access: who may record and see EXTERNAL client communications. Internal notes stay open to anyone working on the client.
export const COMM_LEVELS=[['SUPERVISORS_AND_ABOVE','Supervisors, Managers and Partners'],['MANAGERS_AND_PARTNERS','Managers and Partners only']];
export const commExternalAllowed=(role,level)=>role==='PARTNER'||role==='MANAGER'||(role==='SUPERVISOR'&&(level||'SUPERVISORS_AND_ABOVE')==='SUPERVISORS_AND_ABOVE');
export function commAccessCard(c,role,esc){
 const level=c.comm_access_level||'SUPERVISORS_AND_ABOVE',label=COMM_LEVELS.find(([k])=>k===level)?.[1]||level,ok=commExternalAllowed(role,level);
 const state=ok?`<p class="muted">External communications with this client (letters, emails, calls, meetings, visits) can be recorded and read by <b>${esc(label)}</b>. Internal notes are open to everyone working on the client.</p>`:`<p class="info" role="status">External client communications are locked for your role. You can still record internal notes. Ask a Supervisor, Manager or Partner to contact the client.</p>`;
 if(!['PARTNER','MANAGER'].includes(role))return `<h3>Communication access</h3>${state}`;
 return `<h3>Communication access</h3>${state}<form data-comm-form="${esc(c.client_id)}" class="form-grid"><label>Who may record external communications <select name="level">${COMM_LEVELS.map(([k,t])=>`<option value="${k}"${k===level?' selected':''}>${esc(t)}</option>`).join('')}</select></label><label>Reason for the setting * <input name="reason" required minlength="10" maxlength="1000" placeholder="For example: sensitive dispute, Partner handles all contact"></label><button type="submit" class="primary full">Save communication access</button></form>`;
}
