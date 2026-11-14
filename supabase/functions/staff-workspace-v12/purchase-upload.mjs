import {excelValue,excelDate,money} from './workspace-rules.mjs';
import {fail} from './validation.mjs';

export const purchaseUploadId='PCL-PURCHASES-1';
export const purchaseUploadHeaders=['Type of purchases','Supplier PIN','Supplier name','Invoice date','Invoice number','Description','Customs entry number','Net amount','VAT amount','Gross amount','Original invoice number','Original invoice date','ERP routing code','ERP TB item code'];
export const purchaseUploadLegacyHeaders=purchaseUploadHeaders.slice(0,12);
export const purchaseUploadMap={purchase_type:1,party_pin:2,party:3,date:4,invoice:5,description:6,customs_entry:7,amount:8,vat:9,gross:10,original_invoice:11,original_invoice_date:12,routing_code:13,tb_code:14};
export const purchaseUploadRates=['16%','8%','0%','Exempt'];
const clean=v=>String(v??'').trim(),norm=v=>clean(v).replace(/\s+/g,' ').toUpperCase();
const optional=v=>/^(?:n\/?a|not applicable|—|-)$/i.test(clean(v))?'':v;
export const purchaseDate=v=>excelDate(typeof v==='string'&&/^\d{5}(?:\.0+)?$/.test(v.trim())?Number(v):v);
export const purchaseDisplayValues=values=>values.map((v,i)=>{if(![3,11].includes(i))return v;const d=purchaseDate(optional(v));return d?d.slice(8,10)+'/'+d.slice(5,7)+'/'+d.slice(0,4):optional(v);});
export const purchasePendingMatch=row=>Object.fromEntries(['purchase_type','party_pin','party','date','invoice','description','customs_entry','amount','vat','gross','vat_category','return_month'].map(k=>[k,row[k]]));
// The firm's source purchase layout (one layout for every VAT category): TYPE OF PURCHASE, PIN, NAME, INVOICE DATE, INVOICE NO.,
// DESCRIPTION, CUSTOM ENTRY NUMBER, TAXABLE VALUE, RELV INV NUMBER, RELV INV DATE, ROUTING CODE, T.B CODE. It has a title row above the
// headings and no VAT or gross columns. Columns are found by their headings, so the zero-rated and exempt variants (which drop or rename a
// column) read the same way. The values are rearranged into the 14 standard positions; VAT and gross are left blank and are calculated
// from the VAT category chosen at upload.
export const purchaseSourceLayoutId='PCL-PURCHASES-SOURCE-1';
const sourceAliases={purchase_type:['TYPE OF PURCHASE','TYPE'],party_pin:['PIN OF PURCHASER','PIN OF SUPPLIER','SUPPLIER PIN'],party:['NAME OF PURCHASER','NAME OF SUPPLIER','SUPPLIER NAME'],date:['INVOICE DATE'],invoice:['INVOICE NO.','INVOICE NO','INVOICE NUMBER'],description:['DESCRIPTION OF GDS/SRVS','DESCRIPTION OF GOODS/SERVICES','DESCRIPTION'],customs_entry:['CUSTOM ENTRY NUMBER','CUSTOM ENTRY NO.','CUSTOM ENTRY NO','CUSTOMS ENTRY NUMBER'],amount:['TAXABLE VALUE'],original_invoice:['RELV INV NUMBER'],original_invoice_date:['RELV INV DATE'],routing_code:['ROUTING CODE'],tb_code:['T.B CODE','TB CODE']};
export function purchaseSourceLayout(sheet){
 for(let r=1;r<=Math.min(3,sheet.rowCount);r++){
  const titles=Array.from({length:Math.min(sheet.columnCount,20)},(_,j)=>norm(excelValue(sheet.getRow(r).getCell(j+1).value))),cols={};
  for(const [key,names] of Object.entries(sourceAliases)){const hits=titles.map((v,i)=>names.includes(v)?i+1:0).filter(Boolean);if(hits.length===1)cols[key]=hits[0];}
  if(['party_pin','party','date','invoice','amount'].every(k=>cols[k]))return {header_row:r,cols};
 }
 return null;
}
export const purchaseUploadValues=(sheet,i,layout)=>{
 if(!layout)return Array.from({length:14},(_,j)=>excelValue(sheet.getRow(i).getCell(j+1).value));
 const at=k=>layout.cols[k]?excelValue(sheet.getRow(i).getCell(layout.cols[k]).value):'';
 return [at('purchase_type'),at('party_pin'),at('party'),at('date'),at('invoice'),at('description'),at('customs_entry'),at('amount'),'','',at('original_invoice'),at('original_invoice_date'),at('routing_code'),at('tb_code')];
};
export function purchaseUploadProfile(sheet,required=false){
 const titles=purchaseUploadValues(sheet,1),matches=titles.filter((v,i)=>norm(v)===norm(purchaseUploadHeaders[i])).length;
 if(matches<6){const layout=purchaseSourceLayout(sheet);if(layout)return {recognised:true,id:purchaseUploadId,name:'Purchase source layout (net amounts, all VAT categories)',dataset:'Purchases',header_row:layout.header_row,column_map:purchaseUploadMap,fixed_columns:true,version:3,source_layout:true,layout,derive_vat:true};}
 if(!required&&matches<6&&!/^Purchase Upload$/i.test(sheet.name.split(' :: ').at(-1)))return null;
 const legacy=sheet.columnCount<=12&&purchaseUploadLegacyHeaders.every((h,i)=>norm(titles[i])===norm(h));
 if(sheet.columnCount>14)fail(400,'The standard purchase template has 14 columns, A–N. Remove columns after N.');
 const expected=legacy?purchaseUploadLegacyHeaders:purchaseUploadHeaders;
 for(let i=0;i<expected.length;i++)if(norm(titles[i])!==norm(expected[i]))fail(400,`Column ${String.fromCharCode(65+i)} must be "${expected[i]}" in row 1. Download the standard purchase template and do not move columns.`);
 if(!legacy&&sheet.columnCount<14)fail(400,'The standard purchase template needs all 14 columns, A–N. Download the updated template.');
 return {recognised:true,id:purchaseUploadId,name:'Standard purchase upload',dataset:'Purchases',header_row:1,column_map:purchaseUploadMap,fixed_columns:true,version:legacy?1:2};
}
export function purchaseUploadRows(sheet,profile){
 const rows=[],layout=profile?.layout||null;let ignored=0;
 for(let i=(profile?.header_row||1)+1;i<=sheet.rowCount;i++){const values=purchaseUploadValues(sheet,i,layout);if(!values.some(v=>clean(v))){ignored++;continue;}rows.push({source_row:i,values});}
 if(rows.length>10000)fail(400,`This file contains ${rows.length.toLocaleString('en-US')} populated purchase rows. The limit is 10,000 per upload. Split the transactions into separate files, each keeping row 1 as the header.`);
 return {rows,ignored,derive_vat:!!layout};
}
export function normalizePurchaseUpload(values,rate,start,end,accounts=[],clientMappings,deriveVat=false){
 if(!purchaseUploadRates.includes(rate))fail(400,'Select the VAT category in the ERP: 16%, 8%, 0% or Exempt. Use one category per upload.');
 if(deriveVat){
  // Net-only source layout: VAT and gross are worked out from the category chosen at upload, never read from the file.
  values=[...values];const net=money(values[7]);
  if(net!==null){const pct=['16%','8%'].includes(rate)?parseInt(rate):0,vat=Math.sign(net)*Math.round(Math.abs(net)*pct)/100;values[8]=vat;values[9]=Math.round((Math.round(net*100)+Math.round(vat*100)))/100;}
 }
 const raw=Object.fromEntries(purchaseUploadHeaders.map((h,i)=>[`${i+1}: ${h}`,values[i]??''])),row={},issues=[],pending=[],rounded=[];
 for(const [key,col] of Object.entries(purchaseUploadMap)){const value=[7,11,12,13,14].includes(col)?optional(values[col-1]??''):values[col-1]??'';row[key]=['amount','vat','gross'].includes(key)?money(value):['date','original_invoice_date'].includes(key)?purchaseDate(value):clean(value);}
 row.party_pin=row.party_pin.toUpperCase();row.vat_category=rate;row.source_profile=purchaseUploadId;row.return_month=start;row.vat_basis=deriveVat?'Calculated from the selected category rate':'Supplied';
 if(!['LOCAL','IMPORT','IMPORTS','IMPORTED'].includes(norm(row.purchase_type)))issues.push('Column A: choose Local or Import.');
 if(!/^[A-Z]\d{9}[A-Z]$/.test(row.party_pin))issues.push('Column B: enter a valid supplier PIN.');
 if(!row.party)issues.push('Column C: supplier name is required.');
 if(!row.date||row.date>end)issues.push('Column D: enter a valid document date no later than the selected period end.');
 for(const [key,col] of [['invoice',5],['original_invoice',11]])if(typeof values[col-1]==='number')issues.push(`Column ${String.fromCharCode(64+col)}: paste invoice references as text to preserve leading zeros.`);
 if(!row.invoice)issues.push('Column E: invoice or credit-note number is required.');
 if(!row.description)issues.push('Column F: purchase description is required.');
 row.routing_code=row.routing_code?String(row.routing_code).trim():'';row.tb_code=row.tb_code?String(row.tb_code).trim():'';
 // A routing code on its own (column M) is a valid key: the client's approved routing map chooses the account. A TB item code on its own is not.
 if(!row.routing_code&&row.tb_code)row.mapping_suggestion_issue='Enter the ERP routing code (M) with the ERP TB item code (N), or leave both blank.';
 else if(row.routing_code&&!row.tb_code){const routingCode=row.routing_code.toUpperCase();if(!/^[A-Z][A-Z0-9_]{1,29}$/.test(routingCode))row.mapping_suggestion_issue='Column M must be a routing code such as EXP01.';else row.routing_code=routingCode;}
 else if(row.routing_code||row.tb_code){
  const routingCode=String(row.routing_code).trim().toUpperCase(),code=String(row.tb_code).trim();
  if(!/^[A-Z][A-Z0-9]{1,9}$/.test(routingCode)||!/^\d{5}$/.test(code))row.mapping_suggestion_issue='Columns M and N must contain an ERP routing category code and a five-digit TB item code.';
  else {const activeAccount=accounts.find(x=>String(x.code)===code&&x.status==='Active'&&!x.is_legacy&&[1,2,3].includes(Number(x.route))),account=activeAccount&&String(activeAccount.category_code||'').toUpperCase()===routingCode?activeAccount:null;
   // M/N are ERP-controlled routing and TB codes. If both match the active
   // master account, keep them as a suggestion for explicit staff confirmation.
   // Client source-account mappings remain a separate control for opening TBs.
   if(account)row.mapping_suggestion={route:Number(account.route),category_code:account.category_code,account_code:account.code,confirmed:false};
   else if(activeAccount)row.mapping_suggestion_issue=`Routing code ${routingCode} does not match ERP TB item code ${code}. This TB account uses routing code ${activeAccount.category_code}; correct column M or N.`;
   else row.mapping_suggestion_issue='The uploaded routing code and TB item code do not match an active ERP account. Select a valid account in the mapping screen.';
  }
 }
 for(const [key,col] of [['amount','H'],['vat','I'],['gross','J']])if(row[key]===null)issues.push(`Column ${col}: enter a valid ${key==='amount'?'net amount':key+' amount'}. Use an explicit zero where applicable.`);
 if(row.amount===0)issues.push('Column H: net amount cannot be zero.');
 if(row.vat!==null&&['0%','Exempt'].includes(rate)&&row.vat!==0)issues.push('Column I: VAT must be zero for the selected zero-rated or exempt category.');
 if(row.amount!==null&&row.vat!==null&&row.amount*row.vat<0)issues.push('Columns H and I: net and VAT must have the same sign.');
 if(row.amount!==null&&row.vat!==null){
  const expected=(Math.round(row.amount*100)+Math.round(row.vat*100))/100;
  row.calculated_gross=expected;row.gross_difference=row.gross===null?null:(Math.round(row.gross*100)-Math.round(expected*100))/100;
  if(row.gross!==null&&row.gross_difference!==0)issues.push(`Column J: gross ${row.gross.toFixed(2)} must equal rounded net plus VAT ${expected.toFixed(2)}.`);
  if(['16%','8%'].includes(rate)&&Math.abs(Math.round(row.vat*100)-Math.round(money(row.amount*parseInt(rate)/100)*100))>1)issues.push('Column I: VAT does not agree with the selected category. Check the source and category.');
 }
 const credit=row.amount<0;row.document_type=credit?'Credit note':'Invoice';
 if(credit&&!row.original_invoice)pending.push('Column K: original invoice number is missing.');
 if(credit&&!clean(optional(values[11])))pending.push('Column L: original invoice date is missing.');
 else if(clean(optional(values[11]))&&!row.original_invoice_date)issues.push('Column L: enter a valid original invoice date.');
 if(row.original_invoice_date&&row.date&&row.original_invoice_date>row.date)issues.push('Column L: original invoice date cannot be later than the credit-note date.');
 if(!credit&&(row.original_invoice||row.original_invoice_date))issues.push('Columns K and L: leave blank for an ordinary invoice; credit notes use negative amounts.');
 for(const [key,col] of [['amount',7],['vat',8],['gross',9]])if(row[key]!==null&&Math.abs(Number(String(values[col]).replace(/,/g,''))-row[key])>1e-9)rounded.push(key);
 row.rounded_fields=rounded;
 const line=[row.description,row.customs_entry,row.purchase_type].map(norm).join('|');
 const key=JSON.stringify([norm(row.invoice),norm(row.party_pin)||norm(row.party),line]);
 return {raw,row,issues,pending,key,route:null,category_code:null,narration:row.description||null};
}
export function purchaseUploadSummary(records,rate,start,end,accounts=[],clientMappings,deriveVat=false){
 const out={source_count:records.length,valid_count:0,rejected_count:0,pending_count:0,credit_count:0,rounded_count:0,mapping_hint_count:0,mapping_issue_count:0,mapping_issues:[],net:0,vat:0,gross:0,source_totals:{net:0,vat:0,gross:0,complete:true},pending_totals:{net:0,vat:0,gross:0},issues:[],pending_issues:[]};
 for(const {source_row,values} of records){const n=normalizePurchaseUpload(values,rate,start,end,accounts,clientMappings,deriveVat);if(n.row.amount<0)out.credit_count++;if(n.row.rounded_fields.length)out.rounded_count++;if(n.row.mapping_suggestion)out.mapping_hint_count++;if(n.row.mapping_suggestion_issue){out.mapping_issue_count++;if(out.mapping_issues.length<100)out.mapping_issues.push({row:source_row,reason:n.row.mapping_suggestion_issue});}
  for(const k of ['net','vat','gross']){const amount=n.row[k==='net'?'amount':k];if(amount===null)out.source_totals.complete=false;else out.source_totals[k]+=Math.round(amount*100);}
  if(n.issues.length){out.rejected_count++;if(out.issues.length<100)out.issues.push({row:source_row,reason:n.issues.join(' ')});continue;}
  if(n.pending.length){out.pending_count++;if(out.pending_issues.length<100)out.pending_issues.push({row:source_row,invoice:n.row.invoice,reason:n.pending.join(' ')});for(const k of ['net','vat','gross'])out.pending_totals[k]+=Math.round(n.row[k==='net'?'amount':k]*100);continue;}
  out.valid_count++;for(const k of ['net','vat','gross'])out[k]+=Math.round(n.row[k==='net'?'amount':k]*100);
 }
 for(const k of ['net','vat','gross']){out[k]/=100;out.source_totals[k]/=100;out.pending_totals[k]/=100;}return out;
}
export function importRowRange({header,first,last,rowCount,block}){
 if(!Number.isInteger(first)||!Number.isInteger(last))fail(400,'First and last data rows must be whole numbers.');
 if(first<=header)fail(400,`The first data row must be after header row ${header}.`);
 if(last<first)fail(400,'The last data row is before the first data row.');
 if(last>rowCount)fail(400,`The last data row is ${last}, but the selected worksheet ends at row ${rowCount}. Refresh the worksheet preview.`);
 if(block&&(first<block.first_row||last>block.last_row))fail(400,`The selected monthly section covers rows ${block.first_row}–${block.last_row}. Refresh that section before importing.`);
 if(last-first+1>10000)fail(400,`The selected range contains ${last-first+1} rows. Select at most 10,000 rows per upload.`);
 return {first,last};
}
