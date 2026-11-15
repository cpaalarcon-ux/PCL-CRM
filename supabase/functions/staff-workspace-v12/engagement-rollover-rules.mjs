// Rolling an engagement set-up forward to the next period (build 2811). Pure rules.
// What carries forward: the template (its current approved version), the project, the scope, the responsible person and reviewer, the tasks the team dropped, and
// the unresolved items of the period just ended. What never carries forward: the dates, the status, the evidence and any completion or approval. Every task of the
// new period starts again as Pending and is judged on its own. The mappings are the client's, not the period's, so they are already in force and are not copied.
const iso=d=>d.toISOString().slice(0,10);
const parse=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s))?new Date(s+'T00:00:00Z'):null;
const lastOfMonth=(y,m)=>new Date(Date.UTC(y,m+1,0));
export const MAX_CARRIED=50;

// The period after this one. A run of whole calendar months is followed by the same number of months; any other period by the same number of days.
export function nextPeriod(start,end){
 const a=parse(start),b=parse(end);if(!a||!b||b<a)return null;
 const whole=a.getUTCDate()===1&&b.getUTCDate()===lastOfMonth(b.getUTCFullYear(),b.getUTCMonth()).getUTCDate();
 const ns=new Date(b);ns.setUTCDate(ns.getUTCDate()+1);
 if(whole){const months=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()+1;const e=lastOfMonth(ns.getUTCFullYear(),ns.getUTCMonth()+months-1);return {start:iso(ns),end:iso(e),months,kind:'months'};}
 const days=Math.round((b-a)/86400000)+1;const ne=new Date(ns);ne.setUTCDate(ne.getUTCDate()+days-1);return {start:iso(ns),end:iso(ne),days,kind:'days'};
}
export const periodsOverlap=(aStart,aEnd,bStart,bEnd)=>aStart<=bEnd&&bStart<=aEnd;

// The items of the period just ended that are still open. Only the facts are copied (what it is, why it is stuck); the status is not.
export function carriedItems(tasks){
 return (tasks||[]).filter(t=>!['Completed','Cancelled'].includes(t.status)&&!t.deleted_at).slice(0,MAX_CARRIED)
  .map(t=>({task_id:t.task_id,task_name:t.task_name,was:t.status,due_at:t.due_at||null,blocked_reason:t.status==='Blocked'?(t.blocked_reason||null):null}));
}
// Who is due: the latest released set-up for each client and service, when its period has ended (or ends within lookAhead days) and nothing follows it.
export function dueForRollover(setups,today,lookAheadDays=7){
 const limit=new Date(Date.parse(today+'T00:00:00Z')+lookAheadDays*86400000).toISOString().slice(0,10);
 const latest=new Map();
 for(const s of setups||[]){const k=s.client_id+'|'+s.service_code;const cur=latest.get(k);if(!cur||s.period_end>cur.period_end)latest.set(k,s);}
 return [...latest.values()].filter(s=>s.status==='Released'&&s.period_end<=limit).map(s=>({...s,next:nextPeriod(s.period_start,s.period_end),overdue:s.period_end<today}))
  .sort((a,b)=>a.period_end.localeCompare(b.period_end)||String(a.client_name||'').localeCompare(String(b.client_name||'')));
}
