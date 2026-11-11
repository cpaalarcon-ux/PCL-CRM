// Suggested matches between unallocated bank credits and open sales invoices (build 2784). Pure functions.
// A suggestion is only a pointer: it applies nothing. A person opens it, checks it and allocates the receipt, or ignores it.
// The points and thresholds below are working defaults for ranking, not tax or accounting rules, and a Partner has not confirmed them.
export const WEIGHTS={invoice_no:60,pin:40,name_full:30,name_part:15,amount:40,recent:5};
export const MIN_SCORE=60,STRONG_SCORE=100,MAX_PER_RECEIPT=3,RECENT_DAYS=60;
const STOP=new Set(['ltd','limited','company','co','and','the','inc','plc','llp','enterprises','enterprise','trading','sons','of']);
export const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const pinKey=s=>String(s??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const cents=v=>Math.round((Number(v)||0)*100);
const days=(a,b)=>Math.round((Date.parse(String(b).slice(0,10)+'T00:00:00Z')-Date.parse(String(a).slice(0,10)+'T00:00:00Z'))/86400000);
const tokens=s=>norm(s).split(' ').filter(t=>t.length>=3&&!STOP.has(t));

// receipts: [{row_id,date,reference,text,remaining}]; invoices: [{row_id,invoice,date,customer,pin,open}]
export function scoreMatch(rc,inv){
 const text=' '+norm(rc.text||rc.reference)+' ',rawPin=pinKey(rc.text||rc.reference),reasons=[];let score=0;
 if(String(rc.date).slice(0,10)<String(inv.date).slice(0,10))return null; // the allocation rule refuses a receipt dated before its invoice
 const no=norm(inv.invoice);
 if(no.length>=3&&text.includes(' '+no+' ')){score+=WEIGHTS.invoice_no;reasons.push('Invoice number appears in the narration');}
 const pin=pinKey(inv.pin);
 if(/^[A-Z][0-9]{9}[A-Z]$/.test(pin)&&rawPin.includes(pin)){score+=WEIGHTS.pin;reasons.push('Customer KRA PIN appears in the narration');}
 const nt=tokens(inv.customer);
 if(nt.length){const hit=nt.filter(t=>text.includes(' '+t+' ')).length;
  if(hit===nt.length){score+=WEIGHTS.name_full;reasons.push('Customer name appears in the narration');}
  else if(hit>=2&&hit*2>=nt.length){score+=WEIGHTS.name_part;reasons.push('Part of the customer name appears in the narration');}}
 if(Math.abs(cents(rc.remaining)-cents(inv.open))<1){score+=WEIGHTS.amount;reasons.push('Amount equals the invoice balance');}
 const age=days(inv.date,rc.date);if(age>=0&&age<=RECENT_DAYS&&score>0){score+=WEIGHTS.recent;reasons.push('Received within '+RECENT_DAYS+' days of the invoice');}
 return {score,reasons};
}

export function suggestReceipts({receipts=[],invoices=[],limit=200}={}){
 const out=[];
 for(const rc of receipts){
  if(!(cents(rc.remaining)>0))continue;
  const hits=[];
  for(const inv of invoices){
   if(!(cents(inv.open)>0))continue;
   const s=scoreMatch(rc,inv);
   if(s&&s.score>=MIN_SCORE)hits.push({inv,...s});
  }
  hits.sort((a,b)=>b.score-a.score||String(a.inv.date).localeCompare(String(b.inv.date))||String(a.inv.invoice).localeCompare(String(b.inv.invoice)));
  const top=hits.slice(0,MAX_PER_RECEIPT),tied=hits.length>1&&hits[0].score===hits[1].score;
  for(const h of top){
   const amount=Math.min(cents(rc.remaining),cents(h.inv.open))/100,ambiguous=tied&&h.score===hits[0].score;
   out.push({bank_row_id:rc.row_id,sales_row_id:h.inv.row_id,receipt_date:rc.date,receipt_reference:rc.reference,receipt_left:Number(rc.remaining),invoice:h.inv.invoice,customer:h.inv.customer,invoice_open:Number(h.inv.open),amount,score:h.score,
    confidence:h.score>=STRONG_SCORE&&!ambiguous?'Strong':'Possible',reasons:h.reasons,note:ambiguous?'Another invoice fits equally well. Check which one the client meant.':amount<cents(h.inv.open)/100?'The credit is less than the invoice balance: a part payment.':''});
  }
 }
 out.sort((a,b)=>b.score-a.score||String(a.receipt_date).localeCompare(String(b.receipt_date)));
 return {suggestions:out.slice(0,limit),truncated:out.length>limit};
}
