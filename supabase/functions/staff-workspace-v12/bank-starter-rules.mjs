// Starter narration rules for bank statement lines (build 2783). A firm-wide list of suggestions that a preparer can copy into one client as PROPOSED rules.
// Nothing here is applied by itself: each copied rule still needs a different Manager or Partner to approve it, exactly like a rule typed by hand.
// The list holds no tax rate and no tax rule. A rule whose treatment depends on a tax ruling stays locked until the Tax Lead's written confirmation is recorded.
// Deliberately NOT in the list: a blanket "TRF TO" / "TRANSFER" rule. A transfer to a supplier is not an own-account transfer, so such lines stay with a person.
import {norm} from './bank-rules.mjs';

export const STARTER_RULES=[
 {key:'ledger-fee',keyword:'ledger fee',match_mode:'Contains',direction:'Money out',account_code:'62510',label:'Ledger fee',why:'Banks charge a monthly ledger fee on a current account. It is a bank service charge.'},
 {key:'commission-on-turnover',keyword:'commission on turnover',match_mode:'Contains',direction:'Money out',account_code:'62500',label:'Commission on turnover',why:'A bank fee charged on the money passing through the account. Shown as a bank transaction fee.'},
 {key:'bank-charges',keyword:'bank charges',match_mode:'Contains',direction:'Money out',account_code:'62570',label:'Bank charges',why:'General bank charges. The reviewer can retire this and propose a more specific account if the client needs one.'},
 {key:'loan-interest',keyword:'loan interest',match_mode:'Contains',direction:'Money out',account_code:'62000',label:'Loan interest',why:'Interest taken by the lender. Only the interest part: a loan repayment is a separate line and needs a person.'},
 {key:'overdraft-interest',keyword:'overdraft interest',match_mode:'Contains',direction:'Money out',account_code:'62030',label:'Overdraft interest',why:'Interest charged on an overdrawn account.'},
 {key:'excise-duty',keyword:'excise duty',match_mode:'Contains',direction:'Money out',account_code:'51070',label:'Excise duty on bank charges',why:'Excise duty charged on bank fees, treated as an expense rather than recoverable.',needs:'Tax Lead',needs_note:'Locked: the Tax Lead has not confirmed in writing that excise duty on bank charges is an expense (51070) rather than recoverable (10180). It can be unlocked only after a Partner records that confirmation.'},
];

// Why a starter cannot be copied into this client, or null when it can. existing: the client's rules; chartCodes: Set of account codes in the client's chart.
// confirmed: Map of rule key -> the account code a Partner recorded the Tax Lead's written confirmation for (build 2788). A locked starter opens only when
// the recorded account is the starter's own account, so a confirmation for one account never unlocks a rule that points at another.
export function starterProblem(s,existing=[],chartCodes=new Set(),confirmed=new Map()){
 if(s.needs&&confirmed.get(s.key)!==s.account_code)return s.needs_note;
 const dup=(existing||[]).find(r=>r.status!=='Retired'&&norm(r.keyword)===norm(s.keyword)&&r.match_mode===s.match_mode&&r.direction===s.direction);
 if(dup)return dup.status==='Active'?'The client already has this rule, approved.':'The client already has this rule, waiting for approval.';
 if(!chartCodes.has(s.account_code))return 'Account '+s.account_code+' is not in this client\'s chart of accounts.';
 return null;
}
export const starterList=(existing,chartCodes,confirmed=new Map())=>STARTER_RULES.map(s=>({...s,problem:starterProblem(s,existing,chartCodes,confirmed),unlocked:!!s.needs&&confirmed.get(s.key)===s.account_code}));
// Rows of starter_rule_confirmations with status Confirmed -> the Map that starterList takes.
export const confirmedMap=rows=>new Map((rows||[]).filter(r=>r.status==='Confirmed').map(r=>[r.rule_key,r.account_code]));
// The locked starters, for the Settings card: each with its confirmation if one is recorded.
export const lockedStarters=rows=>STARTER_RULES.filter(s=>s.needs).map(s=>{const c=(rows||[]).find(r=>r.rule_key===s.key&&r.status==='Confirmed');return {key:s.key,label:s.label,keyword:s.keyword,account_code:s.account_code,needs:s.needs,why:s.why,locked:!(c&&c.account_code===s.account_code),confirmation:c||null};});
