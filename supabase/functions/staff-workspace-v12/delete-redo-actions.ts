import {fail,text,uuid,revision} from './validation.mjs';
import {periodImportAction} from './period-import-actions.ts';
import {withdrawAction} from './withdraw-actions.ts';
import {importPlan,uploadPlan} from './delete-redo-rules.mjs';
import {bankRemovalFacts} from './upload-safety.ts';
import {bankRemoval} from './upload-safety-rules.mjs';
// "Delete and redo" (build 2806). One plan and one apply for a mistaken summary or payroll run. The plan says what is possible for this person right now and
// who must do the rest. Apply reuses the existing withdraw, return and discard actions, so the same database rules, locks and audit apply. Nothing is deleted.
// Uploads (workbooks) get a plan here; the removal itself stays the existing document_archive action.
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const LIVE=['Requested','Approved','Reversing','Ready','Replacement saved'];

async function importFacts(tx:any,pid:string,id:string){
 const r=(await tx`select import_id,kind,status,prepared_by,reviewed_by,starts_on,ends_on,revision,document_id,discard_reason,discarded_at from erp_private.period_imports where import_id=${id} and project_id=${pid}`)[0];
 if(!r)fail(404,'This summary is unavailable.');
 const journals=Number((await tx`select count(distinct s.journal_id)::int n from erp_private.ledger_sources s where s.source_kind='Period import' and (s.source_key=${id} or s.source_key like ${id+':%'})`)[0].n);
 const taxCases=Number((await tx`select count(*)::int n from erp_private.tax_cases where project_id=${pid} and inputs->>'period_import_id'=${id}`)[0].n);
 const amendmentLive=!!(await tx`select 1 from erp_private.import_amendments where import_id=${id} and status=any(${tx.array(LIVE)}::text[]) limit 1`).length;
 const taxOpen=!!(await tx`select erp_private.tax_period_open(${pid}::uuid,${day(r.starts_on)}::date,${day(r.ends_on)}::date) open`)[0].open;
 return {record:r,facts:{kind:r.kind,status:r.status,prepared_by:r.prepared_by,reviewed_by:r.reviewed_by,starts_on:r.starts_on,ends_on:r.ends_on,journals,tax_cases:taxCases,amendment_live:amendmentLive,tax_open:taxOpen}};
}
async function currentRevision(tx:any,id:string){return String((await tx`select revision from erp_private.period_imports where import_id=${id}`)[0].revision);}

export async function deleteRedoAction(tx:any,a:any,p:any){
 if(!String(p.action||'').startsWith('delete_redo_'))return undefined;
 if(!['delete_redo_plan','delete_redo_apply'].includes(p.action))fail(400,'Unknown action.');
 if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
 const pid=uuid(p.project_id),project=(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is unavailable to your account.');
 const me={staff_id:a.staff_id,category_code:a.category_code};

 if(p.document_id){
  if(p.action!=='delete_redo_plan')fail(400,'Remove an upload with the upload list; this shows what is possible.');
  const documentId=uuid(p.document_id);
  const doc=(await tx`select document_id,file_name,uploaded_by,archived_at from erp_private.documents where document_id=${documentId} and project_id=${pid} and deleted_at is null`)[0];
  if(!doc)fail(404,'This upload is unavailable.');
  if(doc.archived_at)return {target:'upload',file_name:doc.file_name,plan:{what:'upload',stage:'Removed',can_apply:false,apply:null,blockers:[],steps:['Already removed from active mapping. Upload the corrected file.'],keeps:'The file stays in the history.'}};
  const counts=(await tx`select count(r.row_id)::int rows,count(r.row_id) filter(where erp_private.row_locks_upload(r))::int locked from erp_private.workbook_batches b left join erp_private.workbook_rows r using(batch_id) where b.document_id=${documentId} and b.archived_at is null`)[0];
  const imports=Number((await tx`select count(*)::int n from erp_private.period_imports where document_id=${documentId} and status<>'Discarded'`)[0].n);
  const opening=await tx`select status from erp_private.ledger_journals where source_snapshot->>'document_id'=${documentId}::text`;
  const plan=uploadPlan({rows:counts.rows,protected_rows:counts.locked,imports,journals:opening.filter((x:any)=>['Submitted','Posted'].includes(x.status)).length,opening_submitted:opening.filter((x:any)=>x.status==='Submitted').length,uploaded_by:doc.uploaded_by},me);
  // Build 2903: a bank statement shows exactly what would be archived, and is refused once anything from it is in use.
  const bankFacts=await bankRemovalFacts(tx,documentId,doc.file_name),bank=bankFacts?bankRemoval(bankFacts):null;
  if(bank&&!bank.allowed){plan.can_apply=false;plan.apply=null;plan.controlled=false;plan.blockers=[...(plan.blockers||[]),...bank.reasons];plan.steps=bank.instead;}
  return {target:'upload',document_id:documentId,file_name:doc.file_name,rows:counts.rows,plan,bank};
 }

 const importId=uuid(p.import_id);
 const {record,facts}=await importFacts(tx,pid,importId);
 const plan=importPlan(facts,me);
 const history=record.status==='Discarded'?{discarded_at:record.discarded_at,reason:record.discard_reason}:null;
 if(p.action==='delete_redo_plan')return {target:'summary',import_id:importId,kind:record.kind,revision:String(record.revision),plan,history};

 if(project.status==='Archived')fail(400,'Archived projects retain read-only accounting history.');
 if(String(record.revision)!==revision(p.revision))fail(409,'The summary changed. Refresh first.');
 if(!plan.can_apply)fail(409,plan.blockers[0]||plan.steps[0]||'This cannot be removed from here.');
 const why=text(p.reason||'',1000,false).trim();
 if(why.length<5)fail(400,'Say why this is being removed (at least 5 characters).');
 const base={project_id:pid,import_id:importId},done:string[]=[];
 if(plan.apply==='withdraw_discard'){
  await withdrawAction(tx,a,{action:'work_withdraw',kind:'period_import',record_id:importId,revision:String(record.revision),reason:why});done.push('Withdrawn from review');
 }
 if(plan.apply==='return_discard'||plan.apply==='return'){
  await periodImportAction(tx,a,{...base,action:'period_import_review',revision:String(record.revision),status:'Returned',review_note:'Returned for removal: '+why},null);done.push('Returned to the preparer');
 }
 if(plan.apply!=='return'){
  await periodImportAction(tx,a,{...base,action:'period_import_discard',revision:await currentRevision(tx,importId),reason:why},null);done.push('Discarded');
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'period_imports','DELETE_AND_REDO_APPLIED',${importId},${tx.json({kind:record.kind,from:record.status,steps:done,reason:why,starts_on:day(record.starts_on),ends_on:day(record.ends_on)})})`;
 return {ok:true,steps:done,status:plan.apply==='return'?'Returned':'Discarded',redo:plan.redo,kind:record.kind,document_id:record.document_id||null};
}
