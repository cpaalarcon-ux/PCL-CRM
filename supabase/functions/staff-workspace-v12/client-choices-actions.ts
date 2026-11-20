import {fail,uuid,revision} from './validation.mjs';
import {RETURNS,RETURN_CODES,EXCEPTION_KINDS,selectionFields,endFields,profileCovers,exceptionFields,exceptionDecision,closeFields} from './client-choices-rules.mjs';
import {listProfiles} from './export-profile-actions.ts';
// Build 2841: a client's chosen statutory returns and client-specific exceptions to firm-wide tax rules. Table rules are in 20261117210000_client_returns_and_tax_exceptions.sql.
// Nothing here changes a payroll figure, a rate or a calculation. A choice or an exception is a dated, recorded position that is ended with a reason, never edited.
const ACTIONS=['client_setup_returns_read','client_setup_returns_choose','client_setup_returns_end','client_setup_exceptions_read','client_setup_exception_propose','client_setup_exception_decide','client_setup_exception_close'];
const LEADERS=['PARTNER','MANAGER'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const names=(r:any)=>({created_by_name:r.created_by_name||null,approved_by_name:r.approved_by_name||null,closed_by_name:r.closed_by_name||null});
const showReturn=(r:any)=>({selection_id:r.selection_id,return_code:r.return_code,return_label:RETURNS[r.return_code as keyof typeof RETURNS]?.label,effective_from:day(r.effective_from),effective_to:r.effective_to?day(r.effective_to):null,status:r.status,note:r.note,selected_by_name:r.selected_by_name||null,selected_at:r.selected_at,ended_by_name:r.ended_by_name||null,ended_reason:r.ended_reason||null,revision:String(r.revision)});
const showException=(r:any,me:string)=>({exception_id:r.exception_id,rate_key:r.rate_key,rate_label:r.rate_label||r.rate_key,kind:r.kind,kind_label:EXCEPTION_KINDS[r.kind as keyof typeof EXCEPTION_KINDS],effective_from:day(r.effective_from),effective_to:r.effective_to?day(r.effective_to):null,reason:r.reason,legal_basis:r.legal_basis,status:r.status,...names(r),created_at:r.created_at,approved_at:r.approved_at,closed_at:r.closed_at,closed_reason:r.closed_reason||null,mine:r.created_by===me,revision:String(r.revision)});

export async function clientChoicesAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Client set-up choices are kept by staff with client access.');
 const cid=uuid(p.client_id);
 const client=(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!client)fail(403,'This client is unavailable to your account.');
 const leader=LEADERS.includes(a.category_code);

 if(p.action==='client_setup_returns_read'){
  const rows=await tx`select s.*,erp_private.staff_name(s.selected_by) selected_by_name,erp_private.staff_name(s.ended_by) ended_by_name from erp_private.client_payroll_returns s where s.client_id=${cid} order by s.return_code,s.effective_from desc,s.selected_at desc`;
  const profiles=(await listProfiles(tx)).map((x:any)=>({...x,effective_from:day(x.effective_from),effective_to:x.effective_to?day(x.effective_to):null}));
  const today=new Date(Date.now()+3*3600*1000).toISOString().slice(0,10);
  const offered=RETURN_CODES.map((code:string)=>{const inForce=profiles.filter((x:any)=>x.return_code===code&&x.status==='Published'&&x.effective_from<=today&&(!x.effective_to||x.effective_to>=today)).sort((x:any,y:any)=>y.version-x.version)[0]||null;
   const active=rows.find((r:any)=>r.return_code===code&&r.status==='Active')||null;
   return {return_code:code,label:RETURNS[code as keyof typeof RETURNS].label,authority:RETURNS[code as keyof typeof RETURNS].authority,profile:inForce?{version:inForce.version,template_version:inForce.template_version,verified_on:day(inForce.verified_on)}:null,chosen:!!active,selection_id:active?.selection_id||null};});
  return {client,configured:rows.length>0,offered,history:rows.map(showReturn),can_edit:leader};
 }
 if(!leader)fail(403,'A Manager or Partner records client set-up choices.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-choices'},0))`;

 if(p.action==='client_setup_returns_choose'){
  const v=selectionFields(p);if(v.problem)fail(400,v.problem);
  const profiles=(await listProfiles(tx)).map((x:any)=>({...x,effective_from:day(x.effective_from),effective_to:x.effective_to?day(x.effective_to):null}));
  const cover=profileCovers(profiles,v.values.return_code,v.values.effective_from);if(cover.problem)fail(409,cover.problem);
  const dup=(await tx`select 1 from erp_private.client_payroll_returns where client_id=${cid} and return_code=${v.values.return_code} and status='Active'`)[0];
  if(dup)fail(409,`${RETURNS[v.values.return_code as keyof typeof RETURNS].label} is already chosen for this client. End it first to choose again.`);
  const made=one(await tx`insert into erp_private.client_payroll_returns(client_id,return_code,effective_from,note,selected_by) values(${cid},${v.values.return_code},${v.values.effective_from},${v.values.note},${a.staff_id}) returning selection_id`);
  return {chosen:true,selection_id:made.selection_id};
 }
 if(p.action==='client_setup_returns_end'){
  const row=one(await tx`select * from erp_private.client_payroll_returns where selection_id=${uuid(p.selection_id)} and client_id=${cid} for update`);
  if(row.status!=='Active')fail(409,'This choice has already ended.');
  if(String(row.revision)!==revision(p.revision))fail(409,'The choice changed. Refresh first.');
  const v=endFields(p,row);if(v.problem)fail(400,v.problem);
  await tx`update erp_private.client_payroll_returns set status='Ended',effective_to=${v.values.effective_to},ended_by=${a.staff_id},ended_at=now(),ended_reason=${v.values.reason} where selection_id=${row.selection_id}`;
  return {ended:true};
 }

 if(p.action==='client_setup_exceptions_read'){
  const rows=await tx`select e.*,erp_private.staff_name(e.created_by) created_by_name,erp_private.staff_name(e.approved_by) approved_by_name,erp_private.staff_name(e.closed_by) closed_by_name,
   (select max(r.label) from erp_private.tax_rates r where r.rate_key=e.rate_key and r.deleted_at is null) rate_label from erp_private.client_tax_exceptions e where e.client_id=${cid} order by e.rate_key,e.effective_from desc,e.created_at desc`;
  const rules=await tx`select rate_key,max(label) label from erp_private.tax_rates where deleted_at is null and status in('Approved','Testing') group by rate_key order by rate_key`;
  const taxLead=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
  return {client,exceptions:rows.map((r:any)=>showException(r,a.staff_id)),rules:rules.map((r:any)=>({rate_key:r.rate_key,label:r.label})),kinds:Object.entries(EXCEPTION_KINDS).map(([code,label])=>({code,label})),can_approve:a.category_code==='PARTNER'||taxLead,
   note:'The rule itself stays in the central library. An approved exception is a recorded position shown beside the rule; it does not change a rate or a calculation by itself.'};
 }
 if(p.action==='client_setup_exception_propose'){
  const known=(await tx`select distinct rate_key from erp_private.tax_rates where deleted_at is null and status in('Approved','Testing')`).map((r:any)=>r.rate_key);
  const v=exceptionFields(p,known);if(v.problem)fail(400,v.problem);
  const dup=(await tx`select 1 from erp_private.client_tax_exceptions where client_id=${cid} and rate_key=${v.values.rate_key} and status='Draft'`)[0];
  if(dup)fail(409,'A proposed exception for this rule is already waiting for a decision.');
  const made=one(await tx`insert into erp_private.client_tax_exceptions(client_id,rate_key,kind,effective_from,effective_to,reason,legal_basis,created_by) values(${cid},${v.values.rate_key},${v.values.kind},${v.values.effective_from},${v.values.effective_to},${v.values.reason},${v.values.legal_basis},${a.staff_id}) returning exception_id`);
  return {proposed:true,exception_id:made.exception_id};
 }
 const row=one(await tx`select * from erp_private.client_tax_exceptions where exception_id=${uuid(p.exception_id)} and client_id=${cid} for update`);
 if(String(row.revision)!==revision(p.revision))fail(409,'The exception changed. Refresh first.');
 if(p.action==='client_setup_exception_decide'){
  const outcome=String(p.outcome||'');if(!['Approve','Withdraw'].includes(outcome))fail(400,'Choose Approve or Withdraw.');
  if(outcome==='Withdraw'){
   const v=closeFields(p,row,'withdraw');if(v.problem)fail(400,v.problem);
   if(row.status!=='Draft')fail(409,'Only a proposed exception can be withdrawn. End an approved one instead.');
   await tx`update erp_private.client_tax_exceptions set status='Withdrawn',closed_by=${a.staff_id},closed_at=now(),closed_reason=${v.values.reason} where exception_id=${row.exception_id}`;
   return {withdrawn:true};
  }
  const taxLead=!!(await tx`select erp_private.tax_rules_approver() as ok`)[0]?.ok;
  const d=exceptionDecision(row,a,{taxLead});if(!d.ok)fail(403,d.problem);
  await tx`update erp_private.client_tax_exceptions set status='Active',approved_by=${a.staff_id},approved_at=now() where exception_id=${row.exception_id}`;
  return {approved:true};
 }
 // client_setup_exception_close: end an approved exception on a date, with a reason.
 if(row.status!=='Active')fail(409,'Only an approved exception can be ended.');
 const v=closeFields(p,row,'end');if(v.problem)fail(400,v.problem);
 await tx`update erp_private.client_tax_exceptions set status='Ended',effective_to=${v.values.effective_to},closed_by=${a.staff_id},closed_at=now(),closed_reason=${v.values.reason} where exception_id=${row.exception_id}`;
 return {ended:true};
}
