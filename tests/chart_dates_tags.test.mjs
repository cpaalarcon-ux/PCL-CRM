// Effective-date rule and data-driven statutory tags for the client chart.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientChartAction,proposeAccounts}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chart=(role,p)=>as(role,a=>clientChartAction(tx,a,p));

test('the chart only uses facts in force on its date, and statutory tags come from the map',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CHARTQA','Fictional chart firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional chart client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional chart project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await tx`update erp_private.clients set legal_structure='Limited Company',legal_subtype='Private Limited Company' where client_id=${C}`;
 await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional CR12',${actors.MANAGER.staff_id})`;
 const read=at=>chart('ASSISTANT',{action:'v3_client_chart_read',client_id:C,effective_from:at});
 const has=(r,c)=>r.accounts.some(x=>x.code===c);
 const addProfile=async(from,to,status='Verified')=>(await tx`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,status,created_by,verified_by,verified_at) values(${C},'Company','Resident','Standard',${tx.array(['VAT'])}::text[],${from},${to},'Fictional profile',${status},${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now()) returning profile_id`)[0].profile_id;
 const oblige=(profile,code,from,to,applicable='YES')=>tx`insert into erp_private.client_tax_obligations(client_id,profile_id,obligation_code,effective_from,effective_to,registered,applicable,client_status,handling_firm_ids) values(${C},${profile},${code},${from},${to},'YES',${applicable},'ACTIVE',${'{'+F+'}'})`;

 // ---- 1. dates: an activity that starts later does not shape an earlier chart ----
 await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${C},'retail',false,'Retail','Retail trade','Business','2026-07-01','Fictional licence',${actors.MANAGER.staff_id})`;
 assert.deepEqual((await read('2026-01-01')).packs,['Wholesale'],'Retail starts in July, so it is not in a January chart');
 assert.deepEqual((await read('2026-08-01')).packs,['Retail','Wholesale'],'from August both activities apply');
 await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,effective_to,evidence,created_by) values(${C},'construction',false,'Construction','Construction contract','Business','2026-01-01','2026-03-31','Fictional contract',${actors.MANAGER.staff_id})`;
 assert.deepEqual((await read('2026-04-01')).packs,['Wholesale'],'an activity that has ended is not in a later chart');
 assert.deepEqual((await read('2026-03-31')).packs,['Construction','Wholesale'],'the last day still counts');

 // ---- 1. dates: a verified profile and its obligations count only while in force ----
 assert.deepEqual((await read('2026-02-01')).statutory,{VAT:'unconfirmed',PAYE:'unconfirmed'},'no verified profile yet');
 const profile=await addProfile('2026-09-01','2026-12-31');
 await oblige(profile,'VAT','2026-10-01','2026-12-31');
 assert.equal((await read('2026-02-01')).statutory.VAT,'unconfirmed','a profile verified only from September does not make a February chart "verified"');
 assert.ok(has(await read('2026-02-01'),'21000'));
 let r=await read('2026-09-01');
 assert.equal(r.statutory.VAT,'no','verified from September, but VAT only starts in October');assert.ok(!has(r,'21000'));
 r=await read('2026-10-01');assert.equal(r.statutory.VAT,'yes');assert.ok(has(r,'21000'));
 r=await read('2026-12-31');assert.equal(r.statutory.VAT,'yes','the end date is inclusive');
 r=await read('2027-01-01');assert.equal(r.statutory.VAT,'unconfirmed','after the profile ends nothing is verified, so accounts stay available');

 // ---- 2. tags are data: the map is seeded, only tags in use are reported, new tags need no code ----
 const map=await tx`select tag,array_agg(obligation_code order by obligation_code) codes from erp_private.statutory_tag_obligations group by tag order by tag`;
 assert.deepEqual(map.map(m=>m.tag),['EXCISE','INSTALMENT','NCA','PAYE','SEPT','TOT','TOURISM','VAT','WHT']);
 assert.deepEqual(map.find(m=>m.tag==='PAYE').codes,['Housing levy','NITA','NSSF','PAYE','SHIF']);
 assert.deepEqual(Object.keys((await read('2026-10-01')).statutory).sort(),['PAYE','VAT'],'a tag no account carries yet is not reported');
 await assert.rejects(()=>as('MANAGER',()=>tx`insert into erp_private.account_catalog(code,name,account_group,category_code,statement,catalog_version,status,statutory_tags) values('99001','Fictional unknown tag','Expenditure','EXP01','Profit or loss','v','Draft',${'{FOO}'})`),/Unknown statutory tag/);
 await as('PARTNER',()=>tx`insert into erp_private.account_catalog(code,name,account_group,category_code,statement,catalog_version,status,statutory_tags) values('99002','Fictional TOT payable','Tax / statutory liabilities','LIAB','Statement of financial position','v','Active',${'{TOT}'})`);
 r=await read('2026-10-01');
 assert.equal(r.statutory.TOT,'no','a verified profile without TOT removes the TOT account');assert.ok(!has(r,'99002'));
 await oblige(profile,'TOT','2026-10-01','2026-12-31','TO_CONFIRM');
 r=await read('2026-10-01');assert.equal(r.statutory.TOT,'unconfirmed');assert.ok(has(r,'99002'),'to confirm keeps the account available');
 await tx`update erp_private.client_tax_obligations set applicable='YES' where profile_id=${profile} and obligation_code='TOT'`;
 r=await read('2026-10-01');assert.equal(r.statutory.TOT,'yes');assert.equal(r.accounts.find(x=>x.code==='99002').layer,'Statutory');
 // only a Partner may change the map, and nothing is deleted
 await assert.rejects(()=>as('MANAGER',()=>tx`insert into erp_private.statutory_tag_obligations(tag,obligation_code) values('TOT','Fictional')`),/row-level security|policy/i);
 await as('PARTNER',()=>tx`insert into erp_private.statutory_tag_obligations(tag,obligation_code) values('TOT','Fictional TOT variant')`);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.statutory_tag_obligations where obligation_code='Fictional TOT variant'`),/./);
});
