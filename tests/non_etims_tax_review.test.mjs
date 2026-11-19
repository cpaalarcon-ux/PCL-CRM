import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {taxAction}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {similarity,pickSimilar,pickFromHistory,descKey,SIMILAR_MIN}=await import('../supabase/functions/staff-workspace-v12/purchase-history.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B1=id(),B2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const tax=(role,p)=>as(role,a=>taxAction(tx,a,p));

test('build 2898: non-eTIMS rows are reviewed with no VAT treatment, and they never add input VAT',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'BTQA','Fictional bulk tax firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Bulk Tax',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional bulk tax project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Import Sources','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const batch=(b,by,name)=>tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${b},${P},${D},${name},1,'Purchases','2026-01-01','2026-01-31','{}',3,3,0,0,${by})`;
 await batch(B1,actors.ASSISTANT.staff_id,'Assistant purchases');await batch(B2,actors.MANAGER.staff_id,'Manager purchases');
 const acct=(await tx`select code,category_code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy and code::int>=51000 and code::int<60000 order by code limit 1`)[0];
 let n=0;const mk=(b,key,amount)=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,category_code,account_code) values(${b},${P},${C},'Purchases',${++n},${'BT-'+key},'{}',${tx.json({date:'2026-01-10',amount,vat:amount*0.16,invoice:'BT-'+key,party:'Fictional supplier '+key,description:'Fictional '+key,vat_category:'16%'})},2,${acct.category_code},${acct.code}) returning row_id,revision`.then(r=>({row_id:r[0].row_id,revision:r[0].revision}));
 const mkNon=(key,amount)=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,category_code,account_code) values(${B1},${P},${C},'Non-eTIMS',${900+(++n)},${'NE-'+key},'{}',${tx.json({date:'2026-01-10',amount,vat:0,invoice:'NE-'+key,party:'Fictional bank',description:'Fictional bank charge '+key})},2,${acct.category_code},${acct.code}) returning row_id,revision`.then(r=>({row_id:r[0].row_id,revision:r[0].revision}));
 const n1=await mkNon('N1',3500),n2=await mkNon('N2',2300);
 const one=(role,r,extra={})=>tax(role,{action:'tax_row_review',row_id:r.row_id,revision:r.revision,decision:'Excluded',deductible_percentage:0,income_treatment:'Disallowable',reason:'Fictional evidence: reviewed with no VAT',...extra});
 // A VAT rate key sent with a non-eTIMS row is not stored: there is no VAT on these rows.
 await one('SUPERVISOR',n1,{vat_rate_key:'KE_VAT_STANDARD',vat_difference_reason:'should be dropped'});
 let got=(await tx`select vat_rate_key,vat_difference_reason,income_treatment,decision from erp_private.tax_row_reviews where row_id=${n1.row_id}`)[0];
 assert.equal(got.vat_rate_key,null);assert.equal(got.vat_difference_reason,'');assert.equal(got.income_treatment,'Disallowable');assert.equal(got.decision,'Excluded');
 // No VAT key is needed at all, and the batch path behaves the same.
 const ok=await tax('SUPERVISOR',{action:'tax_row_review_batch',rows:[n2],decision:'Excluded',deductible_percentage:0,income_treatment:'Allowable',reason:'Fictional evidence: reviewed with no VAT'});assert.equal(ok.count,1);
 got=(await tx`select vat_rate_key,income_treatment from erp_private.tax_row_reviews where row_id=${n2.row_id}`)[0];assert.equal(got.vat_rate_key,null);assert.equal(got.income_treatment,'Allowable');
});

test('the review screens say there is no VAT on non-eTIMS rows and do not ask for a VAT treatment',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),su=rd('staff-suite.mjs'),ac=rd('staff-accounting.mjs'),ta=rd('supabase/functions/staff-workspace-v12/tax-review-actions.ts');
 assert.match(su,/No VAT applies to non-eTIMS expenditure/);assert.match(su,/x\.dataset!=='Bank'&&x\.dataset!=='Non-eTIMS'\?select\(/);assert.match(su,/!list\.every\(x=>x\.dataset==='Non-eTIMS'\)/);
 assert.match(ac,/No VAT · non-eTIMS/);
 assert.match(ta,/if\(r\.dataset==='Non-eTIMS'\)\{\/\* no VAT \*\/\}/);assert.match(ta,/\['Purchases','Expenditure'\]\.includes\(r\.dataset\)&&approved&&r\.decision==='Eligible'\)input\+=/);
});
