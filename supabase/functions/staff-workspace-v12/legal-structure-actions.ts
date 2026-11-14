import {fail,text,uuid,HttpError} from './validation.mjs';
import {STRUCTURES,pairOk,pairRetired,familyFor} from './legal-structure.mjs';
const deny=():never=>fail(403,'You do not have access to this action.');
// Saves the Legal Structure + Subcategory chosen on Edit client. A first classification is open to anyone who can save the client;
// a change is for Managers and Partners, needs a reason, is audited, and never rewrites history: a change that would move the client to
// another accounting family is refused once the client has accounting records under the old one.
export async function applyLegalStructure(tx:any,a:any,cid:string,p:any,isNew:boolean){
 const structure=p.legal_structure?String(p.legal_structure):null,subtype=p.legal_subtype?String(p.legal_subtype):null;
 if(!structure&&!subtype){if(isNew)fail(400,'Choose the client’s Legal structure and Subcategory.');return {changed:false};}
 if(!structure||!STRUCTURES.includes(structure))fail(400,'Choose a Legal structure.');
 if(!subtype)fail(400,'Choose the Subcategory for this legal structure.');
 const types=await tx`select structure,subtype,engine_family,retired from erp_private.legal_structure_types`;
 if(!pairOk(types,structure,subtype))fail(400,'That subcategory does not belong to the chosen legal structure.');
 const c=(await tx`select legal_structure,legal_subtype,legal_entity_type from erp_private.clients where client_id=${cid} for update`)[0];
 if(!c)deny();
 if(c.legal_structure===structure&&c.legal_subtype===subtype)return {changed:false};
 if(pairRetired(types,structure,subtype))fail(400,'That subcategory is retired. Choose Deposit-taking SACCO, Non-withdrawable-deposit-taking SACCO or another current subcategory.');
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
 // The KYC checklist depends on the structure, so a verified file goes back for re-verification.
 await tx`update erp_private.client_compliance set verified_by=null,verified_at=null,notes=notes||${'\nLegal structure changed to '+structure+' · '+subtype+'; KYC needs re-verification.'} where client_id=${cid} and verified_by is not null`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values)
  values(${a.auth_user_id},current_user,'clients','LEGAL_STRUCTURE_CHANGE',${cid},${tx.json({legal_structure:c.legal_structure,legal_subtype:c.legal_subtype,legal_entity_type:c.legal_entity_type})},${tx.json({legal_structure:structure,legal_subtype:subtype,accounting_family:family,reason:note,changed_by:a.staff_id})})`;
 return {changed:true,family};
}

// Gates. A client must be classified (structure AND subcategory) before accounting work starts, and the accounting work that
// builds on the structure (draft project, client year, opening TB) waits for an approved chart of accounts for that family.
export async function requireClassified(tx:any,cid:string,what:string){
 const c=(await tx`select legal_structure,legal_subtype,legal_entity_type from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!c)fail(403,'This record is not available to your account.');
 if(!c.legal_structure||!c.legal_subtype)fail(400,`Set the client’s Legal structure and Subcategory in Edit client before ${what}. They decide the accounting family, checklists and chart of accounts.`);
 return c;
}
export async function requireRightChart(tx:any,cid:string,what:string){
 const c=await requireClassified(tx,cid,what);
 const types=await tx`select structure,subtype,engine_family from erp_private.legal_structure_types`,family=familyFor(types,c.legal_structure,c.legal_subtype);
 if(!c.legal_entity_type)fail(400,`Confirm the client’s legal entity type and evidence under Entity / activities before ${what}.`);
 if(family&&c.legal_entity_type!==family)fail(409,`The client’s accounting family (${c.legal_entity_type}) does not match its Legal structure (${family}). Confirm it under Entity / activities before ${what}.`);
 const chart=(await tx`select version_id from erp_private.client_chart_versions where client_id=${cid} and status='Approved' and entity_type=${c.legal_entity_type} limit 1`)[0];
 if(!chart)fail(409,`The chart of accounts for this ${c.legal_entity_type} client is not approved yet. Open Client accounts → Chart of accounts, propose it and have an independent Manager or Partner approve it before ${what}.`);
 return c;
}

// Bulk "Classify clients": a Manager or Partner sets the Legal structure and Subcategory of many unclassified clients at once.
// All or nothing, one audit entry per client (same as the single edit); a failure names the client that caused it.
export async function classifyClientsAction(tx:any,a:any,p:any){
 if(!['PARTNER','MANAGER'].includes(a.category_code))deny();
 const items=Array.isArray(p.items)?p.items:[];
 if(items.length>100)fail(400,'Classify at most 100 clients at a time.');
 const note=text(p.note||'',1000,false),seen=new Set<string>();let done=0;
 for(const it of items){
  if(!it?.legal_structure&&!it?.legal_subtype)continue;
  const cid=uuid(it.client_id);if(seen.has(cid))continue;seen.add(cid);
  const name=(await tx`select company_name from erp_private.clients where client_id=${cid} and deleted_at is null`)[0]?.company_name;
  if(!name)fail(403,'A client in the list is not available to your account.');
  const c=(await tx`select legal_structure,legal_subtype from erp_private.clients where client_id=${cid}`)[0];
  if(c?.legal_structure&&c?.legal_subtype)fail(409,`${name} is already classified. Change it from Edit client, with a reason.`);
  try{const r=await applyLegalStructure(tx,a,cid,{legal_structure:it.legal_structure,legal_subtype:it.legal_subtype,legal_structure_reason:note},false);if(r.changed)done++;}
  catch(e:any){if(e instanceof HttpError)throw new HttpError(e.status,`${name}: ${e.message}`);throw e;}
 }
 if(!done)fail(400,'Choose a Legal structure and Subcategory for at least one client.');
 return {ok:true,classified:done};
}
