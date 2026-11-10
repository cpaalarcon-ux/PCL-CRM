// Director current and director loan accounts: Draft, limited companies only, no rate stored, grouped correctly in the bank summary.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {proposeAccounts}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const {outGroup}=await import('../supabase/functions/staff-workspace-v12/bank-statement.mjs');
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const root=path.resolve(import.meta.dirname,'..'),NEW=['20250','20260'];
test('director accounts are Draft, company-only, carry no rate, and wait for a Partner',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 const rows=(await db.query(`select * from erp_private.account_catalog where code = any($1) order by code`,[NEW])).rows;
 assert.deepEqual(rows.map(r=>r.code),NEW);
 for(const r of rows){assert.equal(r.status,'Draft');assert.deepEqual(r.entity_types,['Limited company']);assert.equal(r.is_legacy,false);assert.equal(r.statement,'Statement of financial position');assert(!/\d\s*%/.test(r.tax_note+r.notes),'no rate stored');}
 const all=(await db.query(`select * from erp_private.account_catalog`)).rows;
 assert(!proposeAccounts(all,'Limited company',['Other'],[]).map(a=>a.code).some(c=>NEW.includes(c)),'not offered until a Partner activates them');
 const active=all.map(a=>NEW.includes(a.code)?{...a,status:'Active'}:a);
 const ltd=proposeAccounts(active,'Limited company',['Other'],[]).map(a=>a.code),sole=proposeAccounts(active,'Sole proprietor',['Other'],[]).map(a=>a.code);
 for(const c of NEW){assert(ltd.includes(c),c+' offered to a company once Active');assert(!sole.includes(c),c+' never offered to a sole proprietor');}
});
test('in the bank summary a director current account is a drawing-type outflow and a director loan account is a loan repayment',()=>{
 assert.equal(outGroup('20250'),'drawings');assert.equal(outGroup('20260'),'loans');
});
