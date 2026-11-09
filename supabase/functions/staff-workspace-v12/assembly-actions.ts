import {fail,text,uuid,choice} from './validation.mjs';
// S8: milestones with compare, assembly complete, late changes. The rules live in the database functions (erp_private.audit_milestone_*,
// audit_assembly_*, audit_amend_*); this file checks the input and passes it on. No retention period or deadline is fixed here.
export const MILESTONE_KINDS=['Planning complete','Fieldwork complete','Draft report issued','Other'];
export async function assemblyWorkspace(tx:any,fileId:string){return (await tx`select erp_private.audit_assembly_workspace(${fileId}::uuid) r`)[0].r;}
export async function assemblyAction(tx:any,a:any,p:any):Promise<any>{
 const act=String(p.action||'');
 if(!['audit_assembly_milestone_take','audit_assembly_compare','audit_assembly_seal','audit_amend_open','audit_amend_close'].includes(act))return undefined;
 const file=uuid(p.audit_file_id);
 if(act==='audit_assembly_milestone_take'){
  if(!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can take a milestone.');
  return (await tx`select erp_private.audit_milestone_take(${file}::uuid,${choice(p.kind,MILESTONE_KINDS)},${text(p.label,120)},${text(p.note||'',1000,false)}) r`)[0].r;
 }
 if(act==='audit_assembly_compare'){
  return (await tx`select erp_private.audit_milestone_compare(${file}::uuid,${uuid(p.a)}::uuid,${p.b?uuid(p.b):null}::uuid) r`)[0].r;
 }
 if(act==='audit_assembly_seal'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can record that assembly is complete.');
  return (await tx`select erp_private.audit_assembly_seal(${file}::uuid,${text(p.note,1000)}) r`)[0].r;
 }
 if(act==='audit_amend_open'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can open a late change.');
  return (await tx`select erp_private.audit_amend_open(${file}::uuid,${text(p.reason,1000)}) r`)[0].r;
 }
 if(!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can review and close a late change.');
 return (await tx`select erp_private.audit_amend_close(${file}::uuid,${text(p.note,1000)}) r`)[0].r;
}
