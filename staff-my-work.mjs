// Build 2858: My Work. One board of the person's own open work across every client and engagement, plus the work waiting for their review.
// Presentation only: it reads the tasks the Home page already holds, changes nothing, and every button is an existing one (Open task, Update status),
// so the server's rules for who may change a task, who may review it and what status may follow still decide everything.
import {groupColumns,kanban} from './staff-items-view.mjs?v=20261107-annualpack-v3';
export const MY_WORK_KEY='pclMyWorkView';
export const COLUMNS=['To do','In progress','Blocked or waiting','In review','For my review'];
export const DUE_FILTERS=[['all','Any due date'],['overdue','Overdue'],['week','Due in the next 7 days'],['none','No due date']];
const WAITING=['Blocked','Waiting on client','Paused','Returned','Pending manager'];
const state={mode:'list',client:'',due:'all'};
export const myWorkState=()=>({...state});
export function loadMyWorkMode(storage){try{const v=storage?.getItem(MY_WORK_KEY);if(v==='board'||v==='list')state.mode=v;}catch{/* the choice is only a convenience */}return state.mode;}
export function setMyWork(kind,value,storage){
 if(kind==='mode'){state.mode=value==='board'?'board':'list';try{storage?.setItem(MY_WORK_KEY,state.mode);}catch{/* not kept */}}
 else if(kind==='client')state.client=String(value||'');
 else if(kind==='due')state.due=DUE_FILTERS.some(d=>d[0]===value)?value:'all';
}
export function resetMyWork(){state.mode='list';state.client='';state.due='all';}

// The column a task belongs in. A status this page does not know goes to "To do" with its own name shown on the card, never hidden.
export function columnOf(task){
 if(task.status==='In Progress')return 'In progress';
 if(task.status==='In Review')return 'In review';
 if(WAITING.includes(task.status))return 'Blocked or waiting';
 return 'To do';
}
const dayOf=v=>v?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date(v)):'';
export function dueMatches(task,filter,today){
 const d=dayOf(task.due_at);
 if(filter==='overdue')return !!d&&d<today;
 if(filter==='none')return !d;
 if(filter==='week'){if(!d)return false;const end=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10);return d>=today&&d<=end;}
 return true;
}
// Overdue first, then the earliest due date; no due date last. Same task id as the final tie-break so the order is stable.
export const byUrgency=(today)=>(a,b)=>{
 const da=dayOf(a.due_at),db=dayOf(b.due_at),oa=da&&da<today?0:1,ob=db&&db<today?0:1;
 return oa-ob||(da||'9999-12-31').localeCompare(db||'9999-12-31')||String(a.task_id).localeCompare(String(b.task_id));
};
// mine: my open tasks; review: tasks waiting for my review (not mine to prepare). A task in both lists is shown once, as mine.
export function workItems({mine,review,projects,clientName,filter,today}){
 const clientOf=t=>projects.find(p=>p.project_id===t.project_id)?.client_id||'';
 const own=new Set(mine.map(t=>t.task_id));
 const items=[...mine.map(t=>({task:t,column:columnOf(t),kind:'mine'})),...review.filter(t=>!own.has(t.task_id)).map(t=>({task:t,column:'For my review',kind:'review'}))]
  .map(i=>({...i,client_id:clientOf(i.task)}))
  .filter(i=>(!filter.client||i.client_id===filter.client)&&dueMatches(i.task,filter.due,today))
  .sort((a,b)=>byUrgency(today)(a.task,b.task));
 const clients=[...new Map([...mine,...review].map(t=>[clientOf(t),clientName(clientOf(t))])).entries()].filter(([id])=>id).sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
 return {items,clients,columns:groupColumns(items,i=>i.column,COLUMNS,true)};
}
export function renderMyWork(ctx){
 const {esc,shortDate,clientName,projectName,today,mine,review,projects,stageOf=t=>t.status}=ctx,filter={client:state.client,due:state.due};
 const w=workItems({mine,review,projects,clientName,filter,today});
 const card=i=>{const t=i.task,d=dayOf(t.due_at),late=d&&d<today;
  return `<div class="kanban-card${late?' late':''}"><b>${esc(t.task_name)}</b><small>${esc(clientName(i.client_id))} · ${esc(projectName(t.project_id))}</small><small>${esc(stageOf(t))}${i.kind==='review'?' · waiting for your review':''} · ${t.due_at?'Due '+esc(shortDate(t.due_at)):'No due date'}</small>${late?'<span class="pill-late">Overdue</span>':''}${t.blocked_reason?`<small class="muted">${esc(t.blocked_reason)}</small>`:''}<span class="actions"><button type="button" data-task="${esc(t.task_id)}">Open task</button>${i.kind==='mine'?`<button type="button" data-task-edit="${esc(t.task_id)}">Update status</button>`:''}</span></div>`;};
 const bar=`<div class="mywork-bar" role="group" aria-label="My Work view"><div class="items-switch"><button type="button" data-my-work="mode" data-value="list" aria-pressed="${state.mode==='list'}"${state.mode==='list'?' class="active"':''}>List</button><button type="button" data-my-work="mode" data-value="board" aria-pressed="${state.mode==='board'}"${state.mode==='board'?' class="active"':''}>Board</button></div>`+
  (state.mode==='board'?`<label>Client <select data-my-work-select="client" aria-label="Filter by client"><option value="">All clients</option>${w.clients.map(([id,n])=>`<option value="${esc(id)}"${id===state.client?' selected':''}>${esc(n)}</option>`).join('')}</select></label>`+
  `<label>Due <select data-my-work-select="due" aria-label="Filter by due date">${DUE_FILTERS.map(([k,l])=>`<option value="${k}"${k===state.due?' selected':''}>${esc(l)}</option>`).join('')}</select></label>`:'')+`</div>`;
 const total=w.items.length,filtered=!!(state.client||state.due!=='all');
 const board=total||!filtered?kanban(w.columns,card,esc):`<p class="muted">Nothing matches these filters.</p>`;
 return {bar,board:`<div class="mywork-board">${board}</div>`,total,filtered,counts:Object.fromEntries(w.columns.map(c=>[c.name,c.items.length])),columns:w.columns};
}
