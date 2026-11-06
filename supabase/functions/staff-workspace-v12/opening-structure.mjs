// The "T-structure" for a client's opening trial balance: the balance-sheet accounts of the client's approved chart, grouped by the accounting
// equation (Assets = Liabilities + Equity), each with the side a balance normally sits on. Staff fill amounts into this structure, so the
// opening trial balance can only use accounts the client's chart allows. Pure, so it is tested without a database.
export const SECTIONS=[['1','Assets'],['2','Liabilities'],['3','Equity']];

// Which side an account's closing balance normally sits on. A hint only: the importer checks that the totals agree, not each line.
export function normalSide(account){
 const name=String(account.name||'').toLowerCase(),lead=String(account.code||'')[0];
 if(lead==='1')return /accumulated|allowance|provision|impairment/.test(name)?'Credit':'Debit';
 if(lead==='2')return /advance to|prepaid|debit balance/.test(name)?'Debit':'Credit';
 return /drawing|withdrawal|treasury|accumulated loss|deficit/.test(name)?'Debit':'Credit';
}

// accounts: catalogue rows; chartCodes: Set of the approved chart's codes (null = no approved chart, which callers refuse before this).
export function openingStructure(accounts,chartCodes){
 const rows=accounts.filter(x=>x.status==='Active'&&!x.is_legacy&&String(x.code)<'40000'&&chartCodes?.has(x.code)).sort((a,b)=>String(a.code).localeCompare(String(b.code)));
 const sections=SECTIONS.map(([lead,title])=>({title,accounts:rows.filter(x=>String(x.code)[0]===lead).map(x=>({code:x.code,name:x.name,routing_code:x.category_code||'',account_group:x.account_group||'',normal_side:normalSide(x)}))}));
 return {sections,count:sections.reduce((n,s)=>n+s.accounts.length,0)};
}
