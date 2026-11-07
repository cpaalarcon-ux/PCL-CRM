import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('staff-pilot.html'),release=JSON.parse(read('supabase/functions/staff-workspace-v12/release.json')),server=read('supabase/functions/staff-workspace-v12/index.ts'),auth=read('staff-pilot-auth.js');

// One release identity: the page build label and the server release file must be bumped together,
// so a stale website or a stale server is visible to staff and to the hosted check.
test('page and server carry the same build label',()=>{
 assert.match(release.build,/^\d{4}-\d{2}-\d{2}\.\d+$/);
 assert.equal(html.match(/data-build="([^"]+)"/)?.[1],release.build);
 const labels=[...html.matchAll(/build (\d{4}-\d{2}-\d{2}\.\d+)/g)].map(m=>m[1]);
 assert.ok(labels.length>=2&&labels.every(x=>x===release.build),'header and footer labels match release.json');
});
test('server exposes release_info before authentication and the page checks it without blocking sign-in',()=>{
 assert.match(server,/import release from '\.\/release\.json' with \{type:'json'\}/);
 assert.match(server,/if\(p\.action==='release_info'\)result=\{function:'staff-workspace-v12',build:release\.build,commit:/);
 assert.ok(server.indexOf("p.action==='release_info'")<server.indexOf('const id=await identity(req)',server.indexOf('JSON.parse(body)')),'release_info is answered before identity checks');
 assert.match(auth,/send\(\{ action: 'release_info' \}/);
 assert.match(auth,/The release check never blocks sign-in/);
});
