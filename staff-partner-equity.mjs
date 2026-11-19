// Partners' capital and current accounts behind a partnership's statement of changes in equity (build 2888).
// Staff enter, for each partner named in the approved profit shares, the opening capital, the capital introduced or withdrawn, the opening current account and the drawings, with the source. A Manager or Partner
// who did not declare them approves. The share of profit is worked out by the server from the approved shares and the tie-out to the statement of changes in equity is worked out from the ledger every time.
// The server owns every rule; this file draws what it returns.
export function createPartnerEquityUI(ctx,{payload,show,onChange}){
 const {esc,form,request,notice,shortDate}=ctx;
 const btn=(a,l,id='')=>`<button type="button" data-peq="${a}" data-id="${esc(id)}">${esc(l)}</button>`;
 const money=n=>Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const FIELDS=[['capital_opening','Capital at the start'],['capital_movement','Capital introduced or (withdrawn)'],['current_opening','Current account at the start'],['drawings','Drawings (a positive figure)']];
 let data=null;
 const who=(n,at)=>n?` ${esc(n)}${at?' on '+esc(shortDate(at)):''}`:'';
 const matrixHtml=m=>m?`<table><thead><tr><th></th>${m.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${m.rows.map(r=>`<tr${r.total?' class="total"':''}><td>${r.total?'<b>'+esc(r.label)+'</b>':esc(r.label)}</td>${r.cells.map(v=>`<td>${money(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`:'';
 const tieHtml=t=>t?`<table><thead><tr><th>Movement</th><th>Partners’ accounts</th><th>Statement of changes in equity</th><th>Difference</th></tr></thead><tbody>${t.map(r=>`<tr class="${r.ties?'':'error'}"><td>${esc(r.label)}</td><td>${money(r.partners)}</td><td>${money(r.statement)}</td><td>${r.ties?'Agrees':money(r.difference)}</td></tr>`).join('')}</tbody></table>`:'';
 const rowsHtml=rec=>`<table><thead><tr><th>Partner</th>${FIELDS.map(f=>`<th>${esc(f[1])}</th>`).join('')}</tr></thead><tbody>${rec.rows.map(r=>`<tr><td>${esc(r.partner_name)}</td>${FIELDS.map(f=>`<td>${money(r[f[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 const meta=(rec,state)=>rec?`<p class="muted"><small>Version ${rec.version} declared by${who(rec.declared_name,rec.declared_at)}${state==='Approved'&&rec.reviewed_name?'; approved by'+who(rec.reviewed_name,rec.reviewed_at)+(rec.sole_partner_approval?' (the firm’s only Partner)':''):''}${state==='Returned'&&rec.review_note?'; returned: '+esc(rec.review_note):''}. Source: ${esc(rec.evidence)}</small></p>`:'';
 async function open(){
  data=await request(payload('ledger_partner_equity_read'));
  const d=data.draft,ap=data.approved,rt=data.returned;
  const state=data.shares_status!=='approved'?'<p class="error" role="alert">The partners’ profit shares are not approved yet. They name the partners, so approve them first.</p>':
   data.statement&&data.statement.built&&data.statement.ties?'<p><span class="badge good">Approved and agrees to the statement of changes in equity</span></p>':
   `<p><span class="badge red">Not complete</span></p>${data.problems.length?`<ul class="error">${data.problems.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`:''}`;
  const act=[data.can_declare?btn('declare',ap||d||rt?'Declare again':'Declare'):'',data.can_review&&d?btn('approve',d.declared_by_me?'Approve (as the only Partner)':'Approve',d.equity_id)+btn('return','Return',d.equity_id):''].join('');
  const eq=data.equity_rows.length?`<p class="muted"><small>Statement of changes in equity (${esc(data.unit_label)}): ${data.equity_rows.map(r=>`${esc(r.label)} ${money(r.total)}`).join('; ')}</small></p>`:'';
  show('Partners’ capital and current accounts',`<p class="info full">${esc(data.note)}</p>${data.locked?'<p class="error" role="alert">The pack is locked by an audit, so nothing here can change until a Partner ends the lock.</p>':''}${state}${eq}${data.partners.length?`<p class="muted"><small>Partners: ${data.partners.map(esc).join(', ')}</small></p>`:''}${ap?'<h4>Approved</h4>'+rowsHtml(ap)+meta(ap,'Approved'):''}${data.matrix?'<h4>As printed</h4>'+matrixHtml(data.matrix)+tieHtml(data.tie):''}${d?'<h4>Waiting for approval</h4>'+rowsHtml(d)+meta(d,'Waiting'):''}${rt&&!d?'<h4>Returned</h4>'+rowsHtml(rt)+meta(rt,'Returned'):''}${act?`<div class="actions">${act}</div>`:''}`);
 }
 function declareForm(seed,evidence){
  const by=new Map((seed||[]).map(r=>[r.partner_name,r]));
  const row=(p,i)=>{const s=by.get(p)||{};return `<tr><td>${esc(p)}<input type="hidden" name="p_${i}" value="${esc(p)}"></td>${FIELDS.map(f=>`<td><input aria-label="${esc(f[1]||f[0])} for ${esc(p)}" name="${f[0]}_${i}" inputmode="decimal" value="${s[f[0]]===undefined?'':esc(String(s[f[0]]))}"></td>`).join('')}</tr>`;};
  return `<p class="info full">From the partners’ ledger or the signed prior-year accounts. Enter 0 where there is none. Do not enter the share of profit: it is worked out from the approved profit shares. A partner in deficit is entered as a negative figure.</p>
<label class="full">What supports these balances * <textarea name="evidence" required minlength="10" maxlength="500">${esc(evidence||'')}</textarea></label>
<input type="hidden" name="n" value="${data.partners.length}"><table class="full"><thead><tr><th>Partner</th>${FIELDS.map(f=>`<th>${esc(f[1])}</th>`).join('')}</tr></thead><tbody>${data.partners.map(row).join('')}</tbody></table>`;
 }
 function submitRows(f){
  const n=Number(f.get('n')||0),rows=[];
  for(let i=0;i<n;i++){const r={partner_name:f.get('p_'+i)};for(const [k] of FIELDS){const m=String(f.get(k+'_'+i)??'').trim();r[k]=m===''?'':Number(m.replace(/,/g,''));}rows.push(r);}
  return request({...payload('ledger_partner_equity_declare'),evidence:f.get('evidence'),rows});
 }
 const handlers={
  back:()=>open(),
  declare(){const prev=data.draft||data.approved||data.returned;
   show('Declare the partners’ accounts',form(declareForm(prev?prev.rows:[],prev?prev.evidence:''),'Declare'),submitRows,async()=>{notice('Declared. A Manager or Partner approves it.');await open();onChange?.();});},
  async approve(id){
   if(data.draft&&data.draft.declared_by_me){
    show('Approve what you declared',form('<p class="info full">You declared this. That is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner</label>','Approve'),
     f=>request({...payload('ledger_partner_equity_review'),equity_id:id,decision:'Approved',sole_partner_approval:f.has('sole')}),async()=>{notice('Approved.');await open();onChange?.();});
    return;
   }
   await request({...payload('ledger_partner_equity_review'),equity_id:id,decision:'Approved'});notice('Approved.');await open();onChange?.();
  },
  return(id){show('Return the partners’ accounts',form('<label class="full">Why are you returning it? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),
   f=>request({...payload('ledger_partner_equity_review'),equity_id:id,decision:'Returned',review_note:f.get('review_note')}),async()=>{notice('Returned to the preparer.');await open();onChange?.();});}
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-peq]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.peq]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
