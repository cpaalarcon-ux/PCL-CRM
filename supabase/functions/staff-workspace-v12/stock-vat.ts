// Stock by VAT category: sales by category from confirmed sales imports, and the month-lock gate.
import {vatGateIssues,asDay} from './improvement-rules.mjs';
import {money} from './accounting-rules.mjs';
export async function salesNetByCategory(tx:any,projectId:string,starts:any,ends:any){
 const rows=await tx`select payload from erp_private.period_imports where project_id=${projectId} and kind='Sales' and status='Confirmed' and starts_on>=${asDay(starts)} and ends_on<=${asDay(ends)}`;
 const out:Record<string,number>={};
 // Sales groups are already net of signed credit-note rows. The separate
 // credit_net field is a disclosure total and must not be subtracted twice.
 for(const r of rows)for(const g of r.payload?.groups||[])out[g.vat_category]=money((out[g.vat_category]||0)+Number(g.net||0));
 return out;
}
export async function stockGateIssues(tx:any,projectId:string,starts:any,ends:any){
 const s=asDay(starts),e=asDay(ends);
 const c=(await tx`select c.vat_categories_sold from erp_private.projects p join erp_private.clients c on c.client_id=p.client_id where p.project_id=${projectId}`)[0];
 if(!c?.vat_categories_sold)return [];
 const wholesale=await tx`select 1 from erp_private.client_activities a join erp_private.projects p on p.client_id=a.client_id where p.project_id=${projectId} and a.pack_code='Wholesale' and a.effective_from<=${e} and (a.effective_to is null or a.effective_to>=${s}) limit 1`;
 if(!wholesale.length)return [];
 const controls=await tx`select vat_category,status,result from erp_private.stock_controls where project_id=${projectId} and vat_category is not null and starts_on<=${s} and ends_on>=${e}`;
 const resaleRows=await tx`select r.normalized->>'vat_category' cat,count(*)::int n from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${projectId} and b.archived_at is null and b.period_start>=${s} and b.period_end<=${e} and not r.is_split_parent and r.route=1 and r.dataset in ('Purchases','Expenditure','Non-eTIMS') group by 1`;
 return vatGateIssues({sold:c.vat_categories_sold,controls,resale:Object.fromEntries(resaleRows.map((x:any)=>[x.cat,x.n])),sales:await salesNetByCategory(tx,projectId,s,e)});
}
