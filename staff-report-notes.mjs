// Report notes and the report-pack register (build 2890). Staff write Client highlights and Information required (both print on the report and are signed off with it) and Internal notes (never printed),
// and see every report file or pack that was produced, with where it stands: Draft, Generated, Signed or Filed. The server owns every rule; this file draws what it returns and sends what is typed.
export function createReportNotesUI(ctx,{payload,show,defaults}){
 const {esc,form,request,notice}=ctx;
 const KINDS=['Month','Quarter','Year to date','Year end'];
 const BADGE={Draft:'badge red',Generated:'badge warn',Signed:'badge good',Filed:'badge good'};
 const btn=(a,l,id='')=>`<button type="button" data-rn="${a}" data-id="${esc(id)}">${esc(l)}</button>`;
 const shortDay=d=>String(d||'').slice(0,10);
 let cur={report_kind:'Month',as_of:''},regCache=null;
 function choose(){
  const d=(defaults&&defaults())||{};const kind=cur.report_kind||'Month',asOf=cur.as_of||d.as_of||'';
  show('Report notes and packs',form(`<label>Report<select name="report_kind">${KINDS.map(k=>`<option ${k===kind?'selected':''}>${esc(k)}</option>`).join('')}</select></label>
   <label>As of<input type="date" name="as_of" value="${esc(asOf)}" required></label>
   <p class="info full">The notes belong to one report: its kind and its date. Client highlights and Information required print on the report and are part of what the reviewer signs off. Internal notes never print.</p>`,'Open the notes'),
   async f=>{cur={report_kind:String(f.get('report_kind')||'Month'),as_of:String(f.get('as_of')||'')};return await request({...payload('ledger_report_notes_read'),...cur});},data=>editor(data));
 }
 function editor(data){
  const c=data.current||{client_highlights:'',information_required:'',internal_notes:''};
  const warn=data.review&&['Approved','Submitted'].includes(data.review.status)?`<p class="info full"><b>This report is ${data.review.status==='Approved'?'signed off':'waiting for review'}.</b> Changing the client highlights or the information required means it is reviewed again. Changing the internal notes does not.</p>`:'';
  const area=f=>`<label class="full">${esc(f.label)}${f.prints?'':' <span class="badge">Never printed</span>'}<textarea name="${esc(f.key)}" maxlength="3000" rows="5" ${data.can_edit?'':'readonly'}>${esc(c[f.key]||'')}</textarea><small class="muted">${esc(f.help)}</small></label>`;
  const printed=`<div class="full"><h4>Prints on the report as</h4><p><b>Client highlights:</b> ${esc(data.printed_as.client_highlights)}</p><p><b>Information required:</b> ${esc(data.printed_as.information_required)}</p></div>`;
  const hist=data.history.length?`<details class="full"><summary>${data.history.length} saved version${data.history.length===1?'':'s'}</summary><ul>${data.history.map(h=>`<li>Version ${esc(h.version)}, saved by ${esc(h.saved_name||'')} on ${esc(shortDay(h.saved_at))}</li>`).join('')}</ul></details>`:'';
  const body=`<p class="info full">${esc(data.report_kind)} report as of ${esc(data.as_of)}. ${esc(data.note)}</p>${warn}${data.fields.map(area).join('')}${printed}${hist}
   <div class="actions full">${btn('register','Pack register')}${btn('choose','Another report')}</div>`;
  if(!data.can_edit){show('Report notes',body);return;}
  show('Report notes',form(body,'Save notes'),
   f=>request({...payload('ledger_report_notes_save'),...cur,client_highlights:f.get('client_highlights'),information_required:f.get('information_required'),internal_notes:f.get('internal_notes')}),
   async r=>{notice(r.needs_review?'Saved. The client notes changed after this report was signed off or sent for review, so it needs reviewing again.':'Notes saved.');await reopen();});
 }
 async function reopen(){editor(await request({...payload('ledger_report_notes_read'),...cur}));}
 const row=x=>`<tr><td>${esc(x.pack_kind)}${x.report_kind?`<br><small class="muted">${esc(x.report_kind)}</small>`:''}</td><td>${esc(x.as_of)}</td><td><span class="${BADGE[x.status]||'badge'}">${esc(x.status)}</span><br><small class="muted">${esc(x.status_detail)}</small></td>
  <td>${esc(x.file_name)}<br><small class="muted">${esc(x.file_format.toUpperCase())} · ${esc(x.status_word)} · fingerprint ${esc(x.fingerprint.slice(0,12))}</small></td>
  <td>${esc(x.generated_name||'')}<br><small class="muted">${esc(shortDay(x.generated_at))}</small></td>
  <td>${x.signed_name?`${esc(x.signed_name)}<br><small class="muted">${esc(shortDay(x.signed_at))} · ${esc(x.signed_via||'')}${x.sole_partner_approval?' · sole Partner':''}</small>`:''}</td>
  <td>${x.filed_on?`${esc(x.filed_on)}<br><small class="muted">${esc(x.filed_reference||'')} · ${esc(x.filed_name||'')}</small>`:''}</td>
  <td>${x.status==='Generated'&&regCache.can_sign?btn('sign','Sign',x.pack_id):''}${x.status==='Signed'&&regCache.can_file?btn('file','Mark as filed',x.pack_id):''}</td></tr>`;
 async function register(){
  regCache=await request(payload('ledger_report_packs_read'));
  const s=regCache.summary;
  show('Pack register',`<p class="info full">${esc(regCache.note)}</p><p>${s.total} produced · ${s.Draft} draft · ${s.Generated} generated · ${s.Signed} signed · ${s.Filed} filed</p>
   <div class="scroll"><table><thead><tr><th>Pack</th><th>As of</th><th>Status</th><th>File</th><th>Generated</th><th>Signed</th><th>Filed</th><th></th></tr></thead><tbody>${regCache.items.length?regCache.items.map(row).join(''):'<tr><td colspan="8">Nothing has been produced yet.</td></tr>'}</tbody></table></div>
   <div class="actions">${btn('back','Back to the notes')}</div>`);
 }
 function signForm(id){
  const item=regCache.items.find(x=>x.pack_id===id);if(!item)return;
  show('Sign the pack',form(`<p class="info full">You are signing ${esc(item.file_name)} (fingerprint ${esc(item.fingerprint.slice(0,12))}) under your own name. It is signed only if its figures and notes are still the ones in the file.</p>
   <label class="full"><input type="checkbox" name="sole_partner_approval"> I generated this pack and I am my firm’s only Partner</label>`,'Sign'),
   f=>request({...payload('ledger_report_pack_sign'),pack_id:id,sole_partner_approval:f.has('sole_partner_approval')}),async()=>{notice('Signed.');await register();});
 }
 function fileForm(id){
  const item=regCache.items.find(x=>x.pack_id===id);if(!item)return;
  show('Mark the pack as filed',form(`<p class="info full">Record that ${esc(item.file_name)} went out. It is filed only if its figures and notes are still the ones in the file.</p>
   <label>Filed on<input type="date" name="filed_on" required></label><label class="full">Where or how it was filed<input name="reference" required maxlength="200" placeholder="Reference, the email it went in, or the portal acknowledgement"></label>
   <label class="full">Note (optional)<input name="note" maxlength="500"></label>`,'Record as filed'),
   f=>request({...payload('ledger_report_pack_file'),pack_id:id,filed_on:f.get('filed_on'),reference:f.get('reference'),note:f.get('note')}),async()=>{notice('Recorded as filed.');await register();});
 }
 const handlers={choose:()=>choose(),register:()=>register(),back:()=>reopen(),sign:id=>signForm(id),file:id=>fileForm(id)};
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-rn]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.rn]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open:choose};
}
