import {fail,text,uuid} from './validation.mjs';
import {mapValue,inventoryDetails,isCost} from './accounting-rules.mjs';
import {chartResolver} from './client-chart.ts';
import {suggestionsFor,loadBlocks,isBlocked,HISTORY_METHOD} from './purchase-history.ts';
// Automatic account mapping. A purchase row whose routing code (column M) and TB item code (column N) exactly match one active,
// non-legacy account of the central chart is mapped when it is imported, so staff only handle exceptions. The mapping classifies the
// row; it never approves input VAT, deductibility or posting. A Manager or Partner can remove it with a reason; a removed row is
// never mapped automatically again. A Manager or Partner can also record a dated supplier override so the same supplier and account are not mapped automatically again.
// An automatic mapping also needs the client's approved chart in force on the invoice date; every row left for staff carries the reason.
export const AUTO_METHOD='Auto-mapped — chart verified';
export const CODE_METHODS=['Uploaded routing and TB codes',AUTO_METHOD,HISTORY_METHOD];
const day=(v:any)=>String(v instanceof Date?v.toISOString():v).slice(0,10);
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);

export async function autoMapRows(tx:any,a:any,project:any,scope:{batchId?:string,rowIds?:string[]}={}){
 const rows=await tx`select r.*,b.period_start from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${project.project_id} and b.archived_at is null and r.account_code is null and r.parent_row_id is null and not r.is_split_parent
  and r.dataset in ('Purchases','Expenditure','Non-eTIMS')
  and coalesce((r.review_details->>'auto_map_blocked')::boolean,false)=false
  and (${scope.batchId||null}::uuid is null or r.batch_id=${scope.batchId||null}::uuid)
  and (${scope.rowIds?tx.array(scope.rowIds):null}::uuid[] is null or r.row_id=any(${scope.rowIds?tx.array(scope.rowIds):null}::uuid[]))
  and erp_private.tax_period_open(r.project_id,b.period_start,b.period_end)
  order by r.source_row limit 10000`;
 if(!rows.length)return {mapped:0,left_for_staff:0,reasons:{},exceptions:[]};
 const accounts=await tx`select * from erp_private.account_catalog order by code`,chartAt=await chartResolver(tx,project.client_id);
 const policy=(await tx`select * from erp_private.accounting_policies where client_id=${project.client_id}`)[0];
 const activities=await tx`select * from erp_private.client_activities where client_id=${project.client_id} order by effective_from`;
 const policies=activities.length?await tx`select * from erp_private.stock_policy_versions where activity_id=any(${tx.array(activities.map((x:any)=>x.activity_id))}::uuid[]) order by effective_from desc`:[];
 const soldVat=(await tx`select vat_categories_sold from erp_private.clients where client_id=${project.client_id}`)[0]?.vat_categories_sold||null;
 const stamp=new Date().toISOString(),updates:any[]=[],history=await suggestionsFor(tx,project,rows);let viaHistory=0;
 const blocks=await loadBlocks(tx,project.client_id),notes=new Map<string,{code:string,reason:string}>();
 for(const r of rows){
  const note=(code:string,reason:string)=>{notes.set(r.row_id,{code,reason});};
  try{
   // Without uploaded codes, a long and perfectly consistent expense history for the supplier maps the row, but only when that history was
   // independently posted and not reversed; a shorter or unposted history is only suggested on screen.
   let hint=r.normalized.mapping_suggestion,fromHistory=false;
   if(!hint){const s=history.get(r.row_id);if(!s?.auto){note('NO_CODES','No routing and TB codes in the upload, and not enough posted history for this supplier to map it automatically.');continue;}hint={route:s.route,category_code:s.category_code,account_code:s.account_code};fromHistory=true;}
   const at=String(r.normalized.date||day(r.period_start)),route=Number(hint.route),code=String(hint.account_code??'');
   const account=accounts.find((x:any)=>x.code===code);
   if(!account){note('TB_CODE_UNKNOWN',`TB item code ${code||'(blank)'} is not an account in the master chart.`);continue;}
   if(account.is_legacy){note('TB_CODE_LEGACY',`TB item code ${code} is a legacy account and cannot be used.`);continue;}
   if(account.status!=='Active'){note('TB_CODE_INACTIVE',`TB item code ${code} is not active in the master chart.`);continue;}
   if(Number(account.route)!==route){note('ROUTE_DIFFERS',`Routing ${hint.route} differs from the master chart: ${code} is routing ${account.route}.`);continue;}
   if(String(account.category_code).toUpperCase()!==String(hint.category_code).toUpperCase()){note('CATEGORY_DIFFERS',`Routing/category code ${hint.category_code} differs from the master chart: ${code} is ${account.category_code}.`);continue;}
   const block=isBlocked(blocks,r,account.code,at);
   if(block){note('SUPPLIER_BLOCKED',`A Manager or Partner stopped automatic mapping of this supplier to ${code} from ${day(block.effective_from)}: ${String(block.reason).slice(0,160)}`);continue;}
   // The mapping means "verified for this client", so it needs the client's approved chart in force on the invoice date.
   const chart=chartAt(at);
   if(!chart){note('NO_APPROVED_CHART',`No approved client chart of accounts covers ${at}. Approve the client chart first.`);continue;}
   if(!chart.codes.has(account.code)){note('NOT_IN_CHART',`Account ${code} is not in the client's approved chart of accounts for ${at}.`);continue;}
   const available=activities.filter((x:any)=>day(x.effective_from)<=at&&(!x.effective_to||day(x.effective_to)>=at)),chosen=available.length===1?available[0]:null;
   if(available.length>1){note('ACTIVITY_REQUIRED','More than one business activity applies on this date. Choose the activity when mapping.');continue;}
   if(route===1){
    if(!chosen){note('ACTIVITY_REQUIRED','Stock needs one approved business activity on the invoice date.');continue;}
    const vat=r.normalized.vat_category;if(soldVat&&['16%','8%','0%','Exempt'].includes(vat)&&!soldVat.includes(vat)){note('VAT_CATEGORY_NOT_SOLD',`VAT category ${vat} is not one of the categories this client sells.`);continue;}
   }
   const own=policies.filter((v:any)=>v.activity_id===chosen?.activity_id),dated=own.find((v:any)=>day(v.effective_from)<=at);
   const v=mapValue(r,{route,account_code:account.code},accounts,own.length?dated:policy);
   const details=inventoryDetails(r,{route,account_code:account.code});if(chosen)details.activity_id=chosen.activity_id;delete details.auto_map_note;
   details.mapping_confirmation={method:fromHistory?HISTORY_METHOD:AUTO_METHOD,routing_code:account.category_code,tb_item_code:account.code,chart_version:account.catalog_version??null,mapped_at:stamp,imported_by:a.staff_id};
   if(fromHistory)viaHistory++;
   updates.push({row_id:r.row_id,route:v.route,category_code:v.category_code,account_code:v.account_code,narration:v.narration,asset_details:v.asset_details,first_use_status:v.first_use_status,first_use_date:v.first_use_date,review_details:details});
  }catch(e:any){ /* Anything the manual mapping would refuse stays unmapped for staff to resolve, with the reason. */ note('MAPPING_REFUSED',String(e?.message||'The mapping rules refused this row.').slice(0,300)); }
 }
 const mappedIds=new Set(updates.map((u:any)=>u.row_id)),noteUpdates:any[]=[];
 for(const r of rows){const n=notes.get(r.row_id);if(!n||mappedIds.has(r.row_id))continue;const old=r.review_details?.auto_map_note;if(old?.code===n.code&&old?.reason===n.reason)continue;noteUpdates.push({row_id:r.row_id,note:{...n,at:stamp}});}
 for(let i=0;i<noteUpdates.length;i+=500)await tx`update erp_private.workbook_rows r set review_details=coalesce(r.review_details,'{}'::jsonb)||jsonb_build_object('auto_map_note',v.note) from jsonb_to_recordset(${tx.json(noteUpdates.slice(i,i+500))}::jsonb) as v(row_id uuid,note jsonb) where r.row_id=v.row_id and r.account_code is null`;
 for(let i=0;i<updates.length;i+=500)await tx`update erp_private.workbook_rows r set route=v.route,category_code=v.category_code,account_code=v.account_code,narration=v.narration,asset_details=v.asset_details,first_use_status=v.first_use_status,first_use_date=v.first_use_date,review_details=v.review_details from jsonb_to_recordset(${tx.json(updates.slice(i,i+500))}::jsonb) as v(row_id uuid,route integer,category_code text,account_code text,narration text,asset_details text,first_use_status text,first_use_date date,review_details jsonb) where r.row_id=v.row_id`;
 if(updates.length)await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'workbook_rows','AUTO_MAPPING',${project.project_id},${tx.json({count:updates.length,method:AUTO_METHOD,via_supplier_history:viaHistory,row_ids:updates.map((x:any)=>x.row_id).slice(0,500)})})`;
 const exceptions=rows.filter((r:any)=>!mappedIds.has(r.row_id)&&notes.has(r.row_id)).map((r:any)=>({row_id:r.row_id,source_row:r.source_row,...notes.get(r.row_id)!})),reasons:Record<string,number>={};
 for(const e of exceptions)reasons[e.code]=(reasons[e.code]||0)+1;
 return {mapped:updates.length,left_for_staff:rows.length-updates.length,reasons,exceptions:exceptions.slice(0,200)};
}

export async function autoMapAction(tx:any,a:any,p:any){
 if(!['workbook_auto_map','workbook_mapping_remove','workbook_supplier_blocks','workbook_supplier_block_end'].includes(p.action))return undefined;
 const pid=uuid(p.project_id),project=(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is not available to your account.');
 if(project.status==='Archived')fail(400,'Archived projects retain read-only accounting history.');
 if(p.action==='workbook_auto_map'){
  if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
  return {ok:true,...await autoMapRows(tx,a,project)};
 }
 if(p.action==='workbook_supplier_blocks'){
  const list=await tx`select b.block_id,b.party_pin,b.account_code,c.name account_name,b.effective_from,b.reason,b.created_at,b.ended_at,b.end_reason,s.full_name created_by_name
   from erp_private.supplier_mapping_blocks b join erp_private.account_catalog c on c.code=b.account_code left join erp_private.staff_members s on s.staff_id=b.created_by
   where b.client_id=${project.client_id} order by b.ended_at is not null,b.created_at desc limit 200`;
  return {ok:true,blocks:list};
 }
 if(p.action==='workbook_supplier_block_end'){
  if(!isLeader(a))fail(403,'Only a Manager or Partner can end a supplier mapping rule.');
  const why=text(p.reason||'',1000,false).trim();if(why.length<10)fail(400,'Give the reason for ending the rule (at least 10 characters).');
  const bid=uuid(p.block_id),b=(await tx`select * from erp_private.supplier_mapping_blocks where block_id=${bid} and client_id=${project.client_id} for update`)[0];
  if(!b)fail(403,'This supplier rule is not available to your account.');if(b.ended_at)fail(409,'This supplier rule has already ended.');
  await tx`update erp_private.supplier_mapping_blocks set ended_at=now(),ended_by=${a.staff_id},end_reason=${why} where block_id=${bid}`;
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'supplier_mapping_blocks','SUPPLIER_MAPPING_RULE_ENDED',${bid},${tx.json({party_pin:b.party_pin,account_code:b.account_code,reason:why})})`;
  return {ok:true,ended:1};
 }
 if(!isLeader(a))fail(403,'Only a Manager or Partner can remove an automatic mapping.');
 const reason=text(p.reason||'',1000,false).trim();if(reason.length<10)fail(400,'Give the reason for removing the mapping (at least 10 characters).');
 const ids=Array.isArray(p.row_ids)?[...new Set(p.row_ids.map((x:any)=>uuid(x)))]:[];if(!ids.length||ids.length>500)fail(400,'Select between 1 and 500 rows.');
 const rows=await tx`select r.*,b.period_start,b.period_end from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and b.archived_at is null and r.row_id=any(${tx.array(ids)}::uuid[]) order by r.row_id for update of r`;
 if(rows.length!==ids.length)fail(403,'All selected rows must belong to this authorised project.');
 const stamp=new Date().toISOString(),updates:any[]=[],returnCases=new Map<string,any>(),wantBlock=p.block_supplier===true||p.block_supplier==='true'||p.block_supplier==='on',blockDates=new Map<string,{pin:string,account:string,from:string}>();
 for(const r of rows){
  if(!isCost(r)||!r.account_code)fail(400,`Source row ${r.source_row} is not mapped.`);
  const method=r.review_details?.mapping_confirmation?.method;
  if(!CODE_METHODS.includes(method))fail(400,`Source row ${r.source_row} was mapped by staff in the mapping screen. Correct it there; only mappings made from the uploaded codes are removed here.`);
  const open=(await tx`select erp_private.tax_period_open(${pid}::uuid,${day(r.period_start)}::date,${day(r.period_end)}::date) as open`)[0].open;
  if(!open){
   // A submitted period is not frozen: the review is cancelled and the case goes back to its preparer. A locked or filed period is corrected only by a controlled adjustment.
   const cases=await tx`select case_id,status,kind,starts_on,ends_on from erp_private.tax_cases where project_id=${pid} and status in ('Submitted','Locked','Filed') and starts_on<=${day(r.period_end)}::date and ends_on>=${day(r.period_start)}::date`;
   if(!cases.length||cases.some((c:any)=>c.status!=='Submitted'))fail(400,`The period of source row ${r.source_row} is locked or filed. Correct it through a controlled adjustment; the original posting is kept.`);
   for(const c of cases)returnCases.set(c.case_id,c);
  }
  const used=(await tx`select journal_id from erp_private.ledger_sources where source_kind='Workbook row' and source_key=${r.row_id}::text limit 1`)[0];
  if(used)fail(400,`Source row ${r.source_row} is already in a journal. Return or reverse that journal first.`);
  const details={...(r.review_details||{})};delete details.mapping_confirmation;details.auto_map_blocked=true;
  details.mapping_history=[...(Array.isArray(details.mapping_history)?details.mapping_history:[]),{action:'Mapping removed',by:a.staff_id,at:stamp,reason,previous:{route:r.route,category_code:r.category_code,account_code:r.account_code,method},uploaded_codes:r.normalized?.mapping_suggestion||null}];
  if(wantBlock){
   const pin=String(r.normalized?.party_pin||'').trim().toUpperCase();if(!pin)fail(400,`Source row ${r.source_row} has no supplier PIN, so a supplier rule cannot be recorded for it.`);
   const from=String(r.normalized?.date||day(r.period_start)).slice(0,10),k=pin+'|'+r.account_code,old=blockDates.get(k);
   if(!old||from<old.from)blockDates.set(k,{pin,account:r.account_code,from});
  }
  updates.push({row_id:r.row_id,review_details:details,previous:{route:r.route,category_code:r.category_code,account_code:r.account_code,method}});
 }
 let blocked=0;
 for(const b of blockDates.values()){
  const cur=(await tx`select block_id,effective_from from erp_private.supplier_mapping_blocks where client_id=${project.client_id} and party_pin=${b.pin} and account_code=${b.account} and ended_at is null for update`)[0];
  if(cur)continue; // a rule for this supplier and account is already in force; end it first to record a different date
  await tx`insert into erp_private.supplier_mapping_blocks(client_id,party_pin,account_code,effective_from,reason,created_by) values(${project.client_id},${b.pin},${b.account},${b.from},${reason},${a.staff_id})`;blocked++;
 }
 for(const c of returnCases.values())await tx`update erp_private.tax_cases set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${('Review cancelled: a Manager or Partner removed an account mapping in this period. Reason: '+reason).slice(0,2000)} where case_id=${c.case_id} and status='Submitted'`;
 for(const u of updates)await tx`update erp_private.workbook_rows set route=null,category_code=null,account_code=null,asset_details=null,first_use_status=null,first_use_date=null,review_details=${tx.json(u.review_details)} where row_id=${u.row_id}`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values) values(${a.auth_user_id},current_user,'workbook_rows','MAPPING_REMOVED',${pid},${tx.json({rows:updates.map((u:any)=>({row_id:u.row_id,...u.previous}))})},${tx.json({status:'Unmapped',reason,removed_by:a.staff_id})})`;
 return {ok:true,removed:updates.length,returned_cases:returnCases.size,supplier_rules:blocked};
}
