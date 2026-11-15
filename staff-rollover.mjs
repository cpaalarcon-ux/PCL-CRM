// Build 2835: Continue Setup and the year rollover. Continue Setup finds a client that is already started (by name or KRA PIN) and shows what is done and what is next, so
// nothing is added twice. Project access follows the assignment; accounting activation follows five checks. The server decides every check and every rule
// (client-year-rollover-actions.ts, year-rollover-rules.mjs); this file only draws them.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ACCESS_NOTE='Staff reach a client\'s projects as soon as they are assigned. Accounting entries are relied on only when the five checks below pass. One does not wait for the other.';
export const ROLLOVER_NOTE='A rollover prepares the next year as drafts. The source year is not changed. The chart and the mappings are approved again by a different person, and the opening balances are posted separately after review.';
export function checksTable(r,esc=e0){
 return `<div class="scroll"><table><tbody>${r.checks.map(c=>`<tr><td><span class="badge ${c.ok?'good':'warn'}">${c.ok?'Done':'To do'}</span></td><td><b>${esc(c.label)}</b><small> ${esc(c.detail)}</small></td></tr>`).join('')}</tbody></table></div>`;
}
export function candidateCard(c,esc=e0,{canRoll=false}={}){
 return `<div class="card"><h3>${esc(c.company_name)}<small> ${esc(c.kra_pin||'PIN not recorded')} · ${esc(c.record_status)}</small></h3>`
  +`<p><b>${c.done} of ${c.total}</b> accounting checks done. ${c.next_step?`Next: <b>${esc(c.next_step.step)}</b>. ${esc(c.next_step.detail)}`:'Ready for accounting entries.'}</p>`
  +`<p class="muted">${c.project_access.projects} project${c.project_access.projects===1?'':'s'} assigned to ${c.project_access.people} ${c.project_access.people===1?'person':'people'} · ${c.engagement_setups} engagement set-up${c.engagement_setups===1?'':'s'} · ${c.periods} accounting year${c.periods===1?'':'s'}</p>`
  +`<div class="actions"><button type="button" data-roll="detail" data-id="${esc(c.client_id)}">Show the checks</button>${canRoll?`<button type="button" data-roll="rollover" data-id="${esc(c.client_id)}">Year rollover</button>`:''}</div></div>`;
}
export function rolloverView(r,esc=e0){
 const pv=r.preview,live=r.rollovers.filter(x=>x.status!=='Withdrawn');
 const hist=r.rollovers.length?`<div class="scroll"><table><thead><tr><th>New year</th><th>Status</th><th>Started</th><th>Reviewed</th><th></th></tr></thead><tbody>${r.rollovers.map(x=>`<tr><td>${esc(x.new_starts_on)} to ${esc(x.new_ends_on)}</td><td><span class="badge ${x.status==='Reviewed'?'good':x.status==='Withdrawn'?'muted':'warn'}">${esc(x.status)}</span><small> chart ${esc(x.new_chart_status)}, ${x.new_mapping_ids.length} mapping${x.new_mapping_ids.length===1?'':'s'}</small></td><td>${esc(x.created_by_name)}<small> ${esc(x.created_at.slice(0,10))}</small></td><td>${x.reviewed_by_name?`${esc(x.reviewed_by_name)}<small> ${esc(x.reviewed_at.slice(0,10))}: ${esc(x.review_note)}</small>`:''}${x.withdraw_reason?`<small class="warn">${esc(x.withdraw_reason)}</small>`:''}</td><td>${x.status==='Draft'&&r.can_start?`<button type="button" data-roll="review" data-id="${esc(x.rollover_id)}" data-rev="${esc(x.revision)}" data-own="${x.created_by===r.me?'1':''}">Review</button><button type="button" data-roll="withdraw" data-id="${esc(x.rollover_id)}" data-rev="${esc(x.revision)}">Withdraw</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No rollover has been started for this client.</p>';
 const changes=pv?`<h3>${esc(pv.next.starts_on)} to ${esc(pv.next.ends_on)}</h3><ul>${pv.changes.map(c=>`<li>${esc(c.text)}</li>`).join('')}</ul>${pv.warnings.map(w=>`<p class="info full">${esc(w)}</p>`).join('')}${pv.blockers.map(b=>`<p class="missing">${esc(b)}</p>`).join('')}<div class="actions"><button type="button" data-roll="create" data-id="${esc(pv.source_period_id)}" ${pv.blockers.length||!r.can_start?'disabled':''}>Prepare the new year as drafts</button></div>`:(live.length?'':'<p class="muted">A rollover needs an accounting year and an approved chart of accounts in force at its end.</p>');
 return `<p class="info full">${esc(ROLLOVER_NOTE)}</p><h3>Accounting checks</h3>${checksTable(r.readiness,esc)}${changes}<h3>Rollovers</h3>${hist}`;
}
export function createRolloverUI(ctx){
 const {$,esc,field,form,modal,request,notice}=ctx,d=()=>ctx.data(),cat=()=>d().me?.category_code;
 const canUse=()=>!['INTERN','ADMIN'].includes(cat()),leader=()=>['PARTNER','MANAGER'].includes(cat());
 const show=(title,html,save,done)=>modal(title,html,save,done,{refreshWorkspace:false});
 async function find(q=''){
  show('Continue setup',`<p class="info full">Look the client up first. If it already exists, continue it rather than adding it again.</p><div id="rollFind" class="filters"><label class="full">Client name or KRA PIN<input name="q" type="search" value="${esc(q)}" maxlength="80" autocomplete="off"></label><button type="button">Find</button></div><div id="rollOut">${q?'':'<p class="muted">Type at least 2 characters.</p>'}</div>`,null,null);
  const f=$('#rollFind'),input=f&&f.querySelector('[name=q]'),run=async()=>{const out=$('#rollOut');try{const r=await request({action:'client_setup_continue_read',q:input.value});out.innerHTML=r.candidates.length?`<p class="info full">${esc(ACCESS_NOTE)}</p>`+r.candidates.map(c=>candidateCard(c,esc,{canRoll:leader()})).join(''):'<p class="muted">No client found with that name or PIN. You can add it as a new client.</p>';}catch(err){out.innerHTML=`<p class="missing">${esc(err.message)}</p>`;}};
  if(f){f.querySelector('button').onclick=run;input.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();run();}};input.focus();}
  const b=$('#editorBody');if(b)b.onclick=ev=>handleClick(ev);
  if(q)await run();
 }
 async function rollover(cid){
  const r=await request({action:'client_year_rollover_read',client_id:cid});
  show('Year rollover · '+r.client.company_name,rolloverView(r,esc),null,null);
  const b=$('#editorBody');if(b)b.onclick=async ev=>{const x=ev.target.closest('[data-roll]');if(!x)return;try{
   const a=x.dataset.roll;
   if(a==='create'){await request({action:'client_year_rollover_create',client_id:cid,source_period_id:x.dataset.id});notice('Drafts prepared. Ask a different Manager or Partner to approve the chart and the mappings.');await rollover(cid);}
   else if(a==='review')show('Review the rollover',form(`<p class="info full">${x.dataset.own?'You started this. You can review it only if you are the firm\'s only Partner, and that is recorded.':'Check the carried accounts and mappings against the source year.'}</p><label class="full">What you checked *<textarea name="review_note" required minlength="10" maxlength="1000"></textarea></label>`,'Mark reviewed'),f=>request({action:'client_year_rollover_review',client_id:cid,rollover_id:x.dataset.id,revision:x.dataset.rev,review_note:f.get('review_note')}),()=>rollover(cid));
   else if(a==='withdraw')show('Withdraw the rollover',form(`<p class="info full">The draft chart and mappings stay for review. They are returned or approved as usual.</p><label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'Withdraw'),f=>request({action:'client_year_rollover_withdraw',client_id:cid,rollover_id:x.dataset.id,revision:x.dataset.rev,reason:f.get('reason')}),()=>rollover(cid));
  }catch(err){notice(err.message,true);}};
 }
 async function detail(cid){
  const r=await request({action:'client_setup_continue_read',client_id:cid}),c=r.selected;
  show('Setup checks · '+c.company_name,`<p class="info full">${esc(ACCESS_NOTE)}</p>${checksTable(c,esc)}<p>${c.ready?'Ready for accounting entries.':`Next: <b>${esc(c.next_step.step)}</b>.`}</p>`,null,null);
 }
 async function handleClick(ev){const x=ev.target.closest('[data-roll]');if(!x)return;try{if(x.dataset.roll==='detail')await detail(x.dataset.id);else if(x.dataset.roll==='rollover')await rollover(x.dataset.id);}catch(err){notice(err.message,true);}}
 async function handle(action){if(action==='roll-continue'){await find();return true;}return false;}
 return {handle,find,rollover,detail,canUse};
}
