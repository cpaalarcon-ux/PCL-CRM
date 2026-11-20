import {fail} from './validation.mjs';
import {firstSupportedStart,unsupportedPeriodMessage} from './ledger-rules.mjs';
// One rule for every place a period can begin: nothing may start before the client's first financial year that ends on or after 31 Dec 2025.
export async function assertSupportedPeriod(tx:any,clientId:string,start:string){
 const c=(await tx`select year_end_month,year_end_day from erp_private.clients where client_id=${clientId}`)[0];
 const first=firstSupportedStart(c?.year_end_month||12,c?.year_end_day||31);
 if(start<first)fail(400,unsupportedPeriodMessage(first));
}
