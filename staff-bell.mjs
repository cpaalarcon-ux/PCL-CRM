// Header notification bell: unread notifications for the signed-in person (stuck-task alerts, pool pulls, reviews). Reading one marks it read for them only.
export function createBell(ctx){
 const {esc,request,notice,data,shortDate,openTask,load}=ctx;
 let open=false;
 const host=()=>document.querySelector('#bell');
 function list(){const d=data();return Array.isArray(d?.notifications)?d.notifications:[];}
 function panel(){
  const items=list();
  return `<header class="bell-head"><b>Notifications</b>${items.length>1?'<button type="button" data-bell="all">Mark all read</button>':''}<button type="button" class="bell-close" data-bell="close" aria-label="Close notifications">✕</button></header><div class="bell-list">${items.slice(0,20).map(n=>`<div class="bell-row"><div>${esc(n.message)}<small>${esc(shortDate(n.created_at))}</small></div><div class="bell-actions">${n.task_id?`<button type="button" data-bell="task" data-task="${esc(n.task_id)}" data-id="${esc(n.notification_id)}">Open task</button>`:''}<button type="button" data-bell="read" data-id="${esc(n.notification_id)}">Mark read</button></div></div>`).join('')||'<p class="muted">You have no unread notifications.</p>'}</div>`;
 }
 function paint(){
  const h=host();if(!h)return;
  if(!data()){h.replaceChildren();h.dataset.ready='';open=false;return;}
  if(!h.dataset.ready){h.dataset.ready='1';h.innerHTML=`<button type="button" id="bellButton" class="bell-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="bellPanel"><span aria-hidden="true">🔔</span><span class="bell-label"> Alerts</span><span id="bellBadge" class="bell-badge" hidden></span></button><section id="bellPanel" class="bell-panel" role="dialog" aria-label="Notifications" hidden></section>`;}
  const n=list().length,badge=h.querySelector('#bellBadge'),btn=h.querySelector('#bellButton'),pnl=h.querySelector('#bellPanel');
  badge.hidden=!n;badge.textContent=n>99?'99+':String(n);btn.setAttribute('aria-label',n?`Notifications, ${n} unread`:'Notifications, none unread');btn.setAttribute('aria-expanded',String(open));
  pnl.hidden=!open;if(open)pnl.innerHTML=panel();
 }
 async function mark(id){await request({action:'notification_read',notification_id:id});}
 document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-bell]'),btn=e.target.closest('#bellButton');
  if(btn){open=!open;paint();return;}
  if(!b){if(open&&!e.target.closest('#bellPanel')){open=false;paint();}return;}
  try{
   const a=b.dataset.bell;
   if(a==='close'){open=false;paint();}
   if(a==='read'){await mark(b.dataset.id);await load();}
   if(a==='all'){for(const n of list().slice(0,50))await mark(n.notification_id);await load();}
   if(a==='task'){await mark(b.dataset.id);open=false;await load();openTask(b.dataset.task);}
  }catch(err){notice(err.message,true);}
 });
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&open){open=false;paint();host()?.querySelector('#bellButton')?.focus();}});
 return {paint};
}
