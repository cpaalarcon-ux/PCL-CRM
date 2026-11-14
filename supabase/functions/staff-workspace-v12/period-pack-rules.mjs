// Recurring service period pack (build 2809). Pure rules. For one project and one month: which sources are in, what is waiting on whom, what is blocked and why.
// A source that has not arrived is "Not received", never zero. A source counts as expected only when it came in an earlier month, so nothing is guessed from a template.
// Nothing here approves anything and nothing carries an approval forward: each month's imports, reviews and filings stand on their own.
export const MONTH=/^(\d{4})-(0[1-9]|1[0-2])$/;
export function monthRange(ym){
 const m=MONTH.exec(String(ym||''));if(!m)return null;const y=Number(m[1]),mo=Number(m[2]),last=new Date(Date.UTC(y,mo,0)).getUTCDate(),pad=n=>String(n).padStart(2,'0');
 return {start:`${y}-${pad(mo)}-01`,end:`${y}-${pad(mo)}-${pad(last)}`};
}
export const previousMonth=ym=>{const m=MONTH.exec(String(ym||''));if(!m)return null;let y=Number(m[1]),mo=Number(m[2])-1;if(!mo){mo=12;y--;}return `${y}-${String(mo).padStart(2,'0')}`;};
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const SOURCE_LABEL={sales:'Sales',purchases:'Purchases',bank:'Bank',payroll:'Payroll'};
const IMPORT_STATE={Confirmed:'Ready',Submitted:'Waiting for review',Draft:'In progress',Returned:'Returned for correction'};
const RANK=['Ready','Received','Waiting for review','In progress','Returned for correction','Blocked','Not received'];
const worst=list=>list.slice().sort((a,b)=>RANK.indexOf(b)-RANK.indexOf(a))[0];

// facts: {imports:[{kind,status,starts_on,ends_on}], batches:[{dataset,period_start,period_end,rows,unmapped}], earlier:{sales,purchases,bank,payroll:boolean}, prior_payroll:status|null}
export function sourceStates(month,facts){
 const b=monthRange(month);if(!b)return [];
 const overlaps=(s,e)=>day(s)<=b.end&&day(e)>=b.start,f=facts||{},out=[];
 const imp=kind=>(f.imports||[]).filter(i=>i.kind===kind&&overlaps(i.starts_on,i.ends_on)&&IMPORT_STATE[i.status]);
 const bat=ds=>(f.batches||[]).filter(x=>x.dataset===ds&&overlaps(x.period_start,x.period_end));
 const add=(key,state,detail,blocked_by=null)=>out.push({key,label:SOURCE_LABEL[key],state,detail,blocked_by});
 for(const key of ['sales','payroll']){
  const kind=key==='sales'?'Sales':'Payroll',rows=imp(kind);
  if(!rows.length){
   const wb=key==='sales'?bat('Sales'):[];
   if(wb.length)add(key,'Received',wb.length+' upload'+(wb.length===1?'':'s')+' in, no saved summary yet');
   else if(f.earlier?.[key])add(key,'Not received','Came in before; nothing yet for this month');
   continue;
  }
  const state=worst(rows.map(r=>IMPORT_STATE[r.status]));
  if(key==='payroll'&&['In progress','Waiting for review','Returned for correction','Received'].includes(state)&&f.prior_payroll&&!['Confirmed','Superseded'].includes(f.prior_payroll))
   add(key,'Blocked','Last month\'s payroll is not approved yet. Approve it first; this month does not inherit that approval.','Previous month payroll');
  else add(key,state,rows.length+' summar'+(rows.length===1?'y':'ies')+', '+state.toLowerCase());
 }
 for(const [key,ds] of [['purchases','Purchases'],['bank','Bank']]){
  const rows=bat(ds);
  if(!rows.length){if(f.earlier?.[key])add(key,'Not received','Came in before; nothing yet for this month');continue;}
  const total=rows.reduce((n,r)=>n+Number(r.rows||0),0),un=rows.reduce((n,r)=>n+Number(r.unmapped||0),0);
  if(key==='purchases'&&un>0)add(key,'In progress',un+' of '+total+' rows still unmapped');
  else add(key,'Received',total+' row'+(total===1?'':'s')+' in'+(key==='purchases'?', all mapped':''));
 }
 return out;
}
// tasks: [{task_name,status,blocked_reason,due_at}] for the month's work period; now: ISO time.
export function taskSummary(tasks,now){
 const open=(tasks||[]).filter(t=>!['Completed','Cancelled'].includes(t.status)),t0=Date.parse(now||new Date().toISOString());
 const overdue=open.filter(t=>t.due_at&&Date.parse(t.due_at)<t0),blocked=open.filter(t=>t.status==='Blocked');
 return {total:(tasks||[]).length,open:open.length,overdue:overdue.length,blocked:blocked.map(t=>({task_name:t.task_name,reason:t.blocked_reason||'No reason recorded'}))};
}
// cases: [{kind,status}] tax cases overlapping the month.
export function taxSummary(cases){
 const live=(cases||[]);const filed=live.filter(c=>['Locked','Filed'].includes(c.status)).length;
 return {cases:live.length,filed,open:live.length-filed,kinds:[...new Set(live.map(c=>c.kind))]};
}
// One pack: its sources, tasks and tax cases, and the exceptions a supervisor has to look at (and nothing else).
export function packStatus({month,facts,tasks,cases,now}){
 const sources=sourceStates(month,facts),t=taskSummary(tasks,now),tax=taxSummary(cases),exceptions=[];
 for(const s of sources)if(!['Ready','Received'].includes(s.state))exceptions.push({kind:'source',key:s.key,label:s.label,state:s.state,detail:s.detail});
 if(t.overdue)exceptions.push({kind:'tasks',key:'overdue',label:'Tasks',state:'Overdue',detail:t.overdue+' open task'+(t.overdue===1?' is':'s are')+' past due'});
 for(const b of t.blocked)exceptions.push({kind:'tasks',key:'blocked',label:'Tasks',state:'Blocked',detail:b.task_name+': '+b.reason});
 const stage=!sources.length&&!t.total?'Nothing started':exceptions.some(e=>e.state==='Blocked')?'Blocked':exceptions.length?'Not ready':tax.cases&&tax.filed===tax.cases?'Filed':'Ready for review';
 return {month,stage,sources,tasks:t,tax,exceptions,clean:exceptions.length===0&&(sources.length>0||t.total>0)};
}
// Several projects: only the exceptions, grouped, with the count of clean packs.
export function overview(packs){
 const list=packs||[],clean=list.filter(p=>p.pack.clean).length;
 return {projects:list.length,clean,with_exceptions:list.length-clean,
  rows:list.filter(p=>!p.pack.clean).map(p=>({project_id:p.project_id,project_name:p.project_name,client_name:p.client_name,stage:p.pack.stage,exceptions:p.pack.exceptions})).sort((a,b)=>(a.stage==='Blocked'?0:1)-(b.stage==='Blocked'?0:1)||a.client_name.localeCompare(b.client_name))};
}
