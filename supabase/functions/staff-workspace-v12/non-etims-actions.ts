import {fail,text,uuid,revision} from './validation.mjs';
import {legalCategories} from './workbook-templates.mjs';
import {findDuplicates,exceptionDetails,WINDOW_DAYS} from './non-etims-rules.mjs';
// Non-eTIMS exception workflow.
// - A row without an eTIMS invoice is mapped on a named basis from non_etims_bases, with evidence (a linked document or a reference).
// - A Partner approves a basis only after entering the legal reference they verified; until then it stays in Testing and rows that rely on
//   it block tax review. A Partner can retire a basis; nothing is deleted.
// - Before a row is kept, other purchases and bank debits are checked for the same payment. Keeping a possible duplicate needs a written reason.
const COST_AND_BANK=['Purchases','Expenditure','Non-eTIMS','Bank'];
const nairobiNow=()=>new Date().toISOString();
const isPartner=(a:any)=>a.category_code==='PARTNER';
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must maintain non-eTIMS bases.');};
const addDays=(ymd:string,n:number)=>new Date(Date.parse(ymd+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const ymdOf=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);

/** Live rows of the project that could be the same payment as any of `rows` (cost rows and bank debits within the date window). */
export async function duplicateCandidates(tx:any,pid:string,rows:any[]){
 const dates=rows.map(r=>ymdOf(r.normalized?.date)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
 if(!dates.length)return [];
 const from=addDays(dates[0],-WINDOW_DAYS),to=addDays(dates[dates.length-1],WINDOW_DAYS);
 return await tx`select r.row_id,r.dataset,r.source_row,r.is_split_parent,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${pid} and b.archived_at is null and r.dataset=any(${tx.array(COST_AND_BANK)}::text[]) and not r.is_split_parent
   and r.normalized->>'date'>=${from} and r.normalized->>'date'<=${to} limit 20000`;
}

/**
 * Review-detail patches for the non-eTIMS rows in a mapping request. Returns row_id -> patch. Throws a staff-readable error when a
 * basis, evidence or duplicate reason is missing. Free-text legal fields are no longer accepted for these rows.
 */
export async function exceptionPatches(tx:any,a:any,p:any,rows:any[],pid:string):Promise<Map<string,any>>{
 const out=new Map<string,any>(),targets=rows.filter(r=>r.dataset==='Non-eTIMS');
 const code=String(p.basis_code||'').trim();
 if(!code){
  if(targets.length&&(String(p.legal_basis||'').trim()||String(p.evidence||'').trim()))fail(400,'Choose a legal basis from the list. Free-text legal bases are no longer accepted for non-eTIMS rows.');
  return out;
 }
 if(!targets.length)fail(400,'A legal basis applies only to non-eTIMS rows.');
 const basis=(await tx`select * from erp_private.non_etims_bases where basis_code=${code}`)[0];
 if(!basis)fail(400,'Choose a legal basis from the list.');
 if(basis.status==='Retired')fail(400,'This legal basis has been retired. Choose another one.');
 if(p.legal_category&&p.legal_category!==basis.legal_category)fail(400,'The legal category does not match the chosen basis.');
 let doc:any=null;
 if(p.evidence_document_id){
  doc=(await tx`select document_id,file_name from erp_private.documents where document_id=${uuid(p.evidence_document_id)} and project_id=${pid} and deleted_at is null and archived_at is null`)[0];
  if(!doc)fail(400,'The evidence document is unavailable or belongs to another project.');
 }
 const candidates=await duplicateCandidates(tx,pid,targets),at=nairobiNow();
 let overridden=0;
 for(const r of targets){
  const matches=findDuplicates(r,candidates),res:any=exceptionDetails(basis,p,doc,{matches,actor:a.staff_id,at});
  if(res.error)fail(400,`Source row ${r.source_row}: ${res.error}`);
  if(res.details.duplicate_override)overridden++;
  out.set(r.row_id,res.details);
 }
 if(overridden)await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'workbook_rows','NON_ETIMS_DUPLICATE_OVERRIDE',${pid},${tx.json({basis_code:code,rows:overridden,reason:String(p.duplicate_reason||'').trim().slice(0,500)})})`;
 return out;
}

const publicBasis=(b:any)=>({basis_id:b.basis_id,basis_code:b.basis_code,legal_category:b.legal_category,label:b.label,guidance:b.guidance,legal_reference:b.legal_reference,status:b.status,revision:b.revision,approved_at:b.approved_at,retired_at:b.retired_at,retire_reason:b.retire_reason,created_by:b.created_by,approved_by:b.approved_by,approver_name:b.approver_name||null});

export async function nonEtimsAction(tx:any,a:any,p:any){
 if(!String(p.action||'').startsWith('non_etims_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Interns can access assigned tasks, not purchase mapping.');
 if(p.action==='non_etims_bases'){
  const rows=await tx`select b.*,s.full_name approver_name,(select count(*)::int from erp_private.workbook_rows r where r.review_details->>'basis_code'=b.basis_code) used from erp_private.non_etims_bases b left join erp_private.staff_members s on s.staff_id=b.approved_by order by case b.status when 'Active' then 0 when 'Testing' then 1 else 2 end,b.legal_category,b.basis_code`;
  return {bases:rows.map((b:any)=>({...publicBasis(b),used:b.used})),categories:legalCategories,can_approve:isPartner(a),can_edit:['PARTNER','MANAGER'].includes(a.category_code)};
 }
 if(p.action==='non_etims_check'){
  const pid=uuid(p.project_id),ids=Array.isArray(p.row_ids)?p.row_ids.map(uuid):[];
  if(!ids.length||ids.length>500)fail(400,'Select 1–500 rows.');
  const rows=await tx`select r.row_id,r.dataset,r.source_row,r.is_split_parent,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and b.archived_at is null and r.dataset='Non-eTIMS' and r.row_id=any(${tx.array(ids)}::uuid[])`;
  if(!rows.length)return {duplicates:{},window_days:WINDOW_DAYS};
  const candidates=await duplicateCandidates(tx,pid,rows),duplicates:Record<string,any[]>={};
  for(const r of rows){const m=findDuplicates(r,candidates);if(m.length)duplicates[r.row_id]=m;}
  return {duplicates,window_days:WINDOW_DAYS};
 }
 leader(a);
 if(p.action==='non_etims_basis_save'){
  const category=String(p.legal_category||''),label=text(p.label,200),guidance=text(p.guidance||'',1000,false),reference=text(p.legal_reference||'',500,false);
  if(!legalCategories.includes(category))fail(400,'Choose a workbook legal category.');
  if(p.basis_id){
   const b=(await tx`select * from erp_private.non_etims_bases where basis_id=${uuid(p.basis_id)} for update`)[0];
   if(!b)fail(404,'This basis is unavailable.');
   if(String(b.revision)!==revision(p.revision))fail(409,'This basis changed. Refresh before saving.');
   if(b.status!=='Testing')fail(400,'Only a basis in Testing can be edited. Retire an approved basis and add a new one.');
   await tx`update erp_private.non_etims_bases set legal_category=${category},label=${label},guidance=${guidance},legal_reference=${reference},revision=revision+1 where basis_id=${b.basis_id}`;
   return {ok:true};
  }
  const code=String(p.basis_code||'').trim().toUpperCase();
  if(!/^[A-Z0-9-]{3,30}$/.test(code))fail(400,'Use 3–30 capital letters, digits or hyphens for the basis code.');
  if((await tx`select 1 from erp_private.non_etims_bases where basis_code=${code}`).length)fail(409,'This basis code already exists.');
  await tx`insert into erp_private.non_etims_bases(basis_code,legal_category,label,guidance,legal_reference,created_by) values(${code},${category},${label},${guidance},${reference},${a.staff_id})`;
  return {ok:true};
 }
 if(p.action==='non_etims_basis_approve'){
  if(!isPartner(a))fail(403,'Only a Partner can approve a non-eTIMS basis.');
  const b=(await tx`select * from erp_private.non_etims_bases where basis_id=${uuid(p.basis_id)} for update`)[0];
  if(!b)fail(404,'This basis is unavailable.');
  if(String(b.revision)!==revision(p.revision))fail(409,'This basis changed. Refresh before approving.');
  if(b.status!=='Testing')fail(400,'Only a basis in Testing can be approved.');
  if(b.created_by&&String(b.created_by)===String(a.staff_id))fail(403,'The person who prepared this basis cannot approve it.');
  const reference=text(p.legal_reference||b.legal_reference||'',500,false);
  if(reference.trim().length<10)fail(400,'Enter the legal reference you verified (at least 10 characters) before approving.');
  if(p.confirm_verified!==true)fail(400,'Confirm that you verified the legal reference against the official source.');
  await tx`update erp_private.non_etims_bases set status='Active',legal_reference=${reference},approved_by=${a.staff_id},approved_at=now(),revision=revision+1 where basis_id=${b.basis_id}`;
  return {ok:true};
 }
 if(p.action==='non_etims_basis_retire'){
  if(!isPartner(a))fail(403,'Only a Partner can retire a non-eTIMS basis.');
  const b=(await tx`select * from erp_private.non_etims_bases where basis_id=${uuid(p.basis_id)} for update`)[0];
  if(!b)fail(404,'This basis is unavailable.');
  if(String(b.revision)!==revision(p.revision))fail(409,'This basis changed. Refresh before retiring.');
  if(b.status==='Retired')fail(400,'This basis is already retired.');
  const reason=text(p.reason,1000);if(reason.length<10)fail(400,'Enter a reason of at least 10 characters.');
  await tx`update erp_private.non_etims_bases set status='Retired',retired_by=${a.staff_id},retired_at=now(),retire_reason=${reason},revision=revision+1 where basis_id=${b.basis_id}`;
  return {ok:true};
 }
 fail(404,'Unknown non-eTIMS action.');
}
