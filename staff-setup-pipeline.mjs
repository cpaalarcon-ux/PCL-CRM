// Client set-up status (read-only). Four steps for each client: Preparer, MLRO, Manager, Partner, and one queue for each step.
// Nothing here saves. Manager and Partner sign-off are shown as waiting until the sign-off feature exists.
export function createSetupPipelineUI(ctx){
 const {esc,modal,request}=ctx;
 const STEPS=[['preparer','Preparer'],['mlro','MLRO'],['manager','Manager'],['partner','Partner']];
 let st={q:'',queue:'all',read:null};
 const tone=s=>({Done:'ok','In progress':'warn',Waiting:'warn','Not started':'muted'}[s]||'muted');
 const chip=s=>`<span class="chip ${tone(s)}">${esc(s)}</span>`;
 const visible=()=>{const c=st.read.clients;return st.queue==='all'?c:c.filter(x=>x.queue===st.queue&&!(x.queue==='manager'&&x.manager!=='Waiting'));};
 function paint(){
  const r=st.read,rows=visible();
  const tabs=[['all','All',r.total],...STEPS.map(([k,l])=>[k,l+' queue',r.queues[k]||0])].map(([k,l,n])=>`<button type="button" data-pipe-q="${k}" aria-pressed="${st.queue===k}" ${st.queue===k?'class="primary"':''}>${esc(l)} (${esc(n)})</button>`).join(' ');
  const body=rows.length?`<div class="scroll"><table><thead><tr><th>Client</th>${STEPS.map(([,l])=>`<th>${esc(l)}</th>`).join('')}<th>Still needed</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.company_name)}<br><small>${esc(c.kra_pin||'')}</small></td>${STEPS.map(([k])=>`<td>${chip(c[k])}</td>`).join('')}<td>${c.preparer==='Done'?'':esc(c.missing.join(', '))}${c.sections_returned?`<br><small>${esc(c.sections_returned)} returned for correction</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="info">No clients in this queue.</p>';
  const html=`<p class="info full">Each client goes through four steps: the preparer enters the data, the MLRO checks it, then the Manager and the Partner sign off. This screen only shows where each client stands. ${esc(r.note)}</p>
   <div class="filters"><label>Search<input name="pipeQ" value="${esc(st.q)}" maxlength="80" placeholder="Client name or KRA PIN"></label><button type="button" data-pipe-go>Search</button></div>
   <div class="actions">${tabs}</div>${body}`;
  modal('Client set-up status',html,null,null,{refreshWorkspace:false});wire();
 }
 async function load(){st.read=await request({action:'client_setup_pipeline_read',search:st.q||undefined});paint();}
 function wire(){
  const root=document.querySelector('#editorBody');if(!root)return;
  root.querySelectorAll('[data-pipe-q]').forEach(b=>b.onclick=()=>{st.queue=b.dataset.pipeQ;paint();});
  const go=root.querySelector('[data-pipe-go]');if(go)go.onclick=()=>{st.q=root.querySelector('[name="pipeQ"]').value;load().catch(()=>{});};
 }
 return {open:async()=>{st={q:'',queue:'all',read:null};await load();}};
}
