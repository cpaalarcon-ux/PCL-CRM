import test from 'node:test';import assert from 'node:assert/strict';
import {createStaffSession,idleState,IDLE_MS,SESSION_KEY,watchStaffActivity} from '../staff-session.mjs';
const initial=10000000;
const bundle={access_token:'access-one',refresh_token:'refresh-one',session_id:'session-one',expires_at:(initial+3600000)/1000};
function fixture({saved,send}={}){
 let time=initial;const values=new Map(saved?[[SESSION_KEY,JSON.stringify(saved)]]:[]),calls=[],ended=[],warnings=[];
 const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const session=createStaffSession({storage,now:()=>time,send:async(p,o)=>{calls.push({p,o});return send?send(p,o):{ok:true};},onEnd:m=>ended.push(m),onWarning:v=>warnings.push(v)});
 return {session,storage,calls,ended,warnings,at:v=>{time=v;}};
}
test('warning starts at 28 minutes and logout occurs at exactly 30',()=>{
 assert.equal(idleState(initial,initial+28*60000-1).warning,false);
 assert.equal(idleState(initial,initial+28*60000).warning,true);
 assert.equal(idleState(initial,initial+IDLE_MS-1).expired,false);
 assert.equal(idleState(initial,initial+IDLE_MS).expired,true);
 const f=fixture();f.session.start(bundle);f.at(initial+IDLE_MS);assert.equal(f.session.check(),false);assert.equal(f.session.active,false);assert.equal(f.storage.getItem(SESSION_KEY),null);assert.match(f.ended[0],/30 minutes/);
});
test('real activity resets idle but a late click cannot revive an expired session',()=>{
 const f=fixture();f.session.start(bundle);f.at(initial+29*60000);assert.equal(f.session.activity(),true);f.at(initial+58*60000);assert.equal(f.session.check(),true);f.at(initial+59*60000);assert.equal(f.session.activity(),false);assert.equal(f.session.active,false);
});
test('API requests, responses and background pulses do not reset inactivity',async()=>{
 const f=fixture();f.session.start(bundle);
 for(let minute=1;minute<30;minute++){f.at(initial+minute*60000);const ctx=await f.session.beforeRequest();assert.equal(Number(ctx.headers['x-erp-activity-age-ms']),minute*60000);f.session.accept(ctx);await f.session.pulse();}
 assert.equal(f.calls.length,0);f.at(initial+IDLE_MS);await assert.rejects(f.session.beforeRequest(),/session ended/);
});
test('heartbeats send actual activity age and are throttled without idle extension',async()=>{
 const f=fixture();f.session.start(bundle);f.at(initial+1000);f.session.activity();f.at(initial+4000);await f.session.pulse();assert.equal(f.calls[0].o.headers['x-erp-activity-age-ms'],'3000');
 f.at(initial+5000);f.session.activity();await f.session.pulse();assert.equal(f.calls.length,1);f.at(initial+64000);await f.session.pulse();assert.equal(f.calls.length,2);assert.equal(f.calls[1].o.headers['x-erp-activity-age-ms'],'59000');
 f.at(initial+IDLE_MS+5000);assert.equal(f.session.check(),false);
});
test('reload preserves prior idle deadline and rejects old token-only sessions',async()=>{
 const f=fixture({saved:{...bundle,last_activity:initial-29*60000}});assert.equal(f.session.check(),true);f.at(initial+60000);await assert.rejects(f.session.beforeRequest());
 const invalid=fixture({saved:{...bundle}});assert.equal(invalid.session.active,false);
 const future=fixture({saved:{...bundle,last_activity:initial+1000}});assert.equal(future.session.active,false);
});
test('active sessions refresh once for simultaneous requests, persist rotation, preserve idle clock',async()=>{
 let resolve;const f=fixture({send:p=>p.action==='refresh_session'?new Promise(r=>{resolve=r;}):{ok:true}});f.session.start({...bundle,expires_at:(initial+100000)/1000});
 const a=f.session.beforeRequest(),b=f.session.beforeRequest();assert.equal(f.calls.length,1);
 resolve({...bundle,access_token:'access-two',refresh_token:'refresh-two'});const [ca,cb]=await Promise.all([a,b]);assert.equal(ca.headers.Authorization,'Bearer access-two');assert.equal(cb.headers.Authorization,'Bearer access-two');
 assert.equal(JSON.parse(f.storage.getItem(SESSION_KEY)).refresh_token,'refresh-two');f.at(initial+IDLE_MS);assert.equal(f.session.check(),false);
});
test('late response or token refresh cannot restore a signed-out screen',async()=>{
 const f=fixture();f.session.start(bundle);const ctx=await f.session.beforeRequest();f.session.end();assert.throws(()=>f.session.accept(ctx),/session ended/);
 let resolve;const g=fixture({send:p=>p.action==='refresh_session'?new Promise(r=>{resolve=r;}):{ok:true}});g.session.start({...bundle,expires_at:initial/1000});const pending=g.session.beforeRequest();g.session.end();resolve(bundle);await assert.rejects(pending);assert.equal(g.session.active,false);assert.equal(g.storage.getItem(SESSION_KEY),null);
});
test('401 removes credentials but a temporary network failure does not fake activity',async()=>{
 const f=fixture({send:()=>{throw Object.assign(Error('Inactive session'),{status:401});}});f.session.start({...bundle,expires_at:initial/1000});await assert.rejects(f.session.beforeRequest(),/Inactive/);assert.equal(f.session.active,false);
 const g=fixture({send:()=>{throw Error('Offline');}});g.session.start({...bundle,expires_at:initial/1000});await assert.rejects(g.session.beforeRequest(),/Offline/);assert.equal(g.session.active,true);g.at(initial+IDLE_MS);assert.equal(g.session.check(),false);
});
test('only trusted input counts; visibility and timer events just check expiry',()=>{
 const handlers={},calls=[];const doc={addEventListener:(n,fn)=>handlers[n]=fn,removeEventListener:()=>{}};const win={addEventListener:(n,fn)=>handlers[n]=fn,removeEventListener:()=>{},setInterval:fn=>{handlers.timer=fn;return 1;},clearInterval:()=>{}};
 const stop=watchStaffActivity({activity:()=>{calls.push('activity');return true;},pulse:async()=>{},check:()=>{calls.push('check');}},{document:doc,window:win,now:()=>10000});
 handlers.keydown({isTrusted:false,type:'keydown'});handlers.visibilitychange();handlers.timer();assert.equal(calls.filter(c=>c==='activity').length,0);handlers.keydown({isTrusted:true,type:'keydown'});assert.equal(calls.filter(c=>c==='activity').length,1);stop();
});
