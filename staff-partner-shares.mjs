// Partners' profit shares (build 2872): a partnership's profit-sharing ratios from the deed, for one financial year. A Manager or Partner records them with the deed as evidence;
// a different Partner approves them. The server owns every rule (two or more partners, shares adding to exactly 100%, no salary or interest on capital); this file draws what it returns.
export function createPartnerSharesUI(ctx,{payload,show,onChange}){
 const {esc,field,select,form,request,notice,shortDate}=ctx;
 const btn=(a,l,id='')=>`<button type="button" data-psh="${a}" data-id="${esc(id)}">${esc(l)}</button>`;
 let data=null;
 // One partner per line: the name, then the percentage after a comma, tab or pipe. "A. Partner, 60" and "B. Partner<TAB>40%" both work.
 const parseRows=t=>String(t||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(x=>{const m=/^(.*?)[\s]*[,|\t][\s]*([\d.]+\s*%?)\s*$/.exec(x);return m?{partner_name:m[1],share_percent:m[2]}:{partner_name:x,share_percent:''};});
 const setHtml=(h,label)=>h?`<section class="card section-space"><h4>${esc(label)} · version ${h.version}</h4><p class="muted">Recorded by ${esc(h.entered_name||'')}${h.entered_at?' on '+esc(shortDate(h.entered_at)):''}${h.reviewed_name?` · ${h.status==='Approved'?'approved':'reviewed'} by ${esc(h.reviewed_name)}${h.reviewed_at?' on '+esc(shortDate(h.reviewed_at)):''}${h.sole_partner_approval?' (the firm’s only Partner)':''}`:''}</p>
   <table><thead><tr><th>Partner</th><th>Share of profit and loss</th></tr></thead><tbody>${h.lines.map(x=>`<tr><td>${esc(x.partner_name)}</td><td>${esc(x.percent)}</td></tr>`).join('')}</tbody></table>
   <p class="muted">Evidence: ${h.document_id?esc((data.documents.find(d=>d.document_id===h.document_id)||{}).file_name||'the partnership deed'):esc(h.source_reference||'')}</p>${h.review_note?`<p class="muted">Note: ${esc(h.review_note)}</p>`:''}</section>`:'';
 async function open(){
  data=await request(payload('ledger_partner_shares_read'));
  if(!data.eligible){show('Partners’ profit shares',`<p class="info" role="status">${esc(data.message)}</p>`);return;}
  const draft=data.draft,appr=data.approved;
  const act=[data.can_record?btn('record',draft||appr?'Record new shares':'Record the shares'):'',draft&&data.can_review?btn('approve','Approve these shares',draft.set_id)+btn('return','Return them',draft.set_id):''].join('');
  show('Partners’ profit shares',`<p class="info full">The partnership deed says how profit and loss are shared. Record every partner and share for this financial year. The shares must add to exactly 100%. A different Partner approves them; only approved shares are used to allocate the year’s profit to the partners.</p>
   ${appr?setHtml(appr,'Approved'):'<p class="missing">No shares are approved for this year, so the statements cannot allocate profit to the partners.</p>'}
   ${draft?setHtml(draft,'Waiting for a Partner'):''}
   ${draft&&data.drafted_by_me&&data.can_review?'<p class="muted">You recorded these shares. A different Partner approves them, unless you are your firm’s only Partner.</p>':''}
   <div class="actions">${act}</div>`);
 }
 function record(){
  const last=data.draft||data.approved,prefill=last?last.lines.map(x=>`${x.partner_name}, ${x.percent.replace('%','')}`).join('\n'):'';
  const docs=[['','Not in the documents yet (name it below)'],...data.documents.map(d=>[d.document_id,(d.doc_ref?d.doc_ref+' · ':'')+d.file_name])];
  show('Record the partners’ profit shares',form(`<p class="info full">One partner per line: the name, a comma, then the share as a percentage, for example <b>A. Partner, 60</b>. At least two partners, adding to exactly 100%.</p>
   <label class="full">Partners and shares *<textarea name="partners" rows="7" required>${esc(prefill)}</textarea></label>
   ${select('document_id','Partnership deed',docs,'')}${field('source_reference','Or name the deed and its date','','text','maxlength="500"')}
   <label class="full"><input type="checkbox" name="ratio_only" required> The deed shares profit and loss in these ratios, with no partner salary or interest on capital taken first.</label>`,'Record shares'),
   f=>request({...payload('ledger_partner_shares_save'),partners:parseRows(f.get('partners')),document_id:f.get('document_id')||undefined,source_reference:f.get('source_reference')||undefined,ratio_only:f.has('ratio_only')}),
   async()=>{notice('Shares recorded. A Partner approves them.');await open();onChange?.();});
 }
 const handlers={
  record:()=>record(),
  async approve(id){
   if(data.drafted_by_me){
    show('Approve your own recorded shares',form('<p class="info full">You recorded these shares. This is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner.</label>'+field('review_note','Note (optional)','','text','maxlength="500"'),'Approve'),
     f=>request({...payload('ledger_partner_shares_review'),set_id:id,decision:'Approved',sole_partner_approval:f.has('sole'),review_note:f.get('review_note')||''}),async()=>{notice('Profit shares approved.');await open();onChange?.();});
    return;
   }
   await request({...payload('ledger_partner_shares_review'),set_id:id,decision:'Approved'});notice('Profit shares approved.');await open();onChange?.();
  },
  return(id){show('Return the profit shares',form('<label class="full">Why are you returning them? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),
   f=>request({...payload('ledger_partner_shares_review'),set_id:id,decision:'Returned',review_note:f.get('review_note')}),async()=>{notice('Returned to the preparer.');await open();onChange?.();});}
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-psh]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.psh]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open,_parseRows:parseRows};
}
