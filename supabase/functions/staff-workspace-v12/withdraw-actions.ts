import {fail,uuid,text,choice,revision} from './validation.mjs';
// Withdraw from review. The preparer pulls their own submitted work back to Draft, before anyone has checked or reviewed it.
// The database enforces the same rule (preparer only, nobody has acted yet) and only accepts the change while this action holds the withdrawal flag.
const KINDS:any={
 period_import:{table:'period_imports',key:'import_id',flag:'period_import',prep:['prepared_by'],projectCol:'project_id',label:(r:any)=>`${String(r.kind||'').toLowerCase()} summary ${String(r.starts_on).slice(0,10)} to ${String(r.ends_on).slice(0,10)}`,period:true},
 sales_recon:{table:'sales_reconciliations',key:'reconciliation_id',flag:'sales_recon',prep:['prepared_by'],projectCol:'project_id',label:(r:any)=>`${String(r.review_type||'sales').toLowerCase()} sales review ${String(r.starts_on).slice(0,10)} to ${String(r.ends_on).slice(0,10)}`,period:true},
 journal:{table:'ledger_journals',key:'journal_id',flag:'journal',prep:['prepared_by','last_prepared_by'],projectCol:'project_id',label:(r:any)=>`${String(r.kind||'').toLowerCase()} journal ${r.reference}`,checked:true},
 asset:{table:'ledger_assets',key:'asset_id',flag:'asset',prep:['prepared_by','last_prepared_by'],projectCol:'project_id',label:(r:any)=>`asset ${r.asset_name}`},
};
export async function withdrawAction(tx:any,a:any,p:any){
 if(p.action!=='work_withdraw')return undefined;
 if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
 const kind=choice(p.kind,Object.keys(KINDS)),spec=KINDS[kind],id=uuid(p.record_id),reason=text(p.reason,1000);
 if(reason.length<3)fail(400,'Say briefly why you are withdrawing this, so the reviewer knows.');
 const rows=kind==='period_import'?await tx`select * from erp_private.period_imports where import_id=${id} for update`
  :kind==='sales_recon'?await tx`select * from erp_private.sales_reconciliations where reconciliation_id=${id} for update`
  :kind==='journal'?await tx`select * from erp_private.ledger_journals where journal_id=${id} for update`
  :await tx`select * from erp_private.ledger_assets where asset_id=${id} for update`;
 const r=rows[0];
 if(!r)fail(403,'This record is not available to your account.');
 const project=(await tx`select project_id,client_id,status from erp_private.projects where project_id=${r[spec.projectCol]} and deleted_at is null`)[0];
 if(!project)fail(403,'This record is not available to your account.');
 if(project.status==='Archived')fail(400,'Archived projects retain read-only accounting history.');
 if(String(r.revision)!==revision(p.revision))fail(409,'This record changed. Refresh first.');
 if(r.status!=='Submitted')fail(409,'Only work that is waiting for review can be withdrawn.');
 if(!spec.prep.some((c:string)=>r[c]===a.staff_id))fail(403,'Only the person who prepared this can withdraw it.');
 if(r.reviewed_by||spec.checked&&r.checked_by)fail(409,'A reviewer has already started on this. Ask them to return it instead.');
 // A submitted monthly sales review closes its own period, so for it only submitted, locked or filed tax cases count.
 if(spec.period){
  const open=kind==='sales_recon'
   ?!(await tx`select 1 from erp_private.tax_cases c where c.project_id=${project.project_id} and c.status in ('Submitted','Locked','Filed') and c.starts_on<=${r.ends_on} and c.ends_on>=${r.starts_on} limit 1`).length
   :(await tx`select erp_private.tax_period_open(${project.project_id}::uuid,${r.starts_on}::date,${r.ends_on}::date) open`)[0].open;
  if(!open)fail(409,'This period is in submitted or locked tax work. Return the tax work first.');
 }
 await tx`select set_config('erp.withdraw',${spec.flag},true)`;
 if(kind==='period_import')await tx`update erp_private.period_imports set status='Draft' where import_id=${id}`;
 else if(kind==='sales_recon')await tx`update erp_private.sales_reconciliations set status='Draft' where reconciliation_id=${id}`;
 else if(kind==='journal')await tx`update erp_private.ledger_journals set status='Draft' where journal_id=${id}`;
 else await tx`update erp_private.ledger_assets set status='Draft' where asset_id=${id}`;
 await tx`select set_config('erp.withdraw','',true)`;
 const what=spec.label(r),after=(kind==='period_import'?await tx`select revision from erp_private.period_imports where import_id=${id}`
  :kind==='sales_recon'?await tx`select revision from erp_private.sales_reconciliations where reconciliation_id=${id}`
  :kind==='journal'?await tx`select revision from erp_private.ledger_journals where journal_id=${id}`
  :await tx`select revision from erp_private.ledger_assets where asset_id=${id}`)[0];
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,${spec.table},'WITHDRAWN_FROM_REVIEW',${String(id)},${tx.json({kind,record:what,reason,project_id:project.project_id})})`;
 await tx`select erp_private.notify_withdrawn(${project.client_id}::uuid,${what},${reason},${'withdraw:'+kind+':'+id+':'+String(after?.revision)},null::uuid)`;
 return {ok:true,status:'Draft',record:what};
}
