// Notes to the annual statements (build 2873): the notes the ledger builds from the posted trial balance, numbered in statement order, each line agreeing with its caption on the statements.
// A Manager or Partner prepares them; a different Partner presses Approve Notes. The approval holds only while the figures are unchanged. The server owns every rule; this file draws what it returns.
export function createNotesUI(ctx,{payload,show,onChange}){
 const {esc,field,form,request,notice,shortDate}=ctx;
 const btn=(a,l,id='')=>`<button type="button" data-notes="${a}" data-id="${esc(id)}">${esc(l)}</button>`;
 const num=v=>v===null||v===undefined?'':v===0?'–':v<0?'('+Math.abs(v).toLocaleString('en-KE')+')':v.toLocaleString('en-KE');
 let data=null;
 const BADGE={approved:'<span class="badge good">Approved by a Partner</span>',draft:'<span class="badge warn">Waiting for a Partner</span>',stale:'<span class="badge red">Figures changed since it was prepared</span>',none:'<span class="badge red">Not prepared</span>'};
 const noteHtml=n=>`<section class="card section-space"><h4>Note ${n.number}. ${esc(n.title)}</h4>${n.sections.map(s=>`<table><thead><tr><th>${esc(s.label)} (${esc(s.statement==='Profit or loss'?'profit or loss':'financial position')})</th><th>${esc(data.unit_label)}</th><th>Prior year</th></tr></thead><tbody>${s.accounts.map(a=>`<tr><td>${esc(a.code)} ${esc(a.name)}</td><td>${num(a.amount)}</td><td></td></tr>`).join('')}${s.rounding?`<tr><td><i>Rounding</i></td><td>${num(s.rounding)}</td><td></td></tr>`:''}<tr><td><b>Total</b></td><td><b>${num(s.total)}</b></td><td>${s.prior===null?'<span class="muted">Not available</span>':num(s.prior)}</td></tr></tbody></table><p class="${s.ties?'muted':'error'}" role="alert">${s.ties?'Agrees to the statements.':`Does not agree: the statements show ${num(s.face)}.`}</p>`).join('')}<p class="muted"><small>${esc(n.control.source)}. ${esc(n.control.evidence)} ${esc(n.control.prior_year)}</small></p></section>`;
 async function open(){
  data=await request(payload('ledger_notes_read'));
  const ap=data.approved,dr=data.draft;
  const state=`<p>${BADGE[data.state]||''}${ap?` Version ${ap.version} approved by ${esc(ap.reviewed_name||'')}${ap.reviewed_at?' on '+esc(shortDate(ap.reviewed_at)):''}${ap.sole_partner_approval?' (the firm’s only Partner)':''}.`:''}${dr?` Version ${dr.version} prepared by ${esc(dr.prepared_name||'')} waits for a Partner${dr.digest_matches?'':', but the figures have changed since'}.`:''}</p>`;
  const act=[data.can_prepare&&data.state!=='approved'?btn('prepare',dr||ap?'Prepare the notes again':'Prepare the notes'):'',data.can_review&&dr?btn('approve','Approve Notes',dr.set_id)+btn('return','Return them',dr.set_id):''].join('');
  show('Notes to the financial statements',`<p class="info full">Each note analyses a line of the statements by account, from the posted trial balance. The numbers on the statements point to these notes. A Partner must approve the notes before the statements can be final, and the approval lapses if any figure changes.</p>${state}${data.problems.length?`<p class="error" role="alert">${data.problems.map(esc).join(' ')}</p>`:''}${data.drafted_by_me&&data.can_review?'<p class="muted">You prepared these notes. A different Partner approves them, unless you are your firm’s only Partner.</p>':''}<div class="actions">${act}</div>${data.notes.length?data.notes.map(noteHtml).join(''):'<p class="missing">No statement line with a balance has a note yet.</p>'}`);
 }
 const handlers={
  async prepare(){await request(payload('ledger_notes_prepare'));notice('Notes prepared. A Partner approves them.');await open();onChange?.();},
  async approve(id){
   if(data.drafted_by_me){
    show('Approve notes you prepared',form('<p class="info full">You prepared these notes. This is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner.</label>'+field('review_note','Note (optional)','','text','maxlength="500"'),'Approve Notes'),
     f=>request({...payload('ledger_notes_review'),set_id:id,decision:'Approved',sole_partner_approval:f.has('sole'),review_note:f.get('review_note')||''}),async()=>{notice('Notes approved.');await open();onChange?.();});
    return;
   }
   await request({...payload('ledger_notes_review'),set_id:id,decision:'Approved'});notice('Notes approved.');await open();onChange?.();
  },
  return(id){show('Return the notes',form('<label class="full">Why are you returning them? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),
   f=>request({...payload('ledger_notes_review'),set_id:id,decision:'Returned',review_note:f.get('review_note')}),async()=>{notice('Returned to the preparer.');await open();onChange?.();});}
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-notes]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.notes]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
