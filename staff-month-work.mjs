// Monthly work periods (screen). One card per client month: the cleared / 4 counter, the four weekly tasks with their checklist,
// "New weekly task" (it only appears after the previous week is cleared) and "Add task" (after the four). The server and database hold every rule.
export function createMonthWorkUI(ctx){
 const {esc,modal,request,notice,assistants}=ctx,ITEMS=[['sales','Sales'],['purchases','Purchases'],['bank','Bank'],['mapping','Mapping'],['review','Review'],['reporting','Reporting']];
 let st={read:null};
 const mine=r=>r.me.staff_id,lead=r=>['PARTNER','MANAGER','SUPERVISOR'].includes(r.me.category_code);
 const weekRow=(w,m,r)=>{
  const ticks=ITEMS.map(([k,l])=>`<label class="check"><input type="checkbox" data-mw-item="${k}" ${w.checklist?.[k]?'checked':''} ${w.status==='Open'||w.status==='Returned'?'':'disabled'}> ${esc(l)}</label>`).join(' ');
  const mineTask=w.assigned_to===mine(r);
  const act=(w.status==='Open'||w.status==='Returned')&&mineTask?`<button type="button" class="primary" data-mw-submit="${esc(w.task_id)}">Submit for clearance</button>`:
   (w.status==='Submitted'&&lead(r)&&w.submitted_by!==mine(r)?`<button type="button" class="primary" data-mw-clear="${esc(w.task_id)}">Clear</button> <button type="button" data-mw-return="${esc(w.task_id)}">Return</button>`:'');
  return `<tr data-mw-week="${esc(w.task_id)}"><td>Week ${esc(w.week_no)}<small>${esc(w.window_start)} to ${esc(w.window_end)}</small></td><td>${esc(w.status)}${w.return_note?`<small>${esc(w.return_note)}</small>`:''}</td><td>${ticks}</td><td>${act}</td></tr>`;
 };
 const card=(m,r)=>{
  const canNew=lead(r)&&!m.closed&&m.weeks.length<4&&m.weeks.every(w=>w.status==='Cleared');
  return `<div class="card"><div class="section-head"><h3>${esc(m.client_name)}: ${esc(String(m.month_start).slice(0,7))}</h3><span class="badge ${m.closed||m.flag==='On track'?'':'warn'}">${esc(m.flag)}</span></div>
   <p><strong>${esc(m.cleared)} / ${esc(m.required)}</strong> weekly tasks cleared. ${m.closed?'The return is filed, so this month is locked. More work needs an amendment started by a Manager.':''}</p>
   <div class="scroll"><table><thead><tr><th>Week</th><th>Status</th><th>Checklist</th><th></th></tr></thead><tbody>${m.weeks.map(w=>weekRow(w,m,r)).join('')}</tbody></table></div>
   <div class="actions">${canNew?`<button type="button" data-mw-new="${esc(m.work_period_id)}">New weekly task</button>`:''}${lead(r)&&m.can_add_extra?`<button type="button" data-mw-add="${esc(m.work_period_id)}">Add task (${esc(m.extra_tasks)} so far)</button>`:''}</div>
   <form class="grid" data-mw-form="${esc(m.work_period_id)}" hidden><label>Task name<input name="task_name" maxlength="200" required></label><label>Due date<input name="due_date" type="date" required></label><label>Assistant<select name="assigned_to" required><option value="">Choose an Assistant…</option>${(assistants?assistants():[]).map(a=>`<option value="${esc(a.staff_id)}">${esc(a.full_name)}</option>`).join('')}</select></label><div class="actions"><button class="primary" type="submit">Save task</button></div></form></div>`;
 };
 function paint(){
  const r=st.read,ex=r.exceptions.length?`<div class="notice" role="status"><strong>Supervisor exceptions:</strong> ${r.exceptions.map(e=>`${esc(e.client_name)} ${esc(String(e.month_start).slice(0,7))} (${esc(e.cleared)}/4)`).join('; ')}</div>`:'';
  modal('Monthly work periods',`${ex}${r.months.length?r.months.map(m=>card(m,r)).join(''):'<p class="muted">No monthly work periods have been opened yet.</p>'}`,null,null,{refreshWorkspace:false});wire();
 }
 async function load(){st.read=await request({action:'month_work_read'});paint();}
 const root=()=>document.querySelector('#editorBody');
 const run=async(body,msg)=>{try{await request(body);notice(msg);await load();}catch(e){notice(e.message||'That could not be saved.');}};
 function wire(){
  const el=root();if(!el)return;
  el.querySelectorAll('[data-mw-new]').forEach(b=>b.onclick=()=>run({action:'month_work_new_week',work_period_id:b.dataset.mwNew},'The next weekly task is ready.'));
  el.querySelectorAll('[data-mw-submit]').forEach(b=>b.onclick=()=>{const row=b.closest('[data-mw-week]'),checklist={};row.querySelectorAll('[data-mw-item]').forEach(i=>checklist[i.dataset.mwItem]=i.checked);run({action:'month_work_submit',task_id:b.dataset.mwSubmit,checklist},'Submitted for clearance.');});
  el.querySelectorAll('[data-mw-clear]').forEach(b=>b.onclick=()=>run({action:'month_work_clear',task_id:b.dataset.mwClear,clear:true},'Week cleared.'));
  el.querySelectorAll('[data-mw-return]').forEach(b=>b.onclick=()=>{const note=window.prompt('What must be corrected? (at least 10 characters)');if(note)run({action:'month_work_clear',task_id:b.dataset.mwReturn,clear:false,note},'Returned to the preparer.');});
  el.querySelectorAll('[data-mw-add]').forEach(b=>b.onclick=()=>{const f=el.querySelector(`[data-mw-form="${b.dataset.mwAdd}"]`);if(f)f.hidden=!f.hidden;});
  el.querySelectorAll('[data-mw-form]').forEach(f=>f.onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));run({action:'month_work_add_task',work_period_id:f.dataset.mwForm,task_name:v.task_name,due_date:v.due_date,assigned_to:v.assigned_to},'Task added.');});
 }
 return {open:()=>load()};
}
