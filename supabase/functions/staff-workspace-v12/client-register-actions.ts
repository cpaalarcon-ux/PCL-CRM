// One page of the Client Register for Managers and Partners. The database function runs as the signed-in person, so row-level security still applies.
import {fail,uuid,text} from './validation.mjs';
const ONE=(v:any,allowed:string[],label:string)=>{if(v===undefined||v===null||v==='')return null;const s=String(v);if(!allowed.includes(s))fail(400,`${label} is not recognised.`);return s;};
export async function clientRegisterAction(tx:any,a:any,p:any){
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
