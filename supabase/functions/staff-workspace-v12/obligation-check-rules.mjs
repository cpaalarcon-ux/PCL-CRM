// Obligation check at tax-project setup (build 2814). Pure rules.
// Each selected obligation is compared with the client's verified tax profile, the dates it is registered for, and the reporting frequency of the schedule.
// Four states: Confirmed (a filing task may be made), Not registered, Exempt, and Needs verification. Only Confirmed work is made without further steps.
// For any other state a task may be made only under an approved exception: a written reason, requested by one person and approved by a different Manager or Partner.
import {obligationWorkIssue} from './tax-registry.mjs';
export const STATES=['Confirmed','Not registered','Exempt','Needs verification'];
export const EXCEPTION_STATES=['Not registered','Exempt','Needs verification'];
// Every tax return in the schedule is a monthly task; it is only generated when the schedule's frequency includes Monthly.
export const MONTHLY_FREQUENCIES=['Monthly','Weekly + Monthly','Weekly + Monthly + Annually'];
export const MIN_REASON=15;
const d=v=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';
const NOT_REGISTERED_STATUS=['NOT_REGISTERED','DEREGISTERED'];

// profile: a verified client tax profile row (or null); code: the obligation as the tax profile names it; ctx: {start,end,frequency}
export function obligationState(profile,code,ctx={}){
 const out=(state,reason)=>({code,state,reason});
 if(!profile||profile.status!=='Verified')return out('Needs verification','A verified client tax profile does not cover this period.');
 if(!(profile.obligations||[]).includes(code))return out('Not registered',`${code} is not recorded on the client's verified tax profile.`);
 const s=profile.obligation_statuses?.[code];
 if(s){
  if(s.registered==='NO'||NOT_REGISTERED_STATUS.includes(s.client_status))return out('Not registered',`${code}: the client is recorded as not registered or deregistered.`);
  if(s.applicable==='NO')return out('Exempt',`${code}: recorded as not applicable to this client.`);
 }
 const issue=obligationWorkIssue(profile,code);
 if(issue)return out('Needs verification',issue);
 const from=d(s?.effective_from)||d(profile.effective_from),to=d(s?.effective_to)||d(profile.effective_to);
 if(ctx.start&&from&&from>ctx.start||ctx.end&&to&&to<ctx.end)return out('Needs verification',`${code}: the registration is dated ${from||'?'} to ${to||'?'}, which does not cover the whole schedule.`);
 if(ctx.frequency&&!MONTHLY_FREQUENCIES.includes(ctx.frequency))return out('Needs verification',`${code}: the return is monthly, but the schedule's frequency is ${ctx.frequency}, so no ${code} task would be generated on the filing cycle.`);
 return out('Confirmed','');
}
export function checkObligations(profiles,codes,ctx={}){
 const list=profiles||[];
 return (codes||[]).map(code=>{
  if(list.length>1)return {code,state:'Needs verification',reason:'More than one verified tax profile overlaps this schedule. Leave one profile for the period before tax filing work is assigned.'};
  return obligationState(list[0]||null,code,ctx);
 });
}
// An approved exception covers the schedule when it is for the same client and obligation and its period includes the whole schedule.
export function exceptionCovers(ex,code,start,end){
 return !!ex&&ex.status==='Approved'&&ex.obligation_code===code&&d(ex.period_start)<=start&&d(ex.period_end)>=end;
}
// Attach the open exception (if any) to each state and decide whether work can be made.
export function withExceptions(states,exceptions,ctx){
 return states.map(s=>{
  if(s.state==='Confirmed')return {...s,allowed:true,exception:null};
  const covering=(exceptions||[]).find(e=>exceptionCovers(e,s.code,ctx.start,ctx.end));
  const pending=(exceptions||[]).find(e=>e.status==='Requested'&&e.obligation_code===s.code&&d(e.period_start)<=ctx.start&&d(e.period_end)>=ctx.end);
  return {...s,allowed:!!covering,exception:covering||pending||null,exception_status:covering?'Approved':pending?'Requested':null};
 });
}
// The message when a schedule cannot be saved.
export function blockedMessage(rows){
 const bad=rows.filter(r=>!r.allowed);
 if(!bad.length)return null;
 return 'Tax work cannot be scheduled for: '+bad.map(r=>`${r.code} (${r.state}${r.exception_status==='Requested'?', exception awaiting approval':''}): ${r.reason}`).join(' ')+' Resolve it on the client tax profile, or request an exception with a reason for a Manager or Partner to approve.';
}
export function reasonProblem(reason){
 const t=String(reason||'').trim();
 return t.length<MIN_REASON?`Give the reason in at least ${MIN_REASON} characters: why the task is needed although the obligation is not confirmed.`:null;
}
