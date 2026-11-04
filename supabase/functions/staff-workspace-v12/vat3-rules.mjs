// VAT3 schedules from a locked VAT case. Pure functions: rows in, schedule sheets and a tie-out to the case result out.
// Column order follows the KRA VAT annex layout for sales and purchase invoices. The ERP prepares the schedules; staff
// still confirm the schedule letters and column order against the current KRA return before upload.
const cents=v=>Math.round((Number(v)||0)*100),kes=c=>Math.round(c)/100;
const dateText=v=>String(v||'').slice(0,10);
const PURCHASE=['Purchases','Expenditure','Non-eTIMS'];
export function treatmentOf(key){
 const k=String(key||'').toUpperCase();
 if(!k)return 'Unclassified';
 if(k.includes('ZERO'))return 'Zero-rated';
 if(k.includes('EXEMPT'))return 'Exempt';
 if(k.includes('OUTSIDE'))return 'Outside scope';
 if(k.includes('STANDARD')||k.includes('PETROLEUM'))return 'Standard';
 return 'Unclassified';
}
export const SALES_SCHEDULES=[['B','Standard','Sales at the standard rate'],['C','Zero-rated','Zero-rated sales'],['D','Exempt','Exempt sales'],['E','Outside scope','Sales outside VAT scope']];
export const PURCHASE_SCHEDULES=[['F','Standard','Local purchases at the standard rate'],['H','Zero-rated','Zero-rated purchases'],['I','Exempt','Exempt purchases'],['I','Outside scope','Purchases outside VAT scope']];
const salesHead=['PIN of purchaser','Name of purchaser','Invoice date','Invoice number','Description','Taxable value (KES)','Amount of VAT (KES)','VAT rule'];
const purchaseHead=['PIN of supplier','Name of supplier','Invoice date','Invoice number','Description','Taxable value (KES)','Input VAT in source (KES)','Claim %','Input VAT claimed (KES)','VAT rule'];
export function vat3Schedules({rows,result,inputs}){
 const sales=[],purchases=[],skipped={sales:0,purchases:0};
 for(const r of rows||[]){
  const n=r.normalized||{},treat=treatmentOf(r.vat_rate_key);
  if(r.dataset==='Sales'){
   if(r.decision!=='Confirmed'){skipped.sales++;continue;}
   sales.push({treat,line:[n.party_pin||'',n.party||'',dateText(n.date),n.invoice||'',n.description||'',kes(cents(n.amount)),kes(cents(n.vat)),r.vat_rate_key||'']});
  }else if(PURCHASE.includes(r.dataset)){
   if(r.decision!=='Eligible'){skipped.purchases++;continue;}
   const pct=Number(r.deductible_percentage??100),claim=kes(Math.round(cents(n.vat)*pct/100));
   purchases.push({treat,claim,line:[n.party_pin||'',n.party||'',dateText(n.date),n.invoice||n.reference||'',n.description||'',kes(cents(n.amount)),kes(cents(n.vat)),pct,claim,r.vat_rate_key||'']});
  }
 }
 const sheets=[],sum=(list,i)=>kes(list.reduce((s,x)=>s+cents(x.line[i]),0));
 const sectionRows=(list,defs,head,vatIdx)=>{
  for(const [letter,treat,label] of defs){
   const mine=list.filter(x=>x.treat===treat);
   const name=`${letter} ${label.trim()}`.slice(0,31),existing=sheets.find(s=>s[0]===name);
   if(existing)continue;
   sheets.push([name,head,[...mine.map(x=>x.line),['','TOTAL','','','',sum(mine,5),sum(mine,vatIdx),...(head===purchaseHead?['',sum(mine,8)]:[]),'']]]);
  }
 };
 // Purchases under I share one letter: put exempt and outside-scope lines on the same sheet.
 sectionRows(sales,SALES_SCHEDULES,salesHead,6);
 const f=purchases.filter(x=>x.treat==='Standard'),h=purchases.filter(x=>x.treat==='Zero-rated'),i=purchases.filter(x=>['Exempt','Outside scope'].includes(x.treat));
 for(const [name,list] of [['F Local purchases standard',f],['H Zero-rated purchases',h],['I Exempt and outside scope',i]])sheets.push([name,purchaseHead,[...list.map(x=>x.line),['','TOTAL','','','',sum(list,5),sum(list,6),'',sum(list,8),'']]]);
 const rc=Number(inputs?.reverse_charge||0),wh=Number(inputs?.withholding_credit||0);
 sheets.push(['J Imported services',['Description','VAT on imported services under reverse charge (KES)'],[[rc?'Reverse charge declared on the case':'None declared',kes(cents(rc))]]]);
 sheets.push(['K Payments',['Note'],[['Payments of VAT made in the period are recorded in the KRA payment workflow (PRN), not in this ERP schedule.']]]);
 sheets.push(['L VAT withheld',['Description','VAT withheld credit (KES)'],[[wh?'Withholding credit declared on the case':'None declared',kes(cents(wh))]]]);
 const known=x=>x.treat!=='Unclassified',standardSales=sales.filter(known).reduce((s,x)=>s+cents(x.line[6]),0),purchaseClaim=purchases.filter(known).reduce((s,x)=>s+cents(x.claim),0);
 const unclassified=[...sales.filter(x=>x.treat==='Unclassified'),...purchases.filter(x=>x.treat==='Unclassified')].length;
 const outputDiff=kes(standardSales-cents(result?.output)),inputDiff=kes(purchaseClaim-cents(result?.eligible_input));
 const R=result||{};
 sheets.push(['M-O Summary',['Line','KES'],[
  ['Output VAT (schedules B to E)',kes(standardSales)],['Output VAT per tax case',R.output??''],['Difference',outputDiff],
  ['Input VAT claimed (schedules F, H, I)',kes(purchaseClaim)],['Eligible input VAT per tax case',R.eligible_input??''],['Difference',inputDiff],
  ['Reverse charge (J)',R.reverse_charge??0],['Opening credit brought forward',R.opening_credit??0],['VAT withheld credit (L)',R.withholding_credit??0],['Adjustments',R.adjustments??0],
  ['Net VAT',R.net??''],['VAT payable',R.payable??''],['Credit carried forward',R.carry_forward??'']]]);
 const issues=[];
 if(unclassified)issues.push(`${unclassified} line(s) have no recognised VAT rule and are not on any schedule.`);
 if(outputDiff!==0)issues.push(`Output VAT on the schedules differs from the tax case by KES ${outputDiff}.`);
 if(inputDiff!==0)issues.push(`Input VAT on the schedules differs from the tax case by KES ${inputDiff}.`);
 return {sheets,issues,tie_out:{output_difference:outputDiff,input_difference:inputDiff,unclassified},counts:{sales:sales.length,purchases:purchases.length,skipped}};
}
