// Prior-year trial balances for the comparatives screen (build 2824). Display only: the server decides what is derived, what is Not available and what a Partner must confirm.
const STATE_CLASS={Derived:'good','Needs review':'warn','Not available':'bad'};
export function tbListHtml(list,{esc,table,btn,canEdit}){
 if(!list)return '';
 const rows=(list.trial_balances||[]).map(t=>[esc(t.tb_kind),esc(t.as_of),esc(t.closing_state),esc(String(t.version)),esc(String(t.row_count)),esc(Number(t.total_debit).toLocaleString('en-KE',{minimumFractionDigits:2})),esc(t.entered_by_name||''),esc(t.source_reference)]);
 const need=`<p class="muted">For the comparatives of this year the ERP looks for a <b>year-end</b> trial balance as of ${esc(list.expected.year_end)} and an <b>opening</b> trial balance as of ${esc(list.expected.opening)}. A statement with no trial balance behind it is shown as Not available, never as zero.</p>`;
 return `<section class="card full"><h4>Recorded prior-year trial balances</h4>${need}${table(['Kind','As of','Taken','Version','Rows','Debits (KES)','Recorded by','Source'],rows)}${canEdit?`<div class="actions">${btn('tb-add','Record a trial balance')}${btn('tb-multi','Record several years at once')}${btn('tb-derive','Prepare comparatives from these')}</div>`:''}</section>`;
}
export function deriveHtml(r,{esc,warn}){
 const st=Object.entries(r.statements||{}).map(([name,s])=>`<li><b>${esc(name)}</b>: <span class="badge ${STATE_CLASS[s.state]||''}">${esc(s.state)}</span>${s.reason?' '+esc(s.reason):''}</li>`).join('');
 return `<ul class="checks">${st}</ul>${(r.warnings||[]).length?`<p><b>Confirm before approval</b></p>${warn(r.warnings)}`:''}`;
}
