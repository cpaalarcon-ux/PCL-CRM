import {fail} from './validation.mjs';
import {excelValue,excelDate,money} from './workspace-rules.mjs';
// Header aliases describe workbook versions, not inferred tax eligibility.
const norm=v=>String(v??'').trim().replace(/\s+/g,' ').toUpperCase();
const aliases={
 purchase_type:['TYPE OF PURCHASES','TYPE'],party_pin:['PIN OF SUPPLIER','SUPPLIER PIN'],party:['NAME OF SUPPLIER','SUPPLIER NAME','SUPPLIER','PAYEE / SUPPLIER'],
 date:['INVOICE DATE','INV DATE','DATE'],invoice:['INVOICE NO.','INV NUMBER','INVOICE / UID','DOCUMENT REFERENCE'],description:['DESCRIPTION'],
 customs_entry:['CUSTOMS ENTRY NO.','C.E NO.'],amount:['TAXABLE VALUE','NET COST','GROSS AMOUNT'],vat:['VAT AMOUNT','INPUT VAT CLAIM'],
 original_invoice:['ORIGINAL INVOICE NUMBER','RELEVANT INVOICE NUMBER'],original_invoice_date:['ORIGINAL INVOICE DATE','RELEVANT INVOICE DATE'],import_type:['TYPE OF IMPORT'],
 gross:['GROSS'],route:['ROUTING CODE'],category_code:['CLASS / CATEGORY CODE'],return_code:['RETURN CODE'],tb_code:['TB CODE'],
 pl_group:['P&L GROUP'],source_status:['REVIEW STATUS','STATUS'],return_month:['RETURN MONTH','MONTH INCURRED'],source:['SOURCE'],
 vat_treatment:['VAT TREATMENT'],evidence:['EVIDENCE','EVIDENCE FILE / REFERENCE'],reviewer:['REVIEWER'],tax_treatment:['FILING TREATMENT','TAX TREATMENT'],
 pin_country:['PIN / COUNTRY'],legal_category:['LEGAL NON-ETIMS CATEGORY'],legal_basis:['LEGAL BASIS / EVIDENCE'],line_id:['LINE ID','LINE NO.']
};
export const legalCategories=['Payroll/wages','Bank charge','Interest','Import','Passenger ticket','Financial-institution fee','Buyer-issued invoice','Final withholding tax expense','Other supported exception'];
export const workbookCategories=[
 ['STOCK',1,'Resalable goods / inventory'],
 ...['Operating expenditure','Administrative expenditure','Employment expenditure','Finance cost','Other expenditure','Import / customs cost','Professional service / WHT','Bank charge','Exception / reviewer decision'].map((label,i)=>['EXP0'+(i+1),2,label]),
 ...Object.entries({PPE00:'Land / non-depreciable',PPE10B:'Commercial / educational building',PPE50Q:'Qualifying building / machinery / hospital asset',PPE25V:'Motor vehicle / heavy equipment',PPE25C:'Computer / copier',PPE25S:'Qualifying computer software',PPE10M:'Furniture / telecom / other machinery',PPE50F:'Farmworks',PPER:'Special / restricted investment'}).map(([code,label])=>[code,3,label])
].map(([code,route,label])=>({code,route,label,kind:'Purchase',group:'Workbook internal code'}));
export const sheetValues=(sheet,i)=>Array.from({length:sheet.columnCount},(_,c)=>excelValue(sheet.getRow(i).getCell(c+1).value));
function mapHeaders(headers){const m={};for(const [k,names] of Object.entries(aliases)){const col=headers.findIndex(h=>names.includes(norm(h)));if(col>=0)m[k]=col+1;}return m;}
const formula=c=>!!(c&&typeof c==='object'&&(c.formula||c.sharedFormula));
const filled=v=>v!==''&&v!==null&&v!==undefined&&v!==0;
export function detectTemplate(sheet){
 const sourceName=sheet.name.split(' :: ').at(-1);
 let kind=/^B02[A-D]\b/i.test(sourceName)?'B02':/^B03\b/i.test(sourceName)?'B03':/^D09\b/i.test(sourceName)?'D09':null;
 if(!kind&&sheet.columnCount===16)for(let i=1;i<=Math.min(sheet.rowCount,10);i++){const m=mapHeaders(sheetValues(sheet,i));if(['return_month','party','pin_country','date','invoice','description','amount','legal_category','legal_basis','evidence'].every(k=>m[k])){kind='D09';break;}}
 if(!kind)return null;
 const required=kind==='B02'?['purchase_type','party','party_pin','date','invoice','amount','vat']:kind==='B03'?['return_month','invoice','party','date','amount','route','evidence']:['return_month','party','pin_country','date','invoice','description','amount','legal_category','legal_basis','evidence'];
 const found=[];
 for(let i=1;i<=sheet.rowCount;i++){
  // Stop before the B03 linked feed (which uses B02 headings).
  const vals=sheetValues(sheet,i),map=mapHeaders(vals);
  if(kind==='B03'&&found.length&&(map.purchase_type||norm(vals[0]).includes('LINKED B02')))break;
  if(required.every(k=>map[k])){
   // Purchase routing and category are entered in the ERP. Old workbook K/P
   // values remain in source evidence only and are not imported mappings.
   if(kind==='B02'){delete map.route;delete map.category_code;}
   found.push({header_row:i,column_map:map,headers:vals.slice(0,kind==='B03'?15:kind==='D09'?16:sheet.columnCount)});if(kind!=='B02')break;
  }
 }
 if(!found.length)fail(400,`${sheet.name}: expected workbook headers are missing. Restore the original B02, B03 or D09 template headings.`);
 let blocks=found.map((f,j)=>{
  let last=(found[j+1]?.header_row??sheet.rowCount+1)-1;
  if(kind==='B03')for(let i=f.header_row+1;i<=last;i++){
   const vals=sheetValues(sheet,i),m=mapHeaders(vals);
   if(m.purchase_type||norm(vals[0]).includes('LINKED B02')||['invoice','party','date','amount'].some(k=>formula(sheet.getRow(i).getCell(f.column_map[k]).value))){last=i-1;break;}
  }
  let period=null;
  if(kind==='B02')for(let i=Math.max(1,f.header_row-2);i<f.header_row;i++){const vals=sheetValues(sheet,i);if(/MONTH/i.test(String(vals[0]))){period=excelDate(vals[1]);if(period)break;}}
  return {...f,first_row:f.header_row+1,last_row:last,period_start:period?period.slice(0,8)+'01':null,period_end:period?new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5,7)),0)).toISOString().slice(0,10):null};
 });
 return {kind,source_sheet:sheet.name,source_sheet_name:sourceName,dataset:kind==='B02'?'Purchases':kind==='B03'?'Expenditure':'Non-eTIMS',blocks};
}
export function templateRow(sheet,i,template,block){
 const vals=sheetValues(sheet,i),m=block.column_map;
 // Source identity/amount must be directly entered. Linked schedules and placeholders never create transactions.
 if(['invoice','party','date','amount'].some(k=>m[k]&&formula(sheet.getRow(i).getCell(m[k]).value)))return null;
 const core=['invoice','party','date','amount'].map(k=>vals[m[k]-1]);
 if(!core.some(filled))return null;
 const first=norm(vals[0]);
 if(/^(VAT CLAIM MONTH|TOTAL(?:\s|$)|SUBTOTAL(?:\s|$)|GRAND TOTAL(?:\s|$))/.test(first)||mapHeaders(vals).purchase_type)return null;
 return vals;
}
export function normalizeTemplate(values,template,block,start,end){
 const m=block.column_map,raw=Object.fromEntries(block.headers.map((header,i)=>[`${i+1}: ${header}`,values[i]??'']));
 const get=k=>m[k]?values[m[k]-1]??'':'';
 const row={};for(const k of Object.keys(m)){
  if(template.kind==='B02'&&['route','category_code'].includes(k))continue;
  row[k]=['amount','vat','gross'].includes(k)?money(get(k)):['date','original_invoice_date','return_month'].includes(k)?excelDate(get(k)):String(get(k)).trim();
 }
 const issues=[];if(!row.date)issues.push('Invoice / document date is missing or invalid.');
 if(!row.invoice)issues.push('Invoice / document reference is required.');if(!row.party)issues.push('Supplier / payee is required.');
 if(row.amount===null)issues.push('Amount is missing or invalid.');if(m.vat&&get('vat')!==''&&row.vat===null)issues.push('VAT amount is invalid.');
 if(get('original_invoice_date')!==''&&!row.original_invoice_date)issues.push('Original invoice date is invalid.');
 if(row.original_invoice_date&&row.date&&row.original_invoice_date>row.date)issues.push('Original invoice date cannot be later than this document date.');
 if(get('return_month')!==''&&!row.return_month)issues.push('Return / incurred month is invalid.');
 if(template.kind==='B02'&&row.party_pin&&!/^[A-Z]\d{9}[A-Z]$/i.test(row.party_pin))issues.push('Supplier PIN format is invalid.');
 // Claim month is independent of invoice date in these workbooks. A prior invoice remains a review item.
 row.return_month=template.kind==='B02'?block.period_start:row.return_month;
 const period=row.return_month||row.date;if(period&&(period<start||period>end))issues.push('Return / incurred month is outside the selected period.');
 row.template_kind=template.kind;row.source_sheet=template.source_sheet;
 if(template.kind==='B02'&&/^B02B\b/i.test(template.source_sheet_name||template.source_sheet))row.legacy_tax_review=true;
 const line=row.line_id||[row.description||'',row.customs_entry||'',row.purchase_type||''].map(norm).join('|');
 const key=JSON.stringify([norm(row.invoice),norm(row.party_pin)||norm(row.party),line]);
 const route=template.kind==='B02'?null:2;
 const category=template.kind==='B02'?null:row.category_code||workbookCategories.find(c=>c.route===route&&norm(c.label)===norm(row.pl_group))?.code||null;
 const valid=workbookCategories.some(c=>c.route===route&&c.code===category);
 return {raw,row,issues,key,route:[1,2,3].includes(route)?route:null,category_code:valid?category:null,narration:row.description||null};
}
// Imported classifications are suggestions. Neither an uploaded reviewer name nor a formula grants approval.
export function rowWarnings(row){
 const n=row.normalized||{},details=row.review_details||{},out=[];
 if(['Purchases','Expenditure','Non-eTIMS'].includes(row.dataset)){
  if(!row.route||!row.category_code||!row.account_code)out.push('Missing detailed account classification');
  if(row.route===3&&!row.asset_details)out.push('Missing asset description / use');
  if(row.dataset==='Non-eTIMS'){
   if(!(details.legal_category||n.legal_category))out.push('Missing legal category');
   if(!(details.legal_basis||n.legal_basis))out.push('Missing legal basis');
   if(!(details.evidence||n.evidence))out.push('Missing receipt / evidence reference');
   out.push('Tax reviewer confirmation required — no automatic exclusion or VAT claim');
  }
  if(n.legacy_tax_review)out.push('Legacy 8% source — reviewer must confirm the applicable period and treatment');
  if(n.date&&n.return_month&&n.date.slice(0,7)!==n.return_month.slice(0,7)){
   const invoiceMonth=n.date.slice(0,7),claimMonth=n.return_month.slice(0,7);
   if(claimMonth<invoiceMonth)out.push('Selected client VAT reporting month precedes the invoice month — check the reporting month and supply timing before input VAT review.');
   else out.push('Invoice date and client VAT reporting month differ — reviewer must establish the actual supply tax period, required documents and supplier declaration, then check whether Section 17(2)’s six-month proviso applies. The six-month period runs from the end of the supply tax period; invoice month alone does not decide it.');
  }
  if(n.template_kind==='B02'&&!n.party_pin)out.push('Missing supplier PIN — review source');
 }
 return out;
}
