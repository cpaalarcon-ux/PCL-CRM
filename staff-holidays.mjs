// Partner-only public holiday calendar (Administration > Settings). The stuck-task alerts, Manager Pool and every working-hours clock read this table.
// A day marked "working day" keeps the clocks running; any other listed day pauses them. Every change needs a recorded source and is audit-logged.
export function createHolidaysUI(ctx){
 const {esc,request,notice,modal,form,field,data}=ctx;
 let state=null,loading=false,year=null;
 const nairobiYear=()=>Number(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date()).slice(0,4));
 const dayName=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short'}).format(new Date(d+'T00:00:00Z'));
 const pretty=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric'}).format(new Date(d+'T00:00:00Z'));
 const isPartner=()=>data()?.me?.category_code==='PARTNER';
 async function load(){if(loading)return;loading=true;try{const r=await request({action:'holiday_list'});state={holidays:Array.isArray(r?.holidays)?r.holidays:[]};}catch(e){state={error:e.message,holidays:[]};}finally{loading=false;ctx.render();}}
 function years(){const ys=new Set([nairobiYear(),nairobiYear()+1]);for(const h of state.holidays)ys.add(Number(String(h.holiday_date).slice(0,4)));return [...ys].sort();}
 function render(){
  if(!isPartner())return '';
  if(!state){void load();return `<section class="card" id="holidaysCard"><h2>Public holidays</h2><p class="muted">Loading…</p></section>`;}
  if(state.error)return `<section class="card" id="holidaysCard"><h2>Public holidays</h2><p class="info">${esc(state.error)}</p></section>`;
  year=year||nairobiYear();
  const rows=state.holidays.filter(h=>String(h.holiday_date).startsWith(String(year)));
  const unconfirmed=state.holidays.filter(h=>!h.confirmed).length;
  const tr=h=>{const d=String(h.holiday_date).slice(0,10);return `<tr><td>${esc(pretty(d))}<small>${esc(dayName(d))}</small></td><td>${esc(h.name)}</td><td>${h.is_working_day?'<span class="badge good">Firm works</span>':'<span class="badge">Clocks paused</span>'}</td><td>${h.confirmed?`<span class="badge good">Confirmed</span><small>${esc(h.confirmed_by_name||'')}${h.confirmed_at?' · '+esc(String(h.confirmed_at).slice(0,10)):''}</small>`:'<span class="badge warn">Unconfirmed</span>'}<small>${esc(h.source_note||'')}</small></td><td><button type="button" data-holiday="edit" data-date="${esc(d)}">${h.confirmed?'Change':'Confirm'}</button></td></tr>`;};
  return `<section class="card" id="holidaysCard"><div class="section-head"><div><h2>Public holidays</h2><p class="muted">Partner only. Task timers, stuck-task alerts and the Manager Pool pause on these days. Tick “firm works” for a holiday the firm will work, and its clocks keep running. Seeded dates are not confirmed until a Partner confirms them against the Kenya Gazette.</p></div><div class="actions"><label class="inline">Year <select data-holiday="year" aria-label="Year">${years().map(y=>`<option value="${y}"${y===year?' selected':''}>${y}</option>`).join('')}</select></label><button type="button" class="primary" data-holiday="add">+ Add holiday</button></div></div>${state.lock_active?'<p class="missing" role="status"><b>Compliance lock:</b> a holiday this month is unconfirmed, so stuck-task alerts (and payroll jobs, when built) are paused and Partners are alerted. Confirm it below to lift the lock.</p>':''}${unconfirmed?`<p class="info" role="status">${unconfirmed} holiday date${unconfirmed===1?' is':'s are'} unconfirmed.</p>`:''}${rows.length?`<div class="scroll"><table><thead><tr><th>Date</th><th>Holiday</th><th>Clocks</th><th>Status and source</th><th>Action</th></tr></thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`:`<p class="empty">No holidays are listed for ${year}.</p>`}</section>`;
 }
 function edit(date){
  const h=date?state.holidays.find(x=>String(x.holiday_date).slice(0,10)===date):null;
  modal(h?(h.confirmed?'Change a holiday':'Confirm a holiday'):'Add a holiday',form(
   field('holiday_date','Date *',h?String(h.holiday_date).slice(0,10):'','date',`required${h?' readonly':''}`)+field('name','Holiday name *',h?.name||'','text','required minlength="3" maxlength="120"')+
   `<label class="full"><input type="checkbox" name="is_working_day"${h?.is_working_day?' checked':''}> The firm works on this day (clocks keep running)</label>`+
   `<label class="full">Source note * <small>for example Gazette Notice No. 1234</small><textarea name="source" required minlength="10" maxlength="1000"></textarea></label>`,h?'Save holiday':'Add holiday'),
   f=>request({action:'holiday_save',holiday_date:f.get('holiday_date'),name:f.get('name'),is_working_day:f.has('is_working_day'),source_note:f.get('source')}),()=>{state=null;ctx.render();},{refreshWorkspace:false,successMessage:'Holiday saved. The clocks use it from now on.'});
 }
 document.addEventListener('click',e=>{const b=e.target.closest('[data-holiday]');if(!b||b.tagName==='SELECT'||!isPartner())return;if(b.dataset.holiday==='add')edit(null);if(b.dataset.holiday==='edit')edit(b.dataset.date);});
 document.addEventListener('change',e=>{const s=e.target.closest('select[data-holiday="year"]');if(s){year=Number(s.value);ctx.render();}});
 return {render,reset:()=>{state=null;year=null;}};
}
