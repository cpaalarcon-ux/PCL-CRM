// View Staff: one dropdown beside View firm. It narrows Time & Attendance, Team & HR and Projects & Tasks to the people the signed-in
// person may look at. The server decides who that is (erp_private.view_staff_ids); this file only builds the dropdown and the cards.
//   Assistants and Interns: no dropdown, they only ever see themselves.
//   Supervisors: My Profile, My Team, and each person who reports to them.
//   Managers and Partners: My Profile, All Staff, and every active member of staff.
export const DEFAULT='default';
export const hasPicker=opts=>!!opts&&['PARTNER','MANAGER','SUPERVISOR'].includes(opts.role)&&(opts.people||[]).length>0;
export const aggregateLabel=role=>role==='SUPERVISOR'?'My Team':'All Staff';
export function pickerOptions(opts,esc,current=DEFAULT,meId=''){
 if(!hasPicker(opts))return '';
 const sel=v=>v===current?' selected':'';
 const others=(opts.people||[]).filter(x=>x.staff_id!==meId);
 return `<option value="${DEFAULT}"${sel(DEFAULT)}>${esc(aggregateLabel(opts.role))}</option><option value="me"${sel('me')}>My Profile</option>`+others.map(x=>`<option value="${esc(x.staff_id)}"${sel(x.staff_id)}>${esc(x.full_name)}</option>`).join('');
}
// What to send to the server: nothing for the whole group, the person's own id for My Profile, otherwise the chosen id.
export const targetOf=(selection,meId)=>!selection||selection===DEFAULT?null:selection==='me'?meId:selection;
const first=name=>String(name||'').trim().split(/\s+/)[0]||'This person';
export function subjectName(selection,opts){
 if(!selection||selection===DEFAULT)return null;
 if(selection==='me')return null;
 return (opts?.people||[]).find(x=>x.staff_id===selection)?.full_name||null;
}
export function attendanceTitle(selection,opts){
 if(!selection||selection===DEFAULT)return opts?.role==='SUPERVISOR'?'Team attendance':opts?.role==='ASSISTANT'||opts?.role==='INTERN'?'My attendance':'Firm attendance';
 if(selection==='me')return 'My attendance';
 const n=subjectName(selection,opts);return n?`${first(n)}’s attendance`:'Attendance';
}
export function teamTitle(selection,opts){
 if(!selection||selection===DEFAULT)return opts?.role==='SUPERVISOR'?'My team':'All staff';
 if(selection==='me')return 'My workload';
 const n=subjectName(selection,opts);return n?`${first(n)}’s workload`:'Workload';
}
// Tasks the person is assigned to (or prepared). Only narrows what the signed-in person can already see.
export function narrowTasks(tasks,selection,meId){
 if(!selection||selection===DEFAULT)return tasks;
 const id=selection==='me'?meId:selection;
 return tasks.filter(t=>t.assigned_to===id||t.prepared_by===id);
}
const hhmm=iso=>iso?new Date(iso).toLocaleTimeString('en-GB',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit'}):'';
export function attendanceCards(rows,esc){
 if(!rows.length)return '<p class="empty">Nobody to show.</p>';
 return `<div class="att-grid">${rows.map(r=>{
  const open=r.clock_in&&!r.clock_out,over=!!r.over_ten_hours;
  const clock=r.clock_in?`In ${hhmm(r.clock_in)}${r.clock_out?` · out ${hhmm(r.clock_out)}`:''}${open&&r.open_hours!=null?` · ${r.open_hours} h so far`:''}`:'Not clocked in today';
  return `<article class="att-card${over?' att-alert':''}" data-staff="${esc(r.staff_id)}"><b>${esc(r.full_name)}</b><small>${esc(String(r.category_code||'').toLowerCase())}</small><div>${esc(r.status||'')}</div><div class="muted">${esc(clock)}</div>${over?'<span class="badge bad" role="status">Clocked in over 10 hours</span>':''}${r.review_required?'<small class="missing">Attendance review required</small>':''}</article>`;
 }).join('')}</div>`;
}
