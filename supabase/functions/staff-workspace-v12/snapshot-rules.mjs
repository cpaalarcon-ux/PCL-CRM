// Pure helpers for the numbered computation snapshots (20261110274000_computation_snapshots.sql). They only add up and describe what the reviewer was shown:
// no rate, formula or entitlement rule is applied here.

// Source totals by dataset, as recorded in the rows (net = net or amount, VAT, gross). A missing figure is skipped, never treated as zero.
export function sourceTotals(rows){
 const by=new Map();
 for(const r of rows||[]){
  const k=String(r.dataset||'Other');
  if(!by.has(k))by.set(k,{dataset:k,rows:0,net:0,vat:0,gross:0});
  const t=by.get(k);t.rows++;
  const n=r.normalized||{};
  for(const [f,src] of [['net',n.net??n.amount],['vat',n.vat],['gross',n.gross]]){
   const v=Number(src);
   if(src!==null&&src!==undefined&&src!==''&&Number.isFinite(v))t[f]=Math.round((t[f]+v)*100)/100;
  }
 }
 return [...by.values()].sort((a,b)=>a.dataset.localeCompare(b.dataset));
}

// Whether the Tax Lead's written confirmation covers the rates a computation used. A test rate is marked TESTING (never for filing); an approved rate whose
// legal review is not pending is CONFIRMED; anything else is UNCONFIRMED and cannot be recorded as filed.
export function rulesStatus(applied,result){
 if(result?.testing_only||(applied||[]).some(r=>r.approval_scope==='Testing'))return 'TESTING';
 if(!(applied||[]).length)return 'CONFIRMED';
 return applied.every(r=>r.status==='Approved'&&r.legal_review_status!=='Pending')?'CONFIRMED':'UNCONFIRMED';
}

// What is fingerprinted: each source row with its figures and the reviewer's decisions, in a fixed order.
export function rowFingerprint(rows){
 return (rows||[]).map(r=>({id:r.row_id||null,rev:r.revision??null,ds:r.dataset||null,n:r.normalized||null,d:r.decision||null,p:r.deductible_percentage??null,v:r.vat_rate_key||null,i:r.income_treatment||null}))
  .sort((x,y)=>String(x.id).localeCompare(String(y.id)));
}

// What is kept of each rate version.
export function appliedRateSummary(applied){
 return (applied||[]).map(r=>({rate_id:r.rate_id,rate_key:r.rate_key,tax_type:r.tax_type,status:r.status,legal_review_status:r.legal_review_status||null,effective_from:r.effective_from,effective_to:r.effective_to,approval_scope:r.approval_scope||null}));
}
