import {fail,text,uuid,revision} from './validation.mjs';
import {proposalIssues,PAYROLL_CODES,payrollSide,cleanCode,MODULES} from './routing-map-rules.mjs';

// The approved routing map (build 2802, Partner approval and versions from 2803): read it, a Manager or Partner proposes mappings (one or many), a Partner who did not propose approves, and a Manager or Partner ends or withdraws them.
// The rules for the table are in 20261114150000_client_routing_map.sql; the matching rules are in routing-map-rules.mjs. Nothing here posts anything.
const ACTIONS=['routing_map_read','routing_map_propose','routing_map_approve','routing_map_end','routing_map_withdraw'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);

export async function routingMapAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The routing map is maintained by staff with client access.');
 if(p.action==='routing_map_propose'&&!isLeader(a))fail(403,'A Manager or Partner proposes a routing mapping.');
 const cid=uuid(p.client_id);
 one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
 if(p.action==='routing_map_read'){
  const maps=await tx`select m.routing_id,m.version,m.module,m.routing_code,m.item_code,m.erp_account_code,m.side,m.label,m.effective_from,m.effective_to,m.status,m.created_by,cb.full_name as created_by_name,m.created_at,m.approved_by,ab.full_name as approved_by_name,m.approved_at,m.closed_reason,m.revision,c.name as account_name
   from erp_private.client_routing_map m left join erp_private.staff_members cb on cb.staff_id=m.created_by left join erp_private.staff_members ab on ab.staff_id=m.approved_by left join erp_private.account_catalog c on c.code=m.erp_account_code
   where m.client_id=${cid} and (${p.module?text(p.module,20):null}::text is null or m.module=${p.module?text(p.module,20):null}) order by m.module,m.routing_code,m.effective_from desc limit 1000`;
  const accounts=await tx`select code,name,route,category_code,account_group from erp_private.account_catalog where status='Active' and not is_legacy order by code`;
  return {maps,accounts,payroll_codes:PAYROLL_CODES,modules:MODULES};
 }
 if(p.action==='routing_map_propose'){
  const list=Array.isArray(p.rows)?p.rows:[p];
  if(!list.length||list.length>200)fail(400,'Propose between 1 and 200 mappings at a time.');
  const accounts=await tx`select code,status,is_legacy,route from erp_private.account_catalog`,saved:any[]=[],problems:any[]=[];
  for(const [i,x] of list.entries()){
   const module=text(x.module||'',20),code=cleanCode(x.routing_code),item=x.item_code?String(x.item_code).trim():null;
   const issues=proposalIssues({...x,module,routing_code:code,item_code:item},accounts);
   if(issues.length){problems.push({row:i+1,routing_code:code,issues});continue;}
   const side=module==='Payroll'?payrollSide(code):null,from=day(x.effective_from),to=x.effective_to?day(x.effective_to):null;
   const dup=await tx`select routing_id from erp_private.client_routing_map where client_id=${cid} and module=${module} and routing_code=${code} and coalesce(item_code,'')=${item||''} and coalesce(side,'')=${side||''} and status in ('Draft','Active') and effective_from<=${to||'9999-12-31'}::date and coalesce(effective_to,'9999-12-31'::date)>=${from}::date limit 1`;
   if(dup.length){problems.push({row:i+1,routing_code:code,issues:['A draft or approved mapping already covers this routing code on these dates.']});continue;}
   const r=await tx`insert into erp_private.client_routing_map(client_id,module,routing_code,item_code,erp_account_code,side,label,effective_from,effective_to,created_by) values(${cid},${module},${code},${item},${text(x.erp_account_code,10)},${side},${x.label?text(x.label,200,false):null},${from},${to},${a.staff_id}) returning routing_id`;
   saved.push(r[0].routing_id);
  }
  if(!saved.length&&problems.length)fail(400,problems.slice(0,5).map((x:any)=>`Row ${x.row} (${x.routing_code||'no code'}): ${x.issues.join(' ')}`).join(' '));
  return {ok:true,saved:saved.length,problems};
 }
 const m=one(await tx`select * from erp_private.client_routing_map where routing_id=${uuid(p.routing_id)} and client_id=${cid} for update`);
 if(String(m.revision)!==revision(p.revision))fail(409,'This mapping changed. Refresh before continuing.');
 if(p.action==='routing_map_approve'){
  if(a.category_code!=='PARTNER')fail(403,'A Partner approves a routing mapping. The Manager proposes it.');
  if(m.status!=='Draft')fail(409,'Only a draft mapping can be approved.');
  if(m.created_by===a.staff_id)fail(403,'A Partner who did not propose it must approve this mapping.');
  const r=await tx`update erp_private.client_routing_map set status='Active',approved_by=${a.staff_id},approved_at=now() where routing_id=${m.routing_id} returning routing_id`;
  if(!r.length)fail(403,'You cannot approve this mapping.');
  return {ok:true};
 }
 const reason=text(p.reason||'',500,false);if(reason.trim().length<10)fail(400,'Say why (at least 10 characters).');
 if(p.action==='routing_map_end'){
  if(!isLeader(a))fail(403,'A Manager or Partner ends a routing mapping.');
  if(m.status!=='Active'||m.effective_to)fail(409,'Only an approved mapping without an end date can be ended.');
  const to=day(p.effective_to);if(!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<day(m.effective_from))fail(400,'Enter an end date on or after the start date.');
  const r=await tx`update erp_private.client_routing_map set effective_to=${to},closed_by=${a.staff_id},closed_at=now(),closed_reason=${reason} where routing_id=${m.routing_id} returning routing_id`;
  if(!r.length)fail(403,'You cannot end this mapping.');
  return {ok:true};
 }
 if(m.status==='Inactive')fail(409,'This mapping is already withdrawn.');
 if(m.status==='Active'&&!isLeader(a))fail(403,'A Manager or Partner withdraws an approved mapping.');
 const r=await tx`update erp_private.client_routing_map set status='Inactive',closed_by=${a.staff_id},closed_at=now(),closed_reason=${reason} where routing_id=${m.routing_id} returning routing_id`;
 if(!r.length)fail(403,'You cannot withdraw this mapping.');
 return {ok:true};
}
