const queues=[
 ['today','Due today'],['overdue','Overdue'],['waiting','Waiting on client'],
 ['review','Awaiting review'],['all','All open'],
];
const dateFormat=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeZone:'Africa/Nairobi'});
const dueLabel=value=>value?dateFormat.format(new Date(value+'T00:00:00+03:00')):'No deadline';

export function followupQueues(items,today){
 return {
  today:items.filter(item=>item.due_on===today),
  overdue:items.filter(item=>item.overdue),
  waiting:items.filter(item=>item.waiting),
  review:items.filter(item=>item.awaiting_review),
  all:items,
 };
}

export function createFollowupsUI({esc,request,firm,today,openTask,openMessage,openCorrespondence,openTicket,createFromMessage}){
 let selected='today';
 const itemsByPanel=new WeakMap();
 function paint(root,rows){
  const groups=followupQueues(rows,today()),items=groups[selected].slice().sort((a,b)=>
   Number(!!b.overdue)-Number(!!a.overdue)||(a.due_on||'9999').localeCompare(b.due_on||'9999')||a.title.localeCompare(b.title));
  const control=(action,label,id='')=>`<button type="button" data-followup-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const source=item=>item.message_id||item.opaque_reference||item.kind==='request_ticket';
  root.querySelector('[data-followup-filters]').innerHTML=queues.map(([key,label])=>`<button type="button" data-followup-action="filter" data-id="${key}" aria-pressed="${key===selected}">${label} <span>${groups[key].length}</span></button>`).join('');
  root.querySelector('[data-followup-status]').textContent=items.length?`${items.length} open ${items.length===1?'item':'items'}`:'No follow-ups in this view.';
  root.querySelector('[data-followup-items]').innerHTML=items.map(item=>`<li class="followup-row">
   <div><strong>${esc(item.title)}</strong><span>${esc(item.company_name)} · ${esc(item.status)}</span></div>
   <div><span>${esc(item.owner||'Assigned staff')}</span><span class="${item.overdue?'followup-late':''}">${item.overdue?'Overdue · ':''}${esc(dueLabel(item.due_on))}</span></div>
   <div class="actions">
    ${item.kind==='task'?control('task','Open task',item.id):''}
    ${item.kind==='request'&&item.awaiting_review?control('approve','Create task',item.id):''}
    ${source(item)?control('source','Open source',item.id):''}
   </div></li>`).join('');
 }
 async function refresh(root){
  if(!root||root.dataset.loading==='yes')return;
  root.dataset.loading='yes';
  root.setAttribute('aria-busy','true');
  root.querySelector('[data-followup-status]').textContent='Loading follow-ups…';
  try{
   const result=await request({action:'communication_followup_list',firm_id:firm()||null});
   if(!root.isConnected)return;
   const items=result.items||[];
   itemsByPanel.set(root,items);
   paint(root,items);
  }catch(error){
   if(root.isConnected)root.querySelector('[data-followup-status]').textContent=error.message||'Follow-ups could not be loaded.';
  }finally{
   root.dataset.loading='no';
   root.setAttribute('aria-busy','false');
  }
 }
 function view(){
  queueMicrotask(()=>void refresh(document.querySelector('#communicationFollowups')));
  return `<section id="communicationFollowups" aria-labelledby="followupHeading">
   <div class="section-head"><h3 id="followupHeading">My Follow-ups</h3><button type="button" data-followup-action="refresh">Refresh</button></div>
   <div class="actions followup-filters" role="group" aria-label="Follow-up views" data-followup-filters></div>
   <p role="status" data-followup-status>Loading follow-ups…</p><ul class="followup-items" data-followup-items></ul></section>`;
 }
 document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-followup-action]'),root=button?.closest('#communicationFollowups');
  if(!root)return;
  const {followupAction:action,id}=button.dataset,rows=itemsByPanel.get(root)||[];
  if(action==='refresh'){await refresh(root);return;}
  if(action==='filter'){
   selected=id;paint(root,rows);
   [...root.querySelectorAll('[data-followup-action="filter"]')].find(el=>el.dataset.id===id)?.focus();
   return;
  }
  const item=rows.find(row=>row.id===id);
  if(!item)return;
  try{
   if(action==='task')await openTask(id);
   else if(action==='approve')await createFromMessage(item.channel_id,item.message_id,id,()=>refresh(root));
   else if(item.message_id)await openMessage(item.channel_id,item.message_id);
   else if(item.opaque_reference)await openCorrespondence(item.opaque_reference);
   else if(item.kind==='request_ticket')await openTicket(id);
  }catch(error){root.querySelector('[data-followup-status]').textContent=error.message||'The source is unavailable.';}
 });
 return {view};
}

export async function openFollowupForm({esc,request,channelId,messageId,followupId,openTask,onSaved,isCurrent=()=>true}){
 const source={channel_id:channelId,message_id:messageId,followup_id:followupId};
 const {body,create,projects,staff,types,pending}=await request({action:'communication_followup_options',...source});
 if(!isCurrent()||document.querySelector('.followup-dialog'))return;
 if(!projects.length)throw Error('There is no active engagement available for this message.');
 const dialog=document.createElement('dialog'),opener=document.activeElement;
 dialog.className='followup-dialog';
 dialog.setAttribute('aria-labelledby','followupFormTitle');
 const heading=create?'Create Follow-up':'Request Follow-up';
 const options=(rows,key,label)=>rows.map(row=>`<option value="${esc(row[key])}">${esc(label(row))}</option>`).join('');
 dialog.innerHTML=`<form><h2 id="followupFormTitle">${heading}</h2>
  <details><summary>View source message</summary><blockquote class="followup-source">${esc(body||'Attachment or shared record')}</blockquote></details>
  <label>Client and engagement<select name="project_id" required><option value="">Choose engagement…</option>${options(projects,'project_id',p=>p.company_name+' · '+p.project_name)}</select></label>
  <label>Task title<input name="title" required minlength="3" maxlength="200" placeholder="e.g. Respond to KRA notice" value="${esc(pending?.title||'')}"></label>
  <label>Action summary<textarea name="summary" required minlength="3" maxlength="2000" rows="3" aria-describedby="followupPrivacy">${esc(pending?.summary||'')}</textarea></label>
  <p id="followupPrivacy">Use wording suitable for the engagement team. The conversation stays private.</p>
  <label>Due date<input name="due_on" type="date" required value="${esc(pending?.due_on||'')}"></label>
  ${create?`<label>Assign to<select name="assigned_to" required></select></label>
   ${types.length?`<label>Task type<select name="task_type_id" required><option value="">Choose task type…</option>${options(types,'standard_id',t=>t.label)}</select></label>`:''}`:''}
  <p role="status" data-result></p>
  <div class="actions"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${heading}</button></div></form>`;
 const form=dialog.querySelector('form'),fields=form.elements,result=form.querySelector('[data-result]'),save=form.querySelector('[type=submit]');
 const close=form.querySelector('[data-close]'),project=fields.project_id;
 const staffChoices=()=>{
  if(!create)return;
  const firm=projects.find(row=>row.project_id===project.value)?.handling_firm_id;
  const assistants=staff.filter(row=>row.firm_id===firm);
  fields.assigned_to.innerHTML='<option value="">Choose assistant…</option>'+options(assistants,'staff_id',row=>row.full_name);
  save.disabled=!!project.value&&!assistants.length;
  result.textContent=save.disabled?'No eligible Assistant is available for this handling firm.':'';
 };
 if(pending||projects.length===1)project.value=pending?.project_id||projects[0].project_id;
 if(pending)project.disabled=true;
 project.addEventListener('change',staffChoices);staffChoices();
 close.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('cancel',event=>{if(form.getAttribute('aria-busy')==='true')event.preventDefault();});
 dialog.addEventListener('close',()=>{dialog.remove();if(opener?.isConnected)opener.focus();},{once:true});
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(save.disabled)return;
  const values=Object.fromEntries(new FormData(form));
  save.disabled=true;close.disabled=true;form.setAttribute('aria-busy','true');result.textContent='Saving follow-up…';
  try{
   const response=await request({action:'communication_followup_create',...values,...source,project_id:project.value,request_only:!create});
   onSaved?.(response);
   result.textContent=response.existing?'A follow-up already exists for this message and engagement.':response.requested?'Follow-up requested.':'Follow-up task created.';
   save.remove();close.textContent='Done';
   if(response.task_id){
    const open=document.createElement('button');open.type='button';open.textContent='Open task';
    open.addEventListener('click',()=>{dialog.close();openTask(response.task_id);});
    close.after(open);
   }
   close.focus();
  }catch(error){result.textContent=error.message||'The follow-up could not be saved.';save.disabled=false;}
  finally{form.setAttribute('aria-busy','false');close.disabled=false;}
 });
 document.body.append(dialog);
 dialog.showModal();
 (project.disabled?fields.title:project).focus();
}
