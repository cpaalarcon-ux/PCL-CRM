import {guideBanner,GUIDE} from './staff-guide-text.mjs?v=20261107-annualpack-v1';
// Replace old invoice-by-invoice sales with category totals. A Manager or Partner sees the counts, prepares a draft reversal of any posted
// entry (a different Manager or Partner reviews and posts it in the ledger journals), then archives the old rows. Nothing is deleted.
export function createSalesReplaceUI(ctx){
 const {$,esc,field,select,form,modal,request,notice,shortDate,today,projectName}=ctx;
 const area=(name,label,value='')=>`<label class="full">${esc(label)}<textarea name="${name}" maxlength="2000" required minlength="10">${esc(value)}</textarea></label>`;
 const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const table=(heads,rows)=>`<div class="scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 const btn=(action,label)=>`<button type="button" data-sales-legacy="${action}">${esc(label)}</button>`;
 let state={pid:'',start:'',end:''};
 const show=(title,html,save,done)=>{if($('#editor').open)$('#editor').close();modal(title,html,save,done,{refreshWorkspace:false});$('#editor').classList.add('mapping-workspace');};
 function ask(pid){
  state.pid=pid;const y=today().slice(0,4);
  show('Replace old sales · choose dates',form(`<p class="full"><b>${esc(projectName(pid))}</b></p>`+guideBanner('When to use this',GUIDE.salesReplace,esc,{open:false})+field('starts_on','New totals start *',y+'-01-01','date','required')+field('ends_on','New totals end *',y+'-12-31','date','required')+`<p class="muted full">Use the dates the new category totals will cover. Old files that extend beyond them cannot be replaced in part.</p>`,'Count the old sales'),async f=>{state.start=f.get('starts_on');state.end=f.get('ends_on');return request({action:'sales_legacy_read',project_id:pid,starts_on:state.start,ends_on:state.end});},v=>render(v));
 }
 const journalTable=v=>v.journals.length?table(['Journal','Date','Status','Reversal'],v.journals.map(j=>[esc(j.reference),esc(shortDate(j.journal_date)),esc(j.status),j.reversal_id?esc('Reversal · '+j.reversal_status):'<b>None yet</b>'])):'<p class="muted">No accounting entries were built from these rows.</p>';
 function render(v){
  const head=`<p class="full"><b>${esc(projectName(v.project_id))}</b> · ${esc(shortDate(v.starts_on))} – ${esc(shortDate(v.ends_on))}</p>`;
  const counts=v.totals.rows?`<h3>Old invoice-based sales</h3>`+table(['File','Dates','Rows','Net KES','VAT KES','Gross KES'],[...v.batches.map(b=>[esc(b.file_name),esc(shortDate(b.period_start)+' – '+shortDate(b.period_end)),String(b.rows),money(b.net),money(b.vat),money(b.gross)]),['<b>Total</b>','',`<b>${v.totals.rows}</b>`,`<b>${money(v.totals.net)}</b>`,`<b>${money(v.totals.vat)}</b>`,`<b>${money(v.totals.gross)}</b>`]])+`<h3>Accounting entries built from them</h3>`+journalTable(v):'';
  const issues=v.issues.length?`<ul class="missing">${v.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>`:'';
  const again=btn('again','Check again');
  if(v.step==='none')return show('Replace old sales',head+`<p class="info">There are no old invoice-based sales for these dates. You can import the category totals.</p>`+btn('close','Close'));
  if(v.step==='blocked')return show('Replace old sales',head+counts+issues+`<div class="actions">${again}</div>`);
  if(v.step==='waiting')return show('Replace old sales',head+counts+`<p class="info"><b>Waiting for review.</b> A different Manager or Partner must review and post each reversal in the ledger journals. Then come back and finish.</p><div class="actions">${again}<button type="button" data-ledger="open" data-id="${esc(v.project_id)}">Open ledger journals</button></div>`);
  if(v.step==='archive'&&v.record)return show('Replace old sales · finish',head+counts+`<p class="info"><b>Ready to archive.</b> Every posted entry has a posted reversal. The old rows will be archived with this reason; the credit-note answer recorded for the new totals is <b>${esc(v.record.credit_basis)}</b>.</p>`+form('<p class="full">Archived rows stay readable in the import history. They no longer count in mapping, VAT or the ledger.</p>','Archive old rows and finish'),async()=>request({action:'sales_legacy_complete',project_id:v.project_id,starts_on:v.starts_on,ends_on:v.ends_on}),r=>{notice(`${r.rows} old row(s) archived. Import the category totals with the answer “${r.credit_basis}”.`);});
  // prepare
  show('Replace old sales · prepare',head+counts+issues+form(`<h3 class="full">1. Credit notes</h3>`+select('credit_basis','Will the new totals be after or before credit notes? *',['After credit notes','Before credit notes'],'','Choose first')+`<p class="muted full">The new totals import must use this same answer.</p><h3 class="full">2. Why</h3>`+area('reason','Reason for replacing the old sales *','')+`<h3 class="full">3. Confirm</h3><input type="hidden" name="expected_rows" value="${esc(v.totals.rows)}"><label class="full"><input type="checkbox" name="confirm" required> I checked the counts above. ${v.journals.length?`A draft reversal will be prepared for each posted entry; `:''}the old rows are archived only after the reversal is posted.</label>`,v.journals.length?'Prepare draft reversal':'Record and continue'),async f=>request({action:'sales_legacy_prepare',project_id:v.project_id,starts_on:v.starts_on,ends_on:v.ends_on,credit_basis:f.get('credit_basis'),reason:f.get('reason'),expected_rows:Number(f.get('expected_rows')),confirm:f.has('confirm')}),async r=>{notice(r.next);const v2=await request({action:'sales_legacy_read',project_id:v.project_id,starts_on:v.starts_on,ends_on:v.ends_on});render(v2);});
  $('#editForm').elements.credit_basis.required=true;
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-sales-legacy]');if(!b)return;
  try{if(b.dataset.salesLegacy==='close'){if($('#editor').open)$('#editor').close();return;}if(b.dataset.salesLegacy==='again')render(await request({action:'sales_legacy_read',project_id:state.pid,starts_on:state.start,ends_on:state.end}));}
  catch(err){if($('#editor').open)$('#editorNotice').textContent=err.message;else notice(err.message,true);}});
 return {ask};
}
