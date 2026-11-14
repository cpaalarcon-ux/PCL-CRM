import {fail} from './validation.mjs';
// The credit-note answer recorded when old invoice-by-invoice sales were replaced. The new totals import must agree with it.
export async function recordedCreditBasis(tx:any,pid:string,start:string,end:string):Promise<string|null>{
 const r=(await tx`select credit_basis from erp_private.legacy_sales_replacements where project_id=${pid} and starts_on<=${end} and ends_on>=${start} order by prepared_at desc limit 1`)[0];
 return r?.credit_basis||null;
}
export function creditBasisIssue(recorded:string|null,chosen:any){
 if(recorded&&chosen&&chosen!==recorded)return `The replacement of the old sales for these dates was prepared with the answer “${recorded}”. Use the same answer for the new totals.`;
 return null;
}
export {fail};
