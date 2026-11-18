// The assembled annual pack (build 2885): one PDF or workbook of the front pages, statements and notes, with the status word, a watermark until the pack is audited, one numbered note sequence
// and, after an external audit, the signed auditor's report. The server builds everything; this file shows what it returns and downloads the file.
export function createPackExportUI(ctx,{payload,show}){
 const {esc,request,notice}=ctx;
 const btn=(a,l,id='')=>`<button type="button" data-packx="${a}" data-id="${esc(id)}">${esc(l)}</button>`;
 let data=null;
 const WORD={'Draft':'badge red','Management draft':'badge warn','Subject to audit':'badge warn','Audited':'badge good'};
 async function open(){
  data=await request(payload('ledger_pack_assemble_read'));
  const open_=data.open_checks.length?`<p class="muted full">Why it is not final:</p><ul class="error">${data.open_checks.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:'<p class="info full">Every check passes.</p>';
  const probs=data.problems.length?`<p class="muted full">Pages or notes that are not ready (shown as “Not ready” in the file):</p><ul class="error">${data.problems.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>`:'';
  show('Assembled pack',`<p class="info full">One file of the front pages, statements and notes. The status word is on every page, and a watermark is on every page until the pack is audited.</p>
   <p>Status: <span class="${WORD[data.status_word]||'badge'}">${esc(data.status_word)}</span>${data.watermark?` <small class="muted">Watermark: ${esc(data.watermark)}</small>`:''}</p>${open_}${probs}
   <h4>Contents</h4><ol>${data.contents.map(c=>`<li>${esc(c.title)}${c.ready?'':' <span class="badge red">Not ready</span>'}</li>`).join('')}</ol>
   <h4>Notes</h4><ol class="plain">${data.note_index.map(n=>`<li>${esc(n.number)}. ${esc(n.title)}</li>`).join('')}</ol>${data.numbering.note?`<p class="muted"><small>${esc(data.numbering.note)}</small></p>`:''}
   ${data.attachments.length?`<p class="muted"><small>The signed auditor’s report is added to the PDF exactly as signed (${esc(data.attachments[0].file_name)}; fingerprint ${esc(data.attachments[0].sha256.slice(0,16))}).</small></p>`:''}
   <p class="muted"><small>Pack fingerprint ${esc(data.fingerprint.slice(0,16))}. The workbook cannot hold the signed report; the PDF does.</small></p>
   <div class="actions">${btn('pdf','Download PDF')}${btn('xlsx','Download Excel workbook')}</div>`);
 }
 async function download(format){
  const x=await request({...payload('ledger_pack_assemble'),format}),bytes=Uint8Array.from(atob(x.base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:x.mime_type})),link=document.createElement('a');
  link.href=url;link.download=x.file_name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  notice(`${x.status_word} pack downloaded (${format==='pdf'?'PDF':'Excel'}).`);
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-packx]');if(!b)return;b.disabled=true;try{if(b.dataset.packx==='pdf'||b.dataset.packx==='xlsx')await download(b.dataset.packx);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
