// Test helpers: an approved client chart, and journals posted (and optionally reversed) from workbook rows.
export async function approveChart(tx,{C,prepared,reviewed,from='2026-01-01',exclude=[]}){
 const codes=(await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code`).map(r=>r.code).filter(c=>!exclude.includes(c));
 await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C},${from},'Limited company',${'{Wholesale}'},${'{'+codes.join(',')+'}'},'Approved',${prepared},${reviewed},now(),'Fictional approval')`;
 return codes;
}
// Posts one balanced Purchases journal per row (independent reviewer), links it to the row, and can reverse it afterwards.
export async function postRows(tx,{P,C,F,preparer,reviewer},rowIds,{account,date='2026-04-10',reverse=false}={}){
 let per=(await tx`select period_id from erp_private.ledger_periods where project_id=${P} and starts_on='2026-01-01'`)[0];
 if(!per)per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${C},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${preparer}) returning period_id`)[0];
 const out=[];
 for(const rowId of rowIds){
  const ref='POST-'+rowId.slice(0,8),j=(await tx`insert into erp_private.ledger_journals(period_id,project_id,kind,journal_date,reference,evidence,prepared_by,last_prepared_by) values(${per.period_id},${P},'Purchases',${date},${ref},'Fictional supporting evidence',${preparer},${preparer}) returning journal_id`)[0];
  await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,debit,credit) values(${j.journal_id},${P},1,${account},1000,0),(${j.journal_id},${P},2,'10000',0,1000)`;
  await tx`update erp_private.ledger_journals set status='Submitted' where journal_id=${j.journal_id}`;
  await tx`update erp_private.ledger_journals set status='Posted',reviewed_by=${reviewer},review_note='Fictional independent review' where journal_id=${j.journal_id}`;
  await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id) values('Workbook row',${rowId},${j.journal_id},${P})`;
  if(reverse){
   const r=(await tx`insert into erp_private.ledger_journals(period_id,project_id,kind,journal_date,reference,evidence,prepared_by,last_prepared_by,reversal_of) values(${per.period_id},${P},'Reversal',${date},${'REV-'+rowId.slice(0,8)},'Fictional reversal evidence',${preparer},${preparer},${j.journal_id}) returning journal_id`)[0];
   await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,debit,credit) values(${r.journal_id},${P},1,${account},0,1000),(${r.journal_id},${P},2,'10000',1000,0)`;
   await tx`update erp_private.ledger_journals set status='Submitted' where journal_id=${r.journal_id}`;
   await tx`update erp_private.ledger_journals set status='Posted',reviewed_by=${reviewer},review_note='Fictional independent review' where journal_id=${r.journal_id}`;
  }
  out.push(j.journal_id);
 }
 return out;
}
