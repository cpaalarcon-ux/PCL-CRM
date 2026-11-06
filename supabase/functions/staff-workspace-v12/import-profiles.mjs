import {excelDate,money,normalizeImport} from './workspace-rules.mjs';
import {sheetValues} from './workbook-templates.mjs';

export const rateGroups=['16%','8%','0%','Exempt'];
export const rateKeys={'16%':'KE_VAT_STANDARD','8%':'KE_VAT_PETROLEUM_8','0%':'KE_VAT_ZERO',Exempt:'KE_VAT_EXEMPT'};
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,'');
export function rateCategory(v){const s=norm(v),hasRate=n=>new RegExp(`(^|[^0-9])${n}(?:percent)?([^0-9]|$)`).test(s);if(/exempt/.test(s))return 'Exempt';if(/zero|zerorated/.test(s)||hasRate(0))return '0%';if(/petroleum|fuel|diesel|kerosene/.test(s)||hasRate(8))return '8%';if(/standard|normal/.test(s)||hasRate(16))return '16%';return null;}
const aliases={date:['date','invoicedate','transactiondate'],month:['month','salesmonth','periodmonth','reportingmonth'],invoice:['invoice','invoicenumber','invoiceno','invoiceref','creditnotenumber'],party:['supplier','suppliername','nameofsupplier','buyer','buyername'],party_pin:['supplierpin','pinofsupplier','buyerpin','krapin','pin'],description:['description','descriptionofgoodsservices','narration'],amount:['netamount','taxablevalue','taxablevalueksh','netvalue','purchasevalue','netsales','netsaleskes'],vat:['vat','vatamount','amountofvat','outputvat','vatkes','outputvatkes'],gross:['gross','grossamount','grossamountkes','grosssales','grosssaleskes'],credit_net:['creditnotesnet','creditnet','creditsnet','creditnotesnetkes'],credit_vat:['creditnotesvat','creditvat','creditsvat','creditnotesvatkes'],credits:['credits','creditnotes','creditamount'],vat_category:['vatcategory','taxcategory','vatrate','salescategory','rate'],original_invoice:['originalinvoice','originalinvoicenumber','relevantinvoicenumber'],original_invoice_date:['originalinvoicedate','relevantinvoicedate'],document_type:['documenttype','type'],line_id:['lineid','linenumber']};
const payrollAliases={name:['employeename','name'],pin:['krapin','employeepin','pin'],employee_id:['idnumber','employeeid','staffnumber'],basic:['basicpay','basicsalary'],allowances:['allowances','totalallowances'],gross:['grosspay','totalgrosspay','grosssalary'],other_deductions:['deductions','otherdeductions'],employee_nssf:['nssf','employeenssf'],shif:['shif'],employee_ahl:['ahl','housinglevy','affordablehousinglevy'],employer_nita:['nitalevy','nita'],taxable:['taxablepay','taxableamount'],gross_tax:['incometax','taxbeforerelief','grosstax'],personal_relief:['pmrelief','personalrelief','monthlypersonalrelief'],paye:['payededuction','payetax','paye'],net:['netamount','netpay','netsalary'],benefits:['noncashbenefits','taxablebenefits'],employer_nssf:['employernssf'],employer_ahl:['employerahl'],resident:['residentstatus'],employment_type:['employmenttype','employeetype','typeofemployment'],phone:['phonenumber','phone','mobile','mobilenumber','telephone','telephonenumber'],date_paid:['datepaid','paymentdate','datesigned','datereceived']};
function headerMap(values,dict){const out={};for(const [key,names] of Object.entries(dict)){const matches=values.map((v,i)=>names.includes(norm(v))?i+1:0).filter(Boolean);if(matches.length===1)out[key]=matches[0];}return out;}
// Versioned contracts from the supplied KRA CSV sections. An exact shape and all
// nonblank transaction dates/amounts are checked; a filename alone is insufficient.
const sections={
 B:{dataset:'Sales',rate:'16%',columns:10,map:{party_pin:1,party:2,date:4,invoice:5,description:6,amount:7,vat:8,original_invoice:9}},
 C:{dataset:'Sales',rate:'8%',columns:10,map:{party_pin:1,party:2,date:4,invoice:5,description:6,amount:7,vat:8,original_invoice:9}},
 D1:{dataset:'Sales',rate:'0%',columns:10,map:{party_pin:2,party:3,date:5,invoice:6,description:7,amount:10}},
 E:{dataset:'Sales',rate:'Exempt',columns:7,map:{party_pin:1,party:2,date:4,invoice:5,description:6,amount:7}},
 F:{dataset:'Purchases',rate:'16%',columns:11,map:{party_pin:2,party:3,date:4,invoice:5,description:6,amount:8,vat:9,original_invoice:10,original_invoice_date:11}},
 G:{dataset:'Purchases',rate:'8%',columns:11,map:{party_pin:2,party:3,date:4,invoice:5,description:6,amount:8,vat:9,original_invoice:10,original_invoice_date:11}},
 H:{dataset:'Purchases',rate:'0%',columns:9,map:{party_pin:2,party:3,date:4,invoice:5,description:7,amount:9}},
 I:{dataset:'Purchases',rate:'Exempt',columns:8,map:{party_pin:2,party:3,date:4,invoice:5,description:6,amount:8}}
};
export function detectImportProfile(sheet){
 const section=sheet.name.match(/(?:^|[ /])SEC_(B|C|D1|E|F|G|H|I)_WITH(?:OUT)?_.*\.CSV$/i)?.[1]?.toUpperCase(),spec=sections[section];
 if(spec){
  const errors=[];if(sheet.columnCount!==spec.columns)errors.push(`Expected ${spec.columns} columns, found ${sheet.columnCount}.`);
  let populated=0;for(let i=1;i<=sheet.rowCount;i++){const row=sheetValues(sheet,i);if(!row.some(v=>clean(v)))continue;populated++;if(!excelDate(row[spec.map.date-1])||money(row[spec.map.amount-1])===null||!clean(row[spec.map.invoice-1])){errors.push('Source dates, document references or amounts do not match the section layout.');break;}}
  if(errors.length||!populated)return {recognised:false,name:`KRA section ${section}`,errors:errors.length?errors:['No transactions found.']};
  return {recognised:true,id:`KRA-${section}-2026-v1`,name:`KRA section ${section} · ${spec.dataset} ${spec.rate}`,dataset:spec.dataset,vat_category:spec.rate,header_row:0,column_map:spec.map,derived_vat:true,amount_basis:'Net',credit_basis:'After credit notes'};
 }
 for(let i=1;i<=Math.min(sheet.rowCount,30);i++){
  const values=sheetValues(sheet,i),pay=headerMap(values,payrollAliases),map=headerMap(values,aliases);
  if(pay.name&&pay.gross&&((pay.pin&&pay.paye)||(pay.employment_type&&pay.employee_id)))return {recognised:true,id:'PAYROLL-BREAKDOWN-v1',name:'Payroll breakdown',dataset:'Payroll',header_row:i,column_map:pay};
  if(norm(values[0])==='krapin'&&norm(values[1])==='employeename'&&sheet.columnCount===25&&norm(values[6]).startsWith('totalcashpay'))return {recognised:true,id:'PAYE-25-v1',name:'PAYE 25-column template',dataset:'Payroll',header_row:i,column_map:{pin:1,name:2,resident:3,gross:7,shif:15,employee_nssf:16,other_pension:17,postretirement_medical:18,mortgage_interest:19,employee_ahl:20,taxable:21,personal_relief:22,insurance_relief:23,paye:24},benefit_columns:[8,9,10,12,13]};
  if(map.month&&map.vat_category&&map.amount&&map.vat&&map.gross&&map.credits&&map.credit_net&&map.credit_vat&&!map.invoice)return {recognised:true,id:'SALES-CATEGORIES-v3',name:'Sales update template v3 · category totals',dataset:'Sales',header_row:i,column_map:map,summary:true,amount_basis:'Net'};
  if(map.date&&map.invoice&&map.amount)return {recognised:true,id:'INVOICE-HEADERS-v1',name:'Invoice export with recognised headers',dataset:'Purchases',header_row:i,column_map:map,amount_basis:'Net'};
 }
 if(sheet.columnCount===25&&/^[A-Z]\d{9}[A-Z]$/i.test(clean(sheetValues(sheet,1)[0]))&&['Resident','Non Resident','Non-Resident'].includes(clean(sheetValues(sheet,1)[2])))return {recognised:true,id:'PAYE-25-v1',name:'Headerless PAYE 25-column template',dataset:'Payroll',header_row:0,column_map:{pin:1,name:2,resident:3,gross:7,shif:15,employee_nssf:16,other_pension:17,postretirement_medical:18,mortgage_interest:19,employee_ahl:20,taxable:21,personal_relief:22,insurance_relief:23,paye:24},benefit_columns:[8,9,10,12,13]};
 return null;
}
export function profilePurchase(values,profile,start,end){
 const n=normalizeImport(values,profile.column_map,'Purchases',start,end);if(!n)return null;
 const r=n.row,rate=profile.vat_category||rateCategory(r.vat_category);r.vat_category=rate||'Unconfirmed';r.source_profile=profile.id;
 if(profile.derived_vat&&r.vat==null&&r.amount!=null){r.vat=Math.round(r.amount*(rate==='16%'?.16:rate==='8%'?.08:0)*100)/100;r.vat_basis='Calculated from recognised VAT-exclusive section';}
 else r.vat_basis='Supplied';
 const credit=/credit/i.test(r.document_type||'')||r.amount<0;
 if(credit){r.amount=-Math.abs(r.amount);if(r.vat!=null)r.vat=r.vat===0?0:-Math.abs(r.vat);r.document_type='Credit note';}else r.document_type=/debit/i.test(r.document_type||'')?'Debit note':'Invoice';
 if(rate==='8%')r.legacy_tax_review=true;
 return n;
}
function monthKey(value,fallback){
 const raw=clean(value);if(!raw)return fallback;
 const match=raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/]\d{1,2})?$/);
 if(match){const m=Number(match[2]);return m>=1&&m<=12?`${match[1]}-${String(m).padStart(2,'0')}`:null;}
 const parsed=excelDate(raw);return parsed?parsed.slice(0,7):null;
}
export function salesTotals(sheets,start,end){
 const groups=[],issues=[],seen=new Map();let duplicates=0,source=0;
 const hasSummary=sheets.some(s=>s.profile?.summary),hasDetail=sheets.some(s=>!s.profile?.summary);
 if(hasSummary&&hasDetail)return {groups,issues:['Choose category totals or detailed KRA sales sections. They cannot be added together.'],source_count:0,duplicate_count:0};
 for(const {sheet,profile} of sheets){
  if(!profile?.recognised||profile.dataset!=='Sales'){issues.push(`Review format: ${sheet.name}`);continue;}
  for(let i=profile.header_row+1;i<=sheet.rowCount;i++){
   const values=sheetValues(sheet,i);if(!values.some(v=>clean(v)))continue;
   const get=k=>profile.column_map[k]?values[profile.column_map[k]-1]:null,rate=profile.vat_category||rateCategory(get('vat_category'));if(profile.summary&&/^total$/i.test(clean(get('vat_category'))))continue;
   source++;let net=money(get('amount')),vat=money(get('vat')),at=profile.summary?start:excelDate(get('date'));
   const fallbackMonth=start.slice(0,7)===end.slice(0,7)?start.slice(0,7):null,month=profile.summary?monthKey(get('month'),fallbackMonth):(at?at.slice(0,7):null);
   if(!rate||net===null||!month||month<start.slice(0,7)||month>end.slice(0,7)||(!profile.summary&&(!at||at<start||at>end))){issues.push(`${sheet.name} row ${i}: category, month, net amount or reporting date needs correction.`);continue;}
   if(profile.summary&&start.slice(0,7)!==end.slice(0,7)&&!get('month')){issues.push(`${sheet.name} row ${i}: add a Month value (YYYY-MM) for multi-month category totals.`);continue;}
   if(vat==null&&profile.derived_vat)vat=Math.round(net*(rate==='16%'?.16:rate==='8%'?.08:0)*100)/100;
   if(!profile.summary&&/credit/i.test(clean(get('document_type')))){net=-Math.abs(net);if(vat!=null)vat=-Math.abs(vat);}
   const gross=money(get('gross')),creditNet=money(get('credit_net')),creditVat=money(get('credit_vat')),genericCredits=money(get('credits'));
   if(profile.summary&&(genericCredits==null||creditNet==null||creditVat==null||Math.abs(genericCredits-creditNet-creditVat)>.01))issues.push(`${sheet.name} row ${i}: enter Credits and split it exactly between Credit notes net and Credit notes VAT.`);
   if(vat==null||profile.summary&&gross==null||['0%','Exempt'].includes(rate)&&vat!==0||net*vat<0||gross!=null&&Math.abs(gross-net-vat)>.01||creditNet!=null&&creditNet<0||creditVat!=null&&creditVat<0||['0%','Exempt'].includes(rate)&&creditVat){issues.push(`${sheet.name} row ${i}: gross, VAT or credit values are missing or inconsistent with the category.`);continue;}
   if(profile.column_map.credit_net&&creditNet==null||profile.column_map.credit_vat&&creditVat==null){issues.push(`${sheet.name} row ${i}: enter a numeric value, including 0, in both credit-note columns.`);continue;}
   const key=profile.summary?`${month}|${rate}`:JSON.stringify([clean(get('invoice')).toUpperCase(),clean(get('party_pin')).toUpperCase(),rate,month]),fingerprint=JSON.stringify([net,vat,at,gross,creditNet,creditVat]);
   if(seen.has(key)){if(profile.summary)issues.push(`${sheet.name} row ${i}: ${rate} appears more than once for ${month}. Use one category row per month.`);else if(seen.get(key)===fingerprint)duplicates++;else issues.push(`${sheet.name} row ${i}: conflicting duplicate reference.`);continue;}seen.set(key,fingerprint);
   let g=groups.find(g=>g.month===month&&g.vat_category===rate);if(!g){g={month,vat_category:rate,net:0,vat:0,gross:0,credit_net:0,credit_vat:0,source_rows:0};groups.push(g);}g.net+=Math.round(net*100);g.vat+=Math.round(vat*100);g.source_rows++;
   // Detailed KRA credit-note rows are already signed into net/VAT totals. Keep
   // positive credit-note disclosure amounts for reporting, but never subtract
   // them a second time from the net amount.
   if(!profile.summary&&net<0){g.credit_net+=Math.round(-net*100);g.credit_vat+=Math.round(-Number(vat||0)*100);}
   if(creditNet!=null)g.file_credit_net=(g.file_credit_net||0)+Math.round(creditNet*100);if(creditVat!=null)g.file_credit_vat=(g.file_credit_vat||0)+Math.round(creditVat*100);if(genericCredits!=null)g.generic_credits=(g.generic_credits||0)+Math.round(genericCredits*100);
  }
 }
 for(const g of groups){for(const k of ['net','vat','credit_net','credit_vat'])g[k]/=100;g.file_credit_net=(g.file_credit_net||0)/100;g.file_credit_vat=(g.file_credit_vat||0)/100;g.generic_credits=(g.generic_credits||0)/100;g.gross=Math.round((g.net+g.vat)*100)/100;}
 if(!source)issues.push('No sales values found.');
 if(groups.length){
  const months=[...new Set(groups.map(g=>g.month))];
  if(hasSummary)for(const ym of months)for(const rate of rateGroups)if(!groups.some(g=>g.month===ym&&g.vat_category===rate))issues.push(`Add a ${rate} row for ${ym}; enter 0 where there were no sales.`);
  // Downstream month reports and journals use one stable row per VAT category,
  // including zero categories, whether the upload is a summary or invoice detail.
  for(const ym of months)for(const rate of rateGroups)if(!groups.some(g=>g.month===ym&&g.vat_category===rate))groups.push({month:ym,vat_category:rate,net:0,vat:0,gross:0,credit_net:0,credit_vat:0,file_credit_net:0,file_credit_vat:0,generic_credits:0,source_rows:0});
 }
 return {groups:groups.sort((a,b)=>a.month.localeCompare(b.month)||rateGroups.indexOf(a.vat_category)-rateGroups.indexOf(b.vat_category)),issues,source_count:source,duplicate_count:duplicates,credit_basis:'After credit notes',amount_basis:'Net'};
}
export function payrollRows(sheet,profile){
 const rows=[],issues=[],pins=new Set(),ids=new Set();
 for(let i=profile.header_row+1;i<=sheet.rowCount;i++){
  const values=sheetValues(sheet,i),get=k=>values[profile.column_map[k]-1],name=clean(get('name')),pin=clean(get('pin')).toUpperCase();
  if(!name&&!pin)continue;if(/^(grand\s*)?totals?$/i.test(name))continue;
  if(!name&&!/^[A-Z]\d{9}[A-Z]$/i.test(pin)&&money(get('gross'))==null&&!clean(get('employee_id')))continue;
  const errors=[],r={source_row:i,name,pin,employee_id:clean(get('employee_id')),resident:profile.column_map.resident?clean(get('resident'))==='Resident':null};
  const typeText=clean(get('employment_type')).toLowerCase(),types={'':'Permanent',permanent:'Permanent',casual:'Casual',contract:'Contract'};
  r.employment_type=types[typeText]??'Unknown';r.phone=clean(get('phone')).replace(/[\s-]/g,'');r.date_paid=excelDate(get('date_paid'))||null;
  for(const key of Object.keys(profile.column_map))if(!['name','pin','employee_id','resident','employment_type','phone','date_paid'].includes(key))r[key]=money(get(key));
  if(profile.benefit_columns)r.benefits=profile.benefit_columns.reduce((n,c)=>n+(money(values[c-1])||0),0);
  if(!name)errors.push('Employee name is missing.');if(r.employment_type==='Unknown')errors.push('Employment type must be Permanent, Casual or Contract.');
  const casual=r.employment_type==='Casual';
  if(!/^[A-Z]\d{9}[A-Z]$/.test(pin)&&!(casual&&!pin))errors.push('Employee PIN is missing or invalid.');if(pin&&pins.has(pin))errors.push('Duplicate employee PIN.');if(pin)pins.add(pin);
  if(casual){if(!r.employee_id)errors.push('A casual needs an ID number.');else if(ids.has(r.employee_id))errors.push('Duplicate ID number.');ids.add(r.employee_id);if(!/^\+?\d{9,13}$/.test(r.phone))errors.push('A casual needs a phone number.');if(!r.date_paid)errors.push('A casual needs the date paid.');}
  if(r.gross==null||r.gross<0)errors.push('Cash gross pay is missing or invalid.');
  for(const [k,v] of Object.entries(r))if(typeof v==='number'&&v<0)errors.push(`${k} cannot be negative.`);
  r.issues=errors;rows.push(r);issues.push(...errors.map(x=>`Row ${i}: ${x}`));
 }
 if(!rows.length)issues.push('No employee rows found.');if(rows.length>500)issues.push('A payroll import supports up to 500 employees.');return {rows,issues};
}
