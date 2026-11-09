// Request Documents, on the client file (Documents / KYC tab). Assistants choose a pre-approved template and tick items. A Supervisor, Manager or
// Partner sends the request through their own channel and records how. Managers and Partners write and approve the templates.
// The database enforces every rule; this file only draws the card and sends the choices.
export const SENT_VIA=['Email','WhatsApp','Phone','In person','Client portal'];
export const canSend=(role,level)=>role==='PARTNER'||role==='MANAGER'||(role==='SUPERVISOR'&&(level||'SUPERVISORS_AND_ABOVE')==='SUPERVISORS_AND_ABOVE');
export const canRequest=role=>['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'].includes(role);
export const canManageTemplates=role=>role==='PARTNER'||role==='MANAGER';
export function docRequestShell(clientId,role,esc){
 if(!canRequest(role))return '';
 return `<section class="card inner" id="docRequests" data-client="${esc(clientId)}"><h3>Request documents</h3><p class="muted">${role==='ASSISTANT'?'Choose an approved template and tick the items you need. A Supervisor, Manager or Partner sends it to the client; you cannot message the client yourself.':'Choose an approved template and tick the items. The request is kept here until it is sent to the client and the way it was sent is recorded.'}</p><div id="docRequestBody"><p class="muted" role="status">Loading…</p></div></section>`;
}
const chips=(items,esc)=>items.map(i=>`<li>${esc(i)}</li>`).join('');
export function renderDocRequests({requests,templates,role,level,staffId,esc,shortDate,projects=[],clientId}){
 const approved=templates.filter(t=>t.status==='Approved');
 const create=canRequest(role)?(approved.length?`<div class="actions"><button type="button" class="primary" data-docreq="new">New document request</button></div>`:'<p class="info">No approved request template is available yet. A Manager or Partner approves the templates below.</p>'):'';
 const rows=requests.length?requests.map(r=>{
  const mine=r.requested_by===staffId,open=r.status==='Awaiting sending';
  const act=open&&canSend(role,level)?`<div class="actions"><button type="button" class="primary" data-docreq="sent" data-id="${esc(r.request_id)}">Mark as sent</button><button type="button" data-docreq="cancel" data-id="${esc(r.request_id)}">Cancel</button><button type="button" data-docreq="copy" data-id="${esc(r.request_id)}">Show message</button></div>`:open&&mine?'<small>Waiting for a Supervisor, Manager or Partner to send it.</small>':'';
  const state=r.status==='Sent'?`Sent by ${esc(r.decider_name||'')} on ${esc(shortDate(r.decided_at))} (${esc(r.sent_via||'')})`:r.status==='Cancelled'?`Cancelled by ${esc(r.decider_name||'')}: ${esc(r.decision_note||'')}`:'Awaiting sending';
  return `<div class="task"><div><b>${esc(r.title)}</b> · ${esc(shortDate(r.period_start))} to ${esc(shortDate(r.period_end))}<small>Requested by ${esc(r.requester_name)} on ${esc(shortDate(r.created_at))} · ${state}${r.contact_name?` · Contact: ${esc(r.contact_name)}`:''}</small><ul class="plain">${chips(r.items,esc)}</ul>${act}</div></div>`;}).join(''):'<p class="empty">No document requests for this client yet.</p>';
 const tpl=canManageTemplates(role)?`<h4 class="section-space">Request templates</h4><p class="muted">Assistants can use only approved templates. A change sends a template back to Pending. The person who wrote the wording cannot approve it.</p>${templates.map(t=>`<div class="task"><div><b>${esc(t.title)}</b> <span class="badge ${t.status==='Approved'?'good':t.status==='Retired'?'':'warn'}">${esc(t.status)}</span><ul class="plain">${chips(t.items,esc)}</ul><div class="actions"><button type="button" data-docreq="tpl-edit" data-id="${esc(t.template_id)}">Edit</button>${t.status!=='Approved'&&t.status!=='Retired'&&t.created_by!==staffId?`<button type="button" class="primary" data-docreq="tpl-approve" data-id="${esc(t.template_id)}">Approve</button>`:''}${t.status==='Approved'?`<button type="button" data-docreq="tpl-retire" data-id="${esc(t.template_id)}">Retire</button>`:''}</div></div></div>`).join('')}<div class="actions"><button type="button" data-docreq="tpl-new">New template</button></div>`:'';
 return create+rows+tpl;
}
export async function paintDocRequests(ctx){
 const box=document.querySelector('#docRequests');if(!box)return;
 const {request,esc,shortDate,data}=ctx,d=data(),clientId=box.dataset.client,role=d.me.category_code,client=d.clients.find(c=>c.client_id===clientId)||{};
 try{
  const [r,t]=await Promise.all([request({action:'doc_request_list',client_id:clientId}),request({action:'doc_request_template_list'})]);
  box.querySelector('#docRequestBody').innerHTML=renderDocRequests({requests:r.requests||[],templates:t.templates||[],role,level:client.comm_access_level,staffId:d.me.staff_id,esc,shortDate,clientId});
  box._requests=r.requests||[];box._templates=t.templates||[];
 }catch(e){box.querySelector('#docRequestBody').innerHTML=`<p class="info">${esc(e.message)}</p>`;}
}
export function bindDocRequests(ctx){
 const {esc,form,field,select,modal,request,data,notice,shortDate,today}=ctx;
 document.addEventListener('click',async e=>{
  const b=e.target.closest?.('[data-docreq]');if(!b)return;const box=document.querySelector('#docRequests');if(!box)return;
  const d=data(),clientId=box.dataset.client,what=b.dataset.docreq,tpls=box._templates||[],reqs=box._requests||[];
  if(what==='new'){
   const approved=tpls.filter(t=>t.status==='Approved'),projects=d.projects.filter(p=>p.client_id===clientId);
   const day=today();
   modal('New document request',form(`<label class="full">Template *<select name="template_id" required>${approved.map(t=>`<option value="${esc(t.template_id)}">${esc(t.title)}</option>`).join('')}</select></label><div class="full" id="docReqItems"></div>${field('period_start','Period from *',day.slice(0,8)+'01','date','required')}${field('period_end','Period to *',day,'date','required')}${projects.length?select('project_id','Project (optional)',projects.map(p=>[p.project_id,p.project_name]),'','No project'):''}<p class="info full">You cannot change the wording. Only the items and the period. A Supervisor, Manager or Partner sends it to the client.</p>`,'Send for sending'),
    f=>request({action:'doc_request_create',client_id:clientId,template_id:f.get('template_id'),items:f.getAll('items'),period_start:f.get('period_start'),period_end:f.get('period_end'),project_id:f.get('project_id')||null}),()=>{},{successMessage:'Request saved. A Supervisor, Manager or Partner has been alerted to send it.'});
   const f=document.querySelector('#editForm'),sel=f.elements.template_id,paint=()=>{const t=approved.find(x=>x.template_id===sel.value);document.querySelector('#docReqItems').innerHTML=t?`<fieldset><legend>Items *</legend>${t.items.map(i=>`<label><input type="checkbox" name="items" value="${esc(i)}" checked> ${esc(i)}</label>`).join('')}</fieldset>`:'';};
   sel.onchange=paint;paint();return;
  }
  if(what==='sent'){modal('Mark as sent',form(`<p class="info full">The ERP does not send messages yet. Send the request to the client yourself, then record how you sent it.</p>${select('sent_via','How did you send it? *',SENT_VIA,'Email')}<label class="full">Note (optional)<input name="note" maxlength="1000"></label>`,'Record as sent'),f=>request({action:'doc_request_decide',request_id:b.dataset.id,decision:'Sent',sent_via:f.get('sent_via'),note:f.get('note')||''}),()=>{},{successMessage:'Recorded as sent. The person who asked has been told.'});return;}
  if(what==='cancel'){modal('Cancel this request',form(`<label class="full">Reason * (at least 10 characters)<textarea name="note" required minlength="10" maxlength="1000"></textarea></label>`,'Cancel request'),f=>request({action:'doc_request_decide',request_id:b.dataset.id,decision:'Cancel',note:f.get('note')}),()=>{},{successMessage:'Cancelled. The person who asked has been told.'});return;}
  if(what==='copy'){const r=reqs.find(x=>x.request_id===b.dataset.id);if(!r)return;modal('Message to send to the client',`<p class="muted">${r.contact_name?`Send to ${esc(r.contact_name)}${r.contact_email?' · '+esc(r.contact_email):''}${r.contact_phone?' · '+esc(r.contact_phone):''}`:'No document-request contact is set on this client. Choose one under Contacts.'}</p><pre class="preserve-lines">${esc(r.message_text||'')}</pre>`,()=>{});return;}
  if(what==='tpl-new'||what==='tpl-edit'){
   const t=what==='tpl-edit'?tpls.find(x=>x.template_id===b.dataset.id):{title:'',body:'Dear {client}, to complete your records for {period} please send us the documents listed below.',items:[]};if(!t)return;
   modal(what==='tpl-new'?'New request template':'Edit request template',form(`${field('title','Title *',t.title,'text','required maxlength="100"')}<label class="full">Message * (use {client} and {period})<textarea name="body" required minlength="20" maxlength="1500">${esc(t.body)}</textarea></label><label class="full">Documents, one per line *<textarea name="items_text" required>${esc((t.items||[]).join('\n'))}</textarea></label><p class="info full">Another Manager or Partner must approve the wording before Assistants can use it.</p>`,'Save template'),f=>request({action:'doc_request_template_save',template_id:t.template_id||null,title:f.get('title'),body:f.get('body'),items_text:f.get('items_text')}),()=>{},{successMessage:'Saved. It waits for another Manager or Partner to approve it.'});return;
  }
  if(what==='tpl-approve'||what==='tpl-retire'){try{await request({action:'doc_request_template_decide',template_id:b.dataset.id,decision:what==='tpl-approve'?'Approve':'Retire'});await ctx.load();notice(what==='tpl-approve'?'Template approved.':'Template retired.');}catch(err){notice(err.message,true);}}
 });
}
