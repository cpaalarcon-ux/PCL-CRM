// Client onboarding allocation (access alignment, step 1). A Manager or Partner allocates existing clients to an Assistant or Supervisor
// before any project exists. The person can then open the client's onboarding profile and propose changes; every change still goes through
// an independent check and approval. Ending an allocation ends the access. The server and the database apply the same rules.
export function createOnboardingAllocUI(ctx){
 const {$,esc,modal,request,notice}=ctx;
 const fresh=()=>({staff:'',q:'',file:'',only:true,offset:0,found:null,read:null,picked:new Set(),held:new Set(),moveTo:'',host:null});
 let st=fresh();
 const body=()=>st.host||$('#editorBody');
 const people=r=>r.preparers.map(p=>`<option value="${esc(p.staff_id)}" ${p.staff_id===st.staff?'selected':''}>${esc(p.full_name)} · ${esc(p.category_code==='ASSISTANT'?'Assistant':'Supervisor')} · ${esc(p.allocated)} allocated</option>`).join('');
 const files=r=>r.files.map(f=>`<option value="${esc(f.file)}" ${f.file===st.file?'selected':''}>${esc(f.file)} (${esc(f.clients)} clients)</option>`).join('');
 function paint(message=''){
  const r=st.read;if(!r)return;
  const found=st.found,rows=found?found.clients.map(c=>`<tr><td><input type="checkbox" data-onb-pick="${esc(c.client_id)}" aria-label="Select ${esc(c.company_name)}" ${st.picked.has(c.client_id)?'checked':''} ${c.already_this_person?'disabled':''}></td><td><b>${esc(c.company_name)}</b>${c.kra_pin?`<small>${esc(c.kra_pin)}</small>`:''}</td><td>${c.already_this_person?'<span class="badge good">Already allocated</span>':esc(c.allocated_to||'Not allocated')}</td></tr>`).join(''):'';
  const narrowed=!!(st.q||st.file||st.only);
  const results=found?(found.clients.length?`<div class="scroll"><table><thead><tr><th><input type="checkbox" data-onb-all="pick" aria-label="Select every client on this page" ${st.staff?'':'disabled'}></th><th>Client</th><th>Allocated to</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">Showing ${esc(st.offset+1)} to ${esc(st.offset+found.clients.length)} of ${esc(found.total)}.</p><div class="actions">${narrowed&&found.total>0?`<button type="button" data-onb="assign-match" ${found.total>500?'disabled':''}>Allocate all ${esc(found.total)} matching clients</button>`:''}${found.total>500?'<span class="muted">More than 500 match. Narrow the search to allocate them all at once.</span>':''}${st.offset>0?'<button type="button" data-onb="prev">Previous</button>':''}${st.offset+found.clients.length<found.total?'<button type="button" data-onb="next">Next</button>':''}</div>`:'<p class="muted">No clients match.</p>'):'<p class="muted">Choose a person, then find clients.</p>';
  const held=r.allocations.length?`<div class="scroll"><table><thead><tr><th><input type="checkbox" data-onb-all="held" aria-label="Select every allocation"></th><th>Client</th><th>Allocated</th><th>By</th></tr></thead><tbody>${r.allocations.map(a=>`<tr><td><input type="checkbox" data-onb-held="${esc(a.client_id)}" aria-label="Select ${esc(a.company_name)}" ${st.held.has(a.client_id)?'checked':''}></td><td><b>${esc(a.company_name)}</b></td><td>${esc(String(a.allocated_at||'').slice(0,10))}${a.source&&a.source!=='Selected'?`<small>${esc(a.source)}</small>`:''}</td><td>${esc(a.allocated_by_name||'')}</td></tr>`).join('')}</tbody></table></div>
   <label class="full">Why are the allocations ending or moving? *<input name="onbReason" maxlength="500" placeholder="For example: onboarding finished, or the Assistant is leaving"></label><div class="actions"><button type="button" data-onb="remove" ${st.held.size?'':'disabled'}>Remove selected (${esc(st.held.size)})</button></div><h4>Reassign</h4><p class="muted">Hand allocations to someone else in one step. The new person gets access first, then the old person's access ends.</p><div class="filters"><label>Move to<select name="onbMoveTo"><option value="">Choose a person…</option>${r.preparers.filter(x=>x.staff_id!==st.staff).map(x=>`<option value="${esc(x.staff_id)}" ${x.staff_id===st.moveTo?'selected':''}>${esc(x.full_name)} · ${esc(x.category_code==='ASSISTANT'?'Assistant':'Supervisor')}</option>`).join('')}</select></label><button type="button" data-onb="move" ${st.moveTo&&st.held.size?'':'disabled'}>Move selected (${esc(st.held.size)})</button><button type="button" data-onb="move-all" ${st.moveTo?'':'disabled'}>Move all ${esc(r.allocations.length)}</button></div>`:(st.staff?'<p class="muted">This person has no onboarding allocations.</p>':'');
  const html=`<p class="info full">Allocate existing clients to an Assistant or Supervisor before any project exists. They can open the client's onboarding profile and propose changes. Every change is still checked and approved by other people, and removing an allocation ends the access.</p>
   <label class="full">Person *<select name="onbStaff"><option value="">Choose an Assistant or Supervisor…</option>${people(r)}</select></label>
   <div class="notice" role="status" id="onbNotice">${esc(message)}</div>
   <h4>Allocate clients</h4>
   <div class="filters"><label>Search<input name="onbQ" value="${esc(st.q)}" maxlength="120" placeholder="Client name or KRA PIN"></label><label>Imported from<select name="onbFile"><option value="">Any client</option>${files(r)}</select></label><label><input type="checkbox" name="onbOnly" ${st.only?'checked':''}> Not yet allocated to anyone</label><button type="button" data-onb="find" ${st.staff?'':'disabled'}>Find clients</button></div>
   ${results}
   <label class="full">Note (optional)<input name="onbNote" maxlength="500"></label>
   <div class="actions"><button type="button" class="primary" data-onb="assign" ${st.staff&&st.picked.size?'':'disabled'}>Allocate selected (${esc(st.picked.size)})</button>${st.staff&&st.file?`<button type="button" data-onb="assign-file">Allocate every client imported from this file</button>`:''}</div>
   <h4>Current allocations${st.staff?'':' (choose a person)'}</h4>${held}`;
  if(st.host)st.host.innerHTML=`<div class="alloc-inline">${html}</div>`;else modal('Client onboarding allocation',html,null,null,{refreshWorkspace:false});
  wire();
 }
 const val=n=>body()?.querySelector(`[name="${n}"]`);
 function readFilters(){st.q=val('onbQ')?.value||'';st.file=val('onbFile')?.value||'';st.only=!!val('onbOnly')?.checked;}
 async function load(keepFound=true){
  st.read=await request({action:'client_onboarding_alloc_read',staff_id:st.staff||undefined});
  if(!keepFound)st.found=null;
 }
 async function find(offset=0){
  readFilters();st.offset=offset;
  st.found=await request({action:'client_onboarding_alloc_clients',q:st.q,file:st.file||undefined,unallocated_only:st.only,staff_id:st.staff||undefined,offset});
  paint();
 }
 const outcome=r=>`${r.staff_name}: ${r.allocated} allocated`+(r.already_allocated?`, ${r.already_allocated} already allocated`:'')+(r.not_eligible?`, ${r.not_eligible} not eligible (the person does not work in that client's firm)`:'')+'.';
 async function act(fn){try{await fn();}catch(e){const box=$('#onbNotice');if(box)box.textContent=e.message||'That did not go through.';else notice(e.message||'That did not go through.',true);}}
 function wire(){
  const b=body();if(!b)return;
  b.querySelector('[name="onbStaff"]').onchange=e=>act(async()=>{readFilters();st.staff=e.target.value;st.picked=new Set();st.held=new Set();st.found=null;await load();paint();});
  b.onchange=e=>{
   const pick=e.target.dataset?.onbPick,held=e.target.dataset?.onbHeld;
   if(e.target.dataset?.onbAll==='pick'){for(const c of st.found?.clients||[])if(!c.already_this_person){if(e.target.checked)st.picked.add(c.client_id);else st.picked.delete(c.client_id);}return paint(($('#onbNotice')||{}).textContent||'');}
   if(e.target.dataset?.onbAll==='held'){st.held=e.target.checked?new Set(st.read.allocations.map(a=>a.client_id)):new Set();return paint(($('#onbNotice')||{}).textContent||'');}
   if(e.target.name==='onbMoveTo'){st.moveTo=e.target.value;return paint(($('#onbNotice')||{}).textContent||'');}
   if(pick){if(e.target.checked)st.picked.add(pick);else st.picked.delete(pick);paint(($('#onbNotice')||{}).textContent||'');}
   if(held){if(e.target.checked)st.held.add(held);else st.held.delete(held);paint(($('#onbNotice')||{}).textContent||'');}
  };
  b.onclick=e=>{
   const a=e.target.closest?.('[data-onb]')?.dataset.onb;if(!a)return;
   if(a==='find')return act(()=>find(0));
   if(a==='next')return act(()=>find(st.offset+100));
   if(a==='prev')return act(()=>find(Math.max(0,st.offset-100)));
   if(a==='assign')return act(async()=>{readFilters();const r=await request({action:'client_onboarding_alloc_assign',staff_id:st.staff,client_ids:[...st.picked],note:val('onbNote')?.value||undefined});st.picked=new Set();await load();st.found=await request({action:'client_onboarding_alloc_clients',q:st.q,file:st.file||undefined,unallocated_only:st.only,staff_id:st.staff,offset:st.offset});paint(outcome(r));});
   if(a==='assign-file')return act(async()=>{readFilters();const r=await request({action:'client_onboarding_alloc_assign',staff_id:st.staff,file:st.file,note:val('onbNote')?.value||undefined});st.picked=new Set();await load();st.found=null;paint(outcome(r));});
   if(a==='assign-match')return act(async()=>{readFilters();const r=await request({action:'client_onboarding_alloc_assign',staff_id:st.staff,match:{q:st.q,file:st.file||undefined,unallocated_only:st.only},note:val('onbNote')?.value||undefined});st.picked=new Set();await load();st.found=null;paint(outcome(r));});
   if(a==='move'||a==='move-all')return act(async()=>{const reason=val('onbReason')?.value||'';if(reason.trim().length<5){const box=$('#onbNotice');if(box)box.textContent='Say why the allocations are moving (at least 5 characters).';return;}readFilters();const r=await request({action:'client_onboarding_alloc_move',staff_id:st.staff,to_staff_id:st.moveTo,reason,...(a==='move-all'?{all:true}:{client_ids:[...st.held]})});st.held=new Set();await load();st.found=null;paint(`${r.moved} of ${r.requested} moved to ${r.to_name}`+(r.not_eligible?`, ${r.not_eligible} not eligible (that person does not work in the client's firm)`:'')+'.');});
   if(a==='remove')return act(async()=>{const reason=val('onbReason')?.value||'';if(reason.trim().length<5){const box=$('#onbNotice');if(box)box.textContent='Say why the allocation is ending (at least 5 characters).';return;}readFilters();const r=await request({action:'client_onboarding_alloc_remove',staff_id:st.staff,client_ids:[...st.held],reason});st.held=new Set();await load();st.found=null;paint(`${r.staff_name}: ${r.ended} allocation${r.ended===1?'':'s'} ended. Their access to ${r.ended===1?'that client':'those clients'} has ended.`);});
  };
 }
 async function open(){
  st=fresh();
  await load();paint();
 }
 // The same screen drawn inside a page tab instead of a pop-up. A repaint of the page calls this again, so the person and selection are kept.
 async function mount(host){
  const keep=st.host===host&&st.read?st:null;
  st=keep||fresh();st.host=host;
  if(!keep)await load();
  paint();
 }
 if(typeof document!=='undefined')document.addEventListener('click',e=>{const b=e.target.closest?.('[data-onb-open]');if(!b)return;e.preventDefault();b.disabled=true;open().catch(err=>notice(err.message,true)).finally(()=>{b.disabled=false;});});
 return {open,mount,button:()=>'<button type="button" data-onb-open title="Who: staff with the onboarding allocation right. Choose who looks after new clients.">Assign staff to new clients</button>'};
}
