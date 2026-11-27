import {createClient} from './vendor/supabase-discussion.mjs';
import {loadPrefs,savePrefs,incomingChats,shouldBeep,titleWithCount,createBeeper,tickFor} from './staff-messenger-alerts.mjs?v=20261105-check-v1';
import {createCalls,callsSupported} from './staff-chat-call.mjs?v=20261126-agora';
// The staff workspace keeps private conversations and related work together: direct chats, administrator-managed groups,
// and the existing project / task discussions in one list. Messages stay immutable and private; a System Administrator
// manages groups and members but never reads a chat they are not in.
import {observeMessengerThread} from './staff-messenger-thread.mjs?v=20261119-workspace';
import {openFollowupForm} from './staff-communication-followups.mjs?v=1';

const filters=['All','Unread','Direct','Groups'];
const fileTypes='.pdf,.csv,.xlsx,.docx,.png,.jpg,.jpeg';
const voiceTypes=['webm','ogg','m4a'];
const audioType=mime=>['audio/webm','audio/ogg','audio/mp4'].includes(mime);
const voiceLimitMs=5*60*1000;
const sizeLabel=size=>size>=1024*1024?`${(size/(1024*1024)).toFixed(1)} MB`:`${Math.max(1,Math.round(size/1024))} KB`;
const imageType=mime=>['image/png','image/jpeg'].includes(mime);

export function createMessenger(ctx){
 const {esc,request,notice,uploadMessenger,openTask}=ctx,d=()=>ctx.data();
 const panel=()=>document.querySelector('#messengerPanel');
 const currentComposer=()=>document.querySelector('#messengerSend');
 const fileTile=name=>`<span class="messenger-file-format" aria-hidden="true">${esc(name.split('.').pop()?.toUpperCase()||'FILE')}</span>`;
 const REACTIONS=['👍','❤️','😂','😮','🙏','✅'];
 const drafts=new Map(),images=new Map();
 const getDraft=(id=state.selected)=>{
  if(!drafts.has(id))drafts.set(id,{text:'',files:[],shared:null,reply:null,mentions:new Map(),error:'',sending:false,request:null});
  return drafts.get(id);
 };
 let threadDisplay=null,threadRequest=null,markedRead=null,opener=null,pendingShare=null,dragDepth=0;
 let imageObserver=null;

 const state={open:false,view:'list',tab:'chats',channels:[],selected:null,thread:null,groups:[],directory:[],contacts:[],query:'',filter:'All'};
 let timer=null,callTimer=null,client=null,subscription=null,userSub=null,userToken=null,userOk=false,generation=0,mounted=false,baselined=false,baseTitle=null,unlockBound=false;
 let sourceMessage=null;
 const prefs=loadPrefs(),beeper=createBeeper(window),calls=createCalls({request,notice,beeper,onChange:()=>paintBadge(),host:()=>panel()?.open?panel():document.body}),viewingId=()=>state.open&&state.view==='thread'&&document.visibilityState==='visible'?state.selected:null;
 const isAdmin=()=>d()?.me?.category_code==='ADMIN',isIntern=()=>d()?.me?.category_code==='INTERN';
 const nairobi='Africa/Nairobi';
 const dayKey=new Intl.DateTimeFormat('en-CA',{timeZone:nairobi});
 const timeFormat=new Intl.DateTimeFormat('en-GB',{timeZone:nairobi,hour:'2-digit',minute:'2-digit'});
 const shortDay=new Intl.DateTimeFormat('en-GB',{timeZone:nairobi,day:'2-digit',month:'short'});
 const longDay=new Intl.DateTimeFormat('en-GB',{timeZone:nairobi,dateStyle:'medium'});
 const clock=value=>timeFormat.format(new Date(value));
 function relativeDay(value){
  const date=new Date(value),now=new Date(),key=dayKey.format(date);
  if(key===dayKey.format(now))return 'Today';
  if(key===dayKey.format(new Date(now.getTime()-86400000)))return 'Yesterday';
  return '';
 }
 const listTime=value=>value?`${relativeDay(value)||shortDay.format(new Date(value))} ${clock(value)}`:'';
 const dayLabel=value=>relativeDay(value)||longDay.format(new Date(value));
 const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';
 const label=c=>c.display_title||c.title||'Conversation';
 const icon=c=>c.kind==='Group'?'👥':c.kind==='Direct'?initials(label(c)):c.kind==='Task'?'☑':'▤';
 const kindLabel=c=>({Direct:'One-to-one',Group:'Group',Task:'Task discussion',Project:'Project discussion'}[c.kind]||c.kind);
 const roleLabel=code=>({PARTNER:'Engagement Partner',MANAGER:'Manager',SUPERVISOR:'Audit Supervisor',ASSISTANT:'Audit Assistant',INTERN:'Intern',ADMIN:'System Administrator'}[code]||code);
 const unreadTotal=()=>state.channels.reduce((n,c)=>n+Number(c.unread||0),0);
 function mount(){
  const host=document.querySelector('#messenger');if(!host)return;
  if(!host.dataset.ready){
   host.dataset.ready='1';
   host.innerHTML=`<button type="button" id="messengerButton" class="messenger-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="messengerPanel"><span aria-hidden="true">💬</span> PCL Messenger<span id="messengerBadge" class="messenger-badge" hidden></span></button>`;
   const dialog=document.createElement('dialog');
   dialog.id='messengerPanel';dialog.className='messenger-panel';dialog.setAttribute('aria-labelledby','messengerTitle');
   dialog.innerHTML=`<header class="messenger-top"><h2 id="messengerTitle">PCL Messenger</h2><div><span id="messengerSound"></span><button type="button" class="messenger-exit" data-msgr="close">Return to ERP</button></div></header><div id="messengerGlobalStatus" class="messenger-global-status" role="alert"></div><div class="messenger-layout" id="messengerLayout"></div>`;
   dialog.addEventListener('cancel',event=>{event.preventDefault();toggle(false);});
   document.body.append(dialog);
  }
  mounted=true;paintBadge();
 }
 const report=message=>{const status=document.querySelector('#messengerGlobalStatus');if(status)status.textContent=message;};
 function paintBadge(){
  const badge=document.querySelector('#messengerBadge'),button=document.querySelector('#messengerButton');if(!badge||!button)return;
  const n=unreadTotal();badge.hidden=!n;badge.textContent=n>99?'99+':String(n);button.setAttribute('aria-label',n?`PCL Messenger, ${n} unread`:'PCL Messenger');button.setAttribute('aria-expanded',String(state.open));
  baseTitle??=document.title.replace(/^\(\d+\+?\)\s+/,'');const counted=titleWithCount(baseTitle,n);document.title=calls.ringing()?'📞 Incoming call · '+counted:counted;
 }
 async function refreshList(){
  if(!d())return;
  const me=d().me.staff_id;
  try{
   const next=(await request({action:'discussion_list'})).channels||[];if(d()?.me.staff_id!==me)return;
   const fresh=incomingChats(baselined?state.channels:null,next,me,{viewing:viewingId()});
   state.channels=next;baselined=true;if(shouldBeep(fresh,prefs))beeper.play();
  }catch{ /* The next poll recovers. */ }
  paintBadge();if(state.open&&state.tab==='chats')paintBody();
 }
 function visibleChannels(){
  const q=state.query.trim().toLowerCase();
  return state.channels.filter(c=>(state.filter==='All'||state.filter==='Unread'&&Number(c.unread)||state.filter==='Direct'&&c.kind==='Direct'||state.filter==='Groups'&&c.kind==='Group')&&
   (!q||label(c).toLowerCase().includes(q)||String(c.last_body||'').toLowerCase().includes(q)));
 }
 function header(title,sub,back,extra=''){return `<header class="messenger-head">${back?'<button type="button" class="messenger-icon" data-msgr="back" aria-label="Back to chats">←</button>':''}<div class="messenger-title"><b>${esc(title)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>${extra}</header>`;}
 const soundButton=()=>`<button type="button" class="messenger-icon" data-msgr="sound" aria-pressed="${prefs.sound}" aria-label="${prefs.sound?'Message sound is on. Turn it off':'Message sound is off. Turn it on'}" title="${prefs.sound?'Sound on':'Sound off'}">${prefs.sound?'🔔':'🔕'}</button>`,
  callButtons=c=>{if(c.kind!=='Direct'||state.thread?.read_only||!callsSupported(window))return '';const n=esc(label(state.thread.listing||c));return `<button type="button" class="messenger-icon" data-msgr="call-audio" aria-label="Start a voice call with ${n}" title="Voice call">📞</button><button type="button" class="messenger-icon" data-msgr="call-video" aria-label="Start a video call with ${n}" title="Video call">📹</button>`;},
  muteButton=id=>`<button type="button" class="messenger-icon" data-msgr="mute-chat" data-id="${esc(id)}" aria-pressed="${!!prefs.muted[id]}" aria-label="${prefs.muted[id]?'This chat is muted. Unmute it':'Mute sound for this chat'}" title="${prefs.muted[id]?'Muted':'Mute this chat'}">${prefs.muted[id]?'🔕':'🔔'}</button>`;
 function chatRow(c){
  const mine=c.last_author_id&&c.last_author_id===d().me.staff_id,who=mine?'You':(c.last_author_name||'Staff'),preview=c.last_body?c.last_body:'No messages yet';
  return `<button type="button" class="messenger-row ${state.selected===c.channel_id?'selected':''}" data-msgr="open" data-id="${esc(c.channel_id)}"${state.selected===c.channel_id?' aria-current="true"':''}><span class="messenger-avatar ${c.kind==='Group'?'group':''}" aria-hidden="true">${esc(icon(c))}</span><span class="messenger-row-main"><span class="messenger-row-top"><b>${esc(label(c))}${prefs.muted[c.channel_id]?' <span class="messenger-muted" role="img" aria-label="Muted" title="Muted">🔕</span>':''}</b><small>${esc(listTime(c.last_message_at))}</small></span><span class="messenger-row-bottom"><span class="messenger-preview">${c.last_body?`<b class="messenger-who">${esc(who)}:</b> `:''}${esc(preview)}</span>${Number(c.unread_mentions)?'<span class="messenger-at" role="img" aria-label="You were mentioned" title="You were mentioned">@</span>':''}${Number(c.unread)?`<span class="messenger-unread" aria-label="${Number(c.unread)} unread">${Number(c.unread)}</span>`:''}</span></span></button>`;
 }
 function listView(){
  const cancel=pendingShare?'<button type="button" data-msgr="cancel-share">Cancel sharing</button>':'';
  const manage=isAdmin()?`<button type="button" data-msgr="tab" data-id="${state.tab==='chats'?'groups':'chats'}">${state.tab==='chats'?'Manage groups':'Back to conversations'}</button>`:'';
  if(isAdmin()&&state.tab==='groups')return header('Manage groups','Staff group membership')+`<div class="messenger-actions">${manage}<button type="button" class="messenger-primary" data-msgr="group-new">New group</button></div><div class="messenger-scroll" id="messengerBody"></div>`;
  return `<div class="messenger-actions"><input type="search" id="messengerSearch" placeholder="Search conversations" aria-label="Search conversations" value="${esc(state.query)}">${isIntern()?'':'<button type="button" class="messenger-primary" data-msgr="new">New chat</button>'}</div>
   <div class="messenger-tabs" role="group" aria-label="Filter conversations">${filters.map(name=>`<button type="button" data-msgr="filter" data-id="${name}" aria-pressed="${state.filter===name}">${name}</button>`).join('')}</div>
   ${manage||cancel?`<div class="messenger-manage">${manage}${cancel}</div>`:''}<div class="messenger-scroll" id="messengerBody"></div>`;
 }
 function paintBody(){
  const body=document.querySelector('#messengerBody');if(!body)return;
  const top=body.scrollTop,focused=document.activeElement?.dataset.msgr==='open'?document.activeElement.dataset.id:null;
  if(state.tab==='groups'&&isAdmin()){
   body.innerHTML=state.groups.map(g=>`<article class="messenger-group"><div class="messenger-row-top"><b>${esc(g.title)}</b><button type="button" data-msgr="group-members" data-id="${esc(g.channel_id)}">Members (${g.members.length})</button></div><small>${g.members.map(m=>esc(m.full_name)).join(', ')}</small></article>`).join('')||'<p class="messenger-empty">No groups yet.</p>';return;
  }
  const html=visibleChannels().map(chatRow).join('')||`<p class="messenger-empty">${state.channels.length?'No conversations match this filter.':isIntern()?'No conversations yet. You can reply when a colleague writes to you.':'No conversations yet.'}</p>`;
  if(body.dataset.lastHtml===html)return;
  body.dataset.lastHtml=html;
  body.innerHTML=html;body.scrollTop=top;
  if(focused)Array.from(body.querySelectorAll('[data-msgr="open"]')).find(b=>b.dataset.id===focused)?.focus({preventScroll:true});
 }
 function threadView(){
  const c=state.thread?.channel;
  if(!c)return header('Opening conversation','',true)+'<p class="messenger-empty" role="status">Loading messages…</p>';
  const sub=c.kind==='Group'?`Group · ${state.thread.members?.length||0} members`:kindLabel(c);
  return `<div id="messengerThreadHead">${header(label(state.thread.listing||c),sub,true,callButtons(c)+muteButton(c.channel_id))}</div>
   ${sourceMessage?'<div class="messenger-actions"><button type="button" data-msgr="latest">Jump to latest messages</button></div>':''}
   <div class="messenger-thread-frame"><div class="messenger-messages" id="messengerMessages" tabindex="0" aria-label="Conversation messages"><div id="messengerTimeline"></div></div>
   <button type="button" id="messengerNewMessages" class="messenger-new-messages" data-msgr="bottom" hidden>↓ New messages</button></div>
   ${sourceMessage?'':state.thread.read_only?'<p class="messenger-note">This conversation is closed and read-only.</p>':`<form id="messengerSend" class="messenger-composer"><div id="messengerAttachments" class="messenger-attachments"></div><div id="messengerMention" class="messenger-mention-list" role="listbox" aria-label="Mention a colleague" hidden></div>
   <div class="messenger-compose-row"><button type="button" data-msgr="attach" class="messenger-attach" title="Attach files" aria-label="Attach files">📎</button><button type="button" data-msgr="record" class="messenger-attach" title="Record a voice note" aria-label="Record a voice note">🎙</button><input type="file" id="messengerFiles" aria-label="Choose attachments" multiple accept="${fileTypes}" hidden>
   <textarea name="body" rows="2" maxlength="4000" placeholder="Write a message" aria-label="Message or caption"></textarea><button type="submit" class="messenger-primary" aria-label="Send message">Send</button></div><p id="messengerState" class="messenger-error" role="alert"></p></form>`}`;
 }
 function fileCard(f){
  if(audioType(f.mime_type))return `<div class="messenger-voice"><button type="button" data-msgr="play" data-id="${esc(f.attachment_id)}">▶ Voice note · ${esc(sizeLabel(f.size_bytes))}</button></div>`;
  const thumbnail=imageType(f.mime_type)?`<img class="messenger-thumbnail" alt="" data-msgr-image="${esc(f.attachment_id)}" width="160" height="100">`:fileTile(f.file_name);
  return `<button type="button" class="messenger-file" data-msgr="download" data-id="${esc(f.attachment_id)}" data-name="${esc(f.file_name)}">${thumbnail}<span><b>${esc(f.file_name)}</b><small>${esc(sizeLabel(f.size_bytes))} · Download</small></span></button>`;
 }
 function loadThumbnails(timeline){
  imageObserver?.disconnect();
  const show=async img=>{
   const id=img.dataset.msgrImage;
   try{
    if(!images.has(id))images.set(id,request({action:'discussion_attachment_download',attachment_id:id},{blob:true}).then(blob=>imageType(blob.type)?URL.createObjectURL(blob):null));
    const src=await images.get(id);
    if(src&&img.isConnected)img.src=src;
   }catch{images.delete(id);}
  };
  const thumbnails=timeline.querySelectorAll('[data-msgr-image]');
  if(!globalThis.IntersectionObserver){for(const img of thumbnails)void show(img);return;}
  imageObserver=new IntersectionObserver(entries=>{
   for(const entry of entries)if(entry.isIntersecting){imageObserver.unobserve(entry.target);void show(entry.target);}
  },{root:document.querySelector('#messengerMessages'),rootMargin:'100px'});
  for(const img of thumbnails)imageObserver.observe(img);
 }
 // Replies quote the earlier message; reactions are small removable marks beside an immutable message.
 const snippet=m=>m.body?m.body:m.has_attachments||m.attachments?.length?'Attachment':'Message';
 function quoteHtml(m){
  if(!m.reply_to)return '';
  const who=m.reply_author_name||'Earlier message',text=m.reply_body||(m.reply_has_files?'Attachment':'');
  return `<button type="button" class="messenger-quote" data-msgr="jump" data-id="${esc(m.reply_to)}" aria-label="Go to the message from ${esc(who)}"><b>${esc(who)}</b><span>${esc(text)}</span></button>`;
 }
 function reactionChips(m){
  const list=Array.isArray(m.reactions)?m.reactions:[];
  if(!list.length)return '';
  return `<div class="messenger-reactions">${list.map(r=>`<button type="button" class="messenger-reaction${r.mine?' mine':''}" data-msgr="react" data-id="${esc(m.message_id)}" data-emoji="${esc(r.emoji)}" aria-pressed="${!!r.mine}" aria-label="${esc(r.emoji)} ${Number(r.count)}. ${esc((r.names||[]).join(', '))}${r.mine?'. Remove your reaction':'. Add your reaction'}" title="${esc((r.names||[]).join(', '))}">${esc(r.emoji)} ${Number(r.count)}</button>`).join('')}</div>`;
 }
 function messageTools(m){
  const followup=ctx.canFollowup?.()? `<button type="button" class="messenger-tool" data-msgr="followup" data-id="${esc(m.message_id)}">Create Follow-up</button>`:'';
  const reply=state.thread.read_only||sourceMessage?'':`<button type="button" class="messenger-tool" data-msgr="reply" data-id="${esc(m.message_id)}" aria-label="Reply to this message">Reply</button><span class="messenger-react-bar" role="group" aria-label="React to this message">${REACTIONS.map(e=>`<button type="button" class="messenger-tool" data-msgr="react" data-id="${esc(m.message_id)}" data-emoji="${esc(e)}" aria-label="React ${esc(e)}">${esc(e)}</button>`).join('')}</span>`;
  return reply||followup?`<div class="messenger-tools">${reply}${followup}</div>`:'';
 }
 function paintMessages({older=false}={}){
  const timeline=document.querySelector('#messengerTimeline');
  if(!timeline||!state.thread)return;
  const me=d().me.staff_id,positions=state.thread.read_positions,lastOwn=[...state.thread.messages].reverse().find(x=>x.author_id===me)?.message_id;
  let day='',html='';
  for(const m of state.thread.messages){
   const dl=dayLabel(m.created_at);if(dl!==day){day=dl;html+=`<div class="messenger-day"><span>${esc(dl)}</span></div>`;}
   const own=m.author_id===me,t=tickFor(m,me,positions);
   const shared=m.shared_kind?`<button type="button" class="messenger-file messenger-record" data-msgr="shared" data-id="${esc(m.message_id)}"><span><b>${esc(m.shared_title|| (m.shared_kind==='task'?'Shared task':'Shared ERP document'))}</b><small>${m.shared_kind==='task'?'Open ERP task':'Open ERP document'}</small></span></button>`:'';
   const existingDocument=m.document_id&&m.file_name?`<button type="button" class="messenger-file" data-msgr="erp-download" data-id="${esc(m.document_id)}" data-name="${esc(m.file_name)}">${esc(m.file_name)}</button>`:'';
   html+=`<article class="messenger-bubble ${own?'own':''}" data-message-id="${esc(m.message_id)}"><div class="messenger-meta"><b class="messenger-author">${own?'You':esc(m.author_name||'Staff')}</b><small>${esc(clock(m.created_at))}${t?` <span class="messenger-tick ${t.state}" role="img" aria-label="${esc(t.label)}" title="${esc(t.label)}">${t.glyph}</span>`:''}</small></div>${quoteHtml(m)}${m.body?`<p>${bodyHtml(m)}</p>`:''}${shared}${existingDocument}${(m.attachments||[]).map(fileCard).join('')}${reactionChips(m)}${messageTools(m)}${m.message_id===lastOwn&&t?`<small class="messenger-tick-label">${esc(t.label)}</small>`:''}</article>`;
  }
  html=(state.thread.has_older?'<button type="button" class="messenger-older" data-msgr="older">Load earlier messages</button>':'')+(html||'<p class="messenger-empty">No messages yet.</p>');
  if(timeline.dataset.lastHtml===html){if(threadDisplay.isAtBottom())markRead(Number(state.thread.messages.at(-1)?.sequence||0));return;}
  const focused=timeline.contains(document.activeElement)?{action:document.activeElement.dataset.msgr,id:document.activeElement.dataset.id}:null;
  timeline.dataset.lastHtml=html;
  threadDisplay.render(html,Number(state.thread.messages.at(-1)?.sequence||0),{older});
  loadThumbnails(timeline);
  if(focused)Array.from(timeline.querySelectorAll('[data-msgr]')).find(b=>b.dataset.msgr===focused.action&&b.dataset.id===focused.id)?.focus({preventScroll:true});
 }
 function paint(){
  const layout=document.querySelector('#messengerLayout');
  if(!layout||!state.open)return;
  threadDisplay?.close();threadDisplay=null;
  imageObserver?.disconnect();
  const isThread=state.view==='thread';
  layout.classList.toggle('messenger-show-detail',state.view!=='list');
  let html='';
  if(isThread)html=threadView();
  else if(state.view==='new')html=header('New chat','Choose a colleague',true)+`<div class="messenger-actions"><input type="search" id="messengerContactSearch" placeholder="Search staff" aria-label="Search staff"></div><div class="messenger-scroll" id="messengerContacts"></div>`;
  else if(state.view==='group-new'||state.view==='group-edit')html=groupForm();
  else if(state.view==='access')html=header('Access denied','403 Forbidden',true)+'<div class="messenger-placeholder" role="alert"><h3>You do not have permission to open this ERP record.</h3><p>Ask your Manager to check your project access.</p></div>';
  else html=`<div class="messenger-placeholder"><h3>${pendingShare?'Choose a conversation to share this ERP record':'Select a conversation'}</h3></div>`;
  const previousListTop=layout.querySelector('#messengerBody')?.scrollTop||0;
  layout.innerHTML=`<aside class="messenger-list" aria-label="Conversations">${listView()}</aside><section class="messenger-detail" aria-label="Conversation workspace">${html}</section>`;
  document.querySelector('#messengerSound').innerHTML=soundButton();
  paintBody();const list=layout.querySelector('#messengerBody');if(list)list.scrollTop=previousListTop;
  if(isThread&&state.thread){
   const box=layout.querySelector('#messengerMessages'),timeline=layout.querySelector('#messengerTimeline');
   threadDisplay=observeMessengerThread(box,timeline,layout.querySelector('#messengerNewMessages'),{onLatest:markRead});
   const form=currentComposer();if(form)form.elements.body.value=getDraft().text;
   paintComposer();paintMessages();
  }else if(state.view==='new')paintContacts('');
  else if(state.view==='group-new'||state.view==='group-edit')paintPick('');
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
   if(!userSub)userSub=client.channel('pcl-user:'+d().me.staff_id,{config:{private:true}}).on('broadcast',{event:'call'},()=>calls.poke()).on('broadcast',{event:'chat'},()=>{void refreshList();}).subscribe(st=>{userOk=st==='SUBSCRIBED';});
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
 function markRead(sequence){
  if(sourceMessage)return;
  const id=state.selected;
  if(!sequence||!id||!state.open||document.visibilityState!=='visible'||markedRead?.id===id&&markedRead.sequence>=sequence)return;
  const marker={id,sequence};markedRead=marker;
  void request({action:'discussion_read',channel_id:id,last_sequence:sequence}).then(refreshList).catch(()=>{if(markedRead===marker)markedRead=null;});
 }
 async function loadThread(id,{before=null,quiet=false,at=null}={}){
  const target=at||(!before?sourceMessage:null);
  if(threadRequest?.id===id)return threadRequest.promise;
  const token=++generation;
  const read=async()=>{
   try{
    const prior=state.thread?.channel?.channel_id===id?state.thread:null;
    const r=await request({action:'discussion_messages',channel_id:id,before_sequence:before||undefined,at_message_id:target||undefined});
    if(token!==generation||!d()||state.selected!==id)return;
    const listing=state.channels.find(c=>c.channel_id===id)||r.channel;
    let members=prior?.members;
    if(r.channel.kind==='Group'&&!members){try{members=(await request({action:'discussion_group_overview',channel_id:id})).groups?.[0]?.members||[];}catch{members=[];}}
    if(token!==generation||!d()||state.selected!==id)return;
    const messages=new Map((prior?.messages||[]).map(m=>[m.message_id,m]));
    for(const m of r.messages)messages.set(m.message_id,m);
    state.thread={channel:r.channel,listing,messages:[...messages.values()].sort((a,b)=>Number(a.sequence)-Number(b.sequence)),
     has_older:!prior||before?r.has_older:prior.has_older,read_only:r.read_only,members,read_positions:r.read_positions||null};
    if(!state.open||state.view!=='thread')return;
    if(!prior||prior.read_only!==r.read_only||!threadDisplay)paint();
    else paintMessages({older:!!before});
   }catch(e){
    if(token!==generation)return;
    if(e.status===403){
     state.thread=null;state.view='access';state.selected=null;paint();
     report('This conversation is no longer available.');
    }else if(!quiet)report(e.message);
   }
  };
  const work={id,promise:read()};threadRequest=work;
  try{await work.promise;}finally{if(threadRequest===work)threadRequest=null;}
 }
 async function openChannel(id,messageId=null){
  if(state.selected===id&&state.thread&&state.view==='thread'&&!pendingShare&&sourceMessage===messageId){focusComposer();return;}
  sourceMessage=messageId;
  threadRequest=null;
  state.view='thread';state.selected=id;state.thread=null;paint();calls.prepare();
  await loadThread(id,{at:messageId});
  if(!state.open||!state.thread||state.selected!==id)return;
  if(pendingShare){
   if(state.thread.read_only){report('Choose a conversation that is open for messages.');return;}
   const draft=getDraft();
   if(draft.sending){report('Wait for the current message to finish sending, then choose this conversation again.');return;}
   draft.shared=pendingShare;pendingShare=null;paintComposer();report('');
  }
  if(state.open&&state.selected===id){
   await live(id);
   if(!state.open||state.selected!==id||sourceMessage!==messageId)return;
   if(!messageId){focusComposer();return;}
   const message=[...document.querySelectorAll('#messengerTimeline [data-message-id]')].find(el=>el.dataset.messageId===messageId);
   if(!message){report('This message could not be found.');return;}
   message.tabIndex=-1;message.classList.add('messenger-flash');
   message.scrollIntoView({block:'nearest'});message.focus({preventScroll:true});
  }
 }
 async function createFromMessage(channelId,messageId,followupId,onSaved){
  const user=d()?.me.staff_id;
  await openFollowupForm({esc,request,channelId,messageId,followupId,onSaved,
   isCurrent:()=>!!user&&d()?.me.staff_id===user,openTask:id=>{toggle(false);openTask(id);}});
 }
 function focusComposer(){(currentComposer()?.elements.body||document.querySelector('#messengerMessages'))?.focus({preventScroll:true});}
 function paintComposer(){
  const form=currentComposer();if(!form)return;
  const draft=getDraft(),area=form.elements.body,sendButton=form.querySelector('[type="submit"]'),attach=form.querySelector('[data-msgr="attach"]');
  const box=document.querySelector('#messengerAttachments'),out=document.querySelector('#messengerState');
  const contents=draft.files.map(f=>`<div class="messenger-file-draft" data-attachment-id="${esc(f.id)}">
   ${f.preview?`<img src="${esc(f.preview)}" width="42" height="42" alt="">`:fileTile(f.file.name)}
   <div><b>${esc(f.file.name)}</b><small>${esc(sizeLabel(f.file.size))} · ${f.status==='failed'?'Upload failed':f.status==='ready'?'Ready to send':'Uploading'}</small>
   ${f.status==='uploading'?`<progress max="100" value="${f.progress}" aria-label="Upload progress for ${esc(f.file.name)}"></progress>`:''}
   ${f.error?`<small class="messenger-error-inline">${esc(f.error)}</small>`:''}</div>
   ${f.status==='failed'?button('retry',f.id,'Retry',draft.sending):''}${button('remove',f.id,'Remove',draft.sending)}</div>`).join('');
  const replyBar=draft.reply?`<div class="messenger-replying"><div><b>Replying to ${esc(draft.reply.author)}</b><small>${esc(draft.reply.text)}</small></div>${button('cancel-reply','','Cancel',draft.sending)}</div>`:'';
  const html=replyBar+(draft.shared?`<div class="messenger-file-draft"><div><b>${esc(draft.shared.title)}</b><small>${draft.shared.kind==='task'?'ERP task':'ERP document'}</small></div>${button('remove-share','','Remove',draft.sending)}</div>`:'')+contents;
  if(box.dataset.lastHtml!==html){box.dataset.lastHtml=html;box.innerHTML=html;}
  out.textContent=draft.error;
  area.readOnly=draft.sending;attach.disabled=draft.sending;
  const ready=draft.files.every(f=>f.status==='ready')&&!!(draft.text.trim()||draft.files.length||draft.shared);
  sendButton.disabled=draft.sending||!ready;
  sendButton.textContent=draft.sending?'Sending…':'Send';
 }
 const button=(action,id,label,disabled=false)=>`<button type="button" data-msgr="${action}" data-id="${esc(id)}"${disabled?' disabled':''}>${label}</button>`;
 async function uploadFile(id,draft,f){
  f.status='uploading';f.error='';f.progress=0;
  const controller=new AbortController();f.controller=controller;
  if(state.selected===id)paintComposer();
  try{
   await uploadMessenger(f,id,{signal:controller.signal,onProgress:progress=>{
    f.progress=progress;
    if(state.selected===id){const row=Array.from(document.querySelectorAll('[data-attachment-id]')).find(el=>el.dataset.attachmentId===f.id);const bar=row?.querySelector('progress');if(bar)bar.value=progress;}
   }});
   f.status='ready';
  }catch(e){f.status='failed';f.error=e.message;}
  finally{f.controller=null;if(state.selected===id)paintComposer();}
 }
 const bodyHtml=m=>{
  let html=esc(m.body);
  for(const x of m.mentions||[]){const tag='@'+esc(x.name);html=html.split(tag).join(`<mark class="messenger-mention">${tag}</mark>`);}
  return html;
 };
 const mentionIds=(draft,body)=>[...draft.mentions].filter(([,name])=>body.includes('@'+name)).map(([id])=>id);
 const people=new Map();
 async function mentionPeople(channel){
  if(!people.has(channel))people.set(channel,request({action:'discussion_mentionable',channel_id:channel}).then(r=>r.people||[]).catch(()=>{people.delete(channel);return [];}));
  return people.get(channel);
 }
 // The text right before the caret that looks like "@Gra": the part after @ is what the person has typed so far.
 const mentionQuery=area=>{
  const upto=area.value.slice(0,area.selectionStart??area.value.length),hit=/(^|\s)@([^\s@]{0,30}(?: [^\s@]{0,30})?)$/u.exec(upto);
  return hit?{query:hit[2],start:upto.length-hit[2].length-1}:null;
 };
 async function paintMention(){
  const form=currentComposer(),list=document.querySelector('#messengerMention');if(!form||!list)return;
  const q=mentionQuery(form.elements.body),channel=state.selected;
  if(!q||getDraft().sending){list.hidden=true;list.innerHTML='';return;}
  const all=await mentionPeople(channel);
  if(state.selected!==channel||!list.isConnected)return;
  const want=q.query.toLowerCase(),found=all.filter(x=>x.full_name.toLowerCase().includes(want)).slice(0,6);
  list.innerHTML=found.map(x=>`<button type="button" role="option" data-msgr="mention-pick" data-id="${esc(x.staff_id)}" data-name="${esc(x.full_name)}">${esc(x.full_name)}</button>`).join('');
  list.hidden=!found.length;
 }
 function pickMention(btn){
  const form=currentComposer();if(!form)return;
  const area=form.elements.body,q=mentionQuery(area),draft=getDraft();if(!q)return;
  const name=btn.dataset.name,before=area.value.slice(0,q.start),after=area.value.slice(area.selectionStart??area.value.length);
  area.value=before+'@'+name+' '+after;draft.text=area.value;draft.mentions.set(btn.dataset.id,name);
  const pos=(before+'@'+name+' ').length;area.setSelectionRange?.(pos,pos);area.focus();
  const list=document.querySelector('#messengerMention');if(list){list.hidden=true;list.innerHTML='';}
  paintComposer();
 }
 let recording=null;
 const stopTracks=r=>{for(const track of r.stream.getTracks())track.stop();};
 async function toggleRecording(btn){
  if(recording){recording.recorder.stop();return;}
  if(!state.selected||!currentComposer()||getDraft().sending)return;
  const id=state.selected,draft=getDraft();
  if(!globalThis.MediaRecorder||!navigator.mediaDevices?.getUserMedia){draft.error='Voice notes are not supported in this browser.';paintComposer();return;}
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}
  catch{draft.error='Allow microphone access in your browser to record a voice note.';paintComposer();return;}
  const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(m=>MediaRecorder.isTypeSupported?.(m))||'';
  const recorder=mime?new MediaRecorder(stream,{mimeType:mime}):new MediaRecorder(stream),chunks=[];
  const label=btn?.closest?.('form')?.querySelector('[data-msgr="record"]')||btn;
  const rec={recorder,stream,chunks,id,timer:null};recording=rec;
  recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
  recorder.onstop=()=>{
   clearTimeout(rec.timer);stopTracks(rec);if(recording===rec)recording=null;
   if(label?.isConnected){label.textContent='🎙';label.setAttribute('aria-label','Record a voice note');}
   const type=(recorder.mimeType||mime||'audio/webm').split(';')[0];
   const ext=type==='audio/ogg'?'ogg':type==='audio/mp4'?'m4a':'webm';
   const blob=new Blob(chunks,{type});
   if(rec.cancelled||state.selected!==id||!currentComposer())return;
   if(blob.size<5){getDraft().error='Nothing was recorded. Try again.';paintComposer();return;}
   addFiles([new File([blob],'voice-note-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.'+ext,{type})]);
  };
  recorder.start();
  rec.timer=setTimeout(()=>{if(recording===rec)recorder.stop();},voiceLimitMs);
  label.textContent='⏹';label.setAttribute('aria-label','Stop recording');
 }
 async function playVoice(btn){
  const id=btn.dataset.id;
  try{
   btn.disabled=true;
   const blob=await request({action:'discussion_attachment_download',attachment_id:id},{blob:true});
   const audio=document.createElement('audio');audio.controls=true;audio.src=URL.createObjectURL(blob);
   btn.replaceWith(audio);void audio.play?.()?.catch?.(()=>{});
  }catch{btn.disabled=false;btn.textContent='Could not load. Tap to retry';}
 }
 function addFiles(files){
  if(!state.selected||!currentComposer())return;
  const id=state.selected,draft=getDraft();if(draft.sending)return;
  draft.error='';
  for(const file of files){
   if(draft.files.length>=8){draft.error='Attach up to eight files per message.';break;}
   const extension=file.name.toLowerCase().split('.').pop();
   if(!(fileTypes.split(',').includes('.'+extension)||voiceTypes.includes(extension))||file.size<5||file.size>10*1024*1024){draft.error='Choose a supported document or photo up to 10 MB.';continue;}
   const f={id:crypto.randomUUID(),file,preview:imageType(file.type)?URL.createObjectURL(file):null,status:'uploading',progress:0,error:''};
   draft.files.push(f);void uploadFile(id,draft,f);
  }
  paintComposer();
 }
 async function removeFile(f,draft){
  if(draft.sending||!f)return;
  draft.files=draft.files.filter(x=>x!==f);
  if(f.preview)URL.revokeObjectURL(f.preview);
  f.controller?.abort();
  paintComposer();
  // The same server lock serialises discard against any upload still completing.
  try{await request({action:'discussion_attachment_discard',attachment_id:f.id});}
  catch(e){if(d())report(e.message);}
 }
 async function send(form){
  const id=state.selected,draft=getDraft(id);
  if(!id||draft.sending||draft.files.some(f=>f.status!=='ready'))return;
  const body=form.elements.body.value.trim();
  if(!body&&!draft.files.length&&!draft.shared)return;
  const payload={channel_id:id,body,reply_to:draft.reply?.id||null,attachment_ids:draft.files.map(f=>f.id),
   mention_ids:mentionIds(draft,body),
   shared_task_id:draft.shared?.kind==='task'?draft.shared.id:null,shared_document_id:draft.shared?.kind==='document'?draft.shared.id:null};
  const signature=JSON.stringify(payload);
  if(draft.request?.signature!==signature)draft.request={signature,id:crypto.randomUUID()};
  draft.sending=true;draft.error='';paintComposer();
  try{
   await request({action:'discussion_send',request_id:draft.request.id,...payload});
   for(const f of draft.files)if(f.preview)URL.revokeObjectURL(f.preview);
   drafts.delete(id);
   if(state.selected===id){
    if(currentComposer())currentComposer().elements.body.value='';
    if(threadRequest?.id===id)await threadRequest.promise;
    if(state.selected===id)await loadThread(id,{quiet:true});
    if(state.selected===id){threadDisplay?.toBottom();focusComposer();}
   }
   void refreshList();
  }catch(e){draft.error=e.message;}
  finally{draft.sending=false;if(state.selected===id)paintComposer();}
 }
 const saveBlob=(blob,name)=>{
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 async function openShared(messageId){
  const channel=state.selected;
  try{
   const record=await request({action:'discussion_shared_link',channel_id:channel,message_id:messageId});
   if(!state.open||state.selected!==channel)return;
   if(record.task_id){toggle(false);openTask(record.task_id);}
   else saveBlob(await request({action:'download',document_id:record.document_id},{blob:true}),record.file_name);
  }catch(e){
   if(!state.open||state.selected!==channel)return;
   if(e.status===403){state.view='access';paint();document.querySelector('.messenger-detail [data-msgr="back"]')?.focus();}
   else report(e.message);
  }
 }
 async function showList(tab){
  threadRequest=null;sourceMessage=null;report('');state.view='list';if(tab)state.tab=tab;state.selected=null;state.thread=null;generation++;
  if(subscription){void client?.removeChannel(subscription);subscription=null;}
  paint();
  if(isAdmin()&&state.tab==='groups'){try{state.groups=(await request({action:'discussion_group_overview'})).groups||[];}catch(e){notice(e.message,true);}paintBody();}
  else await refreshList();
 }
 async function click(b){
  const a=b.dataset.msgr,id=b.dataset.id;
  if(a==='close')return toggle(false);
  if(a==='back'){
   if(state.view==='access'&&state.thread){state.view='thread';paint();focusComposer();return;}
   const previous=state.selected;
   await showList();
   const row=Array.from(document.querySelectorAll('[data-msgr="open"]')).find(el=>el.dataset.id===previous);
   (row||document.querySelector('#messengerSearch')||document.querySelector('[data-msgr="group-new"]'))?.focus({preventScroll:true});
   return;
  }
  if(a==='filter'){
   state.filter=id;
   for(const tab of document.querySelectorAll('[data-msgr="filter"]'))tab.setAttribute('aria-pressed',String(tab.dataset.id===id));
   paintBody();return;
  }
  if(a==='bottom'){threadDisplay?.toBottom();document.querySelector('#messengerMessages')?.focus({preventScroll:true});return;}
  if(a==='latest')return openChannel(state.selected);
  if(a==='followup')return createFromMessage(state.selected,id);
  if(a==='mention-pick'){pickMention(b);return;}
  if(a==='attach'){document.querySelector('#messengerFiles')?.click();return;}
  if(a==='record'){void toggleRecording(b);return;}
  if(a==='play'){void playVoice(b);return;}
  if(a==='retry'||a==='remove'){
   const draft=getDraft(),f=draft.files.find(x=>x.id===id);
   if(f&&a==='retry'&&!draft.sending)return uploadFile(state.selected,draft,f);
   if(a==='remove')return removeFile(f,draft);
   return;
  }
  if(a==='remove-share'){getDraft().shared=null;paintComposer();return;}
  if(a==='cancel-reply'){getDraft().reply=null;paintComposer();focusComposer();return;}
  if(a==='reply'){
   const m=state.thread?.messages.find(x=>x.message_id===id);if(!m)return;
   getDraft().reply={id:m.message_id,author:m.author_id===d().me.staff_id?'yourself':(m.author_name||'Staff'),text:snippet(m).slice(0,140)};
   paintComposer();focusComposer();return;
  }
  if(a==='jump'){
   const target=Array.from(document.querySelectorAll('#messengerTimeline [data-message-id]')).find(x=>x.dataset.messageId===id);
   if(!target){report('That message is further back. Load earlier messages to see it.');return;}
   target.scrollIntoView?.({block:'center'});target.classList.add('messenger-flash');setTimeout(()=>target.classList.remove('messenger-flash'),1600);return;
  }
  if(a==='react'){
   const chat=state.selected,emoji=b.dataset.emoji,m=state.thread?.messages.find(x=>x.message_id===id);
   if(!chat||!m||!emoji)return;
   const mine=!!(m.reactions||[]).find(r=>r.emoji===emoji&&r.mine);
   try{await request({action:'discussion_react',channel_id:chat,message_id:id,emoji,on:!mine});if(state.selected===chat)await loadThread(chat,{quiet:true});}
   catch(e){report(e.message);}
   return;
  }
  if(a==='cancel-share'){pendingShare=null;report('');paint();document.querySelector('#messengerSearch')?.focus();return;}
  if(a==='shared')return openShared(id);
  if(a==='download'||a==='erp-download'){
   const payload=a==='download'?{action:'discussion_attachment_download',attachment_id:id}:{action:'download',document_id:id};
   return saveBlob(await request(payload,{blob:true}),b.dataset.name);
  }
  if(a==='sound'){prefs.sound=!prefs.sound;savePrefs(prefs);if(prefs.sound){beeper.unlock();beeper.play(Date.now(),true);}document.querySelector('#messengerSound').innerHTML=soundButton();document.querySelector('[data-msgr="sound"]')?.focus();return;}
  if(a==='mute-chat'){if(prefs.muted[id])delete prefs.muted[id];else prefs.muted[id]=true;savePrefs(prefs);paintBody();const head=document.querySelector('#messengerThreadHead');
   if(head){head.innerHTML=header(label(state.thread.listing),kindLabel(state.thread.channel),true,callButtons(state.thread.channel)+muteButton(id));head.querySelector('[data-msgr="mute-chat"]')?.focus();}return;}
  if(a==='call-audio'||a==='call-video'){const c=state.thread?.channel;if(c)return calls.start(c.channel_id,a==='call-video'?'video':'audio',label(state.thread.listing||c));return;}
  if(a==='tab')return showList(id);
  if(a==='open')return openChannel(id);
  if(a==='older'){
   const channel=state.selected;
   if(threadRequest?.id===channel)await threadRequest.promise;
   const first=state.thread?.messages?.[0];
   if(first&&state.selected===channel)await loadThread(channel,{before:Number(first.sequence)});
   return;
  }
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
  const dialog=panel();if(!dialog||state.open===open)return;
  state.open=open;
  if(open){
   opener=document.activeElement;
   if(!dialog.open)dialog.showModal();
   calls.place();if(!document.querySelector('#messengerLayout').children.length)paint();
   if(state.view==='thread'&&state.selected){void loadThread(state.selected,{quiet:true});focusComposer();}
   else{void refreshList();document.querySelector('#messengerSearch')?.focus();}
  }else{
   dialog.close();calls.place();dragDepth=0;
   dialog.classList.remove('messenger-dragging');
   // Keep the rendered thread and drafts in memory. Nothing under the overlay is re-rendered.
   if(opener?.isConnected)opener.focus({preventScroll:true});
   opener=null;
  }
  paintBadge();
 }
 function shareRecord(kind,id){
  const record=kind==='task'?d().tasks.find(t=>t.task_id===id):d().documents.find(f=>f.document_id===id);
  if(!record)return;
  pendingShare={kind,id,title:kind==='task'?record.task_name:record.file_name};
  if(!state.open)toggle(true);
  void showList('chats');
  report(`Choose a conversation to share ${pendingShare.title}.`);
  document.querySelector('#messengerSearch')?.focus();
 }
 document.addEventListener('click',async e=>{
  if(!d())return;
  if(e.target.closest('#messengerButton')){toggle();return;}
  const b=e.target.closest('[data-msgr]');
  if(b){try{await click(b);}catch(err){report(err.message);}return;}
  if(e.target.closest('[data-messenger-open]')){toggle(true);return;}
  const task=e.target.closest('[data-messenger-share-task]'),doc=e.target.closest('[data-messenger-share-document]');
  if(task)shareRecord('task',task.dataset.messengerShareTask);
  if(doc)shareRecord('document',doc.dataset.messengerShareDocument);
 });
 function dropZone(e){return e.target.closest?.('.messenger-detail')&&!!currentComposer();}
 document.addEventListener('dragenter',e=>{
  if(!dropZone(e)||!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;
  e.preventDefault();dragDepth++;panel()?.classList.add('messenger-dragging');
 });
 document.addEventListener('dragover',e=>{
  if(!e.target.closest?.('#messengerPanel')||!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;
  e.preventDefault();e.dataTransfer.dropEffect=dropZone(e)?'copy':'none';
 });
 document.addEventListener('dragleave',e=>{
  if(dropZone(e)&&--dragDepth<=0){dragDepth=0;panel()?.classList.remove('messenger-dragging');}
 });
 document.addEventListener('drop',e=>{
  if(!e.target.closest?.('#messengerPanel')||!e.dataTransfer?.files.length)return;
  e.preventDefault();dragDepth=0;panel()?.classList.remove('messenger-dragging');
  if(dropZone(e))addFiles(e.dataTransfer.files);
 });
 document.addEventListener('input',e=>{
  if(e.target.id==='messengerSearch'){state.query=e.target.value;paintBody();}
  if(e.target.id==='messengerContactSearch')paintContacts(e.target.value);
  if(e.target.id==='messengerPickSearch')paintPick(e.target.value);
  if(e.target.matches?.('#messengerPick input[type=checkbox]')){if(e.target.checked)picked.add(e.target.value);else picked.delete(e.target.value);}
  if(e.target.matches?.('#messengerSend textarea')){getDraft().text=e.target.value;paintComposer();void paintMention();}
 });
 document.addEventListener('change',e=>{if(e.target.id==='messengerFiles'){addFiles(e.target.files);e.target.value='';}if(e.target.matches?.('#messengerPick input[type=checkbox]')){if(e.target.checked)picked.add(e.target.value);else picked.delete(e.target.value);}});
 document.addEventListener('submit',e=>{
  if(e.target.id==='messengerSend'){e.preventDefault();void send(e.target);}
  if(e.target.id==='messengerGroup'){e.preventDefault();void submitGroup(e.target);}
 });
 document.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.target.matches?.('#messengerSend textarea')){e.preventDefault();e.target.form.requestSubmit();}
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
  threadDisplay?.close();threadDisplay=null;threadRequest=null;markedRead=null;sourceMessage=null;
  document.querySelector('.followup-dialog')?.close();
  imageObserver?.disconnect();imageObserver=null;
  for(const image of images.values())void image.then(src=>{if(src)URL.revokeObjectURL(src);},()=>{});
  images.clear();
  if(recording){recording.cancelled=true;recording.recorder.state!=='inactive'&&recording.recorder.stop();}
  for(const draft of drafts.values())for(const f of draft.files){f.controller?.abort();if(f.preview)URL.revokeObjectURL(f.preview);}
  drafts.clear();pendingShare=null;opener=null;panel()?.remove();mounted=false;
  Object.assign(state,{open:false,view:'list',tab:'chats',channels:[],selected:null,thread:null,groups:[],directory:[],contacts:[],query:'',filter:'All'});picked=new Set();editing=null;
  const host=document.querySelector('#messenger');if(host){host.replaceChildren();delete host.dataset.ready;}
 }
 return {start,stop,open:()=>toggle(true),unread:unreadTotal,isMounted:()=>mounted,createFromMessage,
  openMessage:(channel,message)=>{toggle(true);return openChannel(channel,message);}};
}
