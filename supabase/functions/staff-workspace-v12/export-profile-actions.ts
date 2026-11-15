import {fail,text,uuid,date,revision} from './validation.mjs';
import {RETURNS,RETURN_CODES,ROUNDING_RULES,HOUSING_MODES,ID_TYPES,profileFields} from './export-profile-rules.mjs';
// Build 2830: versioned statutory export profiles. A Manager or Partner drafts; a different Manager or Partner publishes it and records what it was checked against and when.
// A published profile is never edited: it is ended on a date and a newer version starts the next day. Table rules are in 20261116180000_statutory_export_profiles.sql.
const ACTIONS=['export_profile_list','export_profile_create','export_profile_revise','export_profile_publish','export_profile_end','export_profile_retire'];
const LEADERS=['PARTNER','MANAGER'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const present=(r:any)=>({profile_id:r.profile_id,return_code:r.return_code,return_label:RETURNS[r.return_code as keyof typeof RETURNS]?.label,authority:r.authority,period_kind:r.period_kind,version:r.version,layout_code:r.layout_code,template_version:r.template_version,rounding_rule:r.rounding_rule,rounding_label:ROUNDING_RULES[r.rounding_rule as keyof typeof ROUNDING_RULES],rounded_columns:r.rounded_columns||[],accepted_id_types:r.accepted_id_types||[],employer_housing_levy:r.employer_housing_levy,housing_label:HOUSING_MODES[r.employer_housing_levy as keyof typeof HOUSING_MODES],notes:r.notes,effective_from:day(r.effective_from),effective_to:r.effective_to?day(r.effective_to):null,status:r.status,provenance:r.provenance,verified_against:r.verified_against,verified_on:r.verified_on?day(r.verified_on):null,created_by:r.created_by,created_by_name:r.created_by_name,published_by_name:r.published_by_name,published_at:r.published_at,sole_partner_publish:r.sole_partner_publish,ended_reason:r.ended_reason,ended_by_name:r.ended_by_name,retired_reason:r.retired_reason,revision:String(r.revision),used_by:Number(r.used_by||0)});
export async function listProfiles(tx:any){
 return await tx`select s.*,erp_private.staff_name(s.created_by) created_by_name,erp_private.staff_name(s.published_by) published_by_name,erp_private.staff_name(s.ended_by) ended_by_name,
  (select count(*) from erp_private.statutory_file_exports x where x.profile_id=s.profile_id) as used_by from erp_private.statutory_export_profiles s order by s.return_code,s.version desc`;
}
export async function exportProfileAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Export profiles are for staff with client access.');
 const leader=LEADERS.includes(a.category_code);
 if(p.action==='export_profile_list'){
  return {profiles:(await listProfiles(tx)).map(present),can_manage:leader,me:a.staff_id,returns:RETURN_CODES.map(k=>({code:k,label:RETURNS[k as keyof typeof RETURNS].label,authority:RETURNS[k as keyof typeof RETURNS].authority,roundable:RETURNS[k as keyof typeof RETURNS].roundable,ids:RETURNS[k as keyof typeof RETURNS].ids,housing:RETURNS[k as keyof typeof RETURNS].housing})),rounding_rules:ROUNDING_RULES,housing_modes:HOUSING_MODES,id_types:ID_TYPES};
 }
 if(!leader)fail(403,'A Manager or Partner maintains export profiles.');
 if(p.action==='export_profile_create'){
  const f=profileFields(p);if(f.problem)fail(400,f.problem);const v=f.values!;
  const [last]=await tx`select coalesce(max(version),0) v from erp_private.statutory_export_profiles where return_code=${v.return_code}`;
  const [made]=await tx`insert into erp_private.statutory_export_profiles(return_code,authority,version,layout_code,template_version,rounding_rule,rounded_columns,accepted_id_types,employer_housing_levy,notes,effective_from,effective_to,created_by)
   values(${v.return_code},${v.authority},${Number(last.v)+1},${v.layout_code},${v.template_version},${v.rounding_rule},${tx.array(v.rounded_columns)},${tx.array(v.accepted_id_types)},${v.employer_housing_levy},${v.notes},${v.effective_from},${v.effective_to},${a.staff_id}) returning profile_id,version`;
  return {ok:true,profile_id:made.profile_id,version:made.version};
 }
 const t=one(await tx`select * from erp_private.statutory_export_profiles where profile_id=${uuid(p.profile_id)} for update`);
 if(String(t.revision)!==revision(p.revision))fail(409,'The profile changed. Refresh first.');
 if(p.action==='export_profile_revise'){
  if(t.status!=='Draft')fail(409,'A published profile is never edited. Save a new version.');
  if(t.created_by!==a.staff_id)fail(403,'Only the person who drafted a profile revises it. Save a new version to change a starter profile.');
  const f=profileFields({...p,return_code:t.return_code});if(f.problem)fail(400,f.problem);const v=f.values!;
  await tx`update erp_private.statutory_export_profiles set template_version=${v.template_version},rounding_rule=${v.rounding_rule},rounded_columns=${tx.array(v.rounded_columns)},accepted_id_types=${tx.array(v.accepted_id_types)},employer_housing_levy=${v.employer_housing_levy},notes=${v.notes},effective_from=${v.effective_from},effective_to=${v.effective_to} where profile_id=${t.profile_id}`;
  return {ok:true};
 }
 if(p.action==='export_profile_retire'){
  if(t.status==='Retired')fail(409,'It is already retired.');
  const why=text(p.reason||'',500,false).trim();if(why.length<5)fail(400,'Say why it is retired (at least 5 characters).');
  await tx`update erp_private.statutory_export_profiles set status='Retired',retired_by=${a.staff_id},retired_at=now(),retired_reason=${why} where profile_id=${t.profile_id}`;
  return {ok:true};
 }
 if(p.action==='export_profile_end'){
  if(t.status!=='Published')fail(409,'Only a published profile is ended on a date.');
  const to=date(p.effective_to);if(!to)fail(400,'Say the last day the profile applies.');
  if(to<day(t.effective_from))fail(400,'The last day cannot be before the first day.');
  if(t.effective_to&&to>=day(t.effective_to))fail(400,'A published profile can be ended earlier, never extended.');
  const why=text(p.reason||'',500,false).trim();if(why.length<5)fail(400,'Say why it ends (at least 5 characters).');
  await tx`update erp_private.statutory_export_profiles set effective_to=${to},ended_by=${a.staff_id},ended_at=now(),ended_reason=${why} where profile_id=${t.profile_id}`;
  return {ok:true};
 }
 // export_profile_publish
 if(t.status!=='Draft')fail(409,'Only a draft is published.');
 const against=text(p.verified_against||'',400,false).trim(),on=date(p.verified_on);
 if(against.length<5)fail(400,'Say what the profile was checked against, for example the current NSSF return specification or the SHA employer upload (at least 5 characters).');
 if(!on)fail(400,'Say the date it was checked.');
 let sole=false;
 if(t.created_by===a.staff_id){
  sole=a.category_code==='PARTNER'&&(await tx`select erp_private.sole_active_partner() as sole`)[0]?.sole===true;
  if(!sole)fail(403,'A different Manager or Partner publishes a profile you drafted, unless you are your firm\'s only Partner.');
 }
 const clash=(await tx`select version from erp_private.statutory_export_profiles o where o.return_code=${t.return_code} and o.profile_id<>${t.profile_id} and o.status='Published' and daterange(o.effective_from,coalesce(o.effective_to,'infinity'::date),'[]') && daterange(${day(t.effective_from)}::date,coalesce(${t.effective_to?day(t.effective_to):null}::date,'infinity'::date),'[]') limit 1`)[0];
 if(clash)fail(409,`Version ${clash.version} of this return still covers some of those dates. End it the day before this one starts (End on a date), then publish.`);
 await tx`update erp_private.statutory_export_profiles set status='Published',published_by=${a.staff_id},published_at=now(),sole_partner_publish=${sole},verified_against=${against},verified_on=${on} where profile_id=${t.profile_id}`;
 return {ok:true,sole_partner_publish:sole};
}
