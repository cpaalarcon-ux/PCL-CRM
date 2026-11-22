const pageSize = 100;
const titles = {tasks:'Tasks', pool:'Unassigned pool', projects:'Projects'};
const statusOptions = ['Pending','In Progress','Waiting on client','Paused','Blocked'];

export function openWorkload({host, request, leader, mode, firm, project, refresh, esc}) {
 const state = {mode, offset:0, search:'', due:'', records:[], selected:new Set(), total:0, generation:0, busy:false};
 const filters = host.querySelector('[data-filters]'), tabs = host.querySelector('[data-tabs]');
 const list = host.querySelector('[data-list]'), toolbar = host.querySelector('[data-toolbar]');
 const actionForm = host.querySelector('[data-action-form]'), feedback = host.querySelector('[data-feedback]');
 const dueDay = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date(value));
 const active = () => host.isConnected && !!host.closest('dialog')?.open;
 tabs.innerHTML = (leader ? ['tasks','pool','projects'] : ['pool']).map(key =>
  `<button type="button" data-mode="${key}">${titles[key]}</button>`).join('');
 tabs.onclick = event => {
  const key = event.target.closest('[data-mode]')?.dataset.mode;
  if (!key || state.busy || key===state.mode) return;
  state.mode = key;
  state.offset = 0;
  void reload();
 };
 filters.onsubmit = event => {
  event.preventDefault();
  if (state.busy) return;
  state.search = filters.elements.search.value;
  state.due = filters.elements.due.value;
  state.offset = 0;
  void reload();
 };
 list.onclick = event => {
  const button = event.target.closest('[data-page]');
  if (!button || state.busy) return;
  state.offset += Number(button.dataset.page) * pageSize;
  void reload();
 };
 list.onchange = event => {
  const input = event.target;
  if (input.matches('[data-select-all]')) {
   state.selected = input.checked ? new Set(eligible().map(row => row.id)) : new Set();
  } else if (input.matches('[data-record]')) {
   if (input.checked) state.selected.add(input.value);
   else state.selected.delete(input.value);
  }
  paintSelection();
 };
 toolbar.onclick = event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action || state.busy) return;
  if (action === 'clear') {
   state.selected.clear();
   paintSelection();
  } else void prepareAction(action);
 };
 void reload();

 function eligible() { return state.records.filter(row => !row.blocker); }
 function paintSelection() {
  const count = state.selected.size;
  const master = list.querySelector('[data-select-all]');
  if (master) {
   master.checked = count>0 && count===eligible().length;
   master.indeterminate = count>0 && count<eligible().length;
  }
  list.querySelectorAll('[data-record]').forEach(input => {input.checked = state.selected.has(input.value);});
  toolbar.hidden = !count;
  toolbar.querySelector('[data-count]').textContent = `${count} ${state.mode==='projects' ? 'project' : 'task'}${count===1 ? '' : 's'} selected`;
  toolbar.querySelector('[data-claim]').hidden = state.mode!=='pool';
  toolbar.querySelector('[data-assign]').hidden = !leader;
  toolbar.querySelector('[data-assign]').textContent = state.mode==='projects' ? 'Assign project owner' : state.mode==='pool' ? 'Assign' : 'Reassign';
  toolbar.querySelectorAll('[data-task-action]').forEach(btn => {btn.hidden = !leader || state.mode!=='tasks';});
 }
 async function reload(message='') {
  const generation = ++state.generation;
  state.selected.clear();
  actionForm.replaceChildren();
  paintSelection();
  tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.mode===state.mode)));
  filters.elements.due.disabled = state.mode==='projects';
  list.textContent = 'Loading workload…';
  feedback.textContent = message;
  try {
   const result = await request({action:'task_workload_list',mode:state.mode,firm_id:firm,project_id:project,
    search:state.search,due:state.mode==='projects' ? null : state.due,offset:state.offset});
   if (generation!==state.generation || !active()) return;
   state.records = result.records;
   state.total = result.total;
   if (!state.records.length && state.offset) {
    state.offset = 0;
    return void reload(message);
   }
   paintList();
  } catch (error) {
   if (generation!==state.generation || !active()) return;
   list.textContent = '';
   feedback.textContent = error.message;
  }
 }
 function paintList() {
  if (!state.records.length) {
   list.innerHTML = '<p class="muted">No matching work in this view.</p>';
   return;
  }
  const projects = state.mode==='projects';
  const rows = state.records.map(row => `<tr>
   <td><input type="checkbox" data-record value="${esc(row.id)}" aria-label="Select ${esc(row.task_name||row.project_name)}" ${row.blocker?'disabled':''}></td>
   <td><strong>${esc(projects?row.project_name:row.task_name)}</strong>
    ${projects?'':`<small class="block">${esc(row.project_name)}</small>`}
    ${row.blocker?`<small class="block muted">${esc(row.blocker)}</small>`:''}</td>
   <td>${esc(row.client_name)}</td><td>${esc(row.assignee_name||'Unassigned')}</td><td>${esc(row.status)}</td>
   ${projects?'':`<td>${row.due_at?esc(dueDay(row.due_at)):'—'}</td>`}</tr>`).join('');
  list.innerHTML = `<div class="scroll"><table><thead><tr>
   <th><input type="checkbox" aria-label="Select all eligible rows on this page" data-select-all ${eligible().length?'':'disabled'}></th>
   <th>${projects?'Project':'Task'}</th><th>Client</th><th>${projects?'Owner':'Assigned to'}</th><th>Status</th>${projects?'':'<th>Due</th>'}
   </tr></thead><tbody>${rows}</tbody></table></div>
   <div class="actions section-space"><span>${state.offset+1}–${state.offset+rowsCount()} of ${state.total}</span>
    <button type="button" data-page="-1" ${state.offset?'':'disabled'}>Previous</button>
    <button type="button" data-page="1" ${state.offset+pageSize<state.total?'':'disabled'}>Next</button></div>`;
 }
 function rowsCount() {return state.records.length;}
 function selection() {
  return state.records.filter(row => state.selected.has(row.id)).map(row => ({id:row.id,revision:String(row.revision)}));
 }

 async function prepareAction(action) {
  const items = selection(), generation = ++state.generation;
  if (action==='claim') return dispatch({operation:action,items});
  const op = state.mode==='projects' ? 'project_owner' : action;
  let people = [];
  try {
   if (action==='assign') {
    feedback.textContent = 'Checking who can take the selected work…';
    ({people} = await request({action:'task_workload_candidates', operation:op, items}));
    if (generation!==state.generation || !active()) return;
    feedback.textContent = '';
    if (!people.length) {
     feedback.textContent = 'No active staff member is eligible for every selected record. Check the project teams or select fewer records.';
     return;
    }
   }
  } catch (error) {
   if (generation===state.generation) feedback.textContent = error.message;
   return;
  }
  const fields = action==='assign' ? `<label>Staff member <select name="staff_id" required><option value="">Choose staff</option>
   ${people.map(person => `<option value="${esc(person.staff_id)}">${esc(person.full_name)} (${esc(person.category_code)})${person.on_leave?' · On leave':''}</option>`).join('')}</select></label>
   <label class="full">Reason <textarea name="reason" minlength="10" maxlength="1000" required></textarea></label>
   <label class="full" data-leave hidden><input type="checkbox" name="confirm_leave"> This person is on approved leave. Assign the selected work anyway.</label>`
   : action==='status' ? `<label>New status <select name="status">${statusOptions.map(status => `<option>${esc(status)}</option>`).join('')}</select></label>
    <label>Reason <input name="reason" maxlength="1000"></label>`
   : '<label>New due date <input name="due" type="date" required></label>';
  actionForm.innerHTML = `<form class="form-grid"><h3 class="full">${items.length} selected ${state.mode==='projects'?'project(s)':'task(s)'}</h3>
   ${fields}<div class="actions"><button type="submit" class="primary">Confirm ${action==='assign'?'assignment':'change'}</button>
   <button type="button" data-cancel>Cancel</button></div></form>`;
  const form = actionForm.firstElementChild;
  form.querySelector('[data-cancel]').onclick = () => actionForm.replaceChildren();
  if (form.elements.staff_id) {
   form.elements.staff_id.onchange = () => {
    const onLeave = people.some(person => person.staff_id===form.elements.staff_id.value && person.on_leave);
    const confirm = form.elements.confirm_leave;
    confirm.checked = false;
    confirm.required = onLeave;
    confirm.closest('[data-leave]').hidden = !onLeave;
   };
  }
  form.onsubmit = event => {
   event.preventDefault();
   if (items.map(x => x.id).join()!==selection().map(x => x.id).join()) {
    actionForm.replaceChildren();
    feedback.textContent = 'The selection changed. Review the selected rows before trying again.';
    return;
   }
   const values = new host.ownerDocument.defaultView.FormData(form);
   void dispatch({operation:op,items,...Object.fromEntries(values),confirm_leave:values.has('confirm_leave')});
  };
  form.elements[0]?.focus();
 }

 async function dispatch(command) {
  if (state.busy) return;
  state.busy = true;
  const group = [...host.querySelectorAll('button, input, select, textarea')].filter(control => !control.disabled);
  group.forEach(control => {control.disabled = true;});
  feedback.textContent = 'Updating the selected work…';
  let message;
  try {
   const {count} = await request({action:'task_workload_apply',...command});
   message = `${count} ${state.mode==='projects'?'project(s)':'task(s)'} ${command.operation==='claim'?'claimed':'updated'}.`;
   try {await refresh();} catch {}
  } catch (error) {
   message = error.message;
  } finally {
   state.busy = false;
   group.forEach(control => {control.disabled = false;});
   if (active()) void reload(message);
  }
 }
}

export const workloadShell = `<section id="workloadPanel">
 <div class="actions" data-tabs aria-label="Workload view"></div>
 <form class="filters section-space" data-filters>
  <label>Client, project or task <input type="search" name="search" maxlength="140"></label>
  <label>Due by <input type="date" name="due"></label><button type="submit">Filter</button>
 </form>
 <div class="section-space" data-list></div>
 <div class="workload-actions actions" data-toolbar hidden>
  <strong data-count></strong><button type="button" data-action="assign" data-assign>Reassign</button>
  <button type="button" data-action="status" data-task-action>Change status</button>
  <button type="button" data-action="due" data-task-action>Change due date</button>
  <button type="button" data-action="claim" data-claim>Claim selected tasks</button>
  <button type="button" data-action="clear">Clear selection</button>
 </div>
 <div class="section-space" data-action-form></div><p data-feedback role="status" aria-live="polite"></p>
</section>`;
