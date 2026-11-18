// The PPE register (build 2881). Pure rules: no database, no tax rates of its own. Every rate comes from the dated, reviewed class rates the ERP already holds (asset_class_rates);
// nothing is guessed. The register carries each approved asset across the years: cost, accumulated depreciation, carrying amount and the tax written-down value, additions and disposals.
// Book depreciation uses the same shared-rate rule the ledger already uses for its year-by-year assets: the first-use rate in the year of first use, and later the annual rate on the
// cost basis, never more than the carrying amount. Tax wear and tear is a reconciliation item beside it, never a second expense. The register is checked against the trial balance and
// a difference is reported, never absorbed. All amounts are worked in cents.
import {rateCoveredTo} from './ledger-rules.mjs';

export const REGISTER_VERSION='ppe-register-v1';
export const ORIGINS=['Added in the year','Brought forward'];
export const DISPOSAL_KINDS=['Sold','Scrapped','Lost or stolen','Donated'];
// The policy the register applies, shown on the schedule so the Partner sees it. It is a policy choice, not a statutory rate.
export const POLICY=[
 'Depreciation starts in the year the asset is first used, at the first-use rate for that year, and at the annual rate on cost in later years, never more than the carrying amount.',
 'No depreciation or wear and tear is charged in the year an asset is disposed of; the gain or loss is the proceeds less the carrying amount at the start of that year.',
 'The tax balancing figure is the proceeds (not more than cost, and in the business-use share) less the tax written-down value at the start of that year.'
];
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const isDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(day(v))&&!Number.isNaN(Date.parse(day(v)+'T00:00:00Z'));
const c=v=>Math.round(Number(v||0)*100);
const money=n=>Math.round(n)/100;
const lastOfMonth=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
export function addYears(d,n){
 const [y,m,dd]=day(d).split('-').map(Number),monthEnd=dd===lastOfMonth(y,m),ty=y+n;
 return new Date(Date.UTC(ty,m-1,monthEnd?lastOfMonth(ty,m):Math.min(dd,lastOfMonth(ty,m)))).toISOString().slice(0,10);
}
const nextDay=d=>new Date(Date.parse(day(d)+'T00:00:00Z')+86400000).toISOString().slice(0,10);
// The financial years that end on or before targetEnd, newest first, as {start,end}, back to (and not before) the day after `after`.
export function yearsBetween(targetEnd,after){
 const out=[];
 for(let k=0;k<80;k++){
  const end=addYears(targetEnd,-k),prev=addYears(targetEnd,-k-1),start=nextDay(prev);
  if(end<=day(after))break;
  out.push({start,end});
 }
 return out.reverse();
}
export function rateForYear(rates,classCode,start,end){
 const cands=(rates||[]).filter(r=>r.class_code===classCode&&day(r.effective_from)<=day(start)).sort((a,b)=>day(b.effective_from).localeCompare(day(a.effective_from)));
 for(const r of cands)if(day(rateCoveredTo(r,rates))>=day(end))return r;
 return null;
}
// One proposed asset, checked before it is saved. accounts: master chart rows; rates: all class rates. Returns the issues; an empty list means it can be saved as a Draft.
export function assetIssues(a,{accounts=[],rates=[]}={}){
 const out=[],cost=Number(a.cost);
 if(!a.asset_name||String(a.asset_name).trim().length<3)out.push('Name the asset (at least 3 characters).');
 const acct=accounts.find(x=>String(x.code)===String(a.asset_account));
 if(!acct)out.push('Choose the cost account from the chart of accounts.');
 else if(acct.status!=='Active'||acct.is_legacy||Number(acct.route)!==3)out.push(`Account ${acct.code} is not an active property, plant and equipment account.`);
 if(!rates.some(r=>r.class_code===a.class_code))out.push('Choose an asset class that has reviewed rates.');
 if(!Number.isFinite(cost)||cost<=0)out.push('Enter the cost of the asset.');
 if(!isDate(a.acquired_on))out.push('Enter the date the asset was acquired.');
 if(!isDate(a.first_use_on))out.push('Enter the date the asset was first used.');
 else if(isDate(a.acquired_on)&&day(a.first_use_on)<day(a.acquired_on))out.push('The first-use date cannot be before the acquisition date.');
 const bu=Number(a.business_percentage??100);
 if(!Number.isFinite(bu)||bu<0||bu>100)out.push('Business use is a percentage between 0 and 100.');
 if(!ORIGINS.includes(a.origin))out.push('Say whether the asset was added in the year or brought forward.');
 if(a.origin==='Brought forward'){
  if(!isDate(a.bf_as_of))out.push('Enter the financial year end the brought-forward figures are at.');
  else if(isDate(a.first_use_on)&&day(a.first_use_on)>day(a.bf_as_of))out.push('A brought-forward asset must have been in use by the brought-forward date.');
  const acc=Number(a.bf_accumulated_depreciation),tax=Number(a.bf_tax_wdv);
  if(a.bf_accumulated_depreciation==null||a.bf_accumulated_depreciation===''||!Number.isFinite(acc)||acc<0)out.push('Enter the accumulated depreciation brought forward (zero if none).');
  else if(Number.isFinite(cost)&&acc>cost)out.push('Accumulated depreciation cannot be more than cost.');
  if(a.bf_tax_wdv==null||a.bf_tax_wdv===''||!Number.isFinite(tax)||tax<0)out.push('Enter the tax written-down value brought forward (zero if none).');
 }else if(a.origin==='Added in the year'&&(a.bf_as_of||a.bf_accumulated_depreciation||a.bf_tax_wdv))out.push('Brought-forward figures belong only to a brought-forward asset.');
 if(a.evidence==null||String(a.evidence).trim().length<10)out.push('Say what supports the cost and date (an invoice number, a delivery note or the prior-year schedule), at least 10 characters.');
 return out;
}
// Roll one approved asset forward to the target year. Returns that year's row, in cents, or {issues} when it cannot be worked.
export function rollAsset(asset,disposal,rates,target){
 const issues=[],cost=c(asset.cost),bu=Number(asset.business_percentage??100)/100,acq=day(asset.acquired_on),use=day(asset.first_use_on),disp=disposal?day(disposal.disposed_on):null;
 const bf=asset.origin==='Brought forward',after=bf?day(asset.bf_as_of):addYears(day(acq),-1);
 const empty={asset_key:asset.asset_key,asset_name:asset.asset_name,asset_account:asset.asset_account,class_code:asset.class_code,opening_cost:0,additions:0,disposal_cost:0,closing_cost:0,opening_acc:0,charge:0,released:0,closing_acc:0,nbv:0,tax_opening:0,tax_addition:0,tax_allowance:0,tax_balancing_allowance:0,tax_balancing_charge:0,tax_closing:0,proceeds:0,gain_loss:0,disposed:false,expense_account:null,contra_account:null,issues};
 if(bf&&after>=target.end)return empty;
 if(bf&&!yearsBetween(target.end,'0000-01-01').some(y=>y.end===after)){issues.push('The brought-forward date is not a financial year end of this client.');return empty;}
 // The years to walk. A brought-forward asset starts the day after its brought-forward date; an added asset starts with the year it was acquired.
 let years=yearsBetween(target.end,bf?after:'0000-01-01');
 if(!bf){const first=years.findIndex(y=>y.start<=acq&&acq<=y.end);years=first<0?[]:years.slice(first);}
 if(!years.length||years[years.length-1].end!==target.end)return empty;
 let present=bf,acc=bf?c(asset.bf_accumulated_depreciation):0,wdv=bf?c(asset.bf_tax_wdv):0,row=null,gone=false;
 for(const y of years){
  const last=y.end===target.end;
  if(gone){row=null;continue;}
  const inYearAcq=!bf&&acq>=y.start&&acq<=y.end,openingCost=present?cost:0,openingAcc=acc,openingWdv=wdv;
  if(inYearAcq)present=true;
  const rate=rateForYear(rates,asset.class_code,y.start,y.end);
  const cap=rate&&rate.class_code==='MOTOR'&&asset.noncommercial_vehicle&&Number(rate.tax_cost_cap)>0?c(rate.tax_cost_cap):cost,taxBasis=Math.round(Math.min(cost,cap)*bu);
  if(inYearAcq)wdv=taxBasis;
  const disposedHere=!!disp&&disp>=y.start&&disp<=y.end;
  if(disp&&disp<y.start){gone=true;row=null;continue;}
  let charge=0,tax=0,released=0,proceeds=0,gain=0,balA=0,balC=0,expense=null,contra=null;
  const landClass=rate&&rate.class_code==='LAND';
  if(!rate&&present&&use<=y.end&&!disposedHere)issues.push(`No reviewed rate for class ${asset.class_code} covers the year ending ${y.end}.`);
  if(rate){expense=rate.expense_account;contra=rate.contra_account;}
  const nbvOpen=(present?cost:0)-acc;
  if(present&&!disposedHere&&rate&&!landClass&&use<=y.end){
   const first=Number(rate.first_rate)/100,later=Number(rate.annual_rate)/100,factor=Number(rate.later_basis_percentage)/100;
   if(use>=y.start){charge=Math.min(cost,Math.round(cost*first));tax=Math.min(wdv,Math.round(taxBasis*first));}
   else{charge=Math.min(Math.max(0,nbvOpen),Math.round(cost*factor*later));tax=Math.min(wdv,Math.round(taxBasis*factor*later));}
  }
  if(disposedHere){
   proceeds=c(disposal.proceeds);released=acc;gain=proceeds-nbvOpen;
   const taxProceeds=Math.round(Math.min(proceeds,cost)*bu),bal=wdv-taxProceeds;
   if(bal>=0)balA=bal;else balC=-bal;
   charge=0;tax=0;
  }
  acc=acc+charge-released;wdv=disposedHere?0:wdv-tax;
  if(disposedHere){present=false;gone=true;}
  if(last)row={...empty,opening_cost:openingCost,additions:inYearAcq?cost:0,disposal_cost:disposedHere?cost:0,closing_cost:present?cost:0,opening_acc:openingAcc,charge,released,closing_acc:present?acc:0,nbv:present?cost-acc:0,
   tax_opening:inYearAcq?0:openingWdv,tax_allowance:tax,tax_balancing_allowance:balA,tax_balancing_charge:balC,tax_closing:present?wdv:0,proceeds,gain_loss:disposedHere?gain:0,disposed:disposedHere,expense_account:expense,contra_account:contra,
   tax_addition:inYearAcq?taxBasis:0};
 }
 return row?{...row,issues}:{...empty,issues};
}
// The register for one financial year. assets: the approved asset records (one per asset_key); disposals: the approved disposal records; rates: asset_class_rates.
export function registerYear({assets,disposals,rates,start,end}){
 const target={start:day(start),end:day(end)},rows=[],issues=[];
 for(const a of assets||[]){
  const d=(disposals||[]).find(x=>x.asset_key===a.asset_key)||null,r=rollAsset(a,d,rates,target);
  for(const m of r.issues)issues.push({asset_key:a.asset_key,asset_name:a.asset_name,message:m});
  if(r.opening_cost||r.additions||r.closing_cost||r.disposed||r.charge||r.closing_acc)rows.push(r);
 }
 const sum=k=>rows.reduce((s,r)=>s+(r[k]||0),0),keys=['opening_cost','additions','disposal_cost','closing_cost','opening_acc','charge','released','closing_acc','nbv','tax_opening','tax_addition','tax_allowance','tax_balancing_allowance','tax_balancing_charge','tax_closing','proceeds','gain_loss'];
 const totals=Object.fromEntries(keys.map(k=>[k,money(sum(k))]));
 const view=rows.map(r=>({...r,...Object.fromEntries(keys.map(k=>[k,money(r[k])]))}));
 return {version:REGISTER_VERSION,start:target.start,end:target.end,rows:view,totals,issues,policy:POLICY,cents:rows};
}
// The register against the trial balance. tb rows: {code,name,net,movement_debit,movement_credit} with net debit-positive. ppeCodes: the master-chart cost accounts for property, plant and equipment (route 3).
// Returns the lines (register, trial balance, difference) and whether everything ties. Only accounts with a balance on either side are listed.
export function reconcileRegister({register,tb,ppeCodes=[],rates=[]}){
 const contraCodes=new Set((rates||[]).map(r=>String(r.contra_account))),expenseCodes=new Set((rates||[]).map(r=>String(r.expense_account)));
 const byCost=new Map(),byContra=new Map(),byExp=new Map(),add=(m,k,v)=>{if(k)m.set(k,(m.get(k)||0)+v);};
 for(const r of register.cents){add(byCost,r.asset_account,r.closing_cost);add(byContra,r.contra_account,r.closing_acc);add(byExp,r.expense_account,r.charge);}
 const tbBy=new Map((tb||[]).map(x=>[String(x.code),x])),names=new Map((tb||[]).map(x=>[String(x.code),x.name||'']));
 const lines=[],push=(kind,code,reg,val)=>{if(!reg&&!val)return;lines.push({kind,account:code,name:names.get(code)||'',register:money(reg),trial_balance:money(val),difference:money(reg-val),ties:reg===val});};
 const costCodes=new Set([...ppeCodes.map(String),...byCost.keys()].filter(k=>!contraCodes.has(k)&&!expenseCodes.has(k)));
 for(const k of [...costCodes].sort())push('Cost',k,byCost.get(k)||0,c(tbBy.get(k)?.net));
 const contras=new Set([...contraCodes,...byContra.keys()]);
 for(const k of [...contras].sort())push('Accumulated depreciation',k,byContra.get(k)||0,-c(tbBy.get(k)?.net));
 const exps=new Set([...expenseCodes,...byExp.keys()]);
 for(const k of [...exps].sort()){const t=tbBy.get(k);push('Depreciation charge',k,byExp.get(k)||0,t?c(t.movement_debit)-c(t.movement_credit):0);}
 return {lines,ties:lines.every(l=>l.ties),differences:lines.filter(l=>!l.ties).length};
}
// The movement schedule written under the property, plant and equipment note: by cost account (the class of asset), in the order of the accounts.
export function noteSchedule(register,names=new Map()){
 const by=new Map();
 for(const r of register.rows){
  const g=by.get(r.asset_account)||{account:r.asset_account,name:names.get(r.asset_account)||'',opening_cost:0,additions:0,disposals:0,closing_cost:0,opening_acc:0,charge:0,released:0,closing_acc:0,nbv:0};
  g.opening_cost+=c(r.opening_cost);g.additions+=c(r.additions);g.disposals+=c(r.disposal_cost);g.closing_cost+=c(r.closing_cost);g.opening_acc+=c(r.opening_acc);g.charge+=c(r.charge);g.released+=c(r.released);g.closing_acc+=c(r.closing_acc);g.nbv+=c(r.nbv);
  by.set(r.asset_account,g);
 }
 const classes=[...by.values()].sort((a,b)=>String(a.account).localeCompare(String(b.account))).map(g=>Object.fromEntries(Object.entries(g).map(([k,v])=>[k,typeof v==='number'?money(v):v])));
 const tot=k=>money(classes.reduce((s,g)=>s+c(g[k]),0));
 return {classes,totals:Object.fromEntries(['opening_cost','additions','disposals','closing_cost','opening_acc','charge','released','closing_acc','nbv'].map(k=>[k,tot(k)])),policy:POLICY,version:REGISTER_VERSION};
}
// What the pack needs to know about the register. relevant: the year has PPE balances or register assets. A year with neither has no property, plant and equipment to schedule.
export function registerReadiness({register,reconciliation,drafts=0,hasPpeBalances=false,hasAssets=false}){
 const relevant=hasPpeBalances||hasAssets||drafts>0;
 if(!relevant)return {relevant:false,ok:true,problems:[],summary:'No property, plant and equipment this year.'};
 const problems=[];
 if(!hasAssets)problems.push('The trial balance has property, plant and equipment but the register has no approved assets.');
 if(drafts)problems.push(`${drafts} asset or disposal record${drafts===1?' is':'s are'} waiting for approval.`);
 for(const i of register.issues)problems.push(`${i.asset_name}: ${i.message}`);
 if(!reconciliation.ties)problems.push(`The register is out by the amounts shown against the trial balance on ${reconciliation.differences} line${reconciliation.differences===1?'':'s'}.`);
 return {relevant:true,ok:!problems.length,problems,summary:problems.length?problems[0]:'The register is approved and ties to the trial balance.'};
}
// What the cash flow takes from the register (build 2882), in cents. usable only when the register is approved, has no open issues and agrees to the trial balance;
// otherwise the cash flow keeps the trial-balance movement and says so. Purchases are at cost, proceeds are the recorded sale proceeds, gain_loss is proceeds less book value sold.
export function cashFlowInput({register,readiness}){
 if(!readiness||!readiness.relevant)return {relevant:false,usable:false,additions:0,proceeds:0,gain_loss:0};
 const sum=k=>(register.cents||[]).reduce((s,r)=>s+(r[k]||0),0);
 return {relevant:true,usable:!!readiness.ok&&(register.cents||[]).length>0,additions:sum('additions'),proceeds:sum('proceeds'),gain_loss:sum('gain_loss')};
}
