// Ageing of purchase credit notes that have no original invoice yet (Pending information).
// Age runs from the credit note's own date, so a late upload does not make an old credit look new.
// Pure functions: no database. Money is signed as uploaded and rounded to cents.
export const BUCKETS=[{label:'0–30 days',from:0,to:30},{label:'31–60 days',from:31,to:60},{label:'61–90 days',from:61,to:90},{label:'Over 90 days',from:91,to:Infinity}];
export const ALERT_DAYS=30;
const cents=n=>Math.round((Number(n||0)+Number.EPSILON)*100)/100;
const iso=v=>{if(v instanceof Date&&!Number.isNaN(v.getTime()))return v.toISOString().slice(0,10);const s=String(v??'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;};
export function daysBetween(from,to){const a=iso(from),b=iso(to);if(!a||!b)return null;return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);}
export const creditDate=row=>iso(row?.normalized?.date)||iso(row?.period_start)||null;
export const bucketFor=age=>age==null?null:BUCKETS.find(b=>age>=b.from&&age<=b.to)?.label||null;
export function ageingReport(rows,asOf){
 const as=iso(asOf);if(!as)throw new Error('An as-at date is required.');
 const buckets=BUCKETS.map(b=>({label:b.label,count:0,net:0,vat:0,gross:0})),unknown={label:'Date not readable',count:0,net:0,vat:0,gross:0},suppliers=new Map(),out=[];
 for(const r of rows||[]){
  const n=r.normalized||{},date=creditDate(r),age=date?Math.max(0,daysBetween(date,as)):null,label=bucketFor(age),net=cents(n.amount),vat=cents(n.vat),gross=n.gross==null||n.gross===''?cents(net+vat):cents(n.gross);
  const b=buckets.find(x=>x.label===label)||unknown;b.count++;b.net=cents(b.net+net);b.vat=cents(b.vat+vat);b.gross=cents(b.gross+gross);
  const key=(n.party_pin||'')+'|'+(n.party||'Not supplied'),s=suppliers.get(key)||{party:n.party||'Not supplied',pin:n.party_pin||'',count:0,net:0,vat:0,gross:0,oldest_days:0};
  s.count++;s.net=cents(s.net+net);s.vat=cents(s.vat+vat);s.gross=cents(s.gross+gross);if(age!=null&&age>s.oldest_days)s.oldest_days=age;suppliers.set(key,s);
  out.push({rejection_id:r.rejection_id,credit_note:n.invoice||'',credit_date:date,party:n.party||'Not supplied',party_pin:n.party_pin||'',description:n.description||'',net,vat,gross,age_days:age,bucket:label||unknown.label,file_name:r.file_name,sheet_name:r.sheet_name,source_row:r.source_row});
 }
 const all=[...buckets,...(unknown.count?[unknown]:[])],over=out.filter(x=>x.age_days!=null&&x.age_days>ALERT_DAYS);
 return {as_of:as,alert_days:ALERT_DAYS,buckets:all,suppliers:[...suppliers.values()].sort((x,y)=>y.oldest_days-x.oldest_days||x.party.localeCompare(y.party)),rows:out.sort((x,y)=>(y.age_days??-1)-(x.age_days??-1)||String(x.credit_note).localeCompare(String(y.credit_note))),
  overdue:{count:over.length,gross:cents(over.reduce((s,x)=>s+x.gross,0)),oldest_days:over.reduce((m,x)=>Math.max(m,x.age_days),0)}};
}
export const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
// The words that go to the client. The firm sends them; the ERP only prepares and logs them.
export function clientRequestText(clientName,rows,asOf,firmName='our firm'){
 const total=rows.length,gross=cents(rows.reduce((s,r)=>s+(r.gross||0),0)),oldest=rows.reduce((m,r)=>Math.max(m,r.age_days||0),0);
 return `Dear ${clientName||'client'},\n\nWe have ${total} supplier credit note${total===1?'':'s'} (KES ${money(gross)} in total, the oldest dated ${oldest} days ago as at ${asOf}) for which the original purchase invoice number and its date were not shown.\n\nThe tax authority needs each credit note linked to the invoice it reduces before the input VAT can be adjusted correctly. Until then we keep these credit notes outside the VAT working and the books; nothing is posted for them.\n\nPlease fill the last two columns of the attached list (Original invoice number and Original invoice date) and return it, or send the supplier's original invoices. If a credit note belongs to an invoice from an earlier year, give that invoice's number and date as well.\n\nThank you,\n${firmName}`;
}
