import {fail,text,uuid,revision} from './validation.mjs';
import {proposalIssues,PAYROLL_CODES,payrollSide,cleanCode,MODULES} from './routing-map-rules.mjs';

// The approved routing map (build 2802, Partner approval and versions from 2803): read it, a Manager or Partner proposes mappings (one or many), a Partner who did not propose approves, and a Manager or Partner ends or withdraws them.
// The rules for the table are in 20261114150000_client_routing_map.sql; the matching rules are in routing-map-rules.mjs. Nothing here posts anything.
const ACTIONS=['routing_map_read','routing_map_suggestions','routing_map_suggest_propose','routing_map_copy','routing_map_propose','routing_map_approve','routing_map_end','routing_map_withdraw'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);

export async function routingMapAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The routing map is maintained by staff with client access.');
 if(['routing_map_propose','routing_map_copy','routing_map_suggest_propose'].includes(p.action)&&!isLeader(a))fail(403,'A Manager or Partner proposes a routing mapping.');
 const cid=uuid(p.client_id);
 one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
 if(p.action==='routing_map_read'){
  const maps=await tx`select m.routing_id,m.version,m.module,m.routing_code,m.item_code,m.erp_account_code,m.side,m.label,m.effective_from,m.effective_to,m.status,m.created_by,cb.full_name as created_by_name,m.created_at,m.approved_by,ab.full_name as approved_by_name,m.approved_at,m.closed_reason,m.revision,c.name as account_name
   from erp_private.client_routing_map m left join erp_private.staff_members cb on cb.staff_id=m.created_by left join erp_private.staff_members ab on ab.staff_id=m.approved_by left join erp_private.account_catalog c on c.code=m.erp_account_code
   where m.client_id=${cid} and (${p.module?text(p.module,20):null}::text is null or m.module=${p.module?text(p.module,20):null}) order by m.module,m.routing_code,m.effective_from desc limit 1000`;
  const accounts=await tx`select code,name,route,category_code,account_group from erp_private.account_catalog where status='Active' and not is_legacy order by code`;
  return {maps,accounts,payroll_codes:PAYROLL_CODES,modules:MODULES};
 }
 // The Manager's queue (firm approval rule, 17 Nov 2026): purchase rows whose routing code and TB code are a valid pair but have no approved mapping. Nothing here is mapped or posted.
 // A Manager or Partner turns a pair into a draft mapping; a different Partner approves it; the next automatic mapping then maps the rows.
 if(p.action==='routing_map_suggestions'||p.action==='routing_map_suggest_propose'){
  const found=await tx`select r.normalized->>'routing_code' as routing_code,r.normalized->>'tb_code' as tb_code,count(*)::int as rows,min(coalesce(r.normalized->>'date',b.period_start::text)) as first_date,max(coalesce(r.normalized->>'date',b.period_start::text)) as last_date,
    coalesce(sum(nullif(r.normalized->>'amount','')::numeric),0) as net
    from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.client_id=${cid} and b.archived_at is null and r.account_code is null and r.parent_row_id is null
     and r.review_details->'auto_map_note'->>'code'='SUGGESTED_AWAITING_APPROVAL' group by 1,2 order by rows desc,1,2`;
  const pairs=found.map((x:any)=>({routing_code:x.routing_code,tb_code:x.tb_code,rows:x.rows,first_date:String(x.first_date).slice(0,10),last_date:String(x.last_date).slice(0,10),net:Number(x.net)}));
  if(p.action==='routing_map_suggestions'){
   const names=new Map((await tx`select code,name from erp_private.account_catalog where code=any(${tx.array(pairs.map((x:any)=>x.tb_code))}::text[])`).map((x:any)=>[x.code,x.name]));
   const drafts=await tx`select m.routing_id,m.routing_code,m.item_code,m.created_by,erp_private.reviewer_label(m.created_by) as created_by_name from erp_private.client_routing_map m where m.client_id=${cid} and m.module='Purchases' and m.status='Draft'`;
   const exc=await tx`select count(*)::int as n from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.client_id=${cid} and b.archived_at is null and r.account_code is null and r.parent_row_id is null and r.dataset in ('Purchases','Expenditure','Non-eTIMS') and r.review_details->'auto_map_note'->>'code' in ('NO_CODES','ROUTING_BLANK','TB_BLANK','CODES_INVALID')`;
   return {pairs:pairs.map((x:any)=>{const d=drafts.find((y:any)=>cleanCode(y.routing_code)===cleanCode(x.routing_code)&&(!y.item_code||y.item_code===x.tb_code));
    return {...x,account_name:names.get(x.tb_code)||'',state:d?'Draft: waiting for a Partner':'Suggested - Awaiting Approval',draft_id:d?.routing_id||null,drafted_by_name:d?.created_by_name||null};}),exception_rows:exc[0].n,can_propose:isLeader(a),can_approve:a.category_code==='PARTNER'};
  }
  const wanted=Array.isArray(p.pairs)?p.pairs:[];if(!wanted.length||wanted.length>100)fail(400,'Choose between 1 and 100 suggested pairs.');
  const rows:any[]=[];
  for(const w of wanted){const rc=cleanCode(w.routing_code),tb=String(w.tb_code||'').trim(),hit=pairs.find((x:any)=>cleanCode(x.routing_code)===rc&&x.tb_code===tb);
   if(!hit)fail(409,`Routing code ${rc||'(blank)'} with TB code ${tb||'(blank)'} is no longer waiting for approval. Refresh the queue.`);
   rows.push({module:'Purchases',routing_code:rc,item_code:tb,erp_account_code:tb,effective_from:hit.first_date,label:'Proposed from a suggested upload pair'});}
  return await routingMapAction(tx,a,{action:'routing_map_propose',client_id:cid,rows});
 }
 if(p.action==='routing_map_copy'){
  // Reuse is a head start for the proposer, never an approval: the source client's current approved mappings become new DRAFT proposals for this client.
  // They are validated like any proposal, skipped where this client already has a draft or approved mapping, and still need a different Partner's approval.
  const from=uuid(p.from_client_id);if(from===cid)fail(400,'Choose a different client to copy from.');
  const src=one(await tx`select client_id,company_name from erp_private.clients where client_id=${from} and deleted_at is null`);
  const start=day(p.effective_from);if(!/^\d{4}-\d{2}-\d{2}$/.test(start))fail(400,'Choose the date the copied mappings should apply from.');
  const mods=Array.isArray(p.modules)&&p.modules.length?p.modules.map((m:any)=>text(m,20)):null;
  const maps=await tx`select module,routing_code,item_code,erp_account_code,label from erp_private.client_routing_map where client_id=${from} and status='Active' and effective_from<=current_date and coalesce(effective_to,'9999-12-31'::date)>=current_date and (${mods?tx.array(mods):null}::text[] is null or module=any(${mods?tx.array(mods):null}::text[])) order by module,routing_code limit 200`;
  if(!maps.length)fail(409,'This client has no approved mappings in force to copy.');
  const rows=maps.map((m:any)=>({module:m.module,routing_code:m.routing_code,item_code:m.item_code,erp_account_code:m.erp_account_code,effective_from:start,label:('Copied from '+src.company_name+(m.label?': '+m.label:'')).slice(0,200)}));
  let out:any={saved:0,problems:[]};
  try{out=await routingMapAction(tx,a,{action:'routing_map_propose',client_id:cid,rows});}
  catch(e:any){if(e?.status!==400)throw e;out={saved:0,problems:[{row:0,routing_code:'',issues:[e.message]}]};}
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_routing_map','ROUTING_MAP_COPIED_AS_DRAFT',${cid},${tx.json({from_client_id:from,offered:rows.length,saved:out.saved,skipped:out.problems.length})})`;
  return {ok:true,from:src.company_name,offered:rows.length,saved:out.saved,skipped:out.problems,note:'These are drafts. A different Partner approves each one before it maps anything.'};
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
