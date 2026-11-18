// Build 2880: the one Purchases template classifies by routing code (M) and TB item code (N) only.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import ExcelJS from '../supabase/functions/staff-workspace-v6/node_modules/exceljs/excel.js';
import {purchaseUploadSummary} from '../supabase/functions/staff-workspace-v12/purchase-upload.mjs';
import {TEMPLATES} from '../staff-resources.mjs';
const root=path.resolve(import.meta.dirname,'..');
const accounts=[{code:'61000',name:'Office expense',route:2,category_code:'EXP02',status:'Active',is_legacy:false},{code:'61100',name:'Fuel',route:2,category_code:'EXP02',status:'Active',is_legacy:false},{code:'10190',name:'Inventory',route:1,category_code:'STOCK',status:'Active',is_legacy:false}];
const row=(m,n,date='2026-10-03')=>['Local','P000000001A','Example supplier',date,'INV'+m+n,'Fictional supplies','',100,16,116,'','',m,n];
const approved=[{module:'Purchases',routing_code:'EXP02',item_code:'61000',erp_account_code:'61000',effective_from:'2026-01-01',effective_to:null,status:'Active'}];
const summary=rows=>purchaseUploadSummary(rows.map((values,i)=>({source_row:i+2,values})),'16%','2026-10-01','2026-10-31',accounts,undefined,false,approved);
test('a pair matching a Partner-approved mapping maps; a valid unapproved pair is a suggestion; blank or invalid pairs are Review; nothing uses supplier or description',()=>{
 const s=summary([row('EXP02','61000'),row('EXP02','61100'),row('',''),row('EXP02',''),row('','61000'),row('STOCK','61000'),row('EXP02','61000','2025-12-31')]);
 assert.equal(s.rejected_count,0);assert.equal(s.auto_map_count,1,'only the exact approved pair for the date');assert.equal(s.suggested_count,2,'the unapproved pair, and the approved pair before it started');
 assert.equal(s.review_count,4);assert.deepEqual(s.review_rows.map(x=>x.row),[4,5,6,7]);
 assert.match(s.review_rows[0].reason,/no routing code.*no TB code/i);assert.match(s.review_rows[1].reason,/has no TB code/);assert.match(s.review_rows[2].reason,/routing code \(M\)/i);assert.match(s.review_rows[3].reason,/does not match/);
 assert.equal(s.auto_map_count+s.suggested_count+s.review_count,s.valid_count);
});
test('with no approved mapping at all nothing maps by itself',()=>{
 const s=purchaseUploadSummary([{source_row:2,values:row('EXP02','61000')}],'16%','2026-10-01','2026-10-31',accounts,undefined,false,[]);
 assert.equal(s.auto_map_count,0);assert.equal(s.suggested_count,1);
});
test('only the single Purchases template is offered, and its TB list follows the routing code, with every active purchase account of the master chart listed',async()=>{
 assert.equal(TEMPLATES.filter(t=>t.area==='Purchases'&&/Purchases/.test(t.label)).length,1);assert.ok(!TEMPLATES.some(t=>/four-sheet/i.test(t.label)));
 const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(root,'Purchase_Upload_Template.xlsx'));
 const ref=wb.getWorksheet('ERP account codes'),pairs=[];ref.eachRow((r,i)=>{if(i>1&&r.getCell(1).value)pairs.push([String(r.getCell(1).value),String(r.getCell(3).value)]);});
 assert.equal(new Set(pairs.map(x=>x[0])).size,pairs.length,'each TB code is listed once');
 const names=new Set(wb.definedNames.model.map(x=>x.name));for(const c of new Set(pairs.map(x=>x[1])))assert.ok(names.has('R_'+c),'list for '+c);
 let total=0;for(const c of new Set(pairs.map(x=>x[1]))){const range=wb.definedNames.getRanges('R_'+c).ranges[0],m=/\$A\$(\d+)(?::\$A\$(\d+))?$/.exec(range),last=+(m[2]||m[1]);for(let i=+m[1];i<=last;i++){assert.equal(String(ref.getCell(i,3).value),c,'row '+i+' belongs to '+c);total++;}}
 assert.equal(total,pairs.length,'the per-routing lists together cover every account exactly once');
 const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]})),db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
  for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
  const live=(await db.query(`select code,category_code from erp_private.account_catalog where status='Active' and not is_legacy and route in (1,2,3) order by code`)).rows;
  assert.deepEqual(pairs.map(x=>x[0]).sort(),live.map(x=>x.code).sort(),'the template lists exactly the active purchase accounts');
  for(const a of live)assert.equal(pairs.find(x=>x[0]===a.code)[1],a.category_code,'routing code of '+a.code);
 }finally{await db.close();}
});
