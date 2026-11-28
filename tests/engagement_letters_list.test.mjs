import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {engagementLetterAction}=await import('../supabase/functions/staff-workspace-v12/engagement-letter-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
let sp=0;tx.savepoint=async fn=>{const n='sp'+(++sp);await db.exec('savepoint '+n);try{const r=await fn(tx);await db.exec('release savepoint '+n);return r;}catch(e){await db.exec('rollback to savepoint '+n);await db.exec('release savepoint '+n);throw e;}};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const el=(role,p)=>as(role,a=>engagementLetterAction(tx,a,p));
test('engagement letters list: states, who may see it, and linking uploaded letters with a different verifier',async t=>{
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
 const doc=async(p,client,by)=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by,is_locked) values(${d},${client},${F},${p},'Signed Engagement Letters',${'letter-'+d.slice(0,4)+'.pdf'},${'k/'+d},10,${'a'.repeat(64)},'application/pdf',${by},true)`;return d;};
 const PA=await proj(A,'Alpha uploaded by manager'),PB=await proj(B,'Beta no letter'),PC=await proj(C,'Gamma expired'),PD=await proj(B,'Beta verified'),PE=await proj(C,'Gamma uploaded by partner');
 await doc(PA,A,actors.MANAGER.staff_id);
 const dc=await doc(PC,C,actors.PARTNER.staff_id),dd=await doc(PD,B,actors.PARTNER.staff_id);
 await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by,letter_expires_on) values(${PC},${dc},${actors.MANAGER.staff_id},'2020-01-01')`;
 await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by,letter_expires_on) values(${PD},${dd},${actors.MANAGER.staff_id},'2099-01-01')`;
 await doc(PE,C,actors.PARTNER.staff_id);
 await assert.rejects(()=>el('ASSISTANT',{action:'engagement_letters_list'}),/Manager or Partner/);
 const l=await el('MANAGER',{action:'engagement_letters_list'});
 assert.equal(l.total,5);assert.deepEqual(l.counts,{'Missing':1,'Uploaded, not linked':2,'Not verified':0,'Expired':1,'Verified':1});
 const only=await el('MANAGER',{action:'engagement_letters_list',state:'Expired'});assert.equal(only.rows.length,1);assert.match(only.rows[0].company_name,/GAMMA/);
 // Link: the preview writes nothing; the manager who uploaded PA's letter is left out, and the partner who uploaded PE's is left out.
 const pm=await el('MANAGER',{action:'engagement_letters_link_ready'});assert.equal(pm.dry_run,true);assert.equal(pm.ready,1);assert.equal(pm.left.length,1);assert.match(pm.left[0].why,/uploaded/);
 await assert.rejects(()=>el('PARTNER',{action:'engagement_letters_link_ready',dry_run:false}),/at least 10/);
 const none=(await db.query(`select count(*)::int n from erp_private.engagement_controls where project_id=$1`,[PA])).rows[0].n;assert.equal(none,0,'a preview writes nothing');
 const done=await el('PARTNER',{action:'engagement_letters_link_ready',dry_run:false,note:'Opened each signed PDF and checked the signatures'});
 assert.equal(done.linked,1);assert.equal(done.left.length,1);
 const e=(await db.query(`select signed_letter_id,letter_verified_by,stage from erp_private.engagement_controls where project_id=$1`,[PA])).rows[0];
 assert.ok(e.signed_letter_id);assert.equal(e.letter_verified_by,actors.PARTNER.staff_id);assert.equal(e.stage,'Scoping');
 const after=await el('MANAGER',{action:'engagement_letters_list'});assert.equal(after.counts.Verified,2);assert.equal(after.counts['Uploaded, not linked'],1);
 const again=await el('PARTNER',{action:'engagement_letters_link_ready',dry_run:false,note:'Second run with nothing new to link'});assert.equal(again.linked,0);
 assert.equal((await db.query(`select count(*)::int n from erp_private.audit_events where action='ENGAGEMENT_LETTERS_LINKED'`)).rows[0].n,2);
});
