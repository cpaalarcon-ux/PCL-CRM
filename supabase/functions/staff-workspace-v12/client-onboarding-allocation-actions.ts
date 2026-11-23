import {fail,text,uuid} from './validation.mjs';
// Access alignment, step 1: a Manager or Partner allocates existing clients to a preparer (Assistant or Supervisor) before any project exists.
// An active allocation gives that person the client's onboarding profile and proposal workflow (see client_onboarding_allocated in
// 20261209100000_client_onboarding_allocations.sql); the database applies it, so no other screen or route can widen it.
const ACTIONS=['client_onboarding_alloc_read','client_onboarding_alloc_clients','client_onboarding_alloc_assign','client_onboarding_alloc_remove'];
const MAX_PER_REQUEST=500;
const leader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const uuids=(v:any,label:string)=>{
 if(!Array.isArray(v)||!v.length)fail(400,`Choose at least one ${label}.`);
 if(v.length>MAX_PER_REQUEST)fail(400,`Choose at most ${MAX_PER_REQUEST} clients at a time.`);
 const ids=v.map((x:any)=>uuid(x).toLowerCase());
 return [...new Set(ids)];
};
const importedFile=(name:string)=>text(name,300,false);

async function preparer(tx:any,staffId:string){
 const s=(await tx`select staff_id,full_name,category_code from erp_private.onboarding_preparers() where staff_id=${staffId}`)[0];
 if(!s)fail(400,'Choose an active Assistant or Supervisor who works in one of your firms.');
 return s;
}
async function clientsOfFile(tx:any,file:string){
 return (await tx`select distinct f.client_id from erp_private.client_field_facts f join erp_private.clients c on c.client_id=f.client_id and c.deleted_at is null
  where f.source_kind='Import' and regexp_replace(f.source_reference,' row [0-9]+$','')=${file} limit ${MAX_PER_REQUEST+1}`).map((r:any)=>r.client_id);
}

export async function clientOnboardingAllocationAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!leader(a))fail(403,'A Manager or Partner allocates clients for onboarding.');

 if(p.action==='client_onboarding_alloc_read'){
  const staffId=p.staff_id?uuid(p.staff_id):null;
  const preparers=await tx`select s.staff_id,s.full_name,s.category_code,
    (select count(*)::int from erp_private.client_onboarding_allocations x where x.staff_id=s.staff_id and x.ended_at is null) as allocated
   from erp_private.onboarding_preparers() s order by s.full_name,s.staff_id limit 500`;
  const files=await tx`select regexp_replace(f.source_reference,' row [0-9]+$','') as file,count(distinct f.client_id)::int as clients
   from erp_private.client_field_facts f join erp_private.clients c on c.client_id=f.client_id and c.deleted_at is null
   where f.source_kind='Import' group by 1 order by max(f.recorded_at) desc limit 50`;
  const allocations=staffId?await tx`select x.allocation_id,x.client_id,c.company_name,c.kra_pin,x.allocated_at,x.note,x.source,erp_private.aml_staff_name(x.allocated_by) as allocated_by_name
   from erp_private.client_onboarding_allocations x join erp_private.clients c on c.client_id=x.client_id
   where x.staff_id=${staffId} and x.ended_at is null order by c.company_name,x.allocation_id limit 1000`:[];
  return {preparers,files,allocations};
 }

 if(p.action==='client_onboarding_alloc_clients'){
  const q=text(p.q||'',120,false),file=p.file?importedFile(p.file):null,offset=Math.min(100000,Math.max(0,Number.parseInt(p.offset,10)||0));
  const staffId=p.staff_id?uuid(p.staff_id):null,only=p.unallocated_only===true;
  const rows=await tx`select c.client_id,c.company_name,c.kra_pin,count(*) over() as total_count,
    coalesce((select string_agg(erp_private.aml_staff_name(x.staff_id),', ' order by erp_private.aml_staff_name(x.staff_id)) from erp_private.client_onboarding_allocations x where x.client_id=c.client_id and x.ended_at is null),'') as allocated_to,
    (${staffId}::uuid is not null and exists(select 1 from erp_private.client_onboarding_allocations x where x.client_id=c.client_id and x.staff_id=${staffId} and x.ended_at is null)) as already_this_person
   from erp_private.clients c
   where c.deleted_at is null
    and (${q}='' or strpos(lower(concat_ws(' ',c.company_name,c.kra_pin)),lower(${q}))>0)
    and (${file}::text is null or exists(select 1 from erp_private.client_field_facts f where f.client_id=c.client_id and f.source_kind='Import' and regexp_replace(f.source_reference,' row [0-9]+$','')=${file}))
    and (not ${only} or not exists(select 1 from erp_private.client_onboarding_allocations x where x.client_id=c.client_id and x.ended_at is null))
   order by c.company_name,c.client_id limit 100 offset ${offset}`;
  return {clients:rows,total:Number(rows[0]?.total_count||0)};
 }

 if(p.action==='client_onboarding_alloc_assign'){
  const person=await preparer(tx,uuid(p.staff_id));
  const note=text(p.note||'',500,false);
  let ids:string[],source='Selected';
  if(p.file){const file=importedFile(p.file);ids=await clientsOfFile(tx,file);if(!ids.length)fail(400,'No clients were imported from that file.');if(ids.length>MAX_PER_REQUEST)fail(400,`That file has more than ${MAX_PER_REQUEST} clients. Allocate them in smaller groups.`);source='Import: '+file;}
  else ids=uuids(p.client_ids,'client');
  // Only clients this Manager or Partner may see, and only where the preparer works in one of the client's firms (or the client has no firm yet).
  const added=await tx`insert into erp_private.client_onboarding_allocations(client_id,staff_id,allocated_by,note,source)
   select c.client_id,${person.staff_id},${a.staff_id},${note||null},${source.slice(0,300)} from erp_private.clients c
   where c.client_id=any(${ids}::uuid[]) and c.deleted_at is null
    and erp_private.onboarding_staff_fits_client(${person.staff_id},c.client_id)
   on conflict (client_id,staff_id) where ended_at is null do nothing returning client_id`;
  const requested=ids.length,allocated=added.length;
  const already=(await tx`select count(*)::int n from erp_private.client_onboarding_allocations where staff_id=${person.staff_id} and client_id=any(${ids}::uuid[]) and ended_at is null`)[0].n-allocated;
  return {ok:true,staff_name:person.full_name,requested,allocated,already_allocated:Math.max(0,already),not_eligible:Math.max(0,requested-allocated-Math.max(0,already))};
 }

 // client_onboarding_alloc_remove
 const sid=uuid(p.staff_id),held=(await tx`select staff_id from erp_private.client_onboarding_allocations where staff_id=${sid} limit 1`)[0],
  named=(await tx`select staff_id,full_name from erp_private.onboarding_preparers() where staff_id=${sid}`)[0],person=named||(held?{staff_id:sid,full_name:'that person'}:null);
 if(!person)fail(404,'That person has no onboarding allocations.');
 const ids=uuids(p.client_ids,'client'),reason=text(p.reason||'',500,true);
 if(reason.trim().length<5)fail(400,'Say why the allocation is ending (at least 5 characters).');
 const ended=await tx`update erp_private.client_onboarding_allocations set ended_at=now(),ended_by=${a.staff_id},end_reason=${reason.trim()}
  where staff_id=${person.staff_id} and client_id=any(${ids}::uuid[]) and ended_at is null returning client_id`;
 return {ok:true,staff_name:person.full_name,ended:ended.length};
}
