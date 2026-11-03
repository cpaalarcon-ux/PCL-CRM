import test from 'node:test';import assert from 'node:assert/strict';
import {setupLinkState} from '../supabase/functions/staff-workspace-v6/setup-link-rules.mjs';
import {watchSetupLinks,setupExpiryText} from '../staff-setup-links.mjs';
const ready={access_status:'Pending setup',contract_current:true,expired:false};
test('unused links remain valid independently of staff login state',()=>{
 assert.equal(setupLinkState(ready),'ready');
 assert.equal(setupLinkState({...ready,access_status:'Active'}),'ready');
});
test('used, replaced, expired and unavailable links have distinct states',()=>{
 assert.equal(setupLinkState({...ready,consumed_at:'now'}),'used');
 assert.equal(setupLinkState({...ready,revoked_at:'now'}),'replaced');
 assert.equal(setupLinkState({...ready,expired:true}),'expired');
 for(const row of [null,{...ready,access_status:'Inactive'},{...ready,deleted_at:'now'},{...ready,contract_current:false}])assert.equal(setupLinkState(row),'unavailable');
});
test('expiry uses Kenya time even on a differently configured computer',()=>{
 assert.match(setupExpiryText('2026-10-24T15:42:23Z'),/24 Oct 2026.*06:42 pm EAT/);
});
test('new fragment replaces an earlier setup link in the same open tab',()=>{
 const received=[],listeners=new Map(),first='a'.repeat(64),second='b'.repeat(64);
 const env={location:{pathname:'/staff-pilot',search:'',hash:'#setup='+first},history:{replaceState(_a,_b,url){assert.equal(url,'/staff-pilot');env.location.hash='';}},addEventListener(k,f){listeners.set(k,f);},removeEventListener(k){listeners.delete(k);}};
 const watcher=watchSetupLinks(v=>received.push(v),env);
 assert.equal(watcher.hasSetup,true);assert.equal(env.location.hash,'');
 env.location.hash='#setup='+second;listeners.get('hashchange')();
 assert.deepEqual(received,[first,second]);assert.equal(env.location.hash,'');
 env.location.hash='#setup=incomplete';listeners.get('hashchange')();assert.equal(received.at(-1),null);
 watcher.stop();assert.equal(listeners.size,0);
});
test('ordinary sign-in URL does not enter setup mode',()=>{
 const env={location:{hash:'',pathname:'/staff-pilot',search:''},addEventListener(){},removeEventListener(){},history:{replaceState(){throw Error('Unexpected URL change');}}};
 assert.equal(watchSetupLinks(()=>{throw Error('Unexpected setup');},env).hasSetup,false);
});
