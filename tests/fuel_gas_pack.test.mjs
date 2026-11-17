import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {proposeAccounts,accountWhy}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const {packs}=await import('../supabase/functions/staff-workspace-v12/improvement-rules.mjs');
const {businessActivityChoices,suggestedIndustryPack}=await import('../staff-business-activities.mjs');
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
test('build 2859: the Fuel and gas pack is Draft, carries no tax rate, never appears in a chart until a Partner approves it, and is chosen from the activity list',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(rd('supabase/migrations/'+f).replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 const q=async(s,...v)=>(await db.query(s,v)).rows;
 const acc=await q(`select * from erp_private.account_catalog where 'Fuel and gas'=any(industry_packs) order by code`);
 assert.equal(acc.length,13,'every account in the pack was inserted, none lost to a code clash');
 assert.ok(acc.every(a=>a.status==='Draft'&&a.catalog_version==='COA-2026-11-21-FUEL-GAS'&&!a.is_legacy));
 assert.ok(acc.every(a=>!/\d\s*%/.test(a.tax_note+a.notes)),'no tax rate is written into the pack');
 const names=acc.map(a=>a.name).join('|');for(const w of [/Fuel and gas stock/,/Cylinder and container deposits/,/Cost of fuel and gas sold/,/licence and permit fees/])assert.match(names,w);
 assert.deepEqual([...new Set(acc.map(a=>a.account_group))].sort(),['Cost of sales','Current assets','Expenditure','Liabilities','Revenue']);
 // The database accepts the pack where packs are chosen and still refuses an unknown one.
 await q(`insert into erp_private.account_catalog(code,name,account_group,category_code,statement,industry_packs,catalog_version,status) values('99998','Fictional probe','Expenditure','EXP01','Profit or loss',ARRAY['Fuel and gas'],'v','Draft')`);
 await assert.rejects(()=>q(`insert into erp_private.account_catalog(code,name,account_group,category_code,statement,industry_packs,catalog_version,status) values('99997','x','Expenditure','EXP01','Profit or loss',ARRAY['Fuel and gaz'],'v','Draft')`),/check|violates/i);
 const defs=await q(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid in ('erp_private.client_activities'::regclass,'erp_private.client_chart_versions'::regclass) and contype='c' and pg_get_constraintdef(oid) like '%Wholesale%'`);
 assert.equal(defs.length,2);assert.ok(defs.every(x=>/Fuel and gas/.test(x.d)),'client activities and chart versions both accept the pack');
 // A Draft account is not proposed; once a Partner approves it (Active) it is, with its reason.
 const catalog=await q(`select * from erp_private.account_catalog`);
 assert.equal(proposeAccounts(catalog,'Limited company',['Fuel and gas']).filter(x=>x.industry_packs.includes('Fuel and gas')).length,0);
 await q(`update erp_private.account_catalog set status='Active' where code='40445'`);
 const after=proposeAccounts(await q(`select * from erp_private.account_catalog`),'Limited company',['Fuel and gas']);
 const gas=after.find(x=>x.code==='40445');assert.ok(gas);assert.deepEqual(accountWhy(gas,'Limited company',['Fuel and gas']),['Needed by the Fuel and gas activity']);
 assert.equal(proposeAccounts(await q(`select * from erp_private.account_catalog`),'Limited company',['Retail']).some(x=>x.code==='40445'),false,'another sector does not get it');
 // The pack is on every list that offers packs and activities.
 assert.ok(packs.includes('Fuel and gas'));assert.ok(businessActivityChoices().some(c=>c[0]==='fuel_gas'));assert.equal(suggestedIndustryPack('fuel_gas'),'Fuel and gas');
 assert.match(rd('supabase/functions/staff-workspace-v12/improvement-actions.ts'),/fuel_gas:\['Fuel, gas \(LPG\) and cylinder retail','Fuel and gas'\]/);
 assert.match(rd('supabase/functions/staff-workspace-v12/activity-sectors.ts'),/fuel_gas:'Energy'/);
 assert.match(rd('staff-improvements.mjs'),/'MSME','Fuel and gas','Other'\]/);
});
