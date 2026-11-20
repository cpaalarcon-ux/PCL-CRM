// Build 2841: two client-level choices on top of firm-wide settings. Pure rules, no database, no clock.
// 1. Which statutory returns a client's payroll service files (the firm approves each export format once in Settings; the client only picks from them).
// 2. A client-specific exception to a firm-wide tax rule: reason and legal basis, proposed by one person, approved by a different Partner or the Tax Lead.
import {RETURNS,RETURN_CODES,profileInForce} from './export-profile-rules.mjs';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export const EXCEPTION_KINDS=Object.freeze({NOT_APPLICABLE:'The firm-wide rule does not apply to this client',VARIATION:'The rule applies to this client with a variation'});
export {RETURNS,RETURN_CODES};

// ---- statutory returns chosen for a client ----------------------------------------------------------------------------------
export function selectionFields(p){
 const rc=clean(p.return_code);if(!RETURNS[rc])return {problem:'Choose the return.'};
 const from=day(p.effective_from);if(!DATE.test(from))return {problem:'Say the first day this return applies to the client.'};
 const note=clean(p.note);if(note.length>500)return {problem:'The note is too long (500 characters at most).'};
 return {values:{return_code:rc,effective_from:from,note:note||null}};
}
export function endFields(p,selection){
 const to=day(p.effective_to),why=clean(p.reason);
 if(!DATE.test(to))return {problem:'Say the last day this return applies.'};
 if(to<day(selection.effective_from))return {problem:'The last day cannot be before the first day.'};
 if(why.length<5||why.length>500)return {problem:'Say why it ends (5 to 500 characters).'};
 return {values:{effective_to:to,reason:why}};
}
// A published export profile must cover the first day, otherwise the file could not be made. Returns {ok} or {problem}.
export function profileCovers(profiles,returnCode,on){
 return profileInForce(profiles,returnCode,on)?{ok:true}:{problem:`No published export profile covers ${RETURNS[returnCode]?.label||returnCode} from ${day(on)}. Publish one in Settings → Upload & Export Templates first.`};
}
// Whether a return may be filed for a payroll month. A client with no choice ever recorded keeps the old behaviour: every return is offered.
export function returnAllowed(selections,returnCode,monthStart,monthEnd){
 const rows=selections||[];
 if(!rows.length)return {allowed:true,configured:false};
 const s=day(monthStart),e=day(monthEnd);
 const hit=rows.find(r=>r.return_code===returnCode&&day(r.effective_from)<=e&&(!r.effective_to||day(r.effective_to)>=s));
 if(hit)return {allowed:true,configured:true};
 return {allowed:false,configured:true,problem:`${RETURNS[returnCode]?.label||returnCode} is not chosen for this client's payroll service for ${s.slice(0,7)}. Choose it in the client file → Tax & returns → Payroll returns.`};
}

// ---- client-specific tax rule exceptions -------------------------------------------------------------------------------------
export function exceptionFields(p,knownRateKeys){
 const key=clean(p.rate_key);if(!key||(Array.isArray(knownRateKeys)&&!knownRateKeys.includes(key)))return {problem:'Choose a tax rule from the central library.'};
 const kind=clean(p.kind);if(!EXCEPTION_KINDS[kind])return {problem:'Say whether the rule does not apply or applies with a variation.'};
 const from=day(p.effective_from),to=p.effective_to?day(p.effective_to):null;
 if(!DATE.test(from))return {problem:'Say the first day the exception applies.'};
 if(to&&(!DATE.test(to)||to<from))return {problem:'The last day cannot be before the first day.'};
 const reason=clean(p.reason);if(reason.length<20||reason.length>1000)return {problem:'Give the reason in 20 to 1,000 characters: what is different about this client.'};
 const basis=clean(p.legal_basis);if(basis.length<10||basis.length>500)return {problem:'Name the legal basis (10 to 500 characters), for example the section or the KRA ruling.'};
 return {values:{rate_key:key,kind,effective_from:from,effective_to:to,reason,legal_basis:basis}};
}
// Who may decide on a proposed exception. A Partner (by rank) or the Tax Lead right; never the person who proposed it.
export function exceptionDecision(row,actor,{taxLead=false}={}){
 if(!row||row.status!=='Draft')return {ok:false,problem:'This exception is not waiting for a decision.'};
 if(row.created_by===actor.staff_id)return {ok:false,problem:'You proposed this exception, so a different Partner or the Tax Lead approves it.'};
 if(actor.category_code!=='PARTNER'&&!taxLead)return {ok:false,problem:'A Partner, or the Tax Lead, approves an exception to a tax rule.'};
 return {ok:true};
}
export function closeFields(p,row,kind){
 const why=clean(p.reason);if(why.length<10||why.length>500)return {problem:'Say why (10 to 500 characters).'};
 if(kind==='end'){const to=day(p.effective_to);if(!DATE.test(to))return {problem:'Say the last day the exception applies.'};if(to<day(row.effective_from))return {problem:'The last day cannot be before the first day.'};return {values:{effective_to:to,reason:why}};}
 return {values:{reason:why}};
}
// Approved exceptions in force on a date for the given rule keys. Used to show an exception beside the rule it varies.
export function exceptionsInForce(rows,rateKeys,on){
 const d=day(on),keys=new Set(rateKeys||[]);
 return (rows||[]).filter(r=>r.status==='Active'&&keys.has(r.rate_key)&&day(r.effective_from)<=d&&(!r.effective_to||day(r.effective_to)>=d));
}
