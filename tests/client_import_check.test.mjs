import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientMasterAction}=await import('../supabase/functions/staff-workspace-v12/client-master-actions.ts');
const {masterImport}=await import('../supabase/functions/staff-workspace-v12/master-import.ts');
const {routingMapAction}=await import('../supabase/functions/staff-workspace-v12/routing-map-actions.ts');
const {default:ExcelJS}=await import('exceljs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
tx.savepoint=async fn=>{await db.exec('savepoint rs');try{const r=await fn(tx);await db.exec('release savepoint rs');return r;}catch(e){await db.exec('rollback to savepoint rs');throw e;}};
const cm=(role,p)=>as(role,a=>clientMasterAction(tx,a,p)),rm=(role,p)=>as(role,a=>routingMapAction(tx,a,p));
test('client import pre-check: sector, activity, dates and PIN problems are listed before anything is saved',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const book=async rows=>{const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Clients');for(const r of rows)ws.addRow(r);return Buffer.from(await wb.xlsx.writeBuffer());};
 const form=async(rows,map)=>{const f=new FormData();f.set('dataset','Clients');f.set('action','master_commit');f.set('firm_id',F);f.set('header_row','1');f.set('first_row','2');f.set('last_row',String(rows.length));f.set('column_map',JSON.stringify(map));f.set('file',new File([await book(rows)],'clients.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return f;};
 const sectorRows=(await tx`select name from erp_private.sectors where deleted_at is null`).map(r=>r.name);
 assert.ok(sectorRows.includes('Wholesale & Retail')&&sectorRows.includes('Construction'),'the approved sector list is in the database');
 const HEAD=['company_name','kra_pin','primary_sector','branch_location','client_category','incorporation_date','year_end','activity_code','pack_code'];
 const MAP=Object.fromEntries(HEAD.slice(0,7).map((k,i)=>[k,i+1]));
 const good=['Fictional Builders Ltd','P000000001A','Construction','Bungoma','Corporate','19/12/2017','31 December','construction','Construction'];
 const bad=[
  ['Fictional Goods Trader','A000000002B','Supply of Goods','bungoma','Individual','2020-02-03 00:00:00','12-31','construction','Wholesale & Retail'],
  ['Fictional Guard Ltd','P000000003C','Services','Bungoma','Corporate','31/02/2020','12-31','security','Professional servises'],
  ['Fictional Dup Ltd','P000000001A','Construction','Bungoma','Corporate','','','construction','Construction']];
 const withFlag=async(rows,flag)=>{const f=await form(rows,MAP);f.set('last_row',String(rows.length));if(flag)f.set('precheck','1');return f;};
 const pv=async rows=>{const f=await form(rows,MAP);f.set('action','master_preview');return as('MANAGER',a=>masterImport(tx,a,f));};
 // Preview reports every problem with its row, column and (where safe) a suggestion.
 const out1=await pv([HEAD,good,...bad]);
 assert.equal(out1.issues.checked,4);
 const err=(row,col)=>out1.issues.errors.find(e=>e.row===row&&e.column===col);
 assert.equal(err(3,'Sector').suggestion,'Wholesale & Retail');assert.match(err(3,'Sector').issue,/not one of the \d+ approved sectors/);
 assert.equal(err(3,'Branch').suggestion,'Bungoma');
 assert.match(err(3,'Activity code').issue,/belongs to Construction, but this client is in Wholesale & Retail/);assert.match(err(3,'Activity code').suggestion,/"retail"/);
 assert.equal(err(4,'Sector').suggestion,null,'Services is not guessed');assert.match(err(4,'Sector').issue,/not guessed/);
 assert.equal(err(4,'Activity pack').suggestion,'Professional Services','a typo in the pack name is corrected');
 assert.match(err(4,'Incorporation date').issue,/not a real date/);assert.match(err(4,'Activity code').issue,/security/);
 assert.match(err(5,'KRA PIN').issue,/already on row 2/);
 assert.ok(out1.issues.notices.find(n=>n.row===2&&n.column==='Incorporation date'&&n.suggestion==='2017-12-19'),'DD/MM/YYYY will be saved as YYYY-MM-DD');
 assert.ok(out1.issues.notices.find(n=>n.row===3&&n.suggestion==='2020-02-03'));assert.ok(out1.issues.notices.find(n=>n.row===2&&n.column==='Year end'&&n.suggestion==='12-31'));
 assert.equal(await as('ASSISTANT',async()=>1),1);
 // With the pre-check on, a single error stops the whole import: nothing is saved.
 const before=(await tx`select count(*)::int n from erp_private.clients`)[0].n;
 const blocked=await as('MANAGER',async a=>masterImport(tx,a,await withFlag([HEAD,good,...bad],true)));
 assert.equal(blocked.status,'VALIDATION_FAILED');assert.ok(blocked.errors.length>=6);
 assert.equal((await tx`select count(*)::int n from erp_private.clients`)[0].n,before,'nothing was saved');
 // A clean workbook imports, and a DD/MM/YYYY date and "31 December" are saved in the form the ERP keeps.
 const ok=await as('MANAGER',async a=>masterImport(tx,a,await withFlag([HEAD,good],true)));
 assert.equal(ok.new_count,1);assert.equal(ok.rejected_count,0);
 const cid=(await tx`select client_id from erp_private.clients where kra_pin='P000000001A'`)[0].client_id;
 const facts=Object.fromEntries((await tx`select field_key,value from erp_private.client_field_facts where client_id=${cid}`).map(r=>[r.field_key,r.value]));
 assert.equal(facts.incorporation_date,'2017-12-19');assert.equal(facts.year_end,'12-31');
 // Without the flag the old behaviour stands: bad rows are rejected one by one.
 const old=await as('MANAGER',async a=>masterImport(tx,a,await withFlag([HEAD,['Fictional Old Way Ltd','P000000009Z','Supply of Goods','Bungoma','Corporate','','','','']],false)));
 assert.equal(old.rejected_count,1);assert.match(old.rejections[0].reason,/Unknown sector/);
});
test('the import screen lists the problems, blocks the button and shows what will be tidied',async()=>{
 const ui=fs.readFileSync(root+'/staff-suite.mjs','utf8');
 assert.match(ui,/function masterIssues/);assert.match(ui,/to fix before importing/);assert.match(ui,/What will be tidied/);
 assert.match(ui,/go\.disabled=true/);assert.match(ui,/name="precheck" value="1"/);assert.match(ui,/Nothing was imported/);
});
