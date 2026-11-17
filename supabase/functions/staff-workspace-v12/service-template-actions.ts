import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {defaultProjectName,nairobiDate} from './workspace-rules.mjs';
import {assign,projectTaskGate,requireProjectSetup} from './workspace-actions.ts';
import {requireRightChart} from './legal-structure-actions.ts';
import {loadClientTemplate} from './client-template-data.ts';
import {allowedObligations} from './obligation-check-actions.ts';
import {planTasks,periodProblem,taskKey,lateCount,OWNER_ROLES,evidencePath,folderSummary} from './engagement-setup-rules.mjs';
import {nextPeriod,carriedItems,dueForRollover} from './engagement-rollover-rules.mjs';
import {dateWarnings} from './practice-rules.mjs';
import {currentDates,noDates} from './template-dates.ts';
import {amlServiceScope,raiseAmlServiceFlag} from './aml-actions.ts';
// Service templates and engagement set-up (build 2810). The client type never selects a service: a Manager or Partner chooses the service, period,
// scope, responsible person and reviewer, and only then are tasks made, only those whose conditions the client's confirmed profile meets.
// The table rules are repeated in 20261115130000_client_and_service_templates.sql.
const ACTIONS=['client_template_read','client_template_list','service_template_list','service_template_propose','service_template_approve','service_template_retire','engagement_setup_options','engagement_setup_plan','engagement_setup_apply','engagement_setup_release','engagement_setup_list','engagement_rollover_due','engagement_rollover_plan','engagement_rollover_apply','engagement_folder_read'];
const day=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';
const GROUPS=['Tax Compliance','Accounting and Bookkeeping','Payroll','Audit and Assurance','Advisory and Other'];
const LEADERS=['PARTNER','MANAGER'];
const EDITORS=['PARTNER','MANAGER','SUPERVISOR'];

async function templateWithItems(tx:any,id:string){
 const t=(await tx`select * from erp_private.service_templates where template_id=${id}`)[0];if(!t)fail(404,'That service template was not found.');
 const tasks=await tx`select * from erp_private.service_template_tasks where template_id=${id} order by sort_order,task_key`;
 const services=await tx`select s.service_code,v.service_name from erp_private.service_template_services s join erp_private.services v using(service_code) where s.template_id=${id} order by s.service_code`;
 // Build 2845: the effective-from and last-reviewed dates in force (an insert-only history beside the template).
 const dates=(await currentDates(tx,id)).get(id)||noDates;
 return {...t,tasks,services,...dates};
}
async function profileFacts(tx:any,a:any,cid:string,start:string,end:string,clientTemplate:string|null){
 // Build 2814: an obligation counts only when it is Confirmed on a verified profile for the whole period (registered, applicable, dated, evidenced) or covered by an approved exception.
 const obligations=await allowedObligations(tx,cid,start,end);
 // Payroll and Income Tax are not filing obligations on the schedule; they stay as the verified profile lists them.
 const listed=await tx`select obligations from erp_private.client_tax_profiles where client_id=${cid} and status='Verified' and deleted_at is null and effective_from<=${end} and effective_to>=${start}`;
 for(const p of listed)for(const o of p.obligations||[])if(o==='Payroll'||o==='Income Tax')obligations.add(o);
 let licences=new Set<string>();
 // Licences are kept by Managers and Partners; for anyone else they cannot be read here, so a task that needs one is not created.
 if(['PARTNER','MANAGER'].includes(a.category_code)){const rows=await tx`select licence_type from erp_private.client_licences where client_id=${cid} and ended_on is null and expires_on>=${start}`;licences=new Set(rows.map((r:any)=>r.licence_type));}
 return {obligations,licences,clientTemplate};
}
function readInputs(p:any){
 const period_start=date(p.period_start),period_end=date(p.period_end);
 const bad=periodProblem(period_start,period_end);if(bad)fail(400,bad);
 const scope=text(p.scope||'',2000,false).trim();if(scope.length<10)fail(400,'Describe the scope in at least 10 characters.');
 const exclusions=Array.isArray(p.exclusions)?p.exclusions.slice(0,100).map((e:any)=>({task_key:text(String(e?.task_key||''),40),reason:text(String(e?.reason||''),300,false)})):[];
 return {client_id:uuid(p.client_id),firm_id:uuid(p.firm_id),template_id:uuid(p.template_id),service_code:text(p.service_code,40),period_start,period_end,scope,responsible:uuid(p.responsible_staff),reviewer:uuid(p.reviewer_staff),exclusions,project_id:p.project_id?uuid(p.project_id):null};
}
async function buildPlan(tx:any,a:any,i:any){
 const tpl=await templateWithItems(tx,i.template_id);
 const problems:string[]=[],warnings:string[]=[];
 if(tpl.status!=='Approved')problems.push('Only an approved template can be used. This one is '+tpl.status.toLowerCase()+'.');
 if(!tpl.services.some((s:any)=>s.service_code===i.service_code))problems.push('This template is not for the service you chose.');
 const svc=(await tx`select service_code,service_name,is_active from erp_private.services where service_code=${i.service_code}`)[0];
 if(!svc||!svc.is_active)problems.push('Choose an active service.');
 if(i.responsible===i.reviewer)problems.push('The reviewer must be a different person from the responsible person.');
 const link=(await tx`select 1 from erp_private.client_firm_links where client_id=${i.client_id} and firm_id=${i.firm_id} and deleted_at is null`)[0];
 if(!link)problems.push('This client is not linked to that handling firm.');
 const staff=await tx`select staff_id,full_name,category_code from erp_private.assignment_candidates() where firm_id=${i.firm_id}`;
 const resp=staff.find((s:any)=>s.staff_id===i.responsible),rev=staff.find((s:any)=>s.staff_id===i.reviewer);
 if(!resp)problems.push('The responsible person is not available to this firm.');
 if(!rev)problems.push('The reviewer is not available to this firm.');
 else if(!OWNER_ROLES.includes(rev.category_code))problems.push('The reviewer must be a Supervisor, Manager or Partner.');
 const dup=(await tx`select setup_id,status from erp_private.engagement_setups where client_id=${i.client_id} and service_code=${i.service_code} and period_start=${i.period_start} and period_end=${i.period_end}`)[0];
 if(dup)problems.push('This service is already set up for this client and period. Nothing is created twice.');
 else{const clash=(await tx`select period_start,period_end from erp_private.engagement_setups where client_id=${i.client_id} and service_code=${i.service_code} and period_start<=${i.period_end} and period_end>=${i.period_start} limit 1`)[0];
  if(clash)problems.push('This service is already set up for part of that period ('+day(clash.period_start)+' to '+day(clash.period_end)+'). Choose a period that does not overlap, so no task is made twice.');}
 let project:any=null;
 if(i.project_id){
  project=(await tx`select project_id,project_name,status,client_id,handling_firm_id,service_code from erp_private.projects where project_id=${i.project_id} and deleted_at is null and erp_private.project_allowed(project_id)`)[0];
  if(!project)problems.push('That project is unavailable.');
  else if(project.client_id!==i.client_id||project.handling_firm_id!==i.firm_id||project.service_code!==i.service_code)problems.push('That project is for a different client, firm or service.');
  else if(project.status==='Archived')problems.push('That project is archived.');
  else{const sch=(await tx`select 1 from erp_private.project_schedules where project_id=${project.project_id} and enabled and deleted_at is null`)[0];
   if(sch)problems.push('This project already creates its tasks from a recurring schedule. Using a template as well would make the same work twice.');}
 }
 const client=await loadClientTemplate(tx,a,i.client_id,await tx`select * from erp_private.client_field_facts where client_id=${i.client_id}`,null);
 if(!client)fail(403,'This client is unavailable to your account.');
 const clientTemplate=client.template?.template_code||null;
 if(client.checklist?.classification_pending)problems.push('This client\'s legal form has not been classified. A Partner classifies it before an engagement can be set up.');
 if(!client.template)warnings.push('This client\'s legal structure has no client-type template. Tasks that depend on the type of client are not created.');
 else if(client.checklist&&!client.checklist.ready)warnings.push('The client file is not fully confirmed yet ('+client.checklist.exceptions.length+' item'+(client.checklist.exceptions.length===1?'':'s')+' open). Tasks that need a confirmed registration are not created until it is.');
 const facts=await profileFacts(tx,a,i.client_id,i.period_start,i.period_end,clientTemplate);
 const tasks=planTasks({tasks:tpl.tasks,period:{start:i.period_start,end:i.period_end},facts,exclusions:i.exclusions,actorCategory:a.category_code});
 problems.push(...tasks.problems);
 // Build 2864: the engagement scope. A period before the scope start (or after its end) needs a Partner's approved override. No scope recorded means no gate.
 let scope:any=null;
 if(link){const why=(await tx`select erp_private.scope_block(${i.client_id},${i.firm_id},${i.period_start},${i.period_end}) as b`)[0]?.b;
  if(why){problems.push(why);scope={needs_override:true,client_id:i.client_id,firm_id:i.firm_id,from_date:i.period_start,to_date:i.period_end,reason:why};}}
 const today=nairobiDate();
 warnings.push(...dateWarnings(tpl,i.period_start,today));
 // Build 2856: the MLRO's rule for this service. It informs and flags; the gate stays the MLRO policy switch, not this plan.
 const aml=(await amlServiceScope(tx,i.client_id,i.service_code)).scope;
 if(aml.needs_flag&&!aml.cleared)warnings.push('POCAMLA: '+aml.line);
 return {template:{template_id:tpl.template_id,template_code:tpl.template_code,version:tpl.version,name:tpl.name,service_group:tpl.service_group,effective_from:tpl.effective_from,last_reviewed:tpl.last_reviewed},service:svc||null,client:{client_id:i.client_id,company_name:client.client.company_name,template_code:clientTemplate},
  project:project?{project_id:project.project_id,project_name:project.project_name,status:project.status}:null,
  aml,scope,
  create:tasks.create,summary:folderSummary(tasks.create),skipped:tasks.skipped,problems,warnings,late:lateCount(tasks.create,today),tpl,staff:{resp,rev}};
}
const strip=(plan:any)=>{const {tpl,staff,...rest}=plan;return rest;};

export async function serviceTemplateAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Service templates and set-up are used by staff with client access.');

 if(p.action==='client_template_list'){
  return {templates:await tx`select template_code,name,controls,regulatory_overlay from erp_private.client_type_templates order by sort_order`,
   map:await tx`select structure,subtype,template_code from erp_private.client_type_template_map order by structure,subtype`,
   note:'A client type decides what the client file asks for. It does not choose any service.'};
 }
 if(p.action==='client_template_read'){
  const cid=uuid(p.client_id);
  const facts=await tx`select * from erp_private.client_field_facts where client_id=${cid}`;
  const t=await loadClientTemplate(tx,a,cid,facts,null);if(!t)fail(403,'This client is unavailable to your account.');
  return {client:{client_id:cid,company_name:t.client.company_name,structure:t.structure,subtype:t.subtype},template:t.template,checklist:t.checklist,
   message:t.template?null:'This legal structure has no client-type template. A Partner decides which template applies.'};
 }
 if(p.action==='service_template_list'){
  const rows=await tx`select * from erp_private.service_templates order by template_code,version desc`;
  const out=[];for(const r of rows)out.push(await templateWithItems(tx,r.template_id));
  const names=new Map((await tx`select staff_id,full_name from erp_private.staff_members`).map((s:any)=>[s.staff_id,s.full_name]));
  return {templates:out.map((t:any)=>({...t,proposed_by_name:names.get(t.proposed_by)||(t.source==='Starter'?'Starter set':null),approved_by_name:names.get(t.approved_by)||null})),groups:GROUPS,
   can_propose:LEADERS.includes(a.category_code),can_approve:LEADERS.includes(a.category_code),can_retire:a.category_code==='PARTNER',
   note:'The Managing Partner, or a Manager who holds the right, approves each master template, and not the person who proposed it (a Partner who is the firm\'s only Partner may approve their own). An approved template is never edited: a change is a new version.'};
 }
 if(p.action==='service_template_propose'){
  if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner proposes a service template.');
  const source=await templateWithItems(tx,uuid(p.from_template_id));
  const drop=new Set<string>((Array.isArray(p.drop_task_keys)?p.drop_task_keys:[]).map(String));
  for(const k of drop)if(!source.tasks.some((t:any)=>t.task_key===k))fail(400,'There is no task "'+k+'" in that template.');
  const optional=new Map<string,boolean>(Object.entries(p.mandatory||{}).map(([k,v])=>[k,v===true]));
  const days=new Map<string,number>(Object.entries(p.due_days||{}).map(([k,v])=>[k,Math.round(Number(v))]));
  for(const [k,d] of days){if(!source.tasks.some((t:any)=>t.task_key===k))fail(400,'There is no task "'+k+'" in that template.');if(!Number.isFinite(d)||d<0||d>366)fail(400,'Due days run from 0 to 366.');}
  const keep=source.tasks.filter((t:any)=>!drop.has(t.task_key));if(!keep.length)fail(400,'A template needs at least one task.');
  const open=(await tx`select 1 from erp_private.service_templates where template_code=${source.template_code} and status='Draft'`)[0];
  if(open)fail(409,'A draft of this template is already waiting for a Partner. Approve or retire it first.');
  const latest=Number((await tx`select max(version)::int as v from erp_private.service_templates where template_code=${source.template_code}`)[0].v);
  const name=text(p.name||source.name,120),description=text(p.description??source.description,2000,false);
  const made=(await tx`insert into erp_private.service_templates(template_code,version,name,service_group,description,source,proposed_by) values(${source.template_code},${latest+1},${name},${source.service_group},${description},'Staff',${a.staff_id}) returning template_id,version`)[0];
  for(const s of source.services)await tx`insert into erp_private.service_template_services(template_id,service_code) values(${made.template_id},${s.service_code})`;
  for(const t of keep)await tx`insert into erp_private.service_template_tasks(template_id,task_key,task_name,description,stage,recurrence,due_basis,due_days,owner_role,mandatory,requires_document,requires_obligation,requires_licence,requires_client_template,sort_order)
   values(${made.template_id},${t.task_key},${t.task_name},${t.description},${t.stage},${t.recurrence},${t.due_basis},${days.has(t.task_key)?days.get(t.task_key):t.due_days},${t.owner_role},${optional.has(t.task_key)?optional.get(t.task_key):t.mandatory},${t.requires_document},${t.requires_obligation},${t.requires_licence},${t.requires_client_template},${t.sort_order})`;
  return {ok:true,template_id:made.template_id,version:made.version};
 }
 if(p.action==='service_template_approve'||p.action==='service_template_retire'){
  if(p.action==='service_template_retire'&&a.category_code!=='PARTNER')fail(403,'A Partner retires a service template.');
  if(p.action==='service_template_approve'&&!LEADERS.includes(a.category_code))fail(403,'A Partner or a Manager who holds the approval right approves a service template.');
  const t=(await tx`select * from erp_private.service_templates where template_id=${uuid(p.template_id)} for update`)[0];if(!t)fail(404,'That service template was not found.');
  if(String(t.revision)!==revision(p.revision))fail(409,'The template changed. Refresh first.');
  if(p.action==='service_template_retire'){
   const reason=text(p.reason||'',500,false).trim();if(reason.length<5)fail(400,'Say why it is retired (at least 5 characters).');
   if(t.status==='Retired')fail(409,'It is already retired.');
   await tx`update erp_private.service_templates set status='Retired',retired_by=${a.staff_id},retired_at=now(),retired_reason=${reason} where template_id=${t.template_id}`;return {ok:true};
  }
  if(t.status!=='Draft')fail(409,'Only a draft can be approved.');
  // The person who proposed a template does not approve it, except a Partner who is the only active Partner in their firm; that is recorded on the template.
  let sole=false;
  if(t.proposed_by&&t.proposed_by===a.staff_id){
   sole=a.category_code==='PARTNER'&&(await tx`select erp_private.sole_active_partner() as sole`)[0]?.sole===true;
   if(!sole)fail(403,'A different Partner or Manager approves a template you proposed, unless you are your firm\'s only Partner.');
  }
  const prior=(await tx`select template_id from erp_private.service_templates where template_code=${t.template_code} and status='Approved' for update`)[0];
  if(prior)await tx`update erp_private.service_templates set status='Retired',retired_by=${a.staff_id},retired_at=now(),retired_reason=${'Replaced by version '+t.version} where template_id=${prior.template_id}`;
  await tx`update erp_private.service_templates set status='Approved',approved_by=${a.staff_id},approved_at=now(),sole_partner_approval=${sole} where template_id=${t.template_id}`;
  return {ok:true,replaced:!!prior,sole_partner_approval:sole};
 }

 if(p.action==='engagement_setup_options'){
  if(!EDITORS.includes(a.category_code))fail(403,'A Supervisor, Manager or Partner sets up an engagement.');
  const cid=uuid(p.client_id);
  const client=(await tx`select client_id,company_name,year_end_month,year_end_day from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];if(!client)fail(403,'This client is unavailable to your account.');
  const firms=await tx`select f.firm_id,f.legal_name from erp_private.client_firm_links l join erp_private.firms f on f.firm_id=l.firm_id where l.client_id=${cid} and l.deleted_at is null and f.deleted_at is null order by f.legal_name`;
  const templates=[];for(const r of await tx`select template_id from erp_private.service_templates where status='Approved' order by template_code`)templates.push(await templateWithItems(tx,r.template_id));
  const staff=await tx`select staff_id,full_name,category_code,firm_id from erp_private.assignment_candidates()`;
  const projects=await tx`select project_id,project_name,service_code,status,handling_firm_id from erp_private.projects where client_id=${cid} and deleted_at is null and status<>'Archived' and erp_private.project_allowed(project_id) order by created_at desc`;
  const t=await loadClientTemplate(tx,a,cid,await tx`select * from erp_private.client_field_facts where client_id=${cid}`,null);
  return {client,firms,templates:templates.map((x:any)=>({template_id:x.template_id,template_code:x.template_code,version:x.version,name:x.name,service_group:x.service_group,effective_from:x.effective_from,last_reviewed:x.last_reviewed,services:x.services,tasks:x.tasks.map((k:any)=>({task_key:k.task_key,task_name:k.task_name,stage:k.stage,recurrence:k.recurrence,mandatory:k.mandatory,requires_obligation:k.requires_obligation,requires_licence:k.requires_licence}))})),
   staff,projects,client_template:t?.template?{template_code:t.template.template_code,name:t.template.name}:null,
   note:'Choose the service yourself. The type of client does not select one.'};
 }
 // Build 2862: a task's evidence folder and which of its files are filed there. Files stored before folders existed keep their old path and are counted separately.
 if(p.action==='engagement_folder_read'){
  const tid=uuid(p.task_id);
  const task=(await tx`select task_id,project_id from erp_private.tasks where task_id=${tid} and deleted_at is null`)[0];
  if(!task)fail(403,'This task is unavailable to your account.');
  const folder=(await tx`select folder_id,path_prefix,service_code,period_start::text,period_end::text,created_at from erp_private.evidence_folders where task_id=${tid}`)[0]||null;
  const docs=await tx`select object_key from erp_private.documents where task_id=${tid} and deleted_at is null`;
  const inside=folder?docs.filter((d:any)=>String(d.object_key).startsWith(folder.path_prefix)).length:0;
  return {folder,files_in_folder:inside,files_elsewhere:docs.length-inside,note:folder?'Files added to this task from now on are stored under this path. Files added earlier keep the path they were stored under.':'This task was not made by a service set-up, so it has no evidence folder. Its files are stored as before.'};
 }
 if(p.action==='engagement_setup_list'){
  const cid=uuid(p.client_id);
  const rows=await tx`select e.setup_id,e.service_code,e.period_start,e.period_end,e.scope,e.status,e.tasks_created,e.skipped,e.applied_at,e.released_at,e.project_id,t.name as template_name,t.version,(select d.effective_from::text from erp_private.service_template_dates d where d.template_id=e.template_id order by d.recorded_at desc,d.date_id desc limit 1) template_effective_from,(select d.last_reviewed::text from erp_private.service_template_dates d where d.template_id=e.template_id order by d.recorded_at desc,d.date_id desc limit 1) template_last_reviewed,s.full_name as responsible_name,r.full_name as reviewer_name
   from erp_private.engagement_setups e join erp_private.service_templates t on t.template_id=e.template_id left join erp_private.staff_members s on s.staff_id=e.responsible_staff left join erp_private.staff_members r on r.staff_id=e.reviewer_staff
   where e.client_id=${cid} order by e.period_start desc,e.applied_at desc limit 100`;
  return {setups:rows};
 }

 if(!EDITORS.includes(a.category_code))fail(403,'A Supervisor, Manager or Partner sets up an engagement.');
 if(p.action==='engagement_setup_plan'){const plan=await buildPlan(tx,a,readInputs(p));return {ok:plan.problems.length===0,plan:strip(plan)};}

 if(p.action==='engagement_setup_apply'){
  const i=readInputs(p);
  if(p.confirm!==true)fail(400,'Confirm the plan before it is applied.');
  return await applySetup(tx,a,i,{rolled_from:null,carried:[]});
 }

 if(p.action==='engagement_rollover_due'){
  const rows=await tx`select e.setup_id,e.client_id,c.company_name as client_name,e.service_code,e.period_start,e.period_end,e.status,e.project_id,t.name as template_name,t.template_code
   from erp_private.engagement_setups e join erp_private.clients c on c.client_id=e.client_id join erp_private.service_templates t on t.template_id=e.template_id
   where c.deleted_at is null order by e.period_end desc limit 1000`;
  const due=dueForRollover(rows.map((r:any)=>({...r,period_start:day(r.period_start),period_end:day(r.period_end)})),nairobiDate(),Number(p.look_ahead_days)>=0?Math.min(31,Number(p.look_ahead_days)):7);
  return {due:due.slice(0,200),note:'Only released set-ups with no later period appear. Rolling forward never copies a completion or a sign-off.'};
 }
 if(p.action==='engagement_rollover_plan'||p.action==='engagement_rollover_apply'){
  const prev=(await tx`select * from erp_private.engagement_setups where setup_id=${uuid(p.from_setup_id)}`)[0];if(!prev)fail(403,'This set-up is unavailable to your account.');
  const i=await rolloverInputs(tx,prev);
  if(p.action==='engagement_rollover_plan'){
   const plan=await buildPlan(tx,a,i.inputs);plan.problems.push(...i.problems);
   return {ok:plan.problems.length===0,plan:{...strip(plan),next:{period_start:i.inputs.period_start,period_end:i.inputs.period_end},carried:i.carried,kept_exclusions:i.inputs.exclusions,from_setup_id:prev.setup_id}};
  }
  if(p.confirm!==true)fail(400,'Confirm the plan before it is applied.');
  if(i.problems.length)fail(400,i.problems[0]);
  return await applySetup(tx,a,i.inputs,{rolled_from:prev.setup_id,carried:i.carried});
 }

 // engagement_setup_release
 const s=(await tx`select setup_id from erp_private.engagement_setups where setup_id=${uuid(p.setup_id)}`)[0];if(!s)fail(403,'This set-up is unavailable to your account.');
 return {ok:true,...await release(tx,a,s.setup_id)};
}

// The one place a set-up is applied, for a fresh set-up and for a roll-forward alike.
async function applySetup(tx:any,a:any,i:any,extra:{rolled_from:string|null,carried:any[]}){
 await tx`select pg_advisory_xact_lock(hashtextextended(${i.client_id+':'+i.service_code+':setup'},0))`;
 const plan=await buildPlan(tx,a,i);
 if(plan.problems.length)fail(400,plan.problems[0]);
 let pid=i.project_id;
 if(!pid){
  // A new project goes through the same checks as any new project.
  await requireProjectSetup(tx,i.client_id);await requireRightChart(tx,i.client_id,'creating the project for this service');
  if(a.category_code==='PARTNER')await tx`insert into erp_private.staff_firm_access(staff_id,firm_id) values(${a.staff_id},${i.firm_id}) on conflict(staff_id,firm_id) do update set deleted_at=null`;
  const c=(await tx`select company_name from erp_private.clients where client_id=${i.client_id}`)[0];
  const name=defaultProjectName(c.company_name,plan.service.service_name,i.period_start);
  // The id is made here and the row is not read back: row security cannot show the caller a row inserted by the same statement, so `returning` would be refused (build 2842 found this).
  pid=crypto.randomUUID();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${pid},${i.client_id},${i.firm_id},${name},${i.service_code},${a.staff_id})`;
 }
 await assign(tx,pid,i.firm_id,a.staff_id);await assign(tx,pid,i.firm_id,i.responsible);await assign(tx,pid,i.firm_id,i.reviewer);
 const setup=(await tx`insert into erp_private.engagement_setups(client_id,project_id,template_id,service_code,period_start,period_end,scope,responsible_staff,reviewer_staff,client_template_code,exclusions,applied_by,rolled_from,carried)
  values(${i.client_id},${pid},${i.template_id},${i.service_code},${i.period_start},${i.period_end},${i.scope},${i.responsible},${i.reviewer},${plan.client.template_code},${tx.json(i.exclusions)},${a.staff_id},${extra.rolled_from},${tx.json(extra.carried)}) returning setup_id`)[0];
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'engagement_setups',${extra.rolled_from?'ENGAGEMENT_SETUP_ROLLED_FORWARD':'ENGAGEMENT_SETUP_APPLIED'},${setup.setup_id},${tx.json({client_id:i.client_id,project_id:pid,template:plan.template.template_code,version:plan.template.version,service_code:i.service_code,period_start:i.period_start,period_end:i.period_end,planned:plan.create.length,skipped:plan.skipped.length,rolled_from:extra.rolled_from,carried:extra.carried.length})})`;
 // Build 2856: one flag per client, service and MLRO rule, so setting up the next period does not raise it again.
 const flag=await raiseAmlServiceFlag(tx,a,i.client_id,i.service_code,setup.setup_id);
 const released=await release(tx,a,setup.setup_id);
 return {ok:true,setup_id:setup.setup_id,project_id:pid,aml:flag.scope,aml_flag_raised:flag.raised,...released};
}

// What a roll-forward starts from. The template is the current approved version of the same template, not the old one; the dates are the next period; everything else
// the team decided (scope, people, tasks dropped) is kept. Open items of the period just ended are listed as facts; no status, evidence or approval is copied.
async function rolloverInputs(tx:any,prev:any){
 const problems:string[]=[];
 if(prev.status!=='Released')problems.push('Only a released set-up is rolled forward.');
 const next=nextPeriod(day(prev.period_start),day(prev.period_end));if(!next)problems.push('The next period could not be worked out.');
 const later=(await tx`select 1 from erp_private.engagement_setups where client_id=${prev.client_id} and service_code=${prev.service_code} and period_end>${prev.period_end} limit 1`)[0];
 if(later)problems.push('A later period is already set up for this service. Roll forward from the latest one.');
 const old=(await tx`select template_code from erp_private.service_templates where template_id=${prev.template_id}`)[0];
 const cur=(await tx`select template_id,version from erp_private.service_templates where template_code=${old.template_code} and status='Approved'`)[0];
 if(!cur)problems.push('The template this set-up used is no longer approved and nothing replaces it. A Partner or authorised Manager approves a template first.');
 const proj=(await tx`select handling_firm_id from erp_private.projects where project_id=${prev.project_id}`)[0];
 const kept=cur?(await tx`select task_key from erp_private.service_template_tasks where template_id=${cur.template_id}`).map((r:any)=>r.task_key):[];
 const exclusions=(prev.exclusions||[]).filter((e:any)=>kept.includes(e.task_key));
 const open=await tx`select task_id,task_name,status,due_at,blocked_reason,deleted_at from erp_private.tasks where project_id=${prev.project_id} and period_start>=${prev.period_start} and period_end<=${prev.period_end} and (template_key like 'tpl:%' or template_key='carry') and deleted_at is null order by due_at nulls last,task_name`;
 const carried=carriedItems(open.map((t:any)=>({...t,task_name:String(t.task_name).replace(/^Carried forward: /,''),due_at:t.due_at?new Date(t.due_at).toISOString():null}))).map((c:any)=>({...c,due_at:c.due_at?c.due_at.slice(0,10):null}));
 const inputs={client_id:prev.client_id,firm_id:proj?.handling_firm_id,template_id:cur?.template_id||prev.template_id,service_code:prev.service_code,period_start:next?.start||day(prev.period_end),period_end:next?.end||day(prev.period_end),scope:prev.scope,responsible:prev.responsible_staff,reviewer:prev.reviewer_staff,exclusions,project_id:prev.project_id};
 return {inputs,problems,carried,template_changed:!!cur&&cur.template_id!==prev.template_id};
}

// Creates the tasks of a waiting set-up once the project may take them. The conditions are checked again now, so a profile verified later is honoured and nothing stale is used.
async function release(tx:any,a:any,setupId:string){
 await tx`select pg_advisory_xact_lock(hashtextextended(${setupId+':release'},0))`;
 const e=(await tx`select * from erp_private.engagement_setups where setup_id=${setupId} for update`)[0];
 if(e.status==='Released')return {released:true,already:true,tasks_created:e.tasks_created};
 const project=(await tx`select project_id,handling_firm_id from erp_private.projects where project_id=${e.project_id}`)[0];
 const gate=await projectTaskGate(tx,e.project_id,e.client_id,e.period_start);
 if(!gate.ready)return {released:false,waiting_reason:gate.reason,tasks_created:0};
 // Build 2864: the scope is checked again now, so a scope recorded after the set-up was saved still holds it back until a Partner approves the period.
 {const why=(await tx`select erp_private.scope_block(${e.client_id},${project.handling_firm_id},${day(e.period_start)},${day(e.period_end)}) as b`)[0]?.b;if(why)return {released:false,waiting_reason:why,tasks_created:0};}
 const tpl=await templateWithItems(tx,e.template_id);
 const ct=await loadClientTemplate(tx,a,e.client_id,await tx`select * from erp_private.client_field_facts where client_id=${e.client_id}`,null);
 const facts=await profileFacts(tx,a,e.client_id,day(e.period_start),day(e.period_end),ct?.template?.template_code||null);
 const plan=planTasks({tasks:tpl.tasks,period:{start:day(e.period_start),end:day(e.period_end)},facts,exclusions:e.exclusions,actorCategory:'MANAGER'});
 const clientName=(await tx`select company_name from erp_private.clients where client_id=${e.client_id}`)[0]?.company_name||'';
 let made=0;
 for(const t of plan.create){
  const assignee=t.owner_role==='REVIEWER'?e.reviewer_staff:e.responsible_staff;
  const rows=await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key)
   values(${e.project_id},${assignee},${t.task_name+(t.recurrence==='Once'?'':' · '+t.period_start)},${(t.description?t.description+' ':'')+'Created from the approved template '+tpl.name+' (version '+tpl.version+'). Internal work target; confirm statutory dates before filing.'},${t.due_on+'T17:00:00+03:00'},${taskKey(tpl.template_code,tpl.version,t.task_key,t.period_start)},${t.requires_document},${t.period_start},${t.period_end},${'tpl:'+t.task_key})
   on conflict(project_id,recurring_key) do nothing returning task_id`;
  made+=rows.length;
  // Build 2857: the task's evidence folder is made in the same step. Doing the set-up again makes no second folder.
  if(rows.length)await tx`insert into erp_private.evidence_folders(task_id,client_id,project_id,setup_id,service_code,period_start,period_end,path_prefix,created_by)
   values(${rows[0].task_id},${e.client_id},${e.project_id},${setupId},${e.service_code},${t.period_start},${t.period_end},${evidencePath({clientName,clientId:e.client_id,serviceCode:e.service_code,periodStart:t.period_start,taskKey:t.task_key})},${a.staff_id}) on conflict(task_id) do nothing`;
 }
 // Items still open from the period before come across as new Pending tasks with a fresh date; nothing about their old status, evidence or approval is copied.
 let carriedMade=0;
 for(const c of (Array.isArray(e.carried)?e.carried:[])){
  const due=new Date(Date.parse(day(e.period_start)+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);
  const note='Carried forward from the previous period (it was '+String(c.was).toLowerCase()+(c.blocked_reason?': '+String(c.blocked_reason).slice(0,200):'')+'). Check it again; nothing from the old task counts as done.';
  const rows=await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key)
   values(${e.project_id},${e.responsible_staff},${'Carried forward: '+String(c.task_name).slice(0,150)},${note},${due+'T17:00:00+03:00'},${'carry:'+setupId+':'+c.task_id},false,${e.period_start},${e.period_end},'carry') on conflict(project_id,recurring_key) do nothing returning task_id`;
  carriedMade+=rows.length;
 }
 await tx`update erp_private.engagement_setups set status='Released',released_by=${a.staff_id},released_at=now(),tasks_created=${made+carriedMade},skipped=${tx.json(plan.skipped)} where setup_id=${setupId}`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'engagement_setups','ENGAGEMENT_SETUP_RELEASED',${setupId},${tx.json({project_id:e.project_id,tasks_created:made,carried:carriedMade,skipped:plan.skipped.length})})`;
 return {released:true,tasks_created:made+carriedMade,carried_created:carriedMade,skipped:plan.skipped};
}
