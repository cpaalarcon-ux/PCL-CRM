// The approved routing map (build 2802). Pure rules: what a mapping may contain, and how a routing code is matched to exactly one approved client
// account on a date. Nothing here posts, approves or guesses. A row that has no single approved, date-valid match is left for staff with the reason.
export const MODULES=['Purchases','Sales','Payroll'];
// Payroll codes, each with the side of the account it posts to. Gross pay, allowances, overtime and bonuses are costs (debit); deductions, employer
// contributions' liabilities and net pay are credits; the bank payment credits the bank account.
export const PAYROLL_CODES=[
 {code:'GROSS_SALARY',label:'Gross salaries',side:'Debit'},{code:'ALLOWANCES',label:'Allowances',side:'Debit'},{code:'OVERTIME',label:'Overtime',side:'Debit'},{code:'BONUS',label:'Bonuses',side:'Debit'},
 {code:'PAYE',label:'PAYE payable',side:'Credit'},{code:'NSSF_EMPLOYEE',label:'NSSF, employee share',side:'Credit'},{code:'SHIF',label:'SHIF payable',side:'Credit'},{code:'AHL_EMPLOYEE',label:'Housing levy, employee share',side:'Credit'},{code:'OTHER_DEDUCTIONS',label:'Other employee deductions',side:'Credit'},
 {code:'NSSF_EMPLOYER',label:'NSSF, employer share (expense)',side:'Debit'},{code:'AHL_EMPLOYER',label:'Housing levy, employer share (expense)',side:'Debit'},{code:'NITA_EMPLOYER',label:'NITA (expense)',side:'Debit'},
 {code:'NITA_PAYABLE',label:'NITA payable',side:'Credit'},
 {code:'NET_PAY_PAYABLE',label:'Net salary payable',side:'Credit'},{code:'PAYROLL_BANK_PAYMENT',label:'Payroll bank payment',side:'Credit'}
];
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const cleanCode=v=>String(v??'').trim().toUpperCase();
export function payrollSide(code){return PAYROLL_CODES.find(x=>x.code===cleanCode(code))?.side||null;}
// Check one proposed mapping before it is saved. Returns the issues; an empty list means it can be saved as a Draft.
export function proposalIssues(p,accounts=[]){
 const out=[],module=String(p.module||''),code=cleanCode(p.routing_code),item=p.item_code?String(p.item_code).trim():'';
 if(!MODULES.includes(module))out.push('Choose Purchases, Sales or Payroll.');
 if(!/^[A-Z][A-Z0-9_]{1,29}$/.test(code))out.push('The routing code must start with a letter and use letters, numbers or underscores (for example EXP01).');
 if(module==='Payroll'&&!PAYROLL_CODES.some(x=>x.code===code))out.push('Choose one of the payroll codes.');
 if(item&&module!=='Purchases')out.push('A TB item code is only used to choose between accounts for a purchase routing code.');
 if(item&&!/^\d{5}$/.test(item))out.push('A TB item code has five digits.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day(p.effective_from)))out.push('Enter the date the mapping starts.');
 if(p.effective_to&&day(p.effective_to)<day(p.effective_from))out.push('The end date cannot be before the start date.');
 const account=accounts.find(x=>String(x.code)===String(p.erp_account_code));
 if(!account)out.push('Choose an account from the chart of accounts.');
 else{
  if(account.status!=='Active'||account.is_legacy)out.push(`Account ${account.code} is not active in the chart of accounts.`);
  if(module==='Purchases'&&![1,2,3].includes(Number(account.route)))out.push(`Account ${account.code} is not a purchase account (stock, expense or fixed asset).`);
 }
 return out;
}
// Match one row. maps: the client's mappings (any status). Only Active ones valid on the date count.
// Returns {status:'mapped',mapping} or {status, code, reason} with status none | multiple | item_required | item_unmapped | file_differs.
export function resolveRouting(maps,{module,routing_code,item_code,date}){
 const code=cleanCode(routing_code),at=day(date),item=item_code?String(item_code).trim():'';
 if(!code)return {status:'none',code:'ROUTING_BLANK',reason:'The row has no routing code.'};
 const live=(maps||[]).filter(m=>m.status==='Active'&&m.module===module&&cleanCode(m.routing_code)===code&&day(m.effective_from)<=at&&(!m.effective_to||day(m.effective_to)>=at));
 if(!live.length){
  const ever=(maps||[]).some(m=>m.module===module&&cleanCode(m.routing_code)===code&&m.status==='Active');
  return {status:'none',code:'ROUTING_UNMAPPED',reason:ever?`Routing code ${code} has an approved mapping, but not one that covers ${at}. A Manager or Partner adds a dated mapping for this period.`:`Routing code ${code} has no approved mapping for this client. A Manager or Partner approves it once in Settings, Client routing map, and every row with this code is then mapped.`};
 }
 if(item){
  const exact=live.filter(m=>m.item_code===item);
  if(exact.length===1)return {status:'mapped',mapping:exact[0]};
  if(exact.length>1)return {status:'multiple',code:'ROUTING_MULTIPLE',reason:`More than one approved mapping covers routing code ${code} with TB item code ${item} on ${at}. Withdraw the extra one.`};
 }
 const generic=live.filter(m=>!m.item_code);
 if(generic.length===1){
  if(item&&item!==String(generic[0].erp_account_code))return {status:'file_differs',code:'ROUTING_FILE_DIFFERS',reason:`The file gives TB item code ${item} for routing code ${code}, but the approved mapping is account ${generic[0].erp_account_code}. Add an approved mapping for ${code} with TB item code ${item}, or correct the file.`};
  return {status:'mapped',mapping:generic[0]};
 }
 if(generic.length>1)return {status:'multiple',code:'ROUTING_MULTIPLE',reason:`More than one approved mapping covers routing code ${code} on ${at}. Withdraw the extra one.`};
 if(!item)return {status:'item_required',code:'ROUTING_ITEM_REQUIRED',reason:`Routing code ${code} has several approved accounts (${[...new Set(live.map(m=>m.item_code))].join(', ')}). The row needs its TB item code (column N) to choose one.`};
 return {status:'item_unmapped',code:'ROUTING_ITEM_UNMAPPED',reason:`TB item code ${item} is not among the approved accounts for routing code ${code} (${[...new Set(live.map(m=>m.item_code))].join(', ')}). Add an approved mapping for it.`};
}
// Group the rows left unmapped by routing code, so one approved mapping clears a whole group.
export function unmappedByCode(exceptions){
 const by=new Map();
 for(const e of exceptions||[]){if(!e.routing_code)continue;const k=e.routing_code;by.set(k,{routing_code:k,rows:(by.get(k)?.rows||0)+1,code:e.code});}
 return [...by.values()].sort((a,b)=>b.rows-a.rows||a.routing_code.localeCompare(b.routing_code));
}
export const ROUTING_METHOD_LABEL='Auto-mapped — approved routing map';
// A row mapped by the routing map stays valid only while that same approved mapping still covers the invoice date and gives the same account.
export function routingConfirmed(confirmation,accountCode,date,maps){
 if(confirmation?.method!==ROUTING_METHOD_LABEL||!confirmation.routing_map_id)return false;
 const at=day(date),m=(maps||[]).find(x=>x.routing_id===confirmation.routing_map_id);
 return !!m&&m.status==='Active'&&String(m.erp_account_code)===String(accountCode)&&String(confirmation.tb_item_code)===String(accountCode)&&day(m.effective_from)<=at&&(!m.effective_to||day(m.effective_to)>=at);
}
// Client supplier aliases (build 2899, amendment F to rule A). One fixed clean-up and an exact comparison; nothing fuzzy ever maps a row.
// The clean-up: lower case, every run of spaces and punctuation becomes one space, trimmed. Two texts match only when they are identical after it.
export const aliasKey=v=>String(v??'').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function aliasIssues(p){
 const out=[],party=aliasKey(p.party),desc=aliasKey(p.description),code=cleanCode(p.routing_code),item=String(p.item_code??'').trim();
 if(party.length<2)out.push('Give the supplier name exactly as it is written on the invoices (at least 2 letters or digits).');
 if(party.length>200)out.push('The supplier name is too long.');
 if(p.description&&desc.length<2)out.push('The description, if used, needs at least 2 letters or digits.');
 if(desc.length>300)out.push('The description is too long.');
 if(!/^[A-Z][A-Z0-9_]{1,29}$/.test(code))out.push('The routing code must start with a letter and use letters, numbers or underscores (for example EXP01).');
 if(!/^\d{5}$/.test(item))out.push('A TB item code has five digits.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day(p.effective_from)))out.push('Enter the date the alias starts.');
 if(p.effective_to&&day(p.effective_to)<day(p.effective_from))out.push('The end date cannot be before the start date.');
 return out;
}
// Find the one approved alias for a row on its invoice date. aliases: the client's aliases (any status); only Active ones valid on the date count.
// A description-specific alias wins over a supplier-only alias; two aliases at the same level are ambiguous and map nothing.
// Returns {status:'alias',alias} or {status:'none'|'multiple', code, reason}.
export function resolveAlias(aliases,{party,description,date}){
 const pk=aliasKey(party),dk=aliasKey(description),at=day(date);
 if(!pk)return {status:'none',code:'ALIAS_NONE',reason:'The row has no supplier name to match an alias.'};
 const live=(aliases||[]).filter(x=>x.status==='Active'&&x.party_key===pk&&day(x.effective_from)<=at&&(!x.effective_to||day(x.effective_to)>=at));
 if(!live.length)return {status:'none',code:'ALIAS_NONE',reason:'No approved alias covers this supplier on this date.'};
 const specific=live.filter(x=>x.description_key&&x.description_key===dk);
 if(specific.length===1)return {status:'alias',alias:specific[0]};
 if(specific.length>1)return {status:'multiple',code:'ALIAS_MULTIPLE',reason:'More than one approved alias covers this supplier and description. Withdraw the extra one.'};
 const generic=live.filter(x=>!x.description_key);
 if(generic.length===1)return {status:'alias',alias:generic[0]};
 if(generic.length>1)return {status:'multiple',code:'ALIAS_MULTIPLE',reason:'More than one approved alias covers this supplier. Withdraw the extra one.'};
 return {status:'none',code:'ALIAS_NONE',reason:'This supplier has an approved alias, but not for this description.'};
}
export const ALIAS_NOTE_LABEL='Mapped by approved alias';
