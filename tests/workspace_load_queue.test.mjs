// Saves that arrive while a workspace read is running share one follow-up read, and never see older data.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createLoadQueue} from '../staff-load-queue.mjs';
const gate=()=>{let open;const p=new Promise(r=>{open=r;});return {p,open};};
test('one read runs, three callers share one follow-up read',async()=>{
 const gates=[],started=[];
 const load=createLoadQueue(()=>{const g=gate();gates.push(g);started.push(gates.length);return g.p;});
 const a=load();assert.equal(started.length,1);
 const b=load(),c=load(),d=load();assert.equal(started.length,1,'no extra read while one is running');
 assert.strictEqual(b,c);assert.strictEqual(c,d);
 gates[0].open();await a;await new Promise(r=>setImmediate(r));
 assert.equal(started.length,2,'exactly one follow-up read');
 gates[1].open();await Promise.all([b,c,d]);
 assert.equal(started.length,2);
 const e=load();assert.equal(started.length,3,'a later call starts a fresh read');gates[2].open();await e;
});
test('a failed read does not block the follow-up, and the next call starts fresh',async()=>{
 let n=0;const load=createLoadQueue(async()=>{n++;if(n===1)throw new Error('network');return n;});
 const a=load(),b=load();await assert.rejects(a,/network/);assert.equal(await b,2);
 assert.equal(await load(),3);
});
test('pilot uses the queue and shows the saved message before the refresh',()=>{
 const s=fs.readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8');
 assert.match(s,/const load=createLoadQueue\(options=>loadNow\(options\)\)/);
 assert.match(s,/notice\(successMessage\);\s*if\(refreshWorkspace\)await load\(\);/);
});
