// Team & HR: workload of the people the signed-in Supervisor, Manager or Partner oversees. A red badge shows above 15 active tasks.
// It is an alert only; nothing is blocked. The count and the 15-task rule come from the database (erp_private.team_workload).
export function createTeamUI(ctx){
 const {esc,request,notice,badge}=ctx;
 let state=null,loading=false;
 async function load(){if(loading)return;loading=true;try{state=await request({action:'task_team_workload'});}catch(e){state={error:e.message};}finally{loading=false;if(ctx.view()==='team')ctx.render();}}
 function render(){
  if(!state){void load();return `<section class="card"><h2>Team & HR</h2><p class="muted">Loading workload…</p></section>`;}
  if(state.error)return `<section class="card"><h2>Team & HR</h2><p class="info">${esc(state.error)}</p></section>`;
  const limit=state.threshold||15,over=state.people.filter(x=>x.is_overloaded);
  const rows=state.people.map(x=>`<tr><td><b>${esc(x.full_name)}</b><small>${esc(String(x.category_code||'').toLowerCase())}</small></td><td>${x.active_tasks}${x.is_overloaded?` <span class="badge bad" role="status">Overloaded (over ${limit})</span>`:''}</td><td>${x.overdue_tasks?`<span class="missing">${x.overdue_tasks} overdue</span>`:'0'}</td><td>${x.on_leave?badge('On leave today'):''}</td></tr>`).join('');
  return `<section class="card"><div class="section-head"><div><h2>Team & HR</h2><p class="muted">Workload Balancer. Active tasks are everything not yet completed or cancelled. A red badge shows when someone holds more than ${limit}. It is an alert for you to rebalance; nothing is blocked.</p></div><button type="button" data-team="refresh">Refresh</button></div>${over.length?`<p class="info"><b>${over.length} ${over.length===1?'person is':'people are'} over ${limit} active tasks.</b> Use the handover wizard on the project to reallocate work.</p>`:''}<div class="scroll"><table><thead><tr><th>Person</th><th>Active tasks</th><th>Overdue</th><th>Leave</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Nobody in your team is loaded yet.</td></tr>'}</tbody></table></div></section>`;
 }
 document.addEventListener('click',e=>{const b=e.target.closest('[data-team]');if(!b)return;state=null;ctx.render();});
 return {render,reset:()=>{state=null;}};
}
