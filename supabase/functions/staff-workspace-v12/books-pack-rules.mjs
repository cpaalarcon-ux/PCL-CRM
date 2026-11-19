// Books set-up pack (Decision 16, 19 Nov 2026): what the chart approver sees next to the chart.
// It gathers the stock settings the client already has (method, count frequency, categories) and the VAT categories sold, per active activity,
// and lists what is still missing. Nothing is guessed or defaulted: a missing setting is a named gap. Pure, used by the server and the tests.
// These packs carry stock; the same list is used by the client readiness count (v3_client_mapping_readiness).
export const STOCK_PACKS=['Wholesale','Retail','Agriculture','Manufacturing','Construction','Hospitality'];
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);

export function booksPack({activities=[],policies=[],categories=[],vatCategories=null,at}){
 const when=day(at);
 const active=activities.filter(a=>day(a.effective_from)<=when&&(!a.effective_to||day(a.effective_to)>=when));
 const rows=active.map(a=>{
  const needs=STOCK_PACKS.includes(a.pack_code);
  const mine=policies.filter(p=>p.activity_id===a.activity_id).sort((x,y)=>day(y.effective_from).localeCompare(day(x.effective_from)));
  const inForce=mine.find(p=>day(p.effective_from)<=when)||null;
  const cats=categories.filter(c=>c.activity_id===a.activity_id||!c.activity_id).map(c=>({inventory_use:c.inventory_use,stock_class:c.stock_class}));
  const gaps=[];
  if(needs){
   if(!inForce)gaps.push(mine.length?`Stock settings for ${a.activity_name} start on ${day(mine[mine.length-1].effective_from)}, after the date this chart applies from`:`Stock update method and count frequency are not set for ${a.activity_name}`);
   if(!cats.length)gaps.push(`No stock categories are set for ${a.activity_name}`);
  }
  return {activity_id:a.activity_id,activity_name:a.activity_name,pack_code:a.pack_code,needs_stock:needs,
   policy:inForce?{inventory_method:inForce.inventory_method,count_frequency:inForce.count_frequency,valuation_basis:inForce.valuation_basis||'',variance_threshold:inForce.variance_threshold,effective_from:day(inForce.effective_from)}:null,
   categories:cats,gaps};
 });
 const stockNeeded=rows.some(r=>r.needs_stock);
 const vat=Array.isArray(vatCategories)?vatCategories:[];
 const gaps=rows.flatMap(r=>r.gaps);
 if(stockNeeded&&!vat.length)gaps.push('VAT categories sold are not set');
 return {as_at:when,stock_needed:stockNeeded,activities:rows,vat_categories_sold:vat,gaps,complete:gaps.length===0,
  // The approver must confirm they looked at the pack whenever the client carries stock.
  acknowledgement_required:stockNeeded};
}

// The set-up step "stock" is done when no active activity carries stock, or every one that does has its settings and categories.
export const stockStepDone=pack=>!pack.stock_needed||pack.activities.filter(r=>r.needs_stock).every(r=>!r.gaps.length);

// Approving a chart while stock settings are missing is allowed (never a hard block), with a reason. The reason and the missing list are kept
// on the approved version's review note in a fixed form, so everyone who can read the chart can read the warning afterwards.
export const PROVISIONAL_MARK='[Stock settings provisional]';
export const PROVISIONAL_MIN=10,PROVISIONAL_MAX=500;
export const cleanReason=v=>String(v||'').replace(/\s+/g,' ').trim();
export function provisionalNote(note,missing,reason){return `${String(note||'').trim()}\n\n${PROVISIONAL_MARK} Reason: ${cleanReason(reason)}\nMissing: ${missing.join('; ')}`;}
export function parseProvisional(reviewNote){
 const m=String(reviewNote||'').match(/\n\n\[Stock settings provisional\] Reason: ([^\n]*)\nMissing: ([^\n]*)$/);
 return m?{reason:m[1],missing:m[2].split('; ').filter(Boolean)}:null;
}
