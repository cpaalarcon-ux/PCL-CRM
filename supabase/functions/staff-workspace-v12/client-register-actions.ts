// One page of the Client Register for Managers and Partners. The database function runs as the signed-in person, so row-level security still applies.
import {fail,uuid,text} from './validation.mjs';
const ONE=(v:any,allowed:string[],label:string)=>{if(v===undefined||v===null||v==='')return null;const s=String(v);if(!allowed.includes(s))fail(400,`${label} is not recognised.`);return s;};
// The extra facts on each client card: KRA notices near their deadline, files waiting in Incoming review and unbilled work in progress.
// The database applies the visibility rules; this only checks the role and the size of the request.
const ids=(v:any)=>{if(!Array.isArray(v)||v.length>500)fail(400,'Ask for 500 clients or fewer.');return v.map((x:any)=>uuid(x));};

// Read only the profile fields already available to the register roles in the workspace snapshot.
async function readRegisterClients(tx:any,clientIds:string[]){
 if(!clientIds.length)return [];
 return await tx`select c.client_id,c.company_name,c.kra_pin,c.primary_sector,c.branch_location,c.client_category,
  c.accepts_new_engagements,c.record_status,c.service_status,c.comm_access_level,c.lifecycle_reason,c.lifecycle_changed_at,
  (select m.full_name from erp_private.staff_members m where m.staff_id=c.lifecycle_changed_by) lifecycle_changed_by_name,
  c.archive_reason,c.archived_at,c.doc_request_contact_id,c.report_delivery_contact_id,c.legal_entity_type,
  c.legal_structure,c.legal_subtype,c.legal_structure_note,c.legal_structure_changed_at,
  (select m.full_name from erp_private.staff_members m where m.staff_id=c.legal_structure_changed_by) legal_structure_changed_by_name,
  c.entity_evidence,c.year_end_month,c.year_end_day,c.predecessor_client_id,c.incorporation_date,c.is_pie,
  c.sme_audit_exempt,c.audit_requested,c.missing_fields,c.opening_balance_status,c.opening_balance_note,c.revision,true details_visible,
  exists(select 1 from erp_private.ledger_periods lp join erp_private.ledger_journals lj using(period_id)
   where lp.client_id=c.client_id and (now() at time zone 'Africa/Nairobi')::date between lp.starts_on and lp.ends_on
    and lj.kind='Opening' and lj.status='Posted') has_opening_balance,
  exists(select 1 from erp_private.client_compliance cc where cc.client_id=c.client_id and cc.verified_at is not null and cc.deleted_at is null) kyc_verified,
  exists(select 1 from erp_private.client_contacts k where k.client_id=c.client_id and k.deleted_at is null) has_contact,
  exists(select 1 from erp_private.client_tax_profiles t where t.client_id=c.client_id and t.status='Verified' and t.deleted_at is null) tax_verified,
  exists(select 1 from erp_private.documents d where d.client_id=c.client_id and d.import_purpose='Opening TB' and d.archived_at is null and d.deleted_at is null) staged_tb,
  array(select l.firm_id from erp_private.client_firm_links l where l.client_id=c.client_id and l.deleted_at is null) firm_ids
  from erp_private.clients c where c.deleted_at is null and c.client_id=any(${tx.array(clientIds)}::uuid[])`;
}

export async function clientRegisterAction(tx:any,a:any,p:any){
 if(p.action==='client_card_flags'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'The client card facts are for Supervisors, Managers and Partners.');
  const rows=await tx`select * from erp_private.client_card_flags(${tx.array(ids(p.client_ids))}::uuid[])`;
  return {rows:rows.map((r:any)=>({client_id:r.client_id,kra_open:Number(r.kra_open||0),kra_days:r.kra_days===null?null:Number(r.kra_days),incoming_waiting:Number(r.incoming_waiting||0),incoming_overdue:Number(r.incoming_overdue||0),filing_soon:Number(r.filing_soon||0),filing_soon_days:r.filing_soon_days===null?null:Number(r.filing_soon_days),filing_late:Number(r.filing_late||0),filing_late_days:r.filing_late_days===null?null:Number(r.filing_late_days),filing_urgent:Number(r.filing_urgent||0),filing_urgent_days:r.filing_urgent_days===null?null:Number(r.filing_urgent_days)}))};
 }
 if(p.action==='client_card_wip'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Work in progress is shown to Managers and Partners only.');
  const rows=await tx`select * from erp_private.client_card_wip(${tx.array(ids(p.client_ids))}::uuid[])`;
  return {rows:rows.map((r:any)=>({client_id:r.client_id,wip_unbilled:Number(r.wip_unbilled||0),hours_without_rate:Number(r.hours_without_rate||0)}))};
 }
 if(p.action!=='client_register_page')return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can use the paged client register.');
 if(p.client_id!==undefined){
  const [client]=await readRegisterClients(tx,[uuid(p.client_id)]);
  if(!client)fail(404,'This client is not available in your workspace.');
  return {client};
 }
 const size=[25,50,100].includes(Number(p.page_size))?Number(p.page_size):25,page=Math.max(0,Math.min(1000,Math.trunc(Number(p.page)||0)));
 const q=text(p.q||'',100,false).trim().replace(/[%_\\]/g,m=>'\\'+m);
 const days=p.deadline_days===undefined||p.deadline_days===null||p.deadline_days===''?null:Math.trunc(Number(p.deadline_days));
 if(days!==null&&!(days>=0&&days<=365))fail(400,'Next deadline must be between 0 and 365 days.');
 const sector=p.sector?text(p.sector,120,false).trim()||null:null;
 const readPage=(limit:number,offset:number)=>tx`select * from erp_private.client_register(${q},${p.firm_id?uuid(p.firm_id):null}::uuid,${sector},${ONE(p.service_status,['Active','Paused','Cancelled'],'Service status')},${!!p.show_archived},${p.owner_staff_id?uuid(p.owner_staff_id):null}::uuid,${ONE(p.kyc,['complete','outstanding'],'KYC')},${ONE(p.tax,['verified','unverified'],'Tax profile')},${ONE(p.opening,['done','pending'],'Opening balance')},${ONE(p.projects,['none','some'],'Projects')},${days}::integer,${ONE(p.sort,['name','deadline','projects','overdue'],'Sort')||'name'},${limit},${offset})`;
 const rows=await readPage(size,page*size);
 const total=Number(rows[0]?.total??(page>0?(await readPage(1,0))[0]?.total:0)??0);
 const clients=new Map((await readRegisterClients(tx,rows.map((r:any)=>r.client_id))).map((client:any)=>[client.client_id,client]));
 return {total,page,page_size:size,pages:Math.max(1,Math.ceil(total/size)),rows:rows.map((r:any)=>{const {total:_t,...rest}=r;return {...rest,client:clients.get(r.client_id)};})};
}
