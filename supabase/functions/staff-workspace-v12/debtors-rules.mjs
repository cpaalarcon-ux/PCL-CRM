// Debtors ageing: pure functions. Ages each open customer invoice from its invoice date to the as-of date.
// No credit terms are recorded on sales, so ageing runs from the invoice date, not from a due date.
export const BANDS=[
 {key:'current',label:'Current (0–30 days)',min:0,max:30},
 {key:'d31_60',label:'31–60 days',min:31,max:60},
 {key:'d61_90',label:'61–90 days',min:61,max:90},
 {key:'over90',label:'Over 90 days',min:91,max:Infinity}];
const cents=v=>Math.round((Number(v)||0)*100);
const kes=c=>Math.round(c)/100;
export const daysBetween=(from,to)=>Math.round((Date.parse(String(to).slice(0,10)+'T00:00:00Z')-Date.parse(String(from).slice(0,10)+'T00:00:00Z'))/86400000);
export function bandFor(days){return (BANDS.find(b=>days>=b.min&&days<=b.max)||BANDS[0]).key;}
const customerKey=i=>String(i.pin||'').trim().toUpperCase()||String(i.customer||'').trim().toUpperCase().replace(/\s+/g,' ')||'UNKNOWN CUSTOMER';

// invoices: [{row_id,invoice,date,customer,pin,gross,posted}]; gross is negative for a credit note.
// allocations: [{sales_row_id,amount,receipt_date}]; a reversal carries a negative amount.
export function ageDebtors({invoices,allocations,asOf}){
 const received=new Map();
 for(const a of allocations||[]){if(a.receipt_date&&String(a.receipt_date).slice(0,10)>asOf)continue;received.set(a.sales_row_id,(received.get(a.sales_row_id)||0)+cents(a.amount));}
 const groups=new Map(),totals={current:0,d31_60:0,d61_90:0,over90:0,total:0,posted:0,not_posted:0};let settled=0;
 for(const i of invoices||[]){
  if(String(i.date).slice(0,10)>asOf)continue;
  const gross=cents(i.gross),got=gross>0?received.get(i.row_id)||0:0,open=gross-got;
  if(open===0){settled++;continue;}
  const days=Math.max(0,daysBetween(i.date,asOf)),band=bandFor(days),key=customerKey(i);
  if(!groups.has(key))groups.set(key,{customer:i.customer||key,pin:i.pin||'',invoices:[],buckets:{current:0,d31_60:0,d61_90:0,over90:0},total:0});
  const g=groups.get(key);g.invoices.push({row_id:i.row_id,invoice:i.invoice,date:String(i.date).slice(0,10),gross:kes(gross),received:kes(got),open:kes(open),age_days:days,band,posted:!!i.posted});
  g.buckets[band]+=open;g.total+=open;totals[band]+=open;totals.total+=open;totals[i.posted?'posted':'not_posted']+=open;
 }
 const customers=[...groups.values()].map(g=>({...g,buckets:Object.fromEntries(Object.entries(g.buckets).map(([k,v])=>[k,kes(v)])),total:kes(g.total),invoices:g.invoices.sort((x,y)=>x.date.localeCompare(y.date)||String(x.invoice).localeCompare(String(y.invoice)))})).sort((x,y)=>x.customer.localeCompare(y.customer));
 return {bands:BANDS.map(b=>({key:b.key,label:b.label})),customers,totals:Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,kes(v)])),settled_count:settled};
}
