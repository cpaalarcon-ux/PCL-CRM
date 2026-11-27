const api=window.pclOffline;
const element=id=>document.getElementById(id);
const login=element('login'),draft=element('draft'),fields=draft.elements;
const message=element('message');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format();
let editing=null, state, taskSignature, entriesSignature, busy=false, lastActivity=0;

function report(value) { message.textContent=value; }
function resetDraft() {
  editing=null;
  fields.description.value='';
  fields.hours.value='';
  fields.workDate.value=today();
  fields.billable.checked=true;
  element('cancel').hidden=true;
  element('save').textContent='Save on this device';
}
function setKind() {
  const task=state?.tasks.find(row=>row.task_id===fields.task.value);
  fields.kind.options[0].disabled=!task?.can_time;
  fields.kind.options[1].disabled=!task?.can_note;
  if (fields.kind.selectedOptions[0]?.disabled) fields.kind.value=task?.can_time?'time':task?.can_note?'note':'';
  const isTime=fields.kind.value==='time';
  element('time').hidden=!isTime;
  fields.workDate.required=fields.hours.required=isTime;
  fields.description.maxLength=isTime?2000:1000;
  fields.description.minLength=isTime?1:3;
  element('description-label').firstChild.textContent=isTime?'Description ':'Work note ';
  element('save').disabled=!task||busy;
}
function button(label,callback) {
  const control=document.createElement('button');
  control.type='button';
  control.textContent=label;
  control.addEventListener('click',()=>void run(callback));
  return control;
}
function paintEntries(entries,tasks) {
  const list=element('entries');
  list.replaceChildren();
  for (const item of entries) {
    const row=document.createElement('li'),title=document.createElement('strong'),details=document.createElement('span');
    const status={pending:'Pending sync',synced:'Synced',attention:'Needs attention'}[item.status];
    title.textContent=(tasks.find(task=>task.task_id===item.task_id)?.task_name??'Task unavailable')+' · '+status;
    const body=item.payload?.description??item.payload?.note;
    details.textContent=[body,item.reason].filter(Boolean).join(' · ');
    row.append(title,details);
    if (item.status==='pending'&&!item.attempts&&item.payload) {
      row.append(button('Edit',()=>{
        editing=item.id;
        fields.task.value=item.task_id;
        fields.task.disabled=fields.kind.disabled=true;
        fields.kind.value=item.payload.kind;
        fields.description.value=body;
        fields.workDate.value=item.payload.work_date??today();
        fields.hours.value=item.payload.hours??'';
        fields.billable.checked=item.payload.billable??true;
        element('cancel').hidden=false;
        element('save').textContent='Save changes';
        setKind();
        fields.description.focus();
      }));
    }
    if (item.status==='attention') row.append(button('Retry sync',async()=>paint(await api.retryEntry(item.id))));
    if (item.status!=='pending'||!item.attempts) {
      row.append(button(item.status==='synced'?'Remove from list':'Discard local draft',async()=>{
        if (item.status!=='synced'&&!window.confirm('Remove this draft from this device? This action cannot undo a change already synced to the ERP.')) return;
        if (editing===item.id) clearForm();
        paint(await api.discard(item.id));
      }));
    }
    list.append(row);
  }
}
function clearForm() {
  fields.task.disabled=fields.kind.disabled=false;
  resetDraft();
  setKind();
}
function paint(value) {
  const wasSignedIn=!!state?.signedIn;
  state=value;
  element('locked').hidden=value.signedIn;
  element('workspace').hidden=!value.signedIn;
  if (!value.signedIn) {
    if (wasSignedIn) {
      fields.task.replaceChildren();
      element('entries').replaceChildren();
      clearForm();
      taskSignature=entriesSignature=null;
      login.elements.loginId.focus();
    }
    if (value.reason) report(value.reason);
    return;
  }
  if (!wasSignedIn) {
    clearForm();
    report('');
    element('my-work').setAttribute('tabindex','-1');
    element('my-work').focus();
  }
  const nextTasks=JSON.stringify(value.tasks);
  if (taskSignature!==nextTasks) {
    if (editing&&!value.tasks.some(task=>task.task_id===fields.task.value)) clearForm();
    const previous=fields.task.value;
    fields.task.replaceChildren(new Option('Choose a task',''),...value.tasks.map(task=>
      new Option(task.due_on?task.task_name+' · Due '+task.due_on:task.task_name,task.task_id)));
    if (value.tasks.some(task=>task.task_id===previous)) fields.task.value=previous;
    taskSignature=nextTasks;
  }
  const nextEntries=JSON.stringify(value.drafts)+nextTasks;
  if (entriesSignature!==nextEntries) {
    const focusInside=element('entries').contains(document.activeElement);
    paintEntries(value.drafts,value.tasks);
    if (focusInside) element('sync').focus();
    entriesSignature=nextEntries;
  }
  const captured=value.capturedAt?new Date(value.capturedAt).toLocaleString('en-GB',{timeZone:'Africa/Nairobi'})+' EAT':'Unavailable';
  element('snapshot').textContent=value.stale?'Refresh the assignment snapshot before saving another draft.'
    :'Assignments checked '+captured+(value.hasMore?' · Showing the first 100 assigned tasks.':'');
  element('connection').textContent=value.connection+' · '+value.drafts.filter(d=>d.status==='pending').length+' pending';
  setKind();
}

async function run(work) {
  if (busy) return;
  busy=true;
  try { await work(); }
  catch (error) { report(error.message.replace(/^Error invoking remote method '[^']+': Error: /,'')); }
  finally { busy=false; if (state?.signedIn) setKind(); }
}
login.addEventListener('submit',event=>{
  event.preventDefault();
  void run(async()=>{
    report('Signing in…');
    const password=login.elements.password.value;
    login.elements.password.value='';
    const submit=login.querySelector('button');
    submit.disabled=true;
    try { paint(await api.login(login.elements.loginId.value,password)); }
    finally { submit.disabled=false; }
  });
});
draft.addEventListener('submit',event=>{
  event.preventDefault();
  void run(async()=>{
    const data={kind:fields.kind.value,task_id:fields.task.value};
    if (data.kind==='time') Object.assign(data,{hours:fields.hours.value,work_date:fields.workDate.value,
      description:fields.description.value,billable:fields.billable.checked});
    else data.note=fields.description.value;
    paint(await api.save(data,editing));
    clearForm();
    report('Saved on this device.');
  });
});
fields.kind.addEventListener('change',setKind);
fields.task.addEventListener('change',setKind);
element('cancel').addEventListener('click',clearForm);
element('open').addEventListener('click',()=>void run(api.openERP));
element('sync').addEventListener('click',()=>void run(async()=>paint(await api.sync())));
element('signout').addEventListener('click',()=>void run(async()=>paint(await api.signout())));
function activity(event) {
  const now=Date.now();
  if (event.isTrusted&&state?.signedIn&&now-lastActivity>7000) {
    lastActivity=now;
    void api.activity().catch(()=>{});
  }
}
document.addEventListener('keydown',activity);
document.addEventListener('pointerdown',activity);
window.addEventListener('online',()=>void run(async()=>{if(state?.signedIn)paint(await api.sync());}));
setInterval(()=>{if(!busy)void api.view().then(paint).catch(()=>{});},2500);
void api.view().then(paint).catch(error=>report(error.message));
