import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientSetupReviewAction}=await import('../supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');

const root=path.resolve(import.meta.dirname,'..');
test('set-up sections are submitted without blocking and reviewed later in one action',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),C=id(),PT=id(),PA=id(),actors={},sources=new Map();
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 tx.savepoint=async fn=>{await db.exec('savepoint rs');try{const r=await fn(tx);await db.exec('release savepoint rs');return r;}catch(e){await db.exec('rollback to savepoint rs');throw e;}};
 const storage={download:async key=>({data:new Blob([sources.get(key)])})};
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDQA','Fictional audit firm')`;
 for(const [role,cat] of [['PARTNER','PARTNER'],['PREP','MANAGER'],['REV','MANAGER'],['ASST','ASSISTANT']]){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL AUDIT FLOW LIMITED','P051000001A','Wholesale & Retail','Nairobi','Limited company','CR-FICTIONAL-0001 fictional certificate',10,31,${actors.PREP.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${PT},${C},${F},'Fictional books','TAX-COMP',${actors.PREP.staff_id}),(${PA},${C},${F},'Fictional audit','AUD-STAT',${actors.PREP.staff_id})`;
 for(const p of [PT,PA])for(const r of ['PREP','REV','ASST'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${actors[r].staff_id},${F},'MANAGER')`;
 await readyForLedger(tx,C);
 const C2=id();
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,owner_staff_id) values(${C2},'UAT EMPTY CLIENT LIMITED','P000000999Z','Wholesale & Retail','Nairobi',${actors.PREP.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C2},${F})`;
 const many=(r,p)=>as(r,a=>clientSetupReviewAction(tx,a,{action:'client_setup_section_submit_many',...p}));
 const sub=(code,kind='BRS',note='')=>({section_code:code,source_kind:kind,source_note:note});
 await t.test('several clients are submitted together; sections with nothing recorded are skipped',async()=>{
  const out=await many('ASST',{client_ids:[C,C2],sections:[sub('identity'),sub('year_end','KRA'),sub('ownership'),sub('activities','KRA')]});
  assert.ok(out.submitted.some(x=>x.client_id===C&&x.section==='Client identification and legal structure'),'the client with identity data is submitted');
  assert.ok(!out.submitted.some(x=>x.client_id===C2),'a client outside the Assistant\'s access submits nothing');
  assert.ok(out.skipped.some(x=>x.client_id===C&&x.section==='Directors, partners and ownership'),'an empty ownership section is listed as skipped');
  assert.ok(out.skipped.some(x=>x.client_id===C&&x.section==='Business activities and sector'),'an empty list section is skipped too');
  assert.equal(out.held.length,1);assert.match(out.held[0].reason,/not available to your account/);
  const rows=await tx`select client_id,section_code,status from erp_private.client_setup_sections order by section_code`;
  assert.ok(rows.every(r=>r.status==='Pending Review'));assert.ok(!rows.some(r=>r.client_id===C2));assert.ok(!rows.some(r=>r.section_code==='ownership'||r.section_code==='activities'));
 });
 await t.test('limits, source rule and access',async()=>{
  await assert.rejects(()=>many('ASST',{client_ids:[],sections:[sub('identity')]}),/Tick the clients/);
  await assert.rejects(()=>many('ASST',{client_ids:[C],sections:[]}),/Choose the sections/);
  await assert.rejects(()=>many('ASST',{client_ids:[C],sections:[{section_code:'identity',source_kind:'',source_note:''}]}),/Say where this information came from/);
  await assert.rejects(()=>many('ASST',{client_ids:Array.from({length:101},()=>id()),sections:[sub('identity')]}),/at most 100/);
  const out=await many('ASST',{client_ids:[id()],sections:[sub('identity')]});
  assert.equal(out.held.length,1);assert.equal(out.submitted.length,0);
 });
 await t.test('the reviewer queue lists what was submitted and a Manager approves it',async()=>{
  const q=await as('PREP',a=>clientSetupReviewAction(tx,a,{action:'client_setup_review_queue'}));
  assert.ok(q.total>=1);
  const r=await as('REV',a=>clientSetupReviewAction(tx,a,{action:'client_setup_section_decide',client_id:C,decisions:[{section_code:'identity',outcome:'Approved',note:''}]}));
  assert.equal(r.results[0].result,'Approved');
 });
});
