// Partner exceptional reopen of a confirmed source summary (build 2823). Pure rules; the database repeats the hard ones.
// A confirmed summary is reopened only when nothing has been built from it. Anything posted goes through an amendment, which reverses the entries first.
export const MIN_REASON=30;
export const REOPEN_LABEL='Partner exceptional reopen';
const money=n=>Math.round((Number(n)||0)*100)/100;

export function reasonProblem(reason){
 const r=String(reason||'').trim();
 if(r.length<MIN_REASON)return `Say why the confirmed summary is being reopened (at least ${MIN_REASON} characters).`;
 if(r.length>2000)return 'The reason is too long (2,000 characters at most).';
 if(new Set(r.toLowerCase().replace(/[^a-z0-9]/g,'')).size<8)return 'Write a real reason: what was wrong, and how it was found.';
 return '';
}
// facts: {status, kind, tax_open, entries, live_amendments, archived}
// Returns every reason the reopen cannot go ahead; empty means it can.
export function reopenBlockers(f){
 const x=f||{},out=[];
 if(x.archived)out.push('The project is archived. Archived work is read-only.');
 if(x.status!=='Confirmed')out.push(`Only a confirmed summary is reopened this way (this one is ${String(x.status||'unknown').toLowerCase()}).`);
 if(!['Sales','Payroll'].includes(x.kind))out.push('Only sales and payroll summaries can be reopened here.');
 if(x.tax_open===false)out.push('This period is in submitted or locked tax work. Return the tax case first.');
 if(Number(x.entries)>0)out.push(`${x.entries} accounting entr${Number(x.entries)===1?'y was':'ies were'} prepared from this summary. Amend the summary so the entries are reversed first.`);
 if(Number(x.live_amendments)>0)out.push('An amendment is already in progress for this summary. Finish or cancel it first.');
 return out;
}
export function reopenNote(reason,who){return `${REOPEN_LABEL}${who?' by '+who:''}: ${String(reason||'').trim()}`.slice(0,4000);}
export function priorTotals(kind,payload){
 if(kind==='Payroll'){const rows=Array.isArray(payload?.calculated)?payload.calculated:[];return {employees:rows.length,gross:money(rows.reduce((n,r)=>n+(Number(r.gross)||0),0)),net:money(rows.reduce((n,r)=>n+(Number(r.net_pay)||0),0))};}
 const g=Array.isArray(payload?.groups)?payload.groups:[],net=money(g.reduce((n,r)=>n+(Number(r.net)||0),0)),vat=money(g.reduce((n,r)=>n+(Number(r.vat)||0),0));
 return {net,vat,gross:money(net+vat),categories:g.length};
}
export function afterReopenAdvice(replaces){
 return replaces>0?'The summary is back with the preparer. It replaced earlier versions, so discard it and prepare the period again; it is confirmed by an independent reviewer as usual.'
  :'The summary is back with the preparer. Submit it again after any correction; an independent reviewer confirms it as usual.';
}
