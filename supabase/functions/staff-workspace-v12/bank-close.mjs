// Bank-centred month/year close checks (review item 7). Pure function; the ledger read calls it.
// Bank and mobile-money statements are the cash control:
// - missing statements are "Not ready", never treated as zero;
// - every statement line must be matched or explained (mapped to an ERP account; there is no suspense account);
// - an own-account transfer must pair with the opposite line on a different statement: exact opposite
//   amount, dated within 3 days, each line used once;
// - statement movement must agree with the posted movement on the bank and mobile-money accounts.
// Each check names its blocker so staff see exactly what stops the close.
export const STATEMENT_ACCOUNTS=['10020','10030','10040','20080'];
// Ledger accounts that can carry a registered bank, savings or mobile-money account (10021-10028 are the additional bank accounts).
export const BANK_LEDGER_CODES=[...STATEMENT_ACCOUNTS,...Array.from({length:8},(_,i)=>String(10021+i))];
export const BANK_KINDS=['Bank current','Bank savings','Mobile money','Overdraft','Other'];
const WINDOW_DAYS=3;
const cents=v=>Math.round(Number(v||0)*100);
const kes=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const dayNo=d=>Math.round(Date.parse(String(d).slice(0,10)+'T00:00:00Z')/864e5);
const lineAmount=r=>cents(r.normalized?.credit)-cents(r.normalized?.debit);
const ref=r=>r.normalized?.reference||r.normalized?.description||('row '+(r.source_row??r.row_id));

// Statement balances: when the import maps a balance column, every line's running balance must equal the
// previous balance plus the line's movement, and each statement's opening and closing balance is shown.
function balanceCheck(rows){
 const label='Statement opening and closing balances';
 const withBalance=rows.filter(r=>r.normalized?.balance!=null&&r.normalized.balance!=='');
 if(!withBalance.length)return ['STATEMENT_BALANCES',label,'Not checked','No balance column was mapped when the statements were imported. Map the balance column to check opening and closing balances, or compare them by hand and keep the evidence.'];
 const byStatement=new Map();for(const r of rows){const list=byStatement.get(r.batch_id)||[];list.push(r);byStatement.set(r.batch_id,list);}
 const breaks=[],missing=[],summary=[];
 for(const [batch,list] of byStatement){
  list.sort((x,y)=>String(x.normalized?.date).localeCompare(String(y.normalized?.date))||Number(x.source_row||0)-Number(y.source_row||0));
  const gaps=list.filter(r=>r.normalized?.balance==null||r.normalized.balance==='');
  if(gaps.length){missing.push(`${gaps.length} line(s) without a balance`);continue;}
  for(let i=1;i<list.length;i++){const expected=cents(list[i-1].normalized.balance)+lineAmount(list[i]);if(cents(list[i].normalized.balance)!==expected)breaks.push(`${ref(list[i])} shows KES ${kes(cents(list[i].normalized.balance))}, expected KES ${kes(expected)}`);}
  const opening=cents(list[0].normalized.balance)-lineAmount(list[0]),closing=cents(list[list.length-1].normalized.balance);
  summary.push(`opening KES ${kes(opening)} → closing KES ${kes(closing)}`);
 }
 if(missing.length||breaks.length)return ['STATEMENT_BALANCES',label,'Blocked',[...missing,...breaks.slice(0,3)].join('; ')+(breaks.length>3?` and ${breaks.length-3} more break(s)`:'')+'. Check the statement import.'];
 return ['STATEMENT_BALANCES',label,'Pass',`Running balances are continuous on ${summary.length} statement(s): ${summary.join('; ')}.`];
}

export function bankCloseChecks({bankRows=[],tb=[],explanations=[],bankAccounts=[]}={}){
 const checks=[],add=(code,label,status,detail)=>checks.push({code,label,status,detail,blocking:['Blocked','Not ready'].includes(status)});
 const statementTb=tb.filter(a=>BANK_LEDGER_CODES.includes(String(a.code)));
 const activity=statementTb.some(a=>Number(a.opening)||Number(a.net)||Number(a.movement_debit)||Number(a.movement_credit));
 if(!bankRows.length){
  add('STATEMENTS','Bank and mobile-money statements imported',activity?'Not ready':'Not applicable',activity?'The ledger has bank or mobile-money balances or movements, but no statement lines are imported for this period. Import every statement before closing.':'No bank or mobile-money accounts are used in this period.');
 }else add('STATEMENTS','Bank and mobile-money statements imported','Pass',`${bankRows.length} statement line(s) across ${new Set(bankRows.map(r=>r.batch_id)).size} statement(s).`);

 const unexplained=bankRows.filter(r=>!r.account_code);
 if(bankRows.length)add('LINES_EXPLAINED','Every statement line matched or explained',unexplained.length?'Blocked':'Pass',unexplained.length?`${unexplained.length} line(s) are not mapped to an ERP account, for example ${unexplained.slice(0,3).map(ref).join('; ')}.`:'All lines are mapped to an ERP account.');

 const transfers=bankRows.filter(r=>BANK_LEDGER_CODES.includes(String(r.account_code))).map(r=>({r,amount:lineAmount(r),day:dayNo(r.normalized?.date)})).sort((x,y)=>x.day-y.day||x.amount-y.amount);
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
  const accepted=diff?explanations.find(e=>e.check_code==='STATEMENT_TO_LEDGER'&&e.status==='Accepted'&&Number(e.difference_cents)===diff):null;
  const pendingExplanation=diff?explanations.find(e=>e.check_code==='STATEMENT_TO_LEDGER'&&e.status==='Submitted'&&Number(e.difference_cents)===diff):null;
  const gap=`Statements show a net movement of KES ${kes(statementNet)}; posted movement on bank and mobile-money accounts is KES ${kes(ledgerNet)}. Difference KES ${kes(diff)}`;
  add('STATEMENT_TO_LEDGER','Statement movement agrees with the posted bank movement',!diff?'Pass':accepted?'Explained':'Blocked',!diff?`Both show KES ${kes(statementNet)}.`:accepted?`${gap}, accepted as explained: ${accepted.explanation} (evidence ${accepted.evidence_reference}).`:pendingExplanation?`${gap}. An explanation is waiting for a different Manager or Partner to review it.`:`${gap}: post the missing entries, or record an evidenced explanation for review.`);
  checks[checks.length-1].difference_cents=diff;checks[checks.length-1].explanation=accepted||pendingExplanation||null;
  add(...balanceCheck(bankRows));
 }
 const banks=bankAccountChecks({bankRows,tb,statementTb,bankAccounts,add,overallDiff:bankRows.length?bankRows.reduce((n,r)=>n+lineAmount(r),0)-statementTb.reduce((n,a)=>n+cents(a.movement_debit)-cents(a.movement_credit),0):0});
 return {checks,banks,blocking:checks.filter(c=>c.blocking).map(c=>`${c.label}: ${c.detail}`)};
}

// Per-bank checks, only for a client that has registered its banks. A client with no register keeps the combined checks above.
// Each statement is tied to one bank, and each bank is compared with its own ledger account.
function bankAccountChecks({bankRows,tb,statementTb,bankAccounts,add,overallDiff}){
 const registered=(bankAccounts||[]).filter(b=>b&&b.gl_code);
 if(!registered.length)return [];
 const net=code=>{const a=statementTb.find(x=>String(x.code)===String(code));return a?cents(a.movement_debit)-cents(a.movement_credit):0;};
 const covered=new Set(registered.map(b=>String(b.gl_code)));
 const unregistered=statementTb.filter(a=>!covered.has(String(a.code))&&(Number(a.movement_debit)||Number(a.movement_credit)));
 if(unregistered.length)add('BANK_UNREGISTERED','Every bank ledger account in use is registered','Blocked',`Movement is posted on ${unregistered.map(a=>`${a.code} ${a.name||''}`.trim()).join('; ')} but no bank account is registered for ${unregistered.length===1?'it':'them'}. Register the bank or correct the posting.`);
 else add('BANK_UNREGISTERED','Every bank ledger account in use is registered','Pass',`${registered.length} registered bank account(s) cover all bank and mobile-money ledger accounts used.`);
 const rows=registered.map(b=>{
  const mine=bankRows.filter(r=>r.bank_account_id===b.bank_account_id),statement=mine.reduce((n,r)=>n+lineAmount(r),0),ledger=net(b.gl_code);
  const label=`${b.bank_name}${b.account_label?' '+b.account_label:''}${b.account_last4?' ····'+b.account_last4:''}`;
  const used=mine.length>0||ledger!==0;
  return {bank_account_id:b.bank_account_id,label,gl_code:String(b.gl_code),kind:b.kind,status:b.status,lines:mine.length,statement_net:statement/100,ledger_net:ledger/100,difference:(statement-ledger)/100,
   state:!used?'Not used':!mine.length?'No statement':statement===ledger?'Agrees':'Differs',_diff:statement-ledger};
 });
 const unlinked=bankRows.filter(r=>!r.bank_account_id);
 if(unlinked.length){
  add('BANK_LINKED','Every statement is tied to a registered bank','Review',`${unlinked.length} statement line(s) were imported before the banks were registered and are not tied to a bank, so each bank cannot be compared with its own ledger account. The combined check above still applies. Archive and re-import those statements against a bank to compare them one by one.`);
 }else{
  const missing=rows.filter(r=>r.state==='No statement');
  add('BANK_STATEMENTS','A statement is imported for every bank with posted movement',missing.length?'Not ready':'Pass',missing.length?`No statement is imported for ${missing.map(r=>r.label).join('; ')}, although the ledger has movement on ${missing.length===1?'its account':'their accounts'}.`:'Every bank with posted movement has a statement.');
  const differs=rows.filter(r=>r.state==='Differs');
  const detail=differs.slice(0,4).map(r=>`${r.label}: statement KES ${kes(Math.round(r.statement_net*100))}, ledger KES ${kes(Math.round(r.ledger_net*100))}`).join('; ')+(differs.length>4?` and ${differs.length-4} more`:'');
  // Combined agreement can hide errors that cancel across banks, so a per-bank difference blocks when the combined check passes.
  add('BANK_EACH_AGREES','Each bank statement agrees with its own ledger account',!differs.length?'Pass':overallDiff===0?'Blocked':'Review',!differs.length?'Each bank matches its ledger account.':overallDiff===0?`The combined totals agree but individual banks do not, which usually means a posting to the wrong bank or an offsetting error. ${detail}.`:`${detail}. The combined difference is handled by the check above.`);
 }
 return rows.map(({_diff,...r})=>r);
}
