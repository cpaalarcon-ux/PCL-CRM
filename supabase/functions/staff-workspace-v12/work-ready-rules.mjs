// Build 2847: "Work-ready" status and set-up progress. Pure rules, no database, nothing here approves, posts or changes a record.
// "Healthy" on a client card means the client can be worked on: the legal and engagement prerequisites are in place. It does not mean every set-up
// section has been reviewed. The Chart of Accounts and the other sections are shown as progress (and as "needed before posting"), never as a blocker,
// unless a Partner has chosen to add the approved chart to the test (the dated choice in client_status_policy).
// The server works these out from the records every time they are asked for; the figures are never stored, so they cannot go stale.
import {SECTIONS} from './setup-review-rules.mjs';

export const PIN_FORMAT=/^[A-Z][0-9]{9}[A-Z]$/;
export const SECTION_TOTAL=SECTIONS.length;

const clean=v=>String(v??'').trim().toUpperCase();
export const pinFormatOk=v=>PIN_FORMAT.test(clean(v));

// facts, one client (all plain values, worked out in SQL):
//  kra_pin, kyc_verified (verified_by set), kyc_current (review_due not passed), edd_needed (PEP or High risk), edd_ok,
//  engagements (open Draft or Active projects), engagements_with_lead (one with a Manager or Partner assigned), engagements_with_letter
//  (one with a verified signed letter that has not expired), chart ('Approved'|...), opening ('Approved'|...), approved_sections (codes)
// requireChart: the Partner's choice (default false).
export function workReady(f,{requireChart=false}={}){
 const kycOk=!!f.kyc_verified&&!!f.kyc_current&&(!f.edd_needed||!!f.edd_ok);
 const kycWhy=!f.kyc_verified?'KYC is not verified yet':!f.kyc_current?'The KYC review date has passed':f.edd_needed&&!f.edd_ok?'Enhanced due diligence needs a Partner’s approval':'';
 const pinSet=!!clean(f.kra_pin);
 const gates=[
  {key:'kyc',label:'KYC verified',ok:kycOk,detail:kycOk?'':kycWhy},
  {key:'pin',label:'KRA PIN recorded and in the right format',ok:pinFormatOk(f.kra_pin),detail:pinFormatOk(f.kra_pin)?'':pinSet?'The PIN is not one letter, nine digits and one letter':'No KRA PIN recorded'},
  {key:'engagement',label:'Engagement created, with a Manager or Partner assigned',ok:Number(f.engagements_with_lead)>0,detail:Number(f.engagements_with_lead)>0?'':Number(f.engagements)>0?'No Manager or Partner is assigned to the engagement':'No engagement created yet'},
  {key:'letter',label:'Signed engagement letter verified',ok:Number(f.engagements_with_letter)>0,detail:Number(f.engagements_with_letter)>0?'':'No verified, current signed letter'}
 ];
 if(requireChart)gates.push({key:'chart',label:'Chart of Accounts approved (Partner’s choice)',ok:f.chart==='Approved',detail:f.chart==='Approved'?'':'The chart is '+String(f.chart||'Draft').toLowerCase()});
 const open=gates.filter(g=>!g.ok);
 return {ready:!open.length,gates,open_gates:open.map(g=>g.key)};
}

// Progress is the share of the nine set-up sections that are Approved. The chart and opening trial balance are listed separately as
// "needed before posting": they have their own blocking approvals and are not part of the percentage.
export function setupProgress(f){
 const done=new Set(f.approved_sections||[]);
 const missing=SECTIONS.filter(s=>!done.has(s.code)).map(s=>({code:s.code,label:s.label}));
 const total=SECTIONS.length,count=total-missing.length;
 const before=[];
 if(f.chart!=='Approved')before.push('Chart of Accounts');
 if(f.opening!=='Approved')before.push('Opening Trial Balance');
 return {sections_done:count,sections_total:total,pct:Math.round(count/total*100),missing,needed_before_posting:before};
}

export const clientReadiness=(f,opts)=>({client_id:f.client_id,...workReady(f,opts),progress:setupProgress(f)});
