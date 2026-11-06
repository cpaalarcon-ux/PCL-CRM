import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite();
const {proposeAccounts}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const rows=async(sql,v=[])=>(await db.query(sql,v)).rows;


// The master combination matrix: the legal entity decides the equity accounts, the activities decide the industry accounts.
const ENTITIES=['Limited company','Partnership','Sole proprietor','Non-profit organisation','Other legal entity'];
const PACKS=['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing'];
const EQUITY={'Limited company':['30000','31000'],'Partnership':['36000','36010','36020'],'Sole proprietor':['35000','35010'],'Non-profit organisation':['34300','34310'],'Other legal entity':[]};

test('every entity and industry pair produces the right equity and industry accounts, and nothing from another entity',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}

 const draft=await rows(`select code,industry_packs,entity_types from erp_private.account_catalog where not is_legacy`);
 for(const pack of PACKS)assert.ok(draft.filter(a=>a.industry_packs.includes(pack)).length>=2,pack+' has at least two accounts in the master chart');
 const asDrafts=await rows(`select * from erp_private.account_catalog where status='Draft' and not is_legacy order by code`);
 assert.ok(proposeAccounts(asDrafts,'Limited company',PACKS).length===0,'Draft accounts never enter a proposed chart');

 // Simulate the Partner approving every Draft account.
 await db.exec(`alter table erp_private.account_catalog disable trigger user;update erp_private.account_catalog set status='Active' where status='Draft';alter table erp_private.account_catalog enable trigger user;`);
 const catalog=await rows(`select code,name,status,is_legacy,entity_types,industry_packs,statutory_tags from erp_private.account_catalog order by code`);
 const byPack=pack=>catalog.filter(a=>a.status==='Active'&&!a.is_legacy&&a.industry_packs.includes(pack)).map(a=>a.code);
 const allEntity=[...new Set(Object.values(EQUITY).flat())];

 for(const entity of ENTITIES)for(const pack of PACKS){
  const chart=new Set(proposeAccounts(catalog,entity,[pack],{VAT:'yes',PAYE:'yes'}).map(a=>a.code)),label=`${entity} + ${pack}`;
  for(const code of EQUITY[entity])assert.ok(chart.has(code),`${label} has equity account ${code}`);
  for(const code of allEntity.filter(c=>!EQUITY[entity].includes(c)))assert.ok(!chart.has(code),`${label} must not have ${code}`);
  for(const code of byPack(pack))assert.ok(chart.has(code),`${label} has the ${pack} account ${code}`);
  for(const other of PACKS.filter(p=>p!==pack&&!(['Wholesale','Retail'].includes(p)&&['Wholesale','Retail'].includes(pack))))
   for(const code of byPack(other).filter(c=>!byPack(pack).includes(c)))assert.ok(!chart.has(code),`${label} must not have the ${other} account ${code}`);
  assert.ok(chart.has('10000'),`${label} keeps the core accounts`);
 }

 // Several activities combine; a Limited company is never given sole-proprietor or partner accounts.
 const mixed=new Set(proposeAccounts(catalog,'Limited company',['Agriculture','Transport'],{}).map(a=>a.code));
 assert.ok(byPack('Agriculture').every(c=>mixed.has(c))&&byPack('Transport').every(c=>mixed.has(c)));
 assert.ok(!mixed.has('35010')&&!mixed.has('36020'));

 // The proposal for a pack never shows a pack that is not an activity option.
 const unknown=await rows(`select count(*)::int n from erp_private.account_catalog where industry_packs && array['Mining']`);
 assert.equal(unknown[0].n,0);
});
