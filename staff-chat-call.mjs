// One-to-one voice and video calls inside the staff chat, built on WebRTC.
// Sound and picture travel straight between the two browsers; the server only sets the call up (who is calling whom, ringing,
// answered, ended) and passes each browser the other's connection details. Nothing is recorded.
// The screen is built here and not in the messenger so a call survives the chat panel being closed or repainted.
const STUN=[{urls:['stun:stun.cloudflare.com:3478']}];
const END_STATES=['Declined','Missed','Ended','Failed'];
const RING_MS=45000,CONNECT_MS=25000,WEAK_MS=8000,GATHER_MS=3500,POLL_MS=2000,TONE_MS=2500,SHOW_END_MS=3500;

export const callsSupported=(win=globalThis)=>!!(win.RTCPeerConnection&&win.navigator?.mediaDevices?.getUserMedia);

export const clockText=sec=>{const s=Math.max(0,Math.floor(Number(sec)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};

// Plain-language reason for a microphone or camera problem.
export function mediaProblem(err,video=false){
 const what=video?'camera or microphone':'microphone';
 switch(err?.name){
  case 'NotAllowedError':case 'SecurityError':case 'PermissionDeniedError':return `Your browser blocked the ${what}. Allow it for this site (the padlock beside the address), then try again.`;
  case 'NotFoundError':case 'DevicesNotFoundError':case 'OverconstrainedError':return `No ${video?'camera or ':''}microphone was found on this device.`;
  case 'NotReadableError':case 'AbortError':case 'TrackStartError':return `Your ${what} is being used by another program. Close it and try again.`;
  default:return `The ${what} could not be started.`;
 }
}

// The line shown when a call ends. `relay` says whether a relay service is set up, which changes the advice when a call cannot connect.
export function endMessage({status,role,other='your colleague',seconds=0,relay=true}){
 switch(status){
  case 'Declined':return role==='caller'?`${other} declined the call.`:'Call declined.';
  case 'Missed':return role==='caller'?`${other} did not answer.`:`Missed call from ${other}.`;
  case 'Ended':return seconds>0?`Call ended · ${clockText(seconds)}`:'Call ended.';
  case 'Failed':return relay?'The call could not connect. Check your internet connection and try again.':'The call could not connect. Some networks block direct calls and no relay service is set up yet. Ask your System Administrator.';
  default:return 'Call ended.';
 }
}

// Wait until the browser has found its connection routes (so one complete description can be sent), but never longer than `ms`.
export function gatherComplete(pc,ms=GATHER_MS,win=globalThis){
 return new Promise(resolve=>{
  if(pc.iceGatheringState==='complete')return resolve();
  let done=false,timer=null;
  const finish=()=>{if(done)return;done=true;win.clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',check);resolve();};
  const check=()=>{if(pc.iceGatheringState==='complete')finish();};
  pc.addEventListener('icegatheringstatechange',check);timer=win.setTimeout(finish,ms);
 });
}

export function createCalls({request,notice,beeper=null,onChange=()=>{},win=globalThis,doc=globalThis.document}){
 let cur=null,checking=false,endedTimer=null,overlay=null,gone=false;
 const $=sel=>overlay?.querySelector(sel);
 const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]?.toUpperCase()||'').join('')||'?';

 function build(){
  if(overlay&&doc.body.contains(overlay))return;
  overlay=doc.createElement('section');overlay.id='callOverlay';overlay.className='call-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','Call');overlay.hidden=true;
  overlay.innerHTML='<div class="call-stage"><video id="callRemote" class="call-remote" autoplay playsinline></video><div class="call-avatar" id="callAvatar" aria-hidden="true"></div><video id="callLocal" class="call-local" autoplay playsinline muted></video></div><div class="call-info"><b id="callName"></b><span id="callStatus" role="status" aria-live="polite"></span><small id="callTimer" aria-hidden="true"></small><small id="callHint"></small></div><div class="call-buttons" id="callButtons"></div>';
  doc.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{const b=e.target.closest('[data-call]');if(b)void action(b.dataset.call);});
 }
 const setText=(sel,t)=>{const el=$(sel);if(el)el.textContent=t;};
 const BTN={
  accept:'<button type="button" class="call-btn accept" data-call="accept"><span aria-hidden="true">✓</span> Answer</button>',
  decline:'<button type="button" class="call-btn danger" data-call="decline"><span aria-hidden="true">✕</span> Decline</button>',
  end:'<button type="button" class="call-btn danger" data-call="end"><span aria-hidden="true">✕</span> End call</button>',
  close:'<button type="button" class="call-btn" data-call="close">Close</button>'
 };
 function buttons(call){
  const mute=`<button type="button" class="call-btn" data-call="mute" aria-pressed="${!!call.muted}">${call.muted?'🔇 Unmute':'🎤 Mute'}</button>`,
   cam=call.local?.getVideoTracks?.().length?`<button type="button" class="call-btn" data-call="camera" aria-pressed="${!!call.camOff}">${call.camOff?'📷 Camera off':'📹 Camera on'}</button>`:'';
  if(call.status==='incoming')return BTN.accept+BTN.decline;
  if(call.status==='active'||call.status==='weak')return mute+cam+BTN.end;
  return BTN.end;
 }
 function paint(){
  if(!cur||!overlay)return;
  const call=cur,video=call.media==='video';
  overlay.hidden=false;overlay.classList.toggle('video',video);
  setText('#callName',call.other||'Colleague');setText('#callAvatar',initials(call.other));
  const label=video?'video call':'voice call';
  setText('#callStatus',{starting:video?'Starting camera…':'Starting…',ringing:'Ringing…',incoming:`Incoming ${label}`,connecting:'Connecting…',weak:'Connection weak. Reconnecting…',active:'In call'}[call.status]||'');
  setText('#callHint',call.status==='incoming'?'Your colleague is calling you from the chat.':call.status==='ringing'&&call.relay===false?'No relay service is set up, so this call may not connect on some networks.':'');
  const box=$('#callButtons'),html=buttons(call);if(box&&box.dataset.state!==call.status+(call.muted?'m':'')+(call.camOff?'c':'')){box.innerHTML=html;box.dataset.state=call.status+(call.muted?'m':'')+(call.camOff?'c':'');}
  overlay.classList.toggle('has-local-video',!!call.local?.getVideoTracks?.().length&&!call.camOff);
  overlay.classList.toggle('has-remote-video',!!call.remote?.getVideoTracks?.().length);
  onChange();
 }
 function showEnded(message){
  if(gone)return;build();overlay.hidden=false;overlay.classList.remove('has-local-video','has-remote-video');
  setText('#callStatus',message);setText('#callTimer','');setText('#callHint','');
  const box=$('#callButtons');if(box){box.innerHTML=BTN.close;box.dataset.state='ended';}
  win.clearTimeout(endedTimer);endedTimer=win.setTimeout(hideEnded,SHOW_END_MS);
 }
 function hideEnded(){win.clearTimeout(endedTimer);endedTimer=null;if(!cur&&overlay){overlay.hidden=true;const r=$('#callRemote'),l=$('#callLocal');if(r)r.srcObject=null;if(l)l.srcObject=null;}onChange();}

 async function loadConfig(){
  try{const c=await request({action:'discussion_call_config'});if(Array.isArray(c?.ice_servers)&&c.ice_servers.length)return {ice_servers:c.ice_servers,relay:!!c.relay};}catch{ /* Fall back to the public server. */ }
  return {ice_servers:STUN,relay:false};
 }
 async function getMedia(video,{fallback=false}={}){
  const md=win.navigator.mediaDevices,audio={echoCancellation:true,noiseSuppression:true,autoGainControl:true};
  if(!video)return md.getUserMedia({audio,video:false});
  try{return await md.getUserMedia({audio,video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:24}}});}
  catch(e){
   if(!fallback)throw e;
   const s=await md.getUserMedia({audio,video:false});notice('Your camera could not be started, so you joined with voice only.',true);return s;
  }
 }
 function makePc(call,config){
  const pc=new win.RTCPeerConnection({iceServers:config.ice_servers});call.pc=pc;call.relay=config.relay;
  pc.ontrack=e=>{
   call.remote??=new win.MediaStream();if(!call.remote.getTracks().includes(e.track))call.remote.addTrack(e.track);
   const el=$('#callRemote');if(el){if(el.srcObject!==call.remote)el.srcObject=call.remote;void el.play?.()?.catch?.(()=>{});}
   paint();
  };
  pc.onconnectionstatechange=()=>connection(call);
  return pc;
 }
 function attachLocal(call){const el=$('#callLocal');if(el&&call.local&&call.media==='video')el.srcObject=call.local;}
 function connection(call){
  if(cur!==call||!call.pc)return;
  const s=call.pc.connectionState;
  if(s==='connected'){
   win.clearTimeout(call.weakTimer);win.clearTimeout(call.connectTimer);call.weakTimer=null;
   if(!call.since){call.since=Date.now();call.clock=win.setInterval(()=>{if(cur===call)setText('#callTimer',clockText((Date.now()-call.since)/1000));},1000);setText('#callTimer','0:00');capBitrate(call);}
   call.status='active';paint();
  }else if(s==='disconnected'){
   if(call.status==='active'){call.status='weak';paint();}
   if(!call.weakTimer)call.weakTimer=win.setTimeout(()=>{if(cur===call&&call.pc?.connectionState!=='connected')void hangup(call,'failed');},WEAK_MS);
  }else if(s==='failed')void hangup(call,'failed');
 }
 // Keep the picture modest so a call works on ordinary office and mobile internet.
 function capBitrate(call){
  try{for(const sender of call.pc.getSenders()){if(sender.track?.kind!=='video')continue;const p=sender.getParameters();p.encodings=p.encodings?.length?p.encodings:[{}];p.encodings[0].maxBitrate=700000;void sender.setParameters(p).catch(()=>{});}}catch{ /* Best effort. */ }
 }

 function stopMedia(call){
  for(const k of ['pollTimer','ringTimer','connectTimer','weakTimer','toneTimer'])if(call[k]){win.clearTimeout(call[k]);win.clearInterval(call[k]);call[k]=null;}
  if(call.clock){win.clearInterval(call.clock);call.clock=null;}
  try{call.local?.getTracks().forEach(t=>t.stop());}catch{ /* Already stopped. */ }
  try{if(call.pc){call.pc.ontrack=null;call.pc.onconnectionstatechange=null;call.pc.close();}}catch{ /* Already closed. */ }
 }
 function finish(call,status){
  if(call.finished)return;call.finished=true;stopMedia(call);
  const seconds=call.since?(Date.now()-call.since)/1000:0;
  if(cur===call)cur=null;
  showEnded(endMessage({status,role:call.role,other:call.other,seconds,relay:call.relay!==false}));onChange();
 }
 // outcome: hangup (either person), decline (the person called), failed (could not connect).
 async function hangup(call,outcome){
  if(call.ending)return;call.ending=true;stopMedia(call);
  if(!call.id){call.finished=true;if(cur===call)cur=null;showEnded('Call cancelled.');onChange();return;}
  let status=null;
  try{status=(await request({action:'discussion_call_end',call_id:call.id,outcome})).status;}catch{ /* The server also closes calls nobody finishes. */ }
  finish(call,status||(outcome==='failed'?'Failed':outcome==='decline'?'Declined':call.since?'Ended':call.role==='caller'?'Missed':'Declined'));
 }

 async function apply(call,v){
  if(!v||cur!==call)return;
  if(END_STATES.includes(v.status)){stopMedia(call);return finish(call,v.status);}
  if(call.role==='caller'&&v.status==='Answered'&&v.answer_sdp&&!call.answered){
   call.answered=true;call.status='connecting';win.clearTimeout(call.ringTimer);paint();
   call.connectTimer=win.setTimeout(()=>{if(cur===call&&call.pc?.connectionState!=='connected')void hangup(call,'failed');},CONNECT_MS);
   await call.pc.setRemoteDescription({type:'answer',sdp:v.answer_sdp});
  }
 }
 async function poll(call){
  if(cur!==call||!call.id||call.polling||call.ending)return;call.polling=true;
  try{const r=await request({action:'discussion_call_get',call_id:call.id});await apply(call,r?.call);}catch{ /* The next poll retries. */ }
  finally{call.polling=false;}
 }
 const watch=call=>{call.pollTimer=win.setInterval(()=>void poll(call),POLL_MS);};
 function tone(call){
  if(!beeper)return;const ring=()=>{if(cur===call&&call.status==='incoming')beeper.play(Date.now(),true);};
  ring();call.toneTimer=win.setInterval(ring,TONE_MS);
 }

 async function start(channelId,media,other){
  if(cur)return notice('You are already on a call.',true);
  if(!callsSupported(win))return notice('Calls are not supported by this browser. Use a current version of Chrome, Edge, Firefox or Safari.',true);
  gone=false;build();win.clearTimeout(endedTimer);
  const call=cur={role:'caller',media,other,status:'starting'};paint();$('#callButtons button')?.focus?.();
  try{
   call.local=await getMedia(media==='video');if(cur!==call){stopMedia(call);return;}
   const config=await loadConfig();if(cur!==call){stopMedia(call);return;}
   const pc=makePc(call,config);attachLocal(call);
   call.local.getTracks().forEach(t=>pc.addTrack(t,call.local));
   await pc.setLocalDescription(await pc.createOffer());await gatherComplete(pc,GATHER_MS,win);
   if(cur!==call){stopMedia(call);return;}
   const r=await request({action:'discussion_call_start',channel_id:channelId,offer_sdp:pc.localDescription.sdp,media});
   call.id=r.call_id;
   if(cur!==call||call.ending){await request({action:'discussion_call_end',call_id:call.id,outcome:'hangup'}).catch(()=>{});return;}
   call.status='ringing';paint();watch(call);
   call.ringTimer=win.setTimeout(()=>{if(cur===call&&call.status==='ringing')void hangup(call,'hangup');},RING_MS);
  }catch(e){
   if(cur!==call)return;
   stopMedia(call);cur=null;call.finished=true;
   showEnded(call.local===undefined?mediaProblem(e,media==='video'):(e?.message||'The call could not be started.'));onChange();
  }
 }

 // Look for a call ringing for me.
 async function check(){
  if(cur||checking)return;checking=true;gone=false;
  try{
   const r=await request({action:'discussion_call_pending'});if(cur)return;
   const v=r?.call;if(!v||!v.offer_sdp)return;
   if(!callsSupported(win)){await request({action:'discussion_call_end',call_id:v.call_id,outcome:'decline'}).catch(()=>{});notice('A colleague tried to call you, but this browser does not support calls.',true);return;}
   build();win.clearTimeout(endedTimer);
   const call=cur={role:'callee',id:v.call_id,media:v.media,other:v.other_name,offer:v.offer_sdp,status:'incoming'};
   paint();watch(call);tone(call);$('#callButtons button')?.focus?.();
  }catch{ /* The next check retries. */ }
  finally{checking=false;}
 }

 async function accept(call){
  win.clearInterval(call.toneTimer);call.toneTimer=null;call.status='connecting';paint();
  try{
   call.local=await getMedia(call.media==='video',{fallback:true});if(cur!==call){stopMedia(call);return;}
   const config=await loadConfig();if(cur!==call){stopMedia(call);return;}
   const pc=makePc(call,config);attachLocal(call);
   await pc.setRemoteDescription({type:'offer',sdp:call.offer});
   call.local.getTracks().forEach(t=>pc.addTrack(t,call.local));
   await pc.setLocalDescription(await pc.createAnswer());await gatherComplete(pc,GATHER_MS,win);
   if(cur!==call)return;
   await request({action:'discussion_call_answer',call_id:call.id,answer_sdp:pc.localDescription.sdp});
   call.answered=true;paint();
   call.connectTimer=win.setTimeout(()=>{if(cur===call&&call.pc?.connectionState!=='connected')void hangup(call,'failed');},CONNECT_MS);
  }catch(e){
   if(cur!==call)return;
   const stale=/no longer ringing/i.test(e?.message||'');
   if(stale){stopMedia(call);call.finished=true;cur=null;showEnded('This call is no longer ringing.');onChange();return;}
   if(call.local===undefined){notice(mediaProblem(e,call.media==='video'),true);}
   await hangup(call,'failed');
  }
 }
 async function action(a){
  if(a==='close'){hideEnded();return;}
  const call=cur;if(!call)return;
  if(a==='accept')return accept(call);
  if(a==='decline')return hangup(call,'decline');
  if(a==='end')return hangup(call,'hangup');
  if(a==='mute'){call.muted=!call.muted;call.local?.getAudioTracks().forEach(t=>{t.enabled=!call.muted;});paint();return;}
  if(a==='camera'){call.camOff=!call.camOff;call.local?.getVideoTracks().forEach(t=>{t.enabled=!call.camOff;});paint();return;}
 }
 // Something changed on the server for me: look again straight away.
 function poke(){if(cur)void poll(cur);else void check();}
 function stop(){
  win.clearTimeout(endedTimer);gone=true;
  if(cur){const c=cur;void hangup(c,'hangup');}
  overlay?.remove();overlay=null;
 }
 return {start,check,poke,stop,busy:()=>!!cur,ringing:()=>cur?.status==='incoming',supported:()=>callsSupported(win)};
}
