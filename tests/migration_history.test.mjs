import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// The repository's migration files must carry the same versions as the staging history, so a new
// environment built from the repository (for example production) gets the same history as staging,
// and `supabase db push` only ever sees genuinely new migrations.
const dir=new URL('../supabase/migrations/',import.meta.url);
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql')).sort();
const staging=fs.readFileSync(new URL('../supabase/staging-migration-history.txt',import.meta.url),'utf8').split('\n').filter(l=>l&&!l.startsWith('#')).map(l=>l.trim().replace(' ','_')+'.sql');
test('migration files use unique 14-digit versions',()=>{
 assert.ok(files.every(f=>/^\d{14}_[a-z0-9_]+\.sql$/.test(f)));
 assert.equal(new Set(files.map(f=>f.slice(0,14))).size,files.length);
});
test('every staging migration exists in the repository under the same version',()=>{
 const missing=staging.filter(f=>!files.includes(f));
 assert.deepEqual(missing,[],'rename the repository file to the version recorded on staging');
});
test('repository migrations not yet on staging are newer than the staging history',()=>{
 const last=staging.map(f=>f.slice(0,14)).sort().at(-1);
 const pending=files.filter(f=>!staging.includes(f));
 assert.ok(pending.every(f=>f.slice(0,14)>last),`older unapplied migrations: ${pending.filter(f=>f.slice(0,14)<=last).join(', ')}`);
});
