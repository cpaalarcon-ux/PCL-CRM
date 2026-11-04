// Bank-centred month/year close checks (review item 7). Pure function; the ledger read calls it.
// Bank and mobile-money statements are the cash control:
// - missing statements are "Not ready", never treated as zero;
// - every statement line must be matched or explained (mapped to an ERP account, not suspense);
// - opening-balance suspense must be cleared;
// - an own-account transfer must pair with the opposite line on a different statement: exact opposite
//   amount, dated within 3 days, each line used once;
// - statement movement must agree with the posted movement on the bank and mobile-money accounts.
// Each check names its blocker so staff see exactly what stops the close.
export const STATEMENT_ACCOUNTS=['10020','10030','10040','20080'];
const SUSPENSE='37000',WINDOW_DAYS=3;
const cents=v=>Math.round(Number(v||0)*100);
const kes=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const dayNo=d=>Math.round(Date.parse(String(d).slice(0,10)+'T00:00:00Z')/864e5);
const lineAmount=r=>cents(r.normalized?.credit)-cents(r.normalized?.debit);
const ref=r=>r.normalized?.reference||r.normalized?.description||('row '+(r.source_row??r.row_id));

export function bankCloseChecks({bankRows=[],tb=[]}={}){
 const checks=[],add=(code,label,status,detail)=>checks.push({code,label,status,detail,blocking:['Blocked','Not ready'].includes(status)});
 const statementTb=tb.filter(a=>STATEMENT_ACCOUNTS.includes(String(a.code)));
 const activity=statementTb.some(a=>Number(a.opening)||Number(a.net)||Number(a.movement_debit)||Number(a.movement_credit));
 if(!bankRows.length){
  add('STATEMENTS','Bank and mobile-money statements imported',activity?'Not ready':'Not applicable',activity?'The ledger has bank or mobile-money balances or movements, but no statement lines are imported for this period. Import every statement before closing.':'No bank or mobile-money accounts are used in this period.');
 }else add('STATEMENTS','Bank and mobile-money statements imported','Pass',`${bankRows.length} statement line(s) across ${new Set(bankRows.map(r=>r.batch_id)).size} statement(s).`);

 const unexplained=bankRows.filter(r=>!r.account_code||String(r.account_code)===SUSPENSE);
 if(bankRows.length)add('LINES_EXPLAINED','Every statement line matched or explained',unexplained.length?'Blocked':'Pass',unexplained.length?`${unexplained.length} line(s) are unmatched or in suspense, for example ${unexplained.slice(0,3).map(ref).join('; ')}.`:'All lines are mapped to an ERP account.');

 const suspense=tb.find(a=>String(a.code)===SUSPENSE);
 const suspenseNet=cents(suspense?.net);
 add('SUSPENSE_CLEAR','Suspense cleared',suspenseNet?'Blocked':'Pass',suspenseNet?`Account 37000 still holds KES ${kes(suspenseNet)}. Clear it with an evidenced adjusting journal.`:'Account 37000 is nil.');

 const transfers=bankRows.filter(r=>STATEMENT_ACCOUNTS.includes(String(r.account_code))).map(r=>({r,amount:lineAmount(r),day:dayNo(r.normalized?.date)})).sort((x,y)=>x.day-y.day||x.amount-y.amount);
 const used=new Set(),unpaired=[];
 for(const t of transfers){
  if(used.has(t.r.row_id))continue;
  const match=transfers.find(u=>u!==t&&!used.has(u.r.row_id)&&u.r.batch_id!==t.r.batch_id&&u.amount===-t.amount&&t.amount!==0&&Math.abs(u.day-t.day)<=WINDOW_DAYS);
  if(match){used.add(t.r.row_id);used.add(match.r.row_id);}else unpaired.push(t.r);
 }
 if(transfers.length)add('TRANSFERS_PAIRED','Own-account transfers paired',unpaired.length?'Blocked':'Pass',unpaired.length?`${unpaired.length} transfer line(s) have no opposite line on another statement within ${WINDOW_DAYS} days, for example ${unpaired.slice(0,3).map(ref).join('; ')}.`:`${transfers.length/2} transfer pair(s) matched exactly.`);

 if(bankRows.length){
  const statementNet=bankRows.reduce((n,r)=>n+lineAmount(r),0);
  const ledgerNet=statementTb.reduce((n,a)=>n+cents(a.movement_debit)-cents(a.movement_credit),0);
  const diff=statementNet-ledgerNet;
  add('STATEMENT_TO_LEDGER','Statement movement agrees with the posted bank movement',diff?'Blocked':'Pass',diff?`Statements show a net movement of KES ${kes(statementNet)}; posted movement on bank and mobile-money accounts is KES ${kes(ledgerNet)}. Difference KES ${kes(diff)}: post or explain the missing entries.`:`Both show KES ${kes(statementNet)}.`);
  add('STATEMENT_BALANCES','Statement opening and closing balances','Not checked','The bank import does not capture statement balances. Compare each statement\'s opening and closing balance with the ledger and keep the evidence.');
 }
 return {checks,blocking:checks.filter(c=>c.blocking).map(c=>`${c.label}: ${c.detail}`)};
}
