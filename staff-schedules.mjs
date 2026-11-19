// Supporting schedules behind the notes of the annual pack (build 2886): stock, receivables, payables, bank, loans, tax, payroll and equity.
// A schedule says what is inside each account of a note. It is declared with its source and approved by a Manager or Partner who did not declare it; the tie-out to the trial balance is worked out by the
// server from the posted ledger every time. The server owns every rule; this file draws what it returns.
export function createSchedulesUI(ctx,{payload,show,onChange}){
 const {esc,form,request,notice,shortDate}=ctx;
 const btn=(a,l,id='',extra='')=>`<button type="button" data-sched="${a}" data-id="${esc(id)}" ${extra}>${esc(l)}</button>`;
 const BADGE={'Approved':'<span class="badge good">Approved</span>','Waiting for approval':'<span class="badge warn">Waiting for approval</span>','Returned':'<span class="badge red">Returned</span>','Not declared':'<span class="badge red">Not declared</span>','No note':'<span class="badge">No note this year</span>'};
 const money=n=>Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 let data=null;
 const who=(n,at)=>n?` ${esc(n)}${at?' on '+esc(shortDate(at)):''}`:'';
 const tieHtml=t=>t?`<table><thead><tr><th>Account</th><th>Schedule</th><th>Trial balance</th><th>Difference</th></tr></thead><tbody>${t.rows.map(r=>`<tr class="${r.ties?'':'error'}"><td>${esc(r.account)} ${esc(r.name)}</td><td>${money(r.schedule)}</td><td>${money(r.trial_balance)}</td><td>${r.ties?'Agrees':money(r.difference)}</td></tr>`).join('')}</tbody></table>`:'';
 const linesHtml=s=>`<table><thead><tr><th>Heading</th><th>Item</th><th>Account</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${s.lines.map(l=>`<tr><td>${esc(l.category)}</td><td>${esc(l.description)}</td><td>${esc(l.account)}</td><td>${esc(l.reference||'')}</td><td>${money(l.amount)}</td></tr>`).join('')}</tbody></table>`;
 const kindHtml=k=>{
  const shown=k.draft||k.approved||k.returned,act=[
   data.can_declare?btn('declare',k.state==='Not declared'||k.state==='No note'?'Declare':'Declare again',k.kind):'',
   data.can_declare&&k.can_prefill?btn('prefill','Start from the register',k.kind):'',
   k.can_review?btn('approve',k.draft.declared_by_me?'Approve (as the only Partner)':'Approve',k.draft.schedule_id)+btn('return','Return',k.draft.schedule_id):''
  ].join('');
  const meta=shown?`<p class="muted"><small>Version ${shown.version} declared by${who(shown.declared_name,shown.declared_at)}${k.state==='Approved'&&shown.reviewed_name?'; approved by'+who(shown.reviewed_name,shown.reviewed_at)+(shown.sole_partner_approval?' (the firm’s only Partner)':''):''}${k.state==='Returned'&&shown.review_note?'; returned: '+esc(shown.review_note):''}. Source: ${esc(shown.evidence)}</small></p>`:'';
  const accounts=k.accounts.length?`<p class="muted"><small>Accounts in the note: ${k.accounts.map(a=>`${esc(a.code)} ${esc(a.name)} ${money(a.amount)}`).join('; ')}</small></p>`:'';
  return `<section class="card section-space"><h4>${esc(k.title)}${k.note_number?` (note ${k.note_number})`:''} ${BADGE[k.state]||''}${k.has_note&&!k.relevant?' <span class="badge">No balance, no schedule needed</span>':''}</h4>${k.has_note?accounts:'<p class="muted">The statements have no note for this schedule this year.</p>'}${k.approved?linesHtml(k.approved)+tieHtml(k.tie):''}${k.draft?'<p><b>Waiting for approval</b></p>'+linesHtml(k.draft):''}${meta}${act?`<div class="actions">${act}</div>`:''}</section>`;
 };
 async function open(){
  data=await request(payload('ledger_schedules_read'));
  const state=data.ok?'<p><span class="badge good">Every schedule needed is approved and agrees to the trial balance</span></p>':`<p><span class="badge red">Not complete</span></p><ul class="error">${data.problems.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`;
  show('Supporting schedules',`<p class="info full">${esc(data.note)}</p>${data.locked?'<p class="error" role="alert">The pack is locked by an audit, so nothing here can change until a Partner ends the lock.</p>':''}${state}${data.kinds.filter(k=>k.has_note).map(kindHtml).join('')}`);
 }
 const opt=(items,sel)=>items.map(x=>`<option value="${esc(x)}"${x===sel?' selected':''}>${esc(x)}</option>`).join('');
 function declareForm(k,seed,evidence){
  const rows=Math.min(data.max_lines,Math.max(8,seed.length+4));
  const row=i=>{const s=seed[i]||{};return `<tr><td><select aria-label="Category, row ${i+1}" name="c_${i}"><option value=""></option>${opt(k.categories,s.category)}</select></td><td><input aria-label="Description, row ${i+1}" name="d_${i}" maxlength="120" value="${esc(s.description||'')}"></td><td><select aria-label="Account, row ${i+1}" name="a_${i}"><option value=""></option>${k.accounts.map(a=>`<option value="${esc(a.code)}"${a.code===s.account?' selected':''}>${esc(a.code)} ${esc(a.name)}</option>`).join('')}</select></td><td><input aria-label="Reference, row ${i+1}" name="r_${i}" maxlength="120" value="${esc(s.reference||'')}"></td><td><input aria-label="Amount, row ${i+1}" name="m_${i}" inputmode="decimal" value="${s.amount===undefined?'':esc(String(s.amount))}"></td></tr>`;};
  return `<p class="info full">${esc(k.source_hint)} Write a cost or a deduction as a negative figure only where it reduces the account. Every account in the note must be covered, and the total of each account must agree to the trial balance.</p>
<label class="full">What supports this schedule * <textarea name="evidence" required minlength="10" maxlength="500">${esc(evidence||'')}</textarea></label>
<input type="hidden" name="n" value="${rows}"><table class="full"><thead><tr><th>Heading</th><th>Item</th><th>Account</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${Array.from({length:rows},(_,i)=>row(i)).join('')}</tbody></table>`;
 }
 function submitLines(k,f){
  const n=Number(f.get('n')||0),lines=[];
  for(let i=0;i<n;i++){const d=String(f.get('d_'+i)||'').trim(),m=String(f.get('m_'+i)||'').trim();if(!d&&!m&&!f.get('c_'+i))continue;lines.push({category:f.get('c_'+i)||'',description:d,account:f.get('a_'+i)||'',reference:f.get('r_'+i)||'',amount:m===''?'':Number(m.replace(/,/g,''))});}
  return request({...payload('ledger_schedule_declare'),kind:k.kind,evidence:f.get('evidence'),lines});
 }
 const handlers={
  back:()=>open(),
  declare(kind){
   const k=data.kinds.find(x=>x.kind===kind),prev=k.draft||k.approved||k.returned;
   show('Declare: '+k.title,form(declareForm(k,prev?prev.lines:[],prev?prev.evidence:''),'Declare'),f=>submitLines(k,f),async()=>{notice('Declared. A Manager or Partner approves it.');await open();onChange?.();});
  },
  async prefill(kind){
   const k=data.kinds.find(x=>x.kind===kind),pre=await request({...payload('ledger_schedule_prefill'),kind});
   show('Start from the register: '+k.title,`<p class="info full">${esc(pre.note)}</p>`+form(declareForm(k,pre.lines,pre.evidence),'Declare'),f=>submitLines(k,f),async()=>{notice('Declared. A Manager or Partner approves it.');await open();onChange?.();});
  },
  async approve(id){
   const k=data.kinds.find(x=>x.draft&&x.draft.schedule_id===id);
   if(k&&k.draft.declared_by_me){
    show('Approve a schedule you declared',form('<p class="info full">You declared this. That is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner</label>','Approve'),
     f=>request({...payload('ledger_schedule_review'),schedule_id:id,decision:'Approved',sole_partner_approval:f.has('sole')}),async()=>{notice('Approved.');await open();onChange?.();});
    return;
   }
   await request({...payload('ledger_schedule_review'),schedule_id:id,decision:'Approved'});notice('Approved.');await open();onChange?.();
  },
  return(id){show('Return the schedule',form('<label class="full">Why are you returning it? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),
   f=>request({...payload('ledger_schedule_review'),schedule_id:id,decision:'Returned',review_note:f.get('review_note')}),async()=>{notice('Returned to the preparer.');await open();onChange?.();});}
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-sched]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.sched]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
