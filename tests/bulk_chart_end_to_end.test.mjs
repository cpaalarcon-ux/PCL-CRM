import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {bulkSetupAction}=await import('../supabase/functions/staff-workspace-v12/bulk-setup-actions.ts');
const {exportProfileAction}=await import('../supabase/functions/staff-workspace-v12/export-profile-actions.ts');
const {serviceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/service-template-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
let sp=0;tx.savepoint=async fn=>{const n='sp'+(++sp);await db.exec('savepoint '+n);try{const r=await fn(tx);await db.exec('release savepoint '+n);return r;}catch(e){await db.exec('rollback to savepoint '+n);await db.exec('release savepoint '+n);throw e;}};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const bs=(role,p)=>as(role,a=>bulkSetupAction(tx,a,p));
test('bulk client charts: prepare for several clients, then approve them in one run, with every chart rule unchanged',async t=>{
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
 // A and B have an approved business activity. C has none.
 for(const c of [A,B])await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${c},'consultancy',true,'Consultancy','Consultancy services','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;
 const rows=ids=>ids.map(c=>({client_id:c}));
 const drafts=async()=>(await db.query(`select count(*)::int n from erp_private.client_chart_versions where status='Draft'`)).rows[0].n;
 const run=async()=>(await db.query(`select count(*)::int n from erp_private.bulk_setup_runs where operation like 'CHART%'`)).rows[0].n;

 // Prepare: the preview writes nothing, a client with no approved activity is listed with the reason.
 const prep={operation:'CHART_PROPOSE',effective_from:'2026-01-01',rows:rows([A,B,C])};
 const pv=await bs('MANAGER',{action:'bulk_setup_preview',...prep});
 assert.equal(pv.summary.ready,2);assert.equal(pv.summary.skipped,1);assert.match(pv.summary.exceptions[0].reason,/at least one business activity/);assert.match(pv.summary.exceptions[0].client_label,/GAMMA/);
 assert.equal(await drafts(),0,'a preview writes nothing');
 await assert.rejects(()=>bs('MANAGER',{action:'bulk_setup_apply',...prep}),/confirm/i);
 await assert.rejects(()=>bs('ASSISTANT',{action:'bulk_setup_preview',...prep}),/Manager or Partner/);
 const ap=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...prep});
 assert.equal(ap.summary.applied,2);assert.equal(await drafts(),2);assert.equal(await run(),1);
 const again=await bs('MANAGER',{action:'bulk_setup_apply',confirm:true,...prep});
 assert.equal(again.summary.applied,0,'a chart already waiting is not made twice');assert.match(again.summary.exceptions[0].reason,/already waiting/);

 // Approve: the preparer cannot approve their own charts; the Partner can, once the Books set-up pack is confirmed.
 const appr={operation:'CHART_APPROVE',review_note:'Checked against the activities and tax profile on the files',books_pack_reviewed:true,rows:rows([A,B,C])};
 const own=await bs('MANAGER',{action:'bulk_setup_preview',...appr});
 assert.equal(own.summary.ready,0);assert.ok(own.summary.exceptions.some(x=>/different Manager or Partner/.test(x.reason)),'the preparer cannot review their own chart');
 await assert.rejects(()=>bs('PARTNER',{action:'bulk_setup_apply',confirm:true,...appr,books_pack_reviewed:false}),/Books set-up pack/);
 const pp=await bs('PARTNER',{action:'bulk_setup_preview',...appr});
 const pass=pp.results.filter(r=>r.outcome==='Ready').length;assert.equal(pass,2,'both waiting charts are ready for the Partner: '+JSON.stringify(pp.summary.exceptions));const left=pp.results.filter(r=>r.outcome==='Skipped');
 assert.ok(left.some(x=>/GAMMA/.test(x.client_label)&&/No chart is waiting/.test(x.reason)),'a client with no waiting chart is listed');
 assert.equal(await drafts(),2,'the approve preview writes nothing');
 const done=await bs('PARTNER',{action:'bulk_setup_apply',confirm:true,...appr});
 assert.equal(done.summary.applied,pass);
 const approved=(await db.query(`select count(*)::int n from erp_private.client_chart_versions where status='Approved' and reviewed_by is not null`)).rows[0].n;
 assert.equal(approved,pass);assert.equal(await drafts(),2-pass);
 assert.equal(await run(),3,'each apply has its own audit record');
});
