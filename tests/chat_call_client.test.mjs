import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clockText,mediaProblem,endMessage,gatherComplete,callsSupported,loadLouder,saveLouder,LOUD_GAIN} from '../staff-chat-call.mjs';
import {createBeeper} from '../staff-messenger-alerts.mjs';
const env={};globalThis.Deno={env:{get:k=>env[k]}};
const {callAction,iceConfig}=await import('../supabase/functions/staff-workspace-v12/call-actions.ts');

test('call timer text and plain-language media problems',()=>{
 assert.equal(clockText(0),'0:00');assert.equal(clockText(65.9),'1:05');assert.equal(clockText(3600),'60:00');assert.equal(clockText(-4),'0:00');assert.equal(clockText('x'),'0:00');
 assert.match(mediaProblem({name:'NotAllowedError'}),/blocked the microphone/);
 assert.match(mediaProblem({name:'NotAllowedError'},true),/camera or microphone/);
 assert.match(mediaProblem({name:'NotFoundError'},true),/No camera or microphone/);
 assert.match(mediaProblem({name:'NotReadableError'}),/another program/);
 assert.match(mediaProblem(new Error('x')),/could not be started/);
});

test('the line shown when a call ends',()=>{
 assert.equal(endMessage({status:'Declined',role:'caller',other:'Wanjiru'}),'Wanjiru declined the call.');
 assert.equal(endMessage({status:'Declined',role:'callee',other:'Wanjiru'}),'Call declined.');
 assert.equal(endMessage({status:'Missed',role:'caller',other:'Wanjiru'}),'Wanjiru did not answer.');
 assert.equal(endMessage({status:'Missed',role:'callee',other:'Wanjiru'}),'Missed call from Wanjiru.');
 assert.equal(endMessage({status:'Ended',role:'caller',seconds:125}),'Call ended · 2:05');
 assert.equal(endMessage({status:'Ended',role:'caller',seconds:0}),'Call ended.');
 assert.match(endMessage({status:'Failed',role:'caller',relay:true}),/internet connection/);
 assert.match(endMessage({status:'Failed',role:'caller',relay:false}),/no relay service/);
});

test('waiting for connection routes never waits longer than the limit',async()=>{
 const listeners=new Map(),pc={iceGatheringState:'gathering',addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
 const t0=Date.now();await gatherComplete(pc,30);assert.ok(Date.now()-t0<400);
 const pc2={...pc,iceGatheringState:'gathering'};const done=gatherComplete(pc2,5000);pc2.iceGatheringState='complete';listeners.get('icegatheringstatechange')();await done;
 assert.equal(await gatherComplete({iceGatheringState:'complete'},5000),undefined);
});

test('calls are offered only where the browser can do them',()=>{
 assert.equal(callsSupported({}),false);
 assert.equal(callsSupported({RTCPeerConnection:function(){},navigator:{mediaDevices:{getUserMedia(){}}}}),true);
 assert.equal(callsSupported({RTCPeerConnection:function(){},navigator:{}}),false);
});

test('connection servers: public server only without a relay account, short-lived relay credentials with one, safe fallback on any failure',async()=>{
 assert.deepEqual(await iceConfig(async()=>{throw new Error('must not be called');}),{ice_servers:[{urls:['stun:stun.cloudflare.com:3478']}],relay:false});
 env.PCL_TURN_KEY_ID='key-1';env.PCL_TURN_API_TOKEN='fictional-token';
 let seen=null;
 const ok=await iceConfig(async(url,init)=>{seen={url,init};return {ok:true,json:async()=>({iceServers:[{urls:['stun:stun.cloudflare.com:3478','stun:stun.cloudflare.com:53']},{urls:['turn:turn.cloudflare.com:3478?transport=udp','turn:turn.cloudflare.com:53?transport=udp','turns:turn.cloudflare.com:443?transport=tcp'],username:'u',credential:'c'}]})};});
 assert.match(seen.url,/rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/key-1\/credentials\/generate-ice-servers$/);assert.equal(seen.init.headers.Authorization,'Bearer fictional-token');assert.equal(JSON.parse(seen.init.body).ttl,7200);
 assert.equal(ok.relay,true);assert.deepEqual(ok.ice_servers[1].urls,['turn:turn.cloudflare.com:3478?transport=udp','turns:turn.cloudflare.com:443?transport=tcp'],'port 53 routes are dropped because browsers block them');
 assert.equal(JSON.stringify(ok).includes('fictional-token'),false,'the account token is never sent to browsers');
 for(const bad of [async()=>({ok:false,status:403}),async()=>{throw new Error('timeout');},async()=>({ok:true,json:async()=>({iceServers:[{urls:['stun:x:3478']}]})})]){
  const r=await iceConfig(bad);assert.equal(r.relay,false);assert.equal(r.relay_error,true);assert.match(r.ice_servers[0].urls[0],/^stun:/);
 }
});

test('Agora requires a production rollout flag and valid credentials',async t=>{
 const previousDeno=globalThis.Deno;
 const settings={SUPABASE_URL:'https://tafrrmcxrsorffkonrxq.supabase.co',AGORA_APP_ID:'a'.repeat(32),AGORA_APP_CERTIFICATE:'b'.repeat(32)};
 globalThis.Deno={env:{get:key=>settings[key]}};
 t.after(()=>{globalThis.Deno=previousDeno;});
 const enabled=async()=>(await callAction(null,null,{action:'discussion_call_config'})).agora;

 assert.equal(await enabled(),false);
 settings.PCL_AGORA_RTC_ENABLED='true';
 assert.equal(await enabled(),true);
 settings.AGORA_APP_CERTIFICATE='invalid';
 assert.equal(await enabled(),false);
 settings.AGORA_APP_CERTIFICATE='b'.repeat(32);
 settings.SUPABASE_URL='https://other.supabase.co';
 assert.equal(await enabled(),false);
 settings.SUPABASE_URL='https://yfjiculexbzpkvtapudk.supabase.co';
 delete settings.PCL_AGORA_RTC_ENABLED;
 assert.equal(await enabled(),true);
 settings.PCL_AGORA_RTC_ENABLED='false';
 assert.equal(await enabled(),false);
});

test('the chat shows call buttons in one-to-one chats only and makes the call controls available over the messenger and the ERP',()=>{
 const m=fs.readFileSync(new URL('../staff-messenger.mjs',import.meta.url),'utf8');
 assert.match(m,/c\.kind!=='Direct'\|\|state\.thread\?\.read_only\|\|!callsSupported/);
 assert.match(m,/data-msgr="call-audio"/);assert.match(m,/data-msgr="call-video"/);
 assert.match(m,/host:\(\)=>panel\(\)\?\.open\?panel\(\):document\.body/,'calls use the active top-layer dialog when it is open');
 assert.match(m,/dialog\.close\(\);calls\.place\(\)/,'closing Messenger leaves the call active over the ERP');
 assert.match(m,/pcl-user:/);assert.match(m,/\\w-\]\+\\\.\[\\w-\]\+\\\.\[\\w-\]\+\$/,'no live connection for a token that is not a signed token');
 const css=fs.readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');assert.match(css,/\.call-overlay\{/);
 const headers=fs.readFileSync(new URL('../_headers',import.meta.url),'utf8');assert.match(headers,/microphone=\(self\)/);assert.match(headers,/camera=\(self\)/);assert.match(headers,/geolocation=\(\)/);
});

test('route finding goes as soon as the route that matters is found, not after the slowest one',async()=>{
 const make=()=>{const l=new Map(),pc={iceGatheringState:'gathering',addEventListener:(n,f)=>l.set(n,f),removeEventListener:n=>l.delete(n)};return {pc,fire:(n,e)=>l.get(n)?.(e),listeners:l};};
 const cand=t=>({candidate:{candidate:`candidate:1 1 udp 2122260223 192.0.2.2 5000 typ ${t} generation 0`}});
 // A relay is wanted: a local route alone does not end the wait; the relay route does, after a short grace.
 const a=make();let doneA=false;const pa=gatherComplete(a.pc,5000,globalThis,{want:'relay',grace:20}).then(()=>{doneA=true;});
 a.fire('icecandidate',cand('host'));a.fire('icecandidate',cand('srflx'));await new Promise(r=>setTimeout(r,60));assert.equal(doneA,false,'still waiting for the relay route');
 const t0=Date.now();a.fire('icecandidate',cand('relay'));await pa;assert.ok(Date.now()-t0<300,'goes shortly after the relay route');assert.equal(a.listeners.size,0,'listeners are removed');
 // No relay: the internet-facing address is the one that matters.
 const b=make();const pb=gatherComplete(b.pc,5000,globalThis,{want:'srflx',grace:10});b.fire('icecandidate',cand('srflx'));const t1=Date.now();await pb;assert.ok(Date.now()-t1<300);
 // Nothing arrives: the time limit applies.
 const c=make();const t2=Date.now();await gatherComplete(c.pc,40,globalThis,{want:'relay'});assert.ok(Date.now()-t2<400);
});

test('the call ring is loud for the person called, only a soft buzz for the caller, and silent until the browser allows sound',()=>{
 const made=[];
 class Ctx{constructor(){this.state='suspended';this.currentTime=0;this.destination={};}
  resume(){this.state='running';}
  createGain(){const g={gain:{value:1,setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};made.push(['gain',g]);return g;}
  createOscillator(){const o={type:'',frequency:{value:0},connect(){},start(){},stop(){}};made.push(['osc',o]);return o;}
  createDynamicsCompressor(){const c={threshold:{value:0},ratio:{value:0},connect(){}};made.push(['comp',c]);return c;}}
 const beeper=createBeeper({AudioContext:Ctx});
 assert.equal(beeper.ring(1),false,'silent before the first click or key press');
 beeper.unlock();assert.equal(beeper.ring(1,'ring'),true);
 const all=n=>made.filter(([k])=>k===n).map(([,v])=>v),level=()=>all('gain')[0].gain.value;
 assert.equal(all('osc').length,9,'three bursts of three tones');assert.ok(all('osc').every(o=>o.type==='square'),'a square wave carries furthest');assert.equal(all('comp')[0].threshold.value,-8,'a limiter is used');assert.equal(level(),0.9);
 made.length=0;beeper.ring(0.5,'buzz');assert.equal(all('osc').length,2,'a soft double buzz');assert.ok(all('osc').every(o=>o.type==='triangle'&&o.frequency.value===220),'low and gentle');assert.equal(level(),0.25);
 made.length=0;beeper.ring(9);assert.equal(level(),0.9,'never louder than full');
 assert.equal(typeof beeper.play,'function');
});

test('the louder button is remembered per browser and survives blocked storage',()=>{
 const m=new Map(),store={getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v)};
 assert.equal(loadLouder(store),false);saveLouder(true,store);assert.equal(loadLouder(store),true);saveLouder(false,store);assert.equal(loadLouder(store),false);
 assert.equal(loadLouder({getItem(){throw new Error('blocked');}}),false);saveLouder(true,{setItem(){throw new Error('blocked');}});
 assert.equal(LOUD_GAIN,2);
});

test('Agora media publishes native tracks, rejects third-party tracks and renews only while the call is open',async()=>{
 const {createAgoraMedia}=await import('../staff-agora-call.mjs');
 class FakeStream{
  tracks=[];
  getTracks(){return this.tracks;}
  addTrack(track){this.tracks.push(track);}
  removeTrack(track){this.tracks=this.tracks.filter(item=>item!==track);}
 }
 const calls=[],listeners=new Map();
 const client={
  on:(event,fn)=>listeners.set(event,fn),removeAllListeners:()=>listeners.clear(),
  join:async(...args)=>calls.push(['join',...args]),
  publish:async tracks=>calls.push(['publish',tracks.length]),
  subscribe:async(user,kind)=>calls.push(['subscribe',user.uid,kind]),
  renewToken:async token=>calls.push(['renew',token]),
  leave:async()=>calls.push(['leave']),
 };
 const sdk={createClient:()=>client,createCustomAudioTrack:()=>({close:()=>calls.push(['close'])})};
 const grant={app_id:'test-app',channel:'call',token:'first',uid:1};
 const audio={kind:'audio'};
 let release;
 const media=createAgoraMedia({
  sdk,grant,renew:()=>new Promise(resolve=>{release=resolve;}),
  stream:{getAudioTracks:()=>[audio],getVideoTracks:()=>[]},win:{MediaStream:FakeStream},
  onRemote:stream=>calls.push(['remote',stream.getTracks().length]),
  onState:state=>calls.push(['state',state]),onError:assert.fail,
 });
 await media.connect();
 const publish= listeners.get('user-published');
 await publish({uid:9},'audio');
 await publish({uid:2,audioTrack:{getMediaStreamTrack:()=>audio}},'audio');
 listeners.get('token-privilege-will-expire')();
 release({...grant,token:'second'});
 await new Promise(resolve=>setImmediate(resolve));
 listeners.get('token-privilege-will-expire')();
 media.close();
 release({...grant,token:'after-close'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[['join','test-app','call','first',1],['publish',1],['subscribe',2,'audio'],['remote',1],['state','connected'],['renew','second'],['close'],['leave']]);
 assert.equal(listeners.size,0);
});
