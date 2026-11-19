// Build 2901: the preparer must view the upload summary before sending a tax case for review. Pure rules.
// The summary (build 2894) says what mapped and what was left as a draft. A view is recorded against a fingerprint of that summary, so it counts only while what the preparer saw is still what the summary says.
// If rows are mapped, unmapped, added or archived afterwards the fingerprint changes and the summary must be opened again. Nothing here maps, approves or posts anything.
export const COST_DATASETS=['Purchases','Expenditure','Non-eTIMS'];
// Kinds that read no purchase or expenditure rows are not held: PAYE reads the payroll summary alone (see taxSummary).
export const KINDS_WITHOUT_COST_ROWS=['PAYE'];
const cents=n=>Math.round(Number(n||0)*100);
// summary is the result of summariseRows(). The fingerprint is a plain readable string, so it can be compared and shown in an audit record.
export function summaryFingerprint(summary){
 const s=summary||{},m=(s.mapped||[]).map(x=>`m${x.route}:${x.rows}:${cents(x.net)}`),d=(s.drafts||[]).map(x=>`d${x.code}:${x.rows}:${cents(x.net)}`).sort();
 return [`rows:${Number(s.mapped_rows||0)+Number(s.draft_rows||0)}`,`net:${cents(s.net)}`,...m,...d].join('|');
}
export function gateApplies(kind,costRowsInPeriod){return !KINDS_WITHOUT_COST_ROWS.includes(kind)&&Number(costRowsInPeriod||0)>0;}
// views: this person's recorded views of this project's summary, newest first: [{fingerprint,viewed_at}]
export function gateIssue({kind,costRowsInPeriod,fingerprint,views}){
 if(!gateApplies(kind,costRowsInPeriod))return null;
 if((views||[]).some(v=>v.fingerprint===fingerprint))return null;
 const earlier=(views||[]).length>0;
 return earlier
  ?'The upload changed since you last opened its summary. Open "Summary of this upload" on the Purchases screen again, then send this case for review.'
  :'Open "Summary of this upload" on the Purchases screen and read what was mapped and what was left as a draft before sending this case for review.';
}
