// Books set-up pack: shown beside the client chart so the approver sees the stock settings and VAT categories in one place.
// Pure HTML builders; the data comes from v3_client_chart_read / v3_books_pack_read (books-pack-rules.mjs on the server).
// Missing stock settings are a warning, never a block: the approver can still approve by giving a reason (see approvalModalHtml).
export function missingItems(pack){
 const out=[];
 for(const r of (pack?.activities||[])){
  if(!r.needs_stock)continue;
  const items=[];
  if(!r.policy)items.push('Stock update method','Count frequency');
  if(!(r.categories||[]).length)items.push('Stock categories');
  if(items.length)out.push({activity:r.activity_name,items});
 }
 if(pack?.stock_needed&&!(pack.vat_categories_sold||[]).length)out.push({activity:'The client',items:['VAT categories sold']});
 return out;
}
const list=(m,esc)=>`<ul class="plain">${m.map(x=>`<li><b>${esc(x.activity)}</b>: ${x.items.map(esc).join(', ')} not set</li>`).join('')}</ul>`;
// Clear warning at the top of the pack and of the approval screen.
export function booksGapBanner(pack,{esc}){
 const m=missingItems(pack);
 return m.length?`<div class="notice warn full books-gap-banner" role="alert"><p><b>Warning: stock settings are incomplete.</b> You can still approve the chart, but the stock figures stay provisional until these are set:</p>${list(m,esc)}</div>`:'';
}
// What was recorded when an earlier approval went ahead with stock settings missing, shown to the staff who resolve the stock data.
export function provisionalNoteHtml(n,{esc,shortDate}){
 if(!n)return '';
 return `<div class="notice full books-provisional" role="status"><p><b>Approved with stock settings provisional:</b> ${esc(n.reason)} · by ${esc(n.by)}, ${shortDate(n.at)}</p><p class="muted">Missing when approved: ${esc((n.missing||[]).join('; '))}.${n.resolved?' The stock settings are complete now.':' Still to be resolved.'}</p></div>`;
}
export function booksPackHtml(pack,{esc,shortDate,banner=true}){
 if(!pack)return '';
 const rows=(pack.activities||[]).map(r=>{
  if(!r.needs_stock)return `<tr><td>${esc(r.activity_name)}</td><td colspan="4" class="muted">No stock held for this activity</td></tr>`;
  const p=r.policy,cats=(r.categories||[]).map(x=>x.stock_class).join(', ');
  return `<tr><td>${esc(r.activity_name)}</td><td>${p?esc(p.inventory_method):'<b>Not set</b>'}</td><td>${p?esc(p.count_frequency):'<b>Not set</b>'}</td><td>${p?shortDate(p.effective_from):''}</td><td>${cats?esc(cats):'<b>None</b>'}</td></tr>`;
 }).join('');
 const vat=(pack.vat_categories_sold||[]).length?esc(pack.vat_categories_sold.join(', ')):(pack.stock_needed?'<b>Not set</b>':'<span class="muted">Not set (no stock held)</span>');
 const ok=!(pack.gaps||[]).length&&pack.stock_needed?'<p class="info">Stock settings, stock categories and VAT categories are all set.</p>':'';
 return `<details open class="books-pack"><summary>Books set-up pack · stock settings and VAT categories</summary>${banner?booksGapBanner(pack,{esc}):''}${provisionalNoteHtml(pack.provisional_note,{esc,shortDate})}${rows?`<div class="scroll"><table><thead><tr><th>Activity</th><th>Stock update method</th><th>Count frequency</th><th>From</th><th>Stock categories</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">No active activity on the chart date.</p>'}<p>VAT categories sold: ${vat}</p>${ok}<p class="muted">The pack is read from the client's saved settings. Nothing in it is a default or a guess. Approving the chart does not post anything.</p></details>`;
}
export const BOOKS_PACK_CONFIRM='I reviewed the Books set-up pack (stock settings, stock categories and VAT categories) shown with this chart';
export const STOCK_REASON_MIN=10;
// The modal shown when the approver presses Approve while stock settings are missing. Confirm Approval stays disabled until the reason is long enough.
export function approvalModalHtml(pack,{esc}){
 return `<form id="editForm" class="form-grid"><div class="notice warn full" role="alert"><p><b>These stock settings are missing:</b></p>${list(missingItems(pack),esc)}<p>Approval is still allowed. The stock figures stay provisional and the warning is kept on the approved chart for the staff who resolve the stock data.</p></div><label class="full">Reason for approving with these stock settings missing * <small>at least ${STOCK_REASON_MIN} characters</small><textarea name="stock_gap_reason" maxlength="500" minlength="${STOCK_REASON_MIN}" required></textarea></label><button type="submit" class="primary full" id="confirmApproval" disabled>Confirm Approval</button></form>`;
}
// Keeps the button disabled until the trimmed reason has the minimum length.
export function bindReasonGate(root,min=STOCK_REASON_MIN){
 const box=root.querySelector('[name="stock_gap_reason"]'),btn=root.querySelector('#confirmApproval');
 if(!box||!btn)return;
 const sync=()=>{btn.disabled=box.value.replace(/\s+/g,' ').trim().length<min;};
 box.addEventListener('input',sync);sync();
}
