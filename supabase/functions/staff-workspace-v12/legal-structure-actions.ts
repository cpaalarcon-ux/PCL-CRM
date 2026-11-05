import {fail,text} from './validation.mjs';
import {STRUCTURES,pairOk,familyFor} from './legal-structure.mjs';
const deny=():never=>fail(403,'You do not have access to this action.');
// Saves the Legal Structure + Subcategory chosen on Edit client. A first classification is open to anyone who can save the client;
// a change is for Managers and Partners, needs a reason, is audited, and never rewrites history: a change that would move the client to
// another accounting family is refused once the client has accounting records under the old one.
export async function applyLegalStructure(tx:any,a:any,cid:string,p:any,isNew:boolean){
 const structure=p.legal_structure?String(p.legal_structure):null,subtype=p.legal_subtype?String(p.legal_subtype):null;
 if(!structure&&!subtype){if(isNew)fail(400,'Choose the client’s Legal structure and Subcategory.');return {changed:false};}
 if(!structure||!STRUCTURES.includes(structure))fail(400,'Choose a Legal structure.');
 if(!subtype)fail(400,'Choose the Subcategory for this legal structure.');
 const types=await tx`select structure,subtype,engine_family from erp_private.legal_structure_types`;
 if(!pairOk(types,structure,subtype))fail(400,'That subcategory does not belong to the chosen legal structure.');
 const c=(await tx`select legal_structure,legal_subtype,legal_entity_type from erp_private.clients where client_id=${cid} for update`)[0];
 if(!c)deny();
 if(c.legal_structure===structure&&c.legal_subtype===subtype)return {changed:false};
 const family=familyFor(types,structure,subtype),revising=!!c.legal_structure&&!!c.legal_subtype;
 const note=text(p.legal_structure_reason||'',1000,false);
 if(revising){
  if(!['PARTNER','MANAGER'].includes(a.category_code))deny();
  if(note.length<10)fail(400,'Record why the legal structure is being changed (at least 10 characters).');
 }
 if(c.legal_entity_type&&family&&c.legal_entity_type!==family){
  const used=(await tx`select
   (select count(*) from erp_private.ledger_periods where client_id=${cid})::int as periods,
   (select count(*) from erp_private.client_chart_versions where client_id=${cid} and status='Approved')::int as charts,
   (select count(*) from erp_private.tax_cases t join erp_private.projects pr on pr.project_id=t.project_id where pr.client_id=${cid})::int as tax`)[0];
  if(used.periods||used.charts||used.tax)fail(409,`This client already has ledger, chart of accounts or tax records under ${c.legal_entity_type}. A change to ${family} would rewrite that history, so it needs a separate successor client. A change inside the same accounting family is allowed.`);
 }
 await tx`update erp_private.clients set legal_structure=${structure},legal_subtype=${subtype},legal_structure_note=${note},legal_structure_changed_by=${a.staff_id},legal_structure_changed_at=now(),
  legal_entity_type=${c.legal_entity_type&&family?family:c.legal_entity_type} where client_id=${cid}`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values)
  values(${a.auth_user_id},current_user,'clients','LEGAL_STRUCTURE_CHANGE',${cid},${tx.json({legal_structure:c.legal_structure,legal_subtype:c.legal_subtype,legal_entity_type:c.legal_entity_type})},${tx.json({legal_structure:structure,legal_subtype:subtype,accounting_family:family,reason:note,changed_by:a.staff_id})})`;
 return {changed:true,family};
}
