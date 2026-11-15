import {fail,text,uuid,date,choice} from './validation.mjs';
import {obligations as OBLIGATIONS} from './workspace-rules.mjs';
import {sourceChecks,SOURCE_KEYS,SOURCE_LABEL} from './report-gate-rules.mjs';
// "Nothing to report" declarations (build 2817). One client project, one source, one obligation, one month, with the declarant, the date and the reason.
// A declaration can satisfy the period's source-completeness check where nothing has arrived. It never files or acknowledges a return and never approves anything:
// a required NIL return is still prepared, filed and acknowledged as its own steps. A declaration is ended with a reason, never edited or deleted.
const ACTIONS=['ledger_declaration_record','ledger_declaration_end','ledger_declaration_list'];
const WHO=['PARTNER','MANAGER','SUPERVISOR'];
const day=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';
const present=(r:any)=>({declaration_id:r.declaration_id,project_id:r.project_id,source_key:r.source_key,source_label:SOURCE_LABEL[r.source_key as keyof typeof SOURCE_LABEL]||r.source_key,obligation_code:r.obligation_code,month:day(r.period_month).slice(0,7),declarant_name:r.declarant_name,declared_on:day(r.declared_on),reason:r.reason,status:r.status,recorded_by:r.recorded_by,recorded_by_name:r.recorded_by_name,recorded_at:r.recorded_at,ended_by_name:r.ended_by_name||null,ended_at:r.ended_at||null,ended_reason:r.ended_reason||null,revision:String(r.revision)});

export async function declarationAction(tx:any,a:any,p:any,l:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!WHO.includes(a.category_code))fail(403,'A Supervisor, Manager or Partner records or ends a "nothing to report" declaration.');
 if(p.action==='ledger_declaration_list'){
  const rows=await tx`select d.*,erp_private.reviewer_label(d.recorded_by) as recorded_by_name,erp_private.reviewer_label(d.ended_by) as ended_by_name from erp_private.source_declarations d where d.project_id=${l.project_id} and d.period_month>=${day(l.starts_on).slice(0,7)+'-01'} and d.period_month<=${day(l.ends_on)} order by d.period_month desc,d.source_key,d.recorded_at desc limit 500`;
  return {declarations:rows.map(present),sources:SOURCE_KEYS.map((k:string)=>({key:k,label:SOURCE_LABEL[k as keyof typeof SOURCE_LABEL]})),obligations:OBLIGATIONS,me:a.staff_id,leader:['PARTNER','MANAGER'].includes(a.category_code)};
 }
 if(p.action==='ledger_declaration_end'){
  const id=uuid(p.declaration_id),d=(await tx`select * from erp_private.source_declarations where declaration_id=${id} and project_id=${l.project_id} for update`)[0];
  if(!d)fail(403,'This declaration is not available to your account.');
  if(d.status!=='Active')fail(400,'This declaration has already been ended.');
  if(!['PARTNER','MANAGER'].includes(a.category_code)&&d.recorded_by!==a.staff_id)fail(403,'The person who recorded a declaration, a Manager or a Partner ends it.');
  const why=text(p.reason,1000,false);if(String(why).trim().length<5)fail(400,'Give the reason for ending the declaration (at least 5 characters).');
  await tx`update erp_private.source_declarations set status='Ended',ended_by=${a.staff_id},ended_at=now(),ended_reason=${why} where declaration_id=${id}`;
  return {ok:true};
 }
 // record
 const source=choice(p.source_key,SOURCE_KEYS),obligation=choice(p.obligation_code,OBLIGATIONS);
 const ym=String(p.month||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym))fail(400,'Choose the month as YYYY-MM.');
 const monthStart=ym+'-01',monthEnd=new Date(Date.UTC(Number(ym.slice(0,4)),Number(ym.slice(5,7)),0)).toISOString().slice(0,10);
 if(monthEnd<day(l.starts_on)||monthStart>day(l.ends_on))fail(400,'That month is outside this client financial year.');
 const declarant=String(text(p.declarant_name,200,false)||'').trim();if(declarant.length<3)fail(400,'Give the name of the person who declared there is nothing to report.');
 const declaredOn=date(p.declared_on);if(!declaredOn)fail(400,'Give the date of the declaration.');if(declaredOn>new Date(Date.now()+86400000).toISOString().slice(0,10))fail(400,'The declaration date cannot be in the future.');
 const reason=String(text(p.reason,1000,false)||'').trim();if(reason.length<15)fail(400,'Give the reason in at least 15 characters: why there is nothing to report for this month.');
 // The server looks at what has actually arrived for that month. A declaration is for a month with nothing in; it does not replace data that exists.
 const imports=await tx`select kind,status,starts_on,ends_on from erp_private.period_imports where project_id=${l.project_id} and kind in('Sales','Payroll') and status in('Draft','Submitted','Returned','Confirmed') and ends_on>=${monthStart} and starts_on<=${monthEnd}`;
 const batches=await tx`select b.dataset,b.period_start,b.period_end,count(r.row_id)::int as rows,count(r.row_id) filter(where r.route is null and r.account_code is null)::int as unmapped
  from erp_private.workbook_batches b left join erp_private.workbook_rows r on r.batch_id=b.batch_id where b.project_id=${l.project_id} and b.archived_at is null and b.dataset in('Sales','Purchases','Bank') and b.period_end>=${monthStart} and b.period_start<=${monthEnd} group by b.batch_id,b.dataset,b.period_start,b.period_end`;
 const here=sourceChecks({months:[ym],facts:{imports,batches}}).rows.find((r:any)=>r.key===source);
 if(here&&here.state!=='Not received')fail(409,`${SOURCE_LABEL[source as keyof typeof SOURCE_LABEL]} for ${ym} already has data (${here.state}). A "nothing to report" declaration is for a month with nothing in.`);
 const dup=await tx`select declaration_id from erp_private.source_declarations where project_id=${l.project_id} and source_key=${source} and obligation_code=${obligation} and period_month=${monthStart} and status='Active'`;
 if(dup.length)fail(409,'An active declaration already covers this source, obligation and month. End it with a reason before recording another.');
 const [made]=await tx`insert into erp_private.source_declarations(client_id,project_id,source_key,obligation_code,period_month,declarant_name,declared_on,reason,recorded_by) values(${l.client_id},${l.project_id},${source},${obligation},${monthStart},${declarant},${declaredOn},${reason},${a.staff_id}) returning declaration_id`;
 // Nothing else is written: no return is filed, acknowledged or marked, and no approval is given.
 return {ok:true,declaration_id:made.declaration_id,note:'Recorded. This satisfies the source check for that month only. Any required NIL return is still filed and acknowledged as its own step.'};
}
