// Onboarding run: where each client has got to, and the one thing that comes next. Pure rules, no database. Nothing here changes a record.
import {REQUIRED_MINIMUM} from './setup-review-rules.mjs';
export const STAGES=Object.freeze([
 {key:'SEND',label:'Send set-up for approval',action:'setup-bulk',help:'The minimum sections have not all been sent yet.'},
 {key:'APPROVE_SETUP',label:'Approve set-up',action:'setup-approve-ready',help:'Sent sections are waiting for a Manager or Partner.'},
 {key:'CHART_PREPARE',label:'Prepare the chart of accounts',action:'bulk-setup',op:'CHART_PROPOSE',help:'No chart has been prepared.'},
 {key:'CHART_APPROVE',label:'Approve the chart of accounts',action:'bulk-setup',op:'CHART_APPROVE',help:'A chart is waiting for a different Manager or Partner.'},
 {key:'KYC',label:'Verify KYC',action:'bulk-setup',op:'KYC_VERIFY',help:'The KYC file is not verified.'},
 {key:'NO_ENGAGEMENT',label:'Set up a service',action:'bulk-setup',op:'ENGAGEMENT',help:'No engagement has been set up.'},
 {key:'LETTER',label:'Signed engagement letter',action:'engagement-letters',help:'A draft engagement has no verified signed letter.'},
 {key:'OPENING',label:'Opening trial balance',action:'',help:'The opening TB for the financial year is not posted. This is done on the client, by a different Manager or Partner.'},
 {key:'ACTIVATE',label:'Activate the engagement',action:'bulk-setup',op:'ENGAGEMENT_ACTIVATE',help:'Ready to activate.'},
 {key:'DONE',label:'Active',action:'',help:'An engagement is active.'}
]);
const done=s=>s==='Approved';
// c: {sections:{code:status}, chart:'Approved'|'Draft'|null, kyc_verified, drafts:[{letter_ok}], active:number, opening_required, opening_posted}
export function stageOf(c){
 const drafts=c.drafts||[];
 if((c.active||0)>0&&!drafts.length)return 'DONE';
 const sec=c.sections||{};
 if(REQUIRED_MINIMUM.some(code=>!sec[code]||sec[code]==='Draft'||sec[code]==='Correction Required'||sec[code]==='Blocked'))return 'SEND';
 if(REQUIRED_MINIMUM.some(code=>!done(sec[code])))return 'APPROVE_SETUP';
 if(c.chart!=='Approved')return c.chart==='Draft'?'CHART_APPROVE':'CHART_PREPARE';
 if(!c.kyc_verified)return 'KYC';
 if(!drafts.length)return 'NO_ENGAGEMENT';
 if(drafts.some(d=>!d.letter_ok))return 'LETTER';
 if(c.opening_required&&!c.opening_posted)return 'OPENING';
 return 'ACTIVATE';
}
export function summarise(rows){
 const counts=Object.fromEntries(STAGES.map(s=>[s.key,0]));
 for(const r of rows)counts[r.stage]=(counts[r.stage]||0)+1;
 return counts;
}
