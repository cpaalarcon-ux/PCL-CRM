// Report-readiness gate for the annual statements pack (build 2817). Pure rules.
// It is the same gate as every report (sources for every month of the year, rows mapped, journals posted, balanced trial balance, totals tied to it,
// no open exceptions, independent sign-off) plus the checks only an annual pack has: the reporting basis, an approved statement-line map, no legacy or unresolved
// balances, prior-year comparatives, and statements that are complete and agree with the trial balance. Stock is a separate warning, never a blocker.
// Nothing passes by default: statements that have not been built, or comparatives that are not there, fail; they are never treated as zero.
const PACK_CHECKS=['REPORTING_BASIS','MAP_APPROVED','NO_LEGACY','NO_UNRESOLVED','COMPARATIVES'];
// Legal-form checks (build 2870) count only when the pack reports them; a partnership has the extra profit-share check.
const LEGAL_CHECKS=['LEGAL_FORM','PARTNER_SHARES','PPE_REGISTER','SUPPORT_SCHEDULES','PARTNER_EQUITY'];
// The Partner's approval of the notes (build 2873) is a final-stage step like the sign-off: until it is given the pack is still ready for review.
const FINAL_STEPS=['SIGN_OFF','A_NOTES_APPROVED','A_WORDING_COMPLETE','A_CLIENT_PAGES','A_AUDIT_LOCKED'];
// gate: reportGate() result for the Year end report of this client year. pack: packReadiness() result. statementProblems: the problems list of the built statements, or null if they could not be built.
export function annualGate({gate,pack,statementProblems}){
 const base=(gate&&gate.checks)||[],checks=base.filter(c=>c.code!=='SIGN_OFF'),signOff=base.find(c=>c.code==='SIGN_OFF')||{code:'SIGN_OFF',label:'Signed off by an independent reviewer',ok:false,detail:'No independent sign-off.'};
 const byCode=new Map(((pack&&pack.checks)||[]).map(c=>[c.code,c]));
 for(const code of PACK_CHECKS){
  const c=byCode.get(code);
  checks.push(c?{code:'A_'+code,label:c.label,ok:c.status==='Pass',detail:c.status==='Pass'?'':(c.detail||'Not ready.')}:{code:'A_'+code,label:code,ok:false,detail:'This annual check could not be read.'});
 }
 for(const code of LEGAL_CHECKS){const c=byCode.get(code);if(c&&c.status!=='Info')checks.push({code:'A_'+code,label:c.label,ok:c.status==='Pass',detail:c.status==='Pass'?'':(c.detail||'Not ready.')});}
 {const c=byCode.get('NOTES_APPROVED');if(c&&c.status!=='Info')checks.push({code:'A_NOTES_APPROVED',label:c.label,ok:c.status==='Pass',detail:c.status==='Pass'?'':(c.detail||'Not ready.')});}
 {const c=byCode.get('WORDING_COMPLETE');if(c&&c.status!=='Info')checks.push({code:'A_WORDING_COMPLETE',label:c.label,ok:c.status==='Pass',detail:c.status==='Pass'?'':(c.detail||'Not ready.')});}
 {const c=byCode.get('CLIENT_PAGES');if(c&&c.status!=='Info')checks.push({code:'A_CLIENT_PAGES',label:c.label,ok:c.status==='Pass',detail:c.status==='Pass'?'':(c.detail||'Not ready.')});}
 {const c=byCode.get('AUDIT_LOCKED');if(c&&c.status!=='Info')checks.push({code:'A_AUDIT_LOCKED',label:c.label,ok:c.status==='Pass',detail:c.status==='Pass'?'':(c.detail||'Not ready.')});}
 const probs=Array.isArray(statementProblems)?statementProblems:null;
 checks.push({code:'A_STATEMENTS',label:'Statements complete and agree with the trial balance',ok:probs!==null&&probs.length===0,detail:probs===null?'The statements could not be built.':probs.slice(0,4).join(' ')+(probs.length>4?` (+${probs.length-4} more)`:'')});
 checks.push(signOff);
 const failing=checks.filter(c=>!c.ok).map(c=>c.code),ready=failing.length===0,onlySignOff=failing.length>0&&failing.every(c=>FINAL_STEPS.includes(c));
 return {ready,ready_for_review:ready||onlySignOff,checks,failing,mark:ready?'FINAL':'DRAFT',status:ready?'Final':onlySignOff?'Ready for review':'Draft - not ready',warnings:(gate&&gate.warnings)||[]};
}
export function annualBanner(g){
 return g.ready?'':'DRAFT — NOT FOR RELEASE. Open checks: '+g.checks.filter(c=>!c.ok).map(c=>c.label).join('; ')+'.';
}
