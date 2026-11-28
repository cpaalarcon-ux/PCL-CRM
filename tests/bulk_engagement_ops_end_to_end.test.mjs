import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {bulkSetupAction}=await import('../supabase/functions/staff-workspace-v12/bulk-setup-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
let sp=0;tx.savepoint=async fn=>{const n='sp'+(++sp);await db.exec('savepoint '+n);try{const r=await fn(tx);await db.exec('release savepoint '+n);return r;}catch(e){await db.exec('rollback to savepoint '+n);await db.exec('release savepoint '+n);throw e;}};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const bs=(role,p)=>as(role,a=>bulkSetupAction(tx,a,p));
test('bulk engagement and KYC operations: activation, KYC, sending sections and team, each through the single-client rules',async t=>{
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
 const proj=async(client,name)=>{const p=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${client},${F},${name},'TAX-COMP',${actors.MANAGER.staff_id})`;return p;};
 const PA=await proj(A,'Alpha books'),PB=await proj(B,'Beta books');
 const rows=ids=>ids.map(c=>({client_id:c}));
 const runs=async()=>(await db.query(`select count(*)::int n from erp_private.bulk_setup_runs`)).rows[0].n;

 // Activation: nothing here may bypass the gate. Without verified KYC and a signed letter, the clients are listed with the missing item and stay Draft.
 const act={operation:'ENGAGEMENT_ACTIVATE',review_note:'Activating the engagements that are ready',rows:rows([A,B,C])};
 const pa=await bs('MANAGER',{action:'bulk_setup_preview',...act});
 assert.equal(pa.summary.ready,0);assert.ok(pa.summary.exceptions.some(x=>/opening TB|Verify the current client KYC/.test(x.reason)),JSON.stringify(pa.summary.exceptions));assert.ok(pa.summary.exceptions.some(x=>/no draft engagement/.test(x.reason)),'a client with no draft engagement is listed');
 await assert.rejects(()=>bs('MANAGER',{action:'bulk_setup_preview',...act,review_note:'short'}),/at least 10 characters/);
 await assert.rejects(()=>bs('ASSISTANT',{action:'bulk_setup_preview',...act}),/Manager or Partner/);
 assert.equal((await db.query(`select count(*)::int n from erp_private.projects where status='Active'`)).rows[0].n,0);

 // KYC: a client with no KYC file, or one already verified, is listed; enhanced due diligence is left for its own screen.
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.client_compliance(client_id,entity_type,verified_by,verified_at) values(${B},'Company',${actors.PARTNER.staff_id},now()) on conflict(client_id) do update set verified_by=excluded.verified_by,verified_at=excluded.verified_at`;
 await tx`insert into erp_private.client_compliance(client_id,entity_type,is_pep) values(${C},'Company',true) on conflict(client_id) do update set is_pep=true`;
 await db.exec('set session_replication_role=origin');
 const kyc={operation:'KYC_VERIFY',review_note:'Verifying the files that are complete',rows:rows([A,B,C])};
 const pk=await bs('PARTNER',{action:'bulk_setup_preview',...kyc});
 const why=Object.fromEntries(pk.summary.exceptions.map(x=>[x.client_label.match(/ALPHA|BETA|GAMMA/)[0],x.reason]));
 assert.match(why.BETA,/already verified/);assert.match(why.GAMMA,/Enhanced due diligence/);

 // Sections: only a client that meets the minimum is sent; the source rule is the single-client rule.
 await tx`insert into erp_private.beneficial_owners(client_id,full_name,identity_reference,ownership_percentage,control_basis,created_by) values(${A},'Fictional Owner','Not recorded: identity document not yet sighted',100,'Director',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_contacts(client_id,full_name,role_in_decision) values(${A},'Fictional Contact','Decision Maker')`;
 await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,recorded_by) values(${A},'registration_number','CPR/2015/123456','Client statement',${actors.MANAGER.staff_id})`;
 const send={operation:'SECTIONS_SEND',source_kind:'BRS',source_note:'',rows:rows([A,B])};
 await assert.rejects(()=>bs('MANAGER',{action:'bulk_setup_preview',...send,source_kind:'Hearsay'}),/BRS, KRA/);
 const ps=await bs('MANAGER',{action:'bulk_setup_preview',...send});
 assert.equal(ps.summary.ready,1);assert.match(ps.summary.exceptions[0].reason,/minimum is not met/);
 assert.equal((await db.query(`select count(*)::int n from erp_private.client_setup_sections`)).rows[0].n,0,'a preview sends nothing');
 await assert.rejects(()=>bs('MANAGER',{action:'bulk_setup_apply',...send}),/confirm/i);
 const sa=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...send});
 assert.equal(sa.summary.applied,1);
 const pend=(await db.query(`select client_id,status from erp_private.client_setup_sections`)).rows;
 assert.ok(pend.length>=4&&pend.every(r=>r.client_id===A&&r.status==='Pending Review'),'sections wait for approval; the bulk run approved nothing');

 // Team: a person is added to every open engagement of the ticked clients; the same rules decide who may be added.
 const team={operation:'ENGAGEMENT_TEAM',team_staff:actors.ASSISTANT.staff_id,rows:rows([A,B,C])};
 const pt=await bs('MANAGER',{action:'bulk_setup_preview',...team});
 assert.equal(pt.summary.ready,2);assert.ok(pt.summary.exceptions.some(x=>/no open engagement/.test(x.reason)));
 assert.equal((await db.query(`select count(*)::int n from erp_private.project_assignments where staff_id=$1`,[actors.ASSISTANT.staff_id])).rows[0].n,0,'a preview adds no one');
 const ta=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...team});
 assert.equal(ta.summary.applied,2);
 assert.equal((await db.query(`select count(*)::int n from erp_private.project_assignments where staff_id=$1 and project_id in ($2,$3) and deleted_at is null`,[actors.ASSISTANT.staff_id,PA,PB])).rows[0].n,2);
 const bad=await bs('MANAGER',{action:'bulk_setup_preview',...team,team_staff:id()});assert.equal(bad.summary.ready,0);
 assert.equal(await runs(),2,'each apply has its own audit run');
});
