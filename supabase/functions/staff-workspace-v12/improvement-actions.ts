import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {syncClientSector} from './activity-sectors.ts';
import {clientChartAction,requireChartAccount,chartCatalogue} from './client-chart.ts';
import {familyFor} from './legal-structure.mjs';
import {entityInput,partnerRatios,stockValues,suggestionFor,exportReadiness,packs,streams,asDay,VAT_CATEGORIES,vatCategoriesInput} from './improvement-rules.mjs';
import {salesNetByCategory} from './stock-vat.ts';
import {money} from './accounting-rules.mjs';
import {dependencyTaskAction,syncClientDependencyTasks} from './dependency-tasks.ts';
import {notifyReviewers,notifyOutcome} from './review-queue.ts';
const one=(r:any[])=>{if(!r.length)fail(403,'Record unavailable to this account.');return r[0];};
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must maintain client configuration.');};
const reviewer=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'Independent Supervisor, Manager or Partner review required.');};
const fresh=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This record changed. Refresh before saving.');};
const range=(p:any)=>{const s=date(p.starts_on),e=date(p.ends_on);if(!s||!e||e<s||Date.parse(e)-Date.parse(s)>367*86400000)fail(400,'Choose a valid period of up to 367 days.');return [s,e];};
const isoDay=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const nextStockDay=(v:any)=>{const day=isoDay(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';const d=new Date(`${day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const activityCatalog:any={agriculture:['Agriculture and agribusiness','Other'],construction:['Construction and building works','Construction'],education:['Education and training','Other'],financial:['Financial and insurance services','Other'],healthcare:['Healthcare and medical services','Other'],hospitality:['Hospitality and food services','Hospitality'],ict:['Information and communications technology','Other'],manufacturing:['Manufacturing and processing','Other'],mining:['Mining and quarrying','Other'],nonprofit:['Non-profit and donor-funded operations','Other'],professional:['Professional and consultancy services','Consultancy'],public:['Public sector and infrastructure','Other'],real_estate:['Real estate and rental services','Other'],retail:['Retail trade','Retail'],transport:['Transport and logistics','Other'],utilities:['Utilities and energy','Other'],wholesale:['Wholesale trade','Wholesale'],other:['Other','Other']};
const previousDay=(v:string)=>{const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);};
function normaliseActivityRows(raw:any,allowEmpty=false){
 if(!Array.isArray(raw)||raw.length>(20)||raw.length===0&&!allowEmpty)fail(400,'Select up to 20 dated business activities.');
 const rows=raw.map((x:any)=>{const code=choice(x.activity_code,Object.keys(activityCatalog)),meta=activityCatalog[code],custom=code==='other'?text(x.activity_name,160):'';
  if(code==='other'&&custom.length<5)fail(400,'Describe the other business activity.');
  const start=date(x.effective_from),end=x.effective_to?date(x.effective_to):null,share=x.turnover_share===''||x.turnover_share==null?null:Number(x.turnover_share);
  if(!start||end&&end<start)fail(400,`Choose valid effective dates for ${meta[0]}.`);
  if(share!==null&&(!Number.isFinite(share)||share<0||share>100||Math.abs(share*10000-Math.round(share*10000))>.000001))fail(400,'Turnover shares must be 0–100 with no more than four decimals.');
  return {activity_code:code,activity_name:code==='other'?`Other — ${custom}`:meta[0],pack_code:choice(x.pack_code||meta[1],packs),income_stream:choice(x.income_stream||'Business',streams),effective_from:start,effective_to:end,is_primary:false,turnover_share:share,evidence:text(x.evidence,2000)};
 });
 if(new Set(rows.map(x=>x.activity_code)).size!==rows.length)fail(400,'The same activity is selected more than once.');
 return rows;
}
const stockPolicyEvidence=(p:any)=>{
 if(p.evidence_type||p.evidence_reference||p.evidence_other){if(!p.evidence_type)fail(400,'Choose the optional policy evidence type before adding a reference.');const types=['Client inventory policy','Approved accounting manual','Management or Board approval','Stock-system settings or report','Stock count or valuation working paper','Other'];const type=choice(p.evidence_type,types),other=type==='Other'?text(p.evidence_other,200):'',reference=text(p.evidence_reference||'',500,false);if(type==='Other'&&other.length<3)fail(400,'Describe the other evidence type.');return `${type==='Other'?`Other — ${other}`:type}${reference?`: ${reference}`:''}`;}
 return text(p.evidence||'',2000,false);
};
export const digest=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(n=>n.toString(16).padStart(2,'0')).join('');
async function project(tx:any,id:any){return one(await tx`select * from erp_private.projects where project_id=${uuid(id)} and deleted_at is null`);}
async function evidence(tx:any,id:any,pid:string){return one(await tx`select document_id from erp_private.documents where document_id=${uuid(id)} and project_id=${pid} and deleted_at is null`);}
async function stockSource(tx:any,c:any){
 const rows=await tx`select r.row_id,r.revision,r.account_code,r.normalized,r.review_details,r.route,v.decision,v.source_revision,v.deductible_percentage from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id) where r.project_id=${c.project_id} and b.archived_at is null and b.period_start>=${asDay(c.starts_on)} and b.period_end<=${asDay(c.ends_on)} and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') order by r.row_id limit 10001`;
 if(rows.length>10000)fail(400,'Use a stock period with at most 10,000 source rows.');
 const vat=c.vat_category||null;
 const selected=vat?rows.filter((r:any)=>r.route===1&&r.review_details?.activity_id===c.activity_id&&r.normalized?.vat_category===vat):rows.filter((r:any)=>r.review_details?.activity_id===c.activity_id&&r.review_details?.stock_class===c.stock_class&&r.route===1);
 const net_sales=vat?(await salesNetByCategory(tx,c.project_id,c.starts_on,c.ends_on))[vat]??0:null;
 const cost=(r:any)=>money(Number(r.normalized.amount||0)+(r.decision==='Eligible'?Number(r.normalized.vat||0)*(1-Number(r.deductible_percentage||0)/100):r.decision==='Excluded'?Number(r.normalized.vat||0):0));
 const landed=(r:any)=>['50030','50040','50050'].includes(r.account_code);
 return {rows,net_sales,fingerprint:await digest(vat?{rows,net_sales}:rows),selected_count:selected.length,resale_purchases:money(selected.filter((r:any)=>!landed(r)).reduce((s:number,r:any)=>s+cost(r),0)),landed_costs:money(selected.filter(landed).reduce((s:number,r:any)=>s+cost(r),0)),unreviewed:selected.filter((r:any)=>r.source_revision!==r.revision||!['Eligible','Excluded'].includes(r.decision)).length,unallocated:rows.filter((r:any)=>!r.account_code||r.route===1&&(!r.review_details?.activity_id||!r.review_details?.stock_class)).length};
}
// A new stock roll opens at the last approved closing of the same activity and stock class (any earlier project of the same client).
async function carriedOpening(tx:any,clientId:string,activityId:string,stockClass:string,startsOn:string){
 const prior=(await tx`select c.control_id,c.ends_on,c.snapshot,c.result from erp_private.stock_controls c join erp_private.projects p using(project_id) where p.client_id=${clientId} and c.activity_id=${activityId} and c.stock_class=${stockClass} and c.status='Approved' and c.ends_on<${startsOn} order by c.ends_on desc limit 1`)[0];
 if(!prior)return {};
 const closing=Number(prior.snapshot?.result?.closing_value??prior.result?.closing_value);if(!Number.isFinite(closing))return {};
 const through=prior.ends_on instanceof Date?prior.ends_on.toISOString().slice(0,10):String(prior.ends_on).slice(0,10);
 return {opening_value:closing,carried_opening_value:closing,carried_from:prior.control_id,carried_through:through};
}
export async function improvementAction(tx:any,a:any,p:any,storage?:any){
 if(!String(p.action).startsWith('v3_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Client configuration and working-paper controls are unavailable to Interns.');
 {const dependencyResult=await dependencyTaskAction(tx,a,p);if(dependencyResult!==undefined)return dependencyResult;}
 {const chartResult=await clientChartAction(tx,a,p);if(chartResult!==undefined)return chartResult;}
 if(p.action==='v3_client_mapping_readiness'){
  leader(a);
  return await tx`select c.client_id,
   (select count(*)::int from erp_private.client_activities x where x.client_id=c.client_id) as activity_count,
   (select count(*)::int from erp_private.stock_policy_versions x where x.client_id=c.client_id) as stock_method_count,
   (select count(*)::int from erp_private.stock_categories x where x.client_id=c.client_id) as category_count,
   (select count(*)::int from erp_private.client_account_mappings x where x.client_id=c.client_id and x.status='Active') as approved_account_count,
   (select count(*)::int from erp_private.client_account_mappings x where x.client_id=c.client_id and x.status='Draft') as pending_account_count
   from erp_private.clients c where c.deleted_at is null order by c.company_name limit 1000`;
 }
 if(p.action==='v3_client_read'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null`);
  c.primary_sector=(await syncClientSector(tx,c.client_id))||c.primary_sector;
  return {client:c,activities:await tx`select * from erp_private.client_activities where client_id=${c.client_id} order by effective_from desc`,obligations:await tx`select o.*,p.status as profile_status,p.effective_from as profile_from,p.effective_to as profile_to from erp_private.client_tax_obligations o join erp_private.client_tax_profiles p using(profile_id) where o.client_id=${c.client_id} and o.is_selected order by o.effective_from desc,o.obligation_code`,dependencies:await tx`select s.dependency_code,min(r.dependency_label) as label,count(distinct s.source_id)::int as source_count,array_agg(distinct s.source_type||':'||s.source_code) as caused_by from erp_private.client_dependency_sources s join erp_private.dependency_map_rules r on r.version_id=s.version_id and r.source_type=s.source_type and r.source_code=s.source_code and r.dependency_code=s.dependency_code where s.client_id=${c.client_id} and s.effective_from<=current_date and (s.effective_to is null or s.effective_to>=current_date) group by s.dependency_code order by s.dependency_code`,dependency_map:await tx`select version_id,version_label,effective_from,effective_to,status from erp_private.dependency_map_versions where status in ('Testing','Approved') and effective_from<=current_date and (effective_to is null or effective_to>=current_date) order by effective_from desc limit 1`,setup_changes:await tx`select * from erp_private.client_setup_change_sets where client_id=${c.client_id} order by created_at desc limit 20`,partners:await tx`select * from erp_private.partner_interests where client_id=${c.client_id} order by effective_from desc,partner_name`,periods:await tx`select * from erp_private.client_periods where client_id=${c.client_id} order by ends_on desc`,policies:await tx`select * from erp_private.stock_policy_versions where client_id=${c.client_id} order by effective_from desc`,stock_policy_block_dates:await tx`select s.activity_id,max(s.ends_on)::text as last_control_end from erp_private.stock_controls s join erp_private.projects p using(project_id) where p.client_id=${c.client_id} and s.status in ('Submitted','Approved') group by s.activity_id`,stock_categories:await tx`select * from erp_private.stock_categories where client_id=${c.client_id} order by activity_id,inventory_use,stock_class`,account_mappings:await tx`select m.*,a.name as erp_account_name,a.route,a.category_code,a.statement from erp_private.client_account_mappings m join erp_private.account_catalog a on a.code=m.erp_account_code where m.client_id=${c.client_id} order by m.status,m.source_account_name,m.effective_from desc`};
 }
 if(['v3_activities_preview','v3_activities_submit','v3_activities_review'].includes(p.action)){
  leader(a);const cid=uuid(p.client_id||p.change_id);await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-setup'},0))`;
  if(p.action==='v3_activities_preview'){
   const client=one(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`),endIds=[...new Set((Array.isArray(p.end_activity_ids)?p.end_activity_ids:[]).map((x:any)=>uuid(x)))],rows=normaliseActivityRows(p.activities,endIds.length>0),endOn=p.end_on?date(p.end_on):null,endReason=text(p.end_reason||'',2000,false);
   if(!rows.length&&!endIds.length)fail(400,'Add at least one dated activity or choose an existing activity to end.');
   if(endIds.length!== (Array.isArray(p.end_activity_ids)?p.end_activity_ids.length:0))fail(400,'An activity to end was selected more than once.');
   if(endIds.length&&(!endOn||endOn<isoDay(new Date())||!endReason.trim()))fail(400,'Choose today or a future end date and explain why each selected activity ends. Backdated changes require a separate Partner period-reopen action.');
   if(!endIds.length&&endOn)fail(400,'Choose at least one existing activity to end, or clear the end date.');
   const old=await tx`select * from erp_private.client_activities where client_id=${cid} and (effective_to is null or effective_to>=current_date) order by effective_from,activity_id`;
   const ending=old.filter((x:any)=>endIds.includes(x.activity_id));if(ending.length!==endIds.length)fail(409,'One or more selected activities are no longer active for this client. Refresh and try again.');
   if(ending.some((x:any)=>endOn<isoDay(x.effective_from)))fail(400,'An activity cannot end before it begins.');
   if((await tx`select change_id from erp_private.client_setup_change_sets where client_id=${cid} and status='Pending review' limit 1`).length)fail(409,'A client setup change is already waiting for review. Complete or return it before starting another.');
   for(const r of rows){
    for(const x of old){const xEnd=endIds.includes(x.activity_id)?endOn:isoDay(x.effective_to)||'9999-12-31';if(x.activity_code===r.activity_code&&isoDay(x.effective_from)<= (r.effective_to||'9999-12-31')&&xEnd>=r.effective_from)fail(409,`${r.activity_name} overlaps an existing dated row. Keep the current row or end it before adding another.`);}
   }
   for(const r of rows)for(const prior of rows){if(prior===r)continue;if(prior.activity_code===r.activity_code&&prior.effective_from<= (r.effective_to||'9999-12-31')&&(prior.effective_to||'9999-12-31')>=r.effective_from)fail(400,'The same activity cannot have overlapping dates in one change.');}
   for(const day of [...new Set(rows.map(x=>x.effective_from))]){const shares=[...old.filter((x:any)=>!endIds.includes(x.activity_id)&&isoDay(x.effective_from)<=day&&(!x.effective_to||isoDay(x.effective_to)>=day)).map((x:any)=>x.turnover_share),...rows.filter(x=>x.effective_from<=day&&(!x.effective_to||x.effective_to>=day)).map(x=>x.turnover_share)].filter((x:any)=>x!==null&&x!==undefined);if(shares.length&&Math.abs(shares.reduce((s:number,x:any)=>s+Number(x),0)-100)>.0001)fail(400,`Active turnover shares must total 100% from ${day}.`);}
   const dates=new Set(rows.map(x=>x.effective_from));for(const x of old)if(x.effective_to)dates.add(nextStockDay(isoDay(x.effective_to)));for(const x of endIds)dates.add(nextStockDay(endOn));for(const x of rows)if(x.effective_to)dates.add(nextStockDay(x.effective_to));
   const mapDates=dates.size?dates:[endOn],mapIds=new Set<string>();for(const day of mapDates){const vs=await tx`select version_id from erp_private.dependency_map_versions where status in ('Testing','Approved') and effective_from<=${day} and (effective_to is null or effective_to>=${day}) order by effective_from desc limit 2`;if(vs.length!==1)fail(409,`Exactly one released dependency-map version must cover ${day}.`);mapIds.add(vs[0].version_id);}
   if(mapIds.size!==1)fail(409,'These activity dates cross dependency-map versions. Split the change into separate dated reviews.');const versionId=[...mapIds][0];
   const mapInfo=one(await tx`select version_label,status from erp_private.dependency_map_versions where version_id=${versionId}`),codes=[...new Set(rows.map(x=>x.activity_code))],newDeps=await tx`select distinct dependency_code,min(dependency_label) as label from erp_private.dependency_map_rules where version_id=${versionId} and source_type='ACTIVITY' and source_code=any(${tx.array(codes)}::text[]) group by dependency_code order by dependency_code`;
   const existingDeps=await tx`select distinct s.dependency_code,min(r.dependency_label) as label from erp_private.client_dependency_sources s join erp_private.dependency_map_rules r on r.version_id=s.version_id and r.source_type=s.source_type and r.source_code=s.source_code and r.dependency_code=s.dependency_code where s.client_id=${cid} and s.effective_from<=current_date and (s.effective_to is null or s.effective_to>=current_date) group by s.dependency_code`;
   const additions=newDeps.filter((x:any)=>!existingDeps.some((y:any)=>y.dependency_code===x.dependency_code));
   const endedSources=await tx`select distinct s.dependency_code,min(r.dependency_label) as label from erp_private.client_dependency_sources s join erp_private.dependency_map_rules r on r.version_id=s.version_id and r.source_type=s.source_type and r.source_code=s.source_code and r.dependency_code=s.dependency_code where s.client_id=${cid} and s.source_type='ACTIVITY' and s.source_id=any(${tx.array(endIds)}::uuid[]) group by s.dependency_code`;
   const afterDate=endOn?nextStockDay(endOn):isoDay(new Date()),retainedAfter=new Set((await tx`select distinct s.dependency_code from erp_private.client_dependency_sources s where s.client_id=${cid} and not(s.source_type='ACTIVITY' and s.source_id=any(${tx.array(endIds)}::uuid[])) and s.effective_from<=${afterDate} and (s.effective_to is null or s.effective_to>=${afterDate})`).map((x:any)=>x.dependency_code));for(const x of newDeps)retainedAfter.add(x.dependency_code);
   const endingDeps=endedSources.filter((x:any)=>!retainedAfter.has(x.dependency_code));
   const preview={client:client.company_name,version_id:versionId,version_label:mapInfo.version_label,version_status:mapInfo.status,activities_to_add:rows,activities_to_end:ending.map((x:any)=>({activity_id:x.activity_id,activity_name:x.activity_name,effective_to:endOn,reason:endReason})),dependencies_to_add:additions,dependencies_already_enabled:newDeps.filter((x:any)=>existingDeps.some((y:any)=>y.dependency_code===x.dependency_code)),dependencies_to_end:endingDeps,activity_codes:[...new Set([...old.filter((x:any)=>!endIds.includes(x.activity_id)).map((x:any)=>x.activity_code),...codes])],effective_dates:dates};
   const change=one(await tx`insert into erp_private.client_setup_change_sets(client_id,version_id,proposed_activities,preview,created_by) values(${cid},${versionId},${tx.json({activities:rows,end_activity_ids:endIds,end_on:endOn,end_reason:endReason})},${tx.json(preview)},${a.staff_id}) returning change_id,revision,status`);return {...change,preview};
  }
  const change=one(await tx`select * from erp_private.client_setup_change_sets where change_id=${uuid(p.change_id)} and client_id=${cid} for update`);fresh(change,p);
  if(p.action==='v3_activities_submit'){
   if(change.status!=='Draft'||change.created_by!==a.staff_id)fail(409,'Only the preparer can submit their draft activity change. Refresh the client setup.');if(p.confirm_preview!==true)fail(400,'Confirm that you reviewed the impact preview.');
   await tx`update erp_private.client_setup_change_sets set status='Pending review',submitted_by=${a.staff_id},submitted_at=now() where change_id=${change.change_id}`;
   {const names=[...new Set((change.preview?.activities_to_add||change.proposed_activities?.activities||[]).map((x:any)=>String(x.activity_name||x.activity_code||'').replace(/_/g,' ')).filter(Boolean))];await notifyReviewers(tx,cid,`client activity change${names.length?' ('+names.join(', ')+')':''}, which blocks account mapping until approved`,'review:setup:'+change.change_id+':'+Date.now());}
   return {ok:true,status:'Pending review'};
  }
  if(change.status!=='Pending review'||change.submitted_by===a.staff_id)fail(403,'A different Manager or Partner must review this pending client activity change.');const status=choice(p.status,['Approved','Returned']),note=text(p.review_note,2000);if(note.length<10)fail(400,'Record a review conclusion or return reason of at least 10 characters.');
  if(status==='Approved'){
   if(p.confirm_apply!==true)fail(400,'Confirm that you reviewed the dependency impact before applying this change.');
   if((await tx`select version_id from erp_private.dependency_map_versions where version_id=${change.version_id} and status in ('Testing','Approved')`).length!==1)fail(409,'The dependency map used for this preview is no longer available. Return it and prepare a new preview with the current map.');
   const body=change.proposed_activities||{},endIds=(body.end_activity_ids||[]).map((x:any)=>uuid(x)),endOn=body.end_on?date(body.end_on):null,rows=normaliseActivityRows(body.activities||[],endIds.length>0);if(!rows.length&&!endIds.length)fail(400,'The activity change has no additions or endings.');
   if(endIds.length){const ending=await tx`select * from erp_private.client_activities where client_id=${cid} and activity_id=any(${tx.array(endIds)}::uuid[]) and effective_to is null for update`;if(ending.length!==endIds.length)fail(409,'An activity selected to end has changed since review. Return the change and prepare a new preview.');for(const x of ending){if(endOn<isoDay(x.effective_from))fail(400,'An activity cannot end before it begins.');await tx`update erp_private.client_activities set effective_to=${endOn} where activity_id=${x.activity_id}`;await tx`update erp_private.client_dependency_sources set effective_to=${endOn} where source_type='ACTIVITY' and source_id=${x.activity_id} and effective_to is null`;}}
   for(const r of rows){const inserted=one(await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,turnover_share,pack_code,activity_name,income_stream,effective_from,effective_to,evidence,created_by) values(${cid},${r.activity_code},${r.is_primary},${r.turnover_share},${r.pack_code},${r.activity_name},${r.income_stream},${r.effective_from},${r.effective_to},${r.evidence},${a.staff_id}) returning activity_id`);
    const rules=await tx`select dependency_code from erp_private.dependency_map_rules where version_id=${change.version_id} and source_type='ACTIVITY' and source_code=${r.activity_code}`;for(const rule of rules)await tx`insert into erp_private.client_dependency_sources(client_id,source_type,source_id,source_code,dependency_code,version_id,effective_from,effective_to,created_by) values(${cid},'ACTIVITY',${inserted.activity_id},${r.activity_code},${rule.dependency_code},${change.version_id},${r.effective_from},${r.effective_to},${a.staff_id}) on conflict(source_type,source_id,dependency_code,version_id) do nothing`;
   }
   await syncClientSector(tx,cid);
   await syncClientDependencyTasks(tx,a,cid);
  }
  await tx`update erp_private.client_setup_change_sets set status=${status},review_note=${note},reviewed_by=${a.staff_id},reviewed_at=now() where change_id=${change.change_id}`;await notifyOutcome(tx,change.submitted_by,cid,'client activity change',status,note,'outcome:setup:'+change.change_id);return {ok:true,status};
 }
 if(p.action==='v3_activity_add')fail(409,'The single-activity shortcut has been removed. Open Client setup → Activities / end dates to select multiple dated activities, preview dependencies and submit one change for independent review.');
 if(p.action==='v3_client_accounts_read'){
  leader(a);const cid=uuid(p.client_id),client=one(await tx`select client_id,company_name,year_end_month,year_end_day from erp_private.clients where client_id=${cid} and deleted_at is null`);
  // Activity changes waiting for approval hold back every general mapping for this client, so the checklist must be able to say so.
  return {pending_setup_changes:await tx`select s.change_id,s.submitted_at,s.preview,coalesce(m.full_name,'a colleague') submitted_by_name from erp_private.client_setup_change_sets s left join erp_private.staff_members m on m.staff_id=s.submitted_by where s.client_id=${cid} and s.status='Pending review' order by s.submitted_at`,client,accounts:await tx`select code,name,account_group,route,category_code,statement,tax_note from erp_private.account_catalog where status='Active' and not is_legacy order by code`,mappings:await tx`select m.*,a.name as erp_account_name,a.account_group,a.route,a.category_code,a.statement,a.tax_note from erp_private.client_account_mappings m join erp_private.account_catalog a on a.code=m.erp_account_code where m.client_id=${cid} order by case m.status when 'Draft' then 0 when 'Active' then 1 else 2 end,m.source_account_name,m.effective_from desc`,opening_sources:await tx`select document_id,file_name,handling_firm_id,uploaded_at,sha256 from erp_private.documents where client_id=${cid} and project_id is null and category='Import Sources' and import_purpose='Opening TB' and archived_at is null and deleted_at is null order by uploaded_at desc`};
 }
 if(p.action==='v3_client_account_mapping_tb_preview'){
  leader(a);fail(409,'Opening TB mappings are now resolved during ledger import. Open Client accounting, select the client year, then map and import the staged workbook.');
 }
 if(p.action==='v3_client_account_mapping_tb_save'){
  leader(a);fail(409,'Opening TB mappings are no longer saved for separate approval. Map all rows in the ledger import and submit the opening journal for one independent review and post.');
 }
 if(p.action==='v3_client_account_mapping_add'){
  leader(a);const cid=uuid(p.client_id),sourceCode=text(p.source_account_code||'',100,false)||null,sourceName=text(p.source_account_name,160),target=text(p.erp_account_code,5),from=date(p.effective_from),to=p.effective_to?date(p.effective_to):null;
  if(!sourceName||!from||to&&to<from)fail(400,'Enter a source account name and a valid effective date range.');
  one(await tx`select client_id from erp_private.clients where client_id=${cid} and deleted_at is null`);
  const account=one(await tx`select code from erp_private.account_catalog where code=${target} and status='Active' and not is_legacy`);
  await requireChartAccount(tx,cid,account.code,from);
  await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-accounts'},0))`;
  if((await tx`select mapping_id from erp_private.client_account_mappings where client_id=${cid} and coalesce(source_account_code,'')=coalesce(${sourceCode},'') and status in ('Draft','Active') and effective_from<=coalesce(${to},'infinity'::date) and coalesce(effective_to,'infinity'::date)>=${from} limit 1`).length)fail(409,'A saved account setup already covers this source code and date. Choose a non-overlapping range or review the existing setup.');
  return one(await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,effective_to,status,created_by) values(${cid},${sourceCode},${sourceName},${account.code},${from},${to},'Draft',${a.staff_id}) returning mapping_id`);
 }
 if(p.action==='v3_client_account_mapping_approve'||p.action==='v3_client_account_mapping_approve_batch'){
  leader(a);fail(409,'Client account mappings no longer have a separate approval. A new mapping can be used straight away as Pending review; it becomes active when a different Manager or Partner approves and posts the journal that uses it.');
 }
 if(p.action==='v3_client_account_mapping_end'){
  leader(a);const row=one(await tx`select * from erp_private.client_account_mappings where mapping_id=${uuid(p.mapping_id)} for update`);fresh(row,p);
  const to=date(p.effective_to);
  if(row.status!=='Active'||row.effective_to&&to>=asDay(row.effective_to)||to<asDay(row.effective_from))fail(400,'Choose an earlier valid end date for this active mapping.');
  await tx`update erp_private.client_account_mappings set effective_to=${to} where mapping_id=${row.mapping_id}`;
  return {ok:true};
 }
 if(p.action==='v3_identity_save'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null for update`);fresh(c,p);const v=entityInput(p);
  if(c.legal_structure){const types=await tx`select structure,subtype,engine_family from erp_private.legal_structure_types`,family=familyFor(types,c.legal_structure,c.legal_subtype);
   if(family&&v.legal_entity_type&&v.legal_entity_type!==family)fail(400,`The legal entity type follows the client’s Legal structure (${c.legal_structure}${c.legal_subtype?' · '+c.legal_subtype:''} → ${family}). Change the Legal structure in Edit client instead.`);
   if(family&&!v.legal_entity_type)v.legal_entity_type=family;}
  const predecessor=p.predecessor_client_id?uuid(p.predecessor_client_id):null;if(predecessor){if(predecessor===c.client_id)fail(400,'Choose a different predecessor client.');one(await tx`select client_id from erp_private.clients where client_id=${predecessor} and deleted_at is null`);
   const cycle=await tx`with recursive chain as (select client_id,predecessor_client_id,ARRAY[client_id] as seen from erp_private.clients where client_id=${predecessor} union all select c.client_id,c.predecessor_client_id,chain.seen||c.client_id from erp_private.clients c join chain on c.client_id=chain.predecessor_client_id where not c.client_id=any(chain.seen) and cardinality(chain.seen)<100) select client_id from chain where client_id=${c.client_id} limit 1`;if(cycle.length)fail(400,'A successor link cannot create a cycle.');
  }
  if(c.predecessor_client_id&&c.predecessor_client_id!==predecessor)fail(400,'The predecessor link is retained. Use a separate controlled entity correction.');
  if(c.legal_entity_type&&c.legal_entity_type!==v.legal_entity_type)fail(400,'A change of legal entity needs a separate successor client. Retain this entity and its outstanding work.');
  await tx`update erp_private.clients set legal_entity_type=${v.legal_entity_type},entity_evidence=${v.entity_evidence},year_end_month=${v.year_end_month},year_end_day=${v.year_end_day},predecessor_client_id=${predecessor} where client_id=${c.client_id}`;if(predecessor)await tx`update erp_private.clients set accepts_new_engagements=false where client_id=${predecessor}`;return {ok:true};
 }
 if(p.action==='v3_opening_balance_state'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null for update`);fresh(c,p);
  const status=choice(p.status,['Pending','No opening balances']),reason=text(p.reason,2000);
  if(reason.length<10)fail(400,'Record a reason of at least 10 characters.');
  if(status==='No opening balances'){
   if(!c.legal_entity_type||String(c.entity_evidence||'').trim().length<10||!c.year_end_month||!c.year_end_day)fail(400,'Confirm the client legal entity, supporting source and financial year-end in Entity / activities first.');
   if((await tx`select document_id from erp_private.documents where client_id=${c.client_id} and category='Import Sources' and import_purpose='Opening TB' and archived_at is null and deleted_at is null limit 1`).length)fail(409,'An active opening TB source is already staged. Remove that upload first if it was incorrect.');
   await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note=${reason},opening_balance_confirmed_by=${a.staff_id},opening_balance_confirmed_at=now() where client_id=${c.client_id}`;
  }else{
   if(c.opening_balance_status!=='No opening balances')fail(409,'This client is already awaiting an opening TB upload or confirmation.');
   await tx`update erp_private.clients set opening_balance_status='Pending',opening_balance_note='',opening_balance_confirmed_by=null,opening_balance_confirmed_at=null where client_id=${c.client_id}`;
  }
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values)
   values(${a.auth_user_id},current_user,'clients','OPENING_BALANCE_SETUP',${c.client_id},${tx.json({status:c.opening_balance_status,note:c.opening_balance_note})},${tx.json({status,reason,changed_by:a.staff_id})})`;
  return {ok:true,status};
 }
 if(['v3_activity_add','v3_partners_add','v3_period_add','v3_stock_policy_add'].includes(p.action)){
  leader(a);const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid} and deleted_at is null`);await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':config'},0))`;
  if(p.action==='v3_activity_add'){
   fail(409,'The single-activity shortcut has been removed. Open Client setup → Activities / end dates to select multiple dated activities, preview dependencies and submit one change for independent review.');
  }
  if(p.action==='v3_partners_add'){
   const c=one(await tx`select legal_entity_type from erp_private.clients where client_id=${cid}`);if(c.legal_entity_type!=='Partnership')fail(400,'Confirm Partnership as the legal entity type first.');const [s,e]=range(p),group=crypto.randomUUID(),rows=partnerRatios(p.partners),ref=text(p.agreement_reference,2000);
   if((await tx`select interest_id from erp_private.partner_interests where client_id=${cid} and effective_from<=${e} and effective_to>=${s} limit 1`).length)fail(400,'A ratio window overlaps. Existing agreements remain unchanged; use a new non-overlapping window.');
   for(const r of rows)await tx`insert into erp_private.partner_interests(client_id,partner_name,partner_pin,recipient_type,profit_percentage,effective_from,effective_to,agreement_reference,created_by,group_id) values(${cid},${r.partner_name},${r.partner_pin},${r.recipient_type},${r.profit_percentage},${s},${e},${ref},${a.staff_id},${group})`;return {ok:true};
  }
  if(p.action==='v3_period_add'){
   const [s,e]=range(p);if((await tx`select period_id from erp_private.client_periods where client_id=${cid} and starts_on<=${e} and ends_on>=${s} limit 1`).length)fail(400,'A verified reporting period already overlaps.');
   return one(await tx`insert into erp_private.client_periods(client_id,starts_on,ends_on,return_due_date,internal_due_date,payment_due_date,deadline_rule_reference,created_by) values(${cid},${s},${e},${p.return_due_date?date(p.return_due_date):null},${p.internal_due_date?date(p.internal_due_date):null},${p.payment_due_date?date(p.payment_due_date):null},${text(p.deadline_rule_reference,2000)},${a.staff_id}) returning period_id`);
  }
  const activity=one(await tx`select * from erp_private.client_activities where activity_id=${uuid(p.activity_id)} and client_id=${cid}`),from=date(p.effective_from),threshold=p.variance_threshold==null||p.variance_threshold===''?100:Number(p.variance_threshold);
  if(!from)fail(400,'Choose the date these stock settings begin.');
  if(from<asDay(activity.effective_from)||activity.effective_to&&from>asDay(activity.effective_to))fail(400,`Choose a date within the business activity period (${asDay(activity.effective_from)}${activity.effective_to?` to ${asDay(activity.effective_to)}`:' onward'}).`);
  if(!Number.isFinite(threshold)||threshold<0||threshold>1e9)fail(400,'Enter a valid review threshold in KES, or leave it blank to use KES 100.');
  const previous=(await tx`select effective_from from erp_private.stock_policy_versions where activity_id=${activity.activity_id} order by effective_from desc limit 1`)[0];
  if(previous&&a.category_code!=='PARTNER')fail(403,'Only a Partner can change saved client stock settings. Ask a Partner to make the dated update.');
  const lastControl=(await tx`select max(ends_on)::text as last_end from erp_private.stock_controls where activity_id=${activity.activity_id} and status in ('Submitted','Approved')`)[0]?.last_end||'';
  const minimum=[asDay(activity.effective_from),nextStockDay(previous?.effective_from),nextStockDay(lastControl)].filter(Boolean).sort().at(-1)||asDay(activity.effective_from);
  if(activity.effective_to&&minimum>asDay(activity.effective_to))fail(400,'No stock settings date is available within this activity period. Update the activity dates first.');
  if(from<minimum)fail(400,`Choose ${minimum} or later. New settings must start after the current settings and any submitted or approved stock period.`);
  const basis=text(p.valuation_basis||'',2000,false),policyEvidence=stockPolicyEvidence(p);
  return one(await tx`insert into erp_private.stock_policy_versions(client_id,activity_id,inventory_method,valuation_basis,effective_from,count_frequency,variance_threshold,evidence,configured_by) values(${cid},${activity.activity_id},${choice(p.inventory_method,['Periodic','Perpetual'])},${basis},${from},${choice(p.count_frequency,['Weekly','Monthly','Annually'])},${threshold},${policyEvidence},${a.staff_id}) returning policy_id`);
 }
 if(p.action==='v3_vat_categories_save'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null for update`);fresh(c,p);
  const cats=vatCategoriesInput(p.vat_categories_sold);
  await tx`update erp_private.clients set vat_categories_sold=${tx.array?tx.array(cats):cats} where client_id=${c.client_id}`;return {ok:true,vat_categories_sold:cats};
 }
 const pr=await project(tx,p.project_id),pid=pr.project_id;
 if(p.action==='v3_project_read')return {vat_categories_sold:(await tx`select vat_categories_sold from erp_private.clients where client_id=${pr.client_id}`)[0]?.vat_categories_sold||null,activities:await tx`select * from erp_private.client_activities where client_id=${pr.client_id} order by activity_name`,policies:await tx`select * from erp_private.stock_policy_versions where client_id=${pr.client_id} order by effective_from desc`,controls:await tx`select * from erp_private.stock_controls where project_id=${pid} order by ends_on desc`,requests:await tx`select * from erp_private.category_requests where project_id=${pid} order by created_at desc limit 100`};
 if(p.action==='v3_mapping_select'){
  const search='%'+text(p.search||'',160,false)+'%',mapping=choice(p.mapping||'All',['All','Unmapped','Inventory','Expenditure','PPE']),dataset=choice(p.dataset||'Costs',['Costs','Purchases','Expenditure','Non-eTIMS']),rate=choice(p.vat_category||'All',['All','16%','8%','0%','Exempt','Non-eTIMS','Unconfirmed']);
  let mappingHint:any=null;
  if(p.mapping_hint){const route=Number(p.mapping_hint.route),category=text(p.mapping_hint.category_code,10).toUpperCase(),code=text(p.mapping_hint.account_code,5);if(![1,2,3].includes(route)||!category||!/^[0-9]{5}$/.test(code))fail(400,'Choose a valid uploaded routing and TB code pair.');const account=one(await tx`select code,route,category_code from erp_private.account_catalog where code=${code} and status='Active' and not is_legacy`);if(Number(account.route)!==route||String(account.category_code).toUpperCase()!==category)fail(409,'The uploaded routing and TB code pair no longer matches the active account catalogue. Refresh the import.');mappingHint={route,category_code:account.category_code,account_code:account.code};}
  const hasHint=!!mappingHint,hintAccount=mappingHint?.account_code||'',hintRoute=mappingHint?.route||0,hintCategory=mappingHint?.category_code||'';
  const mappingPeriod=p.mapping_period?date(p.mapping_period):null;
  const rows=await tx`select r.row_id,r.revision,r.normalized,b.period_start from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and b.archived_at is null and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') and (${dataset}='Costs' or r.dataset=${dataset}) and (${mapping}='All' or ${mapping}='Unmapped' and r.account_code is null or r.account_code is not null and r.route=case ${mapping} when 'Inventory' then 1 when 'Expenditure' then 2 when 'PPE' then 3 else 0 end) and (${hasHint}=false or (r.account_code is null and r.normalized->'mapping_suggestion'->>'account_code'=${hintAccount} and r.normalized->'mapping_suggestion'->>'route'=${String(hintRoute)} and r.normalized->'mapping_suggestion'->>'category_code'=${hintCategory})) and (${rate}='All' or (case when r.dataset='Non-eTIMS' then 'Non-eTIMS' else coalesce(r.normalized->>'vat_category','Unconfirmed') end)=${rate}) and (${mappingPeriod||''}='' or coalesce(nullif(left(r.normalized->>'return_month',10),''),b.period_start::text,left(r.normalized->>'date',10))=${mappingPeriod||''}) and concat_ws(' ',r.normalized->>'invoice',r.normalized->>'reference',r.normalized->>'party',r.normalized->>'party_pin',r.normalized->>'description') ilike ${search} order by r.row_id limit 10001`;
  if(!rows.length||rows.length>10000)fail(400,'Select 1–10,000 matching cost rows. Narrow the filters if necessary.');
  const snapshot=rows.map((r:any)=>({row_id:r.row_id,revision:r.revision})),periods=new Map<string,any>();for(const r of rows){const period=String(r.normalized.return_month||isoDay(r.period_start)||r.normalized.date||'').slice(0,10);if(!period)continue;const g=periods.get(period)||{period,count:0,net:0,vat:0};g.count++;g.net+=Number(r.normalized.amount||0);g.vat+=Number(r.normalized.vat||0);periods.set(period,g);}
  const totals={mapping_dates:[...new Set(rows.map((r:any)=>String(r.normalized.date||isoDay(r.period_start)||r.normalized.return_month||'').slice(0,10)).filter(Boolean))].sort(),mapping_periods:[...periods.values()].sort((x:any,y:any)=>x.period.localeCompare(y.period)).map((g:any)=>({...g,net:money(g.net),vat:money(g.vat)})),mapping_period:mappingPeriod,count:rows.length,net:money(rows.reduce((s:number,r:any)=>s+Number(r.normalized.amount||0),0)),vat:money(rows.reduce((s:number,r:any)=>s+Number(r.normalized.vat||0),0))},hash=await digest(snapshot);
  return {...one(await tx`insert into erp_private.mapping_selections(project_id,selected_by,filters,rows_snapshot,totals,selection_hash) values(${pid},${a.staff_id},${tx.json({search:p.search||'',mapping,dataset,vat_category:rate,mapping_period:mappingPeriod,mapping_hint:mappingHint})},${tx.json(snapshot)},${tx.json(totals)},${hash}) returning selection_id,expires_at`),selection_hash:hash,...totals,...(mappingHint?{mapping_hint:mappingHint}:{})};
 }
 if(p.action==='v3_suggestions'){
  const row=one(await tx`select r.* from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.row_id=${uuid(p.row_id)} and r.project_id=${pid} and b.archived_at is null`);
  const history=await tx`select r.row_id,r.account_code,r.normalized,r.narration,r.review_details,b.period_start from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) join erp_private.tax_row_reviews v using(row_id) where b.archived_at is null and r.client_id=${pr.client_id} and r.row_id<>${row.row_id} and v.source_revision=r.revision and v.decision in ('Eligible','Excluded') and r.normalized->>'party_pin'=${row.normalized.party_pin||''} and r.account_code is not null and not r.is_split_parent order by b.period_start desc limit 200`;
  const suggested=suggestionFor(row,history),activities=[...new Set(history.map((x:any)=>x.review_details?.activity_id).filter(Boolean))];if(activities.length===1)suggested.activity_id=activities[0];
  return suggested;
 }
 if(p.action==='v3_category_request'){
  one(await tx`select r.row_id from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.row_id=${uuid(p.row_id)} and r.project_id=${pid} and b.archived_at is null and not r.is_split_parent`);
  return one(await tx`insert into erp_private.category_requests(project_id,row_id,reason,proposed_name,evidence,requested_by) values(${pid},${uuid(p.row_id)},${text(p.reason,2000)},${text(p.proposed_name,160)},${text(p.evidence,2000)},${a.staff_id}) returning request_id`);
 }
 if(p.action==='v3_category_decide'){
  leader(a);const r=one(await tx`select * from erp_private.category_requests where request_id=${uuid(p.request_id)} and project_id=${pid} for update`);fresh(r,p);if(r.status!=='Pending'||r.requested_by===a.staff_id)fail(400,'Another Manager or Partner must decide the pending request.');
  const status=choice(p.status,['Approved','Rejected']),code=status==='Approved'?text(p.account_code,5):null;if(code)one(await tx`select code from erp_private.account_catalog where code=${code} and status='Active' and not is_legacy`);
  await tx`update erp_private.category_requests set status=${status},account_code=${code},decision_note=${text(p.decision_note,2000)},decided_by=${a.staff_id} where request_id=${r.request_id}`;return {ok:true};
 }
 if(p.action==='v3_stock_create'){
  const [s,e]=range(p),activity=one(await tx`select * from erp_private.client_activities where activity_id=${uuid(p.activity_id)} and client_id=${pr.client_id} and effective_from<=${s} and (effective_to is null or effective_to>=${e})`),policy=one(await tx`select * from erp_private.stock_policy_versions where activity_id=${activity.activity_id} and effective_from<=${s} order by effective_from desc limit 1`);
  const vat=p.vat_category?choice(p.vat_category,VAT_CATEGORIES):null,sold=(await tx`select vat_categories_sold from erp_private.clients where client_id=${pr.client_id}`)[0]?.vat_categories_sold;
  if(vat&&sold&&!sold.includes(vat))fail(400,`Client does not sell ${vat} goods. No ${vat} stock roll is needed; change the client's VAT categories first if this is wrong.`);
  const stockClass=vat?'VAT '+vat:text(p.stock_class,100),carry=await carriedOpening(tx,pr.client_id,activity.activity_id,stockClass,s);
  return {...one(await tx`insert into erp_private.stock_controls(project_id,activity_id,policy_id,stock_class,starts_on,ends_on,prepared_by,vat_category,inputs) values(${pid},${activity.activity_id},${policy.policy_id},${stockClass},${s},${e},${a.staff_id},${vat},${tx.json(carry)}) returning control_id`),carried_opening:carry.opening_value??null};
 }
 if(p.action==='v3_stock_create_vat'){
  const [s,e]=range(p),activity=one(await tx`select * from erp_private.client_activities where activity_id=${uuid(p.activity_id)} and client_id=${pr.client_id} and effective_from<=${s} and (effective_to is null or effective_to>=${e})`),policy=one(await tx`select * from erp_private.stock_policy_versions where activity_id=${activity.activity_id} and effective_from<=${s} order by effective_from desc limit 1`);
  const sold=(await tx`select vat_categories_sold from erp_private.clients where client_id=${pr.client_id}`)[0]?.vat_categories_sold;
  if(!sold)fail(400,'Record the VAT categories this client sells first (Client setup → VAT categories sold).');
  const made=[];for(const vat of VAT_CATEGORIES.filter(x=>sold.includes(x))){const carry=await carriedOpening(tx,pr.client_id,activity.activity_id,'VAT '+vat,s),r=await tx`insert into erp_private.stock_controls(project_id,activity_id,policy_id,stock_class,starts_on,ends_on,prepared_by,vat_category,inputs) values(${pid},${activity.activity_id},${policy.policy_id},${'VAT '+vat},${s},${e},${a.staff_id},${vat},${tx.json(carry)}) on conflict do nothing returning control_id`;if(r.length)made.push(vat);}
  return {created:made,categories:VAT_CATEGORIES.filter(x=>sold.includes(x))};
 }
 if(['v3_stock_read','v3_stock_save','v3_stock_submit','v3_stock_review'].includes(p.action)){
  await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;const c=one(await tx`select * from erp_private.stock_controls where control_id=${uuid(p.control_id)} and project_id=${pid} for update`),policy=one(await tx`select * from erp_private.stock_policy_versions where policy_id=${c.policy_id}`),src=await stockSource(tx,c);
  if(p.action==='v3_stock_read')return {record:c,policy,source:{...src,rows:undefined},result:c.status==='Approved'?c.snapshot?.result:c.result};
  fresh(c,p);
  if(p.action==='v3_stock_review'){
   reviewer(a);if(c.status!=='Submitted'||c.prepared_by===a.staff_id)fail(403,'Another reviewer must review the submitted stock control.');const status=choice(p.status,['Approved','Returned']),note=text(p.review_note,2000);if(note.length<10)fail(400,'Explain the independent review conclusion in at least 10 characters.');
   if(status==='Approved'&&c.snapshot?.source_fingerprint!==src.fingerprint)fail(400,'Source rows changed. Return and reconcile the stock control.');
   if(status==='Approved'&&c.result?.issues?.length&&!p.variance_evidence_id)fail(400,'Resolve the stock issues or link independent variance evidence.');
   if(status==='Approved'){if(c.result?.opening_value===null||c.result?.closing_value===null||src.unreviewed||src.unallocated||!src.selected_count)fail(400,'Support openings, source mapping and independent tax row reviews first.');if(c.result.closing_value<0)fail(400,'Resolve negative closing stock before approval.');if(p.variance_evidence_id)await evidence(tx,p.variance_evidence_id,pid);}
   await tx`update erp_private.stock_controls set status=${status},review_note=${note},reviewed_by=${a.staff_id},snapshot=${tx.json({...c.snapshot,review_note:note,reviewed_by:a.staff_id,variance_evidence_id:p.variance_evidence_id||null})} where control_id=${c.control_id}`;return {ok:true};
  }
  if(!['Draft','Returned'].includes(c.status)||c.prepared_by!==a.staff_id)fail(403,'Only the assigned preparer can change unsubmitted stock work.');
  const inputs=p.action==='v3_stock_save'&&p.inputs&&typeof p.inputs==='object'&&!Array.isArray(p.inputs)?{...p.inputs,...Object.fromEntries(['carried_from','carried_opening_value','carried_through'].filter(k=>c.inputs?.[k]!==undefined).map(k=>[k,c.inputs[k]]))}:p.action==='v3_stock_save'?p.inputs:c.inputs;if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||JSON.stringify(inputs).length>20000)fail(400,'Invalid stock values.');
  const result=stockValues({...inputs,...(c.vat_category?{net_sales:src.net_sales}:{}),resale_purchases:src.resale_purchases,landed_costs:src.landed_costs},policy);
  if(p.action==='v3_stock_submit'&&(result.opening_value===null||result.closing_value===null||!String(inputs.evidence_reference||'').trim()||!String(inputs.reconciliation_note||'').trim()||!src.selected_count||src.unreviewed||src.unallocated))fail(400,'Complete supported opening, cost, evidence, source allocation and row review before submission.');
  await tx`update erp_private.stock_controls set inputs=${tx.json(inputs)},result=${tx.json(result)},status=${p.action==='v3_stock_submit'?'Submitted':'Draft'},snapshot=${tx.json({inputs,result,policy,source_fingerprint:src.fingerprint,source_rows:src.rows})} where control_id=${c.control_id}`;return {ok:true};
 }
 if(['v3_bank_defer','v3_bank_read','v3_bank_supplement','v3_bank_review'].includes(p.action)){
  const c=one(await tx`select * from erp_private.sales_reconciliations where reconciliation_id=${uuid(p.reconciliation_id)} and project_id=${pid} for update`);
  if(p.action==='v3_bank_read')return {deferral:(await tx`select * from erp_private.bank_deferrals where reconciliation_id=${c.reconciliation_id}`)[0]||null,supplements:await tx`select * from erp_private.bank_supplements where reconciliation_id=${c.reconciliation_id} order by created_at desc`};
  if(p.action==='v3_bank_defer'){
   leader(a);if(c.review_type!=='Monthly'||!['Draft','Returned'].includes(c.status)||c.prepared_by===a.staff_id)fail(400,'A different Manager/Partner must approve deferral on an unsubmitted monthly review.');
   const expected=date(p.expected_on);if(!expected||expected<new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date()))fail(400,'Enter a current/future expected statement date.');await evidence(tx,p.evidence_id,pid);
   one(await tx`select staff_id from erp_private.assignment_candidates() where staff_id=${uuid(p.owner_id)}`);
   return one(await tx`insert into erp_private.bank_deferrals(reconciliation_id,project_id,requested_by,expected_on,owner_id,evidence_id,reason,alternative_control,approved_by) values(${c.reconciliation_id},${pid},${c.prepared_by},${expected},${uuid(p.owner_id)},${uuid(p.evidence_id)},${text(p.reason,2000)},${text(p.alternative_control,4000)},${a.staff_id}) returning reconciliation_id`);
  }
  if(p.action==='v3_bank_supplement'){
   if(c.status!=='Locked'||!(await tx`select reconciliation_id from erp_private.bank_deferrals where reconciliation_id=${c.reconciliation_id}`).length)fail(400,'Create a supplement only against a locked deferred-bank review.');await evidence(tx,p.document_id,pid);
   return one(await tx`insert into erp_private.bank_supplements(reconciliation_id,project_id,document_id,conclusion,amendment_required,prepared_by) values(${c.reconciliation_id},${pid},${uuid(p.document_id)},${text(p.conclusion,4000)},${p.amendment_required===true},${a.staff_id}) returning supplement_id`);
  }
  reviewer(a);const s=one(await tx`select * from erp_private.bank_supplements where supplement_id=${uuid(p.supplement_id)} and reconciliation_id=${c.reconciliation_id} for update`);fresh(s,p);if(s.prepared_by===a.staff_id||s.status!=='Pending')fail(403,'Another reviewer must review a pending bank supplement.');await tx`update erp_private.bank_supplements set status=${choice(p.status,['Approved','Returned'])},review_note=${text(p.review_note,2000)},reviewed_by=${a.staff_id} where supplement_id=${s.supplement_id}`;return {ok:true};
 }
 if(p.action==='v3_export_readiness'){
  const c=one(await tx`select * from erp_private.clients where client_id=${pr.client_id}`),kind=choice(p.kind,['VAT3','P10','IT1','IT2P','IT2C']),[s,e]=range(p),period=(await tx`select * from erp_private.client_periods where client_id=${pr.client_id} and starts_on<=${s} and ends_on>=${e} limit 1`)[0],stock=await tx`select result,status from erp_private.stock_controls where project_id=${pid} and starts_on>=${s} and ends_on<=${e}`;
  return exportReadiness({client:c,kind,period,stock});
 }
 fail(404,'Unknown improvement control action.');
}
