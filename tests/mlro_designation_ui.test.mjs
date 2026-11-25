import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('the staff screen offers the MLRO designation to a Partner only, for an active Manager or Supervisor',()=>{
 const p=rd('staff-pilot.mjs');
 assert.match(p,/function mlroBlock\(s\)\{if\(data\.me\.category_code!=='PARTNER'\)return ''/);
 assert.match(p,/\['MANAGER','SUPERVISOR'\]\.includes\(s\.category_code\)/);
 assert.match(p,/mlro_appoint:f\.get\('mlro_appoint'\)==='on'/);
});
test('the server appoints only through the Partner-checked grant function and needs an active login',()=>{
 const i=rd('supabase/functions/staff-workspace-v12/index.ts');
 assert.match(i,/Only an Engagement Partner can appoint the MLRO/);
 assert.match(i,/staff_right_grant\(\$\{sid\}::uuid,'MLRO'/);
 assert.match(i,/Activate this person/);
});
test('the rank rule allows Manager and Supervisor, not Assistant',()=>{
 const m=rd('supabase/migrations/20261213100000_mlro_manager_or_supervisor.sql');
 assert.match(m,/NOT IN\('MANAGER','SUPERVISOR'\)/);
});
