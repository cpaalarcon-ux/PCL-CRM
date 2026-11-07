import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {FRAMEWORKS,defaultReporting,validateReporting,packReadiness} from './annual-pack-rules.mjs';
const day=(v:any)=>String(v instanceof Date?v.toISOString():v||'').slice(0,10);
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const addDays=(d:string,n:number)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};

// Statement lines and the dated, Partner-approved map from each account to a line. Not tied to one client: the same map serves every client.
export async function statementMapRead(tx:any){
 const lines=await tx`select line_code,statement,section,label,sort_order,normal_side,cash_flow_class,note_ref from erp_private.statement_lines order by statement,sort_order`;
 const maps=await tx`select m.map_id,m.account_code,m.line_code,m.effective_from,m.effective_to,m.status,m.reason,m.proposed_by,m.proposed_at,m.reviewed_by,m.reviewed_at,m.review_note,c.name account_name,c.status account_status,c.is_legacy
   from erp_private.account_statement_map m join erp_private.account_catalog c on c.code=m.account_code where m.status in ('Draft','Approved') order by m.account_code,m.effective_from`;
 const accounts=await tx`select code,name,status,is_legacy from erp_private.account_catalog order by code`;
 const mapped=new Set(maps.map((m:any)=>m.account_code));
 const rows=maps.map((m:any)=>({...m,effective_from:day(m.effective_from),effective_to:m.effective_to?day(m.effective_to):null}));
 return {lines,maps:rows,unmapped:accounts.filter((x:any)=>!mapped.has(x.code)),totals:{accounts:accounts.length,approved:rows.filter((m:any)=>m.status==='Approved'&&!m.effective_to).length,draft:rows.filter((m:any)=>m.status==='Draft').length}};
}

export async function statementMapAction(tx:any,a:any,p:any){
 if(p.action==='ledger_statement_map_read')return await statementMapRead(tx);
 await tx`select pg_advisory_xact_lock(hashtextextended('statement-map',0))`;
 if(p.action==='ledger_statement_map_propose'){
  if(!isLeader(a))fail(403,'A Manager or Partner must propose a statement-line change.');
  const code=text(p.account_code,20),line=text(p.line_code,40),from=date(p.effective_from),reason=text(p.reason,500);
  if(!from)fail(400,'Choose the date the change starts.');
  if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
  if(!(await tx`select 1 from erp_private.account_catalog where code=${code}`).length)fail(400,'That account is not in the chart of accounts.');
  if(!(await tx`select 1 from erp_private.statement_lines where line_code=${line}`).length)fail(400,'Choose a statement line from the list.');
  if((await tx`select 1 from erp_private.account_statement_map where account_code=${code} and status='Draft'`).length)fail(409,'This account already has a change waiting for a Partner.');
  const open=(await tx`select line_code,effective_from from erp_private.account_statement_map where account_code=${code} and status='Approved' and effective_to is null`)[0];
  if(open&&open.line_code===line)fail(400,'The account is already on that statement line.');
  if(open&&from<=day(open.effective_from))fail(400,'The new line must start after the current one started ('+day(open.effective_from)+').');
  return (await tx`insert into erp_private.account_statement_map(account_code,line_code,effective_from,reason,proposed_by) values(${code},${line},${from},${reason},${a.staff_id}) returning map_id,status`)[0];
 }
 if(p.action==='ledger_statement_map_approve'||p.action==='ledger_statement_map_reject'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can approve or reject a statement-line mapping.');
  const approve=p.action==='ledger_statement_map_approve';
  let ids:string[];
  if(approve&&p.all_seeded===true){
   ids=(await tx`select map_id from erp_private.account_statement_map where status='Draft' and proposed_by is null order by account_code`).map((r:any)=>r.map_id);
   if(!ids.length)fail(400,'There are no seeded proposals waiting.');
  }else{
   if(!Array.isArray(p.map_ids)||!p.map_ids.length||p.map_ids.length>500)fail(400,'Choose between 1 and 500 mappings.');
   ids=p.map_ids.map(uuid);
  }
  const note=approve?text(p.review_note??'',500,false):text(p.review_note,500);
  if(!approve&&note.length<10)fail(400,'Give a reason of at least 10 characters.');
  let done=0;
  for(const id of ids){
   const m=(await tx`select * from erp_private.account_statement_map where map_id=${id} for update`)[0];
   if(!m)fail(404,'A selected mapping no longer exists.');
   if(m.status!=='Draft')fail(409,'A selected mapping has already been reviewed. Refresh the list.');
   if(approve&&m.proposed_by&&m.proposed_by===a.staff_id)fail(403,'A mapping must be approved by a Partner other than the person who proposed it. The proposer can withdraw it by rejecting it.');
   if(approve){
    const open=(await tx`select map_id,effective_from from erp_private.account_statement_map where account_code=${m.account_code} and status='Approved' and effective_to is null for update`)[0];
    if(open){
     if(day(m.effective_from)<=day(open.effective_from))fail(409,`Account ${m.account_code}: the new line must start after the current one.`);
     await tx`update erp_private.account_statement_map set effective_to=${addDays(day(m.effective_from),-1)} where map_id=${open.map_id}`;
    }
    await tx`update erp_private.account_statement_map set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null} where map_id=${id}`;
   }else await tx`update erp_private.account_statement_map set status='Rejected',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where map_id=${id}`;
   done++;
  }
  return {reviewed:done,status:approve?'Approved':'Rejected'};
 }
 fail(400,'Unknown statement-map action.');
}

// Reporting framework and edition for one client year.
export async function reportingRead(tx:any,l:any){
 const row=(await tx`select * from erp_private.ledger_period_reporting where period_id=${l.period_id}`)[0];
 const base={frameworks:FRAMEWORKS,third_edition_effective:'2027-01-01'};
 if(row)return {...base,saved:true,reporting:row,problems:validateReporting(row,day(l.starts_on))};
 const d=defaultReporting(day(l.starts_on));
 return {...base,saved:false,reporting:d,problems:['No reporting framework has been recorded for this year.']};
}
export async function reportingSave(tx:any,a:any,l:any,p:any){
 if(!isLeader(a))fail(403,'A Manager or Partner must set the reporting framework.');
 if(l.status!=='Open')fail(409,'This ledger year is closed. Its reporting framework can no longer be changed.');
 const framework=choice(p.framework,Object.keys(FRAMEWORKS)),edition=choice(p.edition,FRAMEWORKS[framework as keyof typeof FRAMEWORKS]);
 const r={framework,edition,early_application_note:text(p.early_application_note??'',500,false),presentation_currency:text(p.presentation_currency??'KES',3),
  rounding:choice(p.rounding??'Whole shillings',['Whole shillings','Thousands']),comparatives_basis:choice(p.comparatives_basis??'Prior year ledger',['Prior year ledger','Approved opening balances','First period - none']),cash_flow_method:'Indirect'};
 const problems=validateReporting(r,day(l.starts_on));if(problems.length)fail(400,problems[0]);
 const existing=(await tx`select revision from erp_private.ledger_period_reporting where period_id=${l.period_id} for update`)[0];
 if(existing){
  if(String(existing.revision)!==revision(p.revision))fail(409,'This was changed by someone else. Refresh and try again.');
  await tx`update erp_private.ledger_period_reporting set framework=${r.framework},edition=${r.edition},early_application_note=${r.early_application_note},presentation_currency=${r.presentation_currency},rounding=${r.rounding},comparatives_basis=${r.comparatives_basis},set_by=${a.staff_id} where period_id=${l.period_id}`;
 }else{
  await tx`insert into erp_private.ledger_period_reporting(period_id,project_id,client_id,framework,edition,early_application_note,presentation_currency,rounding,comparatives_basis,set_by) values(${l.period_id},${l.project_id},${l.client_id},${r.framework},${r.edition},${r.early_application_note},${r.presentation_currency},${r.rounding},${r.comparatives_basis},${a.staff_id})`;
 }
 return await reportingRead(tx,l);
}

// Readiness for the annual pack, from the same report the ledger screens use (data = report(...)).
export async function packReadinessFrom(tx:any,l:any,data:any){
 const reporting=(await tx`select * from erp_private.ledger_period_reporting where period_id=${l.period_id}`)[0]||null;
 const lines=await tx`select line_code,statement from erp_private.statement_lines`;
 const maps=await tx`select account_code,line_code,effective_from,effective_to,status from erp_private.account_statement_map where status in ('Draft','Approved')`;
 const priorPeriodExists=(await tx`select 1 from erp_private.ledger_periods where client_id=${l.client_id} and ends_on=${day(l.starts_on)}::date-1`).length>0;
 const readiness=packReadiness({period:{starts_on:day(l.starts_on),ends_on:day(l.ends_on),status:l.status},reporting,tb:data.tb,maps,lines,issues:data.issues,prior:data.prior_year,priorPeriodExists,asOf:data.as_of});
 return {...readiness,as_of:data.as_of,reporting:reporting||{...defaultReporting(day(l.starts_on)),saved:false}};
}
