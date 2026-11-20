// TOT3 workings from a locked Turnover Tax case (build 2831b). Pure functions: case rows and result in, the sheets of KRA's TOT3 return (version 9.0.2 layout) out.
// The rate, the turnover and the tax due come from the locked case, which takes the rate from the effective-dated KE_TOT rule: nothing is fixed here, so a rate change
// never needs a change to this file. The ERP prepares the workings; staff still enter them in the current KRA TOT3 file and confirm the layout version before filing.
const cents=v=>Math.round((Number(v)||0)*100),kes=c=>Math.round(c)/100;
const dmy=v=>{const s=String(v||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?`${s.slice(8)}/${s.slice(5,7)}/${s.slice(0,4)}`:'';};
const PURCHASE=['Purchases','Expenditure','Non-eTIMS'];
export const LAYOUT={code:'TOT3-9.0.2',label:'KRA Turnover Tax return (TOT3), sections A to E',source:'KRA TOT3 workbook version 9.0.2 supplied by the firm'};
export const PURCHASE_HEAD=['PIN of Supplier','Name of Supplier','Invoice Date','Invoice Number','Description of Goods / Services','Amount (Ksh)'];
const LIMITS=[11,50,10,20,200,15];
export function tot3Sheets({rows,result,c,client,partners}){
 const issues=[],lines=[];
 for(const r of rows||[]){
  if(!PURCHASE.includes(r.dataset)||r.is_period_summary)continue;
  const n=r.normalized||{},line=[String(n.party_pin||'').trim(),String(n.party||'').trim(),dmy(n.date),String(n.invoice||n.reference||'').trim(),String(n.description||'').trim(),kes(cents(n.amount))];
  const names=['PIN of Supplier','Name of Supplier','Invoice Date','Invoice Number','Description','Amount'],missing=names.filter((x,i)=>i<5&&!line[i]);
  if(missing.length)issues.push(`Purchase ${line[3]||'(no number)'}: ${missing.join(', ')} ${missing.length===1?'is':'are'} required by the TOT3 return and not held.`);
  line.forEach((v,i)=>{if(String(v).length>LIMITS[i])issues.push(`Purchase ${line[3]}: ${names[i]} is longer than ${LIMITS[i]} characters and must be shortened.`);});
  if(client?.kra_pin&&line[0]&&line[0].toUpperCase()===String(client.kra_pin).toUpperCase())issues.push(`Purchase ${line[3]}: the supplier PIN cannot be the taxpayer's own PIN.`);
  lines.push(line);
 }
 const total=kes(lines.reduce((s,l)=>s+cents(l[5]),0)),turnover=Number(result?.gross_receipts),rate=Number(result?.rate),due=Number(result?.gross_tax);
 if(!Number.isFinite(turnover)||!Number.isFinite(rate)||!Number.isFinite(due))issues.push('The locked case has no turnover, rate or tax due. Recalculate the case.');
 else if(Math.abs(Math.round(turnover*rate)/100-due)>0.011)issues.push('Tax due does not equal turnover times the rate in the locked case.');
 const partnership=String(client?.legal_entity_type||'').toLowerCase().includes('partnership');
 if(partnership&&!(partners||[]).length)issues.push('The client is a partnership: enter each partner\'s PIN, name and profit-sharing ratio in Section E from the partnership agreement. The ERP does not hold them here.');
 issues.push('Section C and D rows 5 to 8 (tax paid in advance, presumptive credit, vehicle credits, net payable) depend on payments and credits the ERP does not hold for this return. Enter them from iTax.');
 const sheets=[
  ['A_Basic_Info',['Field','Value'],[['Personal Identification Number',client?.kra_pin||''],['Type of Return',c?.amendment_no?'AMENDED':'ORIGINAL'],['Return Period From',dmy(c?.starts_on)],['Return Period To',dmy(c?.ends_on)],['Are you a partnership?',partnership?'Yes':'No'],['Layout',LAYOUT.code]]],
  ['B_Details_of_Purchases',PURCHASE_HEAD,[...lines,['','','','','Total',total]]],
  ['C_TOT_Payment_Credits',['Payment Registration Number','Date of Deposit','Amount of Turnover Tax Paid (Ksh)'],[['','Enter from iTax: payment records are not held in the ERP','']]],
  ['D_Tax_Due',['Sr. No.','Description','Amount (Ksh)'],[[1,'Local Purchases (Total of Amount from B_Details_of_Purchases)',total],[2,'Turnover for the Period',Number.isFinite(turnover)?kes(cents(turnover)):''],[3,'Turnover Tax Rate (%)',Number.isFinite(rate)?rate:''],[4,'Tax Due (2 * 3)',Number.isFinite(due)?kes(cents(due)):''],[5,'Turnover Tax Paid in Advance','Enter from iTax'],[6,'Presumptive Tax Credit','Enter from iTax'],[7,'Credits u/s 12A - Advance Tax on Commercial Vehicle','Enter from iTax'],[8,'Net Tax Payable / Refundable (4-5-6-7)','Complete after rows 5 to 7']]]
 ];
 if(partnership)sheets.push(['E_Details_of_Partners',['PIN of Partner','Name of Partner','Partner\'s Profit Sharing Ratio','Amount Payable based on Ratio'],(partners||[]).map(p=>[p.pin,p.name,p.ratio,Number.isFinite(due)?kes(Math.round(cents(due)*Number(p.ratio)/100)):''])]);
 return {sheets,issues,counts:{purchases:lines.length},totals:{purchases:total,turnover,rate,tax_due:due}};
}
