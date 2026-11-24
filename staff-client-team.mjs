// Client team. A Manager or Partner names more than one person for a client: the preparer(s), the reviewer(s), the MLROs, and an owner for
// each standard workstream (sales, purchases, bank statements, payroll, VAT and turnover tax filing, income tax). A project of the client can
// name its own owners, which replace the client's for that project. The server and the database apply the rules; this screen only asks.
export function createClientTeamUI(ctx){
 const {$,esc,modal,request,notice,shortDate}=ctx;
 const fresh=(clientId='',projectId='')=>({clientId,projectId,read:null});
 let st=fresh();
 const CAT={PARTNER:'Partner',MANAGER:'Manager',SUPERVISOR:'Supervisor',ASSISTANT:'Assistant'};
 const body=()=>$('#editorBody');
 const scoped=m=>(m.project_id||'')===st.projectId;
 // Separation of duties: whoever prepares the work is not offered as its reviewer or MLRO, and the other way round.
 const MAKER=['PREPARER','WORKSTREAM_OWNER'],CHECKER=['REVIEWER','MLRO'];
 const conflicts=(r,role,staffId)=>r.members.some(m=>m.staff_id===staffId&&((MAKER.includes(role)&&CHECKER.includes(m.role))||(CHECKER.includes(role)&&MAKER.includes(m.role))));
 const personOptions=(r,role,taken)=>r.candidates.filter(c=>!taken.has(c.staff_id)&&!conflicts(r,role,c.staff_id)&&(role!=='REVIEWER'||c.category_code!=='ASSISTANT')&&(role!=='MLRO'||c.is_mlro))
  .map(c=>`<option value="${esc(c.staff_id)}">${esc(c.full_name)} · ${esc(CAT[c.category_code]||c.category_code)}</option>`).join('');
 const memberRow=(m,edit)=>`<li><b>${esc(m.staff_name)}</b> <span class="muted">${esc(CAT[m.category_code]||m.category_code)} · since ${esc(shortDate(m.assigned_at))}${m.note?' · '+esc(m.note):''}</span>${edit?` <button type="button" data-team="end" data-id="${esc(m.team_member_id)}" aria-label="End ${esc(m.staff_name)}">End</button>`:''}</li>`;
 const addRow=(r,role,workstream,taken,label)=>{
  const opts=personOptions(r,role,taken);
  const none=role==='MLRO'?'No one else holds the MLRO right. A Partner gives it under Staff & access → Additional rights.':'No one else to add.';
  return opts?`<div class="team-add"><select data-team-person="${esc(role)}${workstream?':'+esc(workstream):''}" aria-label="${esc(label)}"><option value="">${esc(label)}…</option>${opts}</select> <button type="button" data-team="add" data-role="${esc(role)}" ${workstream?`data-workstream="${esc(workstream)}"`:''}>Add</button></div>`:`<p class="muted">${esc(none)}</p>`;
 };
 function rolePart(r,role,title,hint){
  const mine=r.members.filter(m=>m.role===role&&scoped(m)),edit=r.can_edit;
  return `<section class="team-role"><h4>${esc(title)}</h4><p class="muted">${esc(hint)}</p>${mine.length?`<ul>${mine.map(m=>memberRow(m,edit)).join('')}</ul>`:'<p class="muted">No one named.</p>'}${edit?addRow(r,role,'',new Set(mine.map(m=>m.staff_id)),'Choose '+title.toLowerCase().replace(/s$/,'')):''}</section>`;
 }
 function workstreamPart(r){
  const edit=r.can_edit,rows=r.workstreams.map(w=>{
   const own=r.members.filter(m=>m.role==='WORKSTREAM_OWNER'&&m.workstream===w.code&&scoped(m));
   const inherited=st.projectId&&!own.length?r.members.filter(m=>m.role==='WORKSTREAM_OWNER'&&m.workstream===w.code&&!m.project_id):[];
   const owners=own.length?`<ul>${own.map(m=>memberRow(m,edit)).join('')}</ul>${own.length>1?'<p class="muted">The first person named receives the tasks. The others can be added to a task by a Manager.</p>':''}`
    :inherited.length?`<p class="muted">Client default: ${inherited.map(m=>esc(m.staff_name)).join(', ')}</p>`:'<p class="muted">No owner. Tasks go to the project preparer.</p>';
   return `<tr><td><b>${esc(w.label)}</b><br><span class="muted">${esc(w.covers)}</span></td><td>${owners}${edit?addRow(r,'WORKSTREAM_OWNER',w.code,new Set(own.map(m=>m.staff_id)),'Choose owner for '+w.label):''}</td></tr>`;
  }).join('');
  return `<section class="team-role"><h4>Workstream owners</h4><p class="muted">One person can handle sales and purchases, another bank statements, another payroll. Scheduled tasks for that work are given to the owner.</p><div class="scroll"><table><thead><tr><th>Workstream</th><th>Owner</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
 }
 function paint(message=''){
  const r=st.read;if(!r)return;
  const project=r.projects.find(p=>p.project_id===st.projectId);
  const scopeSel=`<label class="full">Applies to<select name="teamScope"><option value="">The whole client (defaults for every project)</option>${r.projects.map(p=>`<option value="${esc(p.project_id)}" ${p.project_id===st.projectId?'selected':''}>Only the project: ${esc(p.project_name)}</option>`).join('')}</select></label>`;
  const intro=st.projectId?`<p class="info full">Owners named here apply to <b>${esc(project?.project_name||'this project')}</b> only and replace the client's owners for it. MLROs are named for the whole client.</p>`:`<p class="info full">${esc(r.note)} The person who prepares the work cannot also review it or act as its MLRO.</p>`;
  const mlro=st.projectId?`<section class="team-role"><h4>MLROs</h4><ul>${r.members.filter(m=>m.role==='MLRO').map(m=>memberRow(m,false)).join('')||'<li class="muted">None named. Any MLRO or Partner can decide.</li>'}</ul><p class="muted">Named for the whole client. Choose “The whole client” above to change them.</p></section>`
   :rolePart(r,'MLRO','MLROs','AML flags and profile reviews for this client go to these MLROs first. Any other MLRO or Partner can still decide.');
  const reason=r.can_edit?`<label class="full">Reason when ending someone (at least 5 characters)<input name="teamReason" maxlength="500" placeholder="For example: moved to another client"></label>`:'<p class="info full">Only a Manager or Partner can change the team.</p>';
  const html=`<div class="team-ui"><h3>${esc(r.client.company_name)}</h3>${scopeSel}${intro}<div class="notice" role="status" id="teamNotice">${esc(message)}</div>${rolePart(r,'PREPARER','Preparers','Do the day-to-day work. A preparer who is an Assistant or Supervisor gets access to this client.')}${rolePart(r,'REVIEWER','Reviewers','A Partner, Manager or Supervisor who checks the work before it goes on.')}${mlro}${workstreamPart(r)}${reason}</div>`;
  modal(st.projectId?'Project team':'Client team',html,null,null,{refreshWorkspace:false});
  wire();
 }
 async function load(){st.read=await request({action:'client_team_read',client_id:st.clientId});}
 async function act(fn){try{await fn();}catch(e){const box=$('#teamNotice');if(box)box.textContent=e.message||'That did not go through.';else notice(e.message||'That did not go through.',true);}}
 function wire(){
  const b=body();if(!b)return;
  const scopeSel=b.querySelector('[name="teamScope"]');
  if(scopeSel)scopeSel.onchange=e=>act(async()=>{st.projectId=e.target.value;paint();});
  b.onclick=e=>{
   const el=e.target.closest?.('[data-team]');if(!el)return;
   const a=el.dataset.team;
   if(a==='add')return act(async()=>{
    const key=el.dataset.role+(el.dataset.workstream?':'+el.dataset.workstream:''),sel=b.querySelector(`[data-team-person="${key}"]`);
    if(!sel?.value){const box=$('#teamNotice');if(box)box.textContent='Choose a person first.';return;}
    const r=await request({action:'client_team_add',client_id:st.clientId,project_id:st.projectId||undefined,staff_id:sel.value,role:el.dataset.role,workstream:el.dataset.workstream||undefined});
    await load();paint(`${r.staff_name} added.`);
   });
   if(a==='end')return act(async()=>{
    const reason=b.querySelector('[name="teamReason"]')?.value||'';
    if(reason.trim().length<5){const box=$('#teamNotice');if(box)box.textContent='Say why this person is leaving the team (at least 5 characters).';return;}
    await request({action:'client_team_end',client_id:st.clientId,team_member_id:el.dataset.id,reason});
    await load();paint('Removed from the team.');
   });
  };
 }
 // projectId is optional: pass it to open straight onto one project's own team.
 async function open(clientId,projectId=''){st=fresh(clientId,projectId);await load();paint();}
 return {open,button:(id,label='Client team')=>`<button type="button" data-v3="team" data-id="${esc(id)}">${esc(label)}</button>`};
}
