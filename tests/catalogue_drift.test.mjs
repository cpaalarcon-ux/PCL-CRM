// The catalogue shipped with the screens (account-catalog.json) must agree with the database catalogue built by the migrations.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite();
const rows=async(sql,v=[])=>(await db.query(sql,v)).rows;
const RETIRED_FROM_DATABASE=['37000']; // the suspense account was retired in 20261104123219_retire_suspense_account.sql; the shipped file still lists it as blocked.
const FIELDS=['name','account_group','route','category_code','statement','is_legacy','asset_class'];

test('the shipped catalogue and the database catalogue agree, and every later account is a Draft awaiting a Partner',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 const file=JSON.parse(fs.readFileSync(root+'/supabase/functions/staff-workspace-v6/account-catalog.json'));
 const db_=await rows(`select code,name,account_group,route,category_code,statement,is_legacy,asset_class,status,catalog_version,statutory_tags from erp_private.account_catalog order by code`);
 const byDb=new Map(db_.map(r=>[r.code,r])),byFile=new Map(file.accounts.map(a=>[a.code,a]));
 assert.equal(byFile.size,file.accounts.length,'codes in the shipped file are unique');assert.equal(byDb.size,db_.length);
 assert.ok(file.version&&file.sha256&&file.accounts.length>200);
 // 1. Everything in the file is in the database with the same meaning (except the retired suspense account, which must be absent).
 const missing=file.accounts.filter(a=>!byDb.has(a.code)).map(a=>a.code);
 assert.deepEqual(missing,RETIRED_FROM_DATABASE,'only the retired suspense account may be missing from the database');
 const diffs=[];for(const a of file.accounts){const r=byDb.get(a.code);if(!r)continue;for(const k of FIELDS)if(String(a[k]??null)!==String(r[k]??null))diffs.push(`${a.code}.${k}: file "${a[k]}" vs database "${r[k]}"`);}
 assert.deepEqual(diffs,[],'no field differs between the file and the database');
 // 2. Everything the migrations added after the file is a Draft with a later catalogue version, so screens that read only the file never offer it.
 const later=db_.filter(r=>!byFile.has(r.code));
 assert.ok(later.length>0);
 for(const r of later){assert.equal(r.status,'Draft',`${r.code} was added after the shipped catalogue and must be Draft`);assert.notEqual(r.catalog_version,file.version,`${r.code} must carry a newer catalogue version`);}
 // 3. Balance-sheet accounts are exactly the codes below 40000.
 for(const r of db_.filter(x=>!x.is_legacy))assert.equal(r.statement==='Statement of financial position',String(r.code)<'40000',`${r.code} statement`);
 // 4. Statutory tags only use tags in the statutory map.
 const tags=new Set((await rows(`select tag from erp_private.statutory_tag_obligations`)).map(r=>r.tag));
 for(const r of db_)for(const g of r.statutory_tags||[])assert.ok(tags.has(g),`${r.code} uses unknown statutory tag ${g}`);
});
