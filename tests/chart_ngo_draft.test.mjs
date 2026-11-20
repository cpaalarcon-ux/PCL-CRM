// Chart slice B: Draft non-profit fund and grant accounts; entity-type tags may name any client entity type.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {proposeAccounts}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const root=path.resolve(import.meta.dirname,'..');
const NEW=['10340','20240','34330','40440'];

test('Foreign branch stays a real chart entity type and the chart code still accepts it',()=>{
 const src=fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/client-chart.ts','utf8');
 assert(src.includes("'Foreign branch'"));
});

test('NGO draft accounts are Draft, NGO-only, carry no rate, and are not proposed until activated',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 const rows=(await db.query(`select * from erp_private.account_catalog where code = any($1) order by code`,[NEW])).rows;
 assert.deepEqual(rows.map(r=>r.code),NEW);
 for(const r of rows){assert.equal(r.status,'Draft');assert.deepEqual(r.entity_types,['Non-profit organisation']);assert(!/\d\s*%/.test(r.tax_note+r.notes),'no rate stored');assert.equal(r.is_legacy,false);}
 const all=(await db.query(`select * from erp_private.account_catalog`)).rows;
 const npo=proposeAccounts(all,'Non-profit organisation',['Other'],[]).map(a=>a.code);
 const ltd=proposeAccounts(all,'Limited company',['Other'],[]).map(a=>a.code);
 for(const c of NEW){assert(!npo.includes(c),c+' must wait for a Partner to activate it');assert(!ltd.includes(c));}
 const active=all.map(a=>NEW.includes(a.code)?{...a,status:'Active'}:a);
 const npo2=proposeAccounts(active,'Non-profit organisation',['Other'],[]).map(a=>a.code);
 const ltd2=proposeAccounts(active,'Limited company',['Other'],[]).map(a=>a.code);
 for(const c of NEW){assert(npo2.includes(c),c+' proposed to a non-profit once Active');assert(!ltd2.includes(c),c+' never proposed to a company');}
 for(const e of ['Other legal entity','Foreign branch','Non-profit organisation'])await db.query(`update erp_private.account_catalog set entity_types=$1 where code='10340'`,[[e]]);
 await assert.rejects(()=>db.query(`update erp_private.account_catalog set entity_types=ARRAY['Nonsense'] where code='10340'`),/check|violat/i);
});
