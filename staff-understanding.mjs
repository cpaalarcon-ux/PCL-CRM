// Understanding the Client and the Permanent File (build 2867). Staff write the client's story in fixed sections; a different Manager or Partner approves it;
// the Permanent File PDF then repeats the KYC facts, the approved story and the AML status in one document filed under the client's Permanent File folder.
// The server and the database enforce every rule again; this file only shows what they allow.
export function createUnderstandingUI(ctx){
 const {esc,form,modal,request,notice,shortDate,select}=ctx;
 const long=v=>v?shortDate(v):'';
 const state={cid:null,host:null,data:null};
 const download=r=>{const bytes=Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0)),u=URL.createObjectURL(new Blob([bytes],{type:r.mime_type})),a=document.createElement('a');a.href=u;a.download=r.file_name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),4000);};
 const btn=(a,l,id,extra='')=>`<button type="button" data-und="${a}" data-id="${esc(id)}" ${extra}>${esc(l)}</button>`;
 const fileNote={none:'No Permanent File has been filed yet.',current:'The filed Permanent File matches the facts, story and AML status as they stand.',out_of_date:'The filed Permanent File is out of date: a fact, the approved story or the AML status has changed since it was filed. File a new one.'};
 function sectionsView(sections,list){return list.map(s=>`<h4>${esc(s.label)}</h4><p style="white-space:pre-wrap">${sections[s.key]?esc(sections[s.key]):`<span class="muted">${s.required?'Not written yet.':'Nothing recorded.'}</span>`}</p>`).join('');}
 function paintHtml(x){
  const o=x.open,a=x.approved,id=x.client.client_id;
  const firm=x.firms.length>1?select('und_firm','Firm for the Permanent File',x.firms.map(f=>[f.firm_id,f.legal_name]),'','Choose the firm…'):'';
  const approvedBlock=a?`<h3>Approved version ${esc(a.version)}</h3><p class="muted">Prepared by ${esc(a.prepared_by_name)}; approved by ${esc(a.approved_by_name)} on ${esc(long(a.approved_at))}${a.sole_partner_approval?' (sole active Partner; no second approver was available)':''}.</p>${sectionsView(a.sections,x.sections)}`:'<p class="info">No approved understanding yet. Write the sections, submit them, and a different Manager or Partner approves them.</p>';
  let openBlock='';
  if(o){
   openBlock=`<h3>Version ${esc(o.version)} · ${esc(o.status==='Draft'?'Draft':'Waiting for review')}</h3>`+(o.return_note&&o.status==='Draft'?`<p class="notice">Returned by ${esc(o.returned_by_name||'the reviewer')}: ${esc(o.return_note)}</p>`:'')+sectionsView(o.sections,x.sections)+`<div class="actions">${o.status==='Draft'&&x.can_prepare?btn('edit','Edit the draft',id)+btn('submit','Submit for review',id,`data-rev="${esc(o.revision)}"`):''}${o.status==='Submitted'?btn('review','Review this version',id):''}</div>`;
  }else if(x.can_prepare){openBlock=`<div class="actions">${btn('edit',a?'Start a new version':'Write the understanding',id)}</div>`;}
  const hist=x.history.length?`<details><summary>Earlier versions (${x.history.length})</summary><ul>${x.history.map(h=>`<li>Version ${esc(h.version)}, approved by ${esc(h.approved_by_name||'')} on ${esc(long(h.approved_at))}; superseded ${esc(long(h.superseded_at))} (${esc(h.superseded_reason||'')})</li>`).join('')}</ul></details>`:'';
  const issues=x.issues.length?`<div class="scroll"><table><thead><tr><th>Filed</th><th>Reference</th><th>Story version</th><th>Facts</th><th>AML stage</th><th>By</th></tr></thead><tbody>${x.issues.map(i=>`<tr><td>${esc(long(i.issued_at))}</td><td>${esc(i.doc_ref||'')}<small>${esc(i.file_name||'')}</small></td><td>${esc(i.understanding_version)}</td><td>${esc(i.fact_count)}</td><td>${esc(i.aml_stage||'Not started')}</td><td>${esc(i.issued_by_name||'')}</td></tr>`).join('')}</tbody></table></div>`:'';
  const aml=x.aml?`${esc(x.aml.stage)}${x.aml.decision?' · '+esc(x.aml.decision):''}${x.aml.risk_rating?' · risk '+esc(x.aml.risk_rating):''}`:'AML profile not started';
  return `<p class="info">The story below is written by the team and approved by a different Manager or Partner. The Permanent File PDF repeats it with the client's KYC facts and the AML status. It adds nothing that was not recorded.</p>${approvedBlock}${openBlock}${hist}
   <h3>Permanent File PDF</h3><p><b>${x.facts.count}</b> live client facts (${x.facts.verified} verified). AML: ${aml}.</p><p class="${x.file==='out_of_date'?'notice':'muted'}">${esc(fileNote[x.file])}</p>
   ${x.can_preview?`<div class="form-grid">${firm}</div><div class="actions">${btn('preview','Preview the PDF',id)}${x.can_file?btn('file','File it in the Permanent File',id):''}</div>${!a?'<p class="muted">A preview made before the story is approved is marked DRAFT and cannot be filed.</p>':''}`:'<p class="muted">A Manager or Partner prepares and files the Permanent File.</p>'}${issues}`;
 }
 async function paint(host,cid){
  state.cid=cid;state.host=host;host.innerHTML='<p class="muted">Loading…</p>';
  try{state.data=await request({action:'client_understanding_read',client_id:cid});host.innerHTML=paintHtml(state.data);}
  catch(e){host.innerHTML=`<p class="info">${esc(e.message||'The understanding could not be loaded.')}</p>`;}
 }
 const repaint=()=>state.host&&state.cid?paint(state.host,state.cid):null;
 const firmId=()=>{const el=document.querySelector('[name="und_firm"]');return el?el.value||undefined:undefined;};
 function edit(x){
  const o=x.open,base=o?o.sections:(x.approved?x.approved.sections:{});
  const fields=x.sections.map(s=>`<label class="full">${esc(s.label)}${s.required?' *':''}<small>${esc(s.hint)}</small><textarea name="${esc(s.key)}" rows="5" maxlength="4000">${esc(base[s.key]||'')}</textarea></label>`).join('');
  modal(o?`Edit draft · version ${o.version}`:`New version ${(x.approved?x.approved.version:0)+1}`,form(`<p class="info full">Write each section in plain words. Saving keeps a draft; nothing is approved until you submit it and a different Manager or Partner approves it.${x.approved&&!o?' This starts from the approved text; the approved version stays in force until the new one is approved.':''}</p>${fields}`,'Save draft'),
   f=>request({action:'client_understanding_save',client_id:x.client.client_id,revision:o?o.revision:undefined,sections:Object.fromEntries(x.sections.map(s=>[s.key,f.get(s.key)||'']))}),()=>repaint(),{refreshWorkspace:false,successMessage:'Draft saved.'});
 }
 function review(x){
  const o=x.open;
  modal(`Review version ${o.version}`,`<p class="info full">Prepared by ${esc(o.prepared_by_name)}, submitted by ${esc(o.submitted_by_name||'')} on ${esc(long(o.submitted_at))}. Read it against the client's file. Approving records it under your name${x.approved?' and supersedes version '+esc(x.approved.version):''}.</p>${sectionsView(o.sections,x.sections)}
   <div class="actions full"><button type="button" data-und="approve" data-id="${esc(x.client.client_id)}">Approve this version</button><button type="button" data-und="return" data-id="${esc(x.client.client_id)}">Return to the preparer</button></div>`);
 }
 function ret(x){
  modal('Return to the preparer',form('<label class="full">What needs to change? *<textarea name="note" required minlength="3" maxlength="500"></textarea></label>','Return it'),
   f=>request({action:'client_understanding_return',client_id:x.client.client_id,revision:x.open.revision,note:f.get('note')}),()=>repaint(),{refreshWorkspace:false,successMessage:'Returned to the preparer.'});
 }
 async function handle(a,id,ds={}){
  if(!state.data||state.cid!==id)await paint(state.host||document.querySelector('#clientTabHost'),id);
  const x=state.data;
  if(a==='edit')return edit(x);
  if(a==='review')return review(x);
  if(a==='return'){document.getElementById('editor')?.close?.();return ret(x);}
  if(a==='submit'){await request({action:'client_understanding_submit',client_id:id,revision:x.open.revision});notice('Submitted for review.');return repaint();}
  if(a==='approve'){const r=await request({action:'client_understanding_approve',client_id:id,revision:x.open.revision});notice(r.sole_partner_approval?'Approved. You are the sole active Partner, so no second approver was available; this is recorded.':'Approved.');document.getElementById('editor')?.close?.();return repaint();}
  if(a==='preview'){const r=await request({action:'client_pf_preview',client_id:id,firm_id:firmId()});download(r);return notice(r.draft?'Draft preview downloaded. It is marked DRAFT.':'Preview downloaded.');}
  if(a==='file'){const r=await request({action:'client_pf_file',client_id:id,firm_id:firmId()});notice('Filed in the Permanent File as '+r.file_name+'.');return repaint();}
 }
 if(typeof document!=='undefined')document.addEventListener('click',async e=>{const b=e.target.closest?.('[data-und]');if(!b)return;e.preventDefault();b.disabled=true;try{await handle(b.dataset.und,b.dataset.id);}catch(err){notice(err.message,true);}finally{b.disabled=false;}});
 return {paint,handle,paintHtml};
}
