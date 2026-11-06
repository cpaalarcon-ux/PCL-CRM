import {fail,text,uuid,date,choice} from './validation.mjs';
import {ledgerAction} from './ledger-actions.ts';
// Replace old invoice-by-invoice sales with category totals (Manager or Partner).
// 1. sales_legacy_read: what is there (rows, net, VAT, gross), the posted journals built from them, and which step comes next.
// 2. sales_legacy_prepare: records the credit-note answer, the reason and the counts, and prepares a DRAFT reversal of every posted journal.
//    The reversal goes through the normal journal flow: a different Manager or Partner reviews and posts it.
// 3. sales_legacy_complete: once every reversal is posted, archives the old batches (never deletes) and closes the record.
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Manager or Partner must replace old sales.');};
const money=(v:any)=>Math.round((Number(v)||0)*100)/100;
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const CREDIT=['After credit notes','Before credit notes'];

async function survey(tx:any,pid:string,project:any,start:string,end:string){
 const rows=await tx`select r.row_id,r.batch_id,r.normalized,b.project_id,b.period_start,b.period_end,b.sheet_name,d.file_name
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) join erp_private.documents d on d.document_id=b.document_id
  where r.client_id=${project.client_id} and r.dataset='Sales' and b.archived_at is null and not r.is_split_parent and b.period_start<=${end} and b.period_end>=${start}`;
 const issues:string[]=[],batches=new Map<string,any>();
 for(const r of rows){
  const b=batches.get(r.batch_id)||{batch_id:r.batch_id,file_name:r.file_name,sheet_name:r.sheet_name,period_start:day(r.period_start),period_end:day(r.period_end),rows:0,net:0,vat:0};
  b.rows++;b.net+=Number(r.normalized?.amount||0);b.vat+=Number(r.normalized?.vat||0);batches.set(r.batch_id,b);
  if(r.project_id!==pid&&!issues.some(i=>/another project/.test(i)))issues.push('Some old sales belong to another project of this client. Replace them from that project.');
 }
 const list=[...batches.values()].map(b=>({...b,net:money(b.net),vat:money(b.vat),gross:money(b.net+b.vat)}));
 for(const b of list)if(b.period_start<start||b.period_end>end)issues.push(`${b.file_name} covers ${b.period_start} to ${b.period_end}. Choose dates that cover the whole file so no part is left behind.`);
 const totals={rows:rows.length,net:money(list.reduce((s,b)=>s+b.net,0)),vat:money(list.reduce((s,b)=>s+b.vat,0))};
 (totals as any).gross=money(totals.net+totals.vat);
 const journals=rows.length?await tx`select distinct j.journal_id,j.period_id,j.status,j.reference,j.journal_date,
   (select v.journal_id from erp_private.ledger_journals v where v.reversal_of=j.journal_id order by case v.status when 'Posted' then 0 else 1 end limit 1) reversal_id,
   (select v.status from erp_private.ledger_journals v where v.reversal_of=j.journal_id order by case v.status when 'Posted' then 0 else 1 end limit 1) reversal_status
  from erp_private.ledger_sources s join erp_private.ledger_journals j using(journal_id)
  where s.source_kind='Workbook row' and s.source_key=any(${tx.array(rows.map((r:any)=>r.row_id))}::text[]) and j.kind<>'Reversal' order by j.journal_date,j.reference`:[];
 const open=journals.filter((j:any)=>j.status!=='Posted'),needReversal=journals.filter((j:any)=>j.status==='Posted'&&!j.reversal_id),waiting=journals.filter((j:any)=>j.status==='Posted'&&j.reversal_id&&j.reversal_status!=='Posted');
 if(open.length)issues.push(`${open.length} journal(s) built from these rows are not posted yet (${open.map((j:any)=>j.reference).slice(0,3).join(', ')}). Post or return and withdraw them first.`);
 if(rows.length&&!(await tx`select erp_private.tax_period_open(${pid}::uuid,${start}::date,${end}::date) open`)[0].open)issues.push('The tax period is submitted or locked. Return the submitted work before replacing its sources.');
 const record=(await tx`select * from erp_private.legacy_sales_replacements where project_id=${pid} and status='Open'`)[0]||null;
 const step=!rows.length?'none':issues.length?'blocked':needReversal.length?'prepare':waiting.length?'waiting':record?'archive':journals.length?'prepare':'archive';
 return {rows,batches:list,totals,journals:journals.map((j:any)=>({journal_id:j.journal_id,period_id:j.period_id,reference:j.reference,journal_date:day(j.journal_date),status:j.status,reversal_id:j.reversal_id,reversal_status:j.reversal_status})),issues,need_reversal:needReversal,waiting,record,step};
}

export async function legacySalesAction(tx:any,a:any,p:any,storage:any=null){
 if(!['sales_legacy_read','sales_legacy_prepare','sales_legacy_complete'].includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'Interns can access assigned tasks, not sales sources.');
 const pid=uuid(p.project_id),project=(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is unavailable to your account.');
 const start=date(p.starts_on),end=date(p.ends_on);
 if(!start||!end||end<start)fail(400,'Choose the dates the new category totals will cover.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
 const s=await survey(tx,pid,project,start,end);
 const view={project_id:pid,starts_on:start,ends_on:end,step:s.step,issues:s.issues,totals:s.totals,batches:s.batches,journals:s.journals,
  record:s.record?{replacement_id:s.record.replacement_id,credit_basis:s.record.credit_basis,prepared_at:s.record.prepared_at,journals:s.record.journals}:null,
  explain:'Old invoice-by-invoice sales and category totals cannot be added together. Replacing keeps every old row in the archive and reverses any posted entry through a reviewed journal.'};
 if(p.action==='sales_legacy_read')return view;
 leader(a);
 if(project.status==='Archived')fail(400,'Archived projects cannot change.');
 if(p.action==='sales_legacy_prepare'){
  if(s.step==='none')fail(400,'There are no old invoice-based sales for these dates.');
  if(s.step==='blocked')fail(409,s.issues[0]);
  if(!['prepare','archive'].includes(s.step))fail(409,'A replacement is already in progress for this project. Finish it first.');
  if(s.record)fail(409,'A replacement is already in progress for this project. Finish it first.');
  const basis=choice(p.credit_basis,CREDIT),reason=text(p.reason,2000);
  if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
  if(Number(p.expected_rows)!==s.totals.rows)fail(409,`The number of old rows changed (now ${s.totals.rows}). Review the counts and confirm again.`);
  if(p.confirm!==true)fail(400,'Confirm that you checked the counts and that the old rows will be archived after the reversal is posted.');
  const made:any[]=[];
  for(const j of s.need_reversal){
   const reversal=await ledgerAction(tx,a,{action:'ledger_reverse',project_id:pid,period_id:j.period_id,journal_id:j.journal_id,journal_date:day(j.journal_date),reference:('REV-'+j.reference).slice(0,100),description:'Reversal of old invoice-based sales before category totals replace them',evidence:reason},storage);
   made.push({journal_id:j.journal_id,reversal_id:reversal.journal_id});
  }
  const id=crypto.randomUUID();
  await tx`insert into erp_private.legacy_sales_replacements(replacement_id,project_id,client_id,starts_on,ends_on,credit_basis,batch_ids,row_count,net,vat,gross,journals,reason,prepared_by)
   values(${id},${pid},${project.client_id},${start},${end},${basis},${tx.array(s.batches.map((b:any)=>b.batch_id))}::uuid[],${s.totals.rows},${s.totals.net},${s.totals.vat},${s.totals.gross},${tx.json(made)},${reason},${a.staff_id})`;
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'legacy_sales_replacements','SALES_REPLACEMENT_PREPARED',${pid},${tx.json({replacement_id:id,rows:s.totals.rows,gross:s.totals.gross,reversals:made.length,credit_basis:basis})})`;
  return {ok:true,replacement_id:id,reversals:made,next:made.length?'A different Manager or Partner must review and post each reversal in the ledger journals. Then complete the replacement.':'Nothing was posted, so the old rows can be archived now.'};
 }
 // sales_legacy_complete
 if(!s.record)fail(400,'Prepare the replacement first.');
 if(s.step==='blocked')fail(409,s.issues[0]);
 if(s.step==='waiting')fail(409,`${s.waiting.length} reversal(s) are not posted yet. A different Manager or Partner must review and post them first.`);
 if(s.step==='prepare')fail(409,'A posted journal still has no reversal. Prepare it first.');
 const reason=`Replaced by category totals · ${s.record.reason}`.slice(0,1000);
 await tx`update erp_private.workbook_batches set archived_at=now(),archived_by=${a.staff_id},archive_reason=${reason} where batch_id=any(${tx.array(s.batches.map((b:any)=>b.batch_id))}::uuid[]) and archived_at is null`;
 await tx`update erp_private.legacy_sales_replacements set status='Complete',completed_by=${a.staff_id},completed_at=now() where replacement_id=${s.record.replacement_id}`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'legacy_sales_replacements','SALES_REPLACEMENT_COMPLETED',${pid},${tx.json({replacement_id:s.record.replacement_id,batches:s.batches.length,rows:s.totals.rows})})`;
 return {ok:true,archived_batches:s.batches.length,rows:s.totals.rows,credit_basis:s.record.credit_basis};
}
