import {fail,uuid,text} from './validation.mjs';
import {mandatoryState,buildClientTasks,clientConfigurationItems,TASK_ORDER} from './client-setup-tasks-rules.mjs';
import {clientReadiness} from './work-ready-rules.mjs';
import {today} from './suite-actions.ts';
import {REQUIRED_MINIMUM,SECTIONS,SECTION_CODES,SOURCE_KINDS,sourceProblem,submitPlan,decidePlan,sectionState,sectionLabel,milestones} from './setup-review-rules.mjs';
import {attempt} from './owner-batch-actions.ts';
// Build 2828: deferred review of client set-up sections. The preparer submits and carries on; a Manager or Partner reviews later, all at once.
// The Chart of Accounts and Opening Trial Balance keep their own blocking approvals; here they are only reported so the whole picture is on one screen.
const ACTIONS=['client_setup_tasks_read','client_setup_review_read','client_setup_section_submit','client_setup_section_submit_many','client_setup_review_queue','client_setup_section_decide','client_work_ready','client_status_policy_read','client_status_policy_set'];
const LEADERS=['PARTNER','MANAGER'];

async function mandatory(tx:any,cid:string){
 const v=await tx`select status from erp_private.client_chart_versions where client_id=${cid} order by created_at desc`;
 const c=(await tx`select opening_balance_status from erp_private.clients where client_id=${cid}`)[0];
 const j=await tx`select j.status from erp_private.ledger_journals j join erp_private.ledger_periods p on p.period_id=j.period_id where p.client_id=${cid} and j.kind='Opening' order by j.created_at desc`;
 const m=mandatoryState(v,j,c?.opening_balance_status);
 return {chart:{status:m.chart,label:'Chart of Accounts'},opening:{status:m.opening,label:'Opening Trial Balance',not_applicable:m.opening_not_applicable}};
}
const digest=async(tx:any,cid:string,code:string)=>String((await tx`select erp_private.client_setup_section_digest(${cid}::uuid,${code}) d`)[0].d);


// A section with nothing recorded yet is not sent for review: there is nothing for a reviewer to look at.
export const MAX_MANY=100;
async function sectionHasData(tx:any,cid:string,code:string):Promise<boolean>{
 const n=async(q:any)=>Number((await q)[0]?.n||0)>0;
 if(code==='identity')return !!(await tx`select 1 from erp_private.clients where client_id=${cid} and (legal_entity_type is not null or legal_structure is not null)`).length;
 if(code==='year_end')return !!(await tx`select 1 from erp_private.clients where client_id=${cid} and year_end_month is not null`).length;
 if(code==='tax')return await n(tx`select (select count(*) from erp_private.client_tax_profiles where client_id=${cid} and deleted_at is null)+(select count(*) from erp_private.client_tax_obligations where client_id=${cid}) n`);
 if(code==='ownership')return await n(tx`select (select count(*) from erp_private.beneficial_owners where client_id=${cid} and deleted_at is null)+(select count(*) from erp_private.client_parties where client_id=${cid})+(select count(*) from erp_private.client_office_holders where client_id=${cid}) n`);
 if(code==='contacts')return await n(tx`select (select count(*) from erp_private.client_contacts where client_id=${cid} and deleted_at is null)+(select count(*) from erp_private.client_field_facts where client_id=${cid} and status<>'Superseded' and field_key in('contact_person','contact_phone','contact_email')) n`);
 // The other sections are lists: nothing recorded means an empty list.
 return (await digest(tx,cid,code))!==md5Empty;
}
const md5Empty='d751713988987e9331980363e24189ce';

async function readClient(tx:any,cid:string){
 const rows=await tx`select s.*,sb.full_name submitted_by_name,rb.full_name reviewed_by_name from erp_private.client_setup_sections s left join erp_private.staff_members sb on sb.staff_id=s.submitted_by left join erp_private.staff_members rb on rb.staff_id=s.reviewed_by where s.client_id=${cid}`;
 const sections:any[]=[];
 for(const def of SECTIONS){
  const row=rows.find((r:any)=>r.section_code===def.code)||null,now=await digest(tx,cid,def.code),st=sectionState(row,now);
  sections.push({code:def.code,label:def.label,hint:def.hint,status:st.status,changed:st.changed,source_kind:row?.source_kind||null,source_note:row?.source_note||null,submitted_by_name:row?.submitted_by_name||null,submitted_at:row?.submitted_at||null,reviewed_by_name:row?.reviewed_by_name||null,reviewed_at:row?.reviewed_at||null,review_note:row?.review_note||null,unchanged_approval:!!row?.unchanged_approval});
 }
 const m=await mandatory(tx,cid),ms=milestones(sections,m.chart,m.opening);
 const history=await tx`select e.section_code,e.action,e.status_after,e.note,e.occurred_at,e.source_kind,s.full_name actor_name from erp_private.client_setup_section_events e join erp_private.staff_members s on s.staff_id=e.actor_id where e.client_id=${cid} order by e.occurred_at desc limit 40`;
 return {sections,chart:m.chart,opening:m.opening,milestones:ms,history};
}

export async function clientSetupReviewAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Client set-up review is kept by staff with client access.');

 if(p.action==='client_setup_section_submit_many'){
  // Several clients at once: each client goes through the same single-client submission in its own savepoint.
  const ids=[...new Set((Array.isArray(p.client_ids)?p.client_ids:[]).map((x:any)=>uuid(x)))];
  if(!ids.length)fail(400,'Tick the clients to submit.');
  if(ids.length>MAX_MANY)fail(400,`Choose at most ${MAX_MANY} clients at a time.`);
  const list=Array.isArray(p.sections)?p.sections:[];
  if(!list.length||list.length>SECTION_CODES.length)fail(400,'Choose the sections to submit.');
  const seen=new Set<string>();
  for(const item of list){const code=String(item?.section_code||'');if(!SECTION_CODES.includes(code))fail(400,'Unknown set-up section.');if(seen.has(code))fail(400,'A section appears twice.');seen.add(code);const problem=sourceProblem(String(item?.source_kind||''),text(item?.source_note||'',500,false));if(problem)fail(400,`${sectionLabel(code)}: ${problem}`);}
  const submitted:any[]=[],skipped:any[]=[],held:any[]=[];
  for(const id of ids){
   const c=(await tx`select client_id,company_name from erp_private.clients where client_id=${id} and deleted_at is null and record_status<>'Archived'`)[0];
   if(!c){held.push({client_id:id,name:'Client',reason:'This client is not available to your account.'});continue;}
   const lacking:string[]=[];for(const code of REQUIRED_MINIMUM)if(!(await sectionHasData(tx,id,code)))lacking.push(sectionLabel(code));
   if(lacking.length){held.push({client_id:id,name:c.company_name,reason:`The minimum is not met, nothing was sent. Still missing: ${lacking.join(', ')}.`});continue;}
   const have:any[]=[];
   for(const item of list){if(await sectionHasData(tx,id,String(item.section_code)))have.push(item);else skipped.push({client_id:id,name:c.company_name,section:sectionLabel(String(item.section_code)),reason:'Nothing recorded yet'});}
   if(!have.length)continue;
   const res=await attempt(tx,true,t=>clientSetupReviewAction(t,a,{action:'client_setup_section_submit',client_id:id,sections:have}));
   if(res.ok)for(const r of res.out?.results||[])submitted.push({client_id:id,name:c.company_name,section:sectionLabel(r.section_code),result:r.result});
   else held.push({client_id:id,name:c.company_name,reason:res.reason});
  }
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_setup_sections','SETUP_SECTIONS_SUBMITTED_MANY',${crypto.randomUUID()},${tx.json({clients:ids.length,submitted:submitted.length,skipped:skipped.length,held:held.length})})`;
  return {ok:true,submitted,skipped,held};
 }

 if(p.action==='client_setup_tasks_read'){
  // One set-based read per table, all under the caller's client access. Only clients that are active and not archived have tasks.
  const only=p.client_id?uuid(p.client_id):null;
  const clients=await tx`select client_id,company_name from erp_private.clients where deleted_at is null and service_status='Active' and record_status<>'Archived' and (${only}::uuid is null or client_id=${only}::uuid) order by company_name`;
  const ids=clients.map((c:any)=>c.client_id);
  const sections=ids.length?await tx`select client_id,section_code,status,submitted_by from erp_private.client_setup_sections where client_id=any(${ids}::uuid[])`:[];
  const vrows=ids.length?await tx`select client_id,status from erp_private.client_chart_versions where client_id=any(${ids}::uuid[]) order by created_at desc`:[];
  const jrows=ids.length?await tx`select p.client_id,j.status from erp_private.ledger_journals j join erp_private.ledger_periods p on p.period_id=j.period_id where j.kind='Opening' and p.client_id=any(${ids}::uuid[]) order by j.created_at desc`:[];
  const ob=ids.length?await tx`select client_id,opening_balance_status from erp_private.clients where client_id=any(${ids}::uuid[])`:[];
  const routing=ids.length?await tx`select client_id,status,created_by from erp_private.client_routing_map where status='Draft' and client_id=any(${ids}::uuid[])`:[];
  const engagements=ids.length?await tx`select client_id,service_code,period_start::text period_start,period_end::text period_end,status from erp_private.engagement_setups where status='Waiting' and client_id=any(${ids}::uuid[])`:[];
  const exceptions=ids.length?await tx`select client_id,status,created_by from erp_private.client_tax_exceptions where status='Draft' and client_id=any(${ids}::uuid[])`:[];
  const taxLead=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
  const group=(rows:any[])=>{const o:any={};for(const r of rows)(o[r.client_id]=o[r.client_id]||[]).push(r);return o;};
  const openingStatus:any={};for(const r of ob)openingStatus[r.client_id]=r.opening_balance_status;
  const me={staff_id:a.staff_id,leader:LEADERS.includes(a.category_code),canApproveExceptions:a.category_code==='PARTNER'||taxLead};
  const tasks=buildClientTasks({clients,sections,versions:group(vrows),journals:group(jrows),openingStatus,routing,engagements,exceptions,me});
  tasks.sort((x:any,y:any)=>x.company_name.localeCompare(y.company_name)||TASK_ORDER.indexOf(x.kind)-TASK_ORDER.indexOf(y.kind));
  return {tasks,configuration:clientConfigurationItems(tasks),clients_checked:clients.length,clients_with_tasks:new Set(tasks.map((t:any)=>t.client_id)).size,leader:me.leader};
 }

 if(p.action==='client_setup_review_queue'){
  if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner reviews set-up sections.');
  const pending=await tx`select s.client_id,c.company_name,s.section_code,s.source_kind,s.source_note,s.submitted_at,sb.full_name submitted_by_name,s.submitted_by from erp_private.client_setup_sections s join erp_private.clients c on c.client_id=s.client_id and c.deleted_at is null left join erp_private.staff_members sb on sb.staff_id=s.submitted_by where s.status='Pending Review' order by c.company_name,s.submitted_at limit 500`;
  const byClient=new Map<string,any>();
  for(const r of pending){
   const now=await digest(tx,r.client_id,r.section_code),saved=(await tx`select content_digest from erp_private.client_setup_sections where client_id=${r.client_id} and section_code=${r.section_code}`)[0];
   const x=byClient.get(r.client_id)||{client_id:r.client_id,company_name:r.company_name,sections:[]};
   x.sections.push({code:r.section_code,label:sectionLabel(r.section_code),source_kind:r.source_kind,source_note:r.source_note,submitted_at:r.submitted_at,submitted_by_name:r.submitted_by_name,mine:r.submitted_by===a.staff_id,edited_since_submission:saved?.content_digest!==now});
   byClient.set(r.client_id,x);
  }
  const clients=[...byClient.values()];
  return {clients,total:clients.reduce((n:number,c:any)=>n+c.sections.length,0)};
 }


 // Build 2847: the work-ready test and set-up progress for a page of client cards. Worked out from the records on every call and never stored.
 if(p.action==='client_work_ready'||p.action==='client_status_policy_read'||p.action==='client_status_policy_set'){
  const current=async()=>(await tx`select p.policy_id,p.require_chart,p.reason,p.set_at,coalesce(s.full_name,'A Partner') set_by_name from erp_private.client_status_policy p left join erp_private.staff_members s on s.staff_id=p.set_by order by p.set_at desc,p.policy_id desc limit 1`)[0]||null;
  if(p.action==='client_status_policy_read'){
   const history=await tx`select p.policy_id,p.require_chart,p.reason,p.set_at,coalesce(s.full_name,'A Partner') set_by_name from erp_private.client_status_policy p left join erp_private.staff_members s on s.staff_id=p.set_by order by p.set_at desc,p.policy_id desc limit 20`;
   return {require_chart:!!history[0]?.require_chart,current:history[0]||null,history,can_set:a.category_code==='PARTNER'};
  }
  if(p.action==='client_status_policy_set'){
   if(a.category_code!=='PARTNER')fail(403,'Only a Partner can change what Healthy means on a client card.');
   if(typeof p.require_chart!=='boolean')fail(400,'Choose on or off.');
   const reason=text(p.reason||'',500,false).trim();
   if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
   const now=await current();
   if(!!now?.require_chart===p.require_chart)fail(409,'That is already the choice in force.');
   await tx`insert into erp_private.client_status_policy(require_chart,reason,set_by) values(${p.require_chart},${reason},${a.staff_id})`;
   return {ok:true,require_chart:p.require_chart};
  }
  // Managers and Partners only: the answer needs the KYC file, which a Supervisor cannot read, so a Supervisor would be shown a wrong red.
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Client status is shown to Managers and Partners.');
  if(!Array.isArray(p.client_ids)||p.client_ids.length>500)fail(400,'Ask for 500 clients or fewer.');
  const ids=p.client_ids.map((x:any)=>uuid(x));
  if(!ids.length)return {require_chart:false,rows:[]};
  const requireChart=!!(await current())?.require_chart,day=today();
  const clients=await tx`select client_id,kra_pin,opening_balance_status from erp_private.clients where deleted_at is null and client_id=any(${ids}::uuid[])`;
  const live=clients.map((c:any)=>c.client_id);
  const k=live.length?await tx`select client_id,verified_by is not null kyc_verified,(review_due is not null and review_due>=${day}::date) kyc_current,(is_pep or risk_rating='High') edd_needed,edd_approved_by is not null edd_ok from erp_private.client_compliance where client_id=any(${live}::uuid[])`:[];
  const e=live.length?await tx`select p.client_id,count(*)::int engagements,
   count(*) filter(where exists(select 1 from erp_private.project_assignments pa where pa.project_id=p.project_id and pa.deleted_at is null and pa.role_on_job in ('MANAGER','PARTNER')))::int engagements_with_lead,
   count(*) filter(where c.signed_letter_id is not null and c.letter_verified_by is not null and (c.letter_expires_on is null or c.letter_expires_on>=${day}::date))::int engagements_with_letter
   from erp_private.projects p left join erp_private.engagement_controls c on c.project_id=p.project_id and c.deleted_at is null
   where p.deleted_at is null and p.status in ('Draft','Active') and p.client_id=any(${live}::uuid[]) group by p.client_id`:[];
  const sec=live.length?await tx`select client_id,section_code from erp_private.client_setup_sections where status='Approved' and client_id=any(${live}::uuid[])`:[];
  const vrows=live.length?await tx`select client_id,status from erp_private.client_chart_versions where client_id=any(${live}::uuid[]) order by created_at desc`:[];
  const jrows=live.length?await tx`select lp.client_id,j.status from erp_private.ledger_journals j join erp_private.ledger_periods lp on lp.period_id=j.period_id where j.kind='Opening' and lp.client_id=any(${live}::uuid[]) order by j.created_at desc`:[];
  const by=(rows:any[])=>{const o:any={};for(const r of rows)(o[r.client_id]=o[r.client_id]||[]).push(r);return o;};
  const kb=Object.fromEntries(k.map((r:any)=>[r.client_id,r])),eb=Object.fromEntries(e.map((r:any)=>[r.client_id,r])),sb=by(sec),vb=by(vrows),jb=by(jrows);
  const rows=clients.map((c:any)=>{
   const m=mandatoryState(vb[c.client_id],jb[c.client_id],c.opening_balance_status),kk=kb[c.client_id]||{},ee=eb[c.client_id]||{};
   return clientReadiness({client_id:c.client_id,kra_pin:c.kra_pin,kyc_verified:!!kk.kyc_verified,kyc_current:!!kk.kyc_current,edd_needed:!!kk.edd_needed,edd_ok:!!kk.edd_ok,engagements:ee.engagements||0,engagements_with_lead:ee.engagements_with_lead||0,engagements_with_letter:ee.engagements_with_letter||0,chart:m.chart,opening:m.opening,approved_sections:(sb[c.client_id]||[]).map((r:any)=>r.section_code)},{requireChart});
  });
  return {require_chart:requireChart,rows};
 }
 const cid=uuid(p.client_id);
 const client=(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!client)fail(403,'This client is unavailable to your account.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-setup-review'},0))`;

 if(p.action==='client_setup_review_read')return {client,...(await readClient(tx,cid)),source_kinds:SOURCE_KINDS};

 if(p.action==='client_setup_section_submit'){
  const list=Array.isArray(p.sections)?p.sections:[];
  if(!list.length||list.length>SECTION_CODES.length)fail(400,'Choose the sections to submit.');
  const seen=new Set<string>(),results:any[]=[];
  for(const item of list){
   const code=String(item?.section_code||'');if(!SECTION_CODES.includes(code))fail(400,'Unknown set-up section.');
   if(seen.has(code))fail(400,'A section appears twice.');seen.add(code);
   const kind=String(item?.source_kind||''),note=text(item?.source_note||'',500,false);
   const problem=sourceProblem(kind,note);if(problem)fail(400,`${sectionLabel(code)}: ${problem}`);
   const now=await digest(tx,cid,code),row=(await tx`select * from erp_private.client_setup_sections where client_id=${cid} and section_code=${code} for update`)[0]||null;
   const plan=submitPlan(row,now);
   if(plan.action==='none'){results.push({section_code:code,result:'Already approved and unchanged'});continue;}
   if(plan.action==='approve_unchanged'){
    await tx`update erp_private.client_setup_sections set status='Approved',unchanged_approval=true,content_digest=${now},source_kind=${kind},source_note=${note||null},submitted_by=${a.staff_id},submitted_at=now() where section_id=${row.section_id}`;
    await tx`insert into erp_private.client_setup_section_events(section_id,client_id,section_code,action,status_after,actor_id,note,digest,source_kind) values(${row.section_id},${cid},${code},'Approved unchanged','Approved',${a.staff_id},'Same information as the last approval, so it was not reviewed again.',${now},${kind})`;
    results.push({section_code:code,result:'Unchanged since the last approval, no new review needed'});continue;
   }
   let id=row?.section_id;
   if(row)await tx`update erp_private.client_setup_sections set status='Pending Review',source_kind=${kind},source_note=${note||null},content_digest=${now},submitted_by=${a.staff_id},submitted_at=now(),reviewed_by=null,reviewed_at=null,review_note=null,unchanged_approval=false where section_id=${row.section_id}`;
   else id=(await tx`insert into erp_private.client_setup_sections(client_id,section_code,status,source_kind,source_note,content_digest,submitted_by,submitted_at) values(${cid},${code},'Pending Review',${kind},${note||null},${now},${a.staff_id},now()) returning section_id`)[0].section_id;
   await tx`insert into erp_private.client_setup_section_events(section_id,client_id,section_code,action,status_after,actor_id,note,digest,source_kind) values(${id},${cid},${code},'Submitted','Pending Review',${a.staff_id},${note||null},${now},${kind})`;
   results.push({section_code:code,result:'Submitted for review. You can carry on.'});
  }
  return {ok:true,results,...(await readClient(tx,cid))};
 }

 if(p.action==='client_setup_section_decide'){
  if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner reviews set-up sections.');
  const list=Array.isArray(p.decisions)?p.decisions:[];
  if(!list.length||list.length>SECTION_CODES.length)fail(400,'Choose the sections to decide.');
  const seen=new Set<string>(),results:any[]=[];
  for(const item of list){
   const code=String(item?.section_code||'');if(!SECTION_CODES.includes(code))fail(400,'Unknown set-up section.');
   if(seen.has(code))fail(400,'A section appears twice.');seen.add(code);
   const outcome=String(item?.outcome||''),note=text(item?.note||'',1000,false).trim();
   const row=(await tx`select * from erp_private.client_setup_sections where client_id=${cid} and section_code=${code} for update`)[0]||null;
   const now=await digest(tx,cid,code),plan=decidePlan(row,outcome,note,now);
   if(!plan.ok)fail(400,`${sectionLabel(code)}: ${plan.problem}`);
   if(outcome==='Approved'){
    await tx`update erp_private.client_setup_sections set status='Approved',approved_digest=content_digest,reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},unchanged_approval=false where section_id=${row.section_id}`;
    await tx`insert into erp_private.client_setup_section_events(section_id,client_id,section_code,action,status_after,actor_id,note,digest,source_kind) values(${row.section_id},${cid},${code},'Approved','Approved',${a.staff_id},${note||null},${row.content_digest},${row.source_kind})`;
   }else{
    await tx`update erp_private.client_setup_sections set status='Correction Required',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where section_id=${row.section_id}`;
    await tx`insert into erp_private.client_setup_section_events(section_id,client_id,section_code,action,status_after,actor_id,note,digest,source_kind) values(${row.section_id},${cid},${code},'Returned','Correction Required',${a.staff_id},${note},${row.content_digest},${row.source_kind})`;
   }
   results.push({section_code:code,result:outcome==='Approved'?'Approved':'Returned for correction'});
  }
  return {ok:true,results,...(await readClient(tx,cid))};
 }
 return undefined;
}
