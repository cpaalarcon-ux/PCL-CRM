import {fail,text,uuid,choice} from './validation.mjs';
// S6: SACCO audit pack (programme, compliance register, matters communicated and key audit matters). The rules live in the database
// functions (erp_private.pack_*); this file checks the input and passes it on. No regulatory figure is fixed here.
export const NATURES=['Audit reporting matter','Governance - not audit reporting','AML/CFT/CPF','Regulatory return','Other'];
export const APPLIES=['DT_SACCO','NWDT_SACCO','ALL_SACCO'];
export const RESULTS=['Complied','Not complied','Not applicable'];
export const EFFECTS=['None','Management letter','Statutory report','Matter for those charged with governance'];
export const METHODS=['Meeting','Letter','Email','Written report'];
export const REPORT_KINDS=['Statutory report to regulator','Key audit matters'];
const list=(v:any,allowed:string[],label:string):string[]=>{if(v==null||v==='')return [];if(!Array.isArray(v)||v.length>6)fail(400,`${label} must be a short list.`);return v.map((x:any)=>choice(String(x),allowed));};
export async function packWorkspace(tx:any,fileId:string){return (await tx`select erp_private.pack_workspace(${fileId}::uuid) r`)[0].r;}
export async function packAction(tx:any,a:any,p:any):Promise<any>{
 const act=String(p.action||'');
 if(!act.startsWith('audit_pack_'))return undefined;
 const leader=()=>{if(!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can do this.');};
 const partner=()=>{if(a.category_code!=='PARTNER')fail(403,'Only a Partner can do this.');};
 const file=()=>uuid(p.audit_file_id);
 if(act==='audit_pack_programme_copy'){leader();return {ok:true,programme_id:(await tx`select erp_private.pack_programme_copy(${text(p.code,31)}) id`)[0].id};}
 if(act==='audit_pack_step_save'){
  leader();const s=p.step||{};const so=Number(s.sort_order);if(!Number.isInteger(so)||so<0||so>100000)fail(400,'Enter the order number as a whole number.');
  const data={step_code:text(String(s.step_code||'').toUpperCase(),34),audit_area:text(s.audit_area,120),assertion:text(s.assertion,120),procedure:text(s.procedure,2000),required:s.required!==false&&s.required!=='false',reference_code:text(s.reference_code||'',61,false),sort_order:so};
  if(!/^[A-Z]{1,3}\.[A-Z0-9_]{2,30}$/.test(data.step_code))fail(400,'The step code looks like L.LEDGER: letters, a dot, then letters, digits or underscores.');
  return (await tx`select erp_private.pack_programme_step_save(${uuid(p.programme_id)}::uuid,${tx.json(data)}::jsonb) r`)[0].r;
 }
 if(act==='audit_pack_step_remove'){leader();return (await tx`select erp_private.pack_programme_step_remove(${uuid(p.programme_id)}::uuid,${text(p.step_code,40)}) r`)[0].r;}
 if(act==='audit_pack_programme_approve'){partner();return (await tx`select erp_private.pack_programme_approve(${uuid(p.programme_id)}::uuid,${text(p.note||'',1000,false)}) r`)[0].r;}
 if(act==='audit_pack_programme_adopt')return (await tx`select erp_private.pack_programme_adopt(${file()}::uuid,${uuid(p.programme_id)}::uuid) r`)[0].r;
 if(act==='audit_pack_step_prepare')return (await tx`select erp_private.pack_step_prepare(${file()}::uuid,${uuid(p.programme_id)}::uuid,${text(p.step_code,40)},${p.applicable!==false&&p.applicable!=='false'},${text(p.note||'',2000,false)},${p.audit_workpaper_id?uuid(p.audit_workpaper_id):null}::uuid) r`)[0].r;
 if(act==='audit_pack_step_review'){leader();return (await tx`select erp_private.pack_step_review(${file()}::uuid,${uuid(p.programme_id)}::uuid,${text(p.step_code,40)},${choice(p.decision,['Accept','Return'])==='Accept'},${text(p.note||'',1000,false)}) r`)[0].r;}
 if(act==='audit_pack_item_save'){
  leader();const i=p.item||{};const so=i.sort_order===undefined||i.sort_order===''?100:Number(i.sort_order);if(!Number.isInteger(so)||so<0||so>100000)fail(400,'Enter the order number as a whole number.');
  const data={item_code:text(String(i.item_code||'').toUpperCase(),41),title:text(i.title,200),requirement:text(i.requirement,2000),citation:text(i.citation||'',300,false),reference_code:text(i.reference_code||'',61,false),
   applies_to:list(i.applies_to,APPLIES,'Applies to'),nature:choice(i.nature,NATURES),sort_order:so};
  if(!data.applies_to.length)data.applies_to=['ALL_SACCO'];
  if(!/^[A-Z0-9][A-Z0-9_.-]{2,40}$/.test(data.item_code))fail(400,'The item code uses letters, digits, dots, dashes or underscores (3 to 41 characters).');
  return (await tx`select erp_private.pack_compliance_item_save(${tx.json(data)}::jsonb) r`)[0].r;
 }
 if(act==='audit_pack_item_approve'){partner();return (await tx`select erp_private.pack_compliance_item_approve(${uuid(p.item_id)}::uuid,${text(p.note||'',1000,false)}) r`)[0].r;}
 if(act==='audit_pack_compliance_adopt')return (await tx`select erp_private.pack_compliance_adopt(${file()}::uuid) r`)[0].r;
 if(act==='audit_pack_compliance_prepare'){
  const result=choice(p.result,RESULTS),effect=result==='Not complied'?choice(p.effect,EFFECTS.slice(1)):'None';
  return (await tx`select erp_private.pack_compliance_prepare(${file()}::uuid,${uuid(p.item_id)}::uuid,${result},${effect},${text(p.note||'',2000,false)}) r`)[0].r;
 }
 if(act==='audit_pack_compliance_review'){leader();return (await tx`select erp_private.pack_compliance_review(${file()}::uuid,${uuid(p.item_id)}::uuid,${choice(p.decision,['Accept','Return'])==='Accept'},${text(p.note||'',1000,false)}) r`)[0].r;}
 if(act==='audit_pack_matter_save'){
  const m=p.matter||{};const data={title:text(m.title,200),description:text(m.description,3000),communicated_on:m.communicated_on,method:choice(m.method,METHODS),communicated_to:text(m.communicated_to,200),response:text(m.response||'',2000,false)};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(data.communicated_on||'')))fail(400,'Enter the date the matter was communicated.');
  return (await tx`select erp_private.pack_matter_save(${file()}::uuid,${p.matter_id?uuid(p.matter_id):null}::uuid,${tx.json(data)}::jsonb) r`)[0].r;
 }
 if(act==='audit_pack_matter_withdraw')return (await tx`select erp_private.pack_matter_withdraw(${uuid(p.matter_id)}::uuid,${text(p.note||'',1000,false)}) r`)[0].r;
 if(act==='audit_pack_kam_decide'){
  partner();const k=p.decision_data||{};const data={decision:choice(k.decision,['KAM','Not a KAM']),significance_note:text(k.significance_note||'',3000,false),heading:text(k.heading||'',200,false),how_addressed:text(k.how_addressed||'',3000,false),draft_text:text(k.draft_text||'',5000,false)};
  return (await tx`select erp_private.pack_kam_decide(${uuid(p.matter_id)}::uuid,${tx.json(data)}::jsonb) r`)[0].r;
 }
 fail(400,'Unknown SACCO audit pack action.');
}
