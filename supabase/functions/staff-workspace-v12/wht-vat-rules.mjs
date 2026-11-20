// Withholding VAT (build 2834). Pure functions. No rate is held here: the rate on a line is the one in the effective-dated KE_WHTVAT_AGENT rule on the payment date.
// Supplier side: a certificate received is linked to the sales invoices it covers, and the credit is claimed only when those lines add up to the credit.
// Agent side: the schedule of VAT withheld from suppliers, in the layout of KRA's Withholding VAT return (workbook version 6.0.6): section A and section B.
export const RATE_KEY='KE_WHTVAT_AGENT';
export const LAYOUT={code:'WHTVAT-6.0.6',label:'KRA Withholding VAT return, sections A and B',source:'KRA Withholding VAT workbook version 6.0.6 supplied by the firm'};
export const PIN_RE=/^[A-Z][0-9]{9}[A-Z]$/;
export const CLAIMABLE_CATEGORIES=['16%','8%'];
const cents=v=>Math.round((Number(v)||0)*100),kes=c=>Math.round(c)/100;
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const dmy=v=>{const s=day(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)?`${s.slice(8)}/${s.slice(5,7)}/${s.slice(0,4)}`:'';};
const up=v=>String(v||'').trim().toUpperCase();

// Net x rate, worked on whole cents and thousandths of a percent so no floating-point error creeps in.
// exact: the amount to the cent, half rounded up, kept in the books. whole: the KRA layout's CEILING(ROUND(net,2)*rate/100,1), the whole shilling used in the file.
export function withheldVat(net,rate){
 const n=BigInt(cents(net)),r=BigInt(Math.round(Number(rate)*1000));
 if(n<=0n||r<=0n)return {exact:0,whole:0};
 const exact=(n*r+50000n)/100000n,whole=(n*r+9999999n)/10000000n;
 return {exact:Number(exact)/100,whole:Number(whole)};
}
// The rule in force on a date, from the approved (or staging-test) rate rules supplied. Nothing is assumed when there is none.
export function ruleOn(rules,at){
 const d=day(at),ok=(rules||[]).filter(r=>r.rate_key===RATE_KEY&&day(r.effective_from)<=d&&day(r.effective_to)>=d);
 if(ok.length>1)return {error:`More than one approved version of the withholding VAT rule covers ${d}. Ask the Partner to end one.`};
 if(!ok.length)return {error:`There is no approved withholding VAT rate covering ${d}. A Manager or Partner adds the rule ${RATE_KEY} (rule type VAT, rate in %) under Settings, then approves it.`};
 const rate=Number(ok[0].parameters?.rate);
 if(!(rate>0&&rate<=100))return {error:'The withholding VAT rule has no usable rate.'};
 return {rule:ok[0],rate};
}
// Does a purchases CSV line carry VAT that can be withheld on? Zero-rated and exempt supplies and credit notes cannot. Missing is never guessed.
export function purchaseEligibility(line){
 if(!line)return {ok:false,reason:'The invoice is not in the retained KRA purchases CSV.'};
 if(line.document_type==='Credit note')return {ok:false,reason:'A credit note is not scheduled here: it goes in the adjustment voucher figure.'};
 if(!CLAIMABLE_CATEGORIES.includes(line.vat_category))return {ok:false,reason:`The invoice is ${line.vat_category==='Exempt'?'exempt':'zero-rated'} in the KRA purchases CSV, so no VAT was charged to withhold on.`};
 return {ok:true};
}
export function agentLineIssues(l,{clientPin,month}={}){
 const out=[],pin=up(l.supplier_pin);
 if(!PIN_RE.test(pin))out.push('Enter the supplier PIN in the KRA format (a letter, nine digits, a letter).');
 if(clientPin&&pin===up(clientPin))out.push('The supplier PIN cannot be the taxpayer\'s own PIN.');
 if(String(l.supplier_name||'').trim().length<2)out.push('Enter the supplier name.');
 const inv=String(l.invoice_no??'').trim();
 if(!inv)out.push('Enter the supplier invoice number.');else if(inv.length>40)out.push('The invoice number is longer than the 40 characters the KRA return accepts.');
 if(!(Number(l.invoice_net)>0))out.push('The invoice amount (before VAT) must be above zero.');
 if(!day(l.invoice_date))out.push('Enter the invoice date.');
 if(!day(l.payment_date))out.push('Enter the date the supplier was paid.');
 else{
  if(day(l.invoice_date)&&day(l.invoice_date)>day(l.payment_date))out.push('The invoice date cannot be after the payment date.');
  if(month&&day(l.payment_date).slice(0,7)!==month)out.push(`The payment date is not in ${month}. Every line of one return has a payment date in the same month.`);
 }
 return out;
}
// The supplier-side link: do the invoice lines add up to the credit, and is each invoice in the retained KRA sales CSV?
export function certificateState(credit,lines,salesInvoices){
 const total=(lines||[]).reduce((s,x)=>s+cents(x.vat_withheld),0),amount=cents(credit?.erp_amount),diff=amount-total;
 const known=new Set((salesInvoices||[]).map(x=>String(x).trim().toUpperCase()));
 const notInCsv=known.size?(lines||[]).filter(x=>!known.has(String(x.invoice_no).trim().toUpperCase())).map(x=>x.invoice_no):[];
 const problems=[];
 if(!(lines||[]).length)problems.push('No sales invoices are linked to this certificate yet.');
 else if(diff!==0)problems.push(`The invoice lines add up to ${kes(total).toFixed(2)}, which differs from the credit of ${kes(amount).toFixed(2)} by ${kes(Math.abs(diff)).toFixed(2)}.`);
 return {linked_total:kes(total),credit_amount:kes(amount),difference:kes(diff),complete:!problems.length,problems,not_in_sales_csv:notInCsv,csv_checked:known.size>0};
}
export function certificateLineIssues(l,{clientPin}={}){
 const out=[];
 if(!PIN_RE.test(up(l.withholder_pin)))out.push('Enter the PIN of the customer who withheld, in the KRA format.');
 if(clientPin&&up(l.withholder_pin)===up(clientPin))out.push('The withholder cannot be the taxpayer itself.');
 if(String(l.withholder_name||'').trim().length<2)out.push('Enter the name of the customer who withheld.');
 if(!String(l.certificate_no??'').trim())out.push('Enter the certificate number.');
 if(!String(l.invoice_no??'').trim())out.push('Enter the sales invoice number exactly as issued.');
 if(!(Number(l.invoice_net)>0))out.push('The invoice amount (before VAT) must be above zero.');
 if(!(Number(l.vat_withheld)>0))out.push('The VAT withheld must be above zero.');
 if(day(l.certificate_date)&&day(l.invoice_date)&&day(l.certificate_date)<day(l.invoice_date))out.push('The certificate cannot be dated before the invoice.');
 return out;
}
// The two sheets of the KRA return. Section B amounts are the whole-shilling figures the KRA workbook calculates; the adjustment-voucher and OAV/RAV
// totals depend on vouchers the ERP does not hold, so they are left for iTax and the file says so.
export function scheduleSheets({lines,client,month}){
 const live=(lines||[]).filter(l=>l.status==='Active'),issues=[];
 const rows=live.map(l=>{const w=withheldVat(l.invoice_net,l.rate);return [up(l.supplier_pin),String(l.invoice_no),dmy(l.invoice_date),kes(cents(l.invoice_net)),dmy(l.payment_date),Number(l.rate),w.whole];});
 const total=rows.reduce((s,r)=>s+r[6],0);
 if(!live.length)issues.push('There are no active lines in this month, and the KRA return needs at least one.');
 const months=new Set(live.map(l=>day(l.payment_date).slice(0,7)));
 if(months.size>1)issues.push('The payment dates fall in more than one month. Prepare one return per month.');
 if(!client?.kra_pin)issues.push('The client\'s KRA PIN is not recorded.');
 for(const l of live)for(const m of agentLineIssues(l,{clientPin:client?.kra_pin,month}))issues.push(`${l.invoice_no}: ${m}`);
 issues.push('Totals B (withholding adjustment vouchers) and C (OAV/RAV) depend on vouchers the ERP does not hold. Enter them from iTax; the payable figure below assumes both are nil.');
 const sheets=[
  ['A_Basic_Info',['Field','Value'],[['Personal Identification Number',client?.kra_pin||''],['Tax Head','VAT'],['Tax Sub Head','Withholding - VAT'],['Payment Type','Self Assessment Tax']]],
  ['B_VAT_WHT_Dtls',['PIN of Withholdee','Invoice Number','Invoice Date','Invoice Amount (Exclusive of VAT) (Ksh)','Payment Date to Supplier/Withholdee','Withholding VAT Rate (%)','Withholding VAT Amount (Ksh)'],[...rows,
   ['Total Withholding VAT Amount (Ksh) (A)','','','','','',total],['Total Amount of Withholding Adjustment Voucher (B)','','','','','','Enter from iTax'],['Total Amount of OAV/RAV (C)','','','','','','Enter from iTax'],['Total Withholding VAT Payable (Ksh)','','','','','',total]]]
 ];
 return {sheets,issues,counts:{lines:rows.length},totals:{withheld_whole:total,withheld_exact:kes(live.reduce((s,l)=>s+cents(l.vat_withheld),0))}};
}
