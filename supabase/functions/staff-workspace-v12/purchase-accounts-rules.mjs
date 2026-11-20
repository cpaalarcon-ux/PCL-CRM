// Build 2893: "Set up the accounts this upload uses". Pure rules. An upload names TB item codes; each one needs a client account (a dated, usable client_account_mappings row) before staff can map rows to it by hand.
// This groups the unmapped rows by TB code and says, for each code, whether it is ready to be set up, already set up, or blocked and why. Nothing is guessed: a code that is not an active purchase account of the
// master chart, not in the client's approved chart, or that clashes with an existing setup is never created here; it is listed with the reason for a person to resolve.
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const ROUTE_NAMES={1:'Inventory',2:'Expenditure',3:'PPE / capital asset'};

// rows: [{tb_code,routing_code,date,amount,dataset}] ; accounts: master chart ; mappings: client account rows (Draft or Active) ; chartAt(date) returns {codes:Set}|null
export function groupUploadAccounts(rows,accounts,mappings,chartAt){
 const by=new Map();
 for(const r of rows||[]){
  const code=String(r.tb_code??'').trim();if(!code)continue;
  const at=day(r.date),g=by.get(code)||{tb_code:code,rows:0,net:0,first_date:at,last_date:at,routing_codes:new Set(),datasets:new Set()};
  g.rows++;g.net+=Number(r.amount||0);if(at&&at<g.first_date)g.first_date=at;if(at&&at>g.last_date)g.last_date=at;
  if(r.routing_code)g.routing_codes.add(String(r.routing_code).trim().toUpperCase());if(r.dataset)g.datasets.add(r.dataset);by.set(code,g);
 }
 return [...by.values()].sort((x,y)=>y.rows-x.rows||x.tb_code.localeCompare(y.tb_code)).map(g=>{
  const account=(accounts||[]).find(x=>String(x.code)===g.tb_code),out={tb_code:g.tb_code,account_name:account?.name||'',route:account?Number(account.route):null,route_name:ROUTE_NAMES[Number(account?.route)]||'',rows:g.rows,net:Math.round(g.net*100)/100,first_date:g.first_date,last_date:g.last_date,routing_codes:[...g.routing_codes].sort(),datasets:[...g.datasets].sort()};
  if(!account)return {...out,state:'Blocked',reason:`TB code ${g.tb_code} is not an account in the master chart. Check the code in the file.`};
  if(account.status!=='Active'||account.is_legacy)return {...out,state:'Blocked',reason:`Account ${g.tb_code} is not active in the master chart.`};
  if(![1,2,3].includes(Number(account.route)))return {...out,state:'Blocked',reason:`Account ${g.tb_code} is not a purchase account (stock, expense or fixed asset).`};
  const chart=chartAt?chartAt(g.first_date):null;
  if(chart&&!chart.codes.has(g.tb_code))return {...out,state:'Blocked',reason:`Account ${g.tb_code} is not in the client's approved chart of accounts for ${g.first_date}. Propose a chart amendment first; a different Manager or Partner approves it.`};
  const mine=(mappings||[]).filter(m=>String(m.erp_account_code)===g.tb_code&&['Active','Draft'].includes(m.status));
  if(mine.some(m=>day(m.effective_from)<=g.first_date&&(!m.effective_to||day(m.effective_to)>=g.last_date)))return {...out,state:'Already set up',reason:''};
  const clash=(mappings||[]).filter(m=>['Active','Draft'].includes(m.status)&&String(m.source_account_code||'')===g.tb_code&&(!m.effective_to||day(m.effective_to)>=g.first_date));
  if(clash.length)return {...out,state:'Blocked',reason:`A client account setup for ${g.tb_code} already exists but does not cover ${g.first_date} to ${g.last_date}. Review it in Client accounts and add a dated change; it is not changed here.`};
  return {...out,state:'Ready',reason:''};
 });
}
export const summariseUpload=list=>({ready:list.filter(x=>x.state==='Ready').length,already:list.filter(x=>x.state==='Already set up').length,blocked:list.filter(x=>x.state==='Blocked').length,stock_needed:list.some(x=>x.route===1&&x.state!=='Blocked')});

// Build 2894: the upload summary. What was mapped (by group) and what was left as a draft, with the reason and the next step for each reason. Pure.
export const DRAFT_REASONS={
 SUGGESTED_AWAITING_APPROVAL:{label:'Suggested - Awaiting Approval',next:'A Manager proposes the routing pair; a Partner who did not propose it approves; the next automatic mapping then maps the rows.'},
 NO_CODES:{label:'No routing code and no TB code',next:'Add both codes in the file and replace the upload, or map the rows by hand.'},
 ROUTING_BLANK:{label:'Routing code missing',next:'Add the routing code and replace the upload, or map the rows by hand.'},
 TB_BLANK:{label:'TB code missing',next:'Add the TB code and replace the upload, or map the rows by hand.'},
 CODES_INVALID:{label:'Codes are not a valid pair',next:'Correct the codes in the file, or map the rows by hand.'},
 ROUTING_UNMAPPED:{label:'Routing code has no approved mapping',next:'A Manager proposes it; a different Partner approves it.'},
 ROUTING_ITEM_UNMAPPED:{label:'TB code not among the approved accounts for the routing code',next:'Add an approved mapping for this TB code.'},
 TB_CODE_UNKNOWN:{label:'TB code is not an account in the master chart',next:'Correct the code in the file.'},
 NOT_IN_CHART:{label:'Account is not in the client approved chart',next:'Propose a chart amendment; a different Manager or Partner approves it.'},
 NO_APPROVED_CHART:{label:'No approved client chart covers the invoice date',next:'Approve the client chart first.'},
 ACTIVITY_REQUIRED:{label:'Business activity needed',next:'Choose the activity when mapping.'},
 SUPPLIER_BLOCKED:{label:'A Manager stopped automatic mapping for this supplier',next:'Map the rows by hand.'},
 MAPPING_REFUSED:{label:'The mapping rules refused the row',next:'Open the row to see why, then map it by hand.'},
 NOT_ATTEMPTED:{label:'Not yet through automatic mapping',next:'Confirm the upload codes, or map the rows by hand.'}
};
export function summariseRows(rows){
 const mapped=new Map(),draft=new Map();let net=0;
 for(const r of rows||[]){
  const amount=Number(r.amount||0);net+=amount;
  if(r.account_code){const k=Number(r.route)||0,g=mapped.get(k)||{route:k,route_name:ROUTE_NAMES[k]||'Other',rows:0,net:0};g.rows++;g.net+=amount;mapped.set(k,g);continue;}
  const code=r.note_code||'NOT_ATTEMPTED',g=draft.get(code)||{code,label:(DRAFT_REASONS[code]||{}).label||code,next:(DRAFT_REASONS[code]||{}).next||'Open the row to see why.',reason:r.note_reason||'',rows:0,net:0};g.rows++;g.net+=amount;draft.set(code,g);
 }
 const m=[...mapped.values()].sort((x,y)=>x.route-y.route).map(x=>({...x,net:Math.round(x.net*100)/100})),d=[...draft.values()].sort((x,y)=>y.rows-x.rows).map(x=>({...x,net:Math.round(x.net*100)/100}));
 return {mapped:m,drafts:d,mapped_rows:m.reduce((s,x)=>s+x.rows,0),draft_rows:d.reduce((s,x)=>s+x.rows,0),net:Math.round(net*100)/100};
}
