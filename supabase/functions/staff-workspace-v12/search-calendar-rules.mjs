// Build 2835: search across clients, engagements, projects, tasks and trial-balance accounts, and a month calendar of due dates. Pure helpers; the queries run under the
// signed-in person's own row access, so a result list never shows more than that person could open anyway.
export const MIN_QUERY=2,MAX_QUERY=80,PER_KIND=10;
export function cleanQuery(q){const t=String(q??'').normalize('NFKC').replace(/\s+/g,' ').trim();return t.length>MAX_QUERY?t.slice(0,MAX_QUERY):t;}
export function queryProblem(q){const t=cleanQuery(q);return t.length<MIN_QUERY?`Type at least ${MIN_QUERY} characters to search.`:'';}
// LIKE wildcards in what the person typed are matched literally.
export function likePattern(q){return '%'+cleanQuery(q).replace(/[\\%_]/g,m=>'\\'+m)+'%';}
export function monthRange(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month||'')))return null;
 const [y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate(),p=n=>String(n).padStart(2,'0');
 return {from:`${y}-${p(m)}-01`,to:`${y}-${p(m)}-${p(last)}`,days:last};
}
export function shiftMonth(month,by){const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-1+by,1));return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;}
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const KIND_LABEL={task:'Task due',kra:'KRA due date',kra_suggested:'Suggested KRA date',return:'Return due',internal:'Internal due',payment:'Payment due'};
// Turns the three sources into one dated list. A task that is finished or cancelled is not shown as due. Dates before `today` that are still open are marked overdue.
export function calendarEvents({tasks=[],dues=[],periods=[],today,range}){
 const out=[],inRange=d=>d&&d>=range.from&&d<=range.to;
 for(const t of tasks){const d=day(t.due_at);if(!inRange(d)||['Completed','Cancelled'].includes(t.status))continue;
  out.push({date:d,kind:'task',label:KIND_LABEL.task,title:t.task_name,client:t.client_name||'',project_id:t.project_id,status:t.status,overdue:d<today});}
 for(const r of dues){const confirmed=r.status==='CONFIRMED',d=day(confirmed?r.kra_due_date:r.suggested_due_date);if(!inRange(d))continue;
  out.push({date:d,kind:confirmed?'kra':'kra_suggested',label:confirmed?KIND_LABEL.kra:KIND_LABEL.kra_suggested,title:`${r.filing_class} ${day(r.starts_on)} to ${day(r.ends_on)}`,client:r.client_name||'',status:confirmed?'Confirmed on iTax':'Not confirmed on iTax',overdue:d<today});}
 for(const r of periods)for(const [key,col] of [['return','return_due_date'],['internal','internal_due_date'],['payment','payment_due_date']]){const d=day(r[col]);if(!inRange(d))continue;
  out.push({date:d,kind:key,label:KIND_LABEL[key],title:`Accounting period ${day(r.starts_on)} to ${day(r.ends_on)}`,client:r.client_name||'',status:'Scheduled',overdue:d<today});}
 return out.sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind)||a.title.localeCompare(b.title));
}
export function byDay(events){const m=new Map();for(const e of events){if(!m.has(e.date))m.set(e.date,[]);m.get(e.date).push(e);}return [...m.entries()].map(([date,items])=>({date,items}));}
