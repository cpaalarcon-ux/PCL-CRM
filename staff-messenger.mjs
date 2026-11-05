import {createClient} from './vendor/supabase-discussion.mjs';
import {loadPrefs,savePrefs,incomingChats,shouldBeep,titleWithCount,createBeeper,tickFor} from './staff-messenger-alerts.mjs?v=20261105-check-v1';
import {createCalls,callsSupported} from './staff-chat-call.mjs?v=20261105-check-v1';
// A WhatsApp-style messenger docked beside the account area: one-to-one chats, groups made by a System Administrator,
// and the existing project / task discussions in one list. Messages stay immutable and private; a System Administrator
// manages groups and members but never reads a chat they are not in.
export function createMessenger(ctx){
 const {esc,request,notice}=ctx,d=()=>ctx.data();
 const state={open:false,view:'list',tab:'chats',channels:[],selected:null,thread:null,groups:[],directory:[],contacts:[],query:'',busy:false};
 let timer=null,callTimer=null,client=null,subscription=null,userSub=null,userToken=null,userOk=false,generation=0,mounted=false,baselined=false,baseTitle=null,unlockBound=false;
 const prefs=loadPrefs(),beeper=createBeeper(window),calls=createCalls({request,notice,beeper,onChange:()=>paintBadge()}),viewingId=()=>state.open&&state.view==='thread'&&document.visibilityState==='visible'?state.selected:null;
 const isAdmin=()=>d()?.me?.category_code==='ADMIN',isIntern=()=>d()?.me?.category_code==='INTERN';
 const nairobi=x=>new Date(x),sameDay=(a,b)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(a)===new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(b);
 const clock=x=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit'}).format(nairobi(x));
 const listTime=x=>{if(!x)return '';const t=nairobi(x),n=new Date();return sameDay(t,n)?'Today '+clock(x):sameDay(t,new Date(n.getTime()-86400000))?'Yesterday '+clock(x):new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',day:'2-digit',month:'short'}).format(t)+' '+clock(x);};
 const dayLabel=x=>{const t=nairobi(x),n=new Date();return sameDay(t,n)?'Today':sameDay(t,new Date(n.getTime()-86400000))?'Yesterday':new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',dateStyle:'medium'}).format(t);};
 const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';
 const label=c=>c.display_title||c.title||'Conversation';
 const icon=c=>c.kind==='Group'?'👥':c.kind==='Direct'?initials(label(c)):c.kind==='Task'?'☑':'▤';
 const kindLabel=c=>({Direct:'One-to-one',Group:'Group',Task:'Task discussion',Project:'Project discussion'}[c.kind]||c.kind);
 const roleLabel=code=>({PARTNER:'Engagement Partner',MANAGER:'Manager',SUPERVISOR:'Audit Supervisor',ASSISTANT:'Audit Assistant',INTERN:'Intern',ADMIN:'System Administrator'}[code]||code);
 const unreadTotal=()=>state.channels.reduce((n,c)=>n+Number(c.unread||0),0);
 function mount(){
  const host=document.querySelector('#messenger');if(!host)return;
  if(!host.dataset.ready){host.dataset.ready='1';host.innerHTML=`<button type="button" id="messengerButton" class="messenger-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="messengerPanel"><span aria-hidden="true">💬</span> Chat<span id="messengerBadge" class="messenger-badge" hidden></span></button><section id="messengerPanel" class="messenger-panel" role="dialog" aria-label="Staff chat" hidden></section>`;}
  mounted=true;paintBadge();
 }
 function paintBadge(){
  const badge=document.querySelector('#messengerBadge'),button=document.querySelector('#messengerButton');if(!badge||!button)return;
  const n=unreadTotal();badge.hidden=!n;badge.textContent=n>99?'99+':String(n);button.setAttribute('aria-label',n?`Chat, ${n} unread`:'Chat');button.setAttribute('aria-expanded',String(state.open));
  baseTitle??=document.title.replace(/^\(\d+\+?\)\s+/,'');const counted=titleWithCount(baseTitle,n);document.title=calls.ringing()?'📞 Incoming call · '+counted:counted;
 }
 async function refreshList(){
  if(!d())return;
  try{
   const next=(await request({action:'discussion_list'})).channels||[],fresh=incomingChats(baselined?state.channels:null,next,d().me.staff_id,{viewing:viewingId()});
   state.channels=next;baselined=true;if(shouldBeep(fresh,prefs))beeper.play();
  }catch{ /* The next poll recovers. */ }
  paintBadge();if(state.open&&state.view==='list'&&state.tab==='chats')paintBody();
 }
 function visibleChannels(){const q=state.query.trim().toLowerCase();return state.channels.filter(c=>!q||label(c).toLowerCase().includes(q)||String(c.last_body||'').toLowerCase().includes(q));}
 function header(title,sub,back,extra=''){return `<header class="messenger-head">${back?'<button type="button" class="messenger-icon" data-msgr="back" aria-label="Back to chats">←</button>':''}<div class="messenger-title"><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>${extra}<button type="button" class="messenger-icon" data-msgr="close" aria-label="Close chat">✕</button></header>`;}
 const soundButton=()=>`<button type="button" class="messenger-icon" data-msgr="sound" aria-pressed="${prefs.sound}" aria-label="${prefs.sound?'Message sound is on. Turn it off':'Message sound is off. Turn it on'}" title="${prefs.sound?'Sound on':'Sound off'}">${prefs.sound?'🔔':'🔕'}</button>`,
  callButtons=c=>{if(c.kind!=='Direct'||state.thread?.read_only||!callsSupported(window))return '';const n=esc(label(state.thread.listing||c));return `<button type="button" class="messenger-icon" data-msgr="call-audio" aria-label="Start a voice call with ${n}" title="Voice call">📞</button><button type="button" class="messenger-icon" data-msgr="call-video" aria-label="Start a video call with ${n}" title="Video call">📹</button>`;},
  muteButton=id=>`<button type="button" class="messenger-icon" data-msgr="mute-chat" data-id="${esc(id)}" aria-pressed="${!!prefs.muted[id]}" aria-label="${prefs.muted[id]?'This chat is muted. Unmute it':'Mute sound for this chat'}" title="${prefs.muted[id]?'Muted':'Mute this chat'}">${prefs.muted[id]?'🔕':'🔔'}</button>`;
 function chatRow(c){
  const mine=c.last_author_id&&c.last_author_id===d().me.staff_id,who=mine?'You':(c.last_author_name||'Staff'),preview=c.last_body?c.last_body:'No messages yet';
  return `<button type="button" class="messenger-row ${state.selected===c.channel_id?'selected':''}" data-msgr="open" data-id="${esc(c.channel_id)}"><span class="messenger-avatar ${c.kind==='Group'?'group':''}" aria-hidden="true">${esc(icon(c))}</span><span class="messenger-row-main"><span class="messenger-row-top"><b>${esc(label(c))}${prefs.muted[c.channel_id]?' <span class="messenger-muted" role="img" aria-label="Muted" title="Muted">🔕</span>':''}</b><small>${esc(listTime(c.last_message_at))}</small></span><span class="messenger-row-bottom"><span class="messenger-preview">${c.last_body?`<b class="messenger-who">${esc(who)}:</b> `:''}${esc(preview)}</span>${Number(c.unread)?`<span class="messenger-unread" aria-label="${Number(c.unread)} unread">${Number(c.unread)}</span>`:''}</span></span></button>`;
 }
 function listView(){
  const tabs=isAdmin()?`<div class="messenger-tabs" role="tablist"><button type="button" role="tab" aria-selected="${state.tab==='chats'}" data-msgr="tab" data-id="chats" class="${state.tab==='chats'?'on':''}">Chats</button><button type="button" role="tab" aria-selected="${state.tab==='groups'}" data-msgr="tab" data-id="groups" class="${state.tab==='groups'?'on':''}">Manage groups</button></div>`:'';
  if(isAdmin()&&state.tab==='groups')return header('Manage groups','Create groups and choose who is in them')+tabs+`<div class="messenger-actions"><button type="button" class="messenger-primary" data-msgr="group-new">+ New group</button></div><div class="messenger-scroll" id="messengerBody"></div><p class="messenger-note">You manage groups and members. You cannot read a group’s messages unless you are a member.</p>`;
  return header('Chat','Private staff conversations',false,soundButton())+tabs+`<div class="messenger-actions"><input type="search" id="messengerSearch" placeholder="Search chats" aria-label="Search chats" value="${esc(state.query)}">${isIntern()?'':'<button type="button" class="messenger-primary" data-msgr="new">+ New chat</button>'}</div><div class="messenger-scroll" id="messengerBody"></div>`;
 }
 function paintBody(){
  const body=document.querySelector('#messengerBody');if(!body)return;
  if(state.view==='list'&&isAdmin()&&state.tab==='groups'){
   body.innerHTML=state.groups.map(g=>`<article class="messenger-group"><div class="messenger-row-top"><b>👥 ${esc(g.title)}</b><button type="button" data-msgr="group-members" data-id="${esc(g.channel_id)}">Members (${g.members.length})</button></div><small>${g.members.map(m=>esc(m.full_name)).join(', ')}</small></article>`).join('')||'<p class="messenger-empty">No groups yet. Choose + New group, name it and pick at least two people.</p>';return;
  }
  const rows=visibleChannels();
  body.innerHTML=rows.map(chatRow).join('')||`<p class="messenger-empty">${state.channels.length?'No chat matches your search.':isIntern()?'No conversations yet. You can reply when a colleague writes to you.':'No conversations yet. Choose + New chat to message a colleague.'}</p>`;
 }
 function threadView(){
  const c=state.thread?.channel,sub=c?(c.kind==='Group'?`Group · ${state.thread.members?.length||''} members`:kindLabel(c)):'';
  return header(state.thread?label(state.thread.listing||c):'Chat',sub,true,c?callButtons(c)+muteButton(c.channel_id):'')+`<div class="messenger-messages" id="messengerMessages" tabindex="0" aria-live="polite" aria-label="Conversation messages"></div>${state.thread?.read_only?'<p class="messenger-note">This conversation is closed and read-only.</p>':`<form id="messengerSend" class="messenger-composer"><textarea name="body" rows="1" maxlength="4000" placeholder="Type a message" aria-label="Message" required></textarea><button type="submit" class="messenger-primary" aria-label="Send message">Send</button></form><small id="messengerState" class="messenger-error" role="alert"></small>`}`;
 }
 function paintMessages(){
  const box=document.querySelector('#messengerMessages');if(!box||!state.thread)return;
  const me=d().me.staff_id,group=state.thread.channel.kind!=='Direct',positions=state.thread.read_positions,lastOwn=[...state.thread.messages].reverse().find(x=>x.author_id===me)?.message_id;let day='',html='';
  for(const m of state.thread.messages){
   const dl=dayLabel(m.created_at);if(dl!==day){day=dl;html+=`<div class="messenger-day"><span>${esc(dl)}</span></div>`;}
   const own=m.author_id===me;
   html+=`<div class="messenger-bubble ${own?'own':''}"><div class="messenger-meta"><b class="messenger-author">${own?'You':esc(m.author_name||'Staff')}</b><small>${esc(clock(m.created_at))}${(()=>{const t=tickFor(m,me,positions);return t?` <span class="messenger-tick ${t.state}" role="img" aria-label="${esc(t.label)}" title="${esc(t.label)}">${t.glyph}</span>`:'';})()}</small></div><p>${esc(m.body)}</p>${m.message_id===lastOwn&&tickFor(m,me,positions)?`<small class="messenger-tick-label">${esc(tickFor(m,me,positions).label)}</small>`:''}</div>`;
  }
  box.innerHTML=(state.thread.has_older?`<button type="button" class="messenger-older" data-msgr="older">Load earlier messages</button>`:'')+(html||'<p class="messenger-empty">No messages yet. Say hello.</p>');
  box.scrollTop=box.scrollHeight;
 }
 function paint(){
  const panel=document.querySelector('#messengerPanel');if(!panel)return;panel.hidden=!state.open;if(!state.open)return;
  let html='';
  if(state.view==='thread')html=threadView();
  else if(state.view==='new')html=header('New chat','Choose a colleague',true)+`<div class="messenger-actions"><input type="search" id="messengerContactSearch" placeholder="Search staff" aria-label="Search staff"></div><div class="messenger-scroll" id="messengerContacts"></div>`;
  else if(state.view==='group-new'||state.view==='group-edit')html=groupForm();
  else html=listView();
  panel.innerHTML=html;
  if(state.view==='thread')paintMessages();
  else if(state.view==='list')paintBody();
  else if(state.view==='new')paintContacts('');
  else paintPick('');
 }
 function paintContacts(q){
  const box=document.querySelector('#messengerContacts');if(!box)return;q=q.trim().toLowerCase();
  const rows=state.contacts.filter(s=>!q||s.full_name.toLowerCase().includes(q));
  box.innerHTML=rows.map(s=>`<button type="button" class="messenger-row" data-msgr="start" data-id="${esc(s.staff_id)}"><span class="messenger-avatar" aria-hidden="true">${esc(initials(s.full_name))}</span><span class="messenger-row-main"><span class="messenger-row-top"><b>${esc(s.full_name)}</b></span><span class="messenger-row-bottom"><span class="messenger-preview">${esc(roleLabel(s.category_code))}</span></span></span></button>`).join('')||'<p class="messenger-empty">No colleague matches.</p>';
 }
 let picked=new Set(),editing=null;
 function groupForm(){
  const edit=state.view==='group-edit';
  return header(edit?'Group members':'New group',edit?editing?.title:'Name it and choose at least two people',true)+`<form id="messengerGroup" class="messenger-groupform">${edit?'':'<label>Group name<input name="title" required minlength="2" maxlength="100" autocomplete="off" placeholder="For example: Filing deadlines"></label>'}<input type="search" id="messengerPickSearch" placeholder="Search staff" aria-label="Search staff"><div class="messenger-scroll" id="messengerPick"></div><small id="messengerState" class="messenger-error" role="alert"></small><button type="submit" class="messenger-primary">${edit?'Save members':'Create group'}</button></form>`;
 }
 function paintPick(q){
  const box=document.querySelector('#messengerPick');if(!box)return;q=q.trim().toLowerCase();
  box.innerHTML=state.directory.filter(s=>!q||s.full_name.toLowerCase().includes(q)).map(s=>`<label class="messenger-pick"><input type="checkbox" value="${esc(s.staff_id)}" ${picked.has(s.staff_id)?'checked':''}><span class="messenger-avatar" aria-hidden="true">${esc(initials(s.full_name))}</span><span><b>${esc(s.full_name)}</b><small>${esc(roleLabel(s.category_code))}</small></span></label>`).join('')||'<p class="messenger-empty">No staff match.</p>';
 }
 const newClient=()=>createClient('https://yfjiculexbzpkvtapudk.supabase.co','sb_publishable_ibWMisivJ2reyfJl1eHP9A_HFuFY3Hc',{auth:{persistSession:false,autoRefreshToken:false}});
 // My own call topic: a ring or hang-up reaches me at once. Polling in start() covers the time realtime is not connected.
 async function userLive(){
  try{
   const raw=JSON.parse(localStorage.getItem('pcl-staff-session-v2')||'null');if(!raw?.access_token||!d())return;
   // Only a real signed token is worth a live connection (a placeholder token would just be refused and retried for ever).
   if(!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(raw.access_token))return;
   if(userSub&&raw.access_token===userToken)return;
   client??=newClient();await client.realtime.setAuth(raw.access_token);userToken=raw.access_token;
   if(!userSub)userSub=client.channel('pcl-user:'+d().me.staff_id,{config:{private:true}}).on('broadcast',{event:'call'},()=>calls.poke()).subscribe(st=>{userOk=st==='SUBSCRIBED';});
  }catch{ /* The checks in start() keep calls ringing without realtime. */ }
 }
 async function live(channel){
  try{
   const raw=JSON.parse(localStorage.getItem('pcl-staff-session-v2')||'null');if(!raw?.access_token)return;
   client??=newClient();
   await client.realtime.setAuth(raw.access_token);userToken=raw.access_token;if(subscription){await client.removeChannel(subscription);subscription=null;}
   subscription=client.channel('pcl-discussion:'+channel,{config:{private:true}}).on('broadcast',{event:'changed'},()=>{if(state.selected===channel&&state.open&&document.visibilityState==='visible')void loadThread(channel,{quiet:true});void refreshList();}).subscribe();
  }catch{ /* The poll below keeps messages arriving without realtime. */ }
 }
 async function loadThread(id,{before=null,quiet=false}={}){
  const token=++generation;
  try{
   const r=await request({action:'discussion_messages',channel_id:id,before_sequence:before||undefined});if(token!==generation||!d())return;
   const listing=state.channels.find(c=>c.channel_id===id)||r.channel,prior=before?state.thread?.messages||[]:[];
   let members=state.thread?.channel?.channel_id===id?state.thread.members:null;
   if(r.channel.kind==='Group'&&!members){try{members=(await request({action:'discussion_group_overview',channel_id:id})).groups?.[0]?.members||[];}catch{members=[];}}
   const draft=document.querySelector('#messengerSend textarea')?.value||'';
   state.thread={channel:r.channel,listing,messages:[...r.messages,...prior],has_older:r.has_older,read_only:r.read_only,members,read_positions:r.read_positions||null};state.selected=id;
   if(state.open&&state.view==='thread'){paint();const t=document.querySelector('#messengerSend textarea');if(t&&draft){t.value=draft;}}
   if(!before&&document.visibilityState==='visible'&&r.messages.length&&state.open){await request({action:'discussion_read',channel_id:id,last_sequence:Number(r.messages.at(-1).sequence)});await refreshList();}
  }catch(e){if(!quiet)notice(e.message,true);}
 }
 async function openChannel(id){state.view='thread';state.selected=id;state.thread=null;paint();calls.prepare();await loadThread(id);await live(id);document.querySelector('#messengerSend textarea')?.focus();}
 async function send(form){
  const area=form.querySelector('textarea'),btn=form.querySelector('button[type=submit]'),body=area.value.trim();if(!body||!state.selected)return;
  btn.disabled=true;btn.dataset.request??=crypto.randomUUID();
  try{await request({action:'discussion_send',channel_id:state.selected,request_id:btn.dataset.request,body});area.value='';delete btn.dataset.request;await loadThread(state.selected,{quiet:true});await refreshList();area.focus();}
  catch(e){const s=document.querySelector('#messengerState');if(s)s.textContent=e.message;}
  finally{btn.disabled=false;}
 }
 async function showList(tab){
  state.view='list';if(tab)state.tab=tab;state.selected=null;state.thread=null;generation++;
  if(subscription){void client?.removeChannel(subscription);subscription=null;}
  paint();
  if(isAdmin()&&state.tab==='groups'){try{state.groups=(await request({action:'discussion_group_overview'})).groups||[];}catch(e){notice(e.message,true);}paintBody();}
  else await refreshList();
 }
 async function click(b){
  const a=b.dataset.msgr,id=b.dataset.id;
  if(a==='close')return toggle(false);
  if(a==='back')return showList();
  if(a==='sound'){prefs.sound=!prefs.sound;savePrefs(prefs);if(prefs.sound){beeper.unlock();beeper.play(Date.now(),true);}paint();return;}
  if(a==='mute-chat'){if(prefs.muted[id])delete prefs.muted[id];else prefs.muted[id]=true;savePrefs(prefs);paint();return;}
  if(a==='call-audio'||a==='call-video'){const c=state.thread?.channel;if(c)return calls.start(c.channel_id,a==='call-video'?'video':'audio',label(state.thread.listing||c));return;}
  if(a==='tab')return showList(id);
  if(a==='open')return openChannel(id);
  if(a==='older'){const first=state.thread?.messages?.[0];if(first)await loadThread(state.selected,{before:Number(first.sequence)});return;}
  if(a==='new'){state.contacts=((await request({action:'discussion_candidates'})).candidates||[]).filter(s=>s.staff_id!==d().me.staff_id);state.view='new';paint();document.querySelector('#messengerContactSearch')?.focus();return;}
  if(a==='start'){const r=await request({action:'discussion_open',kind:'Direct',staff_id:id});await refreshList();return openChannel(r.channel.channel_id);}
  if(a==='group-new'){state.directory=(await request({action:'discussion_staff_directory'})).staff||[];picked=new Set();editing=null;state.view='group-new';paint();document.querySelector('#messengerGroup input[name=title]')?.focus();return;}
  if(a==='group-members'){state.directory=(await request({action:'discussion_staff_directory'})).staff||[];editing=state.groups.find(g=>g.channel_id===id);picked=new Set((editing?.members||[]).map(m=>m.staff_id));state.view='group-edit';paint();return;}
 }
 async function submitGroup(form){
  const out=document.querySelector('#messengerState'),btn=form.querySelector('button[type=submit]');btn.disabled=true;if(out)out.textContent='';
  try{
   const ids=[...picked];
   if(state.view==='group-edit'){
    if(ids.length<2)throw new Error('Keep at least two members in the group.');
    const before=new Set(editing.members.map(m=>m.staff_id));
    await request({action:'discussion_group_members_set',channel_id:editing.channel_id,add:ids.filter(x=>!before.has(x)),remove:[...before].filter(x=>!picked.has(x))});
    notice('Group members saved.');
   }else{
    if(ids.length<2)throw new Error('Choose at least two members.');
    await request({action:'discussion_group_create',title:form.elements.title.value,member_ids:ids});notice('Group created. Members were notified.');
   }
   await showList('groups');
  }catch(e){if(out)out.textContent=e.message;}finally{btn.disabled=false;}
 }
 function toggle(open=!state.open){
  state.open=open;paint();paintBadge();
  if(open){if(state.view==='list')void showList();else if(state.view==='thread'&&state.selected)void loadThread(state.selected,{quiet:true});document.querySelector('#messengerPanel')?.querySelector('input,textarea,button')?.focus?.();}
  else{document.querySelector('#messengerButton')?.focus();}
 }
 document.addEventListener('click',async e=>{
  if(!d())return;
  if(e.target.closest('#messengerButton')){toggle();return;}
  const b=e.target.closest('[data-msgr]');if(b){try{await click(b);}catch(err){notice(err.message,true);}return;}
  const openers=e.target.closest('[data-messenger-open]');if(openers){toggle(true);return;}
  if(state.open&&!e.target.closest('#messenger,#callOverlay'))toggle(false);
 });
 document.addEventListener('input',e=>{
  if(e.target.id==='messengerSearch'){state.query=e.target.value;paintBody();}
  if(e.target.id==='messengerContactSearch')paintContacts(e.target.value);
  if(e.target.id==='messengerPickSearch')paintPick(e.target.value);
  if(e.target.matches?.('#messengerPick input[type=checkbox]')){if(e.target.checked)picked.add(e.target.value);else picked.delete(e.target.value);}
  if(e.target.matches?.('#messengerSend textarea')){e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';}
 });
 document.addEventListener('change',e=>{if(e.target.matches?.('#messengerPick input[type=checkbox]')){if(e.target.checked)picked.add(e.target.value);else picked.delete(e.target.value);}});
 document.addEventListener('submit',e=>{
  if(e.target.id==='messengerSend'){e.preventDefault();void send(e.target);}
  if(e.target.id==='messengerGroup'){e.preventDefault();void submitGroup(e.target);}
 });
 document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&state.open&&document.querySelector('#messengerPanel')?.contains(document.activeElement))toggle(false);
  if(e.key==='Enter'&&!e.shiftKey&&e.target.matches?.('#messengerSend textarea')){e.preventDefault();e.target.form.requestSubmit();}
 });
 function start(){
  mount();if(timer)return;void refreshList();void calls.check();void userLive();
  if(!unlockBound){unlockBound=true;for(const ev of ['pointerdown','keydown'])document.addEventListener(ev,()=>beeper.unlock(),{capture:true,passive:true});}
  // Keep checking while the tab is in the background so the title count and the beep work there; a hidden tab only refreshes the list, never the open conversation.
  timer=window.setInterval(()=>{if(!d())return;void refreshList();void calls.check();void userLive();if(document.visibilityState==='visible'&&state.open&&state.view==='thread'&&state.selected)void loadThread(state.selected,{quiet:true});},15000);
  callTimer=window.setInterval(()=>{if(d()&&!userOk)void calls.check();},3000);
 }
 function stop(){
  if(timer)window.clearInterval(timer);timer=null;if(callTimer)window.clearInterval(callTimer);callTimer=null;calls.stop();if(userSub)void client?.removeChannel(userSub);userSub=null;userToken=null;userOk=false;generation++;baselined=false;if(baseTitle!==null){document.title=baseTitle;baseTitle=null;}if(subscription)void client?.removeChannel(subscription);subscription=null;
  Object.assign(state,{open:false,view:'list',tab:'chats',channels:[],selected:null,thread:null,groups:[],directory:[],contacts:[],query:''});picked=new Set();editing=null;
  const host=document.querySelector('#messenger');if(host){host.replaceChildren();delete host.dataset.ready;}
 }
 return {start,stop,open:()=>toggle(true),unread:unreadTotal,isMounted:()=>mounted};
}
