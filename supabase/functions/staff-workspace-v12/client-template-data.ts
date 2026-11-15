import {templateFor,evidenceRequirements,templateChecklist} from './client-template-rules.mjs';
// Reads what a client-type template needs from the existing records. Read only. Nothing is written and nothing is confirmed here.
export async function loadClientTemplate(tx:any,a:any,cid:string,facts:any[],client:any){
 const c=(await tx`select client_id,company_name,kra_pin,legal_entity_type,legal_structure,legal_subtype from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!c)return null;
 const map=await tx`select structure,subtype,template_code from erp_private.client_type_template_map`;
 const code=templateFor(c.legal_structure,c.legal_subtype,map);
 const tpl=code?(await tx`select template_code,name,controls,regulatory_overlay,requires_subtype,reclassify_if_formal,partner_classifies from erp_private.client_type_templates where template_code=${code}`)[0]:null;
 if(!tpl)return {client:c,template:null,checklist:null,structure:c.legal_structure||null,subtype:c.legal_subtype||null};
 const leader=['PARTNER','MANAGER'].includes(a.category_code);
 const fields=await tx`select field_key,requirement,sort_order,partner_verified from erp_private.client_template_fields where template_code=${code} and not retired order by sort_order,field_key`;
 const partyRules=await tx`select role,min_count,requirement,label from erp_private.client_template_parties where template_code=${code} order by role`;
 const holderRules=await tx`select kind,min_count,requirement,label,basis_hint from erp_private.client_template_holders where template_code=${code} order by kind`;
 const holders=await tx`select h.*,rb.full_name as recorded_by_name,vb.full_name as verified_by_name,d.file_name as document_name from erp_private.client_office_holders h left join erp_private.staff_members rb on rb.staff_id=h.recorded_by left join erp_private.staff_members vb on vb.staff_id=h.verified_by left join erp_private.documents d on d.document_id=h.document_id where h.client_id=${cid} and h.status<>'Ended' order by h.kind,h.recorded_at`;
 const partnerVerified=new Set(((await tx`select erp_private.client_partner_verified_fields(${cid}) as keys`)[0].keys)||[]);
 const reqRows=await tx`select subtype,rule_code,requirement,note,sort_order from erp_private.legal_structure_requirements where structure=${c.legal_structure} and subtype in('*',${c.legal_subtype||'*'}) and requirement<>'Permanent file'`;
 const labels=Object.fromEntries((await tx`select rule_code,label from erp_private.kyc_evidence_rules`).map((r:any)=>[r.rule_code,r.label]));
 let evidence:any[]=[],parties:any[]=[],licences:any[]=[],kycVerified=false;
 if(leader){
  evidence=await tx`select document_type,expires_on from erp_private.client_kyc_evidence where client_id=${cid} and deleted_at is null`;
  parties=await tx`select role,ceased_on,shareholding_percentage from erp_private.client_parties where client_id=${cid} and ceased_on is null`;
  licences=await tx`select licence_type,ended_on,expires_on from erp_private.client_licences where client_id=${cid} and ended_on is null`;
  const k=(await tx`select verified_by,review_due from erp_private.client_compliance where client_id=${cid} and deleted_at is null`)[0];
  kycVerified=!!k&&!!k.verified_by&&!!k.review_due&&String(k.review_due).slice(0,10)>=new Date().toISOString().slice(0,10);
 }
 const exp=tpl.regulatory_overlay&&c.legal_subtype?await tx`select e.type_code,t.label from erp_private.licence_expectations e join erp_private.licence_types t on t.type_code=e.type_code where e.structure=${c.legal_structure} and e.subtype=${c.legal_subtype} and e.rule_status<>'Retired'`:[];
 const checklist=templateChecklist({template:tpl.template_code,templateInfo:tpl,subtype:c.legal_subtype||null,fields,facts,master:{company_name:c.company_name,kra_pin:c.kra_pin},requirements:evidenceRequirements(c.legal_subtype,reqRows),ruleLabels:labels,evidence,kycVerified,parties,partyRules,holderRules,holders,partnerVerified,licenceExpectations:exp,licences,restricted:!leader});
 return {client:c,template:tpl,checklist,structure:c.legal_structure,subtype:c.legal_subtype||null,fields,holders,holderRules};
}
