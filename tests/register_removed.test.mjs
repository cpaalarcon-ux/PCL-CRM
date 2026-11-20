import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
test('build 2863: the stored set-up baseline is gone from the database and from every screen and action; the 2807 report remains',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 assert.equal((await db.query(`select to_regclass('erp_private.setup_baselines') t`)).rows[0].t,null,'the table is dropped');
 assert.equal((await db.query(`select count(*)::int n from pg_proc where proname='setup_baselines_guard'`)).rows[0].n,0);
 assert.ok((await db.query(`select to_regclass('erp_private.client_setup_milestones') t`)).rows[0].t,'the 2807 milestones stay');
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8');
 for(const f of ['staff-client-master.mjs','supabase/functions/staff-workspace-v12/client-master-actions.ts','supabase/functions/staff-workspace-v12/client-master-rules.mjs','supabase/functions/staff-workspace-v12/staff-access-control.mjs'])assert.doesNotMatch(rd(f),/setup_baseline|target_met|target_percent|can_set_baseline/,f);
 assert.match(rd('supabase/functions/staff-workspace-v12/client-master-actions.ts'),/client_master_report/);assert.match(rd('staff-client-master.mjs'),/cm-report/);
});
