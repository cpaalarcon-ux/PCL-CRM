import {choice,fail,text,uuid} from './validation.mjs';
import {assign} from './workspace-actions.ts';
// Client team: a Manager or Partner names more than one person for a client (and, where needed, for one project of that client).
// The database decides who may hold each role and where (client_team_guard in 20261212100000_client_team.sql) and routes scheduled
// tasks to a workstream owner (team_route_task). Naming a person here never widens record access by itself: an Assistant or Supervisor
// named for a client with no project gets the existing onboarding allocation, and one named on a project is added to that project.
const ACTIONS=['client_team_read','client_team_add','client_team_end','client_team_handover','client_team_defaults'];
const ROLES=['PREPARER','REVIEWER','MLRO','WORKSTREAM_OWNER'];
// Same list the routing function uses (team_workstream). The scheduled-task keys are shown so a Manager can see what each workstream covers.
export const WORKSTREAMS=[
 {code:'SALES',label:'Sales',covers:'Weekly sales upload'},
 {code:'PURCHASES',label:'Purchases',covers:'Weekly purchases upload'},
 {code:'BANK',label:'Bank statements',covers:'Weekly bank transactions upload'},
 {code:'PAYROLL',label:'Payroll',covers:'Payroll, PAYE, NSSF, SHIF, housing levy and NITA'},
 {code:'VAT',label:'VAT and turnover tax filing',covers:'Monthly VAT and turnover tax returns'},
 {code:'INCOME_TAX',label:'Income tax',covers:'Annual income tax, rental income, fringe benefit and deemed interest'},
];
const leader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
// Open tasks of this client that a hand-over may move: not started, in a workstream, and not locked by review or archive. Same limits the workload screen applies.
const movable=(tx:any,cid:string,from:string|null,ws:string|null)=>tx`select t.task_id,t.revision,t.project_id,t.task_name,t.due_at,t.assigned_to,erp_private.team_workstream(t.template_key) as ws,p.handling_firm_id,w.reviewer_id
 from erp_private.tasks t join erp_private.projects p on p.project_id=t.project_id left join erp_private.task_procedures w on w.task_id=t.task_id
 where p.client_id=${cid} and p.deleted_at is null and p.status='Active' and t.deleted_at is null and t.status='Pending'
  and (${from}::uuid is null or t.assigned_to=${from}::uuid) and t.assigned_to is not null
  and erp_private.team_workstream(t.template_key) is not null and (${ws}::text is null or erp_private.team_workstream(t.template_key)=${ws}::text)
  and (w.task_id is null or w.stage in ('Pending preparer','Pending client documents')) and not erp_private.task_is_archived(t.task_id)
  and not exists(select 1 from erp_private.task_review_pool rp where rp.task_id=t.task_id and rp.review_pool_status='POOL')
 order by t.due_at,t.task_id limit 100`;

export async function clientTeamAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 const cid=uuid(p.client_id);
 const client=(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!client)fail(403,'This client is unavailable to your account.');

 if(p.action==='client_team_read'){
  const members=await tx`select m.team_member_id,m.project_id,pr.project_name,m.staff_id,erp_private.aml_staff_name(m.staff_id) as staff_name,s.category_code,m.role,m.workstream,m.assigned_at,erp_private.aml_staff_name(m.assigned_by) as assigned_by_name,m.note
   from erp_private.client_team_members m join erp_private.staff_members s on s.staff_id=m.staff_id left join erp_private.projects pr on pr.project_id=m.project_id
   where m.client_id=${cid} and m.ended_at is null order by (m.project_id is not null),m.role,m.workstream nulls first,m.assigned_at,m.team_member_id limit 500`;
  const projects=await tx`select p.project_id,p.project_name,p.status from erp_private.projects p where p.client_id=${cid} and p.deleted_at is null and p.status<>'Archived' order by p.project_name,p.project_id limit 100`;
  const edit=leader(a);
  const candidates=edit?await tx`select staff_id,full_name,category_code,is_mlro from erp_private.client_team_candidates() order by full_name,staff_id limit 500`:[];
  // Who holds not-started team-workstream tasks for this client, so a Manager can hand them over.
  const holders=edit?await tx`select t.assigned_to as staff_id,erp_private.aml_staff_name(t.assigned_to) as staff_name,erp_private.team_workstream(t.template_key) as workstream,count(*)::int as tasks
   from erp_private.tasks t join erp_private.projects p on p.project_id=t.project_id where p.client_id=${cid} and p.deleted_at is null and p.status='Active' and t.deleted_at is null and t.status='Pending'
   and t.assigned_to is not null and erp_private.team_workstream(t.template_key) is not null group by 1,2,3 order by 2,3 limit 200`:[];
  return {client,members,projects,workstreams:WORKSTREAMS,candidates,holders,can_edit:edit,
   note:'Named people are the defaults for new work. A project can name its own owners; they replace the client\'s owners for that project. MLROs named here receive the client\'s POCAMLA work first; any other MLRO or Partner can still decide.'};
 }

 if(!leader(a))fail(403,'A Manager or Partner names the client team.');

 if(p.action==='client_team_defaults'){
  const r=(await tx`select d.preparer_id,erp_private.aml_staff_name(d.preparer_id) as preparer_name,d.reviewer_id,erp_private.aml_staff_name(d.reviewer_id) as reviewer_name from erp_private.team_defaults(${cid},${p.firm_id?uuid(p.firm_id):null}) d`)[0];
  return {preparer_id:r?.preparer_id||null,preparer_name:r?.preparer_name||null,reviewer_id:r?.reviewer_id||null,reviewer_name:r?.reviewer_name||null};
 }

 if(p.action==='client_team_add'){
  const role=choice(p.role,ROLES),staffId=uuid(p.staff_id),note=text(p.note||'',500,false);
  const workstream=role==='WORKSTREAM_OWNER'?choice(p.workstream,WORKSTREAMS.map(w=>w.code)):null;
  if(role!=='WORKSTREAM_OWNER'&&p.workstream)fail(400,'A workstream applies only to a workstream owner.');
  const projectId=p.project_id?uuid(p.project_id):null;
  if(role==='MLRO'&&projectId)fail(400,'An MLRO is named for the client, not for one project.');
  const person=(await tx`select staff_id,full_name,category_code,is_mlro from erp_private.client_team_candidates() where staff_id=${staffId}`)[0];
  if(!person)fail(400,'Choose an active Partner, Manager, Supervisor or Assistant who works in one of your firms.');
  if(role==='MLRO'&&!person.is_mlro)fail(400,'Only a Partner or someone who holds the MLRO right can be named as an MLRO. A Partner gives that right under Staff & access → Additional rights.');
  if(role==='REVIEWER'&&person.category_code==='ASSISTANT')fail(400,'A reviewer is a Partner, Manager or Supervisor.');
  const project=projectId?(await tx`select project_id,handling_firm_id from erp_private.projects where project_id=${projectId} and client_id=${cid} and deleted_at is null and status<>'Archived'`)[0]:null;
  if(projectId&&!project)fail(400,'Choose an open project of this client.');
  const clash=(await tx`select 1 from erp_private.client_team_members where client_id=${cid} and staff_id=${staffId} and ended_at is null
   and (${role==='REVIEWER'||role==='MLRO'} and role in('PREPARER','WORKSTREAM_OWNER') or ${role==='PREPARER'||role==='WORKSTREAM_OWNER'} and role in('REVIEWER','MLRO')) limit 1`)[0];
  if(clash)fail(409,person.full_name+' already holds a role that cannot be combined with this one. The person who prepares the work cannot also review it or act as the MLRO for the same client.');
  const dup=(await tx`select 1 from erp_private.client_team_members where client_id=${cid} and coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid)=${projectId||'00000000-0000-0000-0000-000000000000'}::uuid and staff_id=${staffId} and role=${role} and coalesce(workstream,'')=${workstream||''} and ended_at is null`)[0];
  if(dup)fail(409,person.full_name+' already holds that role.');
  const row=(await tx`insert into erp_private.client_team_members(client_id,project_id,staff_id,role,workstream,assigned_by,note) values(${cid},${projectId},${staffId},${role},${workstream},${a.staff_id},${note||null}) returning team_member_id`)[0];
  // Access follows the existing rules: a project owner joins the project, and an Assistant or Supervisor with no project gets the onboarding allocation.
  if(project)await assign(tx,project.project_id,project.handling_firm_id,staffId);
  else if(['ASSISTANT','SUPERVISOR'].includes(person.category_code)){
   await tx`insert into erp_private.client_onboarding_allocations(client_id,staff_id,allocated_by,note,source) values(${cid},${staffId},${a.staff_id},'Named on the client team','Team')
    on conflict (client_id,staff_id) where ended_at is null do nothing`;
  }
  return {ok:true,team_member_id:row.team_member_id,staff_name:person.full_name};
 }


 if(p.action==='client_team_handover'){
  const from=p.from_staff_id?uuid(p.from_staff_id):null,to=p.to_staff_id?uuid(p.to_staff_id):null,ws=p.workstream?choice(p.workstream,WORKSTREAMS.map(w=>w.code)):null;
  const reason=text(p.reason||'',1000,false).trim(),preview=p.preview===true;
  if(!from)fail(400,'Choose whose open tasks to hand over.');
  if(!preview&&reason.length<10)fail(400,'Say why the tasks are moving (at least 10 characters).');
  if(to&&to===from)fail(400,'Choose a different person to take the tasks.');
  if(to){
   const person=(await tx`select staff_id,full_name from erp_private.client_team_candidates() where staff_id=${to}`)[0];
   if(!person)fail(400,'Choose an active Partner, Manager, Supervisor or Assistant who works in one of your firms.');
   const checker=(await tx`select 1 from erp_private.client_team_members where client_id=${cid} and staff_id=${to} and role in('REVIEWER','MLRO') and ended_at is null limit 1`)[0];
   if(checker)fail(409,person.full_name+' reviews or is MLRO for this client and cannot also take the preparation work.');
  }
  const rows=await movable(tx,cid,from,ws);
  // Without a named person each task goes to the best available owner for its workstream, counting the tasks already handed out in this move.
  const added=new Map<string,number>(),plan:any[]=[],stay:any[]=[];
  for(const r of rows){
   let dest=to;
   if(!dest){
    const ranked=await tx`select staff_id,is_override,open_tasks,assigned_at from erp_private.team_rank(${cid},${r.project_id},${r.handling_firm_id},'WORKSTREAM_OWNER',${r.ws},${r.due_at},${tx.array([from,...(r.reviewer_id?[r.reviewer_id]:[])])}::uuid[])`;
    ranked.sort((x:any,y:any)=>(Number(y.is_override)-Number(x.is_override))||((x.open_tasks+(added.get(x.staff_id)||0))-(y.open_tasks+(added.get(y.staff_id)||0)))||String(x.assigned_at).localeCompare(String(y.assigned_at)));
    dest=ranked[0]?.staff_id||null;
   }
   if(!dest||dest===r.reviewer_id){stay.push(r);continue;}
   added.set(dest,(added.get(dest)||0)+1);plan.push({...r,dest});
  }
  const names=new Map<string,string>();
  for(const id of new Set(plan.map(x=>x.dest))){names.set(id,(await tx`select erp_private.aml_staff_name(${id}) as n`)[0].n);}
  const groups=[...names.entries()].map(([id,name])=>({staff_id:id,staff_name:name,tasks:plan.filter(x=>x.dest===id).length}));
  const summary={moving:plan.length,staying:stay.length,groups,stay_reason:stay.length?'No available team owner, or the new owner is the task reviewer. These stay where they are.':null};
  if(preview||!plan.length)return {ok:true,preview:true,...summary};
  for(const id of new Set(plan.map(x=>x.dest))){
   const mine=plan.filter(x=>x.dest===id);
   for(const pid of new Set(mine.map(x=>x.project_id))){const r=mine.find(x=>x.project_id===pid);await assign(tx,pid,r.handling_firm_id,id);}
   await tx`select erp_private.workload_apply(${tx.json(mine.map(x=>({id:x.task_id,revision:Number(x.revision)})))}::jsonb,'assign',${id}::uuid,${reason},null,null,false)`;
  }
  return {ok:true,preview:false,...summary};
 }

 // client_team_end
 const id=uuid(p.team_member_id),reason=text(p.reason||'',500,true);
 if(reason.trim().length<5)fail(400,'Say why this person is leaving the team (at least 5 characters).');
 const row=(await tx`update erp_private.client_team_members set ended_at=now(),ended_by=${a.staff_id},end_reason=${reason.trim()} where team_member_id=${id} and client_id=${cid} and ended_at is null returning staff_id,project_id`)[0];
 if(!row)fail(404,'That team entry is already ended or not found.');
 // An allocation made only because of the team role ends with the last team role; anything else (an allocation a Manager made, a project assignment) is left alone.
 const left=(await tx`select 1 from erp_private.client_team_members where client_id=${cid} and staff_id=${row.staff_id} and ended_at is null limit 1`)[0];
 if(!left)await tx`update erp_private.client_onboarding_allocations set ended_at=now(),ended_by=${a.staff_id},end_reason='Left the client team: '||${reason.trim().slice(0,400)}
  where client_id=${cid} and staff_id=${row.staff_id} and source='Team' and ended_at is null`;
 const open=(await movable(tx,cid,row.staff_id,null)).length;
 return {ok:true,open_tasks:open};
}
