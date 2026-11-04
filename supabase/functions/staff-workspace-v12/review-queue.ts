// Reviewer choice and the "Waiting for my review" list. The preparer may name a Manager or Partner;
// the named reviewer, or any Partner, decides it. Maker-checker (a different person from the preparer) is still enforced by the database.
import {fail,uuid} from './validation.mjs';
const LEADERS=['PARTNER','MANAGER'];
export async function reviewCandidates(tx:any,clientId:string){return await tx`select staff_id,full_name,category_code from erp_private.review_candidates(${clientId}) order by category_code,full_name`;}
// Validates the preparer's choice; empty means "any Manager or Partner".
export async function chosenReviewer(tx:any,a:any,clientId:string,value:any){
 if(value===undefined||value===null||value==='')return null;
 const id=uuid(value);if(id===a.staff_id)fail(400,'Choose someone other than yourself to review.');
 if(!(await reviewCandidates(tx,clientId)).some((r:any)=>r.staff_id===id))fail(400,'That person is not a Manager or Partner available to review this client.');
 return id;
}
// Called when someone decides a submitted item.
export async function mustBeAskedReviewer(tx:any,a:any,requested:string|null){
 if(!requested||requested===a.staff_id||a.category_code==='PARTNER')return;
 const name=(await tx`select erp_private.reviewer_label(${requested}) n`)[0]?.n||'another reviewer';
 fail(403,`This was sent to ${name} for review. Only that reviewer or a Partner can decide it.`);
}
export async function reviewQueueAction(tx:any,a:any,p:any){
 if(!['v3_review_queue','v3_review_candidates'].includes(p.action))return undefined;
 if(p.action==='v3_review_candidates')return {reviewers:await reviewCandidates(tx,uuid(p.client_id))};
 if(!LEADERS.includes(a.category_code))return {items:[]};
 const asked=(r:any)=>!r.requested_reviewer_id||r.requested_reviewer_id===a.staff_id||a.category_code==='PARTNER';
 const reports=await tx`select r.review_id id,r.project_id,pr.client_id,c.company_name client_name,pr.project_name,r.report_kind,r.starts_on,r.as_of,r.created_at submitted_at,r.requested_reviewer_id,r.period_id from erp_private.ledger_report_reviews r join erp_private.projects pr on pr.project_id=r.project_id join erp_private.clients c on c.client_id=pr.client_id where r.status='Submitted' and r.prepared_by<>${a.staff_id} order by r.created_at`;
 const charts=await tx`select v.version_id id,v.client_id,c.company_name client_name,v.effective_from,v.prepared_at submitted_at,v.requested_reviewer_id from erp_private.client_chart_versions v join erp_private.clients c on c.client_id=v.client_id where v.status='Draft' and v.prepared_by<>${a.staff_id} order by v.prepared_at`;
 // Ledger journals (opening balances included) are the unit of independent review. Posting a depreciation journal also approves its
 // submitted asset in the same action, so assets are not listed separately. A journal you prepared or last edited never appears here.
 const journals=await tx`select j.journal_id id,j.kind,j.reference,j.journal_date,j.project_id,j.period_id,pr.client_id,c.company_name client_name,pr.project_name,j.updated_at submitted_at from erp_private.ledger_journals j join erp_private.projects pr on pr.project_id=j.project_id join erp_private.clients c on c.client_id=pr.client_id where j.status='Submitted' and j.prepared_by<>${a.staff_id} and j.last_prepared_by<>${a.staff_id} order by j.updated_at limit 200`;
 const items=[
  ...journals.map((r:any)=>({kind:'journal',id:r.id,client_id:r.client_id,client_name:r.client_name,project_id:r.project_id,period_id:r.period_id,title:`${r.kind==='Opening'?'Opening balances':r.kind+' journal'} · ${r.reference} · ${r.project_name}`,submitted_at:r.submitted_at,sent_to_me:false})),
  ...reports.filter(asked).map((r:any)=>({kind:'report',id:r.id,client_id:r.client_id,client_name:r.client_name,project_id:r.project_id,period_id:r.period_id,title:`${r.report_kind} report · ${r.project_name}`,submitted_at:r.submitted_at,sent_to_me:r.requested_reviewer_id===a.staff_id})),
  ...charts.filter(asked).map((r:any)=>({kind:'chart',id:r.id,client_id:r.client_id,client_name:r.client_name,title:'Client chart of accounts',submitted_at:r.submitted_at,sent_to_me:r.requested_reviewer_id===a.staff_id}))
 ].sort((x:any,y:any)=>(y.sent_to_me?1:0)-(x.sent_to_me?1:0)||String(x.submitted_at).localeCompare(String(y.submitted_at)));
 return {items};
}
