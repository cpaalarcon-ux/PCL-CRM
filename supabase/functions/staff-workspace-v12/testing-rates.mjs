import {dateString,testRate} from './tax-registry.mjs';
export const TAX_TESTING_PROJECT_URL='https://yfjiculexbzpkvtapudk.supabase.co';
export const taxTestingEnabled=projectUrl=>projectUrl===TAX_TESTING_PROJECT_URL;
export function testingAuthorizationIssue(confirmed,note){
 if(confirmed!==true)return 'Confirm this rate is for staging tests only.';
 if(typeof note!=='string'||note.trim().length<20)return 'Record the test purpose, period and expected result (at least 20 characters).';
 return null;
}
export function stagingRates(rows,projectUrl){
 const staging=taxTestingEnabled(projectUrl);
 return rows.filter(r=>!testRate(r)&&(r.status==='Approved'||staging&&r.status==='Testing')).map(r=>r.status==='Testing'?{...r,status:'Approved',source_status:'Testing',approval_scope:'Testing'}:{...r,approval_scope:'Reviewed'});
}
export function preferredRates(rows,key,start,end){
 const matching=rows.filter(r=>r.rate_key===key&&dateString(r.effective_from)<=start&&dateString(r.effective_to)>=end);
 const testing=matching.filter(r=>r.approval_scope==='Testing');
 if(testing.length)return testing;
 const formal=matching.filter(r=>r.approval_scope!=='Testing');
 return formal.length?formal:[];
}
