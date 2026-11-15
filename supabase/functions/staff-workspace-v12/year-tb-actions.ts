import {fail,text,uuid,choice,date} from './validation.mjs';
import {mapInForce} from './annual-pack-rules.mjs';
import {parseTbText,validateTb,describeTb,deriveComparatives,expectedDates,TB_KINDS,CLOSING_STATES} from './year-tb-rules.mjs';
// Prior-year trial balances (build 2824): recorded by a Manager or Partner as numbered versions, then used to prepare comparatives that a Partner approves
// through the existing comparatives review. Nothing is deleted. A statement with no trial balance behind it is "Not available", never zero.
const ACTIONS=['ledger_tb_list','ledger_tb_save','ledger_comparatives_from_tbs'];
const day=(v:any)=>String(v instanceof Date?v.toISOString():v||'').slice(0,10);
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const sha256=async(s:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join('');

async function currentTbs(tx:any,clientId:string){
 return await tx`select t.*,erp_private.staff_name(t.entered_by) entered_by_name from erp_private.client_year_tbs t where t.client_id=${clientId} and t.status='Current' order by t.as_of desc,t.tb_kind`;
}
async function withRows(tx:any,t:any){
 if(!t)return null;
 const rows=await tx`select r.account_code code,c.name,r.debit,r.credit from erp_private.client_year_tb_rows r join erp_private.account_catalog c on c.code=r.account_code where r.tb_id=${t.tb_id} order by r.account_code`;
 return {...t,rows:rows.map((r:any)=>({code:r.code,name:r.name,debit:Number(r.debit),credit:Number(r.credit)}))};
}
export async function yearTbAction(tx:any,a:any,l:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 const dates=expectedDates(day(l.starts_on));
 if(p.action==='ledger_tb_list'){
  const rows=await currentTbs(tx,l.client_id);
  return {expected:{year_end:dates.prior_end,opening:dates.opening_as_of},kinds:TB_KINDS,closing_states:CLOSING_STATES,trial_balances:rows.map(describeTb)};
 }
 if(!isLeader(a))fail(403,'A Manager or Partner must work with prior-year trial balances.');
 if(l.status!=='Open')fail(409,'This ledger year is closed. Its comparatives can no longer be changed.');
 if(p.action==='ledger_tb_save'){
  const kind=choice(p.tb_kind,TB_KINDS),asOf=date(p.as_of);
  if(!asOf)fail(400,'Choose the date the trial balance is as of.');
  if(asOf>=day(l.starts_on))fail(400,'A prior-year trial balance is as of a date before this financial year starts ('+day(l.starts_on)+').');
  const state=kind==='Opening'?'After year-end close':choice(p.closing_state,CLOSING_STATES),ref=text(p.source_reference,500);
  if(ref.length<10)fail(400,'Name the source document and its date (at least 10 characters).');
  const parsed=parseTbText(typeof p.text==='string'?p.text.slice(0,200000):'');
  if(parsed.errors.length)fail(400,parsed.errors[0]+(parsed.errors.length>1?` (${parsed.errors.length-1} more row problem(s))`:''));
  if(parsed.rows.length>1500)fail(400,'Too many rows.');
  const known=new Set((await tx`select code from erp_private.account_catalog`).map((r:any)=>r.code));
  const v=validateTb(parsed.rows,known);if(v.problems.length)fail(400,v.problems[0]+(v.problems.length>1?` (${v.problems.length-1} more problem(s))`:''));
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.client_id+':year-tbs'},0))`;
  const digest=await sha256(JSON.stringify(parsed.rows.map((r:any)=>[r.code,r.debit,r.credit]).sort()));
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.client_year_tbs where client_id=${l.client_id} and tb_kind=${kind} and as_of=${asOf}`)[0].v);
  await tx`update erp_private.client_year_tbs set status='Superseded',superseded_at=now() where client_id=${l.client_id} and tb_kind=${kind} and as_of=${asOf} and status='Current'`;
  const head=(await tx`insert into erp_private.client_year_tbs(client_id,project_id,tb_kind,as_of,closing_state,version,source_reference,row_count,total_debit,total_credit,digest,entered_by) values(${l.client_id},${l.project_id},${kind},${asOf},${state},${ver},${ref},${parsed.rows.length},${v.debit},${v.credit},${digest},${a.staff_id}) returning *`)[0];
  for(const r of parsed.rows)await tx`insert into erp_private.client_year_tb_rows(tb_id,client_id,account_code,debit,credit) values(${head.tb_id},${l.client_id},${r.code},${r.debit},${r.credit})`;
  return {ok:true,trial_balance:describeTb(head),replaced:ver>1};
 }
 // ledger_comparatives_from_tbs: a read-only preparation. Nothing is saved until the comparatives are saved and a Partner approves them.
 const tbs=await currentTbs(tx,l.client_id);
 const yeRow=tbs.find((t:any)=>t.tb_kind==='Year-end'&&day(t.as_of)===dates.prior_end),opRow=tbs.find((t:any)=>t.tb_kind==='Opening'&&day(t.as_of)===dates.opening_as_of);
 const ye=await withRows(tx,yeRow),op=await withRows(tx,opRow);
 const lineDefs=await tx`select line_code,statement,section,label,sort_order,normal_side from erp_private.statement_lines`;
 const maps=await tx`select account_code,line_code,effective_from,effective_to,status from erp_private.account_statement_map where status='Approved'`;
 const r=deriveComparatives({yearEnd:ye,opening:op,maps,lineDefs,priorEnd:dates.prior_end});
 const ids=[yeRow,opRow].filter(Boolean).map((t:any)=>t.tb_id);
 void mapInForce;
 return {expected:{year_end:dates.prior_end,opening:dates.opening_as_of},year_end:describeTb(yeRow),opening:describeTb(opRow),
  statements:{'Profit or loss':{state:r.pl.state,reason:r.pl.reason},'Changes in equity':{state:r.eq.state,reason:r.eq.reason},'Cash flow':{state:r.cf.state,reason:r.cf.reason}},
  texts:r.texts,warnings:r.warnings,source_tb_ids:ids,
  source_reference:ids.length?`Recorded trial balances as of ${[ye&&day(ye.as_of),op&&day(op.as_of)].filter(Boolean).join(' and ')}`:''};
}
