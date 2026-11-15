import {fail,text,uuid,revision} from './validation.mjs';
import {readinessChecks,currentYear,accessSummary,nextYear,carriedMappings,rolloverChanges,rolloverIssues} from './year-rollover-rules.mjs';
// Build 2835: Continue Setup (find a client that is already started and show what is done and what is next, so nothing is added twice), the readiness checks that
// separate project access (assignment) from accounting activation, and the year rollover into a new draft year. Table rules are in 20261116240000_year_rollover.sql.
const ACTIONS=['client_setup_continue_read','client_year_rollover_read','client_year_rollover_create','client_year_rollover_review','client_year_rollover_withdraw'];
export const isRolloverAction=(a:string)=>ACTIONS.includes(a);
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const said=(v:any,min:number,max:number,what:string)=>{const t=text(v,max);if(t.length<min)fail(400,`${what} (at least ${min} characters).`);return t;};
const nairobiToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const like=(q:string)=>'%'+q.replace(/[\\%_]/g,m=>'\\'+m)+'%';
async function facts(tx:any,cid:string){
 const sections=await tx`select section_code,status from erp_private.client_setup_sections where client_id=${cid}`;
 const periods=await tx`select period_id,project_id,starts_on,ends_on,status,entity_type from erp_private.ledger_periods where client_id=${cid} order by starts_on`;
 const charts=await tx`select version_id,effective_from,status from erp_private.client_chart_versions where client_id=${cid}`;
 const mappings=await tx`select mapping_id,status,effective_from,effective_to from erp_private.client_account_mappings where client_id=${cid}`;
 const c=one(await tx`select client_id,company_name,kra_pin,legal_entity_type,year_end_month,year_end_day,opening_balance_status,record_status from erp_private.clients where client_id=${cid} and deleted_at is null`);
 const today=nairobiToday(),cy=currentYear(periods,today);
 const posted=cy?(await tx`select 1 from erp_private.ledger_journals j where j.period_id=${cy.period_id} and j.kind='Opening' and j.status='Posted' limit 1`).length>0:false;
 const assign=await tx`select pa.project_id,pa.staff_id from erp_private.project_assignments pa join erp_private.projects p on p.project_id=pa.project_id where p.client_id=${cid} and p.deleted_at is null`;
 const engagements=(await tx`select count(*)::int n from erp_private.engagement_setups where client_id=${cid}`)[0].n;
 return {client:c,sections,periods,charts,mappings,opening:{status:c.opening_balance_status,posted},assign,engagements,today};
}
const summary=(f:any)=>{const r=readinessChecks(f);return {client_id:f.client.client_id,company_name:f.client.company_name,kra_pin:f.client.kra_pin,record_status:f.client.record_status,...r,year:r.year?{...r.year,starts_on:day(r.year.starts_on),ends_on:day(r.year.ends_on)}:null,project_access:accessSummary(f.assign),engagement_setups:f.engagements,periods:f.periods.length};};
export async function clientYearRolloverAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Client setup is handled by staff with client access.');
 const leader=['PARTNER','MANAGER'].includes(a.category_code);
 if(p.action==='client_setup_continue_read'){
  if(p.client_id)return {candidates:[],selected:summary(await facts(tx,uuid(p.client_id)))};
  const q=String(p.q??'').replace(/\s+/g,' ').trim().slice(0,80);if(q.length<2)fail(400,'Type at least 2 characters of the client name or the KRA PIN.');
  const rows=await tx`select client_id from erp_private.clients where deleted_at is null and (company_name ilike ${like(q)} escape '\' or coalesce(trading_name,'') ilike ${like(q)} escape '\' or coalesce(kra_pin,'') ilike ${like(q)} escape '\') order by company_name limit 8`;
  const out=[];for(const r of rows)out.push(summary(await facts(tx,r.client_id)));
  return {query:q,candidates:out,selected:null};
 }
 const cid=uuid(p.client_id);
 if(p.action==='client_year_rollover_read'){
  const f=await facts(tx,cid),rollovers=await tx`select r.*,erp_private.staff_name(r.created_by) as created_by_name,erp_private.staff_name(r.reviewed_by) as reviewed_by_name,nc.status as new_chart_status from erp_private.client_year_rollovers r join erp_private.client_chart_versions nc on nc.version_id=r.new_chart_version_id where r.client_id=${cid} order by r.created_at desc`;
  const source=f.periods.length?f.periods[f.periods.length-1]:null,next=source?nextYear(source):null;
  const approved=f.charts.filter((c:any)=>c.status==='Approved'&&day(c.effective_from)<=(source?day(source.ends_on):'')).sort((x:any,y:any)=>day(y.effective_from).localeCompare(day(x.effective_from)))[0];
  let preview=null;
  if(source&&next&&approved){
   const chart=one(await tx`select * from erp_private.client_chart_versions where version_id=${approved.version_id}`),maps=await tx`select * from erp_private.client_account_mappings where client_id=${cid}`,carried=carriedMappings(maps.map((m:any)=>({...m,effective_from:day(m.effective_from),effective_to:m.effective_to?day(m.effective_to):null})),day(source.ends_on));
   const existing=rollovers.find((r:any)=>r.status!=='Withdrawn'&&day(r.new_starts_on)===next.starts_on)||null,draft=f.charts.some((c:any)=>c.status==='Draft'),{blockers,warnings}=rolloverIssues({source,existing,draftChartExists:draft,next});
   preview={source_period_id:source.period_id,source:{starts_on:day(source.starts_on),ends_on:day(source.ends_on),status:source.status},next,chart_version_id:chart.version_id,changes:rolloverChanges({client:f.client,source:{...source,starts_on:day(source.starts_on),ends_on:day(source.ends_on)},next,chart,mappings:maps,carried}),blockers,warnings};
  }
  return {client:{client_id:cid,company_name:f.client.company_name},can_start:leader,me:a.staff_id,preview,rollovers:rollovers.map((r:any)=>({...r,new_starts_on:day(r.new_starts_on),new_ends_on:day(r.new_ends_on),created_at:new Date(r.created_at).toISOString(),reviewed_at:r.reviewed_at?new Date(r.reviewed_at).toISOString():null,revision:String(r.revision)})),readiness:summary(f)};
 }
 if(!leader)fail(403,'A Manager or Partner handles the year rollover.');
 if(p.action==='client_year_rollover_create'){
  const src=one(await tx`select * from erp_private.ledger_periods where period_id=${uuid(p.source_period_id)} and client_id=${cid}`),next=nextYear(src);
  const chart=(await tx`select * from erp_private.client_chart_versions where client_id=${cid} and status='Approved' and effective_from<=${day(src.ends_on)}::date order by effective_from desc,reviewed_at desc limit 1`)[0];
  if(!chart)fail(409,'There is no approved chart of accounts in force at the end of the source year to roll forward.');
  const existing=(await tx`select status from erp_private.client_year_rollovers where client_id=${cid} and new_starts_on=${next?.starts_on||'1900-01-01'}::date and status<>'Withdrawn'`)[0]||null,draft=(await tx`select 1 from erp_private.client_chart_versions where client_id=${cid} and status='Draft' limit 1`).length>0;
  const {blockers}=rolloverIssues({source:src,existing,draftChartExists:draft,next});if(blockers.length)fail(409,blockers[0]);
  const c=one(await tx`select legal_entity_type,year_end_month,year_end_day from erp_private.clients where client_id=${cid}`),maps=await tx`select * from erp_private.client_account_mappings where client_id=${cid}`;
  const norm=maps.map((m:any)=>({...m,effective_from:day(m.effective_from),effective_to:m.effective_to?day(m.effective_to):null})),carried=carriedMappings(norm,day(src.ends_on));
  const changes=rolloverChanges({client:c,source:{...src,starts_on:day(src.starts_on),ends_on:day(src.ends_on)},next:next!,chart,mappings:norm,carried});
  const nc=one(await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,extra_accounts,prepared_by,note) values(${cid},${next!.starts_on},${chart.entity_type},${tx.array(chart.packs)},${tx.array(chart.accounts)},${tx.json(chart.extra_accounts||[])},${a.staff_id},${'Rolled forward from the version effective '+day(chart.effective_from)}) returning version_id`);
  const newIds:string[]=[];
  for(const m of carried){newIds.push(one(await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,status,created_by) values(${cid},${m.source_account_code||null},${m.source_account_name},${m.erp_account_code},${next!.starts_on},'Draft',${a.staff_id}) returning mapping_id`).mapping_id);}
  const r=one(await tx`insert into erp_private.client_year_rollovers(client_id,source_period_id,new_starts_on,new_ends_on,source_chart_version_id,new_chart_version_id,source_mapping_ids,new_mapping_ids,changes,created_by) values(${cid},${src.period_id},${next!.starts_on},${next!.ends_on},${chart.version_id},${nc.version_id},${tx.array(carried.map((m:any)=>m.mapping_id))}::uuid[],${tx.array(newIds)}::uuid[],${tx.json(changes)},${a.staff_id}) returning rollover_id`);
  return {created:true,rollover_id:r.rollover_id,chart_version_id:nc.version_id,mappings_copied:newIds.length,changes};
 }
 const r=one(await tx`select * from erp_private.client_year_rollovers where rollover_id=${uuid(p.rollover_id)} and client_id=${cid}`);
 if(String(r.revision)!==revision(p.revision))fail(409,'The rollover changed. Refresh first.');
 if(p.action==='client_year_rollover_review'){
  const own=r.created_by===a.staff_id;
  if(own){const sole=(await tx`select erp_private.sole_active_partner() as s`)[0].s;if(!(a.category_code==='PARTNER'&&sole))fail(403,'A different Manager or Partner reviews the rollover.');}
  await tx`update erp_private.client_year_rollovers set status='Reviewed',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${said(p.review_note,10,1000,'Say what you checked')},sole_partner_review=${own} where rollover_id=${r.rollover_id}`;
  return {reviewed:true,sole_partner:own};
 }
 await tx`update erp_private.client_year_rollovers set status='Withdrawn',withdraw_reason=${said(p.reason,10,500,'Say why it is withdrawn')} where rollover_id=${r.rollover_id}`;
 return {withdrawn:true,note:'The draft chart version and draft mappings stay for review: the reviewer returns or approves them as usual.'};
}
