// Statement of partners' capital and current accounts (build 2888). Pure: no database, no tax rates.
// The statement of changes in equity shows equity in total. For a partnership each partner also has a capital account and a current account. Staff declare, for every partner named in the approved profit
// shares, the opening capital, the capital introduced or withdrawn in the year, the opening current account and the drawings, from the partners' accounts; a Manager or Partner who did not declare them
// approves. The share of profit is never typed: it is worked out from the approved shares. The totals must agree, to the cent, with the opening, profit, drawings, capital and closing rows of the
// statement of changes in equity, and nothing in the equity statement may be left unattributed to a partner. A difference is reported, never absorbed.
import {allocateProfit} from './partner-shares-rules.mjs';
import {UNITS,roundTo} from './annual-pack-statements.mjs';

export const PARTNER_EQUITY_VERSION='partner-equity-v1';
const cents=v=>Math.round(Number(v||0)*100);
const kes=c=>Math.round(c)/100;
const money=n=>Number(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const norm=s=>String(s??'').replace(/\s+/g,' ').trim().toLowerCase();
const FIELDS=[['capital_opening','opening capital'],['capital_movement','capital introduced or (withdrawn)'],['current_opening','opening current account'],['drawings','drawings']];

// rows: [{partner_name,capital_opening,capital_movement,current_opening,drawings}] for every partner in the approved shares. Returns {error} or {rows,evidence}.
export function validatePartnerEquity({evidence,rows,partners=[]}){
 const ev=String(evidence??'').replace(/\s+/g,' ').trim();
 if(ev.length<10)return {error:'Say what supports the partners’ accounts (the signed prior-year accounts, the partners’ ledger), at least 10 characters.'};
 if(ev.length>500)return {error:'Keep the source to 500 characters.'};
 if(!partners.length)return {error:'The partners’ profit shares are not approved yet. They name the partners.'};
 if(!Array.isArray(rows))return {error:'Enter a line for every partner.'};
 const byName=new Map(partners.map(p=>[norm(p),p])),seen=new Set(),out=[];
 for(const [i,x] of rows.entries()){
  const key=norm(x?.partner_name),name=byName.get(key);
  if(!name)return {error:`Line ${i+1}: ${String(x?.partner_name||'(no name)')} is not a partner in the approved profit shares.`};
  if(seen.has(key))return {error:`${name} appears twice.`};seen.add(key);
  const line={partner_name:name};
  for(const [f,label] of FIELDS){
   const raw=x[f];
   if(raw===''||raw==null||typeof raw==='boolean'||!Number.isFinite(Number(raw)))return {error:`${name}: enter the ${label} (0 if none).`};
   const n=Number(raw);
   if(Math.abs(n)>=1e12)return {error:`${name}: the ${label} is too large.`};
   if(Math.abs(n*100-Math.round(n*100))>1e-6)return {error:`${name}: use at most two decimal places for the ${label}.`};
   line[f]=kes(Math.round(n*100));
  }
  if(line.drawings<0)return {error:`${name}: enter drawings as a positive figure. Money put in is a capital movement.`};
  out.push(line);
 }
 const missing=partners.filter(p=>!seen.has(norm(p)));
 if(missing.length)return {error:`Add a line for ${missing.join(', ')}.`};
 return {rows:partners.map(p=>out.find(r=>r.partner_name===p)),evidence:ev};
}

// record: the approved declaration ({rows,evidence,version,...}) or null. shares: the approved profit-share lines. equity: the built equity statement (with its exact cents).
// alloc: the profit allocation on the face. Returns the printed statement and the tie-out, or {problems} when it cannot be built.
export function buildPartnerEquity({record,shares,equity,alloc,rounding='Whole shillings'}){
 if(!record)return {built:false,problems:['The partners’ capital and current accounts are not declared and approved.']};
 const unit=UNITS[rounding]||100,ex=equity?.exact;
 if(!shares||!shares.length||!alloc||!ex)return {built:false,problems:['The profit shares or the statement of changes in equity are not available.']};
 const names=shares.map(s=>s.partner_name),byName=new Map((record.rows||[]).map(r=>[r.partner_name,r]));
 const absent=names.filter(n=>!byName.has(n)),extra=(record.rows||[]).filter(r=>!names.includes(r.partner_name)).map(r=>r.partner_name);
 if(absent.length||extra.length)return {built:false,problems:[`The partners changed since the accounts were approved (${[...absent.map(n=>n+' is missing'),...extra.map(n=>n+' is no longer a partner')].join('; ')}). Declare them again.`]};
 // Exact, in cents: the profit is shared by the approved shares so the parts add to the profit exactly.
 const profitShare=allocateProfit(ex.PROFIT/100,shares,2),shareC=new Map(profitShare.rows.map(r=>[r.partner_name,cents(r.amount)]));
 const per=names.map(n=>{const r=byName.get(n),capO=cents(r.capital_opening),capM=cents(r.capital_movement),curO=cents(r.current_opening),drw=cents(r.drawings),sh=shareC.get(n)||0;
  return {n,capO,capM,capC:capO+capM,curO,sh,drw,curC:curO+sh-drw};});
 const sum=k=>per.reduce((s,p)=>s+p[k],0);
 const mine={OPENING:sum('capO')+sum('curO'),PROFIT:sum('sh'),DIVIDENDS_DRAWINGS:-sum('drw'),CAPITAL:sum('capM'),OTHER:0,CLOSING:sum('capC')+sum('curC')};
 const LABEL={OPENING:'Opening equity',PROFIT:'Profit for the year',DIVIDENDS_DRAWINGS:'Drawings',CAPITAL:'Capital introduced or withdrawn',OTHER:'Other movements',CLOSING:'Closing equity'};
 const tie=Object.keys(LABEL).map(k=>({move:k,label:LABEL[k],partners:kes(mine[k]),statement:kes(ex[k]),difference:kes(mine[k]-ex[k]),ties:mine[k]===ex[k]}));
 // Printed in the statements' unit: each partner's column adds up as printed; the profit share is the one on the face allocation.
 const R=c=>roundTo(c,unit),face=new Map((alloc.rows||[]).map(r=>[r.partner_name,r.amount]));
 const cols=per.map(p=>{const capO=R(p.capO),capM=R(p.capM),curO=R(p.curO),sh=face.get(p.n)??R(p.sh),drw=R(p.drw);
  return {partner_name:p.n,capital_open:capO,capital_move:capM,capital_close:capO+capM,current_open:curO,profit:sh,drawings:-drw,current_close:curO+sh-drw};});
 const total=k=>cols.reduce((s,c)=>s+c[k],0);
 const totals=Object.fromEntries(['capital_open','capital_move','capital_close','current_open','profit','drawings','current_close'].map(k=>[k,total(k)]));
 totals.equity=totals.capital_close+totals.current_close;
 const rows=equity.current.rows,stmt=m=>rows.find(r=>r.move===m)?.total??0;
 const rounding_diff={opening:stmt('OPENING')-(totals.capital_open+totals.current_open),profit:stmt('PROFIT')-totals.profit,drawings:stmt('DIVIDENDS_DRAWINGS')-totals.drawings,capital:stmt('CAPITAL')-totals.capital_move,closing:stmt('CLOSING')-totals.equity};
 const ties=tie.every(t=>t.ties);
 const out={built:true,ties,tie,problems:ties?[]:tie.filter(t=>!t.ties).map(t=>`${t.label}: the partners’ accounts give ${money(t.partners)} and the statement of changes in equity ${money(t.statement)}.`),
  title:"Statement of partners' capital and current accounts",version:record.version,evidence:record.evidence,columns:cols,totals,rounding:rounding_diff,rounding_shown:Object.values(rounding_diff).some(v=>v!==0),unit_label:unit===100?'KES':'KES thousands'};
 out.matrix=partnerEquityMatrix(out);return out;
}
// The matrix printed in the pack and shown on the screen. Columns are the partners and a total.
export function partnerEquityMatrix(pe){
 if(!pe||!pe.built)return null;
 const cols=pe.columns,row=(label,k,total=false)=>({label,cells:[...cols.map(c=>c[k]),pe.totals[k]],total});
 return {columns:[...cols.map(c=>c.partner_name),'Total'],rows:[row('Capital account: balance at the start of the year','capital_open'),row('Capital introduced or (withdrawn)','capital_move'),row('Capital account: balance at the end of the year','capital_close',true),
  row('Current account: balance at the start of the year','current_open'),row('Share of profit for the year','profit'),row('Drawings','drawings'),row('Current account: balance at the end of the year','current_close',true),
  {label:"Total partners' equity at the end of the year",cells:[...cols.map(c=>c.capital_close+c.current_close),pe.totals.equity],total:true}]};
}

// Pack check: relevant only for a partnership whose equity statement has balances or movements. Left out when the profit shares are not approved (their own check says so).
export function partnerEquityState({relevant,record,draft,built}){
 if(!relevant)return {relevant:false,ok:true,problems:[]};
 if(!record)return {relevant:true,ok:false,problems:[draft?'The partners’ capital and current accounts wait for approval.':'The partners’ capital and current accounts are not declared.']};
 if(!built.built)return {relevant:true,ok:false,problems:built.problems};
 return {relevant:true,ok:built.ties,problems:built.problems};
}
export function partnerEquityCheck(s){
 if(!s||!s.relevant)return {status:'Info',detail:'A partnership with equity balances needs the partners’ accounts.'};
 if(s.ok)return {status:'Pass',detail:'The partners’ capital and current accounts are approved and agree to the statement of changes in equity.'};
 return {status:'Blocked',detail:s.problems.slice(0,3).join(' ')+(s.problems.length>3?` (+${s.problems.length-3} more)`:'')};
}
