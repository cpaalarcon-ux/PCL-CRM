import {summariseRows} from './purchase-accounts-rules.mjs';
import {COST_DATASETS,summaryFingerprint,gateIssue} from './upload-summary-gate-rules.mjs';
import {fail} from './validation.mjs';

// Build 2901: preparer-must-view-summary gate. The summary read records who opened it and what it showed; sending a tax case for review is refused until the preparer has a recorded view of the current summary.
export async function summaryRows(tx:any,projectId:string){
 return await tx`select r.route,r.account_code,r.review_details->'auto_map_note'->>'code' as note_code,r.review_details->'auto_map_note'->>'reason' as note_reason,nullif(r.normalized->>'amount','')::numeric as amount
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${projectId} and b.archived_at is null and not r.is_split_parent and r.dataset=any(${tx.array(COST_DATASETS)}::text[]) limit 20000`;
}
// Records the signed-in person's view of the summary they were just shown. A repeat view of an unchanged summary is not recorded again.
export async function recordSummaryView(tx:any,a:any,project:any,summary:any){
 const fingerprint=summaryFingerprint(summary);
 const last=(await tx`select fingerprint from erp_private.upload_summary_views where project_id=${project.project_id} and viewed_by=${a.staff_id} order by viewed_at desc,view_id desc limit 1`)[0];
 if(!last||last.fingerprint!==fingerprint)await tx`insert into erp_private.upload_summary_views(project_id,client_id,viewed_by,fingerprint,mapped_rows,draft_rows) values(${project.project_id},${project.client_id},${a.staff_id},${fingerprint},${summary.mapped_rows},${summary.draft_rows})`;
 const mine=(await tx`select viewed_at from erp_private.upload_summary_views where project_id=${project.project_id} and viewed_by=${a.staff_id} and fingerprint=${fingerprint} order by viewed_at desc limit 1`)[0];
 return {viewed_at:mine?.viewed_at||null,fingerprint};
}
// Refuses to send a case for review until its preparer has viewed the current summary. Applies when cost rows lie in the case period; the summary itself covers the whole project, exactly as the person saw it.
export async function assertSummaryViewed(tx:any,c:any){
 const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
 const n=(await tx`select count(*)::int as n from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${c.project_id} and b.archived_at is null and not r.is_split_parent and r.dataset=any(${tx.array(COST_DATASETS)}::text[]) and b.period_start<=${day(c.ends_on)} and b.period_end>=${day(c.starts_on)}`)[0].n;
 if(!n)return;
 const fingerprint=summaryFingerprint(summariseRows(await summaryRows(tx,c.project_id)));
 const views=await tx`select fingerprint,viewed_at from erp_private.upload_summary_views where project_id=${c.project_id} and viewed_by=${c.prepared_by} order by viewed_at desc limit 50`;
 const issue=gateIssue({kind:c.kind,costRowsInPeriod:n,fingerprint,views});
 if(issue)fail(409,issue);
}
