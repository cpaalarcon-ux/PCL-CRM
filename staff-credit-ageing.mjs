import {guideBanner,GUIDE} from './staff-guide-text.mjs?v=20261107-views-v2';
// Purchase credit notes that have no original invoice yet: how long each has waited, by supplier, and a one-click request to the client.
// They stay outside mapping, posting and VAT totals; nothing is recorded as a liability for them.
export function createCreditAgeingUI(ctx){
 const {$,esc,modal,request,notice,shortDate,projectName}=ctx;
 const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const table=(heads,rows)=>`<div class="scroll purchase-ledger-scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 let pid='';
 const show=(title,html)=>{if($('#editor').open)$('#editor').close();modal(title,html);$('#editor').classList.add('mapping-workspace');};
 const save=x=>{const bytes=Uint8Array.from(atob(x.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:x.mime_type})),a=document.createElement('a');a.href=url;a.download=x.file_name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 async function open(id){
  pid=id;const r=await request({action:'purchase_ledger_credit_ageing',project_id:pid}),rep=r.report;
  const body=guideBanner('How credit notes without an original invoice are handled',GUIDE.orphanCredits,esc,{open:false})
   +`<p><b>${esc(projectName(pid))}</b> · as at ${esc(rep.as_of)}</p>`
   +(r.total?`<p class="info"><b>${r.total} credit note${r.total===1?'':'s'}</b> excluded from mapping, posting and VAT totals: net ${money(r.net)} · VAT ${money(r.vat)} · gross ${money(r.gross)}. Final totals are incomplete until the original invoice number and date are supplied. No liability or suspense balance is recorded.</p>`:'<p class="muted">No credit notes are waiting for original invoice details.</p>')
   +(rep.overdue.count?`<p class="missing">${rep.overdue.count} credit note${rep.overdue.count===1?' has':'s have'} waited more than ${rep.alert_days} days (gross ${money(rep.overdue.gross)}, oldest ${rep.overdue.oldest_days} days). A task and a notification are created each day this is true.</p>`:'')
   +(r.truncated?'<p class="missing">More than 2,000 credit notes are pending. Narrow the dates before preparing the client request.</p>':'')
   +(r.total?`<div class="actions"><button type="button" data-credit-age="request" data-id="${esc(pid)}">Prepare request to the client</button><button type="button" data-v6="rows" data-id="${esc(pid)}">View pending information</button></div>`:'')
   +(r.last_request?`<p class="muted">Last request prepared ${esc(shortDate(r.last_request.requested_at))} by ${esc(r.last_request.full_name||'a colleague')} for ${r.last_request.credit_count} credit note${r.last_request.credit_count===1?'':'s'} (gross ${money(r.last_request.gross_amount)}).</p>`:'')
   +(r.total?`<h3>Ageing</h3>`+table(['Age from credit note date','Credit notes','Net','VAT','Gross'],rep.buckets.map(b=>[esc(b.label),b.count,money(b.net),money(b.vat),money(b.gross)]))
    +`<h3>By supplier</h3>`+table(['Supplier','PIN','Credit notes','Gross','Oldest (days)'],rep.suppliers.map(s=>[esc(s.party),esc(s.pin||'No PIN'),s.count,money(s.gross),s.oldest_days]))
    +`<h3>Credit notes</h3>`+table(['Credit note','Date','Supplier','Net','VAT','Gross','Days','Source'],rep.rows.map(x=>[esc(x.credit_note),x.credit_date?esc(shortDate(x.credit_date)):'Not readable',esc(x.party),money(x.net),money(x.vat),money(x.gross),x.age_days??'',esc(x.file_name)+` · row ${x.source_row}`])):'');
  show('Credit notes pending original invoice',body);
 }
 async function prepare(){
  const x=await request({action:'purchase_ledger_credit_request',project_id:pid});
  save(x);
  show('Request to the client',`<p class="info">${esc(x.note)} The list of ${x.count} credit note${x.count===1?'':'s'} was downloaded.</p><label class="full">Message to copy<textarea readonly rows="14" id="creditRequestText">${esc(x.message)}</textarea></label><div class="actions"><button type="button" data-credit-age="copy">Copy message</button><button type="button" data-credit-age="open" data-id="${esc(pid)}">Back to ageing</button></div>`);
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-credit-age]');if(!b)return;b.disabled=true;
  try{const a=b.dataset.creditAge;
   if(a==='open')await open(b.dataset.id);
   else if(a==='request')await prepare();
   else if(a==='copy'){const t=$('#creditRequestText');if(t){try{await navigator.clipboard.writeText(t.value);notice('Message copied.');}catch{t.select();notice('Press Ctrl+C to copy the selected message.');}}}
  }catch(error){notice(error.message,true);}finally{b.disabled=false;}
 });
 return {open};
}
