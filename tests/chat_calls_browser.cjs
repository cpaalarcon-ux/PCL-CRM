// Two real browser pages place real WebRTC calls to each other with a fake microphone and camera. The server side is replaced by a small
// in-memory copy of the call rules, so this proves the screen, the connection set-up and the hang-up paths; it cannot judge sound quality.
const fs=require('fs'),http=require('http'),path=require('path'),dgram=require('dgram'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.PCL_BROWSER_MODULES||process.cwd()]}));
const root=path.resolve(__dirname,'..');
const PAGE=`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/staff-pilot.css"></head><body><main><p>Call test page</p></main><script type="module">
import {createCalls} from '/staff-chat-call.mjs';
window.__notices=[];
window.calls=createCalls({request:p=>window.rpc(p),notice:(m,e)=>window.__notices.push(m),beeper:{play(){window.__rings=(window.__rings||0)+1;return true;},ring(v){(window.__ringVolumes??=[]).push(v);return true;}}});
window.ready=true;</script></body></html>`;
const server=http.createServer((req,res)=>{
 const url=decodeURIComponent(req.url.split('?')[0]);
 if(url==='/__calls.html'){res.writeHead(200,{'content-type':'text/html'});return res.end(PAGE);}
 const f=path.join(root,url);if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'content-type':f.endsWith('.mjs')||f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html'});res.end(fs.readFileSync(f));
});

// A tiny STUN server on this machine, so the browsers find a "server reflexive" route like they do on the internet and the fast
// route-finding path is exercised for real.
let stunPort=0;const stun=dgram.createSocket('udp4');
stun.on('message',(msg,rinfo)=>{
 if(msg.length<20||msg.readUInt16BE(0)!==0x0001)return;
 const out=Buffer.alloc(32);out.writeUInt16BE(0x0101,0);out.writeUInt16BE(12,2);msg.copy(out,4,4,20);
 out.writeUInt16BE(0x0020,20);out.writeUInt16BE(8,22);out.writeUInt8(0,24);out.writeUInt8(1,25);out.writeUInt16BE(rinfo.port^0x2112,26);
 const ip=rinfo.address.split('.').map(Number);for(let i=0;i<4;i++)out.writeUInt8(ip[i]^[0x21,0x12,0xa4,0x42][i],28+i);
 stun.send(out,rinfo.port,rinfo.address);
});

// In-memory copy of the server's call rules.
const names={A:'Alice Njoroge',B:'Brian Otieno'},other=w=>w==='A'?'B':'A',calls=new Map(),log=[];let seq=0;
function view(who,c){return {call_id:c.id,channel_id:'ch',media:c.media,status:c.status,role:c.caller===who?'caller':'callee',other_name:names[other(who)],offer_sdp:c.callee===who?c.offer:null,answer_sdp:c.caller===who?c.answer:null};}
function rpc(who,p){
 log.push({who,action:p.action,outcome:p.outcome});
 if(p.action==='discussion_call_config')return {ice_servers:[{urls:['stun:127.0.0.1:'+stunPort]}],relay:false};
 if(p.action==='discussion_call_start'){
  if((p.media==='video')!==p.offer_sdp.includes('m=video'))throw new Error('The call type does not match the call set-up data.');
  const c={id:'call-'+(++seq),caller:who,callee:other(who),media:p.media,status:'Ringing',offer:p.offer_sdp,answer:null};calls.set(c.id,c);return {call_id:c.id};
 }
 if(p.action==='discussion_call_pending'){const c=[...calls.values()].find(x=>x.callee===who&&x.status==='Ringing');return {call:c?view(who,c):null};}
 if(p.action==='discussion_call_get'){const c=calls.get(p.call_id);if(!c||![c.caller,c.callee].includes(who))throw new Error('This call is not available to your account.');return {call:view(who,c)};}
 if(p.action==='discussion_call_answer'){const c=calls.get(p.call_id);if(!c||c.callee!==who||c.status!=='Ringing')throw new Error('This call is no longer ringing.');c.status='Answered';c.answer=p.answer_sdp;return {ok:true};}
 if(p.action==='discussion_call_end'){
  const c=calls.get(p.call_id);if(!c)throw new Error('This call is not available to your account.');
  if(['Ringing','Answered'].includes(c.status))c.status=p.outcome==='failed'?'Failed':c.status==='Answered'?'Ended':who===c.callee?'Declined':'Missed';
  return {status:c.status};
 }
 throw new Error('Unknown call action.');
}

(async()=>{
 await new Promise(r=>stun.bind(0,'127.0.0.1',r));stunPort=stun.address().port;
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({...(process.env.PCL_BROWSER_EXECUTABLE?{executablePath:process.env.PCL_BROWSER_EXECUTABLE}:{}),headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--disable-features=WebRtcHideLocalIpsWithMdns','--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 async function open(who){
  const ctx=await browser.newContext({permissions:['microphone','camera'],viewport:{width:900,height:700}}),page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(who+': '+e.message));
  await page.addInitScript(()=>{const Orig=window.RTCPeerConnection;window.__pcs=[];window.RTCPeerConnection=function(...a){const pc=new Orig(...a);window.__pcs.push(pc);return pc;};window.RTCPeerConnection.prototype=Orig.prototype;});
  await page.exposeFunction('rpc',p=>{try{return rpc(who,p);}catch(e){throw new Error(e.message);}});
  await page.goto(base+'/__calls.html');await page.waitForFunction(()=>window.ready===true);return page;
 }
 const status=p=>p.evaluate(()=>document.querySelector('#callStatus')?.textContent||''),
  visible=p=>p.evaluate(()=>{const o=document.querySelector('#callOverlay');return !!o&&!o.hidden&&getComputedStyle(o).display!=='none';}),
  until=(p,fn,arg,ms=25000)=>p.waitForFunction(fn,arg,{timeout:ms}),
  inbound=(p,kind)=>p.evaluate(async k=>{let bytes=0,frames=0;for(const pc of window.__pcs){(await pc.getStats()).forEach(r=>{if(r.type==='inbound-rtp'&&r.kind===k){bytes+=r.bytesReceived;frames+=r.framesDecoded||0;}});}return {bytes,frames};},kind);
 const A=await open('A'),B=await open('B');

 // 1. Voice call: ring, answer, sound flows both ways, mute, hang up.
 await A.evaluate(()=>window.calls.start('ch','audio','Brian Otieno'));
 await until(A,()=>document.querySelector('#callStatus')?.textContent==='Ringing…');
 assert.equal(await A.evaluate(()=>document.querySelector('#callName').textContent),'Brian Otieno');
 await B.evaluate(()=>window.calls.poke());
 await until(B,()=>document.querySelector('#callStatus')?.textContent==='Incoming voice call');
 assert.ok(await visible(B),'incoming call box is shown');assert.equal(await B.evaluate(()=>window.calls.ringing()),true);
 assert.deepEqual(await B.$$eval('#callButtons button',bs=>bs.map(b=>b.textContent.trim())),['✓ Answer','✕ Decline']);
 await B.waitForTimeout(300);assert.deepEqual(await B.evaluate(()=>window.__ringVolumes.slice(0,1)),[1],'the called person hears the full ring');assert.ok((await A.evaluate(()=>window.__ringVolumes||[])).every(v=>v<1)&&(await A.evaluate(()=>window.__ringVolumes.length))>=1,'the caller hears only a soft ring-back');
 await B.click('[data-call=accept]');
 await until(A,()=>document.querySelector('#callStatus')?.textContent==='In call');await until(B,()=>document.querySelector('#callStatus')?.textContent==='In call');
 {const a=await A.evaluate(()=>window.calls.timing()),b=await B.evaluate(()=>window.calls.timing());
  console.log('timing (ms): caller ready',a.ready-a.t0,'· answerer ready',b.ready-b.t0,'· connect after answer sent',b.up-b.sent,'· answerer click to connected',b.up-b.t0);
  assert.ok(a.ready-a.t0<1500,'the caller is ready to ring within 1.5 s');assert.ok(b.ready-b.t0<1500,'the answerer is ready within 1.5 s of clicking Answer');assert.ok(b.up-b.t0<3500,'connected within 3.5 s of clicking Answer');}
 for(const [n,p] of [['A',A],['B',B]]){await until(p,async()=>{let b=0;for(const pc of window.__pcs)(await pc.getStats()).forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='audio')b+=r.bytesReceived;});return b>0;});assert.equal(await p.evaluate(()=>document.querySelector('#callRemote').srcObject.getAudioTracks().length),1,n+' hears the other side');}
 assert.equal(await A.evaluate(()=>document.querySelector('#callLocal').srcObject),null,'no camera preview in a voice call');
 await until(A,()=>window.__pcs[0].getSenders().find(s=>s.track?.kind==='audio').getParameters().encodings[0].maxBitrate===64000);
 assert.equal(await A.evaluate(()=>window.__pcs[0].getSenders().find(s=>s.track.kind==='audio').track.contentHint),'speech','voice processing hint is set');
 // The louder button: off at first, remote sound muted at the picture element and routed through the boost path, with real signal.
 assert.equal(await B.evaluate(()=>document.querySelector('#callRemote').muted),false);assert.equal(await B.evaluate(()=>window.calls.levels()),0);
 await B.click('[data-call=loud]');assert.equal(await B.getAttribute('[data-call=loud]','aria-pressed'),'true');
 assert.equal(await B.evaluate(()=>document.querySelector('#callRemote').muted),true,'sound now comes through the boost path');
 await until(B,()=>window.calls.levels()>0,null,15000);
 assert.equal(await B.evaluate(()=>localStorage.getItem('pcl-call-louder-v1')),'1','the choice is remembered');
 await B.click('[data-call=loud]');assert.equal(await B.evaluate(()=>document.querySelector('#callRemote').muted),false);assert.equal(await B.getAttribute('[data-call=loud]','aria-pressed'),'false');
 await B.click('[data-call=loud]');
 assert.deepEqual(await A.$$eval('#callButtons button',bs=>bs.map(b=>b.textContent.trim())),['🎤 Mute','🔊 Louder','✕ End call']);
 await A.click('[data-call=mute]');
 assert.equal(await A.evaluate(()=>window.__pcs[0].getSenders().find(s=>s.track.kind==='audio').track.enabled),false,'mute switches the microphone off');
 assert.equal(await A.getAttribute('[data-call=mute]','aria-pressed'),'true');
 await A.click('[data-call=mute]');assert.equal(await A.evaluate(()=>window.__pcs[0].getSenders().find(s=>s.track.kind==='audio').track.enabled),true);
 await A.waitForTimeout(1200);
 await A.click('[data-call=end]');
 await until(A,()=>/^Call ended/.test(document.querySelector('#callStatus')?.textContent));await until(B,()=>/^Call ended/.test(document.querySelector('#callStatus')?.textContent),null,10000);
 assert.equal([...calls.values()].at(-1).status,'Ended');
 assert.equal(await A.evaluate(()=>window.__pcs.every(pc=>pc.connectionState==='closed')),true,'the connection is closed');
 assert.equal(await A.evaluate(()=>window.calls.busy()),false);
 await A.click('[data-call=close]');assert.equal(await visible(A),false);

 // 2. Video call: picture flows both ways, camera off, hang up from the other side.
 await B.evaluate(()=>window.calls.start('ch','video','Alice Njoroge'));
 await A.evaluate(()=>window.calls.poke());
 await until(A,()=>document.querySelector('#callStatus')?.textContent==='Incoming video call');
 await A.click('[data-call=accept]');
 await until(A,()=>document.querySelector('#callStatus')?.textContent==='In call');await until(B,()=>document.querySelector('#callStatus')?.textContent==='In call');
 for(const [n,p] of [['A',A],['B',B]]){
  await until(p,async()=>{let f=0;for(const pc of window.__pcs.slice(-1))(await pc.getStats()).forEach(r=>{if(r.type==='inbound-rtp'&&r.kind==='video')f+=r.framesDecoded||0;});return f>0;});
  const cls=await p.evaluate(()=>document.querySelector('#callOverlay').className);assert.match(cls,/has-remote-video/,n+' sees the other side');assert.match(cls,/has-local-video/,n+' sees their own preview');
 }
 assert.deepEqual(await B.$$eval('#callButtons button',bs=>bs.map(b=>b.textContent.trim())),['🎤 Mute','🔊 Louder','📹 Camera on','✕ End call']);
 await B.click('[data-call=camera]');
 assert.equal(await B.evaluate(()=>window.__pcs.at(-1).getSenders().find(s=>s.track.kind==='video').track.enabled),false);assert.doesNotMatch(await B.evaluate(()=>document.querySelector('#callOverlay').className),/has-local-video/);
 await B.click('[data-call=camera]');
 await A.click('[data-call=end]');
 await until(B,()=>/^Call ended/.test(document.querySelector('#callStatus')?.textContent),null,10000);
 await A.click('[data-call=close]');await B.click('[data-call=close]');

 // 3. Declined, and cancelled before it was answered.
 await A.evaluate(()=>window.calls.start('ch','video','Brian Otieno'));await B.evaluate(()=>window.calls.poke());
 await until(B,()=>document.querySelector('#callStatus')?.textContent==='Incoming video call');await B.click('[data-call=decline]');
 await until(A,()=>document.querySelector('#callStatus')?.textContent==='Brian Otieno declined the call.',null,10000);
 assert.equal([...calls.values()].at(-1).status,'Declined');
 await A.click('[data-call=close]');await B.click('[data-call=close]');
 await A.evaluate(()=>window.calls.start('ch','audio','Brian Otieno'));await until(A,()=>document.querySelector('#callStatus')?.textContent==='Ringing…');await B.evaluate(()=>window.calls.poke());
 await until(B,()=>document.querySelector('#callStatus')?.textContent==='Incoming voice call');
 await A.click('[data-call=end]');
 await until(B,()=>document.querySelector('#callStatus')?.textContent==='Missed call from Alice Njoroge.',null,10000);
 assert.equal([...calls.values()].at(-1).status,'Missed');
 await A.click('[data-call=close]');await B.click('[data-call=close]');

 // 4. A blocked microphone: a clear message and nothing sent to the server.
 const before=log.length;
 await A.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}));});
 await A.evaluate(()=>window.calls.start('ch','audio','Brian Otieno'));
 await until(A,()=>/blocked the microphone/.test(document.querySelector('#callStatus')?.textContent));
 assert.equal(log.slice(before).some(l=>l.action==='discussion_call_start'),false);
 assert.equal(await A.evaluate(()=>window.calls.busy()),false);
 await A.click('[data-call=close]');

 // 5. A colleague whose camera will not start joins a video call by voice.
 const bench=await browser.newContext({permissions:['microphone','camera']});await bench.close();
 const C=await open('A');  // a fresh page for the caller, so the blocked-microphone override above is gone
 await B.evaluate(()=>{const md=navigator.mediaDevices,orig=md.getUserMedia.bind(md);md.getUserMedia=c=>c.video?Promise.reject(Object.assign(new Error('none'),{name:'NotFoundError'})):orig(c);});
 await C.evaluate(()=>window.calls.start('ch','video','Brian Otieno'));await B.evaluate(()=>window.calls.poke());
 await until(B,()=>document.querySelector('#callStatus')?.textContent==='Incoming video call');await B.click('[data-call=accept]');
 await until(C,()=>document.querySelector('#callStatus')?.textContent==='In call');await until(B,()=>document.querySelector('#callStatus')?.textContent==='In call');
 assert.ok((await B.evaluate(()=>window.__notices)).some(m=>/voice only/.test(m)));
 assert.doesNotMatch(await B.evaluate(()=>document.querySelector('#callOverlay').className),/has-local-video/);
 await B.click('[data-call=end]');await until(C,()=>/^Call ended/.test(document.querySelector('#callStatus')?.textContent),null,10000);

 assert.deepEqual(errors,[],'no script errors');
 await browser.close();server.close();stun.close();console.log('chat calls browser test passed');
})().catch(e=>{console.error(e);process.exit(1);});
