import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const uat=fs.readFileSync(new URL('../supabase/FULL_ERP_STAFF_UAT.md',import.meta.url),'utf8');

// This is a release-traceability guard, not evidence that these features work.
// It keeps requirements from the attached access/catch-up review visible and
// prevents them being reported as tested until staging evidence exists.
test('attached access and catch-up checks are individually tracked as Not checked',()=>{
 for(let n=47;n<=62;n++){
  const line=uat.split('\n').find(x=>new RegExp(`^\\| U${n} \\|`).test(x));
  assert.ok(line,`U${n} from the attached review must remain in the UAT register`);
  assert.match(line,/Not checked/,`U${n} cannot pass without staging evidence`);
 }
 for(const requirement of ['17.1','17.2','17.3','17.4','17.5','17.6','17.7','17.8','17.9','17.10','18.1','18.2','18.3','18.4','18.5','18.6','18.7']){
  assert.ok(uat.includes(requirement),`Attached check ${requirement} needs a traceable UAT case`);
 }
});

test('UAT register states current automated coverage limits explicitly',()=>{
 assert.match(uat,/role-based area restrictions and one catch-up upload for a range of months/);
 assert.match(uat,/does not yet demonstrate the attached per-item\/per-action access matrix or one package per financial year/);
 assert.match(uat,/These tests do not establish hosted role authorization, the per-item permission matrix, annual imports or year-wide Gate B behavior/);
 assert.match(uat,/U64 \| Full client-to-audit-staging journey/);
 assert.match(uat,/GitHub Actions run \[\#44\].*passed 251 checks/);
});
