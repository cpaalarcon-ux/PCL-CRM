// Several years of trial balances in one paste, with a preview before anything is recorded (build 2889). A Manager or Partner pastes one row per account and one column per balance date. The server reads it,
// says for each year whether it balances, which accounts are mapped to an approved statement line, which are not, and which are not in the chart, and records all years or none. The server owns every rule;
// this file draws what it returns and sends the same text again to record it.
export function createTbMultiUI(ctx,{payload,show,onChange}){
 const {esc,form,request,notice}=ctx;
 const money=n=>Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const BADGE={'Ready':'<span class="badge good">Ready</span>','Accounts not mapped':'<span class="badge warn">Accounts not mapped</span>','Blocked':'<span class="badge red">Blocked</span>'};
 let text='';
 const btn=(a,l)=>`<button type="button" data-tbm="${a}">${esc(l)}</button>`;
 function entry(prefill=''){
  show('Record several years of trial balances',form(`<p class="info full">Paste from Excel. The first row holds the balance date of each column (for example 31/12/2024 and 31/12/2025), and each following row is an account code, an optional name, then one balance per date. Brackets or a minus sign mean credit. A debit column and a credit column per date also work. Nothing is recorded until you have seen the check and confirmed it.</p><label class="full">Trial balances * <textarea name="text" required rows="14" maxlength="600000">${esc(prefill)}</textarea></label>`,'Check them'),
   async f=>{text=String(f.get('text')||'');return await request({...payload('ledger_tb_multi_preview'),text});},pv=>result(pv));
 }
 const yearsTable=pv=>`<table><thead><tr><th>Balance date</th><th>Recorded as</th><th>Accounts</th><th>Debits</th><th>Credits</th><th>Balance</th><th>Mapped</th><th>Not mapped</th><th>Not in chart</th><th>Replaces</th><th>Result</th></tr></thead><tbody>${pv.years.map(y=>`<tr class="${y.can_save?'':'error'}"><td>${esc(y.as_of)}</td><td>${esc(y.role==='Opening'?'Opening trial balance':'Year-end trial balance')}${y.expected?'':' (earlier year)'}</td><td>${y.rows}</td><td>${money(y.total_debit)}</td><td>${money(y.total_credit)}</td><td>${y.balanced?'Balanced':'Out by '+money(y.difference)}</td><td>${y.mapped_accounts}</td><td>${y.unmapped_accounts}</td><td>${y.unknown_accounts}</td><td>${y.replaces?'Version '+esc(String(y.replaces.version)):'New'}</td><td>${BADGE[y.state]||esc(y.state)}</td></tr>`).join('')}</tbody></table>`;
 const unmappedHtml=pv=>pv.years.filter(y=>y.unmapped_accounts).map(y=>`<details><summary>${esc(y.as_of)}: ${y.unmapped_accounts} account(s) with no approved statement line (KES ${money(y.unmapped_amount)} in balances)</summary><ul>${y.unmapped.map(u=>`<li>${esc(u.code)} ${esc(u.name)} ${money(u.amount)}</li>`).join('')}${y.unmapped_more?`<li>and ${y.unmapped_more} more</li>`:''}</ul></details>`).join('');
 function result(pv){
  const body=`<p class="info full">Expected for this year: a year-end trial balance as of ${esc(pv.expected.year_end)} and an opening trial balance as of ${esc(pv.expected.opening)}.</p>${pv.parse_errors.length?`<ul class="error" role="alert">${pv.parse_errors.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`:yearsTable(pv)}${pv.problems.length&&!pv.parse_errors.length?`<p><b>Fix before recording</b></p><ul class="error" role="alert">${pv.problems.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`:''}${pv.warnings.length?`<p><b>To know before recording</b></p><ul class="missing">${pv.warnings.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`:''}${unmappedHtml(pv)}`;
  if(!pv.can_save){show('Check the trial balances',body+`<div class="actions">${btn('again','Change the paste')}</div>`);return;}
  const needState=pv.years.some(y=>y.role==='Year-end');
  show('Check the trial balances',body+form(`${needState?`<label>Year-end columns were taken<select name="closing_state"><option>Before year-end close</option><option>After year-end close</option></select></label>`:''}<p class="info full">${esc(pv.closing_note)}</p><label class="full">Source document and date * <input name="source_reference" required minlength="10" maxlength="500"></label>${pv.needs_unmapped_ack?'<label class="full"><input type="checkbox" name="accept_unmapped" required> Record the accounts with no approved statement line anyway. The comparatives will say Needs review until the statement-line map is approved.</label>':''}`,`Record ${pv.years.length} year${pv.years.length===1?'':'s'}`),
   f=>request({...payload('ledger_tb_multi_save'),text,closing_state:needState?f.get('closing_state'):undefined,source_reference:f.get('source_reference'),accept_unmapped:f.has('accept_unmapped')}),
   async()=>{notice('Recorded.');onChange?.();});
 }
 async function open(){entry('');}
 const handlers={again:()=>entry(text)};
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-tbm]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.tbm]?.();}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
