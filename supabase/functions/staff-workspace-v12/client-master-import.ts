import {fail} from './validation.mjs';
import {FIELDS,cleanValue} from './client-master-rules.mjs';
// Bulk import of client master facts (build 2808). Every value in the workbook is recorded as a fact whose source is "Import" with the file and row,
// so the firm types nothing twice. An imported fact is only Recorded: a different Supervisor, Manager or Partner still verifies it against a real source.
// An existing fact is never overwritten by an import, and an invalid value rejects that row with the field named.
export const FACT_IMPORT_KEYS=FIELDS.map((f:any)=>f.key).filter((k:string)=>!['company_name','kra_pin'].includes(k));
export async function importFacts(tx:any,a:any,clientId:string,values:any,fileName:string,rowNo:number){
 let recorded=0,kept=0;
 for(const f of FIELDS as any[]){
  const raw=values[f.key];if(raw===undefined||raw===null||String(raw).trim()==='')continue;
  const clean=cleanValue(f.key,raw);if(!clean.ok)fail(400,clean.error);
  const live=(await tx`select 1 from erp_private.client_field_facts where client_id=${clientId} and field_key=${f.key} and status<>'Superseded'`).length;
  if(live){kept++;continue;}
  await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,source_reference,recorded_by) values(${clientId},${f.key},${clean.value},'Import',${(fileName+' row '+rowNo).slice(0,300)},${a.staff_id})`;
  recorded++;
 }
 if(recorded)await tx`insert into erp_private.client_setup_milestones(client_id,milestone,reached_by,detail) values(${clientId},'Started',${a.staff_id},${tx.json({first_field:'import',file:fileName})}) on conflict do nothing`;
 return {recorded,kept};
}
