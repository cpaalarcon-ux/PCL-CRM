import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {suiteExport}=await import('../supabase/functions/staff-workspace-v12/suite-export.ts');
const ExcelJS=(await import('exceljs')).default;
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('VAT3 schedules export only from a locked VAT case and tie to its result',async t=>{
  t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const A=actors.MANAGER,snap={result:{output:240,eligible_input:400,opening_credit:0,withholding_credit:0,reverse_charge:0,adjustments:0,net:-160,payable:0,carry_forward:160},rows:[
  {dataset:'Sales',decision:'Confirmed',vat_rate_key:'KE_VAT_STANDARD',normalized:{invoice:'S1',date:'2026-09-05',party:'Fictional Duka Ltd',party_pin:'P000000001A',amount:1500,vat:240}},
  {dataset:'Sales',decision:'Confirmed',vat_rate_key:'KE_VAT_ZERO',normalized:{invoice:'S2',date:'2026-09-06',party:'Fictional Exporter',amount:300,vat:0}},
  {dataset:'Purchases',decision:'Eligible',deductible_percentage:100,vat_rate_key:'KE_VAT_STANDARD',normalized:{invoice:'P1',date:'2026-09-07',party:'Fictional Supplier',amount:2500,vat:400}}],batches:[]};
 await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by,reviewed_by,reviewed_at,review_snapshot,result) values(${P},'VAT','2026-09-01','2026-09-30','Locked',${actors.ASSISTANT.staff_id},${A.staff_id},now(),${tx.json(snap)},${tx.json(snap.result)})`;
 await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by) values(${P},'VAT','2026-10-01','2026-10-31','Draft',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by,reviewed_by,reviewed_at,review_snapshot,result) values(${P},'Company','2026-01-01','2026-12-31','Locked',${actors.ASSISTANT.staff_id},${A.staff_id},now(),'{"rows":[],"batches":[],"result":{}}','{}')`;
 const caseId=kind=>tx`select case_id from erp_private.tax_cases where project_id=${P} and kind=${kind} order by starts_on limit 1`.then(r=>r[0].case_id),
  draft=(await tx`select case_id from erp_private.tax_cases where status='Draft'`)[0].case_id,
  run=(id,format)=>as('MANAGER',a=>suiteExport(tx,a,{action:'suite_export',kind:'Tax',format,record_id:id},{}));
 await assert.rejects(()=>run(draft,'vat3'),/locked the VAT case/);
 const companyId=await caseId('Company');
 await assert.rejects(()=>run(companyId,'vat3'),/only available for a VAT case/);
 const out=await run((await tx`select case_id from erp_private.tax_cases where status='Locked' and kind='VAT'`)[0].case_id,'vat3');
 assert.match(out.name,/^VAT3_Schedules_2026-09-01_2026-09-30_/);
 const book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(out.base64,'base64'));
 const names=book.worksheets.map(w=>w.name);
 for(const n of ['Start Here','B Sales at the standard rate','C Zero-rated sales','F Local purchases standard','M-O Summary'])assert.ok(names.includes(n),n+' sheet is present: '+names.join(', '));
 const b=book.getWorksheet('B Sales at the standard rate');assert.equal(b.getRow(2).getCell(4).value,'S1');assert.equal(Number(b.getRow(3).getCell(7).value),240,'total row');
 const start=book.getWorksheet('Start Here'),text=start.getSheetValues().flat().join('|');assert.match(text,/Schedules agree to the tax case/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='DOWNLOAD' and table_name='exports'`)[0].n,1);
});
