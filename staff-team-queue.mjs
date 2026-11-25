// Team queue for Supervisors, Managers and Partners. Assistants do the work; reviewers see what waits for their review and every active task.
// Read-only: open a task to review, edit or return it.
export function createTeamQueueUI(ctx){
 const {esc,modal,request,shortDate,openTask}=ctx;
 let st={mode:'reviews',assistant:'',client:'',due:'',offset:0,read:null};
 const query=()=>request({action:'team_queue_read',mode:st.mode,assistant_id:st.assistant||undefined,client:st.client,due_before:st.due||undefined,offset:st.offset});
 function paint(){
  const r=st.read,rows=r.records.map(t=>`<tr><td>${esc(t.task_name)}<br><small>${esc(t.project_name)}</small></td><td>${esc(t.client_name)}</td><td>${esc(t.assignee_name||'')}</td><td>${esc(t.status)}</td><td>${t.due_at?esc(shortDate(t.due_at)):''}${t.overdue?' <span class="badge warn">Overdue</span>':''}</td><td><button type="button" data-tq-open="${esc(t.task_id)}">Open / verify</button></td></tr>`).join('');
  const tabs=[['reviews','My reviews'],['all','All active tasks']].map(([k,l])=>`<button type="button" data-tq-mode="${k}" aria-pressed="${st.mode===k}" ${st.mode===k?'class="primary"':''}>${l}</button>`).join(' ');
  const people=r.assistants.map(x=>`<option value="${esc(x.staff_id)}" ${x.staff_id===st.assistant?'selected':''}>${esc(x.full_name)}</option>`).join('');
  const html=`<p class="info full">Assistants do the work. You review it here and can open, edit, return or reassign any task you can see. ${esc(r.total)} task${r.total===1?'':'s'} shown.</p>
   <div class="actions">${tabs}</div>
   <div class="filters"><label>Assistant<select name="tqAssistant"><option value="">All Assistants</option>${people}</select></label><label>Client<input name="tqClient" value="${esc(st.client)}" maxlength="140"></label><label>Due on or before<input type="date" name="tqDue" value="${esc(st.due)}"></label><button type="button" data-tq-go>Filter</button></div>
   ${rows?`<div class="scroll"><table><thead><tr><th>Task</th><th>Client</th><th>Assistant</th><th>Status</th><th>Due</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">Nothing waiting here.</p>'}
   <div class="actions">${st.offset>0?'<button type="button" data-tq-page="-1">Previous</button>':''}${r.total>st.offset+r.page_size?'<button type="button" data-tq-page="1">Next</button>':''}</div>`;
  modal('Team queue',html,null,null,{refreshWorkspace:false});wire();
 }
 async function load(){st.read=await query();paint();}
 function wire(){
  const root=document.querySelector('#editorBody');if(!root)return;
  root.querySelectorAll('[data-tq-mode]').forEach(b=>b.onclick=()=>{st.mode=b.dataset.tqMode;st.offset=0;load().catch(()=>{});});
  root.querySelectorAll('[data-tq-page]').forEach(b=>b.onclick=()=>{st.offset=Math.max(0,st.offset+Number(b.dataset.tqPage)*100);load().catch(()=>{});});
  root.querySelectorAll('[data-tq-open]').forEach(b=>b.onclick=()=>{const dlg=document.querySelector('#editor');if(dlg?.open)dlg.close();if(openTask)openTask(b.dataset.tqOpen);});
  const go=root.querySelector('[data-tq-go]');if(go)go.onclick=()=>{st.assistant=root.querySelector('[name="tqAssistant"]').value;st.client=root.querySelector('[name="tqClient"]').value;st.due=root.querySelector('[name="tqDue"]').value;st.offset=0;load().catch(()=>{});};
 }
 return {open:async()=>{st={mode:'reviews',assistant:'',client:'',due:'',offset:0,read:null};await load();}};
}
