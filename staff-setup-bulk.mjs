// Submit set-up sections for several clients at once (build: set-up bulk). The preparer ticks clients and sections, says where the information came from,
// and sends them for review together. Sections with nothing recorded yet are skipped and listed. A Manager or Partner then reviews them in "Review pending setup".
export const BULK_SECTIONS=[
 ['identity','Client identification and legal structure','BRS'],['registration','BRS registration details','BRS'],['tax','KRA PIN and tax obligations','KRA'],
 ['ownership','Directors, partners and ownership','BRS'],['activities','Business activities and sector','KRA'],['year_end','Financial year and reporting details','KRA'],
 ['contacts','Contact details and addresses','Client document'],['permanent_file','Permanent file information','Permanent file'],['engagement','Engagement and assigned personnel','Client document']
];
const KINDS=['BRS','KRA','Permanent file','Client document','Other approved source'];
export function bulkSubmitHtml(clients,esc=v=>String(v??'')){
 const rows=clients.map(c=>`<label class="obligation-choice" data-bulk-row="${esc(String(c.company_name||'').toLowerCase()+' '+String(c.kra_pin||'').toLowerCase())}"><input type="checkbox" name="bulk_client" value="${esc(c.client_id)}"> <b>${esc(c.company_name)}</b><small>${esc(c.kra_pin||'No KRA PIN')}</small></label>`).join('');
 const secs=BULK_SECTIONS.map(([code,label,kind])=>`<tr><td><label><input type="checkbox" name="bulk_section" value="${esc(code)}" checked> ${esc(label)}</label></td><td><select name="source_${esc(code)}" aria-label="Source for ${esc(label)}">${KINDS.map(k=>`<option value="${esc(k)}"${k===kind?' selected':''}>${esc(k)}</option>`).join('')}</select></td></tr>`).join('');
 return `<p class="info">Tick the clients and sections to send for review. A section with nothing recorded yet is skipped and listed. Up to 100 clients at a time. A Manager or Partner who did not submit them reviews them together afterwards, and you carry on in the meantime.</p>
  <form id="setupBulkForm"><label class="full">Search clients<input type="search" id="setupBulkSearch" placeholder="Name or KRA PIN"></label>
  <label><input type="checkbox" id="setupBulkAll"> Tick every client shown</label> <span id="setupBulkCount" class="muted">0 ticked</span>
  <div class="scroll" id="setupBulkClients" style="max-height:18rem">${rows||'<p class="muted">No clients are available to you.</p>'}</div>
  <div class="scroll"><table><thead><tr><th>Section</th><th>Source of the information</th></tr></thead><tbody>${secs}</tbody></table></div>
  <label class="full">Note about the source (optional; required for "Other approved source")<input name="source_note" maxlength="500"></label>
  <button type="submit" class="primary full">Submit for review</button></form>`;
}
export function collectBulk(form){
 const client_ids=[...form.querySelectorAll('input[name="bulk_client"]')].filter(x=>x.checked).map(x=>x.value);
 const note=form.elements.namedItem('source_note')?.value||'';
 const sections=[...form.querySelectorAll('input[name="bulk_section"]')].filter(x=>x.checked).map(x=>{const kind=form.elements.namedItem('source_'+x.value)?.value||'';return {section_code:x.value,source_kind:kind,source_note:kind==='Other approved source'||note?note:''};});
 return {client_ids,sections};
}
export function bulkResultHtml(out,esc=v=>String(v??'')){
 const list=(items,line,limit=60)=>items.length?`<ul>${items.slice(0,limit).map(x=>`<li>${line(x)}</li>`).join('')}</ul>${items.length>limit?`<p class="muted">Showing the first ${limit} of ${items.length}.</p>`:''}`:'';
 return `<p>Submitted: <b>${out.submitted.length}</b> · Skipped, nothing recorded yet: <b>${out.skipped.length}</b> · Held back: <b>${out.held.length}</b></p>${out.held.length?`<p><b>Held back</b></p>${list(out.held,x=>`${esc(x.name)}: ${esc(x.reason)}`)}`:''}${out.skipped.length?`<details><summary>Skipped (${out.skipped.length})</summary>${list(out.skipped,x=>`${esc(x.name)} · ${esc(x.section)}`,200)}</details>`:''}`;
}
export function filterRows(host,term){
 const t=String(term||'').trim().toLowerCase();
 for(const r of host.querySelectorAll('[data-bulk-row]'))r.hidden=!!t&&!r.dataset.bulkRow.includes(t);
}
export function tickShown(host,on){
 for(const r of host.querySelectorAll('[data-bulk-row]')){const b=r.querySelector('input');if(b)b.checked=!!on&&!r.hidden;}
}
