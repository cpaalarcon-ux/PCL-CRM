// Tasks from the dated dependency map (review item 6).
// The client's dated activities and obligations (client_dependency_sources) say which working-paper
// modules apply. For an active engagement this creates one task per applicable dependency, shared
// dependencies once, keyed 'dep:<code>' so a rebuild never duplicates work. It only uses facts already
// approved at Gate A (activity change sets) or by the tax-profile reviewer:
// - an obligation counts only when it is selected, registered, applicable, has evidence, the client
//   status is not deregistered/not registered/unknown, and this firm is selected to handle it;
//   anything To confirm creates no task and does not block other work;
// - recurring return work (dependencies with a due day, due rule, cadence or per-payment timing) is
//   already created by the reporting schedule, so it is listed as covered, not duplicated;
// - a task whose dependency no longer applies is never deleted; an unstarted one is blocked with a
//   "no longer applies – review" reason and a started one is listed for review.
import {fail,uuid,date} from './validation.mjs';

const nairobiToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
const scheduled=(c:any)=>!!(c&&(c.due_day||c.due_rule||c.cadence||c.due_working_days_after_payment));
const BAD_STATUS=['DEREGISTERED','NOT_REGISTERED','UNKNOWN'];

export async function dependencyPlan(tx:any,projectId:string,asOf:string){
 const project=(await tx`select project_id,client_id,handling_firm_id,status from erp_private.projects where project_id=${projectId} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is unavailable.');
 const sources=await tx`select s.source_type,s.source_id,s.source_code,s.dependency_code,r.dependency_label,r.configuration,v.version_label
  from erp_private.client_dependency_sources s
  join erp_private.dependency_map_rules r on r.version_id=s.version_id and r.source_type=s.source_type and r.source_code=s.source_code and r.dependency_code=s.dependency_code
  join erp_private.dependency_map_versions v on v.version_id=s.version_id and v.status in ('Testing','Approved')
  where s.client_id=${project.client_id} and s.effective_from<=${asOf} and (s.effective_to is null or s.effective_to>=${asOf})
  order by s.dependency_code,s.source_type,s.source_code`;
 const obligationIds=[...new Set(sources.filter((s:any)=>s.source_type==='OBLIGATION').map((s:any)=>s.source_id))];
 const obligations=obligationIds.length?await tx`select o.*,(pr.status='Verified' and pr.deleted_at is null and pr.effective_from<=${asOf} and pr.effective_to>=${asOf}) as profile_ok
  from erp_private.client_tax_obligations o join erp_private.client_tax_profiles pr using(profile_id) where o.obligation_id=any(${tx.array(obligationIds)}::uuid[])`:[];
 const byId=new Map(obligations.map((o:any)=>[o.obligation_id,o]));
 const why=(s:any)=>{
  if(s.source_type!=='OBLIGATION')return null;
  const o:any=byId.get(s.source_id);if(!o||!o.is_selected)return `${s.source_code}: not selected in the client tax profile`;
  if(!o.profile_ok)return `${s.source_code}: no verified tax profile covers ${asOf}`;
  if(o.registered!=='YES')return `${s.source_code}: iTax registration is ${o.registered}`;
  if(o.applicable!=='YES')return `${s.source_code}: legal applicability is ${o.applicable}`;
  if(BAD_STATUS.includes(o.client_status))return `${s.source_code}: client status is ${o.client_status}`;
  if(!o.evidence_reference)return `${s.source_code}: evidence reference missing`;
  if(!(o.handling_firm_ids||[]).includes(project.handling_firm_id))return `${s.source_code}: this firm is not selected to handle it`;
  return null;
 };
 const items=new Map<string,any>();
 for(const s of sources){
  const it=items.get(s.dependency_code)||{dependency_code:s.dependency_code,label:s.dependency_label,from:[],waiting:[],scheduled:false,map_version:s.version_label};
  const reason=why(s);if(reason)it.waiting.push(reason);else it.from.push(`${s.source_type==='ACTIVITY'?'Activity':'Obligation'} ${s.source_code}`);
  if(scheduled(s.configuration))it.scheduled=true;
  items.set(s.dependency_code,it);
 }
 const existing=await tx`select task_id,recurring_key,status,task_name,revision from erp_private.tasks where project_id=${projectId} and recurring_key like 'dep:%' and deleted_at is null`;
 const existingByCode=new Map(existing.map((t:any)=>[t.recurring_key.slice(4),t]));
 const create:any[]=[],covered:any[]=[],waiting:any[]=[],kept:any[]=[];
 for(const it of items.values()){
  if(!it.from.length){waiting.push({dependency_code:it.dependency_code,label:it.label,reasons:it.waiting});continue;}
  if(it.scheduled){covered.push({dependency_code:it.dependency_code,label:it.label,from:it.from});continue;}
  if(existingByCode.has(it.dependency_code))kept.push({dependency_code:it.dependency_code,label:it.label,task_id:existingByCode.get(it.dependency_code).task_id});
  else create.push(it);
 }
 const applies=new Set(create.concat(kept).map((x:any)=>x.dependency_code));
 const stale=existing.filter((t:any)=>!applies.has(t.recurring_key.slice(4))&&!['Completed','Cancelled'].includes(t.status)).map((t:any)=>({task_id:t.task_id,dependency_code:t.recurring_key.slice(4),task_name:t.task_name,status:t.status,revision:t.revision}));
 return {project,as_of:asOf,create,kept,covered,waiting,stale};
}

export async function applyDependencyTasks(tx:any,a:any,projectId:string,asOf:string){
 await tx`select pg_advisory_xact_lock(hashtextextended(${projectId+':dependency-tasks'},0))`;
 const plan=await dependencyPlan(tx,projectId,asOf);
 if(plan.project.status!=='Active')return {...plan,created:0,flagged:0,skipped:'Tasks are created only for an active engagement.'};
 for(const it of plan.create)await tx`insert into erp_private.tasks(project_id,task_name,description,status,recurring_key,template_key)
  values(${projectId},${it.label},${`Set up and maintain this working-paper area. Required by ${it.from.join(', ')} (dependency map ${it.map_version}, as of ${asOf}).`},'Pending',${'dep:'+it.dependency_code},'dependency')
  on conflict(project_id,recurring_key) do nothing`;
 let flagged=0;
 for(const t of plan.stale)if(t.status==='Pending'){await tx`update erp_private.tasks set status='Blocked',blocked_reason=${`No longer applies from ${asOf}: the client's activities or obligations changed. Review, then cancel or complete it.`} where task_id=${t.task_id} and status='Pending'`;flagged++;}
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'tasks','DEPENDENCY_TASKS',${projectId},${tx.json({as_of:asOf,created:plan.create.map((x:any)=>x.dependency_code),flagged:plan.stale.filter((x:any)=>x.status==='Pending').map((x:any)=>x.dependency_code),waiting:plan.waiting.map((x:any)=>x.dependency_code)})})`;
 return {...plan,created:plan.create.length,flagged};
}

// Called after Gate A approves an activity change, after a tax profile is verified and when an
// engagement is activated, so the task list follows the approved facts without a separate step.
export async function syncClientDependencyTasks(tx:any,a:any,clientId:string){
 const projects=await tx`select project_id from erp_private.projects where client_id=${clientId} and status='Active' and deleted_at is null`;
 for(const p of projects)await applyDependencyTasks(tx,a,p.project_id,nairobiToday());
 return projects.length;
}

export async function dependencyTaskAction(tx:any,a:any,p:any){
 if(!['v3_activities_dependency_tasks_preview','v3_activities_dependency_tasks_apply'].includes(p.action))return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must maintain client configuration.');
 const asOf=p.as_of?date(p.as_of):nairobiToday();
 if(p.action==='v3_activities_dependency_tasks_preview')return await dependencyPlan(tx,uuid(p.project_id),asOf);
 return await applyDependencyTasks(tx,a,uuid(p.project_id),asOf);
}
