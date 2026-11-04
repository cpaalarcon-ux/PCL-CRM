import {fail} from './validation.mjs';
const day=(v:any)=>String(v instanceof Date?v.toISOString():v).slice(0,10);
// Revenue account for a sale: the approved, dated crosswalk row for the VAT category (or rate key), checked against the active REV chart account.
export async function loadCrosswalk(tx:any){
 const rows=await tx`select w.*,a.status account_status,a.is_legacy,a.category_code from erp_private.sales_revenue_crosswalk w join erp_private.account_catalog a on a.code=w.revenue_account where w.status='Approved'`;
 return rows;
}
export function revenueAccount(cross:any[],by:{vat_category?:string,rate_key?:string},on:string){
 const at=day(on),row=cross.find((x:any)=>(by.rate_key?x.rate_key===by.rate_key:x.vat_category===by.vat_category)&&day(x.effective_from)<=at&&(!x.effective_to||day(x.effective_to)>=at));
 if(!row)return null;
 if(row.account_status!=='Active'||row.is_legacy||String(row.category_code).toUpperCase()!==row.routing_code)fail(409,`Revenue account ${row.revenue_account} for ${row.vat_category} sales is not an active REV account in the chart. Ask a Partner to review the sales revenue crosswalk.`);
 return row.revenue_account as string;
}
