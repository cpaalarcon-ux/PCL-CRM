import {fail,text,uuid,choice,revision} from './validation.mjs';
import {syncClientDependencyTasks} from './dependency-tasks.ts';
import {range,safeUrl,rateParameters,amount} from './suite-rules.mjs';
import {taxTypes,testRate,validateProfile,registryParameters,dateString,keys,validateCanonicalRate,rateApprovalIssue,legalReviewStates,legalConfirmIssue} from './tax-registry.mjs';
import {one,leader,today} from './suite-actions.ts';
import {taxTestingEnabled,testingAuthorizationIssue,stagingRates,preferredRates} from './testing-rates.mjs';
import {turnoverWatch,trailingYear} from './turnover-watch.mjs';
import {summarySalesRows} from './period-import-actions.ts';
const partner=(a:any)=>{if(a.category_code!=='PARTNER')fail(403,'Engagement Partner approval is required.');};
// VAT and credit (withholding tax) rules need the designated Tax Lead's own action (the APPROVE_TAX_RULES right); a Partner without that right cannot confirm or approve them.
// Every other rule can be confirmed and approved by a Partner or by the Tax Lead. The database enforces the same rule again.
const leadOnly=['VAT','Withholding tax'];
async function rateAuthority(tx:any,a:any,r:any){
 const holder=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
 if(leadOnly.includes(r.tax_type)){if(!holder)fail(403,'VAT and credit rules can only be confirmed and approved by the designated Tax Manager who holds the APPROVE_TAX_RULES permission. An Engagement Partner assigns the Tax Manager to an engagement and switches the permission on.');return holder;}
 if(a.category_code!=='PARTNER'&&!holder)fail(403,'Engagement Partner or designated Tax Manager approval is required.');
 return holder;
}
const current=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'Refresh this record before saving.');};
async function linkedFirms(tx:any,cid:string,clean:any){
 const ids=[...new Set(Object.values(clean.obligation_statuses).flatMap((x:any)=>x.handling_firm_ids||[]))];if(!ids.length)return;
 const rows=await tx`select firm_id from erp_private.client_firm_links where client_id=${cid} and firm_id=any(${tx.array(ids)}::uuid[]) and deleted_at is null`;
 if(rows.length!==ids.length)fail(400,'Choose only firms linked to this client in the obligation handling settings.');
}
async function saveProfileObligations(tx:any,a:any,r:any){
 const selected=r.obligations||[];if(selected.length)await tx`update erp_private.client_tax_obligations set is_selected=false where profile_id=${r.profile_id} and not(obligation_code=any(${tx.array(selected)}::text[]))`;
 for(const code of selected){
  const fact=r.obligation_statuses?.[code]||{},from=fact.effective_from||r.effective_from,to=fact.effective_to||r.effective_to;
  const row=one(await tx`insert into erp_private.client_tax_obligations(client_id,profile_id,obligation_code,effective_from,effective_to,registered,applicable,client_status,evidence_reference,handling_firm_ids,is_selected,created_by)
   values(${r.client_id},${r.profile_id},${code},${from},${to},${fact.registered||'UNKNOWN'},${fact.applicable||'TO_CONFIRM'},${fact.client_status||'UNKNOWN'},${fact.evidence_reference||''},${tx.array(fact.handling_firm_ids||[])}::uuid[],true,${r.created_by})
   on conflict(profile_id,obligation_code) do update set effective_from=excluded.effective_from,effective_to=excluded.effective_to,registered=excluded.registered,applicable=excluded.applicable,client_status=excluded.client_status,evidence_reference=excluded.evidence_reference,handling_firm_ids=excluded.handling_firm_ids,is_selected=true returning obligation_id,obligation_code,effective_from,effective_to`);
  const versions=await tx`select version_id from erp_private.dependency_map_versions where status in ('Testing','Approved') and effective_from<=${row.effective_from} and (effective_to is null or effective_to>=${row.effective_to}) order by effective_from desc limit 2`;
  if(versions.length!==1)fail(409,`${code}: exactly one released dependency-map version must cover the selected dates.`);
  const rules=await tx`select dependency_code from erp_private.dependency_map_rules where version_id=${versions[0].version_id} and source_type='OBLIGATION' and source_code=${code}`;
  for(const rule of rules)await tx`insert into erp_private.client_dependency_sources(client_id,source_type,source_id,source_code,dependency_code,version_id,effective_from,effective_to,created_by)
   values(${r.client_id},'OBLIGATION',${row.obligation_id},${code},${rule.dependency_code},${versions[0].version_id},${row.effective_from},${row.effective_to},${a.staff_id})
   on conflict(source_type,source_id,dependency_code,version_id) do update set effective_from=excluded.effective_from,effective_to=excluded.effective_to`;
 }
}

// Rolling 12-month sales for one client from confirmed or submitted eTIMS summaries and invoice-level sales rows.
async function clientTurnover(tx:any,clientId:string,start:string,end:string){
 let total=0,exempt=0;const months=new Set<string>();
 const projects=await tx`select project_id from erp_private.projects where client_id=${clientId} and deleted_at is null`;
 for(const pr of projects){
  const rows=await summarySalesRows(tx,pr.project_id,start,end,{includeSubmitted:true,sourceTypes:['ETIMS']});
  for(const r of rows){if(r.dataset!=='Sales')continue;const amt=Number(r.normalized?.amount||0);total+=amt;if(r.normalized?.vat_category==='Exempt')exempt+=amt;months.add(String(r.period_start).slice(0,7));}
 }
 const wb=(await tx`select coalesce(sum(case when r.normalized->>'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' then (r.normalized->>'amount')::numeric else 0 end),0) total,
   coalesce(sum(case when r.normalized->>'amount' ~ '^-?[0-9]+(\\.[0-9]+)?$' and coalesce(r.normalized->>'vat_category','')='Exempt' then (r.normalized->>'amount')::numeric else 0 end),0) exempt,
   coalesce(array_agg(distinct substr(r.normalized->>'date',1,7)) filter (where r.normalized->>'date' ~ '^[0-9]{4}-[0-9]{2}'),'{}') months
   from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
   where r.client_id=${clientId} and r.dataset='Sales' and b.archived_at is null and not r.is_split_parent and r.normalized->>'date' between ${start} and ${end}`)[0];
 total+=Number(wb.total||0);exempt+=Number(wb.exempt||0);for(const m of wb.months||[])months.add(m);
 return {total:Math.round(total*100)/100,taxable:Math.round((total-exempt)*100)/100,months:Math.min(12,months.size)};
}
export async function taxConfigAction(tx:any,a:any,p:any):Promise<any>{
 if(p.action==='rate_save'){
  leader(a);const type=choice(p.tax_type,taxTypes),key=text(p.rate_key,60).toUpperCase();if(!/^[A-Z0-9_-]+$/.test(key))fail(400,'Use a stable code with letters, numbers, underscore or hyphen.');
  const [from,to]=range(p.effective_from,p.effective_to),rawUrl=text(p.source_url||'',1000,false),url=rawUrl?safeUrl(rawUrl):'',note=text(p.source_note||'',4000,false);
  const old=p.rate_id?one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)} for update`):null;if(old){current(old,p);if(!['Draft','Testing'].includes(old.status))fail(400,'Approved versions cannot change. Create a new dated version.');if(old.legal_review_status==='Confirmed')fail(400,'The Tax Lead confirmation covers these figures. Create a new dated version to change them.');}
  const legalCitation=text(p.legal_citation||'',500,false),legalState=choice(p.legal_review_status||old?.legal_review_status||'Not required',legalReviewStates.filter(x=>x!=='Confirmed')),legalNote=text(p.legal_review_note||'',1000,false);
  if(legalState==='Pending'&&legalNote.length<10)fail(400,'Say what the Tax Lead still has to confirm (at least 10 characters).');
  const merged={...old?.parameters,...p.parameters};const params=['PAYE','Individual income tax'].includes(type)?{...rateParameters(type,merged),period:type==='PAYE'?'Monthly':'Annual'}:registryParameters(type,merged);
  validateCanonicalRate(key,type,params);
  if(JSON.stringify(params).length>5000)fail(400,'The rate configuration is too large.');
  if(old){const changed=await tx`update erp_private.tax_rates set rate_key=${key},tax_type=${type},label=${text(p.label,160)},effective_from=${from},effective_to=${to},parameters=${tx.json(params)},source_url=${url},source_note=${note},legal_citation=${legalCitation||null},legal_review_status=${legalState},legal_review_note=${legalState==='Pending'?legalNote:null},is_test=${p.is_test===true},status=${old.status==='Testing'?'Draft':old.status},testing_authorized_at=${old.status==='Testing'?null:old.testing_authorized_at},testing_authorization_note=${old.status==='Testing'?'':old.testing_authorization_note} where rate_id=${old.rate_id} returning rate_id`;if(!changed.length)fail(403,'This testing rule is not editable by your account.');}
  else await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,created_by,is_test,legal_citation,legal_review_status,legal_review_note) values(${key},${type},${text(p.label,160)},${from},${to},${tx.json(params)},${url},${note},${a.staff_id},${p.is_test===true},${legalCitation||null},${legalState},${legalState==='Pending'?legalNote:null})`;
  return {ok:true};
 }
 if(p.action==='rate_test'){
  leader(a);if(!taxTestingEnabled(Deno.env.get('SUPABASE_URL')||''))fail(403,'Rule testing can be enabled only in the staging ERP.');
  const r=one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)} for update`);current(r,p);
  if(r.status!=='Draft')fail(400,'Only a saved draft can be enabled for staging testing.');
  const testingIssue=testingAuthorizationIssue(p.confirm_staging,p.testing_note);if(testingIssue)fail(400,testingIssue);
  const note=text(p.testing_note,2000);
  validateCanonicalRate(r.rate_key,r.tax_type,r.parameters);
  if(['PAYE','Individual income tax'].includes(r.tax_type))rateParameters(r.tax_type,r.parameters);else registryParameters(r.tax_type,r.parameters);
  await tx`select pg_advisory_xact_lock(hashtextextended(${r.rate_key},0))`;
  if((await tx`select rate_id from erp_private.tax_rates where rate_key=${r.rate_key} and status='Testing' and deleted_at is null and rate_id<>${r.rate_id} and effective_from<=${r.effective_to} and effective_to>=${r.effective_from}`).length)fail(400,'Another staging-test version overlaps these dates.');
  await tx`update erp_private.tax_rates set status='Testing',testing_authorized_at=now(),testing_authorization_note=${note} where rate_id=${r.rate_id}`;
  return {ok:true,staging_only:true};
 }
 if(p.action==='rate_legal_confirm'){
  const r=one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)} for update`);const holder=await rateAuthority(tx,a,r);current(r,p);
  const issue=legalConfirmIssue(r,{lead_name:p.lead_name,reference:p.reference,citation:p.legal_citation,confirmed:p.confirmed},{...a,tax_lead:holder});if(issue)fail(400,issue);
  if(r.created_by&&String(r.created_by)===String(a.staff_id))fail(403,'The person who prepared this tax rule cannot record its legal confirmation.');
  validateCanonicalRate(r.rate_key,r.tax_type,r.parameters);registryParameters(r.tax_type,r.parameters);
  await tx`update erp_private.tax_rates set legal_review_status='Confirmed',legal_citation=${text(p.legal_citation||r.legal_citation,500)},legal_review_reference=${text(p.reference,300)},legal_review_note=${'Confirmed by '+text(p.lead_name,120)},legal_reviewed_by=${a.staff_id},legal_reviewed_at=now() where rate_id=${r.rate_id}`;
  return {ok:true};
 }
 if(p.action==='rate_approve'){
  const r=one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)} for update`);await rateAuthority(tx,a,r);current(r,p);if(!['Draft','Testing'].includes(r.status))fail(400,'Choose a draft or provisional testing rate.');
  if(r.rate_key==='KE_TOT'){const gate=(await tx`select status,evidence from erp_private.release_checks where check_code='TOTVAT'`)[0];if(!gate||gate.status!=='Passed'||String(gate.evidence||'').trim().length<21)fail(400,'Keep the TOT rule in Testing until the staging TOT/VAT acceptance check is evidence-backed and marked Passed by the accountable reviewer.');}
  if(testRate(r))fail(400,'Test-only rates cannot be approved for client computations.');if(r.created_by&&String(r.created_by)===String(a.staff_id))fail(403,'The person who prepared this tax rule cannot approve it.');const sourceIssue=rateApprovalIssue(r,a.staff_id);if(sourceIssue)fail(400,sourceIssue);
  if(p.confirm_legal_basis!==true)fail(400,'Confirm the statutory rate, eligibility conditions and effective dates against the linked source.');
  validateCanonicalRate(r.rate_key,r.tax_type,r.parameters);registryParameters(r.tax_type,r.parameters);if(['PAYE','Individual income tax'].includes(r.tax_type))rateParameters(r.tax_type,r.parameters);
  await tx`select pg_advisory_xact_lock(hashtextextended(${r.rate_key},0))`;
  if((await tx`select rate_id from erp_private.tax_rates where rate_key=${r.rate_key} and status='Approved' and effective_from<=${r.effective_to} and effective_to>=${r.effective_from}`).length)fail(400,'Approved dates overlap for this rule. Choose a non-overlapping validity period.');
  await tx`update erp_private.tax_rates set status='Approved',approved_by=${a.staff_id},approved_at=now(),partner_source_verified_on=current_date where rate_id=${r.rate_id}`;return {ok:true};
 }
 if(p.action==='rate_impact'){
  leader(a);const r=one(await tx`select * from erp_private.tax_rates where rate_id=${uuid(p.rate_id)}`);
  const kinds=Object.entries(keys).filter(([,v])=>(v as string[]).includes(r.rate_key)).map(([k])=>k);if(r.tax_type==='VAT')kinds.push('VAT');if(r.tax_type==='Withholding tax')kinds.push('WHT');
  return {rate:r,cases:await tx`select c.case_id,c.project_id,c.kind,c.starts_on,c.ends_on,c.status,p.project_name,cl.company_name from erp_private.tax_cases c join erp_private.projects p using(project_id) join erp_private.clients cl using(client_id) where c.deleted_at is null and (c.rate_id=${r.rate_id} or c.kind=any(${tx.array(kinds)}::text[])) and c.starts_on<=${r.effective_to} and c.ends_on>=${r.effective_from}`,notice:'Locked/filed cases retain their original snapshots. Open cases require a preparer preview and save; this action changes no calculations.'};
 }
 if(p.action==='tax_profile_turnover_watch'){
  leader(a);const asOf=p.as_of?dateString(p.as_of):today(),{start,end}=trailingYear(asOf);
  const rates=stagingRates(await tx`select * from erp_private.tax_rates where status in('Approved','Testing') and deleted_at is null and rate_key in('KE_TOT','KE_VAT_REG_THRESHOLD')`,Deno.env.get('SUPABASE_URL')||'');
  const pick=(key:string)=>preferredRates(rates,key,asOf,asOf)[0]||null,totRule=pick('KE_TOT'),vatRule=pick('KE_VAT_REG_THRESHOLD');
  const limit=(r:any)=>r?{threshold:r.parameters?.threshold??null,minimum:r.parameters?.minimum_turnover_exclusive??null,maximum:r.parameters?.maximum_turnover??null,basis:r.legal_review_status==='Pending'?'Provisional':'Held in the register'}:null;
  const one1=async(c:any)=>{
   const profiles=await tx`select * from erp_private.client_tax_profiles where client_id=${c.client_id} and status='Verified' and deleted_at is null and effective_from<=${asOf} and effective_to>=${asOf}`,profile=profiles.length===1?profiles[0]:null;
   const t=await clientTurnover(tx,c.client_id,start,end);
   return {client_id:c.client_id,company_name:c.company_name,regime:profile?.regime||null,...turnoverWatch({turnover:t.months?t.total:null,taxableSupplies:t.months?t.taxable:null,monthsCovered:t.months,profile,totRule,vatRule})};
  };
  const limits={vat_registration:limit(vatRule),tot_band:limit(totRule)};
  if(p.client_id){const c=one(await tx`select client_id,company_name from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null`);return {as_of:asOf,window:{start,end},limits,clients:[await one1(c)]};}
  const list=await tx`select client_id,company_name from erp_private.clients where deleted_at is null order by company_name limit 100`,out=[];
  for(const c of list)out.push(await one1(c));
  return {as_of:asOf,window:{start,end},limits,clients:out,truncated:list.length===100};
 }
 if(p.action==='tax_profile_save'){
  leader(a);const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);const clean=validateProfile(p),[from,to]=range(p.effective_from,p.effective_to);await linkedFirms(tx,cid,clean);
  if(p.profile_id){const old=one(await tx`select * from erp_private.client_tax_profiles where profile_id=${uuid(p.profile_id)} and client_id=${cid} for update`);current(old,p);if(old.status!=='Draft')fail(400,'Create a new non-overlapping profile period; verified versions cannot change.');
   await tx`update erp_private.client_tax_profiles set entity_type=${clean.entity_type},residency=${clean.residency},regime=${clean.regime},obligations=${tx.array(clean.obligations)},obligation_statuses=${tx.json(clean.obligation_statuses)},annual_turnover=${clean.annual_turnover},vat_taxable_supplies_status=${clean.vat_taxable_supplies_status},vat_taxable_supplies_12m=${clean.vat_taxable_supplies_12m},vat_threshold_checked_on=${clean.vat_threshold_checked_on},vat_threshold_evidence_reference=${clean.vat_threshold_evidence_reference||null},obligations_reviewed_by=null,obligations_reviewed_at=null,effective_from=${from},effective_to=${to},notes=${clean.notes} where profile_id=${old.profile_id}`;
  }else {const id=crypto.randomUUID();await tx`insert into erp_private.client_tax_profiles(profile_id,client_id,entity_type,residency,regime,obligations,obligation_statuses,annual_turnover,vat_taxable_supplies_status,vat_taxable_supplies_12m,vat_threshold_checked_on,vat_threshold_evidence_reference,effective_from,effective_to,notes,created_by) values(${id},${cid},${clean.entity_type},${clean.residency},${clean.regime},${tx.array(clean.obligations)},${tx.json(clean.obligation_statuses)},${clean.annual_turnover},${clean.vat_taxable_supplies_status},${clean.vat_taxable_supplies_12m},${clean.vat_threshold_checked_on},${clean.vat_threshold_evidence_reference||null},${from},${to},${clean.notes},${a.staff_id})`;return {profile_id:id};}return {ok:true};
 }
 if(p.action==='tax_profile_dependency_preview'){
  leader(a);const r=one(await tx`select * from erp_private.client_tax_profiles where profile_id=${uuid(p.profile_id)} and deleted_at is null`);current(r,p);if(r.status!=='Draft')fail(409,'Only a saved draft profile can be previewed before activation.');const clean=validateProfile(r);
  const versions=await tx`select version_id,version_label,status from erp_private.dependency_map_versions where status in ('Testing','Approved') and effective_from<=${r.effective_from} and (effective_to is null or effective_to>=${r.effective_to}) order by effective_from desc limit 2`;if(versions.length!==1)fail(409,'Exactly one released dependency-map version must cover this profile period.');
  const proposed=await tx`select distinct dependency_code,min(dependency_label) as label from erp_private.dependency_map_rules where version_id=${versions[0].version_id} and source_type='OBLIGATION' and source_code=any(${tx.array(clean.obligations)}::text[]) group by dependency_code order by dependency_code`;
  const existing=await tx`select distinct s.dependency_code,min(r.dependency_label) as label from erp_private.client_dependency_sources s join erp_private.dependency_map_rules r on r.version_id=s.version_id and r.source_type=s.source_type and r.source_code=s.source_code and r.dependency_code=s.dependency_code where s.client_id=${r.client_id} and s.effective_from<=${r.effective_to} and (s.effective_to is null or s.effective_to>=${r.effective_from}) group by s.dependency_code`;
  return {profile_id:r.profile_id,revision:r.revision,version:versions[0],obligations:clean.obligations,dependencies_to_add:proposed.filter((x:any)=>!existing.some((y:any)=>y.dependency_code===x.dependency_code)),dependencies_already_enabled:proposed.filter((x:any)=>existing.some((y:any)=>y.dependency_code===x.dependency_code)),period:{from:r.effective_from,to:r.effective_to}};
 }
 if(p.action==='tax_profile_statuses_save'){
  leader(a);fail(409,'Verified tax profiles and their obligation facts are immutable. Create a new dated profile version and have a different Manager or Partner review it.');
 }
 if(p.action==='tax_profile_verify'){
  leader(a);const r=one(await tx`select * from erp_private.client_tax_profiles where profile_id=${uuid(p.profile_id)} for update`);current(r,p);const clean=validateProfile(r);if(r.status!=='Draft')fail(400,'This profile is already verified.');if(r.created_by===a.staff_id)fail(403,'The person who prepared this profile cannot activate it. A different Manager or Partner must review the profile and its dependency preview.');if(p.confirm_obligations!==true)fail(400,'Confirm registration, residence, regime, iTax evidence and unresolved applicability items.');await linkedFirms(tx,r.client_id,clean);
  await tx`update erp_private.client_tax_profiles set status='Verified',verified_by=${a.staff_id},verified_at=now(),obligations_reviewed_by=${a.staff_id},obligations_reviewed_at=now() where profile_id=${r.profile_id}`;await saveProfileObligations(tx,a,r);await syncClientDependencyTasks(tx,a,r.client_id);return {ok:true};
 }
 if(p.action==='release_read'){
  if(a.category_code==='ADMIN')return {environment:'STAGING',automatic_checks:null,read_only:true,checks:await tx`select * from erp_private.release_checks order by check_code`,limits:['Client portal and external PBC links are not connected.','Full audit programmes and specialist tax regimes require separate implementation.','Email/SMS delivery, payment gateways and eTIMS submission are not connected.','Production MFA, backup/restore and agreed load tests require evidence before cutover.']};
  leader(a);const [counts]=await tx`select (select count(*) from erp_private.clients where deleted_at is null and cardinality(missing_fields)>0) incomplete_clients,(select count(*) from erp_private.clients c where c.deleted_at is null and not exists(select 1 from erp_private.client_tax_profiles p where p.client_id=c.client_id and p.status='Verified' and p.effective_from<=current_date and p.effective_to>=current_date)) clients_without_tax_profile,(select count(*) from erp_private.client_tax_profiles p where p.status='Verified' and p.deleted_at is null and (p.obligations_reviewed_at is null or jsonb_object_length(p.obligation_statuses)<cardinality(p.obligations))) client_profiles_needing_obligation_review,(select count(*) from erp_private.client_tax_profiles p where p.status='Verified' and p.deleted_at is null and p.regime='TOT' and (p.vat_taxable_supplies_status<>'CONFIRMED' or p.vat_taxable_supplies_12m is null or p.vat_threshold_checked_on is null or coalesce(p.vat_threshold_evidence_reference,'')='' or (p.vat_taxable_supplies_12m>=5000000 and (not ('VAT'=any(p.obligations)) or coalesce(p.obligation_statuses->'VAT'->>'registered','UNKNOWN')<>'YES' or coalesce(p.obligation_statuses->'VAT'->>'applicable','TO_CONFIRM')<>'YES' or coalesce(p.obligation_statuses->'VAT'->>'evidence_reference','')=''))) tot_vat_threshold_unresolved,(select count(*) from erp_private.tax_rates where deleted_at is null and status in('Draft','Testing') and catalog_source is not null) unapproved_catalogue_rates,(select count(*) from erp_private.firms where deleted_at is null and is_active and (kra_pin is null or vat_registered is null or coalesce(payment_instructions,'')='')) incomplete_firms,(select count(*) from erp_private.tasks where deleted_at is null and assigned_to is null) unassigned_tasks,(select count(*) from erp_private.client_setup_change_sets where status='Pending review') pending_activity_changes,(select count(*) from erp_private.dependency_map_versions where status='Testing' and effective_from<=current_date and (effective_to is null or effective_to>=current_date)) testing_dependency_map_versions,(select count(*) from erp_private.client_tax_profiles p where p.status='Verified' and p.deleted_at is null and (select count(*) from erp_private.client_tax_obligations o where o.profile_id=p.profile_id and o.is_selected) < cardinality(p.obligations)) verified_profiles_missing_dated_obligations,(select count(*) from erp_private.entity_type_conflicts() where problem not like 'tax profile%') entity_type_conflicts_with_legal_structure,(select count(*) from erp_private.entity_type_conflicts() where problem like 'tax profile%') tax_profile_type_differs_from_suggestion,(select count(*) from erp_private.ownership_status_all() where cardinality(issues)>0) ownership_register_gaps,erp_private.group_unassessed_count() clients_group_status_not_recorded,(select count(*) from erp_private.licence_summary_all() where state='Expired') licences_expired,(select count(*) from erp_private.licence_summary_all() where state='Expiring') licences_expiring,(select count(*) from erp_private.licence_summary_all() where state='Missing') expected_licences_missing,(select count(*) from erp_private.project_file_gaps()) projects_with_missing_required_items,(select count(*) from erp_private.service_references where rule_status='Suggested') service_references_unconfirmed,(select erp_private.aup_counts()) aup,(select erp_private.kra_counts()) kra,(select erp_private.incoming_counts()) incoming`;
  return {environment:'STAGING',automatic_checks:(({aup,kra,incoming,...rest}:any)=>({...rest,...(aup||{}),...(kra||{}),...(incoming||{})}))(counts),checks:await tx`select * from erp_private.release_checks order by check_code`,limits:['Client portal and external PBC links are not connected.','Full audit programmes and specialist tax regimes require separate implementation.','Email/SMS delivery, payment gateways and eTIMS submission are not connected.','Production MFA, backup/restore and agreed load tests require evidence before cutover.']};
 }
 if(p.action==='release_check_save'){
  partner(a);const r=one(await tx`select * from erp_private.release_checks where check_code=${text(p.check_code,40)}`);current(r,p);const status=choice(p.status,['Not tested','In progress','Passed','Blocked']),evidence=text(p.evidence||'',4000,false);if(status==='Passed'&&evidence.length<21)fail(400,'Record the test date, result and evidence location before marking Passed.');
  await tx`update erp_private.release_checks set status=${status},evidence=${evidence},reviewed_by=${a.staff_id},reviewed_at=now() where check_code=${r.check_code}`;return {ok:true};
 }
 return undefined;
}
