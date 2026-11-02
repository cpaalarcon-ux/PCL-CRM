import {dateString} from './tax-registry.mjs';
export const TAX_TESTING_PROJECT_URL='https://yfjiculexbzpkvtapudk.supabase.co';
export const taxTestingEnabled=projectUrl=>projectUrl===TAX_TESTING_PROJECT_URL;
export function stagingRates(rows,projectUrl){
 const staging=taxTestingEnabled(projectUrl);
 return rows.filter(r=>r.status==='Approved'||staging&&r.status==='Testing').map(r=>r.status==='Testing'?{...r,status:'Approved',source_status:'Testing',approval_scope:'Testing'}:{...r,approval_scope:'Reviewed'});
}
export function preferredRates(rows,key,start,end){
 const formal=rows.filter(r=>r.rate_key===key&&r.approval_scope!=='Testing'&&dateString(r.effective_from)<=start&&dateString(r.effective_to)>=end);
 return formal.length?formal:rows.filter(r=>r.rate_key===key);
}
