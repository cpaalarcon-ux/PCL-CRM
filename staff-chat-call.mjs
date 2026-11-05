// One-to-one voice and video calls inside the staff chat, built on WebRTC.
// Sound and picture travel straight between the two browsers; the server only sets the call up (who is calling whom, ringing,
// answered, ended) and passes each browser the other's connection details. Nothing is recorded.
// The screen is built here and not in the messenger so a call survives the chat panel being closed or repainted.
const LOUD_KEY='pcl-call-louder-v1';
const STUN=[{urls:['stun:stun.cloudflare.com:3478']}];
const END_STATES=['Declined','Missed','Ended','Failed'];
const RING_MS=45000,CONNECT_MS=25000,WEAK_MS=8000,GATHER_MS=3000,GATHER_PLAIN_MS=1500,GRACE_MS=200,POLL_RING_MS=1000,POLL_ACTIVE_MS=3000,CONFIG_MS=600000,TONE_MS=2500,SHOW_END_MS=3500;

export const callsSupported=(win=globalThis)=>!!(win.RTCPeerConnection&&win.navigator?.mediaDevices?.getUserMedia);

export const loadLouder=(storage=globalThis.localStorage)=>{try{return storage?.getItem(LOUD_KEY)==='1';}catch{return false;}};
export const saveLouder=(on,storage=globalThis.localStorage)=>{try{storage?.setItem(LOUD_KEY,on?'1':'0');}catch{ /* The choice then lasts until the page closes. */ }};
export const LOUD_GAIN=2;

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
// Waiting for every last route is slow, so once the route that matters has appeared ("relay" when a relay is set up, otherwise
// "srflx", the address the internet sees) it waits only a short grace period for the rest and goes.
export function gatherComplete(pc,ms=GATHER_MS,win=globalThis,{want=null,grace=GRACE_MS}={}){
 return new Promise(resolve=>{
  if(pc.iceGatheringState==='complete')return resolve();
  let done=false,cap=null,soon=null;
  const finish=()=>{if(done)return;done=true;win.clearTimeout(cap);win.clearTimeout(soon);pc.removeEventListener('icegatheringstatechange',check);pc.removeEventListener('icecandidate',found);resolve();};
  const check=()=>{if(pc.iceGatheringState==='complete')finish();};
  const found=e=>{if(want&&!soon&&new RegExp(' typ '+want+'( |$)').test(e?.candidate?.candidate||''))soon=win.setTimeout(finish,grace);};
  pc.addEventListener('icegatheringstatechange',check);pc.addEventListener('icecandidate',found);cap=win.setTimeout(finish,ms);
 });
}

export function createCalls({request,notice,beeper=null,onChange=()=>{},win=globalThis,doc=globalThis.document}){
 let cur=null,checking=false,endedTimer=null,overlay=null,gone=false,lastMarks=null;
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
   loud=`<button type="button" class="call-btn" data-call="loud" aria-pressed="${!!call.loud}" title="Boost the other person's voice">🔊 Louder</button>`,
   cam=call.local?.getVideoTracks?.().length?`<button type="button" class="call-btn" data-call="camera" aria-pressed="${!!call.camOff}">${call.camOff?'📷 Camera off':'📹 Camera on'}</button>`:'';
  if(call.status==='incoming')return BTN.accept+BTN.decline;
  if(call.status==='active'||call.status==='weak')return mute+loud+cam+BTN.end;
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
  const html=buttons(call),key=call.status+(call.muted?'m':'')+(call.camOff?'c':'')+(call.loud?'l':''),box=$('#callButtons');if(box&&box.dataset.state!==key){box.innerHTML=html;box.dataset.state=key;}
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

 // Connection servers are asked for once and kept for ten minutes (the relay passes last two hours), so a call does not wait for them.
 let cfg=null,cfgAt=0;
 async function loadConfig(){
  if(cfg&&Date.now()-cfgAt<CONFIG_MS)return cfg;
  try{const c=await request({action:'discussion_call_config'});if(Array.isArray(c?.ice_servers)&&c.ice_servers.length){cfg={ice_servers:c.ice_servers,relay:!!c.relay};cfgAt=Date.now();return cfg;}}catch{ /* Fall back to the public server. */ }
  return {ice_servers:STUN,relay:false};
 }
 const prepare=()=>{if(callsSupported(win))void loadConfig();};
 const gather=(pc,call)=>gatherComplete(pc,call.relay?GATHER_MS:GATHER_PLAIN_MS,win,{want:call.relay?'relay':'srflx'});
 // Voice settings: echo removal, noise reduction and automatic level on, one clean channel, and a hint that this is speech.
 const tuned=stream=>{try{stream.getAudioTracks().forEach(t=>{t.contentHint='speech';});stream.getVideoTracks().forEach(t=>{t.contentHint='motion';});}catch{ /* A hint only. */ }return stream;};
 async function getMedia(video,{fallback=false}={}){
  const md=win.navigator.mediaDevices,audio={echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1};
  if(!video)return tuned(await md.getUserMedia({audio,video:false}));
  try{return tuned(await md.getUserMedia({audio,video:{width:{ideal:960},height:{ideal:540},frameRate:{ideal:30}}}));}
  catch(e){
   if(!fallback)throw e;
   const s=await md.getUserMedia({audio,video:false});notice('Your camera could not be started, so you joined with voice only.',true);return tuned(s);
  }
 }
 function makePc(call,config){
  const pc=new win.RTCPeerConnection({iceServers:config.ice_servers,iceCandidatePoolSize:2});call.pc=pc;call.relay=config.relay;
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
   if(!call.since){call.since=Date.now();call.marks.up=call.since;lastMarks=call.marks;watch(call,POLL_ACTIVE_MS);call.clock=win.setInterval(()=>{if(cur===call)setText('#callTimer',clockText((Date.now()-call.since)/1000));},1000);setText('#callTimer','0:00');capBitrate(call);if(loadLouder())setLoud(call,true);}
   call.status='active';paint();
  }else if(s==='disconnected'){
   if(call.status==='active'){call.status='weak';paint();}
   if(!call.weakTimer)call.weakTimer=win.setTimeout(()=>{if(cur===call&&call.pc?.connectionState!=='connected')void hangup(call,'failed');},WEAK_MS);
  }else if(s==='failed')void hangup(call,'failed');
 }
 // Keep the picture modest so a call works on ordinary office and mobile internet.
 function capBitrate(call){
  // Voice gets a generous, high-priority share (clear speech); the picture is capped so a call still works on ordinary connections and adapts down on weak ones.
  try{for(const sender of call.pc.getSenders()){
   const kind=sender.track?.kind;if(kind!=='video'&&kind!=='audio')continue;
   const p=sender.getParameters();p.encodings=p.encodings?.length?p.encodings:[{}];
   p.encodings[0].maxBitrate=kind==='audio'?64000:1200000;if(kind==='audio'){p.encodings[0].priority='high';p.encodings[0].networkPriority='high';}
   void sender.setParameters(p).catch(()=>{});
  }}catch{ /* Best effort. */ }
 }

 function stopMedia(call){
  for(const k of ['pollTimer','ringTimer','connectTimer','weakTimer','toneTimer'])if(call[k]){win.clearTimeout(call[k]);win.clearInterval(call[k]);call[k]=null;}
  if(call.clock){win.clearInterval(call.clock);call.clock=null;}
  try{call.local?.getTracks().forEach(t=>t.stop());}catch{ /* Already stopped. */ }
  try{void call.audio?.ctx.close?.();call.audio=null;}catch{ /* Already closed. */ }
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
 const watch=(call,ms=POLL_RING_MS)=>{win.clearInterval(call.pollTimer);call.pollTimer=win.setInterval(()=>void poll(call),ms);};
 function tone(call){
  if(!beeper)return;const ring=()=>{if(cur===call&&call.status==='incoming'){if(!beeper.ring?.(1))beeper.play?.(Date.now(),true);}};
  ring();call.toneTimer=win.setInterval(ring,TONE_MS);
 }
 // The caller hears a soft ring-back while the other phone rings, so it is clear something is happening.
 function ringback(call){
  if(!beeper?.ring)return;const ring=()=>{if(cur===call&&call.status==='ringing')beeper.ring(0.3);};
  ring();call.toneTimer=win.setInterval(ring,TONE_MS);
 }
 // Boost the other person's voice: through a gain stage and a limiter, so quiet speakers get louder without crackling.
 // The picture element stays attached (muted) because some browsers only deliver remote sound to this path that way.
 function setLoud(call,on){
  call.loud=!!on;saveLouder(call.loud);
  try{
   const el=$('#callRemote');
   if(call.loud&&call.remote?.getAudioTracks().length&&!call.audio){
    const Ctx=win.AudioContext||win.webkitAudioContext,ctx=new Ctx(),src=ctx.createMediaStreamSource(call.remote),gain=ctx.createGain(),comp=ctx.createDynamicsCompressor(),analyser=ctx.createAnalyser();
    gain.gain.value=LOUD_GAIN;src.connect(gain);gain.connect(comp);comp.connect(ctx.destination);comp.connect(analyser);void ctx.resume?.();call.audio={ctx,analyser};
   }
   if(el)el.muted=call.loud&&!!call.audio;
   if(!call.loud&&call.audio){void call.audio.ctx.close?.();call.audio=null;}
  }catch{call.loud=false;call.audio=null;const el=$('#callRemote');if(el)el.muted=false;notice('Your browser could not boost the volume.',true);}
  paint();
 }

 async function start(channelId,media,other){
  if(cur)return notice('You are already on a call.',true);
  if(!callsSupported(win))return notice('Calls are not supported by this browser. Use a current version of Chrome, Edge, Firefox or Safari.',true);
  gone=false;build();win.clearTimeout(endedTimer);
  const call=cur={role:'caller',media,other,status:'starting',marks:{t0:Date.now()}};paint();$('#callButtons button')?.focus?.();
  try{
   // The microphone (and camera) and the connection servers are asked for at the same time.
   const configP=loadConfig();call.local=await getMedia(media==='video').catch(e=>{void configP;throw e;});if(cur!==call){stopMedia(call);return;}
   const config=await configP;if(cur!==call){stopMedia(call);return;}
   const pc=makePc(call,config);attachLocal(call);
   call.local.getTracks().forEach(t=>pc.addTrack(t,call.local));
   await pc.setLocalDescription(await pc.createOffer());await gather(pc,call);
   if(cur!==call){stopMedia(call);return;}
   call.marks.ready=Date.now();
   const r=await request({action:'discussion_call_start',channel_id:channelId,offer_sdp:pc.localDescription.sdp,media});
   call.marks.sent=Date.now();call.id=r.call_id;
   if(cur!==call||call.ending){await request({action:'discussion_call_end',call_id:call.id,outcome:'hangup'}).catch(()=>{});return;}
   call.status='ringing';paint();watch(call);ringback(call);
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
   paint();watch(call);tone(call);$('#callButtons button')?.focus?.();warm(call);
  }catch{ /* The next check retries. */ }
  finally{checking=false;}
 }

 // While the phone rings, the answering side already gets its connection ready (servers, offer read, routes found), so Answer is quick.
 function warm(call){
  call.warming=(async()=>{
   const config=await loadConfig();if(cur!==call||call.pc)return;
   makePc(call,config);await call.pc.setRemoteDescription({type:'offer',sdp:call.offer});
  })().catch(()=>{try{call.pc?.close();}catch{ /* Replaced on Answer. */ }call.pc=null;});
 }
 async function accept(call){
  win.clearInterval(call.toneTimer);call.toneTimer=null;call.status='connecting';paint();
  try{
   call.marks={t0:Date.now()};
   call.local=await getMedia(call.media==='video',{fallback:true});if(cur!==call){stopMedia(call);return;}
   await call.warming;if(cur!==call){stopMedia(call);return;}
   if(!call.pc?.remoteDescription){try{call.pc?.close();}catch{ /* Replaced below. */ }call.pc=null;const config=await loadConfig();if(cur!==call){stopMedia(call);return;}makePc(call,config);await call.pc.setRemoteDescription({type:'offer',sdp:call.offer});}
   const pc=call.pc;attachLocal(call);
   call.local.getTracks().forEach(t=>pc.addTrack(t,call.local));
   await pc.setLocalDescription(await pc.createAnswer());await gather(pc,call);
   if(cur!==call)return;
   call.marks.ready=Date.now();
   await request({action:'discussion_call_answer',call_id:call.id,answer_sdp:pc.localDescription.sdp});
   call.marks.sent=Date.now();call.answered=true;paint();
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
  if(a==='loud'){setLoud(call,!call.loud);return;}
  if(a==='camera'){call.camOff=!call.camOff;call.local?.getVideoTracks().forEach(t=>{t.enabled=!call.camOff;});paint();return;}
 }
 // Something changed on the server for me: look again straight away.
 function poke(){if(cur)void poll(cur);else void check();}
 function stop(){
  win.clearTimeout(endedTimer);gone=true;
  if(cur){const c=cur;void hangup(c,'hangup');}
  overlay?.remove();overlay=null;
 }
 // levels(): how much sound is reaching the speaker through the boost path (used by the tests; 0 when the boost is off).
 return {prepare,timing:()=>({...(lastMarks||{})}),levels:()=>{const a=cur?.audio?.analyser;if(!a)return 0;const d=new Uint8Array(a.fftSize);a.getByteTimeDomainData(d);return d.reduce((m,v)=>Math.max(m,Math.abs(v-128)),0);},start,check,poke,stop,busy:()=>!!cur,ringing:()=>cur?.status==='incoming',supported:()=>callsSupported(win)};
}
