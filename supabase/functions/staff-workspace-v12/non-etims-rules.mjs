// Pure rules for non-eTIMS exception rows: how a chosen basis becomes the stored review details, and how a possible duplicate is found.
export const WINDOW_DAYS=3;           // a bank debit within this many days of the invoice date counts as the same payment
export const MIN_REASON=10;           // characters needed to keep a row that looks like a duplicate
const COST=['Purchases','Expenditure','Non-eTIMS'];
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const cents=v=>Math.round(n(v)*100);
const norm=v=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const dayNo=v=>{const s=String(v||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;return Math.round(Date.parse(s+'T00:00:00Z')/86400000);};
export const grossOf=r=>{const x=r?.normalized||{};return x.gross!==undefined&&x.gross!==''?n(x.gross):n(x.amount)+n(x.vat);};

/** Other rows that look like the same payment as `target`. `others` are the project's live rows (any dataset). */
export function findDuplicates(target,others){
 const t=target.normalized||{},party=norm(t.party),invoice=norm(t.invoice),when=dayNo(t.date),gross=cents(grossOf(target)),net=cents(t.amount);
 const out=[];
 for(const o of others){
  if(o.row_id===target.row_id||o.is_split_parent)continue;
  const x=o.normalized||{},ow=dayNo(x.date);
  if(COST.includes(o.dataset)){
   const sameGross=cents(grossOf(o))===gross&&gross!==0;
   if(!sameGross)continue;
   const sameParty=!!party&&norm(x.party)===party,sameDay=when!==null&&ow===when,sameInvoice=!!invoice&&norm(x.invoice)===invoice;
   if(sameParty&&sameDay)out.push(describe(o,'Same supplier, date and amount'));
   else if(sameInvoice&&sameParty)out.push(describe(o,'Same supplier, invoice number and amount'));
  }else if(o.dataset==='Bank'){
   const debit=cents(x.debit);
   if(!debit||when===null||ow===null||Math.abs(ow-when)>WINDOW_DAYS)continue;
   if(debit===gross||debit===net)out.push(describe(o,'Bank payment of the same amount within '+WINDOW_DAYS+' days'));
  }
 }
 return out.slice(0,10);
}
function describe(o,kind){const x=o.normalized||{};return {row_id:o.row_id,kind,dataset:o.dataset,source_row:o.source_row,party:String(x.party||''),date:String(x.date||'').slice(0,10),reference:String(x.invoice||x.reference||''),amount:o.dataset==='Bank'?n(x.debit):grossOf(o)};}

/** Text kept in the existing legal_basis field so earlier gates (eligibility, posting) keep working. */
export const basisText=(basis)=>`${basis.label} (${basis.basis_code}) — ${basis.legal_reference||'legal reference not yet approved'}`;

/**
 * Review details for a row mapped on an exception basis.
 * `basis` is the chosen row of non_etims_bases; `doc` the linked document (or null); `input` the staff entry.
 */
export function exceptionDetails(basis,input,doc,{matches=[],actor,at}){
 const reference=String(input.evidence_reference||'').trim();
 if(!doc&&reference.length<3)return {error:'Attach the evidence document, or enter the receipt or evidence reference.'};
 const out={legal_category:basis.legal_category,basis_code:basis.basis_code,basis_status:basis.status,legal_basis:basisText(basis),
  evidence:doc?`${doc.file_name}${reference?' · '+reference:''}`:reference,evidence_reference:reference||null,evidence_document_id:doc?.document_id||null};
 if(matches.length){
  const reason=String(input.duplicate_reason||'').trim();
  if(reason.length<MIN_REASON)return {error:`This looks like a duplicate of ${matches.length} other row(s): ${matches.slice(0,3).map(m=>`${m.dataset} row ${m.source_row}`).join(', ')}. Enter a reason of at least ${MIN_REASON} characters to keep it.`,duplicates:matches};
  out.duplicate_override={reason,by:actor,at,matches:matches.map(m=>({row_id:m.row_id,dataset:m.dataset,source_row:m.source_row,kind:m.kind}))};
 }
 return {details:out};
}
