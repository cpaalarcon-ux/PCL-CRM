// Statement balance proof and the bank reconciliation summary. Pure functions.
import {BANK_LEDGER_CODES} from './bank-close.mjs';
const cents=v=>Math.round((Number(v)+Number.EPSILON)*100);
const has=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
const kes=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const UNPAID_CHEQUES_ACCOUNT='10065';
// Money-out groups, by the ledger account a line is mapped to. Drawings and distributions and loan repayments are balance sheet
// items, not expenses; finance costs are the 62xxx accounts. Everything else mapped is other expenditure. A person still chooses the account.
export const DRAWINGS_CODES=['35010','36020','20140'];
export const LOAN_REPAYMENT_CODES=['20070','20090','20100'];
export const isFinanceCostCode=c=>/^62\d{3}$/.test(String(c));
export function outGroup(code){
 const c=String(code||'');
 if(!c)return 'unclassified';
 if(BANK_LEDGER_CODES.includes(c))return 'transfers';
 if(c===UNPAID_CHEQUES_ACCOUNT)return 'cheques';
 if(DRAWINGS_CODES.includes(c))return 'drawings';
 if(LOAN_REPAYMENT_CODES.includes(c))return 'loans';
 if(isFinanceCostCode(c))return 'finance';
 return 'other';
}
export const OUT_LABELS={transfers:'Own-account transfers out',drawings:'Drawings and distributions (owner, partner, dividends)',loans:'Loan and lease repayments (not expenses)',finance:'Finance costs (bank charges, loan interest)',other:'Other expenditure (suppliers, rent, salaries, tax payments)',cheques:'Unpaid (dishonoured) cheques - returned by the bank',unclassified:'Not yet classified (no account mapped)'};
const net=r=>cents(r.credit||0)-cents(r.debit||0);

// Opening balance + money in - money out must equal the closing balance. The proof comes from the running-balance column,
// from the opening and closing balances typed from the statement, or both (they must then agree). With neither, it is "Not checked".
export function reconcileStatement({rows=[],declaredOpening=null,declaredClosing=null}={}){
 const issues=[],moneyIn=rows.reduce((n,r)=>n+cents(r.credit||0),0),moneyOut=rows.reduce((n,r)=>n+cents(r.debit||0),0),movement=moneyIn-moneyOut;
 const dOpen=has(declaredOpening)?cents(declaredOpening):null,dClose=has(declaredClosing)?cents(declaredClosing):null;
 if((dOpen===null)!==(dClose===null))issues.push('Enter both the opening and the closing balance shown on the statement, or neither.');
 let derived=null;
 if(rows.length&&rows.every(r=>has(r.balance))){
  const ordered=[...rows].sort((a,b)=>a.source_row-b.source_row),tryOrder=list=>{const breaks=[];for(let i=1;i<list.length;i++){const expected=cents(list[i-1].balance)+net(list[i]);if(cents(list[i].balance)!==expected)breaks.push(`row ${list[i].source_row} shows ${kes(cents(list[i].balance))}, expected ${kes(expected)}`);}return breaks;};
  const asc=tryOrder(ordered),desc=tryOrder([...ordered].reverse());
  if(!asc.length||!desc.length){const list=!asc.length?ordered:[...ordered].reverse();derived={opening:cents(list[0].balance)-net(list[0]),closing:cents(list[list.length-1].balance)};}
  else issues.push(`The running balance is not continuous: ${asc.slice(0,3).join('; ')}${asc.length>3?` and ${asc.length-3} more`:''}.`);
 }
 if(dOpen!==null&&dClose!==null&&dOpen+movement!==dClose)issues.push(`Opening ${kes(dOpen)} + money in ${kes(moneyIn)} - money out ${kes(moneyOut)} = ${kes(dOpen+movement)}, but the statement closing balance is ${kes(dClose)} (difference ${kes(dClose-dOpen-movement)}).`);
 if(derived&&dOpen!==null&&dClose!==null&&(derived.opening!==dOpen||derived.closing!==dClose))issues.push(`The running-balance column gives opening ${kes(derived.opening)} and closing ${kes(derived.closing)}, which differ from the balances you entered (${kes(dOpen)} and ${kes(dClose)}).`);
 const checked=derived!==null||(dOpen!==null&&dClose!==null);
 const open=dOpen??derived?.opening??null,close=dClose??derived?.closing??null;
 return {status:issues.length?'Fail':checked?'Pass':'Not checked',issues,money_in:moneyIn/100,money_out:moneyOut/100,opening:open===null?null:open/100,closing:close===null?null:close/100};
}

// Consecutive statements of one bank must join up: each opening balance equals the previous closing balance.
export function statementContinuity(statements=[]){
 const by=new Map();for(const s of statements){if(!s.bank_account_id||!has(s.statement_opening)||!has(s.statement_closing))continue;const l=by.get(s.bank_account_id)||[];l.push(s);by.set(s.bank_account_id,l);}
 const gaps=[];
 for(const list of by.values()){list.sort((a,b)=>String(a.period_start).localeCompare(String(b.period_start))||String(a.period_end).localeCompare(String(b.period_end)));
  for(let i=1;i<list.length;i++){const prev=list[i-1],next=list[i];if(cents(next.statement_opening)!==cents(prev.statement_closing))gaps.push({bank_account_id:next.bank_account_id,from:String(prev.period_end).slice(0,10),to:String(next.period_start).slice(0,10),previous_closing:Number(prev.statement_closing),next_opening:Number(next.statement_opening)});}}
 return {compared:[...by.values()].reduce((n,l)=>n+Math.max(0,l.length-1),0),gaps};
}

// Money-in summary: trade bankings are what is left once own-account transfers, the client's own non-trade categories,
// cheques the bank returned unpaid (money out mapped to account 10065, for every client) and lines not yet classified are taken out.
// A returned cheque that is later presented again and clears is ordinary money in, so it stays in trade bankings. Nothing is guessed: an unmapped line is shown as such, never as trade.
export function bankSummary({rows=[],categories=[],bankAccounts=[],bankAccountId=null,lineLimit=200}={}){
 const label=new Map(bankAccounts.map(b=>[b.bank_account_id,b.bank_name+(b.account_label?' '+b.account_label:'')]));
 const use=bankAccountId?rows.filter(r=>r.bank_account_id===bankAccountId):rows;
 const live=categories.filter(c=>c.status==='Active');
 const sections=[{key:'transfers',label:'Own-account transfers in',cents:0,count:0,lines:[]},...live.map(c=>({key:'cat:'+c.category_id,label:c.name,cents:0,count:0,lines:[],category_id:c.category_id})),{key:'cheques',label:'Unpaid (dishonoured) cheques - returned by the bank',cents:0,count:0,lines:[]},{key:'unclassified',label:'Not yet classified (no account mapped)',cents:0,count:0,lines:[]},{key:'trade',label:'Trade bankings',cents:0,count:0,lines:[],total:true}];
 const out={total:0,transfers:0,unclassified:0,cheques:0,other:0},sec=k=>sections.find(s=>s.key===k);
 const outSections=['transfers','drawings','loans','finance','other','cheques','unclassified'].map(k=>({key:'out:'+k,label:OUT_LABELS[k],cents:0,count:0,lines:[]})),osec=k=>outSections.find(x=>x.key==='out:'+k);
 let moneyIn=0;
 const view=r=>({row_id:r.row_id,date:r.normalized?.date||null,reference:r.normalized?.reference||'',description:r.normalized?.description||'',amount:Number(r.normalized?.credit||0),account_code:r.account_code||null,bank:label.get(r.bank_account_id)||null});
 for(const r of use){
  const cin=cents(r.normalized?.credit||0),cout=cents(r.normalized?.debit||0);
  if(cout>0){const og=osec(outGroup(r.account_code));og.cents+=cout;og.count++;if(og.lines.length<lineLimit)og.lines.push({...view(r),amount:cout/100});out.total+=cout;if(!r.account_code)out.unclassified+=cout;else if(BANK_LEDGER_CODES.includes(String(r.account_code)))out.transfers+=cout;else if(String(r.account_code)===UNPAID_CHEQUES_ACCOUNT){out.cheques+=cout;const c=sec('cheques');c.cents+=cout;c.count++;if(c.lines.length<lineLimit)c.lines.push({...view(r),amount:cout/100});}else out.other+=cout;}
  if(cin<=0)continue;
  moneyIn+=cin;
  const key=!r.account_code?'unclassified':BANK_LEDGER_CODES.includes(String(r.account_code))?'transfers':(live.find(c=>(c.account_codes||[]).includes(String(r.account_code)))?'cat:'+live.find(c=>(c.account_codes||[]).includes(String(r.account_code))).category_id:'trade');
  const s=sec(key);s.cents+=cin;s.count++;if(s.lines.length<lineLimit)s.lines.push(view(r));
 }
 sec('trade').cents-=sec('cheques').cents;
 const inBuckets=sections.reduce((n,x)=>n+x.cents,0),outBuckets=outSections.reduce((n,x)=>n+x.cents,0);
 return {money_in:moneyIn/100,sections:sections.map(s=>({key:s.key,label:s.label,amount:s.cents/100,count:s.count,lines:s.lines,truncated:s.count>s.lines.length,is_total:!!s.total,category_id:s.category_id||null})),
  money_out_sections:outSections.map(x=>({key:x.key,label:x.label,amount:x.cents/100,count:x.count,lines:x.lines,truncated:x.count>x.lines.length})),
  tie_out:{money_in:{buckets:inBuckets/100,total:moneyIn/100},money_out:{buckets:outBuckets/100,total:out.total/100}},
  trade_bankings:sec('trade').cents/100,money_out:{total:out.total/100,own_transfers:out.transfers/100,unpaid_cheques:out.cheques/100,not_classified:out.unclassified/100,other_mapped:out.other/100},lines:use.length};
}
