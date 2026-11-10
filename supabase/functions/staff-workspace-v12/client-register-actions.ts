// One page of the Client Register for Managers and Partners. The database function runs as the signed-in person, so row-level security still applies.
import {fail,uuid,text} from './validation.mjs';
const ONE=(v:any,allowed:string[],label:string)=>{if(v===undefined||v===null||v==='')return null;const s=String(v);if(!allowed.includes(s))fail(400,`${label} is not recognised.`);return s;};
// The extra facts on each client card: KRA notices near their deadline, files waiting in Incoming review, a forensic file (lead only) and unbilled work in progress.
// The database applies the visibility rules; this only checks the role and the size of the request.
const ids=(v:any)=>{if(!Array.isArray(v)||v.length>500)fail(400,'Ask for 500 clients or fewer.');return v.map((x:any)=>uuid(x));};
export async function clientRegisterAction(tx:any,a:any,p:any){
 if(p.action==='client_card_flags'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'The client card facts are for Supervisors, Managers and Partners.');
  const rows=await tx`select * from erp_private.client_card_flags(${tx.array(ids(p.client_ids))}::uuid[])`;
  return {rows:rows.map((r:any)=>({client_id:r.client_id,kra_open:Number(r.kra_open||0),kra_days:r.kra_days===null?null:Number(r.kra_days),incoming_waiting:Number(r.incoming_waiting||0),incoming_overdue:Number(r.incoming_overdue||0),forensic_file:!!r.forensic_file}))};
 }
 if(p.action==='client_card_wip'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Work in progress is shown to Managers and Partners only.');
  const rows=await tx`select * from erp_private.client_card_wip(${tx.array(ids(p.client_ids))}::uuid[])`;
  return {rows:rows.map((r:any)=>({client_id:r.client_id,wip_unbilled:Number(r.wip_unbilled||0),hours_without_rate:Number(r.hours_without_rate||0)}))};
 }
 if(p.action!=='client_register_page')return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can use the paged client register.');
 const size=[25,50,100].includes(Number(p.page_size))?Number(p.page_size):25,page=Math.max(0,Math.min(1000,Math.trunc(Number(p.page)||0)));
 const q=text(p.q||'',100,false).trim().replace(/[%_\\]/g,m=>'\\'+m);
 const days=p.deadline_days===undefined||p.deadline_days===null||p.deadline_days===''?null:Math.trunc(Number(p.deadline_days));
 if(days!==null&&!(days>=0&&days<=365))fail(400,'Next deadline must be between 0 and 365 days.');
 const sector=p.sector?text(p.sector,120,false).trim()||null:null;
 const rows=await tx`select * from erp_private.client_register(${q},${p.firm_id?uuid(p.firm_id):null}::uuid,${sector},${ONE(p.service_status,['Active','Paused','Cancelled'],'Service status')},${!!p.show_archived},${p.owner_staff_id?uuid(p.owner_staff_id):null}::uuid,${ONE(p.kyc,['complete','outstanding'],'KYC')},${ONE(p.tax,['verified','unverified'],'Tax profile')},${ONE(p.opening,['done','pending'],'Opening balance')},${ONE(p.projects,['none','some'],'Projects')},${days}::integer,${ONE(p.sort,['name','deadline','projects','overdue'],'Sort')||'name'},${size},${page*size})`;
 const total=rows.length?Number(rows[0].total):0;
 return {total,page,page_size:size,pages:Math.max(1,Math.ceil(total/size)),rows:rows.map((r:any)=>{const {total:_t,...rest}=r;return rest;})};
}
