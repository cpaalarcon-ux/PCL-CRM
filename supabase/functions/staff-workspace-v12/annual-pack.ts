import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {FRAMEWORKS,defaultReporting,validateReporting,packReadiness,mapInForce} from './annual-pack-rules.mjs';
import {EQUITY_MOVES,CASH_FLOW_LINES,STATEMENTS,parseComparativeText,formatComparativeText,validateComparativeLines,reconcileComparatives,openingByLine} from './annual-pack-comparatives.mjs';
import {buildStatements} from './annual-pack-statements.mjs';
import {buildEquityStatement,buildCashFlow} from './annual-pack-flows.mjs';
import {DATA_CUTOFF} from './ledger-rules.mjs';
import {buildReview,checkGroupIds,checkException} from './statement-review-rules.mjs';
import {formOf,usedLineCodes,misfits,applyCaptions,FORMS} from './annual-pack-legal-form.mjs';
import {shareStateFor} from './partner-shares-actions.ts';
import {allocateProfit,bpToPercent} from './partner-shares-rules.mjs';
import {buildNotes,applyFaceRefs} from './annual-pack-notes.mjs';
import {notesDigest,noteStateFor} from './notes-actions.ts';
import {wordingFor} from './wording-actions.ts';
import {auditStateFor,figuresDigest} from './audit-lock-actions.ts';
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

// Approve or reject the selected Draft mappings, one by one, recording the reviewer on every row (builds 2825, 2839).
async function decideMaps(tx:any,a:any,ids:string[],approve:boolean,note:string){
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

// Every Draft mapping with what the review needs to classify it (build 2839). Reads only; the rules are in statement-review-rules.mjs.
async function reviewRows(tx:any){
 return await tx`select m.map_id,m.account_code,c.name account_name,c.statement account_statement,c.status account_status,c.is_legacy,m.line_code,l.label line_label,l.statement line_statement,m.effective_from,m.reason,m.proposed_by,erp_private.staff_name(m.proposed_by) proposed_by_name,
   o.line_code open_line_code,o.effective_from open_from,(select count(*) from erp_private.account_statement_map d where d.account_code=m.account_code and d.status='Draft')::int drafts
  from erp_private.account_statement_map m join erp_private.account_catalog c on c.code=m.account_code join erp_private.statement_lines l on l.line_code=m.line_code
  left join erp_private.account_statement_map o on o.account_code=m.account_code and o.status='Approved' and o.effective_to is null
  where m.status='Draft' order by l.statement,l.sort_order,m.account_code`;
}

export async function statementMapAction(tx:any,a:any,p:any){
 if(p.action==='ledger_statement_map_read')return await statementMapRead(tx);
 if(p.action==='ledger_statement_map_review_read'){if(!isLeader(a))fail(403,'The statement-line review is for Managers and Partners.');return buildReview(await reviewRows(tx));}
 await tx`select pg_advisory_xact_lock(hashtextextended('statement-map',0))`;
 if(p.action==='ledger_statement_map_review_approve'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can approve a statement-line mapping.');
  const note=text(p.review_note??'',500,false),rows=await reviewRows(tx);let ids:string[];
  if(p.scope==='group'){
   ids=(Array.isArray(p.map_ids)?p.map_ids:[]).map(uuid);const c=checkGroupIds(ids,rows);if(!c.ok)fail(409,c.message);
  }else if(p.scope==='one'){
   const id=uuid(p.map_id),c=checkException(rows.find((r:any)=>r.map_id===id),note);if(!c.ok)fail(400,c.message);ids=[id];
  }else fail(400,'Choose a group or one mapping to approve.');
  return {...await decideMaps(tx,a,ids,true,note),scope:p.scope};
 }
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
  return await decideMaps(tx,a,ids,approve,note);
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

// ---- Prior-year comparatives for a first ERP year ----
const num=(r:any)=>({...r,amount:Number(r.amount)});
async function loadSets(tx:any,periodId:string){
 const heads=await tx`select set_id,version,prior_year_end,source_kind,source_reference,status,entered_by,entered_at,reviewed_by,reviewed_at,review_note,erp_private.reviewer_label(entered_by) entered_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.period_comparative_sets where period_id=${periodId} order by version desc`;
 const withLines=async(h:any)=>h?{...h,prior_year_end:day(h.prior_year_end),lines:(await tx`select statement,line_code,movement,amount from erp_private.period_comparative_lines where set_id=${h.set_id} order by statement,line_code,movement`).map(num)}:null;
 return {heads,approved:await withLines(heads.find((h:any)=>h.status==='Approved')),draft:await withLines(heads.find((h:any)=>h.status==='Draft'))};
}
async function reconInputs(tx:any,l:any,data:any){
 const lineDefs=await tx`select line_code,statement,section,label,normal_side from erp_private.statement_lines`;
 const maps=await tx`select account_code,line_code,effective_from,effective_to,status from erp_private.account_statement_map where status='Approved'`;
 const opening=openingByLine(data.tb.map((r:any)=>({code:r.code,opening:r.opening})),maps,mapInForce,day(l.starts_on));
 return {lineDefs,maps,opening};
}
// A twelve-month year ending on `end` starts the day after the same date a year earlier.
const priorStart=(end:string)=>{const x=new Date(end+'T00:00:00Z');x.setUTCFullYear(x.getUTCFullYear()-1);x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);};
export async function comparativesRead(tx:any,a:any,l:any,data:any){
 const sets=await loadSets(tx,l.period_id),inp=await reconInputs(tx,l,data);
 const reconOf=(s:any)=>s?reconcileComparatives({lines:s.lines,lineDefs:inp.lineDefs,opening:inp.opening}):null;
 const pe=new Date(day(l.starts_on)+'T00:00:00Z');pe.setUTCDate(pe.getUTCDate()-1);const prior_end=pe.toISOString().slice(0,10);
 const exists=(await tx`select 1 from erp_private.ledger_periods where client_id=${l.client_id} and ends_on=${prior_end}`).length>0;
 const unmappedOpening=inp.opening.find((o:any)=>o.line_code==='UNMAPPED');
 const shown=sets.draft||sets.approved;
 return {
  sets:sets.heads.map((h:any)=>({set_id:h.set_id,version:h.version,status:h.status,source_kind:h.source_kind,entered_name:h.entered_name,reviewed_name:h.reviewed_name,review_note:h.review_note,entered_at:h.entered_at,reviewed_at:h.reviewed_at})),
  draft:sets.draft&&{...sets.draft,recon:reconOf(sets.draft)},approved:sets.approved&&{...sets.approved,recon:reconOf(sets.approved)},
  texts:{pl:shown?formatComparativeText('Profit or loss',shown.lines):'',eq:shown?formatComparativeText('Changes in equity',shown.lines):'',cf:shown?formatComparativeText('Cash flow',shown.lines):''},
  source_kind:shown?.source_kind||'Signed prior-year financial statements',source_reference:shown?.source_reference||'',
  catalogs:{pl:inp.lineDefs.filter((d:any)=>d.statement==='Profit or loss'&&d.line_code!=='PL.UNRESOLVED').map((d:any)=>({code:d.line_code,label:d.label,side:d.normal_side})),
   equity:inp.lineDefs.filter((d:any)=>d.statement==='Financial position'&&d.section==='Equity').map((d:any)=>({code:d.line_code,label:d.label})),equity_moves:EQUITY_MOVES.map(([code,label]:any)=>({code,label})),
   cash_flow:CASH_FLOW_LINES.map(([code,section,label]:any)=>({code,section,label}))},
  opening_unmapped:unmappedOpening?true:false,
  prior_ledger:{prior_year_end:prior_end,prior_year_start:priorStart(prior_end),exists,can_build:!exists&&prior_end>=DATA_CUTOFF&&isLeader(a)&&l.status==='Open'}
 };
}
export async function comparativesSave(tx:any,a:any,l:any,p:any){
 if(!isLeader(a))fail(403,'A Manager or Partner must enter prior-year comparatives.');
 if(l.status!=='Open')fail(409,'This ledger year is closed. Its comparatives can no longer be changed.');
 const kind=choice(p.source_kind,['Signed prior-year financial statements','Prior-year accounting records outside the ERP','Management accounts','Recorded prior-year trial balances']),ref=text(p.source_reference,500);
 if(ref.length<10)fail(400,'Name the source document and its date (at least 10 characters).');
 const parsed=[['Profit or loss',p.pl],['Changes in equity',p.eq],['Cash flow',p.cf]].map(([st,t]:any)=>parseComparativeText(st,typeof t==='string'?t.slice(0,60000):''));
 const errors=parsed.flatMap((x:any)=>x.errors);if(errors.length)fail(400,errors[0]+(errors.length>1?` (${errors.length-1} more row problem(s))`:''));
 const lines=parsed.flatMap((x:any)=>x.rows);if(!lines.length)fail(400,'Enter at least one comparative line.');if(lines.length>400)fail(400,'Too many lines.');
 const defs=await tx`select line_code,statement,section from erp_private.statement_lines`,bad=validateComparativeLines(lines,defs);if(bad.length)fail(400,bad[0]+(bad.length>1?` (${bad.length-1} more problem(s))`:''));
 const tbIds:string[]=kind==='Recorded prior-year trial balances'?(Array.isArray(p.source_tb_ids)?p.source_tb_ids.slice(0,4).map(uuid):[]):[];
 if(kind==='Recorded prior-year trial balances'){
  if(!tbIds.length)fail(400,'Choose the recorded trial balances these comparatives come from.');
  const have=await tx`select tb_id from erp_private.client_year_tbs where client_id=${l.client_id} and status='Current' and tb_id=any(${tx.array(tbIds)}::uuid[])`;
  if(have.length!==tbIds.length)fail(409,'A trial balance was replaced or is not this client\u2019s. Prepare the comparatives from the trial balances again.');
 }
 await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':comparatives'},0))`;
 await tx`update erp_private.period_comparative_sets set status='Superseded' where period_id=${l.period_id} and status='Draft'`;
 const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.period_comparative_sets where period_id=${l.period_id}`)[0].v);
 const pe=new Date(day(l.starts_on)+'T00:00:00Z');pe.setUTCDate(pe.getUTCDate()-1);
 const head=(await tx`insert into erp_private.period_comparative_sets(period_id,project_id,client_id,version,prior_year_end,source_kind,source_reference,entered_by,source_tb_ids) values(${l.period_id},${l.project_id},${l.client_id},${ver},${pe.toISOString().slice(0,10)},${kind},${ref},${a.staff_id},${tx.array(tbIds)}::uuid[]) returning set_id,version,status`)[0];
 for(const x of lines)await tx`insert into erp_private.period_comparative_lines(set_id,project_id,statement,line_code,movement,amount) values(${head.set_id},${l.project_id},${x.statement},${x.line_code},${x.movement},${x.amount})`;
 return {...head,lines:lines.length};
}
export async function comparativesReview(tx:any,a:any,l:any,p:any,data:any){
 if(a.category_code!=='PARTNER')fail(403,'Only a Partner can approve or return prior-year comparatives.');
 if(l.status!=='Open')fail(409,'This ledger year is closed.');
 const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false);
 await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':comparatives'},0))`;
 const sets=await loadSets(tx,l.period_id),set=sets.draft;
 if(!set||set.set_id!==uuid(p.set_id))fail(409,'These comparatives have changed. Refresh and review the latest draft.');
 if(decision==='Returned'){
  if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`update erp_private.period_comparative_sets set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where set_id=${set.set_id}`;
  return {status:'Returned'};
 }
 if(set.entered_by===a.staff_id)fail(403,'Comparatives must be approved by a Partner other than the person who entered them.');
 const inp=await reconInputs(tx,l,data),recon=reconcileComparatives({lines:set.lines,lineDefs:inp.lineDefs,opening:inp.opening});
 if(!recon.ok)fail(400,'These comparatives do not reconcile yet: '+(recon.problems[0]||'a primary statement is missing')+(recon.problems.length>1?` (${recon.problems.length-1} more)`:''));
 if(inp.opening.some((o:any)=>o.line_code==='UNMAPPED'))fail(400,'Some opening balances are on accounts with no approved statement line. Approve the statement-line map first.');
 await tx`update erp_private.period_comparative_sets set status='Superseded' where period_id=${l.period_id} and status='Approved'`;
 await tx`update erp_private.period_comparative_sets set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null} where set_id=${set.set_id}`;
 return {status:'Approved',version:set.version};
}

// Readiness for the annual pack, from the same report the ledger screens use (data = report(...)).
export async function packReadinessFrom(tx:any,l:any,data:any,extra:any={}){
 const reporting=(await tx`select * from erp_private.ledger_period_reporting where period_id=${l.period_id}`)[0]||null;
 const lines=await tx`select line_code,statement from erp_private.statement_lines`;
 const maps=await tx`select account_code,line_code,effective_from,effective_to,status from erp_private.account_statement_map where status in ('Draft','Approved')`;
 const priorPeriodExists=(await tx`select 1 from erp_private.ledger_periods where client_id=${l.client_id} and ends_on=${day(l.starts_on)}::date-1`).length>0;
 const sets=await loadSets(tx,l.period_id),inp=await reconInputs(tx,l,data),recon=sets.approved?reconcileComparatives({lines:sets.approved.lines,lineDefs:inp.lineDefs,opening:inp.opening}):null;
 const legalEntityType=(await tx`select legal_entity_type from erp_private.clients where client_id=${l.client_id}`)[0]?.legal_entity_type||null;
 const shareState=await shareStateFor(tx,l.period_id);
 const readiness=packReadiness({period:{starts_on:day(l.starts_on),ends_on:day(l.ends_on),status:l.status},reporting,tb:data.tb,maps,lines,issues:data.issues,prior:data.prior_year,priorPeriodExists,asOf:data.as_of,approvedSet:sets.approved,draftSet:sets.draft,recon,legal:{legalEntityType,shares:{status:shareState.status,lines:shareState.lines}},notes:extra.notes||null,audit:extra.audit||null,wording:extra.wording||null});
 return {...readiness,as_of:data.as_of,reporting:reporting||{...defaultReporting(day(l.starts_on)),saved:false}};
}

// Formatted statements for one client year, read-only. They are always a draft until the readiness checks pass; a Partner's pack approval is a later step.
export async function statementsFrom(tx:any,l:any,data:any){
 const client=(await tx`select company_name,kra_pin,legal_entity_type from erp_private.clients where client_id=${l.client_id}`)[0]||{};
 const reporting=(await tx`select * from erp_private.ledger_period_reporting where period_id=${l.period_id}`)[0]||{...defaultReporting(day(l.starts_on)),saved:false};
 const lineDefs=await tx`select line_code,statement,section,label,sort_order,normal_side,cash_flow_class,note_ref from erp_private.statement_lines`;
 const maps=await tx`select account_code,line_code,effective_from,effective_to,status from erp_private.account_statement_map where status='Approved'`;
 const sets=await loadSets(tx,l.period_id),approved=sets.approved,inp=approved?await reconInputs(tx,l,data):null;
 const priorPl=approved?approved.lines.filter((x:any)=>x.statement==='Profit or loss').map((x:any)=>({line_code:x.line_code,amount:x.amount})):null;
 const statements=buildStatements({lineDefs,maps,tb:data.tb,startsOn:day(l.starts_on),endsOn:day(l.ends_on),asOf:data.as_of,rounding:reporting.rounding,priorPl,priorOpening:inp?inp.opening.filter((o:any)=>o.line_code!=='UNMAPPED'):null});
 // Changes in equity and cash flow, from the same trial balance and the same approved line map. The prior-year columns are the approved comparatives for those statements.
 const priorEquity=approved?approved.lines.filter((x:any)=>x.statement==='Changes in equity').map((x:any)=>({line_code:x.line_code,movement:x.movement,amount:x.amount})):null;
 const priorCash=approved?approved.lines.filter((x:any)=>x.statement==='Cash flow').map((x:any)=>({line_code:x.line_code,amount:x.amount})):null;
 const flowIn={lineDefs,maps,tb:data.tb,asOf:data.as_of,rounding:reporting.rounding};
 const equity=buildEquityStatement({...flowIn,priorEquity}),cashFlow=buildCashFlow({...flowIn,priorCashFlow:priorCash});
 // Unmapped accounts are already reported once for the statements above.
 const flowProblems=[...equity.problems,...cashFlow.problems].filter((p:string)=>!/have no approved statement line/.test(p));
 if(approved&&!equity.has_prior)flowProblems.push('The approved comparatives have no prior-year changes in equity, so that column is not shown.');
 if(approved&&!cashFlow.has_prior)flowProblems.push('The approved comparatives have no prior-year cash flow, so that column is not shown.');
 statements.changes_in_equity=equity;statements.cash_flow=cashFlow;statements.problems.push(...flowProblems);statements.complete=statements.problems.length===0;
 const priorInErp=(await tx`select 1 from erp_private.ledger_periods where client_id=${l.client_id} and ends_on=${day(l.starts_on)}::date-1`).length>0;
 if(!approved&&priorInErp)statements.problems.push('The prior year is held in the ERP. Comparatives taken from that ledger year are not shown yet.');
 // Legal form (build 2870): captions follow the client's legal structure, and a balance that belongs to another form is a problem, never moved.
 const form=formOf(client.legal_entity_type);
 applyCaptions(statements,form);
 {
  const labelOf=(c:string)=>lineDefs.find((d:any)=>d.line_code===c)?.label||null;
  for(const m of misfits(form,usedLineCodes({tb:data.tb,maps,asOf:data.as_of}),labelOf))statements.problems.push(`${m.label} ${m.reason}.`);
  statements.complete=statements.problems.length===0;
 }
 // Partners' profit shares (build 2872): a partnership's profit for the year is shared between the partners from the approved shares, in the statements' own unit. No approved shares, no allocation.
 if(form===FORMS.PARTNERSHIP){
  const sh=await shareStateFor(tx,l.period_id),plRows=statements.profit_or_loss?.rows||[],last=plRows[plRows.length-1];
  if(sh.status==='approved'&&last&&last.kind==='total'){
   const unit=statements.presentation?.unit_label||'KES',alloc=allocateProfit(last.current,sh.lines,0);
   statements.partner_allocation={title:'Allocation of profit for the year to the partners',unit_label:unit,profit:last.current,rows:alloc.rows.map((r:any)=>({partner_name:r.partner_name,percent:bpToPercent(r.share_bp),amount:r.amount})),total:alloc.total,version:sh.set.version};
  }else{statements.problems.push(sh.status==='draft'?'The partners\u2019 profit shares are recorded but not approved by a Partner, so profit is not allocated to the partners.':'The partners\u2019 profit shares are not recorded for this year, so profit is not allocated to the partners.');statements.complete=false;}
 }
 // System notes (build 2873): built from the same trial balance and map, numbered in statement order, with the number written on the face. The Partner's approval is tied to a digest of every figure.
 const nb=buildNotes({statements,lineDefs,tb:data.tb,maps,asOf:data.as_of,form,rounding:reporting.rounding});
 applyFaceRefs(statements,nb.face_refs);
 const nDigest=await notesDigest(nb.notes);
 statements.notes={title:'Notes to the financial statements',items:nb.notes,unit_label:nb.unit_label,digest:nDigest,problems:nb.problems};
 statements.problems.push(...nb.problems);statements.complete=statements.problems.length===0;
 const nState=await noteStateFor(tx,l.period_id,nDigest);
 // Audit lock (build 2875): the statements stay DRAFT until the audit is complete and the pack is locked against these figures and the approved notes.
 const aState=await auditStateFor(tx,l,await figuresDigest(statements),nDigest);
 statements.audit={status:aState.status,label:aState.label,required:aState.required,locked:aState.locked,stale:aState.stale,mode:aState.mode};
 // Standard wording and disclosures (build 2878): the pack is final only when every wording section the notes need is approved and every client-specific disclosure is declared and approved.
 const wd=await wordingFor(tx,l,{statements,client:{name:client.company_name||'',legal_form:form},reporting:{framework:reporting.framework,edition:reporting.edition,rounding:reporting.rounding,early_application_note:reporting.early_application_note||''},as_of:data.as_of});
 statements.wording={sections:wd.asm.sections.length,problems:wd.asm.problems,complete:wd.asm.complete};
 const readiness=await packReadinessFrom(tx,l,data,{notes:{state:{status:nState.status},count:nb.notes.length,problems:nb.problems},audit:{state:aState},wording:{count:wd.asm.sections.length,problems:wd.asm.problems}});
 return {client:{name:client.company_name||'',kra_pin:client.kra_pin||'',legal_entity_type:client.legal_entity_type||null,legal_form:form},reporting:{framework:reporting.framework,edition:reporting.edition,presentation_currency:reporting.presentation_currency,rounding:reporting.rounding,early_application_note:reporting.early_application_note||'',saved:reporting.saved!==false},
  statements,readiness:{ready:readiness.ready,status:readiness.status,summary:readiness.summary,blocked:readiness.blocked,checks:readiness.checks},
  status:readiness.ready&&statements.complete?'Ready for review':'Draft - not ready',as_of:data.as_of};
}
