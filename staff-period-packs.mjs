// Recurring service period packs (build 2809). A read-only monthly view: what has come in, what is waiting, what is blocked and why.
// Only exceptions are listed for a supervisor. Nothing here approves anything, and an approval in one month never carries into the next.
export function createPeriodPackUI(ctx){
 const {esc,field,form,modal,request}=ctx,d=()=>ctx.data();
 const reviewer=()=>['PARTNER','MANAGER','SUPERVISOR'].includes(d().me?.category_code);
 const tone={Ready:'good',Received:'good','Ready for review':'good',Filed:'good',Blocked:'bad','Not received':'bad','Returned for correction':'warn','Waiting for review':'warn','In progress':'warn','Not ready':'warn','Nothing started':'muted',Overdue:'bad'};
 const badge=s=>`<span class="badge ${tone[s]||''}">${esc(s)}</span>`;
 const lastMonth=()=>{const t=new Date(),m=new Date(Date.UTC(t.getFullYear(),t.getMonth()-1,1));return m.getUTCFullYear()+'-'+String(m.getUTCMonth()+1).padStart(2,'0');};
 let month=lastMonth();
 function packView(x){
  const p=x.pack||x;
  const src=p.sources.length?`<ul>${p.sources.map(s=>`<li><b>${esc(s.label)}</b> ${badge(s.state)} ${esc(s.detail||'')}</li>`).join('')}</ul>`:'<p class="muted">No source has come in for this month, and none came in earlier, so none is expected yet.</p>';
  const ex=p.exceptions.length?`<ul>${p.exceptions.map(e=>`<li>${badge(e.state)} <b>${esc(e.label)}</b>: ${esc(e.detail)}</li>`).join('')}</ul>`:'<p class="badge good">Nothing needs attention.</p>';
  return `<p>${badge(p.stage)} · tasks: ${p.tasks.open} open, ${p.tasks.overdue} overdue · tax cases: ${p.tax.cases} (${p.tax.filed} locked or filed)</p><h4>Sources</h4>${src}<h4>To look at</h4>${ex}`;
 }
 const monthForm=(action,extra,title,onResult)=>modal(title,form(field('month','Month *',month,'month','required')+'',action==='overview'?'Show exceptions':'Show pack'),
  f=>{month=f.get('month');return request({action:action==='overview'?'period_pack_overview':'period_pack_read',month,...extra});},onResult,{refreshWorkspace:false,pendingLabel:'Reading…',pendingMessage:'Reading the month. Nothing is changed.',successMessage:'Done.'});
 async function project(pid,name=''){
  const x=await request({action:'period_pack_read',project_id:pid,month});
  modal('Period pack · '+(name||x.project_name)+' · '+month,`<p class="info full">Read only. A source that has not arrived is shown as Not received, never as zero.</p>${packView(x)}<div class="actions"><button type="button" data-pack="project-month" data-id="${esc(pid)}">Change month</button></div>`);
 }
 async function overview(){
  const x=await request({action:'period_pack_overview',month});
  const rows=x.rows.map(r=>`<tr><td>${esc(r.client_name)}<small>${esc(r.project_name)}</small></td><td>${badge(r.stage)}</td><td>${r.exceptions.map(e=>`${badge(e.state)} ${esc(e.label)}: ${esc(e.detail)}`).join('<br>')}</td></tr>`).join('');
  modal('Period packs · '+month,`<p class="info full">${esc(x.note)}</p><p><b>${x.clean}</b> of ${x.projects} clean · <b>${x.with_exceptions}</b> with something to look at</p>${x.rows.length?`<div class="scroll"><table><thead><tr><th>Client</th><th>Stage</th><th>To look at</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="badge good">Every pack is clean.</p>'}<div class="actions"><button type="button" data-pack="overview-month">Change month</button></div>`);
 }
 async function handle(a,id){
  if(a==='overview')return overview();
  if(a==='project')return project(id);
  if(a==='overview-month')return monthForm('overview',{},'Choose the month',x=>{if(x)return overview();});
  if(a==='project-month')return monthForm('project',{project_id:id},'Choose the month',()=>project(id));
 }
 if(typeof document!=='undefined')document.addEventListener('click',async e=>{const b=e.target.closest?.('[data-pack]');if(!b)return;e.preventDefault();try{await handle(b.dataset.pack,b.dataset.id);}catch(err){ctx.notice(err.message,true);}});
 return {handle,reviewer,button:()=>reviewer()?'<button type="button" data-pack="overview">Period packs</button>':'',isAction:a=>['overview','project','overview-month','project-month'].includes(a)};
}
