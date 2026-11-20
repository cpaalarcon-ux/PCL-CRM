// A prompt, never a blocker: compares the sales gross of an import with the bank deposits for the same dates.
// Credit sales, cash not banked, mobile-money timing and non-sales receipts can all explain a gap; the sales and bank reconciliation records the bridge.
export const BANK_WARN_PERCENT=5;
const round=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
export function bankDepositCheck({salesGross,deposits,depositRows}){
 const sales=round(salesGross||0);
 if(!depositRows)return {status:'Bank pending',sales_gross:sales,deposits:null,difference:null,percent:null,tolerance_percent:BANK_WARN_PERCENT,message:'No bank statement is imported for these dates yet. Sales cannot be compared with deposits until it arrives; the month can still be prepared.'};
 const dep=round(deposits||0),difference=round(dep-sales),percent=sales?round(Math.abs(difference)/Math.abs(sales)*100):(dep?100:0);
 if(percent<=BANK_WARN_PERCENT)return {status:'Agrees',sales_gross:sales,deposits:dep,difference,percent,tolerance_percent:BANK_WARN_PERCENT,message:`Bank deposits are within ${BANK_WARN_PERCENT}% of gross sales.`};
 const fmt=v=>v.toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 return {status:'Warning',sales_gross:sales,deposits:dep,difference,percent,tolerance_percent:BANK_WARN_PERCENT,message:`Bank deposits of KES ${fmt(dep)} are ${percent}% ${difference<0?'below':'above'} gross sales of KES ${fmt(sales)} (difference KES ${fmt(Math.abs(difference))}). Credit sales, cash not banked, mobile-money timing and non-sales receipts can explain this. Record the bridge in the sales and bank reconciliation. You can continue.`};
}
