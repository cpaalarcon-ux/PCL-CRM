// Team & HR: workload of the people the signed-in Supervisor, Manager or Partner oversees. A red badge shows above 15 active tasks.
// It is an alert only; nothing is blocked. The count and the 15-task rule come from the database (erp_private.team_workload).
export function createTeamUI(ctx){
 const {esc,request,notice,badge}=ctx;
 let state=null,loading=false;
 async function load(){if(loading)return;loading=true;try{state=await request({action:'task_team_workload',target_staff_id:ctx.viewTarget?.()||null});}catch(e){state={error:e.message};}finally{loading=false;if(ctx.view()==='team')ctx.render();}}
 function render(){
  if(!state){void load();return `<section class="card"><h2>Team & HR</h2><p class="muted">Loading workload…</p></section>`;}
  if(state.error)return `<section class="card"><h2>Team & HR</h2><p class="info">${esc(state.error)}</p></section>`;
  const limit=state.threshold||15,over=state.people.filter(x=>x.is_overloaded);
  const rows=state.people.map(x=>`<tr><td><b>${esc(x.full_name)}</b><small>${esc(String(x.category_code||'').toLowerCase())}</small></td><td>${x.active_tasks}${x.is_overloaded?` <span class="badge bad" role="status">Overloaded (over ${limit})</span>`:''}</td><td>${x.overdue_tasks?`<span class="missing">${x.overdue_tasks} overdue</span>`:'0'}</td><td>${x.on_leave?badge('On leave today'):''}</td></tr>`).join('');
  return `<section class="card"><div class="section-head"><div><h2>Team & HR${ctx.viewTitle?` · ${esc(ctx.viewTitle())}`:''}</h2><p class="muted">Workload Balancer. Active tasks are everything not yet completed or cancelled. A red badge shows when someone holds more than ${limit}; Partners are not flagged because they oversee many projects. It is an alert for you to rebalance; nothing is blocked.</p></div><button type="button" data-team="refresh">Refresh</button></div>${over.length?`<p class="info"><b>${over.length} ${over.length===1?'person is':'people are'} over ${limit} active tasks.</b> Use the handover wizard on the project to reallocate work.</p>`:''}<div class="scroll"><table><thead><tr><th>Person</th><th>Active tasks</th><th>Overdue</th><th>Leave</th></tr></thead><tbody>${rows||'<tr><td colspan="4">Nobody in your team is loaded yet.</td></tr>'}</tbody></table></div></section>`;
 }
 document.addEventListener('click',e=>{const b=e.target.closest('[data-team]');if(!b)return;state=null;ctx.render();});

 // Manager Pool widget on the Manager and Partner Home. Review stays with the named reviewer; the pool is the safety net.
 async function paintPool(){
  const box=document.querySelector('#homePool');if(!box)return;
  let r;try{r=await request({action:'task_pool_list'});r={tasks:Array.isArray(r?.tasks)?r.tasks:[],recent:Array.isArray(r?.recent)?r.recent:[]};}catch(e){box.querySelector('.compact-empty').textContent='The Manager Pool could not be loaded. Refresh Home to try again.';return;}
  const head=`<div class="section-head"><div><h2>Manager Pool</h2><p class="muted">Work waiting for review whose named reviewer is on leave or missing, or that was sent here. Pull it to review it yourself. The person who prepared it cannot pull it.</p></div><span class="badge ${r.tasks.length?'warn':''}">${r.tasks.length}</span></div>`;
  const rows=r.tasks.map(t=>`<div class="home-exception-row"><div><b>${esc(t.company_name)}</b><small>${esc(t.task_name)} · ${esc(t.project_name)} · ${esc(t.pool_reason||'')} · prepared by ${esc(t.prepared_by_name||'—')}${t.reviewer_name?` · was with ${esc(t.reviewer_name)}`:''}</small></div>${t.is_mine?'<small class="muted">You prepared this</small>':`<button type="button" data-pool="claim" data-id="${esc(t.task_id)}">Pull &amp; Assign to Me</button>`}</div>`).join('');
  const log=r.recent.length?`<details class="section-space"><summary>Recent pool activity</summary>${r.recent.map(l=>`<small class="block">${esc(String(l.created_at).slice(0,16).replace('T',' '))} · ${esc(l.action)} · ${esc(l.task_name)}${l.to_name?` · to ${esc(l.to_name)}`:''}${l.acted_by_name?` · by ${esc(l.acted_by_name)}`:''}${l.from_name?` · from ${esc(l.from_name)}`:''}</small>`).join('')}</details>`:'';
  box.innerHTML=head+(rows||'<p class="muted compact-empty">Nothing is waiting in the pool.</p>')+log;
 }
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-pool]');if(!b)return;
  try{
   if(b.dataset.pool==='claim'){await request({action:'task_pool_claim',task_id:b.dataset.id});notice('Pulled. You are now the named reviewer.');await ctx.load?.();}
   if(b.dataset.pool==='send'){
    ctx.modal('Send to the Manager Pool',ctx.form('<label class="full">Why does this go to the pool? (at least 10 characters)<textarea name="reason" required minlength="10" maxlength="1000"></textarea></label>','Send to pool'),f=>request({action:'task_pool_send',task_id:b.dataset.id,reason:f.get('reason')}),()=>{notice('Sent to the Manager Pool.');ctx.render();});
   }
  }catch(err){notice(err.message,true);}
 });
 return {render,paintPool,reset:()=>{state=null;}};
}
