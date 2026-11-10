// Source files a tax period needs before it can go to review, shown as one short list. It reads the same facts as the
// existing gates in taxSummary and never decides anything itself: a line is "Provided" only when the gate would accept it.
export const SALES_DATASETS=['Sales'];
export const PURCHASE_DATASETS=['Purchases','Expenditure','Non-eTIMS'];
const count=(batches,sets)=>batches.filter(b=>sets.includes(b.dataset)).length;
export function sourceChecklist({kind,batches=[],bankPending=false,annualBankDocLinked=false}={}){
 const items=[];
 if(kind==='VAT'){
  const s=count(batches,SALES_DATASETS),p=count(batches,PURCHASE_DATASETS),b=count(batches,['Bank']);
  items.push({key:'sales',label:'eTIMS sales report',state:s?'Provided':'Missing',detail:s?`${s} upload(s) cover this period.`:'Upload the sales source for this period.'});
  items.push({key:'purchases',label:'eTIMS purchases and expenditure',state:p?'Provided':'Missing',detail:p?`${p} upload(s) cover this period.`:'Upload the purchases or expenditure source for this period.'});
  items.push({key:'bank',label:'Bank statement',state:b?'Provided':bankPending?'Deferred':'Missing',detail:b?`${b} statement(s) cover this period.`:bankPending?'Bank is marked pending on the locked sales review. The deferral must be completed before annual completion.':'Upload the bank control source for this period.'});
 }else if(['Company','Individual','Partnership'].includes(kind)){
  items.push({key:'annual_bank',label:'Annual bank statements and bank review',state:annualBankDocLinked?'Provided':'Missing',detail:annualBankDocLinked?'Evidence is linked.':'Link the annual bank statements and completed bank-review evidence. A monthly Bank pending is not annual clearance.'});
 }
 return {items,complete:items.length>0&&items.every(i=>i.state==='Provided')};
}
