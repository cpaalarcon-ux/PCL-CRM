import {fail,uuid} from './validation.mjs';
import {declarationFields,practiceMode,templateGate,GROUP_ORDER,MAX_BATCH,retireFields,versionChanges,planVersion,retireGate,proposeGate,dateFields,datesGate,datesLine} from './practice-rules.mjs';
import {currentDates,noDates,recordDates} from './template-dates.ts';
import {nairobiDate} from './workspace-rules.mjs';
import {serviceTemplateAction} from './service-template-actions.ts';
import {attempt} from './bulk-setup-actions.ts';
// Build 2843: the firm's number of practitioners, and service categories (service templates) put forward and approved in bulk from one click form.
// Each template goes through the existing approve action in its own savepoint, so a bulk approval is exactly a series of single approvals under the signed-in person's own name.
// Tables and database guards are in 20261118110000_practice_size_and_template_submissions.sql.
// Build 2845: effective-from and last-reviewed dates (insert-only history, 20261118120000_service_template_dates.sql) can be recorded with an approval, with a new version, or on their own for several at once.
// Build 2844: the same form retires several categories (a Partner, one reason) or proposes a new version of several (common changes, applied wherever the task exists). Each goes through the existing single action in its own savepoint; nothing is approved here, a new version is a draft a different person approves.
const ACTIONS=['practice_read','practice_declare','service_category_read','service_category_submit','service_category_approve','service_category_retire','service_category_propose','service_category_dates'];
const LEADERS=['PARTNER','MANAGER'];
const day=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';

async function readTemplates(tx:any,a:any){
 const sole=a.category_code==='PARTNER'&&(await tx`select erp_private.sole_active_partner() as s`)[0]?.s===true;
 const rows=await tx`select t.template_id,t.template_code,t.version,t.name,t.service_group,t.source,t.status,t.revision,t.proposed_by,t.approved_by,t.approved_at,
   erp_private.staff_name(t.proposed_by) proposed_by_name,erp_private.staff_name(t.approved_by) approved_by_name,s.submitted_by,s.submitted_at,erp_private.staff_name(s.submitted_by) submitted_by_name,
   (select count(*)::int from erp_private.service_template_tasks k where k.template_id=t.template_id) tasks,
   coalesce((select json_agg(json_build_object('task_key',k.task_key,'task_name',k.task_name,'due_days',k.due_days,'mandatory',k.mandatory) order by k.sort_order) from erp_private.service_template_tasks k where k.template_id=t.template_id),'[]'::json) task_list,
   coalesce((select string_agg(x.service_code,', ' order by x.service_code) from erp_private.service_template_services x where x.template_id=t.template_id),'') services
   from erp_private.service_templates t left join erp_private.service_template_submissions s on s.template_id=t.template_id where t.status in('Draft','Approved') order by t.service_group,t.template_code,t.version desc`;
 const dates=await currentDates(tx);
 const drafts=new Set(rows.filter((t:any)=>t.status==='Draft').map((t:any)=>t.template_code));
 const out=rows.map((t:any)=>{
  const ret=retireGate(t,a),pro=proposeGate(t,a,drafts.has(t.template_code));
  const sub=templateGate('submit',{status:t.status,proposed_by:t.proposed_by,submitted_by:t.submitted_by},a,sole),app=templateGate('approve',{status:t.status,proposed_by:t.proposed_by,submitted_by:t.submitted_by},a,sole);
  return {template_id:t.template_id,template_code:t.template_code,version:t.version,name:t.name,service_group:t.service_group,source:t.source,status:t.status,revision:String(t.revision),tasks:t.tasks,services:t.services,
   proposed_by_name:t.proposed_by_name||null,submitted_by_name:t.submitted_by_name||null,submitted_at:t.submitted_at||null,approved_by_name:t.approved_by_name||null,approved_at:t.approved_at||null,
   waiting:t.status==='Draft'&&!!(t.proposed_by||t.submitted_by),can_submit:sub.ok,submit_problem:sub.ok?null:sub.problem,can_approve:app.ok,approve_problem:app.ok?null:app.problem,my_own:t.proposed_by===a.staff_id||t.submitted_by===a.staff_id,
   ...(dates.get(t.template_id)||noDates),dates_line:datesLine(dates.get(t.template_id)),can_retire:ret.ok,retire_problem:ret.ok?null:ret.problem,can_propose:pro.ok,propose_problem:pro.ok?null:pro.problem,task_list:t.task_list};
 });
 out.sort((x:any,y:any)=>GROUP_ORDER.indexOf(x.service_group)-GROUP_ORDER.indexOf(y.service_group)||x.template_code.localeCompare(y.template_code)||y.version-x.version);
 return {sole,can_retire:a.category_code==='PARTNER',templates:out};
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

 // Several at once. Every row is checked on its own, so one that cannot go ahead is listed with the reason and does not stop the others.
 const ids=Array.isArray(p.template_ids)?[...new Set(p.template_ids.map((x:any)=>uuid(x)))]:[];
 if(!ids.length)fail(400,'Tick at least one service category.');
 if(ids.length>MAX_BATCH)fail(400,`Tick up to ${MAX_BATCH} at a time.`);
 const kind=({service_category_submit:'submit',service_category_approve:'approve',service_category_retire:'retire',service_category_propose:'propose',service_category_dates:'dates'} as any)[p.action] as string;
 const dry=p.dry===true;
 let retire:any=null,changes:any=null,given:any=null;
 if(kind==='retire'){if(a.category_code!=='PARTNER')fail(403,'A Partner retires service categories.');const v=retireFields(p);if(v.problem)fail(400,v.problem);retire=v.values;}
 if(kind==='propose'){const v=versionChanges(p);if(v.problem)fail(400,v.problem);changes=v.changes;}
 // Dates: required for the dates action, optional with an approval or a new version (none given means none recorded).
 if(kind==='dates'||kind==='approve'||kind==='propose'){const v=dateFields(p,nairobiDate(),{required:kind==='dates'});if(v.problem)fail(400,v.problem);given=v.values;}
 if(!dry&&p.confirm!==true)fail(400,'Check the list and confirm.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':service-categories'},0))`;
 const {sole}=await readTemplates(tx,a);
 const results:any[]=[];
 for(const id of ids){
  const t=(await tx`select t.template_id,t.template_code,t.version,t.name,t.status,t.revision,t.proposed_by,(select s.submitted_by from erp_private.service_template_submissions s where s.template_id=t.template_id) submitted_by from erp_private.service_templates t where t.template_id=${id}`)[0];
  if(!t){results.push({template_id:id,label:'Unknown template',outcome:'Skipped',reason:'That service category was not found.'});continue;}
  const label=`${t.name} (version ${t.version})`;
  if(kind==='dates'){
   const g=datesGate(t,a);if(!g.ok){results.push({template_id:id,label,outcome:'Skipped',reason:g.problem});continue;}
   const r=await attempt(tx,!dry,async(s:any)=>{const o=await recordDates(s,a,id,given);if(!o.changed)fail(409,'Those dates are already recorded.');return o;});
   results.push(r.ok?{template_id:id,label,outcome:dry?'Ready':'Dates recorded',reason:null,note:datesLine(r.out.dates)}:{template_id:id,label,outcome:'Skipped',reason:r.reason});
   continue;
  }
  if(kind==='retire'||kind==='propose'){
   const open=kind==='propose'&&!!(await tx`select 1 from erp_private.service_templates where template_code=${t.template_code} and status='Draft'`)[0];
   const gate:any=kind==='retire'?retireGate(t,a):proposeGate(t,a,open);
   if(!gate.ok){results.push({template_id:id,label,outcome:'Skipped',reason:gate.problem});continue;}
   if(kind==='retire'){
    // Said before it happens, never a block: retiring the only approved version means new engagements can no longer use the category.
    const others=t.status==='Approved'?Number((await tx`select count(*)::int n from erp_private.service_templates where template_code=${t.template_code} and status='Approved' and template_id<>${id}`)[0].n):1;
    const used=Number((await tx`select count(*)::int n from erp_private.engagement_setups where template_id=${id}`)[0].n);
    const notes=[];if(t.status==='Approved'&&!others)notes.push('No approved version of this category will remain, so new engagements cannot use it until a new version is approved.');if(used)notes.push(`${used} engagement${used===1?'':'s'} already set up from it keep their tasks.`);
    const r=await attempt(tx,!dry,s=>serviceTemplateAction(s,a,{action:'service_template_retire',template_id:id,revision:String(t.revision),reason:retire.reason}));
    results.push(r.ok?{template_id:id,label,outcome:dry?'Ready':'Retired',reason:null,note:notes.join(' ')||null}:{template_id:id,label,outcome:'Skipped',reason:r.reason});
    continue;
   }
   const keys=(await tx`select task_key from erp_private.service_template_tasks where template_id=${id}`).map((k:any)=>String(k.task_key));
   const plan:any=planVersion(keys,t.name,changes);
   if(plan.problem){results.push({template_id:id,label,outcome:'Skipped',reason:plan.problem});continue;}
   const r=await attempt(tx,!dry,async s=>{const o=await serviceTemplateAction(s,a,{action:'service_template_propose',from_template_id:id,drop_task_keys:plan.drop,due_days:plan.due,mandatory:plan.mandatory,...(plan.name?{name:plan.name}:{})});if(given)await recordDates(s,a,o.template_id,given);return o;});
   const ign=plan.left.length?`Not in this category, left alone: ${plan.left.join(', ')}.`:null;
   results.push(r.ok?{template_id:id,label,outcome:dry?'Ready':'Proposed',reason:null,note:[`${plan.applies} change${plan.applies===1?'':'s'}`,given?'Dates: '+datesLine({effective_from:given.effective_from,last_reviewed:given.last_reviewed}):null,ign].filter(Boolean).join('. '),version:r.out?.version??null}:{template_id:id,label,outcome:'Skipped',reason:r.reason});
   continue;
  }
  const gate=templateGate(kind as any,t,a,sole);
  if(!gate.ok){results.push({template_id:id,label,outcome:'Skipped',reason:gate.problem});continue;}
  const r=await attempt(tx,!dry,async(s:any)=>{
   if(kind==='submit'){const note=typeof p.note==='string'&&p.note.trim()?p.note.trim().slice(0,500):null;await s`insert into erp_private.service_template_submissions(template_id,submitted_by,note) values(${id},${a.staff_id},${note})`;return {};}
   const o=await serviceTemplateAction(s,a,{action:'service_template_approve',template_id:id,revision:String(t.revision)});
   if(given)await recordDates(s,a,id,given);
   return o;
  });
  results.push(r.ok?{template_id:id,label,outcome:dry?'Ready':kind==='submit'?'Put forward':'Approved',reason:null,sole_approval:!!(gate as any).sole_approval,note:kind==='approve'&&given?'Dates: '+datesLine({effective_from:given.effective_from,last_reviewed:given.last_reviewed}):null}:{template_id:id,label,outcome:'Skipped',reason:r.reason});
 }
 const good=results.filter((x:any)=>x.outcome!=='Skipped').length;
 return {dry,kind,results,summary:{total:results.length,done:good,skipped:results.length-good,sole:results.filter((x:any)=>x.sole_approval).length}};
}
