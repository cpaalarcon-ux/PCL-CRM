// Client lifecycle and contact routing, as pure functions the client file and the register call.
// Pause, Resume and Cancel: Manager or Partner (only a Partner reinstates a Cancelled client). Archive and Restore: Partner only.
// The database enforces every rule; these functions only decide which buttons to show.
export const LIFECYCLE_WORDS={Pause:{title:'Pause client',verb:'Pause',hint:'Paused clients get no new generated tasks and no new project can be started. Existing work stays open.'},
 Resume:{title:'Resume client',verb:'Resume',hint:'New tasks and projects can be created again.'},
 Cancel:{title:'Cancel client',verb:'Cancel',hint:'The service has ended. No new tasks or projects. Partners are told. Only a Partner can reinstate the client.'},
 Archive:{title:'Archive client',verb:'Archive',hint:'The client leaves the default register. Nothing is deleted. Active projects must be completed or archived first.'},
 Restore:{title:'Restore client',verb:'Restore',hint:'The client returns to the register.'}};

export const isArchived=c=>c?.record_status==='Archived';
export const serviceLabel=c=>isArchived(c)?'Archived':(c?.service_status&&c.service_status!=='Active'?c.service_status:'');

export function lifecycleActions(c,category){
 if(!c||!['PARTNER','MANAGER'].includes(category))return [];
 const partner=category==='PARTNER',out=[];
 if(isArchived(c))return partner?['Restore']:[];
 const s=c.service_status||'Active';
 if(s==='Active')out.push('Pause','Cancel');
 if(s==='Paused')out.push('Resume','Cancel');
 if(s==='Cancelled'&&partner)out.push('Resume');
 if(partner)out.push('Archive');
 return out;
}

export function lifecycleBadge(c,esc){
 const l=serviceLabel(c);if(!l)return '';
 return ` <span class="badge ${l==='Paused'?'warn':'bad'}" data-lifecycle-badge="${esc(l)}">${esc(l)}</span>`;
}

export function lifecycleBar(c,category,esc,shortDate){
 const acts=lifecycleActions(c,category),l=serviceLabel(c);
 const why=isArchived(c)?c.archive_reason:c.service_status!=='Active'?c.lifecycle_reason:'';
 const when=isArchived(c)?c.archived_at:c.lifecycle_changed_at;
 const note=l?`<p class="info" role="status"><b>${esc(l)}.</b> ${esc(why||'')}${when?` <small>${esc(shortDate(when))}${c.lifecycle_changed_by_name&&!isArchived(c)?' · '+esc(c.lifecycle_changed_by_name):''}</small>`:''}</p>`:'';
 const id=esc(c.client_id);
 const btns=acts.map(a=>`<button type="button" class="${a==='Cancel'||a==='Archive'?'danger':''}" data-client-life="${a}" data-id="${id}">${esc(LIFECYCLE_WORDS[a].verb)}</button>`).join('');
 return `${note}${btns?`<div class="actions" aria-label="Client lifecycle">${btns}</div>`:''}`;
}

export function lifecycleForm(action,esc){
 const w=LIFECYCLE_WORDS[action];
 return `<p class="info full">${esc(w.hint)}</p><label class="full">Reason * <textarea name="reason" required minlength="10" maxlength="1000" placeholder="At least 10 characters. This is kept in the audit trail."></textarea></label>`;
}

// Which saved contact receives document requests and which receives reports.
export function routingCard(c,contacts,leader,esc){
 const mine=contacts.filter(x=>x.client_id===c.client_id);
 const name=id=>mine.find(x=>x.contact_id===id)?.full_name;
 const read=`<p class="muted">Document requests go to <b>${esc(name(c.doc_request_contact_id)||'no one chosen')}</b>. Reports go to <b>${esc(name(c.report_delivery_contact_id)||'no one chosen')}</b>.</p>`;
 if(!leader)return `<h3>Contact routing</h3>${read}`;
 if(!mine.length)return `<h3>Contact routing</h3><p class="empty">Add a contact first, then choose who receives document requests and reports.</p>`;
 const sel=(field,cur)=>`<select name="${field}"><option value="">No one chosen</option>${mine.map(x=>`<option value="${esc(x.contact_id)}"${x.contact_id===cur?' selected':''}>${esc(x.full_name)}${x.email_address?' · '+esc(x.email_address):''}</option>`).join('')}</select>`;
 return `<h3>Contact routing</h3>${read}<form data-routing-form="${esc(c.client_id)}" class="form-grid"><label>Receives document requests ${sel('doc_request_contact_id',c.doc_request_contact_id)}</label><label>Receives reports ${sel('report_delivery_contact_id',c.report_delivery_contact_id)}</label><button type="submit" class="primary full">Save routing</button></form>`;
}
