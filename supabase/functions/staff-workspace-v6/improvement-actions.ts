import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {entityInput,partnerRatios,stockValues,suggestionFor,exportReadiness,packs,streams,asDay} from './improvement-rules.mjs';
import {money} from './accounting-rules.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'Record unavailable to this account.');return r[0];};
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must maintain client configuration.');};
const reviewer=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'Independent Supervisor, Manager or Partner review required.');};
const fresh=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This record changed. Refresh before saving.');};
const range=(p:any)=>{const s=date(p.starts_on),e=date(p.ends_on);if(!s||!e||e<s||Date.parse(e)-Date.parse(s)>367*86400000)fail(400,'Choose a valid period of up to 367 days.');return [s,e];};
export const digest=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(n=>n.toString(16).padStart(2,'0')).join('');
async function project(tx:any,id:any){return one(await tx`select * from erp_private.projects where project_id=${uuid(id)} and deleted_at is null`);}
async function evidence(tx:any,id:any,pid:string){return one(await tx`select document_id from erp_private.documents where document_id=${uuid(id)} and project_id=${pid} and deleted_at is null`);}
async function stockSource(tx:any,c:any){
 const rows=await tx`select r.row_id,r.revision,r.account_code,r.normalized,r.review_details,r.route,v.decision,v.source_revision,v.deductible_percentage from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id) where r.project_id=${c.project_id} and b.period_start>=${asDay(c.starts_on)} and b.period_end<=${asDay(c.ends_on)} and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') order by r.row_id limit 10001`;
 if(rows.length>10000)fail(400,'Use a stock period with at most 10,000 source rows.');
 const selected=rows.filter((r:any)=>r.review_details?.activity_id===c.activity_id&&r.review_details?.stock_class===c.stock_class&&r.route===1);
 const cost=(r:any)=>money(Number(r.normalized.amount||0)+(r.decision==='Eligible'?Number(r.normalized.vat||0)*(1-Number(r.deductible_percentage||0)/100):r.decision==='Excluded'?Number(r.normalized.vat||0):0));
 const landed=(r:any)=>['50030','50040','50050'].includes(r.account_code);
 return {rows,fingerprint:await digest(rows),selected_count:selected.length,resale_purchases:money(selected.filter((r:any)=>!landed(r)).reduce((s:number,r:any)=>s+cost(r),0)),landed_costs:money(selected.filter(landed).reduce((s:number,r:any)=>s+cost(r),0)),unreviewed:selected.filter((r:any)=>r.source_revision!==r.revision||!['Eligible','Excluded'].includes(r.decision)).length,unallocated:rows.filter((r:any)=>!r.account_code||r.route===1&&(!r.review_details?.activity_id||!r.review_details?.stock_class)).length};
}
export async function improvementAction(tx:any,a:any,p:any){
 if(!String(p.action).startsWith('v3_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Client configuration and working-paper controls are unavailable to Interns.');
 if(p.action==='v3_client_read'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null`);
  return {client:c,activities:await tx`select * from erp_private.client_activities where client_id=${c.client_id} order by effective_from desc`,partners:await tx`select * from erp_private.partner_interests where client_id=${c.client_id} order by effective_from desc,partner_name`,periods:await tx`select * from erp_private.client_periods where client_id=${c.client_id} order by ends_on desc`,policies:await tx`select * from erp_private.stock_policy_versions where client_id=${c.client_id} order by effective_from desc`};
 }
 if(p.action==='v3_identity_save'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null for update`);fresh(c,p);const v=entityInput(p);
  const predecessor=p.predecessor_client_id?uuid(p.predecessor_client_id):null;if(predecessor){if(predecessor===c.client_id)fail(400,'Choose a different predecessor client.');one(await tx`select client_id from erp_private.clients where client_id=${predecessor} and deleted_at is null`);
   const cycle=await tx`with recursive chain as (select client_id,predecessor_client_id,ARRAY[client_id] as seen from erp_private.clients where client_id=${predecessor} union all select c.client_id,c.predecessor_client_id,chain.seen||c.client_id from erp_private.clients c join chain on c.client_id=chain.predecessor_client_id where not c.client_id=any(chain.seen) and cardinality(chain.seen)<100) select client_id from chain where client_id=${c.client_id} limit 1`;if(cycle.length)fail(400,'A successor link cannot create a cycle.');
  }
  if(c.predecessor_client_id&&c.predecessor_client_id!==predecessor)fail(400,'The predecessor link is retained. Use a separate controlled entity correction.');
  if(c.legal_entity_type&&c.legal_entity_type!==v.legal_entity_type)fail(400,'A change of legal entity needs a separate successor client. Retain this entity and its outstanding work.');
  await tx`update erp_private.clients set legal_entity_type=${v.legal_entity_type},entity_evidence=${v.entity_evidence},year_end_month=${v.year_end_month},year_end_day=${v.year_end_day},predecessor_client_id=${predecessor} where client_id=${c.client_id}`;if(predecessor)await tx`update erp_private.clients set accepts_new_engagements=false where client_id=${predecessor}`;return {ok:true};
 }
 if(['v3_activity_add','v3_partners_add','v3_period_add','v3_stock_policy_add'].includes(p.action)){
  leader(a);const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid} and deleted_at is null`);await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':config'},0))`;
  if(p.action==='v3_activity_add'){
   const start=date(p.effective_from),end=p.effective_to?date(p.effective_to):null;if(!start||end&&end<start)fail(400,'Choose valid activity effective dates.');
   return one(await tx`insert into erp_private.client_activities(client_id,pack_code,activity_name,income_stream,effective_from,effective_to,evidence,created_by) values(${cid},${choice(p.pack_code,packs)},${text(p.activity_name,160)},${choice(p.income_stream,streams)},${start},${end},${text(p.evidence,2000)},${a.staff_id}) returning activity_id`);
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
  const activity=one(await tx`select * from erp_private.client_activities where activity_id=${uuid(p.activity_id)} and client_id=${cid}`),from=date(p.effective_from),threshold=Number(p.variance_threshold);
  if(!from||from<asDay(activity.effective_from)||activity.effective_to&&from>asDay(activity.effective_to)||!Number.isFinite(threshold)||threshold<0||threshold>1e9)fail(400,'Check the effective date and internal variance threshold.');
  const previous=(await tx`select effective_from from erp_private.stock_policy_versions where activity_id=${activity.activity_id} order by effective_from desc limit 1`)[0];
  if(previous&&a.category_code!=='PARTNER')fail(403,'A later policy version requires Partner approval.');
  if(previous&&from<=asDay(previous.effective_from))fail(400,'A new policy version must start after the preceding version.');
  if((await tx`select control_id from erp_private.stock_controls where activity_id=${activity.activity_id} and status in ('Submitted','Approved') and ends_on>=${from} limit 1`).length)fail(400,'Start the new policy after the last submitted or approved stock period.');
  return one(await tx`insert into erp_private.stock_policy_versions(client_id,activity_id,inventory_method,valuation_basis,effective_from,count_frequency,variance_threshold,evidence,configured_by) values(${cid},${activity.activity_id},${choice(p.inventory_method,['Periodic','Perpetual'])},${text(p.valuation_basis,2000)},${from},${choice(p.count_frequency,['Weekly','Monthly','Annually'])},${threshold},${text(p.evidence,2000)},${a.staff_id}) returning policy_id`);
 }
 const pr=await project(tx,p.project_id),pid=pr.project_id;
 if(p.action==='v3_project_read')return {activities:await tx`select * from erp_private.client_activities where client_id=${pr.client_id} order by activity_name`,policies:await tx`select * from erp_private.stock_policy_versions where client_id=${pr.client_id} order by effective_from desc`,controls:await tx`select * from erp_private.stock_controls where project_id=${pid} order by ends_on desc`,requests:await tx`select * from erp_private.category_requests where project_id=${pid} order by created_at desc limit 100`};
 if(p.action==='v3_mapping_select'){
  const search='%'+text(p.search||'',160,false)+'%',mapping=choice(p.mapping||'All',['All','Unmapped','Inventory','Expenditure','PPE']),dataset=choice(p.dataset||'Costs',['Costs','Purchases','Expenditure','Non-eTIMS']),rate=choice(p.vat_category||'All',['All','16%','8%','0%','Exempt','Non-eTIMS','Unconfirmed']);
  const rows=await tx`select r.row_id,r.revision,r.normalized from erp_private.workbook_rows r where r.project_id=${pid} and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') and (${dataset}='Costs' or r.dataset=${dataset}) and (${mapping}='All' or ${mapping}='Unmapped' and r.account_code is null or r.account_code is not null and r.route=case ${mapping} when 'Inventory' then 1 when 'Expenditure' then 2 when 'PPE' then 3 else 0 end) and (${rate}='All' or (case when r.dataset='Non-eTIMS' then 'Non-eTIMS' else coalesce(r.normalized->>'vat_category','Unconfirmed') end)=${rate}) and concat_ws(' ',r.normalized->>'invoice',r.normalized->>'reference',r.normalized->>'party',r.normalized->>'party_pin',r.normalized->>'description') ilike ${search} order by r.row_id limit 10001`;
  if(!rows.length||rows.length>10000)fail(400,'Select 1–10,000 matching cost rows. Narrow the filters if necessary.');
  const snapshot=rows.map((r:any)=>({row_id:r.row_id,revision:r.revision})),totals={mapping_dates:[...new Set(rows.map((r:any)=>String(r.normalized.return_month||r.normalized.date||'').slice(0,10)).filter(Boolean))].sort(),count:rows.length,net:money(rows.reduce((s:number,r:any)=>s+Number(r.normalized.amount||0),0)),vat:money(rows.reduce((s:number,r:any)=>s+Number(r.normalized.vat||0),0))},hash=await digest(snapshot);
  return {...one(await tx`insert into erp_private.mapping_selections(project_id,selected_by,filters,rows_snapshot,totals,selection_hash) values(${pid},${a.staff_id},${tx.json({search:p.search||'',mapping,dataset,vat_category:rate})},${tx.json(snapshot)},${tx.json(totals)},${hash}) returning selection_id,expires_at`),selection_hash:hash,...totals};
 }
 if(p.action==='v3_suggestions'){
  const row=one(await tx`select * from erp_private.workbook_rows where row_id=${uuid(p.row_id)} and project_id=${pid}`);
  const history=await tx`select r.row_id,r.account_code,r.normalized,r.narration,b.period_start from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) join erp_private.tax_row_reviews v using(row_id) where r.client_id=${pr.client_id} and r.row_id<>${row.row_id} and v.source_revision=r.revision and v.decision in ('Eligible','Excluded') and r.normalized->>'party_pin'=${row.normalized.party_pin||''} and r.account_code is not null and not r.is_split_parent order by b.period_start desc limit 200`;
  return suggestionFor(row,history);
 }
 if(p.action==='v3_category_request'){
  one(await tx`select row_id from erp_private.workbook_rows where row_id=${uuid(p.row_id)} and project_id=${pid} and not is_split_parent`);
  return one(await tx`insert into erp_private.category_requests(project_id,row_id,reason,proposed_name,evidence,requested_by) values(${pid},${uuid(p.row_id)},${text(p.reason,2000)},${text(p.proposed_name,160)},${text(p.evidence,2000)},${a.staff_id}) returning request_id`);
 }
 if(p.action==='v3_category_decide'){
  leader(a);const r=one(await tx`select * from erp_private.category_requests where request_id=${uuid(p.request_id)} and project_id=${pid} for update`);fresh(r,p);if(r.status!=='Pending'||r.requested_by===a.staff_id)fail(400,'Another Manager or Partner must decide the pending request.');
  const status=choice(p.status,['Approved','Rejected']),code=status==='Approved'?text(p.account_code,5):null;if(code)one(await tx`select code from erp_private.account_catalog where code=${code} and status='Active' and not is_legacy`);
  await tx`update erp_private.category_requests set status=${status},account_code=${code},decision_note=${text(p.decision_note,2000)},decided_by=${a.staff_id} where request_id=${r.request_id}`;return {ok:true};
 }
 if(p.action==='v3_stock_create'){
  const [s,e]=range(p),activity=one(await tx`select * from erp_private.client_activities where activity_id=${uuid(p.activity_id)} and client_id=${pr.client_id} and effective_from<=${s} and (effective_to is null or effective_to>=${e})`),policy=one(await tx`select * from erp_private.stock_policy_versions where activity_id=${activity.activity_id} and effective_from<=${s} order by effective_from desc limit 1`);
  return one(await tx`insert into erp_private.stock_controls(project_id,activity_id,policy_id,stock_class,starts_on,ends_on,prepared_by) values(${pid},${activity.activity_id},${policy.policy_id},${text(p.stock_class,100)},${s},${e},${a.staff_id}) returning control_id`);
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
  const inputs=p.action==='v3_stock_save'?p.inputs:c.inputs;if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||JSON.stringify(inputs).length>20000)fail(400,'Invalid stock values.');
  const result=stockValues({...inputs,resale_purchases:src.resale_purchases,landed_costs:src.landed_costs},policy);
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
