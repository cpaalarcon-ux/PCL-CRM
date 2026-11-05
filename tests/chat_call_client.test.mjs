import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {clockText,mediaProblem,endMessage,gatherComplete,callsSupported} from '../staff-chat-call.mjs';
const env={};globalThis.Deno={env:{get:k=>env[k]}};
const {iceConfig}=await import('../supabase/functions/staff-workspace-v12/call-actions.ts');

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

test('the chat shows call buttons in one-to-one chats only and keeps the call screen outside the chat panel',()=>{
 const m=fs.readFileSync(new URL('../staff-messenger.mjs',import.meta.url),'utf8');
 assert.match(m,/c\.kind!=='Direct'\|\|state\.thread\?\.read_only\|\|!callsSupported/);
 assert.match(m,/data-msgr="call-audio"/);assert.match(m,/data-msgr="call-video"/);
 assert.match(m,/closest\('#messenger,#callOverlay'\)/,'clicking the call screen does not close the chat panel');
 assert.match(m,/pcl-user:/);assert.match(m,/\\w-\]\+\\\.\[\\w-\]\+\\\.\[\\w-\]\+\$/,'no live connection for a token that is not a signed token');
 const css=fs.readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');assert.match(css,/\.call-overlay\{/);
 const headers=fs.readFileSync(new URL('../_headers',import.meta.url),'utf8');assert.match(headers,/microphone=\(self\)/);assert.match(headers,/camera=\(self\)/);assert.match(headers,/geolocation=\(\)/);
});
