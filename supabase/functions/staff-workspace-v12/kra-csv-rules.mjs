import {excelDate,money} from './workspace-rules.mjs';
import {sections} from './import-profiles.mjs';
// Build 2831a: KRA VAT auto-populated return CSVs as source evidence. This module only reads and compares; it never writes to a register.
// Invoice numbers and PINs stay as the text the CSV holds (leading zeros are kept). Nothing is guessed: a missing or conflicting classification is a difference for review.
export const SALES_SECTIONS=['B','C','D1','E'],PURCHASE_SECTIONS=['F','G','H','I'];
export const SECTION_LABELS={B:'Section B · 16% sales',C:'Section C · 8% sales',D1:'Section D1 · zero-rated sales',E:'Section E · exempt sales',F:'Section F · 16% purchases',G:'Section G · 8% purchases',H:'Section H · zero-rated purchases',I:'Section I · exempt purchases'};
export const RATE_OF={B:'16%',C:'8%',D1:'0%',E:'Exempt',F:'16%',G:'8%',H:'0%',I:'Exempt'};
export const SECTION_OF_SALES={'16%':'B','8%':'C','0%':'D1',Exempt:'E'};
export const SECTION_OF_PURCHASES={'16%':'F','8%':'G','0%':'H',Exempt:'I'};
// Rounding allowance: the register and KRA may round VAT per line or per total. Net amounts must agree to the cent.
export const RECON_TOLERANCE={net:0.01,vat:1.00};
export const DISPOSITIONS=['Explained','Register to be corrected','Query raised','Accepted difference'];
export const CLEARING=['Explained','Accepted difference'];
const clean=v=>String(v??'').trim();
const up=v=>clean(v).toUpperCase();
const cents=v=>Math.round(Number(v||0)*100);
const rate=r=>r==='16%'?.16:r==='8%'?.08:0;
export function sectionFromName(name){const m=String(name||'').match(/(?:^|[^A-Za-z0-9])SEC_(B|C|D1|E|F|G|H|I)(?:_|\.)/i);return m?m[1].toUpperCase():null;}
export const lineKey=l=>`${up(l.invoice_no)}|${up(l.party_pin)}`;
export function parseKraCsv({rows,section,month}){
 const spec=sections[section];if(!spec)return {lines:[],blocking:[`Section ${section} is not a KRA VAT section.`],warnings:[],totals:{net:0,vat:0,lines:0,credit_lines:0}};
 const blocking=[],warnings=[],lines=[],cols=rows.reduce((n,r)=>Math.max(n,r.length),0),r=RATE_OF[section],seen=new Map();
 if(cols!==spec.columns)blocking.push(`Section ${section} should have ${spec.columns} columns; this file has ${cols}. Download the section again from the KRA VAT auto-populated return and upload it unchanged.`);
 else for(let i=0;i<rows.length;i++){
  const row=rows[i];if(!row.some(v=>clean(v)))continue;const n=i+1,get=k=>spec.map[k]?row[spec.map[k]-1]:null;
  const invoice=clean(get('invoice')),date=excelDate(get('date')),net=money(get('amount'));
  if(!invoice||!date||net===null){blocking.push(`Row ${n}: invoice number, date or amount is missing or not readable.`);continue;}
  let vat=0,derived=false;
  if(spec.map.vat){vat=money(get('vat'));if(vat===null){vat=Math.round(net*rate(r)*100)/100;derived=true;warnings.push(`Row ${n}: VAT was blank, so it is calculated at ${r} and marked as calculated.`);}else if(Math.abs(vat-net*rate(r))>1.00)warnings.push(`Row ${n}: VAT ${vat.toFixed(2)} does not equal ${r} of ${net.toFixed(2)}. Check the section or the amounts.`);}
  const original=clean(get('original_invoice'))||null,credit=net<0||!!original;
  if(original&&net>0)warnings.push(`Row ${n}: credit note ${invoice} against ${original} has a positive amount. Confirm the sign with the client.`);
  if(date.slice(0,7)!==month)warnings.push(`Row ${n}: ${invoice} is dated ${date}, outside ${month}.`);
  const line={line_no:n,invoice_no:invoice,original_invoice:original,invoice_date:date,party_pin:clean(get('party_pin'))||null,party_name:clean(get('party'))||null,description:clean(get('description'))||null,net:Math.round(net*100)/100,vat:Math.round(vat*100)/100,vat_derived:derived,vat_category:r,document_type:credit?'Credit note':'Invoice',raw:row.map(v=>String(v??''))};
  const k=lineKey(line),f=JSON.stringify([line.net,line.vat,line.invoice_date]);
  if(seen.has(k))warnings.push(seen.get(k)===f?`Row ${n}: ${invoice} appears more than once with the same amounts.`:`Row ${n}: ${invoice} appears more than once with different amounts.`);else seen.set(k,f);
  lines.push(line);
 }
 if(!blocking.length&&!lines.length)blocking.push('The file has no transaction lines. If the section is empty for this month, there is nothing to retain.');
 const t={net:0,vat:0,lines:lines.length,credit_lines:0};for(const l of lines){t.net+=cents(l.net);t.vat+=cents(l.vat);if(l.document_type==='Credit note')t.credit_lines++;}
 t.net/=100;t.vat/=100;
 return {lines,blocking,warnings,totals:t};
}
// What changed between two versions of the same section and month. Keyed by invoice number and PIN.
export function compareVersions(before,after){
 const index=ls=>{const m=new Map();for(const l of ls){const k=lineKey(l);m.set(k,[...(m.get(k)||[]),l]);}return m;},b=index(before),a=index(after);
 const added=[],removed=[],changed=[];let unchanged=0;
 for(const [k,ls] of a){const old=b.get(k);if(!old){added.push(...ls);continue;}
  ls.forEach((l,i)=>{const o=old[i];if(!o){added.push(l);return;}const fields=[];if(cents(o.net)!==cents(l.net))fields.push('net');if(cents(o.vat)!==cents(l.vat))fields.push('vat');if(String(o.invoice_date).slice(0,10)!==String(l.invoice_date).slice(0,10))fields.push('date');
   if(fields.length)changed.push({key:k,fields,before:o,after:l});else unchanged++;});
  if(old.length>ls.length)removed.push(...old.slice(ls.length));}
 for(const [k,ls] of b)if(!a.has(k))removed.push(...ls);
 return {added,removed,changed,unchanged};
}
const sumCents=(ls,f)=>ls.reduce((n,l)=>n+cents(l[f]),0);
// Sales: the approved sales register holds category totals by month, so the CSV is reconciled by VAT category. An absent section is "not uploaded", never zero.
export function reconcileSales({uploaded,groups,month}){
 const out=[],differences=[];
 for(const category of ['16%','8%','0%','Exempt']){
  const section=SECTION_OF_SALES[category],batch=uploaded[section],g=groups.filter(x=>x.vat_category===category);
  const reg={net:g.reduce((n,x)=>n+cents(x.net),0),vat:g.reduce((n,x)=>n+cents(x.vat),0),present:g.length>0};
  const row={category,section,uploaded:!!batch,version:batch?.version||null,lines:batch?.lines.length||0,register_net:reg.net/100,register_vat:reg.vat/100,register_present:reg.present};
  if(!batch){row.status='CSV not uploaded';out.push(row);continue;}
  const net=sumCents(batch.lines,'net'),vat=sumCents(batch.lines,'vat');row.csv_net=net/100;row.csv_vat=vat/100;row.difference_net=(net-reg.net)/100;row.difference_vat=(vat-reg.vat)/100;
  if(!reg.present&&(net!==0||vat!==0))row.status='No register';
  else row.status=Math.abs(row.difference_net)<=RECON_TOLERANCE.net&&Math.abs(row.difference_vat)<=RECON_TOLERANCE.vat?'Agrees':'Differs';
  if(row.status!=='Agrees')differences.push({scope_key:`category:${category}`,kind:row.status==='No register'?'CSV has sales but the register has none':'Category total differs',category,section,csv_net:row.csv_net,csv_vat:row.csv_vat,register_net:row.register_net,register_vat:row.register_vat,difference_net:row.difference_net,difference_vat:row.difference_vat,evidence_key:`${section}v${batch.version}:${net}:${vat}:${reg.net}:${reg.vat}`});
  out.push(row);
 }
 const missing=out.filter(r=>!r.uploaded).map(r=>r.section);
 const status=differences.length?'Differs':missing.length===4?'No CSV uploaded':missing.length?'Incomplete':'Agrees';
 return {month,status,categories:out,differences,missing_sections:missing};
}
// Purchases: the CSV is matched to the supplier invoices already in the purchases register, by invoice number and supplier PIN.
export function matchPurchases({uploaded,rows,month}){
 const csv=PURCHASE_SECTIONS.flatMap(s=>(uploaded[s]?.lines||[]).map(l=>({...l,section:s,version:uploaded[s].version}))),differences=[],register=rows.filter(r=>String(r.date||'').slice(0,7)===month);
 const byKey=new Map(),byInvoice=new Map(),used=new Set();
 for(const r of register){const k=`${up(r.invoice)}|${up(r.party_pin)}`;byKey.set(k,[...(byKey.get(k)||[]),r]);byInvoice.set(up(r.invoice),[...(byInvoice.get(up(r.invoice))||[]),r]);}
 let matched=0;const evidence=l=>`${l.section}v${l.version}`;
 for(const l of csv){
  const k=lineKey(l);let cand=(byKey.get(k)||[]).find(r=>!used.has(r.row_id)),pinNote=null;
  if(!cand){const inv=(byInvoice.get(up(l.invoice_no))||[]).filter(r=>!used.has(r.row_id)&&(!clean(r.party_pin)||!clean(l.party_pin)));if(inv.length===1){cand=inv[0];pinNote='The supplier PIN is missing on one side, so this was matched on the invoice number only.';}}
  const base={scope_key:`line:${k}`,invoice:l.invoice_no,party_pin:l.party_pin,party:l.party_name,section:l.section,csv_net:l.net,csv_vat:l.vat,csv_category:l.vat_category};
  if(!cand){differences.push({...base,kind:'In KRA CSV, no supplier invoice',evidence_key:`${evidence(l)}:${cents(l.net)}:${cents(l.vat)}:none`});continue;}
  used.add(cand.row_id);matched++;
  const rn=cents(cand.amount),rv=cents(cand.vat??0),full={...base,register_net:cand.amount,register_vat:cand.vat??0,register_category:cand.vat_category||null,row_id:cand.row_id},ev=`${evidence(l)}:${cents(l.net)}:${cents(l.vat)}:${rn}:${rv}:${cand.vat_category||''}`;
  if(pinNote)differences.push({...full,kind:'Matched on invoice number only',detail:pinNote,evidence_key:ev});
  if(Math.abs(cents(l.net)-rn)>RECON_TOLERANCE.net*100)differences.push({...full,kind:'Net amount differs',evidence_key:ev});
  if(Math.abs(cents(l.vat)-rv)>RECON_TOLERANCE.vat*100)differences.push({...full,kind:'VAT amount differs',evidence_key:ev});
  if(!cand.vat_category||cand.vat_category==='Unconfirmed')differences.push({...full,kind:'Classification missing on the supplier invoice',detail:`The KRA CSV lists it in ${SECTION_LABELS[l.section]}. The ERP does not take the category from the CSV, the supplier or the rate: confirm it.`,evidence_key:ev});
  else if(cand.vat_category!==l.vat_category)differences.push({...full,kind:'Classification conflict',detail:`The register says ${cand.vat_category}; KRA lists it in ${SECTION_LABELS[l.section]} (${l.vat_category}).`,evidence_key:ev});
 }
 const anyUploaded=PURCHASE_SECTIONS.some(s=>uploaded[s]);
 for(const r of register){if(used.has(r.row_id)||!anyUploaded)continue;
  const sec=SECTION_OF_PURCHASES[r.vat_category],covered=sec?!!uploaded[sec]:true;
  if(covered)differences.push({scope_key:`line:${up(r.invoice)}|${up(r.party_pin)}`,kind:'Supplier invoice not in KRA CSV',invoice:r.invoice,party_pin:r.party_pin,party:r.party,register_net:r.amount,register_vat:r.vat??0,register_category:r.vat_category||null,row_id:r.row_id,detail:sec?`Not found in ${SECTION_LABELS[sec]}.`:'The invoice has no confirmed VAT category.',evidence_key:`reg:${r.row_id}:${cents(r.amount)}:${cents(r.vat??0)}:${r.vat_category||''}:${PURCHASE_SECTIONS.map(s=>uploaded[s]?.version||0).join('')}`});}
 const categories=['16%','8%','0%','Exempt'].map(category=>{const section=SECTION_OF_PURCHASES[category],b=uploaded[section],regs=register.filter(r=>r.vat_category===category);return {category,section,uploaded:!!b,version:b?.version||null,lines:b?.lines.length||0,csv_net:b?sumCents(b.lines,'net')/100:null,csv_vat:b?sumCents(b.lines,'vat')/100:null,register_net:regs.reduce((n,r)=>n+cents(r.amount),0)/100,register_vat:regs.reduce((n,r)=>n+cents(r.vat??0),0)/100,register_lines:regs.length};});
 const missing=PURCHASE_SECTIONS.filter(s=>!uploaded[s]);
 return {month,status:differences.length?'Differs':missing.length===4?'No CSV uploaded':missing.length?'Incomplete':'Agrees',matched,csv_lines:csv.length,register_lines:register.length,categories,differences,missing_sections:missing};
}
// A reviewer's decision stands only while the evidence it was made on is unchanged. A new CSV version or a changed register reopens the difference.
export function applyReviews(differences,reviews){
 const latest=new Map();for(const r of [...reviews].sort((a,b)=>String(a.reviewed_at).localeCompare(String(b.reviewed_at))))latest.set(`${r.scope_key}|${r.evidence_hash}`,r);
 const out=differences.map(d=>{const r=latest.get(`${d.scope_key}|${d.evidence_key}`)||null;return {...d,review:r?{disposition:r.disposition,reason:r.reason,reviewed_by:r.reviewed_by_name||null,reviewed_at:r.reviewed_at}:null,cleared:!!r&&CLEARING.includes(r.disposition)};});
 return {differences:out,open:out.filter(d=>!d.cleared).length,cleared:out.filter(d=>d.cleared).length};
}
