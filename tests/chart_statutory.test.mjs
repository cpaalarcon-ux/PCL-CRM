// Statutory (VAT / PAYE) layer of the client chart.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientChartAction,proposeAccounts}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chart=(role,p)=>as(role,a=>clientChartAction(tx,a,p));

test('VAT and payroll accounts follow the client\'s verified tax obligations',async t=>{
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
 const read=()=>chart('ASSISTANT',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-01-01'});
 const has=(r,c)=>r.accounts.some(x=>x.code===c);
 // nothing verified yet: the statutory accounts are still proposed
 let r=await read();
 assert.deepEqual(r.statutory,{VAT:'unconfirmed',PAYE:'unconfirmed'});
 assert.ok(has(r,'21000')&&has(r,'10160')&&has(r,'21600')&&has(r,'21603')&&has(r,'60050'));
 assert.equal(r.accounts.find(x=>x.code==='21000').layer,'Statutory');
 // a verified profile where VAT applies and payroll does not
 const prof=(await tx`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,status,created_by,verified_by,verified_at) values(${C},'Company','Resident','Standard',${tx.array(['VAT'])}::text[],'2026-01-01','2026-12-31','Fictional profile','Verified',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now()) returning profile_id`)[0].profile_id;
 await tx`insert into erp_private.client_tax_obligations(client_id,profile_id,obligation_code,effective_from,effective_to,registered,applicable,client_status,handling_firm_ids) values(${C},${prof},'VAT','2026-01-01','2026-12-31','YES','YES','ACTIVE',${'{'+F+'}'}::uuid[])`;
 r=await read();
 assert.deepEqual(r.statutory,{VAT:'yes',PAYE:'no'});
 assert.ok(has(r,'21000')&&has(r,'10160'),'VAT accounts stay for a VAT-registered client');
 assert.ok(!has(r,'21600')&&!has(r,'21601')&&!has(r,'21602')&&!has(r,'21603')&&!has(r,'21604')&&!has(r,'60050')&&!has(r,'20020'),'payroll accounts leave the chart when the client has no payroll obligation');
 assert.ok(has(r,'60000'),'ordinary salary expense is not a statutory account');
 // an account the client already uses must be added deliberately, with the reason shown
 await as('MANAGER',a=>tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,created_by) values(${C},'P-1','Fictional PAYE control','21600','2026-01-01',${a.staff_id})`);
 await assert.rejects(()=>chart('MANAGER',{action:'v3_client_chart_propose',client_id:C,effective_from:'2026-01-01'}),/Needs the client's PAYE obligation/);
 // VAT not applicable: VAT accounts go; PAYE applicable through NSSF alone keeps the whole payroll group
 await tx`update erp_private.client_tax_obligations set applicable='NO',registered='NO' where obligation_code='VAT' and client_id=${C}`;
 await tx`insert into erp_private.client_tax_obligations(client_id,profile_id,obligation_code,effective_from,effective_to,registered,applicable,client_status,handling_firm_ids) values(${C},${prof},'NSSF','2026-01-01','2026-12-31','YES','YES','ACTIVE',${'{'+F+'}'}::uuid[])`;
 r=await read();assert.deepEqual(r.statutory,{VAT:'no',PAYE:'yes'});
 assert.ok(!has(r,'21000')&&!has(r,'10160')&&!has(r,'21020'));assert.ok(has(r,'21600')&&has(r,'21603'));
 // an approved chart made before payroll applied is out of date once it does
 const before=r.accounts.map(x=>x.code).filter(c=>!['21600','21601','21602','21603','21604','60050','60060','60070','20020','21610','21611','21612'].includes(c));
 await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C},'2026-01-01','Limited company',${'{Wholesale}'},${'{'+before.join(',')+'}'},'Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now(),'Fictional approval')`;
 r=await read();
 assert.equal(r.status,'Out of date');assert.ok(r.stale_statutory.some(x=>x.code==='21600'),'the new payroll accounts are named');
});

test('statutory tags only remove accounts when the obligation is known not to apply',()=>{
 const accounts=[{code:'10000',status:'Active'},{code:'21000',status:'Active',statutory_tags:['VAT']},{code:'21600',status:'Active',statutory_tags:['PAYE']}];
 assert.deepEqual(proposeAccounts(accounts,'Limited company',[],{VAT:'no',PAYE:'yes'}).map(x=>x.code),['10000','21600']);
 assert.deepEqual(proposeAccounts(accounts,'Limited company',[],{VAT:'unconfirmed',PAYE:'no'}).map(x=>x.code),['10000','21000']);
 assert.deepEqual(proposeAccounts(accounts,'Limited company',[]).map(x=>x.code),['10000','21000','21600'],'no statutory information keeps everything');
});
