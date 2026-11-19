// Books set-up pack: shown beside the client chart so the approver sees the stock settings and VAT categories in one place.
// Pure HTML builders; the data comes from v3_client_chart_read / v3_books_pack_read (books-pack-rules.mjs on the server).
export function booksPackHtml(pack,{esc,shortDate}){
 if(!pack)return '';
 const rows=(pack.activities||[]).map(r=>{
  if(!r.needs_stock)return `<tr><td>${esc(r.activity_name)}</td><td colspan="4" class="muted">No stock held for this activity</td></tr>`;
  const p=r.policy,cats=(r.categories||[]).map(x=>x.stock_class).join(', ');
  return `<tr><td>${esc(r.activity_name)}</td><td>${p?esc(p.inventory_method):'<b>Not set</b>'}</td><td>${p?esc(p.count_frequency):'<b>Not set</b>'}</td><td>${p?shortDate(p.effective_from):''}</td><td>${cats?esc(cats):'<b>None</b>'}</td></tr>`;
 }).join('');
 const vat=(pack.vat_categories_sold||[]).length?esc(pack.vat_categories_sold.join(', ')):(pack.stock_needed?'<b>Not set</b>':'<span class="muted">Not set (no stock held)</span>');
 const gaps=(pack.gaps||[]).length?`<div class="info full" role="status"><p><b>Still to be set before the books are ready:</b></p><ul class="plain">${pack.gaps.map(g=>`<li>${esc(g)}</li>`).join('')}</ul></div>`:(pack.stock_needed?'<p class="info">Stock settings, stock categories and VAT categories are all set.</p>':'');
 return `<details open class="books-pack"><summary>Books set-up pack · stock settings and VAT categories</summary>${rows?`<div class="scroll"><table><thead><tr><th>Activity</th><th>Stock update method</th><th>Count frequency</th><th>From</th><th>Stock categories</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">No active activity on the chart date.</p>'}<p>VAT categories sold: ${vat}</p>${gaps}<p class="muted">The pack is read from the client's saved settings. Nothing in it is a default or a guess. Approving the chart does not post anything.</p></details>`;
}
export const BOOKS_PACK_CONFIRM='I reviewed the Books set-up pack (stock settings, stock categories and VAT categories) shown with this chart';
