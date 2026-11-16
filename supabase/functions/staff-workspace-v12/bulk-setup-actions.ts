import {fail,uuid} from './validation.mjs';
import {expandRun,verdict,previewVerdict,summarise,OPERATIONS,MAX_ROWS} from './bulk-setup-rules.mjs';
import {RETURNS,RETURN_CODES} from './export-profile-rules.mjs';
import {clientChoicesAction} from './client-choices-actions.ts';
import {serviceTemplateAction} from './service-template-actions.ts';
import {requireProjectSetup} from './workspace-actions.ts';
import {requireRightChart} from './legal-structure-actions.ts';
// Build 2842: bulk client set-up. One choice is applied to many clients. Every row goes through the existing single-client action inside its own savepoint, so a row that passes
// is applied exactly as if a Manager had done it by hand, a row that fails changes nothing and is listed with its reason, and independent review is unchanged (a bulk run approves
// nothing and posts nothing). The preview runs the same checks and writes nothing. The audit record is in bulk_setup_runs and bulk_setup_rows (20261118100000_bulk_setup.sql).
const ACTIONS=['bulk_setup_options','bulk_setup_preview','bulk_setup_apply','bulk_setup_runs_read','bulk_setup_run_read'];
const LEADERS=['PARTNER','MANAGER'];
class Rollback extends Error{}
const plain=(e:any,fallback:string)=>e?.status?String(e.message):e?.code==='23505'?'A record already exists for this client and item.':e?.code==='23514'||e?.code==='42501'?String(e.message||fallback):fallback;
// Runs fn in a savepoint. With keep=false the work is always rolled back, so a preview can use the very same code as the apply and cannot disagree with it.
export async function attempt(tx:any,keep:boolean,fn:(t:any)=>Promise<any>):Promise<{ok:boolean,out?:any,reason?:string}>{
 let out:any;
 try{await tx.savepoint(async(t:any)=>{out=await fn(t);if(!keep)throw new Rollback();});return {ok:true,out};}
 catch(e:any){if(e instanceof Rollback)return {ok:true,out};if(!e?.status)console.error('Bulk set-up row failed',{code:e?.code||'INTERNAL',type:e?.name||'Error'});return {ok:false,reason:plain(e,'This row could not be applied. Check it and try it on its own.')};}
}
async function firmFor(tx:any,row:any){
 if(row.input.firm_id)return {firm:row.input.firm_id};
 const f=await tx`select l.firm_id from erp_private.client_firm_links l join erp_private.firms x on x.firm_id=l.firm_id where l.client_id=${row.input.client_id} and l.deleted_at is null and x.deleted_at is null`;
 if(f.length===1)return {firm:f[0].firm_id};
 return {problem:f.length?'This client is linked to more than one firm. Choose the handling firm on this row.':'This client is not linked to a handling firm.'};
}
async function runRow(tx:any,a:any,common:any,row:any,keep:boolean){
 if(row.problem)return {ok:false,reason:row.problem};
 const c=(await tx`select client_id,company_name from erp_private.clients where client_id=${row.input.client_id} and deleted_at is null`)[0];
 if(!c){row.client_label='Client '+String(row.input.client_id).slice(0,8);row.client_id=null;return {ok:false,reason:'This client is unavailable to your account.'};}
 row.client_label=c.company_name;
 if(common.operation==='ENGAGEMENT'){
  const f=await firmFor(tx,row);if((f as any).problem)return {ok:false,reason:(f as any).problem};
  const base={client_id:c.client_id,firm_id:(f as any).firm,template_id:common.template_id,service_code:common.service_code,period_start:common.period_start,period_end:common.period_end,scope:common.scope,responsible_staff:row.input.responsible_staff,reviewer_staff:row.input.reviewer_staff,exclusions:[]};
  if(!keep){
   // The plan is the read-only half of the same checks the apply makes again before it writes.
   const r=await attempt(tx,false,t=>serviceTemplateAction(t,a,{action:'engagement_setup_plan',...base}));
   if(!r.ok)return r;
   const plan=r.out?.plan;if(!plan||plan.problems?.length)return {ok:false,reason:plan?.problems?.[0]||'The set-up has a problem.'};
   // The apply also makes a new project for the service; the same two checks run here so the preview does not promise what the apply would refuse.
   const g=await attempt(tx,false,async t=>{await requireProjectSetup(t,c.client_id);await requireRightChart(t,c.client_id,'setting up this service');});if(!g.ok)return g;
   return {ok:true,out:{note:`${plan.create.length} task${plan.create.length===1?'':'s'} would be created`+(plan.warnings?.length?`; ${plan.warnings.length} warning${plan.warnings.length===1?'':'s'}: ${plan.warnings[0]}`:'')}};
  }
  const r=await attempt(tx,true,t=>serviceTemplateAction(t,a,{action:'engagement_setup_apply',...base,confirm:true}));
  if(!r.ok)return r;
  const o=r.out||{};return {ok:true,out:{record_ref:String(o.setup_id||''),note:o.released?`${o.tasks_created||0} task${o.tasks_created===1?'':'s'} created`:'Waiting: '+(o.waiting_reason||'the project is not ready for tasks yet')}};
 }
 const r=await attempt(tx,keep,t=>clientChoicesAction(t,a,{action:'client_setup_returns_choose',client_id:c.client_id,return_code:row.input.return_code,effective_from:common.effective_from,note:common.note}));
 if(!r.ok)return r;
 return {ok:true,out:{record_ref:String(r.out?.selection_id||(keep?'':'preview')),note:keep?null:'Would be chosen'}};
}

export async function bulkSetupAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!LEADERS.includes(a.category_code))fail(403,'A Manager or Partner sets up several clients at once.');

 if(p.action==='bulk_setup_options'){
  const clients=await tx`select c.client_id,c.company_name,coalesce((select json_agg(json_build_object('firm_id',f.firm_id,'legal_name',f.legal_name) order by f.legal_name) from erp_private.client_firm_links l join erp_private.firms f on f.firm_id=l.firm_id where l.client_id=c.client_id and l.deleted_at is null and f.deleted_at is null),'[]'::json) firms
   from erp_private.clients c where c.deleted_at is null and c.service_status='Active' and c.record_status<>'Archived' order by c.company_name`;
  const templates=await tx`select t.template_id,t.template_code,t.version,t.name,(select d.effective_from::text from erp_private.service_template_dates d where d.template_id=t.template_id order by d.recorded_at desc,d.date_id desc limit 1) effective_from,(select d.last_reviewed::text from erp_private.service_template_dates d where d.template_id=t.template_id order by d.recorded_at desc,d.date_id desc limit 1) last_reviewed,coalesce((select json_agg(json_build_object('service_code',s.service_code,'service_name',v.service_name) order by s.service_code) from erp_private.service_template_services s join erp_private.services v using(service_code) where s.template_id=t.template_id),'[]'::json) services from erp_private.service_templates t where t.status='Approved' order by t.template_code`;
  const staff=await tx`select staff_id,full_name,category_code,firm_id from erp_private.assignment_candidates()`;
  return {operations:Object.entries(OPERATIONS).map(([code,label])=>({code,label})),max_rows:MAX_ROWS,clients,templates,staff,returns:RETURN_CODES.map((c:string)=>({return_code:c,label:RETURNS[c as keyof typeof RETURNS].label})),
   note:'Each client is checked on its own. Clients that pass are set up through the same rules as a single client; the others are listed with the reason. Nothing is approved or posted.'};
 }
 if(p.action==='bulk_setup_runs_read'){
  const runs=await tx`select r.run_id,r.operation,r.row_count,r.applied_count,r.skipped_count,r.created_at,erp_private.staff_name(r.created_by) created_by_name from erp_private.bulk_setup_runs r order by r.created_at desc limit 50`;
  return {runs:runs.map((r:any)=>({...r,operation_label:OPERATIONS[r.operation as keyof typeof OPERATIONS]}))};
 }
 if(p.action==='bulk_setup_run_read'){
  const id=uuid(p.run_id);const run=(await tx`select r.*,erp_private.staff_name(r.created_by) created_by_name from erp_private.bulk_setup_runs r where r.run_id=${id}`)[0];if(!run)fail(404,'That run was not found.');
  const rows=await tx`select row_no,client_id,client_label,item,outcome,reason,record_ref from erp_private.bulk_setup_rows where run_id=${id} order by row_no`;
  return {run:{...run,operation_label:OPERATIONS[run.operation as keyof typeof OPERATIONS]},rows,summary:summarise(rows)};
 }

 const exp=expandRun(p);if(exp.problem)fail(400,exp.problem);
 const common=exp.common,rows=exp.rows;
 if(p.action==='bulk_setup_preview'){
  const results=[];
  for(const row of rows){const r=await runRow(tx,a,common,row,false);results.push(previewVerdict(row,r.ok,r.ok?r.out:{reason:r.reason}));}
  return {preview:true,operation:common.operation,results,summary:summarise(results)};
 }
 // bulk_setup_apply: every row is checked again as it is applied; the preview is never trusted.
 if(p.confirm!==true)fail(400,'Check the preview and confirm before applying.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${a.staff_id+':bulk-setup'},0))`;
 const results=[];
 for(const row of rows){const r=await runRow(tx,a,common,row,true);results.push(verdict(row,r.ok,r.ok?r.out:{reason:r.reason}));}
 const sum=summarise(results);
 const run=(await tx`insert into erp_private.bulk_setup_runs(operation,parameters,row_count,applied_count,skipped_count,created_by) values(${common.operation},${tx.json({...common,rows:rows.length})},${results.length},${sum.applied},${sum.skipped},${a.staff_id}) returning run_id`)[0];
 for(const r of results){
  await tx`insert into erp_private.bulk_setup_rows(run_id,row_no,client_id,client_label,item,outcome,reason,record_ref) values(${run.run_id},${r.row_no},${r.client_id},${r.client_label},${r.item},${r.outcome},${r.reason},${r.record_ref})`;
 }
 return {applied:true,run_id:run.run_id,operation:common.operation,results,summary:sum};
}
