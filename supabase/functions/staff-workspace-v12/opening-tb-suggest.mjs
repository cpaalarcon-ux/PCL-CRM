// Suggested ERP accounts for opening trial balance lines, so staff confirm instead of searching.
// Two sources, never applied without the preparer's confirmation:
//   1. Learned: the ERP account other clients of the same firm mapped the same source code or name to (approved mappings only).
//   2. Rules: the wording of the account name, read for the client's legal structure (a partnership's "Capital" is not a company's "Capital").
// A suggestion is only offered when the account is active, detailed, a balance-sheet or equity account, valid for the client's legal structure
// and inside the client's approved chart of accounts.
export const normaliseName=v=>String(v||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

export const entityKey=t=>{
 const s=String(t||'').toLowerCase();
 if(/partner/.test(s))return 'partnership';
 if(/sole|proprietor|individual/.test(s))return 'sole';
 if(/limited|company|ltd|plc/.test(s))return 'company';
 if(/non.?profit|ngo|trust|society|association/.test(s))return 'npo';
 return '';
};

const PEOPLE=/\b(partner|partners|director|directors|owner|owners|proprietor|shareholder|shareholders|member|members)\b/;
const DEP_PARTS=[[/building|premises/,'15900'],[/plant|machinery/,'15910'],[/vehicle|motor|truck|lorry/,'15920'],[/furniture|fitting|fixture/,'15930'],[/computer|laptop|printer|ict/,'15940'],[/equipment|equip|tools/,'15950'],[/software/,'15970'],[/right of use|rou/,'15960']];

// Each rule: [test, code or per-entity codes, exact phrase (High confidence when the whole name is this), label]
const rules=[
 // Accumulated depreciation is read before the assets it relates to.
 {test:n=>/\b(accumulated|accum|acc)\b.*\b(depreciation|dep|amortisation|amortization|impairment)\b|\bprovision for depreciation\b/.test(n),pick:n=>{const hit=DEP_PARTS.find(([re])=>re.test(n));return hit?hit[1]:'15990';},label:'accumulated depreciation'},
 {test:n=>/overdraft/.test(n),code:'20080',exact:/^(bank )?overdrafts?( account)?$/,label:'bank overdraft'},
 {test:n=>/petty cash|imprest/.test(n)&&!/staff|employee/.test(n),code:'10010',exact:/^petty cash( float)?$/,label:'petty cash'},
 {test:n=>/^(cash( on)? hand|cash in hand|cash|cash balance|cash and cash equivalents)$/.test(n),code:'10000',exact:/.*/,label:'cash on hand'},
 {test:n=>/(m ?pesa|mobile money|airtel money|paybill|till number|pesapal|payment gateway)/.test(n),code:'10040',exact:/^(m ?pesa|mpesa float|mobile money)( account)?$/,label:'mobile money'},
 {test:n=>/saving/.test(n)&&/(bank|account|sacco|deposit)/.test(n)&&!PEOPLE.test(n),code:'10030',exact:/^(bank )?savings( account)?$/,label:'savings account'},
 {test:n=>!PEOPLE.test(n)&&/\b(bank|bnk|kcb|equity|ncba|absa|stanbic|dtb|family bank|co op bank|cooperative bank|i m bank|im bank|standard chartered|national bank|gulf african|sidian|bank of africa|cash at bank|current account)\b/.test(n)&&!/loan|overdraft|interest|charges|accrued|payable/.test(n),code:'10020',exact:/^(cash at bank|bank|bank account|bank balances?|cash at bank and in hand)$/,label:'bank account'},
 {test:n=>/customer (deposit|advance)|advances? from customers|deposits? from customers/.test(n),code:'20030',label:'customer deposits'},
 {test:n=>/deferred (revenue|income)|unearned (revenue|income)|income received in advance/.test(n),code:'20040',label:'deferred revenue'},
 {test:n=>/other (debtors|receivables?)|sundry (debtors|receivables?)/.test(n),code:'10070',exact:/^(other|sundry) (debtors|receivables?)$/,label:'other receivables'},
 {test:n=>/(staff|employee)s? (advance|loan|debtor|receivable)|imprest|salary advance/.test(n),code:'10080',exact:/^staff (advances?|loans?|debtors)$/,label:'staff advances'},
 {test:n=>/supplier advances?|advances? (to|paid to) suppliers?|prepaid to suppliers?/.test(n),code:'10100',label:'supplier advances'},
 {test:n=>/deposits? paid|rent deposit|security deposit|utility deposit|deposits? with|refundable deposit/.test(n),code:'10110',label:'deposits paid'},
 {test:n=>/prepa(id|yment)/.test(n)&&!/tax/.test(n),code:'10090',exact:/^prepa(id|yments?)( expenses?)?$/,label:'prepayments'},
 {test:n=>/(wht|withholding( tax)?).*(receivable|credit|recoverable|asset|certificate)|withholding tax credits?/.test(n),code:'10130',label:'withholding tax credit'},
 {test:n=>/(instalment|installment|advance|provisional) (income )?tax/.test(n)&&!/payable/.test(n),code:'10140',label:'instalment tax paid'},
 {test:n=>/(input vat|vat input|vat (recoverable|receivable|refund)|vat claimable)/.test(n),code:'10160',exact:/^(input vat|vat input|vat recoverable)$/,label:'input VAT'},
 {test:n=>/^(trade )?(debtors|receivables?|accounts receivable)$|trade (debtors|receivables?)|accounts receivable/.test(n),code:'10060',exact:/^(trade )?(debtors|receivables?)$|^accounts receivable$/,label:'trade receivables'},
 {test:n=>/(work in progress|wip)/.test(n)&&/(stock|inventory|goods|production)|^wip$|^work in progress$/.test(n)&&!/capital/.test(n),code:'10210',label:'work in progress'},
 {test:n=>/(stock|inventory)/.test(n)&&/raw material/.test(n),code:'10200',label:'raw materials'},
 {test:n=>/(stock|inventory)/.test(n)&&/finished/.test(n),code:'10220',label:'finished goods'},
 {test:n=>/(stock|inventory)/.test(n)&&/packag/.test(n),code:'10230',label:'packaging stock'},
 {test:n=>/(^|\b)(closing |opening )?(stock|inventory)( in trade| of goods| for resale)?$|merchandise|goods for resale|stock of goods|\bstocks?\b|\binventor(y|ies)\b/.test(n),code:'10190',exact:/^(closing |opening )?(stock|stocks|inventory|inventories|merchandise|stock in trade)$/,label:'inventory'},
 // Fixed assets
 {test:n=>/capital work in progress|assets under construction|work in progress.*(building|construction)/.test(n),code:'15014',label:'assets under construction'},
 {test:n=>/investment propert/.test(n),code:'15018',label:'investment property'},
 {test:n=>/leasehold improvement/.test(n),code:'15012',label:'leasehold improvements'},
 {test:n=>/right of use/.test(n),code:'15013',label:'right-of-use assets'},
 {test:n=>/^land( and .*)?$|^freehold land|^leasehold land/.test(n),code:'15001',exact:/^land$/,label:'land'},
 {test:n=>/\b(buildings?|premises|property)\b/.test(n)&&!/(payable|rent|insurance|repair|deposit)/.test(n),code:'15002',exact:/^(buildings?|premises)( at cost)?$/,label:'buildings'},
 {test:n=>/(motor vehicles?|vehicles?|trucks?|lorr(y|ies)|tractors?)/.test(n)&&!/(running|insurance|expenses|hire)/.test(n),code:'15004',exact:/^(motor )?vehicles?( at cost)?$/,label:'motor vehicles'},
 {test:n=>/(furniture|fittings|fixtures)/.test(n),code:'15005',exact:/^(office )?furniture( and (fittings|fixtures))?$|^furniture and fittings$/,label:'furniture and fittings'},
 {test:n=>/(computers?|laptops?|printers?|ict equipment|computer equipment)/.test(n),code:'15006',exact:/^(computers?|computer equipment|computers and (peripherals|accessories))$/,label:'computers'},
 {test:n=>/software/.test(n),code:'15008',label:'software'},
 {test:n=>/goodwill/.test(n),code:'15019',exact:/^goodwill$/,label:'goodwill'},
 {test:n=>/biological assets?/.test(n),code:'15021',label:'biological assets'},
 {test:n=>/(plant|machinery|equipment|tools|generator|fixed assets? other)/.test(n)&&!/(hire|rental|repair|maintenance)/.test(n),code:'15007',exact:/^(plant and machinery|equipment|office equipment|machinery)( at cost)?$/,label:'equipment'},
 // Liabilities
 {test:n=>/(accrued|accrual).*(salar|wage|payroll)|(salar(y|ies)|wages|payroll) (payable|accrued|accrual)/.test(n),code:'20020',label:'accrued payroll'},
 {test:n=>/(accruals?|accrued (expenses|liabilities|charges)|accrued)$|^accruals?( and .*)?$/.test(n)&&!/(tax|vat|paye|interest|income)/.test(n),code:'20010',exact:/^(accruals?|accrued (expenses|liabilities))$/,label:'accrued expenses'},
 {test:n=>/lease liabilit/.test(n),pick:n=>/(long|non current|noncurrent)/.test(n)?'20110':'20100',label:'lease liability'},
 {test:n=>/(loans?|borrowings?|mortgage|debentures?|term loan)/.test(n)&&!/(staff|employee|director|partner|shareholder|interest|receivable|repayment expense)/.test(n),pick:n=>/(short|current)/.test(n)?'20070':'20090',label:'loan'},
 {test:n=>/provisions?/.test(n)&&!/(depreciation|bad debt|doubtful|tax)/.test(n),code:'20120',label:'provisions'},
 {test:n=>/deferred tax/.test(n),code:'20130',label:'deferred tax'},
 {test:n=>/dividends? payable/.test(n),code:'20140',label:'dividends payable'},
 {test:n=>/(trade )?(creditors|payables?)|accounts payable|trade payables|suppliers? (control|payable|creditors)/.test(n)&&!/(tax|vat|paye|nssf|nhif|shif|levy|wht|salar|wage|payroll|other|dividend|interest|loan|lease)/.test(n),code:'20000',exact:/^(trade )?(creditors|payables?)$|^accounts payable$|^sundry creditors$/,label:'trade payables'},
 // Statutory liabilities
 {test:n=>/(output vat|vat output)/.test(n),code:'21000',label:'output VAT'},
 {test:n=>/(vat (payable|control|account|due|liability)|net vat|vat$|^vat )/.test(n)&&!/(input|recoverable|receivable|withholding)/.test(n),code:'21020',exact:/^vat( payable| control| account)?$/,label:'net VAT'},
 {test:n=>/\bpaye\b/.test(n),code:'21600',exact:/^paye( payable)?$/,label:'PAYE payable'},
 {test:n=>/\b(shif|nhif|sha)\b/.test(n),code:'21601',exact:/^(shif|nhif)( payable)?$/,label:'SHIF payable'},
 {test:n=>/(housing levy|\bahl\b|affordable housing)/.test(n),code:'21602',exact:/^(affordable )?housing levy( payable)?$/,label:'housing levy payable'},
 {test:n=>/\bnssf\b/.test(n),code:'21603',exact:/^nssf( payable)?$/,label:'NSSF payable'},
 {test:n=>/\bnita\b/.test(n),code:'21604',exact:/^nita( levy)?( payable)?$/,label:'NITA payable'},
 {test:n=>/(withholding tax|wht) (payable|due)|wht payable/.test(n),code:'21606',label:'withholding tax payable'},
 {test:n=>/(corporation tax|income tax|tax) (payable|liability|due)|^tax payable$/.test(n)&&!/(vat|paye|withholding)/.test(n),code:'21605',label:'income tax payable'},
 {test:n=>/excise duty/.test(n),code:'21607',label:'excise duty payable'},
 {test:n=>/net (pay|wages|salar)/.test(n),code:'21610',label:'net wages payable'},
 {test:n=>/(pension|provident) (contribution|fund)? ?payable|pension payable/.test(n),code:'21611',label:'pension payable'},
 // Equity, read for the legal structure
 {test:n=>/^(partner|partners)s?'? ?(current|c a|capital)? ?(accounts?|a c)$|\bpartners?\b.*\bcurrent\b|\bcurrent accounts?\b.*\bpartners?\b/.test(n)&&/current/.test(n),entity:{partnership:'36010'},exact:/^partners?'?s? current accounts?$/,label:"partners' current accounts"},
 {test:n=>/\bpartners?\b.*\bdrawings?\b|^drawings?$|\bdrawings?\b/.test(n),entity:{partnership:'36020',sole:'35010'},exact:/^(partners?'?s? )?drawings?$/,label:'drawings'},
 {test:n=>/\bpartners?\b.*\bcapital\b|\bcapital\b.*\bpartners?\b/.test(n),entity:{partnership:'36000'},exact:/^partners?'?s? capital( accounts?)?$/,label:"partners' capital"},
 {test:n=>/(owner|proprietor)s?'? ?(capital|equity|account)|^(owner|proprietor)s? (funds?|equity)$/.test(n),entity:{sole:'35000'},label:"owner's capital"},
 {test:n=>/share capital|ordinary shares?|issued (share )?capital|paid up (share )?capital|authori[sz]ed capital|shares? issued/.test(n),entity:{company:'30000'},exact:/^(ordinary )?share capital$/,label:'share capital'},
 {test:n=>/share premium/.test(n),entity:{company:'30010'},exact:/^share premium( account)?$/,label:'share premium'},
 {test:n=>/revaluation (surplus|reserve)/.test(n),code:'33000',label:'revaluation surplus'},
 {test:n=>/capital reserve/.test(n),code:'34100',label:'capital reserve'},
 {test:n=>/general reserve/.test(n),code:'34200',label:'general reserve'},
 {test:n=>/\breserves?\b/.test(n)&&!/(revaluation|capital|general|retained)/.test(n),code:'34000',label:'other reserves'},
 {test:n=>/(retained|accumulated) (earnings|profits?|income|losses?|surplus)|retained (profit|earnings)|profit and loss( account| a c)?( b f| bf| brought forward)?$|^p ?and ?l( account)?$|accumulated (fund|profit)/.test(n),entity:{company:'31000',partnership:'36010',sole:'35000'},exact:/^(retained (earnings|profits?)|accumulated (profits?|losses)|profit and loss( account)?)$/,label:'retained earnings'},
 {test:n=>/^(capital|capital account|capital contribution|equity)$/.test(n),entity:{company:'30000',partnership:'36000',sole:'35000'},label:'capital'}
];

export function ruleSuggestion({sourceName,entityType}){
 const n=normaliseName(sourceName),ek=entityKey(entityType);
 if(!n)return null;
 for(const r of rules){
  if(!r.test(n))continue;
  const code=r.entity?r.entity[ek]:(r.pick?r.pick(n):r.code);
  if(!code)continue;
  return {code,confidence:r.exact&&r.exact.test(n)?'High':'Medium',basis:`The name reads like ${r.label}${r.entity&&ek?' for a '+ek:''}`};
 }
 return null;
}

// accounts: Map or array of catalogue rows {code,name,status,is_legacy,entity_types}. chart: Set of approved chart codes, or null when no chart applies.
export function allowedAccount(code,{accounts,entityType,chart}){
 const a=Array.isArray(accounts)?accounts.find(x=>x.code===code):accounts.get(code);
 if(!a||a.status!=='Active'||a.is_legacy||Number(code)>=40000)return null;
 const ek=entityKey(entityType),types=(a.entity_types||[]).map(entityKey);
 if(types.length&&ek&&!types.includes(ek))return null;
 if(chart&&!chart.has(code))return null;
 return a;
}

// learned: rows {source_code,source_name,erp_account_code,clients} for this client's lines.
// A code match carries more weight than a name match; agreement between clients raises confidence; disagreement lowers it and defers to the rule.
export function suggestAccount({sourceCode,sourceName,entityType,accounts,chart,learned=[]}){
 const code=String(sourceCode||'').trim(),name=normaliseName(sourceName),ctx={accounts,entityType,chart};
 const tally=new Map();
 for(const l of learned){
  const byCode=code&&String(l.source_code||'').trim()===code,byName=name&&normaliseName(l.source_name)===name;
  if(!byCode&&!byName)continue;
  if(!allowedAccount(l.erp_account_code,ctx))continue;
  const t=tally.get(l.erp_account_code)||{code:l.erp_account_code,clients:0,code_match:false};
  t.clients=Math.max(t.clients,Number(l.clients)||0);t.code_match=t.code_match||!!byCode;tally.set(l.erp_account_code,t);
 }
 const options=[...tally.values()].sort((x,y)=>y.clients-x.clients);
 const rule=ruleSuggestion({sourceName,entityType}),ruleOk=rule&&allowedAccount(rule.code,ctx)?rule:null;
 if(options.length===1){
  const o=options[0],agrees=ruleOk&&ruleOk.code===o.code;
  return {code:o.code,source:'firm',clients:o.clients,confidence:o.clients>=2||agrees?'High':'Medium',basis:`${o.clients} other client${o.clients===1?'':'s'} of this firm mapped ${o.code_match?'this source code':'this account name'} here${agrees?' and the name agrees':''}`};
 }
 if(options.length>1){
  if(ruleOk&&options.some(o=>o.code===ruleOk.code))return {code:ruleOk.code,source:'firm',clients:options.find(o=>o.code===ruleOk.code).clients,confidence:'Medium',basis:`Other clients disagree; the account name points to ${ruleOk.code}`};
  if(ruleOk)return {code:ruleOk.code,source:'rule',confidence:'Medium',basis:`${ruleOk.basis}. Other clients used different accounts`};
  return {code:options[0].code,source:'firm',clients:options[0].clients,confidence:'Low',basis:`Other clients disagree; ${options[0].clients} used this account most`};
 }
 if(ruleOk)return {code:ruleOk.code,source:'rule',confidence:ruleOk.confidence,basis:ruleOk.basis};
 return null;
}
