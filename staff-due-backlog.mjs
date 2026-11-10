// Tax periods waiting for a confirmed KRA due date (Settings). The list comes from the database (20261110283000_due_date_backlog.sql) and is read-only; each row opens the same
// confirm or task-date-fallback form used on the new tax period screen, and the database checks the same rules again. Nothing here confirms a date by itself:
// a person ticks that the date matches the KRA iTax calendar, or says why the task date is used instead.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const BACKLOG_NOTE='These are the tax periods that already exist. Each one needs the KRA due date confirmed against the iTax calendar by the Tax Lead, a Manager or a Partner, or the task date chosen on purpose with a reason. Until then, its filing warnings count from the filing task\'s own due date. The suggested date is a suggestion only.';
export const FILING_LABEL={PAYE:'PAYE and payroll',VAT:'VAT and monthly',ANNUAL:'Annual',OTHER:'Other'};
export const dueStatus=r=>r.due_status==='CONFIRMED'?`Confirmed${r.kra_due_date?' · '+day(r.kra_due_date):''}`:r.due_status==='TASK_DATE_FALLBACK'?'Task date used on purpose':'Waiting for a confirmed date';
export const waiting=items=>(items||[]).filter(r=>r.due_status==='MISSING');

export function backlogView({items,button}){
 const list=items||[],w=waiting(list);
 if(!list.length)return `<p class="info full">${esc(BACKLOG_NOTE)}</p><p class="muted">There are no tax periods yet.</p>`;
 const rows=list.map(r=>`<tr><td>${esc(r.company_name)}<br><small>${esc(r.project_name)}</small></td><td>${esc(r.kind)}<br><small>${esc(FILING_LABEL[r.filing_class]||r.filing_class)}</small></td><td>${esc(day(r.starts_on))} to ${esc(day(r.ends_on))}</td><td>${r.suggested_due_date?esc(day(r.suggested_due_date)):'<small class="muted">none suggested</small>'}</td><td><small class="${r.due_status==='MISSING'?'warn':'ok'}">${esc(dueStatus(r))}</small></td><td>${r.due_status==='MISSING'?button('duebacklog-confirm','Confirm date',r.case_id)+' '+button('duebacklog-fallback','Use task date',r.case_id):''}</td></tr>`).join('');
 return `<p class="info full">${esc(BACKLOG_NOTE)}</p><p><b>${w.length} of ${list.length} period${list.length===1?'':'s'} waiting</b></p><div class="scroll"><table id="dueBacklogTable"><thead><tr><th>Client and engagement</th><th>Return</th><th>Period</th><th>Suggested KRA date</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function createDueBacklogUI(ctx){
 const {field,form,modal,request,button,area,check}=ctx,d=()=>ctx.data();
 let cur=[];
 const leaderRole=me=>['PARTNER','MANAGER'].includes(me?.category_code);
 const waitingCount=()=>waiting(cur).length;
 function card(){
  if(!leaderRole(d().me))return '';
  return `<section class="card"><div class="section-head"><h2>Tax periods waiting for a KRA due date</h2>${button('duebacklog-open','Open')}</div><p class="muted">Existing periods that still need their KRA due date confirmed.</p></section>`;
 }
 async function open(){
  const data=await request({action:'due_date_backlog'});cur=data.items||[];
  modal('Tax periods waiting for a KRA due date',backlogView({items:cur,button}));
 }
 const row=id=>cur.find(x=>x.case_id===id);
 const keys=r=>({project_id:r.project_id,starts_on:day(r.starts_on),ends_on:day(r.ends_on),kind:r.kind});
 async function handle(action,id){
  if(!action.startsWith('duebacklog-'))return false;
  if(action==='duebacklog-open'){await open();return true;}
  const r=row(id);if(!r)return true;
  const title=`${r.company_name} · ${r.kind} · ${day(r.starts_on)} to ${day(r.ends_on)}`;
  if(action==='duebacklog-confirm'){
   modal('Confirm the KRA due date',form(`<p class="info full">${esc(title)}. ${r.suggested_due_date?'Suggested: '+esc(day(r.suggested_due_date))+'. ':'No date is suggested for this return. '}Check the date against the KRA iTax calendar before you confirm it.</p>`+field('kra_due_date','KRA due date *',day(r.suggested_due_date),'date','required')+check('itax_confirmed','I checked this date against the KRA iTax calendar')+'<p class="muted full">The date cannot be before the period ends.</p>','Confirm due date'),
    f=>request({action:'due_date_confirm',...keys(r),kra_due_date:f.get('kra_due_date'),itax_confirmed:f.get('itax_confirmed')==='on'}),open);
   return true;
  }
  if(action==='duebacklog-fallback'){
   modal('Use the task date for this period',form(`<p class="info full">${esc(title)}. The filing task's own due date will be used. This is a deliberate choice, so say why.</p>`+area('fallback_reason','Why the KRA date is not entered *','',true),'Use task date'),
    f=>request({action:'due_date_fallback',...keys(r),fallback_reason:f.get('fallback_reason')}),open);
   return true;
  }
  return false;
 }
 return {card,handle,open,waitingCount};
}
