import {fail,text,uuid,choice,revision} from './validation.mjs';
import {range,safeUrl,rateParameters,amount} from './suite-rules.mjs';
import {taxTypes,testRate,validateProfile,registryParameters,dateString,keys,validateCanonicalRate} from './tax-registry.mjs';
import {one,leader} from './suite-actions.ts';
const partner=(a:any)=>{if(a.category_code!=='PARTNER')fail(403,'Engagement Partner approval is required.');};
const current=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'Refresh this record before saving.');};
export async function taxConfigAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action==='rate_save'){
  leader(a);const type=choice(p.tax_type,taxTypes),key=text(p.rate_key,60).toUpperCase();if(!/^[A-Z0-9_-]+$/.test(key))fail(400,'Use a stable code with letters, numbers, underscore or hyphen.');
  const [from,to]=range(p.effective_from,p.effective_to),url=safeUrl(p.source_url);if(!url)fail(400,'Add the official legal source URL.');
  const old=p.rate_id?one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)} for update`):null;if(old){current(old,p);if(old.status!=='Draft')fail(400,'Approved versions cannot change. Create a new dated version.');}
  const merged={...old?.parameters,...p.parameters};const params=['PAYE','Individual income tax'].includes(type)?{...rateParameters(type,merged),period:type==='PAYE'?'Monthly':'Annual'}:registryParameters(type,merged);
  validateCanonicalRate(key,type,params);
  if(JSON.stringify(params).length>5000)fail(400,'The rate configuration is too large.');
  if(old)await tx`update erp_private.tax_rates set rate_key=${key},tax_type=${type},label=${text(p.label,160)},effective_from=${from},effective_to=${to},parameters=${tx.json(params)},source_url=${url},source_note=${text(p.source_note,4000)},is_test=${p.is_test===true} where rate_id=${old.rate_id}`;
  else await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,created_by,is_test) values(${key},${type},${text(p.label,160)},${from},${to},${tx.json(params)},${url},${text(p.source_note,4000)},${a.staff_id},${p.is_test===true})`;
  return {ok:true};
 }
 if(p.action==='rate_approve'){
  partner(a);const r=one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)} for update`);current(r,p);if(r.status!=='Draft')fail(400,'Choose a draft rate.');
  if(testRate(r))fail(400,'Test-only rates cannot be approved for client computations.');
  if(p.confirm_legal_basis!==true)fail(400,'Confirm the statutory rate, eligibility conditions and effective dates against the linked source.');
  validateCanonicalRate(r.rate_key,r.tax_type,r.parameters);registryParameters(r.tax_type,r.parameters);if(['PAYE','Individual income tax'].includes(r.tax_type))rateParameters(r.tax_type,r.parameters);
  await tx`select pg_advisory_xact_lock(hashtextextended(${r.rate_key},0))`;
  if((await tx`select rate_id from erp_private.tax_rates where rate_key=${r.rate_key} and status='Approved' and effective_from<=${r.effective_to} and effective_to>=${r.effective_from}`).length)fail(400,'Approved dates overlap for this rule. Choose a non-overlapping validity period.');
  await tx`update erp_private.tax_rates set status='Approved',approved_by=${a.staff_id},approved_at=now() where rate_id=${r.rate_id}`;return {ok:true};
 }
 if(p.action==='rate_impact'){
  leader(a);const r=one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)}`);
  const kinds=Object.entries(keys).filter(([,v])=>(v as string[]).includes(r.rate_key)).map(([k])=>k);if(r.tax_type==='VAT')kinds.push('VAT');if(r.tax_type==='Withholding tax')kinds.push('WHT');
  return {rate:r,cases:await tx`select c.case_id,c.project_id,c.kind,c.starts_on,c.ends_on,c.status,p.project_name,cl.company_name from erp_private.tax_cases c join erp_private.projects p using(project_id) join erp_private.clients cl using(client_id) where c.deleted_at is null and (c.rate_id=${r.rate_id} or c.kind=any(${tx.array(kinds)}::text[])) and c.starts_on<=${r.effective_to} and c.ends_on>=${r.effective_from}`,notice:'Locked/filed cases retain their original snapshots. Open cases require a preparer preview and save; this action changes no calculations.'};
 }
 if(p.action==='tax_profile_save'){
  leader(a);const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);const clean=validateProfile(p),[from,to]=range(p.effective_from,p.effective_to);
  if(p.profile_id){const old=one(await tx`select * from erp_private.client_tax_profiles where profile_id=${uuid(p.profile_id)} and client_id=${cid} for update`);current(old,p);if(old.status!=='Draft')fail(400,'Create a new non-overlapping profile period; verified versions cannot change.');
   await tx`update erp_private.client_tax_profiles set entity_type=${clean.entity_type},residency=${clean.residency},regime=${clean.regime},obligations=${tx.array(clean.obligations)},annual_turnover=${clean.annual_turnover},effective_from=${from},effective_to=${to},notes=${clean.notes} where profile_id=${old.profile_id}`;
  }else {const id=crypto.randomUUID();await tx`insert into erp_private.client_tax_profiles(profile_id,client_id,entity_type,residency,regime,obligations,annual_turnover,effective_from,effective_to,notes,created_by) values(${id},${cid},${clean.entity_type},${clean.residency},${clean.regime},${tx.array(clean.obligations)},${clean.annual_turnover},${from},${to},${clean.notes},${a.staff_id})`;return {profile_id:id};}return {ok:true};
 }
 if(p.action==='tax_profile_verify'){
  leader(a);const r=one(await tx`select * from erp_private.client_tax_profiles where profile_id=${uuid(p.profile_id)} for update`);current(r,p);validateProfile(r);if(r.status!=='Draft')fail(400,'This profile is already verified.');if(p.confirm_obligations!==true)fail(400,'Confirm registration, residence, regime and exclusions from evidence.');
  await tx`update erp_private.client_tax_profiles set status='Verified',verified_by=${a.staff_id},verified_at=now() where profile_id=${r.profile_id}`;return {ok:true};
 }
 if(p.action==='release_read'){
  leader(a);const [counts]=await tx`select (select count(*) from erp_private.clients where deleted_at is null and cardinality(missing_fields)>0) incomplete_clients,(select count(*) from erp_private.clients c where c.deleted_at is null and not exists(select 1 from erp_private.client_tax_profiles p where p.client_id=c.client_id and p.status='Verified' and p.effective_from<=current_date and p.effective_to>=current_date)) clients_without_tax_profile,(select count(*) from erp_private.tax_rates where deleted_at is null and status='Draft' and catalog_source is not null) unapproved_catalogue_rates,(select count(*) from erp_private.firms where deleted_at is null and is_active and (kra_pin is null or vat_registered is null or coalesce(payment_instructions,'')='')) incomplete_firms,(select count(*) from erp_private.tasks where deleted_at is null and assigned_to is null) unassigned_tasks`;
  return {environment:'STAGING',automatic_checks:counts,checks:await tx`select * from erp_private.release_checks order by check_code`,limits:['Client portal and external PBC links are not connected.','Full audit programmes and specialist tax regimes require separate implementation.','Email/SMS delivery, payment gateways and eTIMS submission are not connected.','Production MFA, backup/restore and agreed load tests require evidence before cutover.']};
 }
 if(p.action==='release_check_save'){
  partner(a);const r=one(await tx`select * from erp_private.release_checks where check_code=${text(p.check_code,40)}`);current(r,p);const status=choice(p.status,['Not tested','In progress','Passed','Blocked']),evidence=text(p.evidence||'',4000,false);if(status==='Passed'&&evidence.length<21)fail(400,'Record the test date, result and evidence location before marking Passed.');
  await tx`update erp_private.release_checks set status=${status},evidence=${evidence},reviewed_by=${a.staff_id},reviewed_at=now() where check_code=${r.check_code}`;return {ok:true};
 }
 return undefined;
}
