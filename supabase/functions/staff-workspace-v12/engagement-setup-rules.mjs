// Engagement set-up (build 2810). Pure rules. The user chooses the service, period, scope, responsible person and reviewer.
// Only then does a service template produce tasks, and only those whose conditions the client's confirmed profile meets. The client type never selects a service.
const iso=d=>d.toISOString().slice(0,10);
const parse=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s))?new Date(s+'T00:00:00Z'):null;
const addDays=(s,n)=>{const d=parse(s);d.setUTCDate(d.getUTCDate()+n);return iso(d);};
const addMonths=(s,n)=>{const d=parse(s);const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return iso(d);};
export const STEP_MONTHS={Monthly:1,Quarterly:3,Annual:12};
export const MAX_TASKS=300;
export const OWNER_ROLES=['PARTNER','MANAGER','SUPERVISOR'];

// The occurrences of a recurring task inside the engagement period. A once-only task has one occurrence covering the whole period.
export function occurrences(recurrence,start,end){
 const a=parse(start),b=parse(end);if(!a||!b||b<a)return [];
 if(recurrence==='Once'||!STEP_MONTHS[recurrence])return [{start,end}];
 const out=[];let s=start;
 while(s<=end&&out.length<=60){
  const next=addMonths(start,STEP_MONTHS[recurrence]*(out.length+1));
  const e=addDays(next,-1);out.push({start:s,end:e<end?e:end});s=next;
 }
 return out;
}
export const dueOn=(basis,days,occ)=>addDays(basis==='Start'?occ.start:occ.end,Number(days)||0);
export const taskKey=(code,version,key,occStart)=>`tpl:${code}:v${version}:${key}:${occStart}`;

export function periodProblem(start,end){
 const a=parse(start),b=parse(end);
 if(!a||!b)return 'Choose the first and last day of the period.';
 if(b<a)return 'The period cannot end before it starts.';
 if(Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate())-Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate())>731*86400000)return 'A set-up covers at most two years. Set up the next period separately.';
 return null;
}

// facts: {obligations:Set of confirmed tax obligations covering the period, licences:Set of current licence types, clientTemplate:code|null}
// exclusions: [{task_key,reason}] chosen by the team. A mandatory task can be dropped only by a Manager or Partner, with a reason.
export function planTasks({tasks,period,facts,exclusions,actorCategory}){
 const create=[],skipped=[],problems=[];
 const ex=new Map((exclusions||[]).map(e=>[e.task_key,String(e.reason||'').trim()]));
 for(const key of ex.keys())if(!(tasks||[]).some(t=>t.task_key===key))problems.push('There is no task "'+key+'" in this template.');
 for(const t of [...(tasks||[])].sort((x,y)=>(x.sort_order||0)-(y.sort_order||0)||String(x.task_key).localeCompare(String(y.task_key)))){
  if(ex.has(t.task_key)){
   const reason=ex.get(t.task_key);
   if(t.mandatory){
    if(!['PARTNER','MANAGER'].includes(actorCategory)){problems.push('Only a Manager or Partner can drop the required task "'+t.task_name+'".');continue;}
    if(reason.length<5){problems.push('Say why the required task "'+t.task_name+'" is dropped (at least 5 characters).');continue;}
   }
   skipped.push({task_key:t.task_key,task_name:t.task_name,kind:'Dropped',reason:reason||'Dropped by the engagement team.',mandatory:!!t.mandatory});continue;
  }
  if(t.requires_obligation&&!facts?.obligations?.has(t.requires_obligation)){skipped.push({task_key:t.task_key,task_name:t.task_name,kind:'Condition',reason:'The client\'s verified tax profile does not show '+t.requires_obligation+' for this period.'});continue;}
  if(t.requires_licence&&!facts?.licences?.has(t.requires_licence)){skipped.push({task_key:t.task_key,task_name:t.task_name,kind:'Condition',reason:'No current '+t.requires_licence+' licence is on record.'});continue;}
  if(t.requires_client_template?.length&&!t.requires_client_template.includes(facts?.clientTemplate)){skipped.push({task_key:t.task_key,task_name:t.task_name,kind:'Condition',reason:'This task is for a different type of client.'});continue;}
  for(const occ of occurrences(t.recurrence,period.start,period.end))create.push({task_key:t.task_key,task_name:t.task_name,description:t.description||'',stage:t.stage,owner_role:t.owner_role,requires_document:!!t.requires_document,period_start:occ.start,period_end:occ.end,due_on:dueOn(t.due_basis,t.due_days,occ),mandatory:!!t.mandatory,recurrence:t.recurrence});
 }
 if(create.length>MAX_TASKS)problems.push('This would create '+create.length+' tasks. Shorten the period or split it (limit '+MAX_TASKS+').');
 return {create,skipped,problems};
}
// A task that is made for a month already past is still made; its due date is simply earlier. Nothing is skipped silently for being late.
export const lateCount=(create,onDate)=>create.filter(c=>c.due_on<onDate).length;

// Build 2857: evidence folders. Each task a set-up makes gets one folder, made in the same step as the task, so the two cannot drift apart.
// The path is fixed by the client, the service, the period and the task, so the same set-up always gives the same folders.
const slug=(s,max)=>String(s||'').normalize('NFKD').replace(/[^\x00-\x7F]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,max);
export function evidencePath({clientName,clientId,serviceCode,periodStart,taskKey}){
 const client=(slug(clientName,40)||'Client')+'-'+String(clientId||'').replace(/-/g,'').slice(0,8);
 const service=(slug(serviceCode,30)||'Service')+'_'+String(periodStart||'').slice(0,4);
 const period='Period_'+String(periodStart||'').slice(0,7);
 const task=String(taskKey||'').replace(/^tpl:[^:]*:v\d+:/,'');
 return ['Clients',client,service,period,slug(task,60)||'Task'].join('/')+'/';
}
// What the preview says before anything is made: the periods, tasks and folders are counted from the plan itself.
export function folderSummary(create){
 const rows=Array.isArray(create)?create:[];
 const periods=new Set(rows.map(c=>c.period_start+'|'+c.period_end)).size;
 return {periods,tasks:rows.length,folders:rows.length};
}
export function folderSentence(s){
 const n=(v,w)=>v+' '+w+(v===1?'':'s');
 return 'This will generate '+n(s.periods,'period')+', '+n(s.tasks,'task')+' and '+n(s.folders,'evidence folder')+'.';
}
