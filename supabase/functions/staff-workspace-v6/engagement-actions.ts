import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {number,day} from './suite-rules.mjs';
import {one,leader,today} from './suite-actions.ts';
export async function engagementAction(tx:any,a:any,p:any):Promise<any>{
 if(!['compliance_save','compliance_verify','edd_approve','owner_add','engagement_read','engagement_save','engagement_save_activate','engagement_activate','engagement_finalize'].includes(p.action))return undefined;
 leader(a);
 if(p.action==='owner_add'){
  const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
  await tx`insert into erp_private.beneficial_owners(client_id,full_name,identity_reference,kra_pin,ownership_percentage,control_basis) values(${cid},${text(p.full_name,160)},${text(p.identity_reference,100)},${text(p.kra_pin||'',11,false)||null},${number(p.ownership_percentage,0,100)},${text(p.control_basis,1000)})`;
  await tx`update erp_private.client_compliance set verified_by=null,verified_at=null,edd_approved_by=null,edd_approved_at=null where client_id=${cid}`;return {ok:true};
 }
 if(p.action==='compliance_save'){
  const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);const old=(await tx`select * from erp_private.client_compliance where client_id=${cid} for update`)[0];if(old&&String(old.revision)!==revision(p.revision))fail(409,'The compliance file changed. Refresh first.');
  const docs:any={};for(const k of ['incorporation_document','pin_document','directors_document','members_document','bo_document']){docs[k]=p[k]?uuid(p[k]):null;if(docs[k])one(await tx`select document_id from erp_private.documents where document_id=${docs[k]} and client_id=${cid} and category='Permanent File' and is_locked`);}
  const inc=date(p.incorporation_date);if(inc&&inc>today())fail(400,'Incorporation date cannot be in the future.');
  await tx`update erp_private.clients set incorporation_date=${inc},is_pie=${p.is_pie===true},sme_audit_exempt=${p.sme_audit_exempt===true},audit_requested=${p.audit_requested===true} where client_id=${cid}`;
  await tx`insert into erp_private.client_compliance(client_id,entity_type,risk_rating,is_pep,sanctions_date,sanctions_result,conflict_checked,incorporation_document,pin_document,directors_document,members_document,bo_document,review_due,notes)
   values(${cid},${choice(p.entity_type,['Company','Partnership','Sole proprietor','Other'])},${choice(p.risk_rating,['Low','Medium','High'])},${p.is_pep===true},${date(p.sanctions_date)},${text(p.sanctions_result||'',2000,false)},${p.conflict_checked===true},${docs.incorporation_document},${docs.pin_document},${docs.directors_document},${docs.members_document},${docs.bo_document},${date(p.review_due)},${text(p.notes||'',4000,false)})
   on conflict(client_id) do update set entity_type=excluded.entity_type,risk_rating=excluded.risk_rating,is_pep=excluded.is_pep,sanctions_date=excluded.sanctions_date,sanctions_result=excluded.sanctions_result,conflict_checked=excluded.conflict_checked,incorporation_document=excluded.incorporation_document,pin_document=excluded.pin_document,directors_document=excluded.directors_document,members_document=excluded.members_document,bo_document=excluded.bo_document,review_due=excluded.review_due,notes=excluded.notes,verified_by=null,verified_at=null,edd_approved_by=null,edd_approved_at=null`;
  return {ok:true};
 }
 if(p.action==='compliance_verify'||p.action==='edd_approve'){
  const c=one(await tx`select x.*,c.missing_fields from erp_private.client_compliance x join erp_private.clients c using(client_id) where client_id=${uuid(p.client_id)} for update of x`);
  if(String(c.revision)!==revision(p.revision))fail(409,'Compliance details changed. Refresh first.');
  if(p.action==='edd_approve'){if(a.category_code!=='PARTNER')fail(403,'Only the Engagement Partner may approve enhanced due diligence.');if(!c.verified_by)fail(400,'Verify the KYC file first.');await tx`update erp_private.client_compliance set edd_approved_by=${a.staff_id},edd_approved_at=now(),notes=notes||E'\nEDD: '||${text(p.reason,2000)} where client_id=${c.client_id}`;return {ok:true};}
  if(c.missing_fields.length||!c.incorporation_document||!c.pin_document||!c.conflict_checked||!c.sanctions_date||!c.sanctions_result||!c.review_due)fail(400,'Complete client fields, identity/PIN evidence, conflict review, screening and next review date.');
  if(c.entity_type==='Company'&&(!c.directors_document||!c.members_document||!c.bo_document||!(await tx`select owner_id from erp_private.beneficial_owners where client_id=${c.client_id} and deleted_at is null`).length))fail(400,'Company KYC requires directors, members, beneficial-ownership evidence and at least one owner/controller record.');
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
  const k=(await tx`select * from erp_private.client_compliance where client_id=${project.client_id}`)[0];
  const iso=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
  if(!k?.verified_by||!k.review_due||iso(k.review_due)<today())fail(400,'Verify the current client KYC file before activation. Open Clients → KYC / contacts.');
  if((k.is_pep||k.risk_rating==='High')&&!k.edd_approved_by)fail(400,'The Engagement Partner must approve enhanced due diligence.');
  if(!e?.signed_letter_id||!e.letter_verified_by||e.letter_expires_on&&iso(e.letter_expires_on)<today())fail(400,'Upload and verify a current signed engagement letter PDF, then save the engagement controls.');
  if(project.sme_audit_exempt&&project.service_code.startsWith('AUD-')&&!project.audit_requested)fail(400,'Confirm that the client has requested an optional audit before activating it.');
  await tx`update erp_private.projects set status='Active' where project_id=${project.project_id}`;return {ok:true};
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
