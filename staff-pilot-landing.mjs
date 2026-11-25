import {createStaffSession,watchStaffActivity} from './staff-session.mjs?v=20261103-idle-timeout-v1';
import {WORKSPACE_AREAS,WORKSPACE_ROLES} from './staff-nav.mjs?v=20261121-comply-v1&landing=20261125-v1';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',day:'numeric',month:'short',year:'numeric'});
const url=(name,value)=>'#'+new URLSearchParams({[name]:value});
const link=(hash,label,classes)=>`<a class="${classes}" data-open-workspace href="${esc(hash)}">${label}</a>`;

function paintWork(work){
 const details=link('#view=home','Open full dashboard','link');
 if(!work)return `<section class="card"><h2>My workspace</h2>${details}</section>`;
 const rows=work.tasks.map(t=>`<div class="home-exception-row"><div><b>${esc(t.task_name)}</b><small>${esc(t.project_name)} · ${esc(t.status)} · ${t.due_at?esc(date.format(new Date(t.due_at))):'No due date'}</small></div>${link(url('task',t.task_id),'Open task','link')}</div>`).join('');
 return `<section class="home-summary-metrics" aria-label="My work summary">
  <div class="card metric"><b>${esc(work.open_count)}</b><span>My open tasks</span></div>
  <div class="card metric overdue-metric"><b>${esc(work.overdue_count)}</b><span>Overdue</span></div>
 </section><section class="card home-queue" aria-labelledby="landingMyWork">
  <div class="section-head"><h2 id="landingMyWork">My Work</h2>${details}</div>
  ${rows||'<p class="empty">No open tasks are assigned to you.</p>'}
  ${work.open_count>work.tasks.length?link('#view=projects','View all tasks','link'):''}
 </section>`;
}

export async function mountStaffLanding({send,notice,openFullWorkspace,sessionEnded}){
 const events=new AbortController();
 const hiddenUntilOpen=[$('.workspace-search'),$('#openTimingLog')];
 let data,stopWatching,heartbeatTimer,attendance=null,changingFirm=0,opening=false;
 const session=createStaffSession({storage:localStorage,send,onEnd:message=>{
  dispose();
  document.body.classList.remove('workspace-active');
  $('#workspace').hidden=true;
  $('#signin').hidden=false;
  $('#content').replaceChildren();
  $('#account').replaceChildren();
  sessionEnded(message);
 }});
 const setNav=open=>{
  document.body.classList.toggle('nav-open',open);
  $('#navToggle').setAttribute('aria-expanded',String(open));
 };
 function dispose(){
  events.abort();
  pauseActivity();
  hiddenUntilOpen.forEach(element=>{element.hidden=false;});
  setNav(false);
 }
 function pauseActivity(){
  stopWatching?.();
  clearInterval(heartbeatTimer);
 }
 function watchActivity(){
  const stop=watchStaffActivity(session);
  if(events.signal.aborted){stop();return;}
  stopWatching=stop;
  if(data.me.allowed_areas.includes('time_hr')){
   heartbeatTimer=setInterval(()=>void trackPresence(),60000);
   void trackPresence();
  }
 }
 async function request(payload,timeoutMs=15000){
  const context=await session.beforeRequest();
  try{
   const result=await send(payload,{headers:context.headers,timeoutMs});
   session.accept(context);
   return result;
  }catch(error){
   session.reject(context,error);
   throw error;
  }
 }
 async function trackPresence(){
  if(!opening&&session.active)try{attendance=(await request({action:'presence_heartbeat'})).attendance;}catch{/* Presence can recover on the next heartbeat. */}
 }
 function paint(){
  const {me,firms,firm_id,uat_client_scope,my_work}=data,areas=WORKSPACE_AREAS.filter(item=>me.allowed_areas.includes(item.area));
  $('#roleLabel').textContent=`${WORKSPACE_ROLES[me.category_code]} · ${me.login_id}`;
  $('#greeting').textContent='My workspace';
  $('#account').innerHTML=`<span>${esc(me.full_name)}</span><button type="button" data-landing-signout>Sign out</button>`;
  $('#firmFilter').replaceChildren(new Option('All authorised firms',''),...firms.map(f=>new Option(`${f.firm_code} · ${f.legal_name}`,f.firm_id)));
  $('#firmFilter').value=firm_id||'';
  $('.firm-picker').hidden=me.category_code==='INTERN';
  $('#uatScopeNotice').hidden=!uat_client_scope;
  $('#areasLauncher').hidden=false;
  $('#areasHome').setAttribute('aria-current','page');
  $('#sideNav').innerHTML=`<a class="side-item" href="#view=home" aria-current="page"><span class="side-icon" aria-hidden="true">⌂</span><span class="side-label">Home</span></a>`+areas.map(a=>link(url('view',a.view),`<span class="side-icon" aria-hidden="true">${a.icon}</span><span class="side-label">${esc(a.title)}</span>`,'side-item')).join('');
  $('#nav').innerHTML=areas.map(a=>link(url('view',a.view),`<span class="workspace-area-icon" aria-hidden="true">${a.icon}</span><b>${esc(a.title)}</b><small>${esc(a.desc)}</small>`,`workspace-area-card tone-${a.tone}`)).join('')||'<p class="empty">No workspace areas are assigned to this account.</p>';
  $('#content').innerHTML=paintWork(my_work);
 }
 async function openSection(hash,signOut=false){
  if(opening||!session.check())return;
  opening=true;
  changingFirm++;
  pauseActivity();
  setNav(false);
  notice('Opening workspace area…');
  const previousHash=location.hash;
  if(previousHash!==hash)history.pushState(null,'',hash);
  try{
   await openFullWorkspace({firmId:data.firm_id||'',signOut});
   if(!events.signal.aborted)dispose();
  }catch{
   if(!session.check())return;
   if(previousHash!==hash)history.replaceState(null,'',previousHash||location.pathname+location.search);
   opening=false;
   watchActivity();
   notice('The workspace area could not load. Select it again to retry.',true);
  }
 }

 data=await request({action:'workspace_landing'});
 if(events.signal.aborted)return {end:()=>{}};
 paint();
 hiddenUntilOpen.forEach(element=>{element.hidden=true;});
 document.body.classList.add('workspace-active');
 $('#signin').hidden=true;
 $('#workspace').hidden=false;
 notice('');
 const options={capture:true,signal:events.signal};
 document.addEventListener('click',event=>{
  const control=event.target.closest?.('[data-open-workspace],[data-landing-signout],#navToggle,#navBackdrop,#areasHome,#sideNav a[aria-current]');
  if(!control||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if(control.id==='navToggle'){setNav(!document.body.classList.contains('nav-open'));return;}
  if(control.id==='navBackdrop'){setNav(false);return;}
  if(control.id==='areasHome'||control.matches('#sideNav a[aria-current]')){setNav(false);$('#areasLauncher').scrollIntoView?.();return;}
  if(control.hasAttribute('data-landing-signout')){
   if(attendance?.clock_in&&!attendance.clock_out)void openSection('#view=home',true);
   else session.end('Signed out.');
   return;
  }
  void openSection(control.hash);
 },options);
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&document.body.classList.contains('nav-open')){setNav(false);$('#navToggle').focus();}
 },options);
 document.addEventListener('change',async event=>{
  if(event.target!==$('#firmFilter'))return;
  event.stopImmediatePropagation();
  const sequence=++changingFirm;
  if(opening)return;
  try{
   const next=await request({action:'workspace_landing',firm_id:event.target.value});
   if(sequence!==changingFirm||events.signal.aborted)return;
   data=next;
   paint();
   notice('');
  }catch(error){
   if(sequence!==changingFirm||events.signal.aborted)return;
   $('#firmFilter').value=data.firm_id||'';
   notice(error.message,true);
  }
 },options);
 window.addEventListener('hashchange',()=>{
  if(location.hash&&location.hash!=='#view=home')void openSection(location.hash);
 },options);
 watchActivity();
 return {end:()=>{if(!events.signal.aborted)session.end();}};
}
