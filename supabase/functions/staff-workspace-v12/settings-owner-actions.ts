import {fail,uuid} from './validation.mjs';
import {ownerMatrix,checkItems,OWNER_ROLES,AREA_SECTION,queueNeedsMe,recordNeedsMe,roleLabel} from './settings-owner-rules.mjs';
import {present} from './settings-state-rules.mjs';
import {settingsHubAction,openOwners} from './settings-hub-actions.ts';

// Owner Matrix and My Approvals (build 2839). The matrix is the only write here: a Partner confirms who owns each section. Confirming never edits an earlier row;
// the earlier confirmation is ended (who and when are kept) and a new one is added. An owner changes nobody's rights. My Approvals only reads.
const READERS=['PARTNER','MANAGER'];
const today=()=>new Date(Date.now()+3*3600*1000).toISOString().slice(0,10);
const iso=(v:any)=>v?new Date(v).toISOString():null;
export async function settingsOwnerAction(tx:any,a:any,p:any):Promise<any>{
 const act=String(p.action||'');
 if(!['settings_owners_read','settings_owners_confirm','settings_approvals_read'].includes(act))return undefined;
 if(!READERS.includes(a.category_code))fail(403,'Settings owners and approvals are for Managers and Partners.');
 if(act==='settings_owners_read'){
  const rows=ownerMatrix((await openOwners(tx)).map((o:any)=>({...o,confirmed_at:iso(o.confirmed_at)})));
  const staff=await tx`select staff_id,full_name,category_code from erp_private.staff_members where deleted_at is null and access_status='Active' and category_code<>'INTERN' order by full_name`;
  return {roles:OWNER_ROLES.map(([code,label]:any)=>({code,label})),rows,confirmed:rows.filter((r:any)=>r.confirmed).length,can_confirm:a.category_code==='PARTNER',staff:staff.map((s:any)=>({staff_id:s.staff_id,name:s.full_name,category:s.category_code}))};
 }
 if(act==='settings_owners_confirm'){
  if(a.category_code!=='PARTNER')fail(403,'A Partner confirms who owns each settings section.');
  const active=new Set((await tx`select staff_id from erp_private.staff_members where deleted_at is null and access_status='Active'`).map((r:any)=>String(r.staff_id)));
  const c=checkItems(p.items,(id:string)=>{try{return active.has(uuid(id));}catch{return false;}});if(!c.ok)fail(400,c.message);
  await tx`select pg_advisory_xact_lock(hashtextextended('settings-owners',0))`;
  let confirmed=0,unchanged=0;
  for(const i of c.items){
   const open=(await tx`select owner_id,owner_role,owner_staff_id from erp_private.settings_section_owners where section_key=${i.section_key} and ended_at is null for update`)[0];
   const same=open&&open.owner_role===i.owner_role&&String(open.owner_staff_id||'')===String(i.staff_id||'');
   if(same){unchanged++;continue;}
   if(open)await tx`update erp_private.settings_section_owners set ended_by=${a.staff_id},ended_at=now() where owner_id=${open.owner_id}`;
   await tx`insert into erp_private.settings_section_owners(section_key,owner_role,owner_staff_id,note,confirmed_by) values(${i.section_key},${i.owner_role},${i.staff_id},${i.note},${a.staff_id})`;
   confirmed++;
  }
  return {confirmed,unchanged};
 }
 // settings_approvals_read: what waits, in two lists. Queues come from the hub counts; records from the settings register.
 const hub=await settingsHubAction(tx,a,{action:'settings_hub_read'});
 const canTax=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
 const me=(await tx`select erp_private.staff_name(${a.staff_id}) as n`)[0]?.n||null;
 const reg=(await tx`select erp_private.settings_register() as r`)[0]?.r,t=today();
 const ownerBy=new Map((await openOwners(tx)).map((o:any)=>[o.section_key,o.owner_role]));
 const suggested=new Map(hub.sections.map((s:any)=>[s.key,s.role||null]));
 const ownerRole=(key:string)=>ownerBy.get(key)||null;
 const queues=hub.waiting.map((s:any)=>({key:s.key,title:s.title,count:s.pending,verb:s.needs,where:s.where,go:s.go||null,
  owner_role:ownerRole(s.key),owner_confirmed:!!ownerRole(s.key),owner_label:ownerRole(s.key)?roleLabel(ownerRole(s.key)):(suggested.get(s.key)?roleLabel(suggested.get(s.key))+' (suggested)':''),
  needs_my_action:queueNeedsMe(s.key,a.category_code,canTax)}));
 const records=(Array.isArray(reg)?reg:[]).map((r:any)=>present(r,t)).map((r:any)=>{const key=(AREA_SECTION as any)[r.area]||null,role=key?ownerRole(key):null;
  return {area:r.area,area_label:r.area_label,record_id:r.record_id,label:r.label,state:r.state,native_status:r.native_status,effective_from:r.effective_from,effective_to:r.effective_to,expires_on:r.expires_on,
   prepared_by:r.prepared_by,approver:r.approver,tab:r.tab,scope:r.extra?.client_name||'Firm-wide',owner_role:role,owner_label:role?roleLabel(role):'',
   needs_my_action:recordNeedsMe(r,a.category_code,me,canTax)};});
 const scopes=[...new Set(records.map((r:any)=>r.scope).filter((s:string)=>s!=='Firm-wide'))].sort();
 return {queues,records,scopes,roles:OWNER_ROLES.map(([code,label]:any)=>({code,label})),me,note:'The setting\'s own screen still decides who may approve. "Needs my action" means it is waiting, you may act on that kind of item, and you did not prepare it.'};
}
