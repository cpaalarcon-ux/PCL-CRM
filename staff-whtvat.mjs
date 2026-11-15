// Withholding VAT schedule (build 2834): the VAT this client withheld from its suppliers, one payment month at a time. The server (wht-vat-actions.ts, wht-vat-rules.mjs)
// owns every rule and calculation: the rate is the effective-dated rule on each payment date, never a figure in this file. The certificates the client RECEIVES are linked
// to sales invoices from the credit panel on the VAT return.
export const WHTVAT_NOTE='Pick supplier invoices from the retained KRA purchases CSV (only invoices that carry VAT are listed) and enter the date the supplier was paid. The rate is the withholding VAT rule in force on that date. Amounts are kept to the cent; the file shows the whole shilling the KRA workbook calculates.';
export function createWhtVatUI(ctx,{back}={}){
 const {$,esc,field,select,form,modal,request,notice,projectName}=ctx;
 const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const button=(action,label,id='',extra='')=>`<button type="button" data-whtvat="${action}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
 const table=(heads,rows)=>`<div class="scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 const show=(title,html,save,done)=>{if($('#editor').open)$('#editor').close();modal(title,html,save,done);$('#editor').classList.add('mapping-workspace');};
 const download=r=>{const bytes=Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0)),u=URL.createObjectURL(new Blob([bytes],{type:r.mime})),a=document.createElement('a');a.href=u;a.download=r.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
 let pid='',month='',data=null;
 async function open(id,m){
  pid=id;month=m||month||new Date().toISOString().slice(0,7);
  const r=await request({action:'whtvat_read',project_id:pid,month});data=r;
  const rate=r.rate.error?`<p class="missing">${esc(r.rate.error)}</p>`:`<p class="info">Rate in force at the end of ${esc(month)}: <b>${esc(r.rate.rate)}%</b> (${esc(r.rate.label)}, ${esc(r.rate.effective_from)} to ${esc(r.rate.effective_to)}). Each line uses the rule in force on its own payment date.</p>`;
  const live=r.schedule.filter(l=>l.status==='Active'),t=r.schedule_totals;
  show('Withholding VAT schedule · '+month,
   `<p><b>${esc(projectName(pid))}</b> · client PIN ${esc(r.client_pin||'not recorded')}</p><p class="info full">${esc(WHTVAT_NOTE)}</p>`
   +`<div class="filters">${field('whtvat_month','Payment month',month,'month')}<button type="button" data-whtvat="load">Show month</button></div>`+rate
   +`<p>${t.active} line${t.active===1?'':'s'} · VAT withheld to the cent <b>${money(t.exact)}</b> · in the KRA file (whole shillings) <b>${money(t.whole)}</b></p>`
   +`<div class="actions">${button('add','Add from the KRA purchases CSV',pid,r.candidates.length&&!r.rate.error?'':'disabled')}${button('manual','Add an invoice not in the CSV',pid,r.rate.error?'disabled':'')}${button('export','Download schedule (Excel)',pid,t.active?'':'disabled')}${button('back','Back to the withholding schedule',pid)}</div>`
   +(r.schedule.length?table(['Supplier','Invoice','Invoice date','Net','Paid','Rate','VAT withheld','Basis',''],r.schedule.map(l=>[`${esc(l.supplier_name)}<small> ${esc(l.supplier_pin)}</small>`,esc(l.invoice_no),esc(l.invoice_date),money(l.invoice_net),esc(l.payment_date),`${esc(l.rate)}%`,money(l.vat_withheld),esc(l.vat_basis)+(l.status==='Voided'?`<br><small class="warn">Voided: ${esc(l.void_reason)}</small>`:''),l.status==='Active'?button('void','Void',l.line_id):''])):'<p class="muted">No lines for this payment month yet.</p>'));
  const input=$('#editorBody [name=whtvat_month]');if(input)input.value=month;
 }
 function addForm(){
  const opts=data.candidates.map(c=>[c.line_id,`${c.invoice_no} · ${c.party_name||c.party_pin||'supplier'} · net ${money(c.net)} · ${c.invoice_date}`]);
  show('Add from the KRA purchases CSV',form(`<p class="full">These invoices are in the retained KRA purchases CSV as standard or 8% rated and are not yet on a schedule line. Supplier, invoice and amount come from the CSV, not from typing.</p>`
   +select('csv_line_id','Supplier invoice *',opts,'','Choose invoice')+field('payment_date','Date the supplier was paid *',month+'-'+String(Math.min(new Date().getDate(),28)).padStart(2,'0'),'date','required')
   +field('evidence_reference','Evidence: payment advice or bank reference *','','text','required maxlength="500"'),'Add to schedule'),
   f=>request({action:'whtvat_agent_add',project_id:pid,csv_line_id:f.get('csv_line_id'),payment_date:f.get('payment_date'),evidence_reference:f.get('evidence_reference')}),
   async r=>{notice(`Added. VAT withheld ${money(r.vat_withheld)} at ${r.rate}% (${r.whole_shillings} in the KRA file).`);await open(pid,month);});
 }
 function manualForm(){
  show('Add an invoice that is not in the CSV',form(`<p class="full">Use this only when the invoice is genuinely absent from the KRA purchases CSV. If the CSV lists it, the CSV figures are used and a zero-rated or exempt invoice is refused.</p>`
   +field('supplier_pin','Supplier PIN *','','text','required maxlength="11"')+field('supplier_name','Supplier name *','','text','required maxlength="200"')
   +field('invoice_no','Supplier invoice number *','','text','required maxlength="40"')+field('invoice_date','Invoice date *','','date','required')
   +field('invoice_net','Invoice amount before VAT *','','number','required min="0.01" step="0.01"')+field('payment_date','Date the supplier was paid *',month+'-'+String(Math.min(new Date().getDate(),28)).padStart(2,'0'),'date','required')
   +field('evidence_reference','Evidence: payment advice or bank reference *','','text','required maxlength="500"')
   +`<label class="full"><input type="checkbox" name="vat_charged_confirmed" required> I have seen the supplier invoice and it charges VAT.</label>`,'Add to schedule'),
   f=>request({action:'whtvat_agent_add',project_id:pid,supplier_pin:f.get('supplier_pin'),supplier_name:f.get('supplier_name'),invoice_no:f.get('invoice_no'),invoice_date:f.get('invoice_date'),invoice_net:f.get('invoice_net'),payment_date:f.get('payment_date'),evidence_reference:f.get('evidence_reference'),vat_charged_confirmed:f.has('vat_charged_confirmed')}),
   async r=>{notice(`Added. VAT withheld ${money(r.vat_withheld)} at ${r.rate}%.`);await open(pid,month);});
 }
 function voidForm(lineId){
  show('Void a schedule line',form('<label class="full">Why is this line voided? * <textarea name="reason" required minlength="10" maxlength="500"></textarea></label>','Void line'),f=>request({action:'whtvat_agent_void',project_id:pid,line_id:lineId,reason:f.get('reason')}),async()=>{notice('Line voided.');await open(pid,month);});
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-whtvat]');if(!b)return;b.disabled=true;
  try{const a=b.dataset.whtvat;
   if(a==='load'){const m=$('#editorBody [name=whtvat_month]')?.value;if(m)await open(pid,m);}
   else if(a==='add')addForm();else if(a==='manual')manualForm();else if(a==='void')voidForm(b.dataset.id);
   else if(a==='export'){const r=await request({action:'whtvat_agent_export',project_id:pid,month});download(r);notice(r.issues.length>1?'Downloaded. Open the Start Here sheet: it lists what still needs attention.':'Downloaded.');}
   else if(a==='back')back?.(pid,month);
  }catch(error){notice(error.message,true);}finally{b.disabled=false;}
 });
 return {open};
}
