import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientChartAction,proposeAccounts,chartResolver,approvedChart,requireChartAccount}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chart=(role,p)=>as(role,a=>clientChartAction(tx,a,p));

test('chart matrix: entity x industry x VAT x payroll, and a period spanning two chart versions',async t=>{
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

 const ENTITIES=['Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Other legal entity'];
 const PACKS=['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','MSME'];
 const STATES=['yes','no','unconfirmed'];
 // Every Draft account is treated as approved so the matrix covers the whole master chart.
 await db.exec(`alter table erp_private.account_catalog disable trigger user;update erp_private.account_catalog set status='Active' where status='Draft' and not is_legacy;alter table erp_private.account_catalog enable trigger user;`);
 const catalog=await tx`select code,name,status,is_legacy,proposed,entity_types,industry_packs,statutory_tags from erp_private.account_catalog order by code`;
 const tagged=tag=>catalog.filter(a=>a.status==='Active'&&!a.is_legacy&&a.proposed!==false&&(a.statutory_tags||[]).includes(tag));
 assert.ok(tagged('VAT').length>=3&&tagged('PAYE').length>=5,'VAT and payroll accounts exist');
 const vatOnly=tagged('VAT').filter(a=>a.statutory_tags.length===1&&!(a.entity_types||[]).length&&!(a.industry_packs||[]).length).map(a=>a.code),payeOnly=tagged('PAYE').filter(a=>a.statutory_tags.length===1&&!(a.entity_types||[]).length&&!(a.industry_packs||[]).length).map(a=>a.code);
 assert.ok(vatOnly.length&&payeOnly.length);
 let combos=0;
 for(const entity of ENTITIES)for(const pack of PACKS)for(const vat of STATES)for(const paye of STATES){
  const chart=new Set(proposeAccounts(catalog,entity,[pack],{VAT:vat,PAYE:paye}).map(a=>a.code)),label=`${entity}+${pack}+VAT ${vat}+PAYE ${paye}`;combos++;
  for(const c of vatOnly)assert.equal(chart.has(c),vat!=='no',`${label}: VAT account ${c}`);
  for(const c of payeOnly)assert.equal(chart.has(c),paye!=='no',`${label}: payroll account ${c}`);
  assert.ok(chart.has('10000')&&chart.has('60000'),`${label}: core and ordinary salary expense stay`);
  for(const a of catalog){const should=a.status==='Active'&&!a.is_legacy&&a.proposed!==false&&(!(a.entity_types||[]).length||a.entity_types.includes(entity))&&(!(a.industry_packs||[]).length||a.industry_packs.includes(pack))&&(!(a.statutory_tags||[]).length||a.statutory_tags.some(t=>({VAT:vat,PAYE:paye})[t]!=='no'));
   assert.equal(chart.has(a.code),should,`${label}: ${a.code}`);}
 }
 assert.equal(combos,ENTITIES.length*PACKS.length*9);

 // A period spanning two chart versions: each date uses the version in force that day.
 const X='60000',all=catalog.filter(a=>a.status==='Active'&&!a.is_legacy).map(a=>a.code),v1=all.filter(c=>c!==X);
 const ins=(from,codes,when)=>tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C},${from},'Limited company',${'{Wholesale}'},${'{'+codes.join(',')+'}'},'Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},${when},'Fictional approval')`;
 await ins('2026-01-01',v1,'2026-01-02T00:00:00Z');await ins('2026-07-01',all,'2026-07-02T00:00:00Z');
 const at=await chartResolver(tx,C);
 assert.equal(at('2026-06-20').codes.has(X),false,'June uses the first version');assert.equal(at('2026-07-05').codes.has(X),true,'July uses the second version');assert.equal(at('2025-12-31'),null,'before any version there is no chart');
 assert.equal((await approvedChart(tx,C,'2026-06-30')).effective_from,'2026-01-01');assert.equal((await approvedChart(tx,C,'2026-07-01')).effective_from,'2026-07-01');
 await assert.rejects(()=>requireChartAccount(tx,C,X,'2026-06-20'),/not in this client's approved chart/);
 await requireChartAccount(tx,C,X,'2026-07-05');
 // Reading the chart for the later date reports no drift once the second version is approved.
 const later=await chart('ASSISTANT',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-07-01'});
 assert.ok(later.current);
});
