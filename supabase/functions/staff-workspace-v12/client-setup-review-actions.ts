import {fail,uuid,text} from './validation.mjs';
import {SECTIONS,SECTION_CODES,SOURCE_KINDS,sourceProblem,submitPlan,decidePlan,sectionState,sectionLabel,milestones} from './setup-review-rules.mjs';
// Build 2828: deferred review of client set-up sections. The preparer submits and carries on; a Manager or Partner reviews later, all at once.
// The Chart of Accounts and Opening Trial Balance keep their own blocking approvals; here they are only reported so the whole picture is on one screen.
const ACTIONS=['client_setup_review_read','client_setup_section_submit','client_setup_review_queue','client_setup_section_decide'];
const LEADERS=['PARTNER','MANAGER'];

async function mandatory(tx:any,cid:string){
 const v=await tx`select status from erp_private.client_chart_versions where client_id=${cid} order by created_at desc`;
 const chart=v.some((x:any)=>x.status==='Approved')?'Approved':v.some((x:any)=>x.status==='Draft')?'Pending Review':v.length&&v[0].status==='Returned'?'Correction Required':'Draft';
 const c=(await tx`select opening_balance_status from erp_private.clients where client_id=${cid}`)[0];
 const j=await tx`select j.status from erp_private.ledger_journals j join erp_private.ledger_periods p on p.period_id=j.period_id where p.client_id=${cid} and j.kind='Opening' order by j.created_at desc`;
 let opening='Draft';
 if(c?.opening_balance_status==='No opening balances')opening='Approved';
 else if(j.some((x:any)=>x.status==='Posted'))opening='Approved';
 else if(j.some((x:any)=>x.status==='Submitted'))opening='Pending Review';
 else if(j.length&&j[0].status==='Returned')opening='Correction Required';
 else if(!j.length&&chart!=='Approved')opening='Blocked';
 return {chart:{status:chart,label:'Chart of Accounts'},opening:{status:opening,label:'Opening Trial Balance',not_applicable:c?.opening_balance_status==='No opening balances'}};
}
const digest=async(tx:any,cid:string,code:string)=>String((await tx`select erp_private.client_setup_section_digest(${cid}::uuid,${code}) d`)[0].d);

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
