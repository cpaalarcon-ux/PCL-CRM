import {fail,uuid,text} from './validation.mjs';
import {chartResolver} from './client-chart.ts';
import {routingMapAction} from './routing-map-actions.ts';
import {groupUploadAccounts,summariseUpload,summariseRows} from './purchase-accounts-rules.mjs';
import {summaryRows,recordSummaryView} from './upload-summary-gate.ts';

// Build 2893: one step to set up what an upload uses. Rights and records are exactly those of adding a client account by hand (a Manager or Partner; the account is usable at once as Draft and is reviewed when a different
// Manager or Partner approves a journal that uses it). The step only saves time: it creates the same dated client account for each TB code in the unmapped rows of the project, in one confirmation,
// and optionally proposes the routing code and TB code pairs as drafts for a Partner who did not propose them to approve. It never approves, maps a row or posts anything.
const ACTIONS=['purchase_accounts_preview','purchase_accounts_save','purchase_accounts_summary'];
const COST=['Purchases','Expenditure','Non-eTIMS'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);

async function upload(tx:any,project:any){
 const rows=await tx`select r.normalized->>'tb_code' as tb_code,r.normalized->>'routing_code' as routing_code,coalesce(r.normalized->>'date',b.period_start::text) as date,nullif(r.normalized->>'amount','')::numeric as amount,r.dataset
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${project.project_id} and b.archived_at is null and r.account_code is null and r.parent_row_id is null and not r.is_split_parent and r.dataset=any(${tx.array(COST)}::text[])
   and coalesce(btrim(r.normalized->>'tb_code'),'')<>'' limit 10000`;
 const accounts=await tx`select code,name,status,is_legacy,route from erp_private.account_catalog`;
 const mappings=await tx`select mapping_id,source_account_code,erp_account_code,effective_from,effective_to,status from erp_private.client_account_mappings where client_id=${project.client_id} and status in ('Active','Draft')`;
 const chartAt=await chartResolver(tx,project.client_id);
 return groupUploadAccounts(rows,accounts,mappings,chartAt);
}

export async function purchaseAccountsAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 const pid=uuid(p.project_id),project=(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is not available to your account.');
 // Build 2894: the summary is read-only and is for every preparer, so the person who uploads can see what mapped and what is left as a draft before sending for review.
 if(p.action==='purchase_accounts_summary'){
  if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
  // Build 2901: opening the summary records the view (who, when, what it showed). Sending a tax case for review needs the preparer's view of the current summary.
  const summary=summariseRows(await summaryRows(tx,pid)),seen=await recordSummaryView(tx,a,project,summary);
  return {ok:true,...summary,viewed_at:seen.viewed_at};
 }
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Manager or Partner sets up client accounts, as when adding one by hand.');
 if(project.status==='Archived')fail(400,'Archived projects retain read-only accounting history.');
 const list=await upload(tx,project);
 if(p.action==='purchase_accounts_preview'){
  const policy=(await tx`select 1 from erp_private.stock_policy_versions v join erp_private.client_activities x on x.activity_id=v.activity_id where x.client_id=${project.client_id} limit 1`).length>0;
  const sum=summariseUpload(list);
  return {ok:true,accounts:list,...sum,stock_method_missing:sum.stock_needed&&!policy};
 }
 const chosen=new Set((Array.isArray(p.codes)?p.codes:[]).map((x:any)=>String(x).trim()));
 if(!chosen.size||chosen.size>200)fail(400,'Choose between 1 and 200 accounts.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':client-accounts'},0))`;
 const fresh=await upload(tx,project),created:any[]=[],skipped:any[]=[];
 for(const code of chosen){
  const g=fresh.find((x:any)=>x.tb_code===code);
  if(!g){skipped.push({tb_code:code,reason:'No unmapped row in this project uses this code any more.'});continue;}
  if(g.state==='Already set up'){skipped.push({tb_code:code,reason:'Already set up.'});continue;}
  if(g.state!=='Ready'){skipped.push({tb_code:code,reason:g.reason});continue;}
  const r=await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,status,created_by) values(${project.client_id},${code},${g.account_name},${code},${g.first_date},'Draft',${a.staff_id}) returning mapping_id`;
  created.push({tb_code:code,account_name:g.account_name,effective_from:g.first_date,mapping_id:r[0].mapping_id});
 }
 let routing:any={saved:0,problems:[]};
 if(p.propose_routing!==false){
  const q=await routingMapAction(tx,a,{action:'routing_map_suggestions',client_id:project.client_id});
  const ok=new Set(fresh.filter((x:any)=>['Ready','Already set up'].includes(x.state)&&chosen.has(x.tb_code)).map((x:any)=>x.tb_code));
  const pairs=(q.pairs||[]).filter((x:any)=>!x.draft_id&&ok.has(x.tb_code)).map((x:any)=>({routing_code:x.routing_code,tb_code:x.tb_code}));
  if(pairs.length){
   try{routing=await routingMapAction(tx,a,{action:'routing_map_suggest_propose',client_id:project.client_id,pairs});}
   catch(e:any){if(e?.status!==400&&e?.status!==409)throw e;routing={saved:0,problems:[{issues:[String(e.message).slice(0,300)]}]};}
  }
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_account_mappings','CLIENT_ACCOUNTS_FROM_UPLOAD',${project.project_id},${tx.json({created:created.map((x:any)=>x.tb_code),skipped:skipped.map((x:any)=>x.tb_code),routing_proposed:routing.saved||0})})`;
 return {ok:true,created:created.length,created_accounts:created,skipped,routing_proposed:routing.saved||0,routing_problems:routing.problems||[],
  note:created.length||routing.saved?'The accounts can be used at once. A Partner who did not propose the routing drafts approves them in the routing map, and the next automatic mapping then maps the rows. Nothing is posted.':'Nothing new was set up.'};
}
