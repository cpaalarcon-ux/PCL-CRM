import {fail,uuid} from './validation.mjs';
import {declarationFields,practiceMode,templateGate,GROUP_ORDER} from './practice-rules.mjs';
import {serviceTemplateAction} from './service-template-actions.ts';
import {attempt} from './bulk-setup-actions.ts';
// Build 2843: the firm's number of practitioners, and service categories (service templates) put forward and approved in bulk from one click form.
// Each template goes through the existing approve action in its own savepoint, so a bulk approval is exactly a series of single approvals under the signed-in person's own name.
// Tables and database guards are in 20261118110000_practice_size_and_template_submissions.sql.
const ACTIONS=['practice_read','practice_declare','service_category_read','service_category_submit','service_category_approve'];
const LEADERS=['PARTNER','MANAGER'];
const MAX_BATCH=50;
const day=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';

async function readTemplates(tx:any,a:any){
 const sole=a.category_code==='PARTNER'&&(await tx`select erp_private.sole_active_partner() as s`)[0]?.s===true;
 const rows=await tx`select t.template_id,t.template_code,t.version,t.name,t.service_group,t.source,t.status,t.revision,t.proposed_by,t.approved_by,t.approved_at,
   erp_private.staff_name(t.proposed_by) proposed_by_name,erp_private.staff_name(t.approved_by) approved_by_name,s.submitted_by,s.submitted_at,erp_private.staff_name(s.submitted_by) submitted_by_name,
   (select count(*)::int from erp_private.service_template_tasks k where k.template_id=t.template_id) tasks,
   coalesce((select string_agg(x.service_code,', ' order by x.service_code) from erp_private.service_template_services x where x.template_id=t.template_id),'') services
   from erp_private.service_templates t left join erp_private.service_template_submissions s on s.template_id=t.template_id where t.status in('Draft','Approved') order by t.service_group,t.template_code,t.version desc`;
 const out=rows.map((t:any)=>{
  const sub=templateGate('submit',{status:t.status,proposed_by:t.proposed_by,submitted_by:t.submitted_by},a,sole),app=templateGate('approve',{status:t.status,proposed_by:t.proposed_by,submitted_by:t.submitted_by},a,sole);
  return {template_id:t.template_id,template_code:t.template_code,version:t.version,name:t.name,service_group:t.service_group,source:t.source,status:t.status,revision:String(t.revision),tasks:t.tasks,services:t.services,
   proposed_by_name:t.proposed_by_name||null,submitted_by_name:t.submitted_by_name||null,submitted_at:t.submitted_at||null,approved_by_name:t.approved_by_name||null,approved_at:t.approved_at||null,
   waiting:t.status==='Draft'&&!!(t.proposed_by||t.submitted_by),can_submit:sub.ok,submit_problem:sub.ok?null:sub.problem,can_approve:app.ok,approve_problem:app.ok?null:app.problem,my_own:t.proposed_by===a.staff_id||t.submitted_by===a.staff_id};
 });
 out.sort((x:any,y:any)=>GROUP_ORDER.indexOf(x.service_group)-GROUP_ORDER.indexOf(y.service_group)||x.template_code.localeCompare(y.template_code)||y.version-x.version);
 return {sole,templates:out};
}

export async function practiceTemplateAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner works with the firm\'s service categories.');

 if(p.action==='practice_read'){
  const firms=await tx`select f.firm_id,f.legal_name from erp_private.firms f where f.deleted_at is null and erp_private.firm_allowed(f.firm_id) order by f.legal_name`;
  const out=[];
  for(const f of firms){
   const partners=(await tx`select erp_private.firm_active_partners(${f.firm_id}) n`)[0].n??0;
   const hist=await tx`select d.practitioners,d.reason,d.declared_at,erp_private.staff_name(d.declared_by) declared_by_name from erp_private.firm_practice_declarations d where d.firm_id=${f.firm_id} order by d.declared_at desc,d.declaration_id desc limit 10`;
   const cur=hist[0]||null,mode=practiceMode(cur?.practitioners,partners);
   out.push({firm_id:f.firm_id,legal_name:f.legal_name,active_partners:partners,declared:cur?{practitioners:cur.practitioners,reason:cur.reason,declared_at:cur.declared_at,declared_by_name:cur.declared_by_name}:null,mode:mode.mode,mode_label:mode.label,history:hist.map((h:any)=>({practitioners:h.practitioners,reason:h.reason,declared_at:h.declared_at,declared_by_name:h.declared_by_name})),can_declare:a.category_code==='PARTNER'});
  }
  return {firms:out,note:'One practitioner: a Partner may put forward and approve service categories alone, recorded as a sole-Partner approval. Two or more: one person puts them forward and a different Partner or Manager approves.'};
 }
 if(p.action==='practice_declare'){
  if(a.category_code!=='PARTNER')fail(403,'A Partner declares the number of practitioners.');
  const v=declarationFields(p);if(v.problem)fail(400,v.problem);
  const f=(await tx`select firm_id from erp_private.firms where firm_id=${v.values.firm_id} and deleted_at is null and erp_private.firm_allowed(firm_id)`)[0];if(!f)fail(403,'This firm is unavailable to your account.');
  const same=(await tx`select practitioners from erp_private.firm_practice_declarations where firm_id=${f.firm_id} order by declared_at desc,declaration_id desc limit 1`)[0];
  if(same&&same.practitioners===v.values.practitioners)fail(409,'That is already the declared number. Declare again only when it changes.');
  const made=(await tx`insert into erp_private.firm_practice_declarations(firm_id,practitioners,reason,declared_by) values(${f.firm_id},${v.values.practitioners},${v.values.reason},${a.staff_id}) returning declaration_id`)[0];
  return {declared:true,declaration_id:made.declaration_id};
 }
 if(p.action==='service_category_read')return await readTemplates(tx,a);

 // Put forward / approve several at once.
 const ids=Array.isArray(p.template_ids)?[...new Set(p.template_ids.map((x:any)=>uuid(x)))]:[];
 if(!ids.length)fail(400,'Tick at least one service category.');
 if(ids.length>MAX_BATCH)fail(400,`Tick up to ${MAX_BATCH} at a time.`);
 const kind=p.action==='service_category_submit'?'submit':'approve';
 const dry=p.dry===true;
 if(!dry&&p.confirm!==true)fail(400,'Check the list and confirm.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':service-categories'},0))`;
 const {sole}=await readTemplates(tx,a);
 const results=[];
 for(const id of ids){
  const t=(await tx`select t.template_id,t.template_code,t.version,t.name,t.status,t.revision,t.proposed_by,(select s.submitted_by from erp_private.service_template_submissions s where s.template_id=t.template_id) submitted_by from erp_private.service_templates t where t.template_id=${id}`)[0];
  if(!t){results.push({template_id:id,label:'Unknown template',outcome:'Skipped',reason:'That service category was not found.'});continue;}
  const label=`${t.name} (version ${t.version})`;
  const gate=templateGate(kind,t,a,sole);
  if(!gate.ok){results.push({template_id:id,label,outcome:'Skipped',reason:gate.problem});continue;}
  const r=await attempt(tx,!dry,async(s:any)=>{
   if(kind==='submit'){const note=typeof p.note==='string'&&p.note.trim()?p.note.trim().slice(0,500):null;await s`insert into erp_private.service_template_submissions(template_id,submitted_by,note) values(${id},${a.staff_id},${note})`;return {};}
   return await serviceTemplateAction(s,a,{action:'service_template_approve',template_id:id,revision:String(t.revision)});
  });
  results.push(r.ok?{template_id:id,label,outcome:dry?'Ready':kind==='submit'?'Put forward':'Approved',reason:null,sole_approval:!!(gate as any).sole_approval}:{template_id:id,label,outcome:'Skipped',reason:r.reason});
 }
 const good=results.filter((x:any)=>x.outcome!=='Skipped').length;
 return {dry,kind,results,summary:{total:results.length,done:good,skipped:results.length-good,sole:results.filter((x:any)=>x.sole_approval).length}};
}
