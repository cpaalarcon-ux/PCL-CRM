import {summarySalesRows} from './period-import-actions.ts';
import {digest} from './improvement-actions.ts';
import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {mapValue,splitValues,reconciliation,isCost,money,inventoryDetails} from './accounting-rules.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'Record unavailable to this account.');return r[0];};
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must configure accounting.');};
const reviewer=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Supervisor, Manager or Partner must review.');};
const current=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This record changed. Refresh before saving.');};
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const hash=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(n=>n.toString(16).padStart(2,'0')).join('');
export async function reconSource(tx:any,project:string,start:string,end:string){
 const rows=await tx`select r.*,v.decision,v.source_revision,v.deductible_percentage,v.vat_rate_key,v.income_treatment,v.reviewed_by from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id) where r.project_id=${project} and b.period_start>=${start} and b.period_start<=${end} and (r.dataset not in ('Sales','POS','Bank') or (r.normalized->>'date'>=${start} and r.normalized->>'date'<=${end})) and not r.is_split_parent order by r.row_id limit 10001`;
 rows.push(...await summarySalesRows(tx,project,start,end));
 if(rows.length>10000)fail(400,'Split the review into periods with at most 10,000 rows.');
 const summaryCrossing=(await tx`select count(*)::int n from erp_private.period_imports where project_id=${project} and kind='Sales' and status='Confirmed' and starts_on<=${end} and ends_on>=${start} and (starts_on<${start} or ends_on>${end})`)[0].n;
 return {rows,fingerprint:await hash(rows),crossing:summaryCrossing+(await tx`select count(*)::int n from erp_private.workbook_batches where project_id=${project} and period_start<=${end} and period_end>=${start} and (period_start<${start} or period_end>${end})`)[0].n};
}
async function calculate(tx:any,c:any,inputs:any){const source=await reconSource(tx,c.project_id,day(c.starts_on),day(c.ends_on)),deferral=c.review_type==='Monthly'?(await tx`select * from erp_private.bank_deferrals where reconciliation_id=${c.reconciliation_id}`)[0]:null,result=reconciliation(source.rows,inputs,{bankPendingApproved:!!deferral});
 if(c.review_type==='Monthly'&&source.crossing)result.issues.push('An import batch crosses this review period. Use matching import periods.');
 if(source.rows.some((r:any)=>['Sales','Bank'].includes(r.dataset)&&(r.decision!=='Confirmed'||r.source_revision!==r.revision)))result.issues.push('Another reviewer must confirm the sales and bank source rows.');
 for(const x of result.allocations){if(!x.evidence_id)result.issues.push('Every adjustment needs a project evidence document.');else one(await tx`select document_id from erp_private.documents where document_id=${uuid(x.evidence_id)} and project_id=${c.project_id} and deleted_at is null`);}
 return {...source,result,deferral};
}
export async function accountingAction(tx:any,a:any,p:any){
 if(!String(p.action).startsWith('accounting_')&&!String(p.action).startsWith('sales_recon_')&&!['workbook_map','workbook_map_bulk','workbook_split','workbook_mapping_undo'].includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'A staff preparer must handle purchase and tax working papers.');
 if(p.action==='accounting_catalog')return {accounts:await tx`select * from erp_private.account_catalog order by code`};
 if(p.action==='accounting_account_add'){
  leader(a);const code=text(p.code,5);if(!/^\d{5}$/.test(code))fail(400,'Use a unique five-digit account code.');const route=Number(p.route);if(![1,2,3].includes(route))fail(400,'Choose a purchase route.');
  const category=text(p.category_code,30);if(route===1&&category!=='STOCK'||route===2&&!/^EXP0[1-9]$/.test(category)||route===3&&!/^PPE[A-Z0-9]*$/.test(category))fail(400,'Choose a valid category for this route.');
  return one(await tx`insert into erp_private.account_catalog(code,name,route,category_code,statement,account_group,catalog_version,status,tax_note) values(${code},${text(p.name,160)},${route},${category},${choice(p.statement,['Statement of financial position','Profit or loss'])},'Custom account','CUSTOM-2026','Draft',${text(p.notes,2000)}) returning code`);
 }
 if(p.action==='accounting_account_approve'){if(a.category_code!=='PARTNER')fail(403,'Partner approval required.');const r=one(await tx`select * from erp_private.account_catalog where code=${text(p.code,5)} for update`);current(r,p);if(r.status!=='Draft')fail(400,'Choose a draft account.');await tx`update erp_private.account_catalog set status='Active' where code=${r.code}`;return {ok:true};}
 const pid=uuid(p.project_id|| (p.row_id?(await tx`select project_id from erp_private.workbook_rows where row_id=${uuid(p.row_id)}`)[0]?.project_id:null));
 const project=one(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`);
 const policy=(await tx`select * from erp_private.accounting_policies where client_id=${project.client_id}`)[0];
 if(p.action==='accounting_read')return {policy:policy||null,accounts:await tx`select * from erp_private.account_catalog order by code`,reconciliations:await tx`select reconciliation_id,review_type,starts_on,ends_on,status,prepared_by,revision from erp_private.sales_reconciliations where project_id=${pid} order by ends_on desc,review_type limit 100`};
 if(p.action==='accounting_policy_save'){
  leader(a);const method=choice(p.inventory_method,['Periodic','Perpetual']),note=text(p.notes,2000);if(note.length<10)fail(400,'Document the client inventory method and source.');
  if(policy){current(policy,p);await tx`update erp_private.accounting_policies set inventory_method=${method},notes=${note},configured_by=${a.staff_id} where client_id=${project.client_id}`;}else await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${project.client_id},${method},${note},${a.staff_id})`;return {ok:true};
 }
 if(p.action==='workbook_mapping_undo'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
  const r=one(await tx`select r.*,b.period_start,b.period_end from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.row_id=${uuid(p.row_id)} and r.project_id=${pid} for update of r`);current(r,p);
  const history=one(await tx`select * from erp_private.mapping_history where row_id=${r.row_id} order by after_revision desc limit 1`);
  if(history.changed_by!==a.staff_id||history.after_revision!==r.revision||r.is_split_parent||r.parent_row_id)fail(409,'Only your latest unreviewed mapping can be undone. Refresh and review this row.');
  if(!(await tx`select erp_private.tax_period_open(${pid}::uuid,${r.period_start}::date,${r.period_end}::date) as open`)[0].open)fail(400,'Submitted or locked work cannot be undone.');
  if((await tx`select row_id from erp_private.tax_row_reviews where row_id=${r.row_id} and source_revision=${r.revision} and decision in ('Eligible','Excluded','Confirmed')`).length)fail(400,'Independently reviewed mapping cannot be undone. Use a controlled correction.');
  const v=history.before_mapping;await tx`select set_config('erp.mapping_operation','undo',true)`;
  await tx`update erp_private.workbook_rows set route=${v.route},category_code=${v.category_code},account_code=${v.account_code},narration=${v.narration},asset_details=${v.asset_details},review_details=${tx.json(v.review_details)},first_use_status=${v.first_use_status},first_use_date=${v.first_use_date} where row_id=${r.row_id}`;return {ok:true};
 }
 if(['workbook_map','workbook_map_bulk','workbook_split','workbook_mapping_undo'].includes(p.action)){
  if(project.status==='Archived')fail(400,'Archived projects cannot change.');await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
  const selection=p.selection_id?one(await tx`select * from erp_private.mapping_selections where selection_id=${uuid(p.selection_id)} and project_id=${pid} and selected_by=${a.staff_id} for update`):null;
  const mappingHash=await digest([p.route,p.account_code,p.narration||'',p.asset_details||'',p.first_use_status||'',p.first_use_date||'',p.activity_id||'',p.stock_class||'',p.inventory_use||'',p.construction_job||'',p.legal_category||'',p.legal_basis||'',p.evidence||'']);
  if(selection){if(selection.selection_hash!==p.selection_hash)fail(409,'Selection confirmation does not match. Select again.');if(selection.consumed_at){if(selection.result?.payload_hash!==mappingHash)fail(409,'This selection has already been applied with different values.');return selection.result;}if(new Date(selection.expires_at).getTime()<Date.now())fail(409,'Selection expired. Apply the filters and select again.');}
  const items=selection?selection.rows_snapshot:p.action==='workbook_map_bulk'?p.rows:[{row_id:p.row_id,revision:p.revision}];if(!Array.isArray(items)||!items.length||items.length>(selection?10000:500))fail(400,'Select 1–500 rows or confirm all matching rows.');
  if(p.activity_id){one(await tx`select activity_id from erp_private.client_activities where activity_id=${uuid(p.activity_id)} and client_id=${project.client_id}`);if(Number(p.route)===1&&!p.stock_class)fail(400,'Enter the stock class for the selected activity.');}

  const ids=items.map((r:any)=>uuid(r.row_id));if(new Set(ids).size!==ids.length)fail(400,'A row was selected more than once.');
  const rows=await tx`select r.*,b.period_start,b.period_end from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and r.row_id=any(${tx.array(ids)}::uuid[]) order by r.row_id for update of r`;if(rows.length!==ids.length)fail(403,'All selected rows must belong to this authorised project.');
  const accounts=await tx`select * from erp_private.account_catalog order by code`;
  const selectedRevisions=new Map(items.map((i:any)=>[i.row_id,i]));for(const r of rows)current(r,selectedRevisions.get(r.row_id));
  const closed=await tx`select b.batch_id from erp_private.workbook_batches b where b.batch_id=any(${tx.array([...new Set(rows.map((r:any)=>r.batch_id))])}::uuid[]) and not erp_private.tax_period_open(${pid}::uuid,b.period_start,b.period_end) limit 1`;if(closed.length)fail(400,'This period is submitted or locked.');
  const update=async(r:any,v:any,details:any)=>{await tx`update erp_private.workbook_rows set route=${v.route},category_code=${v.category_code},account_code=${v.account_code},narration=${v.narration},asset_details=${v.asset_details},first_use_status=${v.first_use_status},first_use_date=${v.first_use_date},review_details=${tx.json(details)} where row_id=${r.row_id}`;};
  if(p.action==='workbook_split'){
   const r=rows[0],parts=splitValues(r,p.parts),values=parts.map((part:any)=>mapValue(r,part,accounts,policy));
   await tx`update erp_private.workbook_rows set is_split_parent=true where row_id=${r.row_id}`;
   for(let i=0;i<parts.length;i++){const n={...r.normalized,amount:parts[i].amount,vat:parts[i].vat,gross:money(parts[i].amount+parts[i].vat),line_id:'allocation-'+(i+1),description:values[i].narration},v=values[i];
    await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,category_code,narration,asset_details,review_details,account_code,first_use_status,first_use_date,parent_row_id) values(${r.batch_id},${pid},${r.client_id},${r.dataset},${r.source_row},${r.row_key+':allocation:'+(i+1)},${tx.json(r.raw_values)},${tx.json(n)},${v.route},${v.category_code},${v.narration},${v.asset_details},${tx.json(inventoryDetails(r,parts[i]))},${v.account_code},${v.first_use_status},${v.first_use_date},${r.row_id})`;
   }return {ok:true,count:parts.length};
  }
  // Validate every member before mutating any member. The enclosing transaction is all-or-nothing.
  const activityPolicies=p.activity_id?await tx`select * from erp_private.stock_policy_versions where activity_id=${uuid(p.activity_id)} order by effective_from desc`:[];
  const values=rows.map((r:any)=>{const at=String(r.normalized.return_month||r.normalized.date||day(r.period_start));const dated=activityPolicies.find((v:any)=>day(v.effective_from)<=at);return mapValue(r,p,accounts,dated||policy);});
  const updates=rows.map((r:any,i:number)=>{const details=inventoryDetails(r,p);for(const k of ['legal_category','legal_basis','evidence','activity_id'])if(p[k]!==undefined)details[k]=text(p[k],2000,false);return {row_id:r.row_id,...values[i],review_details:details};});
  for(let i=0;i<updates.length;i+=500)await tx`update erp_private.workbook_rows r set route=v.route,category_code=v.category_code,account_code=v.account_code,narration=v.narration,asset_details=v.asset_details,first_use_status=v.first_use_status,first_use_date=v.first_use_date,review_details=v.review_details from jsonb_to_recordset(${tx.json(updates.slice(i,i+500))}::jsonb) as v(row_id uuid,route integer,category_code text,account_code text,narration text,asset_details text,first_use_status text,first_use_date date,review_details jsonb) where r.row_id=v.row_id`;
  if(selection)await tx`update erp_private.mapping_selections set consumed_at=now(),result=${tx.json({ok:true,count:rows.length,payload_hash:mappingHash})} where selection_id=${selection.selection_id}`;
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'workbook_rows','BULK_MAPPING',${pid},${tx.json({row_ids:ids,account_code:p.account_code,count:rows.length})})`;return {ok:true,count:rows.length};
 }
 if(p.action==='accounting_preview'){
  const rows=await tx`select r.*,v.decision,v.source_revision,v.deductible_percentage from erp_private.workbook_rows r left join erp_private.tax_row_reviews v using(row_id) where r.project_id=${pid} and r.dataset in ('Purchases','Expenditure','Non-eTIMS') and not r.is_split_parent order by r.source_row limit 10001`;
  if(rows.length>10000)fail(400,'Use smaller project periods.');const lines:any[]=[],issues:string[]=[];
  for(const r of rows){if(!r.account_code){issues.push('Unmapped row '+r.source_row);continue;}const net=Number(r.normalized.amount||0),vat=Number(r.normalized.vat||0),reviewed=r.source_revision===r.revision&&['Eligible','Excluded'].includes(r.decision);if(!reviewed)issues.push('Unreviewed row '+r.source_row);const claim=reviewed&&r.decision==='Eligible'?money(vat*Number(r.deductible_percentage)/100):0;const add=(code:string,value:number)=>lines.push({reference:r.normalized.invoice,source_row:r.source_row,account_code:code,debit:Math.max(0,money(value)),credit:Math.max(0,money(-value))});add(r.account_code,net+vat-claim);if(claim)add('10160',claim);add('20000',-net-vat);}
  return {lines,issues,debit:money(lines.reduce((s,l)=>s+l.debit,0)),credit:money(lines.reduce((s,l)=>s+l.credit,0)),label:'DRAFT accounting preview only. No journal or client ledger has been posted.'};
 }
 if(p.action==='sales_recon_create'){
  const type=choice(p.review_type,['Weekly','Monthly']),start=date(p.starts_on),end=date(p.ends_on);if(!start||!end||end<start||start.slice(0,7)!==end.slice(0,7)||!start.endsWith('-01'))fail(400,'Choose a month-to-date period starting on the first.');
  const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());if(end>now)fail(400,'Do not create a future review.');
  if(type==='Monthly'&&end!==new Date(Date.UTC(Number(start.slice(0,4)),Number(start.slice(5,7)),0)).toISOString().slice(0,10))fail(400,'Monthly reviews must cover the full month.');
  const existing=await tx`select reconciliation_id from erp_private.sales_reconciliations where project_id=${pid} and review_type=${type} and starts_on=${start} and ends_on=${end}`;if(existing.length)return existing[0];
  return one(await tx`insert into erp_private.sales_reconciliations(project_id,review_type,starts_on,ends_on,prepared_by) values(${pid},${type},${start},${end},${a.staff_id}) returning reconciliation_id`);
 }
 const c=one(await tx`select * from erp_private.sales_reconciliations where reconciliation_id=${uuid(p.reconciliation_id)} and project_id=${pid} for update`);
 if(p.action==='sales_recon_read'){const x=await calculate(tx,c,c.inputs);return {record:c,result:c.status==='Locked'?c.review_snapshot.result:x.result,source_fingerprint:x.fingerprint,deferral:x.deferral,versions:await tx`select version_id,created_at,created_by from erp_private.sales_review_versions where reconciliation_id=${c.reconciliation_id} order by created_at desc`};}
 current(c,p);
 if(p.action==='sales_recon_save'||p.action==='sales_recon_submit'){
  if(c.prepared_by!==a.staff_id||!['Draft','Returned'].includes(c.status))fail(403,'Only the assigned preparer can change a draft or returned review.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
  const inputs=p.action==='sales_recon_save'?p.inputs:c.inputs;if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||JSON.stringify(inputs).length>150000)fail(400,'Invalid reconciliation inputs.');
  const x=await calculate(tx,c,inputs);if(p.action==='sales_recon_submit'&&x.result.issues.length)fail(400,x.result.issues.join(' '));
  const status=p.action==='sales_recon_submit'?'Submitted':'Draft';
  await tx`update erp_private.sales_reconciliations set inputs=${tx.json(inputs)},result=${tx.json(x.result)},source_fingerprint=${x.fingerprint},status=${status} where reconciliation_id=${c.reconciliation_id}`;
  if(status==='Submitted'){const snapshot={result:x.result,deferral:x.deferral,inputs,rows:x.rows,source_fingerprint:x.fingerprint,submitted_by:a.staff_id,submitted_at:new Date().toISOString()};await tx`insert into erp_private.sales_review_versions(reconciliation_id,project_id,snapshot,created_by) values(${c.reconciliation_id},${pid},${tx.json(snapshot)},${a.staff_id})`;}
  return {ok:true};
 }
 if(p.action==='sales_recon_review'){
  reviewer(a);if(c.prepared_by===a.staff_id||c.status!=='Submitted')fail(403,'Another reviewer must review a submitted reconciliation.');const status=choice(p.status,['Locked','Returned']),note=text(p.review_note,2000);
  await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;const x=await calculate(tx,c,c.inputs);
  if(status==='Locked'&&(x.fingerprint!==c.source_fingerprint||x.result.issues.length))fail(400,'Sources changed or issues remain. Return the review for correction.');
  const snapshot={result:x.result,deferral:x.deferral,inputs:c.inputs,rows:x.rows,source_fingerprint:x.fingerprint,reviewed_by:a.staff_id,reviewed_at:new Date().toISOString()};await tx`update erp_private.sales_reconciliations set status=${status},review_note=${note},reviewed_by=${a.staff_id},review_snapshot=${status==='Locked'?tx.json(snapshot):null} where reconciliation_id=${c.reconciliation_id}`;
  return {ok:true};
 }
 fail(404,'Unknown accounting action.');
}
