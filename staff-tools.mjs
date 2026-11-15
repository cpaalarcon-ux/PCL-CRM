// Build 2835: search across clients, engagements, projects, tasks and trial-balance accounts; a month calendar of due dates; the payroll access log; and the register that
// measures the 95% target. Every figure and every rule is the server's (search-calendar-actions.ts, payroll-access-log.ts, target-measure-actions.ts).
import {settingsCard} from './staff-settings-cards.mjs?v=20261112-resources-v1';
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const TARGET_NOTE='A reduction is a measure of minutes against your own baseline. It is not a promise. It appears only after three periods, beside rework, first-pass review and missed deadlines.';
export const LOG_NOTE='Each time someone opens payroll identity or salary data (the payroll register, a payroll run, the client confirmation or a payroll file) a line is added here. Lines cannot be edited or removed.';
const KIND_TONE={task:'warn',kra:'bad',kra_suggested:'warn',return:'bad',internal:'muted',payment:'bad'};
export function searchGroups(g,esc=e0){
 const row=(label,main,sub,btn='')=>`<tr><td><small>${esc(label)}</small></td><td>${main}<small> ${sub}</small></td><td>${btn}</td></tr>`;
 const out=[
  ...g.clients.map(c=>row('Client',`<b>${esc(c.company_name)}</b>`,esc([c.kra_pin,c.record_status].filter(Boolean).join(' · ')),`<button type="button" data-view="clients">Open clients</button>`)),
  ...g.engagements.map(x=>row('Engagement',`<b>${esc(x.project_name)}</b>`,esc(`${x.company_name} · ${x.service_code} · ${x.period_start} to ${x.period_end} · ${x.status}`),`<button type="button" data-search-project="${esc(x.project_id)}">Open</button>`)),
  ...g.projects.map(p=>row('Project',`<b>${esc(p.project_name)}</b>`,esc(`${p.company_name} · ${p.service_code} · ${p.status}`),`<button type="button" data-search-project="${esc(p.project_id)}">Open</button>`)),
  ...g.tasks.map(t=>row('Task',`<b>${esc(t.task_name)}</b>`,esc(`${t.company_name} · ${t.project_name} · ${t.status}${t.due_at?' · due '+t.due_at.slice(0,10):''}`),`<button type="button" data-task="${esc(t.task_id)}">Open</button>`)),
  ...g.accounts.map(a=>row('Account',`<b>${esc(a.code)}</b> ${esc(a.name)}`,esc(`${a.account_group} · ${a.statement} · in ${a.clients_using} approved client chart${a.clients_using===1?'':'s'}`))),
 ];
 return out.length?`<div class="scroll"><table><tbody>${out.join('')}</tbody></table></div>`:'<p class="muted">Nothing matched. Search looks at names, PINs, service codes, task names and account codes or names you are allowed to open.</p>';
}
export function calendarDays(days,esc=e0){
 return days.length?days.map(d=>`<h3>${esc(d.date)}</h3><div class="scroll"><table><tbody>${d.items.map(i=>`<tr><td><span class="badge ${i.overdue?'bad':KIND_TONE[i.kind]||'muted'}">${esc(i.label)}</span>${i.overdue?' <small class="warn">overdue</small>':''}</td><td><b>${esc(i.title)}</b><small> ${esc(i.client)}${i.status?' · '+esc(i.status):''}</small></td><td>${i.project_id?`<button type="button" data-search-project="${esc(i.project_id)}">Open</button>`:''}</td></tr>`).join('')}</tbody></table></div>`).join(''):'<p class="muted">Nothing falls due this month.</p>';
}
export function createToolsUI(ctx){
 const {$,esc,field,select,form,modal,request,notice}=ctx,d=()=>ctx.data(),cat=()=>d().me?.category_code;
 const leader=()=>['PARTNER','MANAGER'].includes(cat()),sup=()=>['PARTNER','MANAGER','SUPERVISOR'].includes(cat());
 const show=(title,html,save,done)=>modal(title,html,save,done,{refreshWorkspace:false});
 const card=()=>(leader()?settingsCard({id:'payrollLogCard',title:'Payroll access log',purpose:'Who opened payroll identity or salary data, when, and from where in the ERP.',audience:'Managers and Partners',actions:ctx.button('tools-paylog','Open')}):'')
  +(sup()?settingsCard({id:'targetCard',title:'95% measurement register',purpose:'Minutes per activity before the ERP and in each period after it, with rework, first-pass review and missed deadlines.',audience:'Supervisors, Managers and Partners',actions:ctx.button('tools-target','Open')}):'');
 async function search(q=''){
  show('Search',`<div id="toolsSearch" class="filters"><label class="full">Clients, engagements, projects, tasks and accounts<input name="q" type="search" value="${esc(q)}" maxlength="80" autocomplete="off"></label><button type="button" data-tools-go="search">Search</button></div><div id="toolsSearchOut">${q?'':'<p class="muted">Type at least 2 characters.</p>'}</div>`,null,null);
  const run=async text=>{const out=$('#toolsSearchOut');if(!out)return;try{const r=await request({action:'search_all',q:text});out.innerHTML=`<p class="muted">${r.total} result${r.total===1?'':'s'}, up to ${r.per_kind} of each kind.</p>`+searchGroups(r.groups,esc);}catch(err){out.innerHTML=`<p class="missing">${esc(err.message)}</p>`;}};
  const f=$('#toolsSearch'),input=f&&f.querySelector('[name=q]'),go=()=>run(input.value);if(f){f.querySelector('button').onclick=go;input.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();go();}};input.focus();}if(q)await run(q);
 }
 async function calendar(month=''){
  const r=await request({action:'calendar_read',month:month||undefined});
  show('Calendar · '+r.month,`<div class="actions"><button type="button" data-tools="cal" data-id="${esc(r.previous)}">Previous month</button><button type="button" data-tools="cal" data-id="${esc(r.next)}">Next month</button></div><p class="muted">${r.count} item${r.count===1?'':'s'}${r.overdue?`, ${r.overdue} overdue`:''}. KRA dates marked "not confirmed" are suggestions until checked on iTax.</p>`+calendarDays(r.days,esc),null,null);
  const b=$('#editorBody');if(b)b.onclick=async ev=>{const x=ev.target.closest('[data-tools="cal"]');if(!x)return;try{await calendar(x.dataset.id);}catch(err){notice(err.message,true);}};
 }
 async function payLog(filters={}){
  const r=await request({action:'payroll_access_log_read',...filters});
  const list=r.rows.length?`<div class="scroll"><table><thead><tr><th>When</th><th>Who</th><th>Opened</th><th>Client · engagement</th><th>Detail</th></tr></thead><tbody>${r.rows.map(x=>`<tr><td>${esc(x.read_at.slice(0,16).replace('T',' '))} UTC</td><td>${esc(x.read_by_name)}</td><td>${esc(x.surface)}</td><td>${esc(x.company_name)}<small> ${esc(x.project_name)}</small></td><td>${esc(x.detail||'')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No reads recorded for these dates.</p>';
  show('Payroll access log',`<p class="info full">${esc(LOG_NOTE)}</p><div id="logFilter" class="filters">${field('from','From',filters.from||'','date')}${field('to','To',filters.to||'','date')}<button type="button">Show</button></div><p>${r.total} read${r.total===1?'':'s'}${r.total>=r.limit?` (latest ${r.limit} shown)`:''}${r.by_person.length?' · '+r.by_person.map(p=>`${esc(p.name)} ${p.reads}`).join(', '):''}</p>`+list,null,null);
  const f=$('#logFilter');if(f)f.querySelector('button').onclick=async()=>{try{await payLog({from:f.querySelector('[name=from]').value||undefined,to:f.querySelector('[name=to]').value||undefined});}catch(err){notice(err.message,true);}};
 }
 const pct=v=>v==null?'–':v+'%',mins=v=>Number(v).toLocaleString('en-KE',{maximumFractionDigits:1});
 async function target(){
  const r=await request({action:'target_measure_read'}),s=r.summary;
  const rows=s.rows.length?`<div class="scroll"><table><thead><tr><th>Activity</th><th>Before (min)</th><th>Now (min)</th><th>Periods</th><th>Reduction</th><th>Accuracy</th><th>State</th></tr></thead><tbody>${s.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.baseline_entries?mins(x.baseline_minutes):'–'}</td><td>${x.current_entries?mins(x.current_minutes):'–'}</td><td>${x.periods}/${r.periods_needed}</td><td>${pct(x.reduction_pct)}</td><td>${esc(x.accuracy_note||'–')}</td><td><span class="badge ${x.state==='Target reached'?'good':x.state==='Below target'?'bad':'warn'}">${esc(x.state)}</span></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Nothing recorded yet. Start with a baseline: how long the activity took before the ERP.</p>';
  const overall=s.overall?`<p><b>Overall:</b> ${mins(s.overall.baseline_minutes)} min before, ${mins(s.overall.current_minutes)} min now across ${s.overall.activities} activit${s.overall.activities===1?'y':'ies'}: <b>${s.overall.reduction_pct}% reduction</b> (target ${s.target}%).</p>`:`<p class="muted">An overall figure appears when at least one activity has three periods of current entries.</p>`;
  const hist=r.entries.length?`<div class="scroll"><table><thead><tr><th>Entered</th><th>Activity</th><th>Kind</th><th>Month</th><th>Minutes</th><th>Method</th><th></th></tr></thead><tbody>${r.entries.slice(0,60).map(x=>`<tr><td>${esc(x.recorded_at.slice(0,10))}<small> ${esc(x.recorded_by_name)}</small></td><td>${esc(x.activity)}<small> ${esc(x.company_name||'firm-wide')}</small></td><td>${esc(x.kind)}</td><td>${esc(x.period_label)}</td><td>${mins(x.minutes)}${x.kind==='Current'?`<small> ${x.first_pass?'passed first time':'needed rework'}${x.rework_minutes?`, ${mins(x.rework_minutes)} min rework`:''}${x.missed_deadline?', missed deadline':''}</small>`:''}</td><td>${esc(x.method)}</td><td>${x.status==='Active'?`<button type="button" data-tools="void" data-id="${esc(x.measurement_id)}">Void</button>`:`<small class="warn">Voided: ${esc(x.void_reason)}</small>`}</td></tr>`).join('')}</tbody></table></div>`:'';
  show('95% measurement register',`<p class="info full">${esc(TARGET_NOTE)}</p>${overall}<div class="actions"><button type="button" data-tools="record" data-id="Baseline">Record a baseline</button><button type="button" data-tools="record" data-id="Current">Record a period</button></div>${rows}<h3>Entries</h3>${hist}`,null,null);
  const b=$('#editorBody');if(b)b.onclick=async ev=>{const x=ev.target.closest('[data-tools]');if(!x)return;try{
   if(x.dataset.tools==='record')record(r,x.dataset.id);
   else if(x.dataset.tools==='void')show('Void this entry',form('<label class="full">Why is it voided? * <textarea name="reason" required minlength="10" maxlength="500"></textarea></label>','Void'),f=>request({action:'target_measure_void',measurement_id:x.dataset.id,reason:f.get('reason')}),()=>target());
  }catch(err){notice(err.message,true);}};
 }
 function record(r,kind){
  const cur=kind==='Current',month=new Date().toISOString().slice(0,7);
  show(cur?'Record a period':'Record a baseline',form(`<p class="full info">${cur?'Minutes taken now, and whether the work passed review first time.':'Minutes the activity took before the ERP: timed, from timesheets, or estimated with a stated basis.'}</p>`
   +select('activity','Activity *',r.activities.map(a=>[a,a]),'','Choose')+select('client_id','Client (leave blank for firm-wide)',r.clients.map(c=>[c.client_id,c.company_name]),'','Firm-wide')
   +field('period_label','Month the work belongs to *',month,'month','required')+field('minutes','Minutes *','','number','required min="0.1" step="0.1"')
   +select('method','How the minutes were obtained *',r.methods.map(m=>[m,m]),'','Choose')+`<label class="full">Note (needed for an estimate)<textarea name="note" maxlength="1000"></textarea></label>`
   +(cur?`<label class="full"><input type="checkbox" name="first_pass" checked> It passed review first time</label>`+field('rework_minutes','Rework minutes after review','0','number','min="0" step="0.1"')+`<label class="full"><input type="checkbox" name="missed_deadline"> A deadline was missed</label>`:''),'Save'),
   f=>request({action:'target_measure_record',kind,activity:f.get('activity'),client_id:f.get('client_id')||undefined,period_label:f.get('period_label'),minutes:f.get('minutes'),method:f.get('method'),note:f.get('note')||undefined,...(cur?{first_pass:f.has('first_pass'),rework_minutes:f.get('rework_minutes')||0,missed_deadline:f.has('missed_deadline')}:{})}),()=>target());
 }
 async function handle(action,id){
  if(action==='tools-search'){await search();return true;}
  if(action==='tools-calendar'){await calendar();return true;}
  if(action==='tools-paylog'){await payLog();return true;}
  if(action==='tools-target'){await target();return true;}
  return false;
 }
 return {card,handle,search,calendar,payLog,target};
}
