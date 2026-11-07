import {chartResolver} from './client-chart.ts';
// Mapping suggestions from this client's own history. A supplier (by PIN) or an identical earlier description that was mapped before
// suggests the same account again. A suggestion is only offered when the account is still active, is in the client's chart for the
// invoice date and is covered by an approved or draft client account mapping for that date, so it can never lead to a row that cannot be posted.
// It never decides input VAT or deductibility. Staff confirm each group; only a long, perfectly consistent expense history is applied automatically.
export const HISTORY_METHOD='Auto-mapped — supplier history';
export const HISTORY_AUTO_MIN=3;      // earlier rows, all on the same expense account
export const HISTORY_MONTHS=12;
const day=(v:any)=>String(v instanceof Date?v.toISOString():v).slice(0,10);
export const descKey=(v:any)=>String(v??'').toLowerCase().replace(/[0-9]+/g,' ').replace(/[^a-z]+/g,' ').trim().replace(/\s+/g,' ');
const usableKey=(k:string)=>k.length>=5;
type Group={account_code:string,route:number,category_code:string,n:number,posted:number};
export type Suggestion={account_code:string,account_name:string,route:number,category_code:string,count:number,posted:number,total:number,basis:'supplier'|'description',strength:'Strong'|'Likely',auto:boolean,key:string};
// Rows already mapped for this client in the last HISTORY_MONTHS months. `posted` counts only rows whose journal was independently
// posted and has not been reversed; only those may teach an automatic mapping. Everything else can still be suggested on screen.
export async function loadHistory(tx:any,clientId:string,asOf:string){
 const rows=await tx`select r.normalized->>'party_pin' pin,r.normalized->>'description' descr,r.account_code,r.route,r.category_code,count(*)::int n,
   count(*) filter (where exists(select 1 from erp_private.ledger_sources s join erp_private.ledger_journals j using(journal_id) where s.source_kind='Workbook row' and s.source_key=r.row_id::text and j.status='Posted' and j.reversal_of is null and not exists(select 1 from erp_private.ledger_journals x where x.reversal_of=j.journal_id)))::int posted
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.client_id=${clientId} and b.archived_at is null and r.account_code is not null and r.parent_row_id is null and not r.is_split_parent
   and r.dataset in ('Purchases','Expenditure','Non-eTIMS') and r.route in (1,2,3) and coalesce((r.review_details->>'auto_map_blocked')::boolean,false)=false
   and coalesce(r.review_details->'mapping_confirmation'->>'method','')<>${HISTORY_METHOD}
   and coalesce(nullif(left(r.normalized->>'date',10),''),b.period_start::text)::date between (${asOf}::date - make_interval(months => ${HISTORY_MONTHS}::int))::date and ${asOf}::date
  group by 1,2,3,4,5`;
 const byPin=new Map<string,Group[]>(),byDesc=new Map<string,Group[]>();
 const add=(m:Map<string,Group[]>,k:string,r:any)=>{const list=m.get(k)||[],g=list.find(x=>x.account_code===r.account_code&&x.route===Number(r.route));if(g){g.n+=r.n;g.posted+=r.posted;}else list.push({account_code:r.account_code,route:Number(r.route),category_code:r.category_code,n:r.n,posted:r.posted});m.set(k,list);};
 for(const r of rows){const pin=String(r.pin||'').trim().toUpperCase();if(pin)add(byPin,pin,r);const k=descKey(r.descr);if(usableKey(k))add(byDesc,k,r);}
 return {byPin,byDesc};
}
// Dated supplier overrides recorded by a Manager or Partner: this supplier is not mapped to this account automatically or suggested for it.
export async function loadBlocks(tx:any,clientId:string){
 return await tx`select party_pin,account_code,effective_from,reason from erp_private.supplier_mapping_blocks where client_id=${clientId} and ended_at is null`;
}
export function isBlocked(blocks:any[],row:any,code:string,at:string){
 const pin=String(row.normalized?.party_pin||'').trim().toUpperCase();if(!pin)return null;
 return blocks.find((b:any)=>b.party_pin===pin&&b.account_code===code&&day(b.effective_from)<=at)||null;
}
// Pure: the dominant account for a supplier or description, or null when the history is mixed or empty.
export function pickFromHistory(history:{byPin:Map<string,Group[]>,byDesc:Map<string,Group[]>},row:any){
 const pin=String(row.normalized?.party_pin||'').trim().toUpperCase(),key=descKey(row.normalized?.description);
 const tryGroups=(groups:Group[]|undefined,basis:'supplier'|'description',minCount:number)=>{
  if(!groups?.length)return null;const total=groups.reduce((s,g)=>s+g.n,0),top=[...groups].sort((x,y)=>y.n-x.n)[0];
  if(top.n<minCount||top.n/total<0.8)return null;
  return {group:top,total,basis};
 };
 return tryGroups(pin?history.byPin.get(pin):undefined,'supplier',1)||tryGroups(usableKey(key)?history.byDesc.get(key):undefined,'description',2);
}
// Suggestions for the given unmapped rows, already checked against the chart and client account mappings.
export async function suggestionsFor(tx:any,project:any,rows:any[]):Promise<Map<string,Suggestion>>{
 const out=new Map<string,Suggestion>();if(!rows.length)return out;
 const asOf=new Date().toISOString().slice(0,10),history=await loadHistory(tx,project.client_id,asOf);
 if(!history.byPin.size&&!history.byDesc.size)return out;
 const accounts=await tx`select code,name,route,category_code,status,is_legacy from erp_private.account_catalog`,chartAt=await chartResolver(tx,project.client_id);
 const blocks=await loadBlocks(tx,project.client_id),blocked=(r:any,code:string,at:string)=>isBlocked(blocks,r,code,at);
 const mappings=await tx`select erp_account_code,effective_from,effective_to from erp_private.client_account_mappings where client_id=${project.client_id} and status in ('Active','Draft')`;
 for(const r of rows){
  const pick=pickFromHistory(history,r);if(!pick)continue;
  const g=pick.group,account=accounts.find((x:any)=>x.code===g.account_code);
  if(!account||account.status!=='Active'||account.is_legacy||Number(account.route)!==g.route)continue;
  const at=String(r.normalized?.date||day(r.period_start)).slice(0,10),chart=chartAt(at);
  if(chart&&!chart.codes.has(account.code))continue;
  if(!mappings.some((m:any)=>m.erp_account_code===account.code&&day(m.effective_from)<=at&&(!m.effective_to||day(m.effective_to)>=at)))continue;
  if(blocked(r,account.code,at))continue;
  const consistent=g.n===pick.total;
  out.set(r.row_id,{account_code:account.code,account_name:account.name,route:g.route,category_code:account.category_code,count:g.n,posted:g.posted,total:pick.total,basis:pick.basis,
   strength:consistent&&g.n>=HISTORY_AUTO_MIN?'Strong':'Likely',
   // Applied without a click only for a supplier on one expense account, three or more independently posted (and not reversed) times, on an eTIMS-backed purchase.
   auto:pick.basis==='supplier'&&consistent&&g.posted>=HISTORY_AUTO_MIN&&g.route===2&&['Purchases','Expenditure'].includes(r.dataset),
   key:`${account.code}|${g.route}|${account.category_code}`});
 }
 return out;
}
// Groups for the screen: one line per suggested account.
export function groupSuggestions(rows:any[],map:Map<string,Suggestion>){
 const groups=new Map<string,any>();
 for(const r of rows){const s=map.get(r.row_id);if(!s)continue;
  const g=groups.get(s.key)||{account_code:s.account_code,account_name:s.account_name,route:s.route,category_code:s.category_code,rows:0,net:0,vat:0,strong:0,basis:new Set<string>(),parties:new Set<string>()};
  g.rows++;g.net+=Number(r.normalized?.amount||0);g.vat+=Number(r.normalized?.vat||0);if(s.strength==='Strong')g.strong++;g.basis.add(s.basis);if(g.parties.size<3&&r.normalized?.party)g.parties.add(String(r.normalized.party));groups.set(s.key,g);}
 return [...groups.values()].map(g=>({...g,net:Math.round(g.net*100)/100,vat:Math.round(g.vat*100)/100,basis:[...g.basis],parties:[...g.parties]})).sort((x,y)=>y.rows-x.rows);
}
