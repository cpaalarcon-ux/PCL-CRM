import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite();
const rows=async(sql,v=[])=>(await db.query(sql,v)).rows;

test('catalog accounts carry entity and industry scope; industry additions wait as Draft for a Partner',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}

 const scope=async code=>(await rows('select entity_types,industry_packs,status from erp_private.account_catalog where code=$1',[code]))[0];
 assert.deepEqual((await scope('30000')).entity_types,['Limited company']);
 assert.deepEqual((await scope('35010')).entity_types,['Sole proprietor']);
 assert.deepEqual((await scope('36010')).entity_types,['Partnership']);
 assert.deepEqual((await scope('10020')).entity_types,[],'core accounts apply to every entity type');
 assert.deepEqual((await scope('10020')).industry_packs,[],'core accounts apply to every industry');
 assert.deepEqual((await scope('21608')).industry_packs,['Hospitality']);

 const drafts=await rows(`select code,status,industry_packs from erp_private.account_catalog where catalog_version='COA-2026-11-04-IND' order by code`);
 assert.equal(drafts.length,27);
 assert.ok(drafts.every(a=>a.status==='Draft'&&a.industry_packs.length>0),'every addition is a Draft tied to an industry pack');
 for(const pack of ['Retail','Construction','Consultancy','Hospitality','Wholesale'])assert.ok(drafts.some(a=>a.industry_packs.includes(pack)),pack+' has additions');
 assert.equal((await scope('21615')).status,'Draft','construction levy stays Draft until the NCA rate is confirmed');

 await assert.rejects(db.query(`update erp_private.account_catalog set entity_types=array['Trust'] where code='10000'`),/entity_types_check/);
 await assert.rejects(db.query(`update erp_private.account_catalog set industry_packs=array['Mining'] where code='10000'`),/industry_packs_check/);
 await assert.rejects(db.query(`update erp_private.account_catalog set name='Renamed cash' where code='10000'`),/identity is immutable/,'an Active account name still cannot change');
 const pack=(await rows(`select pg_get_constraintdef(oid) d from pg_constraint where conname='client_activities_pack_code_check'`))[0].d;
 assert.match(pack,/'Retail'/,'client activities accept the Retail pack');
});
