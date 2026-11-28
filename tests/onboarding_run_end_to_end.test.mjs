import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {onboardingRunAction}=await import('../supabase/functions/staff-workspace-v12/onboarding-run-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
let sp=0;tx.savepoint=async fn=>{const n='sp'+(++sp);await db.exec('savepoint '+n);try{const r=await fn(tx);await db.exec('release savepoint '+n);return r;}catch(e){await db.exec('rollback to savepoint '+n);await db.exec('release savepoint '+n);throw e;}};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const run=(role,p)=>as(role,a=>onboardingRunAction(tx,a,p));
test('onboarding run: reads where each client is, for a Manager or Partner only, and changes nothing',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'BLKQA','Fictional bulk firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const [A,B,C]=[id(),id(),id()];
 for(const [c,name] of [[A,'UAT FICTIONAL CHART ALPHA LIMITED'],[B,'UAT FICTIONAL CHART BETA LIMITED'],[C,'UAT FICTIONAL CHART GAMMA LIMITED']]){
  await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,legal_structure,legal_subtype,entity_evidence,year_end_month,year_end_day) values(${c},${name},${actors.MANAGER.staff_id},'Limited company','Limited Company','Private Limited Company','Fictional verified incorporation',12,31)`;
  await tx`update erp_private.clients set is_uat_fixture=true where client_id=${c}`;
  await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;
 }
 const p=id();await db.exec('set session_replication_role=replica');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id) values(${p},${C},${F},'Gamma active','TAX-COMP','Active',${actors.MANAGER.staff_id})`;await db.exec('set session_replication_role=origin');
 const before=(await db.query(`select (select count(*) from erp_private.audit_events)::int n`)).rows[0].n;
 await assert.rejects(()=>run('ASSISTANT',{action:'client_setup_onboarding_run'}),/Manager or Partner/);
 assert.equal(await run('MANAGER',{action:'other'}),undefined);
 const r=await run('MANAGER',{action:'client_setup_onboarding_run'});
 assert.equal(r.total,3);
 const at=Object.fromEntries(r.rows.map(x=>[x.company_name.match(/ALPHA|BETA|GAMMA/)[0],x.stage]));
 assert.deepEqual(at,{ALPHA:'SEND',BETA:'SEND',GAMMA:'DONE'});
 assert.equal(r.counts.SEND,2);assert.equal(r.counts.DONE,1);
 // Approved minimum sections and an approved chart move Alpha on.
 await db.exec('set session_replication_role=replica');
 for(const code of ['identity','registration','ownership','contacts'])await tx`insert into erp_private.client_setup_sections(client_id,section_code,status,content_digest,approved_digest,submitted_by,reviewed_by) values(${A},${code},'Approved','d','d',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id})`;
 await db.exec('set session_replication_role=origin');
 const r2=await run('PARTNER',{action:'client_setup_onboarding_run'});
 assert.equal(r2.rows.find(x=>/ALPHA/.test(x.company_name)).stage,'CHART_PREPARE');
 assert.equal((await db.query(`select (select count(*) from erp_private.audit_events)::int n`)).rows[0].n,before,'reading writes nothing');
});
