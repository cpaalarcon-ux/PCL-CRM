import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {syncClientDependencyTasks} from './dependency-tasks.ts';
import {number,day} from './suite-rules.mjs';
import {one,leader,today} from './suite-actions.ts';

// KYC evidence records (client_kyc_evidence) replace the five legacy document-link columns.
// One evidence record can cover several requirements. Upload, physical and online forms are supported.
// Before verification, edits are free. After verification, only a real change reopens review: it is
// written as a dated change version naming the changed items, and a different Manager or Partner
// verifies again (Gate A).
const KYC_FIELDS=['entity_type','risk_rating','is_pep','sanctions_date','sanctions_result','conflict_checked','review_due','notes'];
const LEGACY_DOCS:[string,string][]=[['incorporation_document','REGISTRATION_IDENTITY'],['pin_document','KRA_PIN'],['directors_document','DIRECTORS_CR12'],['members_document','REGISTER_MEMBERS'],['bo_document','BENEFICIAL_OWNERSHIP']];
const isoDay=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):null;
async function kycRules(tx:any){return await tx`select rule_code,label,accepted_forms,renewal_days,required_for_entities from erp_private.kyc_evidence_rules where rule_status<>'Retired' order by rule_code`;}
async function kycSnapshot(tx:any,cid:string){
 const compliance=(await tx`select entity_type,risk_rating,is_pep,sanctions_date,sanctions_result,conflict_checked,review_due,notes from erp_private.client_compliance where client_id=${cid}`)[0]||null;
 const evidence=await tx`select evidence_id,document_type,evidence_form,covered_items,document_id,document_reference,evidence_date,expires_on from erp_private.client_kyc_evidence where client_id=${cid} and deleted_at is null order by evidence_id`;
 const owners=await tx`select owner_id,full_name,ownership_percentage,control_basis from erp_private.beneficial_owners where client_id=${cid} and deleted_at is null order by owner_id`;
 return {compliance,evidence,owners};
}
async function kycChanged(tx:any,a:any,cid:string,before:any,changed:string[],reason:string){
 if(!changed.length)return null;
 await tx`update erp_private.client_compliance set last_edited_by=${a.staff_id} where client_id=${cid}`;
 const c=(await tx`select verified_by from erp_private.client_compliance where client_id=${cid} for update`)[0];
 if(!c?.verified_by)return null;
 await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':kyc-version'},0))`;
 const n=Number((await tx`select coalesce(max(version_number),0)::int as n from erp_private.client_kyc_change_versions where client_id=${cid}`)[0].n)+1;
 const after=await kycSnapshot(tx,cid);
 await tx`insert into erp_private.client_kyc_change_versions(client_id,version_number,before_snapshot,proposed_snapshot,changed_items,change_reason,recorded_by) values(${cid},${n},${tx.json(before)},${tx.json(after)},${tx.array(changed)},${reason.length>=3?reason:'KYC details updated'},${a.staff_id})`;
 await tx`update erp_private.client_compliance set verified_by=null,verified_at=null,edd_approved_by=null,edd_approved_at=null where client_id=${cid}`;
 return n;
}
function kycCurrent(e:any,rule:any,on:string){
 if(!rule.accepted_forms.includes(e.evidence_form))return false;
 if(e.expires_on&&isoDay(e.expires_on)!<on)return false;
 if(rule.renewal_days&&new Date(new Date(isoDay(e.evidence_date)+'T00:00:00Z').getTime()+rule.renewal_days*864e5).toISOString().slice(0,10)<on)return false;
 return true;
}
export function kycGaps(entityType:string,rules:any[],evidence:any[],on:string){
 return rules.filter((r:any)=>r.required_for_entities.includes(entityType||'Company')).filter((r:any)=>!evidence.some((e:any)=>(e.covered_items||[]).includes(r.rule_code)&&kycCurrent(e,r,on))).map((r:any)=>r.label);
}
async function addEvidence(tx:any,a:any,cid:string,p:any,rules:any[]){
 const type=choice(p.document_type,rules.map((r:any)=>r.rule_code)),rule=rules.find((r:any)=>r.rule_code===type),form=choice(p.evidence_form,['upload','physical','online']);
 if(!rule.accepted_forms.includes(form))fail(400,`${rule.label} cannot be evidenced by a ${form} record under the current KYC rule.`);
 const covered=[...new Set([type,...(Array.isArray(p.covered_items)?p.covered_items:[]).map((x:any)=>String(x))])];
 for(const x of covered)if(!rules.some((r:any)=>r.rule_code===x))fail(400,'Choose covered requirements from the KYC evidence list.');
 const evidenceDate=date(p.evidence_date),expires=date(p.expires_on);if(!evidenceDate||evidenceDate>today())fail(400,'Enter the evidence date (not in the future).');if(expires&&expires<evidenceDate)fail(400,'The expiry date cannot be before the evidence date.');
 let doc=null,ref=text(p.document_reference||'',200,false)||null,location=null,copy=null,onlineSource=null,onlineRef=null;
 if(form==='upload'){doc=uuid(p.document_id);one(await tx`select document_id from erp_private.documents where document_id=${doc} and client_id=${cid} and category='Permanent File' and is_locked`);}
 if(form==='physical'){ref=text(p.document_reference,200);location=text(p.physical_location,200);copy=choice(p.copy_type,['Original','Certified copy']);}
 if(form==='online'){onlineSource=text(p.online_source,200);onlineRef=text(p.online_reference,200);}
 return one(await tx`insert into erp_private.client_kyc_evidence(client_id,document_type,evidence_form,covered_items,document_id,document_reference,evidence_date,expires_on,physical_location,copy_type,sighted_by,sighted_at,online_source,online_reference,checked_by,checked_at,recorded_by)
  values(${cid},${type},${form},${tx.array(covered)},${doc},${ref},${evidenceDate},${expires},${location},${copy},${form==='physical'?a.staff_id:null},${form==='physical'?evidenceDate:null},${onlineSource},${onlineRef},${form==='online'?a.staff_id:null},${form==='online'?evidenceDate:null},${a.staff_id}) returning evidence_id,covered_items`);
}
export async function engagementAction(tx:any,a:any,p:any):Promise<any>{
 if(!['compliance_save','compliance_evidence_save','compliance_evidence_remove','compliance_verify','edd_approve','owner_add','engagement_read','engagement_save','engagement_save_activate','engagement_activate','engagement_finalize'].includes(p.action))return undefined;
 leader(a);
 if(p.action==='owner_add'){
  const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);const before=await kycSnapshot(tx,cid);
  await tx`insert into erp_private.beneficial_owners(client_id,full_name,identity_reference,kra_pin,ownership_percentage,control_basis) values(${cid},${text(p.full_name,160)},${text(p.identity_reference,100)},${text(p.kra_pin||'',11,false)||null},${number(p.ownership_percentage,0,100)},${text(p.control_basis,1000)})`;
  await kycChanged(tx,a,cid,before,['BENEFICIAL_OWNERSHIP'],text(p.change_reason||'',2000,false)||'Owner or controller added');return {ok:true};
 }
 if(p.action==='compliance_evidence_save'||p.action==='compliance_evidence_remove'){
  const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
  if(!(await tx`select client_id from erp_private.client_compliance where client_id=${cid}`).length)fail(400,'Save the client KYC profile first, then record its evidence.');
  const before=await kycSnapshot(tx,cid),rules=await kycRules(tx),reason=text(p.change_reason||'',2000,false);
  if(p.action==='compliance_evidence_save'){const row=await addEvidence(tx,a,cid,p,rules);await kycChanged(tx,a,cid,before,row.covered_items,reason||'Evidence added');return {ok:true,evidence_id:row.evidence_id};}
  const row=one(await tx`select * from erp_private.client_kyc_evidence where evidence_id=${uuid(p.evidence_id)} and client_id=${cid} and deleted_at is null for update`);
  if(String(row.revision)!==revision(p.revision))fail(409,'This evidence record changed. Refresh first.');
  await tx`update erp_private.client_kyc_evidence set deleted_at=now() where evidence_id=${row.evidence_id}`;
  await kycChanged(tx,a,cid,before,row.covered_items,reason||'Evidence removed');return {ok:true};
 }
 if(p.action==='compliance_save'){
  const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);const old=(await tx`select * from erp_private.client_compliance where client_id=${cid} for update`)[0];if(old&&String(old.revision)!==revision(p.revision))fail(409,'The compliance file changed. Refresh first.');
  const before=await kycSnapshot(tx,cid),inc=date(p.incorporation_date);if(inc&&inc>today())fail(400,'Incorporation date cannot be in the future.');
  const next:any={entity_type:choice(p.entity_type,['Company','Partnership','Sole proprietor','Other']),risk_rating:choice(p.risk_rating,['Low','Medium','High']),is_pep:p.is_pep===true,sanctions_date:date(p.sanctions_date),sanctions_result:text(p.sanctions_result||'',2000,false),conflict_checked:p.conflict_checked===true,review_due:date(p.review_due),notes:text(p.notes||'',4000,false)};
  const client=one(await tx`select incorporation_date,is_pie,sme_audit_exempt,audit_requested from erp_private.clients where client_id=${cid}`);
  const changed=KYC_FIELDS.filter(k=>{const was=old?.[k],now=next[k];return ['sanctions_date','review_due'].includes(k)?isoDay(was)!==now:String(was??'')!==String(now??'');});
  if(isoDay(client.incorporation_date)!==inc||client.is_pie!==(p.is_pie===true)||client.sme_audit_exempt!==(p.sme_audit_exempt===true)||client.audit_requested!==(p.audit_requested===true))changed.push('client_profile');
  await tx`update erp_private.clients set incorporation_date=${inc},is_pie=${p.is_pie===true},sme_audit_exempt=${p.sme_audit_exempt===true},audit_requested=${p.audit_requested===true} where client_id=${cid}`;
  await tx`insert into erp_private.client_compliance(client_id,entity_type,risk_rating,is_pep,sanctions_date,sanctions_result,conflict_checked,review_due,notes,last_edited_by)
   values(${cid},${next.entity_type},${next.risk_rating},${next.is_pep},${next.sanctions_date},${next.sanctions_result},${next.conflict_checked},${next.review_due},${next.notes},${a.staff_id})
   on conflict(client_id) do update set entity_type=excluded.entity_type,risk_rating=excluded.risk_rating,is_pep=excluded.is_pep,sanctions_date=excluded.sanctions_date,sanctions_result=excluded.sanctions_result,conflict_checked=excluded.conflict_checked,review_due=excluded.review_due,notes=excluded.notes`;
  // Legacy callers may still send document links; they become upload-form evidence records.
  const rules=await kycRules(tx);
  for(const [key,rule] of LEGACY_DOCS)if(p[key]){const doc=uuid(p[key]);if(!(await tx`select evidence_id from erp_private.client_kyc_evidence where client_id=${cid} and document_type=${rule} and document_id=${doc} and deleted_at is null`).length){const d=one(await tx`select uploaded_at from erp_private.documents where document_id=${doc} and client_id=${cid} and category='Permanent File' and is_locked`);await addEvidence(tx,a,cid,{document_type:rule,evidence_form:'upload',document_id:doc,evidence_date:isoDay(d.uploaded_at)},rules);changed.push(rule);}}
  if(!old)return {ok:true};
  const version=await kycChanged(tx,a,cid,before,changed,text(p.change_reason||'',2000,false)||('Updated: '+changed.join(', ')));
  return {ok:true,changed_items:changed,change_version:version};
 }
 if(p.action==='compliance_verify'||p.action==='edd_approve'){
  const c=one(await tx`select x.*,c.missing_fields from erp_private.client_compliance x join erp_private.clients c using(client_id) where client_id=${uuid(p.client_id)} for update of x`);
  if(String(c.revision)!==revision(p.revision))fail(409,'Compliance details changed. Refresh first.');
  if(p.action==='edd_approve'){if(a.category_code!=='PARTNER')fail(403,'Only the Engagement Partner may approve enhanced due diligence.');if(!c.verified_by)fail(400,'Verify the KYC file first.');await tx`update erp_private.client_compliance set edd_approved_by=${a.staff_id},edd_approved_at=now(),notes=notes||E'\nEDD: '||${text(p.reason,2000)} where client_id=${c.client_id}`;return {ok:true};}
  if(c.last_edited_by===a.staff_id)fail(403,'You made the latest KYC change. A different Manager or Partner must verify this file.');
  const pending=await tx`select version_id,recorded_by from erp_private.client_kyc_change_versions where client_id=${c.client_id} and status='Pending review' for update`;
  if(pending.some((v:any)=>v.recorded_by===a.staff_id))fail(403,'You recorded a pending KYC change. A different Manager or Partner must verify this file.');
  if(c.missing_fields.length||!c.conflict_checked||!c.sanctions_date||!c.sanctions_result||!c.review_due)fail(400,'Complete client fields, conflict review, screening and next review date.');
  const evidence=await tx`select * from erp_private.client_kyc_evidence where client_id=${c.client_id} and deleted_at is null`,gaps=kycGaps(c.entity_type,await kycRules(tx),evidence,today());
  if(gaps.length)fail(400,'Current KYC evidence is missing or expired for: '+gaps.join(', ')+'.');
  if(c.entity_type==='Company'&&!(await tx`select owner_id from erp_private.beneficial_owners where client_id=${c.client_id} and deleted_at is null`).length)fail(400,'Company KYC requires at least one beneficial owner or controller record.');
  await tx`update erp_private.client_kyc_change_versions set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${text(p.review_note||'',2000,false)||'Verified with the KYC file'} where client_id=${c.client_id} and status='Pending review'`;
  await tx`update erp_private.client_compliance set verified_by=${a.staff_id},verified_at=now() where client_id=${c.client_id}`;return {ok:true};
 }
 const project=one(await tx`select p.*,c.is_pie,c.primary_sector,c.sme_audit_exempt,c.audit_requested from erp_private.projects p join erp_private.clients c using(client_id) where project_id=${uuid(p.project_id)} for update of p`);
 const e=(await tx`select * from erp_private.engagement_controls where project_id=${project.project_id} for update`)[0];
 if(p.action==='engagement_read'){
  const k=(await tx`select * from erp_private.client_compliance where client_id=${project.client_id}`)[0];
  const iso=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
  const checks=[{label:'Current client KYC verified',ok:!!k?.verified_by&&!!k.review_due&&iso(k.review_due)>=today()},{label:'Enhanced due diligence (if required)',ok:!k?.is_pep&&k?.risk_rating!=='High'||!!k?.edd_approved_by},{label:'Signed engagement letter uploaded and verified',ok:!!e?.signed_letter_id&&!!e.letter_verified_by&&(!e.letter_expires_on||iso(e.letter_expires_on)>=today())}];
  if(project.service_code.startsWith('AUD-')&&project.sme_audit_exempt)checks.push({label:'Optional audit requested by client',ok:project.audit_requested});
  return {checks,is_audit:project.service_code.startsWith('AUD-'),controls:e||null};
 }
 if(p.action==='engagement_save_activate'){
  await engagementAction(tx,a,{...p,action:'engagement_save'});
  return await engagementAction(tx,a,{...p,action:'engagement_activate'});
 }
 if(p.action==='engagement_save'){
  if(e&&String(e.revision)!==revision(p.revision))fail(409,'Engagement controls changed. Refresh first.');if(e?.stage==='Finalized')fail(400,'The engagement is finalized.');
  const letter=p.signed_letter_id?uuid(p.signed_letter_id):null;if(letter)one(await tx`select document_id from erp_private.documents where document_id=${letter} and project_id=${project.project_id} and category='Signed Engagement Letters' and mime_type='application/pdf' and is_locked`);
  const isAudit=project.service_code.startsWith('AUD-'),required=isAudit&&(project.is_pie||['Financial Services','Public Sector'].includes(project.primary_sector)||p.eqr_required===true);
  const reviewer=isAudit&&p.eqr_reviewer_id?uuid(p.eqr_reviewer_id):null,clearance=isAudit&&p.eqr_document_id?uuid(p.eqr_document_id):null;
  const preservedClearance=clearance&&e?.eqr_document_id===clearance&&e?.eqr_reviewer_id===reviewer&&e?.eqr_cleared_by;
  if(clearance&&!preservedClearance){if(a.category_code!=='PARTNER')fail(403,'Only the Engagement Partner can record EQR clearance.');if(!reviewer||reviewer===a.staff_id)fail(400,'Choose an independent reviewer.');one(await tx`select staff_id from erp_private.assignment_candidates() where staff_id=${reviewer} and category_code in ('PARTNER','MANAGER') and firm_id=${project.handling_firm_id}`);
   if((await tx`select staff_id from erp_private.project_assignments where project_id=${project.project_id} and staff_id=${reviewer} and deleted_at is null`).length)fail(400,'The EQR reviewer must be independent of the engagement team.');
   one(await tx`select document_id from erp_private.documents where document_id=${clearance} and project_id=${project.project_id} and category in ('Current Year Audit','Final Reports')`);
  }
  await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by,letter_expires_on,stage,eqr_required,eqr_reviewer_id,eqr_document_id,eqr_cleared_by,notes)
   values(${project.project_id},${letter},${letter?a.staff_id:null},${date(p.letter_expires_on)},${choice(p.stage,isAudit?['Scoping','Proposal','Accepted','Planning','Fieldwork','Manager Review','EQR']:['Scoping','Proposal','Accepted','Planning','Fieldwork','Manager Review'])},${required},${reviewer},${clearance},${clearance?(preservedClearance?e.eqr_cleared_by:a.staff_id):null},${text(p.notes||'',4000,false)})
   on conflict(project_id) do update set signed_letter_id=excluded.signed_letter_id,letter_verified_by=excluded.letter_verified_by,letter_expires_on=excluded.letter_expires_on,stage=excluded.stage,eqr_required=excluded.eqr_required,eqr_reviewer_id=excluded.eqr_reviewer_id,eqr_document_id=excluded.eqr_document_id,eqr_cleared_by=excluded.eqr_cleared_by,notes=excluded.notes`;
  return {ok:true};
 }
 if(p.action==='engagement_activate'){
  if((await tx`select change_id from erp_private.client_setup_change_sets where client_id=${project.client_id} and status='Pending review' limit 1`).length)fail(400,'A client activity / dependency-map change is waiting for independent review. Complete that client setup review before activating the engagement.');
  const k=(await tx`select * from erp_private.client_compliance where client_id=${project.client_id}`)[0];
  const iso=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
  const [opening]=await tx`select c.opening_balance_status,s.starts_on from erp_private.clients c left join erp_private.project_schedules s on s.project_id=${project.project_id} and s.deleted_at is null where c.client_id=${project.client_id}`;
  if(opening.opening_balance_status!=='No opening balances'){
   const effectiveOn=opening.starts_on?iso(opening.starts_on):today();
   const posted=await tx`select j.journal_id from erp_private.ledger_journals j join erp_private.ledger_periods lp using(period_id)
    where lp.client_id=${project.client_id} and lp.starts_on<=${effectiveOn} and lp.ends_on>=${effectiveOn} and j.kind='Opening' and j.status='Posted' limit 1`;
   if(!posted.length)fail(400,'The project stays Draft until the opening TB for its financial year is independently posted. Create the client year, import and balance the staged TB, then have a different Manager or Partner post it.');
  }
  if(!k?.verified_by||!k.review_due||iso(k.review_due)<today())fail(400,'Verify the current client KYC file before activation. Open Clients → KYC / contacts.');
  if((k.is_pep||k.risk_rating==='High')&&!k.edd_approved_by)fail(400,'The Engagement Partner must approve enhanced due diligence.');
  if(!e?.signed_letter_id||!e.letter_verified_by||e.letter_expires_on&&iso(e.letter_expires_on)<today())fail(400,'Upload and verify a current signed engagement letter PDF, then save the engagement controls.');
  if(project.sme_audit_exempt&&project.service_code.startsWith('AUD-')&&!project.audit_requested)fail(400,'Confirm that the client has requested an optional audit before activating it.');
  await tx`update erp_private.projects set status='Active' where project_id=${project.project_id}`;await syncClientDependencyTasks(tx,a,project.client_id);
  const [generated]=await tx`select erp_private.generate_project_tasks(${project.project_id}::uuid) generated`;
  return {ok:true,project_status:'Active',generated:generated.generated};
 }
 if(p.action==='engagement_finalize'){
  if(project.tax_master&&(await tx`select project_id from erp_private.project_schedules where project_id=${project.project_id} and enabled and ends_on>=(now() at time zone 'Africa/Nairobi')::date and frequency<>'Once-off'`).length)fail(400,'Archive closed monthly periods from Projects & tasks. End or pause the ongoing service schedule before finalising the master engagement.');
  if(project.service_code.startsWith('AUD-')&&a.category_code!=='PARTNER')fail(403,'The Engagement Partner must finalize an audit engagement.');
  if(project.status!=='Active'||!e)fail(400,'Activate the engagement and complete its review controls first.');
  if(project.service_code.startsWith('AUD-')&&e.eqr_required&&(!e.eqr_document_id||!e.eqr_cleared_by))fail(400,'Independent EQR clearance is required.');
  if((await tx`select task_id from erp_private.tasks where project_id=${project.project_id} and status not in ('Completed','Cancelled') and deleted_at is null`).length)fail(400,'Complete or cancel outstanding engagement tasks first.');
  if(project.service_code.startsWith('AUD-')&&!(await tx`select document_id from erp_private.documents where project_id=${project.project_id} and category='Final Reports' and is_locked`).length)fail(400,'Upload the final signed report first.');
  await tx`update erp_private.engagement_controls set stage='Finalized',finalized_by=${a.staff_id},finalized_at=now() where project_id=${project.project_id}`;
  await tx`update erp_private.projects set status='Archived' where project_id=${project.project_id}`;return {ok:true};
 }
}
