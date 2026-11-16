import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {practiceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/practice-template-actions.ts');
const {serviceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/service-template-actions.ts');
const {bulkSetupAction}=await import('../supabase/functions/staff-workspace-v12/bulk-setup-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
let sp=0;tx.savepoint=async fn=>{const n='sp'+(++sp);await db.exec('savepoint '+n);try{const r=await fn(tx);await db.exec('release savepoint '+n);return r;}catch(e){await db.exec('rollback to savepoint '+n);await db.exec('release savepoint '+n);throw e;}};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const pt=(role,p)=>as(role,a=>practiceTemplateAction(tx,a,p));
const status=async code=>(await db.query(`select status,approved_by,sole_partner_approval from erp_private.service_templates where template_code='${code}' order by version desc limit 1`)).rows[0];
const count=async sql=>(await db.query(sql)).rows[0].n;

test('effective-from and last-reviewed dates: insert-only history, carried forward, set with approval and new version, in bulk, never blocking',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional practice firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','ASSISTANT']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 const read=role=>pt(role,{action:'service_category_read'});
 const rows=async sql=>(await db.query(sql)).rows;
 const s0=await read('PARTNER');const all=s0.templates.map(x=>x.template_id);
 await pt('PARTNER',{action:'service_category_approve',template_ids:all,confirm:true});
 assert.ok((await read('PARTNER')).templates.every(x=>x.dates_line==='No dates recorded'&&x.effective_from===null&&x.last_reviewed===null));
 const D={action:'service_category_dates',template_ids:all};

 // ---- who may record, and what is asked for ----
 await assert.rejects(pt('ASSISTANT',{...D,effective_from:'2027-01-01'}),/Manager or Partner/);
 await assert.rejects(pt('MANAGER',D),/effective-from date, a last-reviewed date, or both/);
 await assert.rejects(pt('MANAGER',{...D,effective_from:'2027-02-30'}),/real date/);
 await assert.rejects(pt('MANAGER',{...D,effective_from:'2019-12-31'}),/real date between/);
 await assert.rejects(pt('MANAGER',{...D,last_reviewed:'2099-01-01'}),/cannot be a date in the future/);
 await assert.rejects(pt('MANAGER',{...D,last_reviewed:'2026-11-10',dates_note:'x'.repeat(501)}),/500 characters/);
 await assert.rejects(pt('MANAGER',{...D,effective_from:'2027-01-01'}),/confirm/);

 // ---- bulk dates: preview writes nothing, apply records one row per category, a repeat is skipped ----
 const G={...D,effective_from:'2027-01-01',last_reviewed:'2026-11-10',dates_note:'Fictional: reviewed for the 2027 list'};
 const pv=await pt('MANAGER',{...G,dry:true});assert.equal(pv.summary.done,5);assert.ok(pv.results.every(r=>r.outcome==='Ready'&&r.note==='From 2027-01-01 · reviewed 2026-11-10'));
 assert.equal(await count('select count(*)::int n from erp_private.service_template_dates'),0,'a preview writes nothing');
 const ap=await pt('MANAGER',{...G,confirm:true});assert.equal(ap.summary.done,5);assert.ok(ap.results.every(r=>r.outcome==='Dates recorded'));
 assert.equal(await count('select count(*)::int n from erp_private.service_template_dates'),5);
 const again=await pt('MANAGER',{...G,confirm:true});assert.equal(again.summary.done,0);assert.match(again.results[0].reason,/already recorded/);
 const r1=await read('PARTNER');assert.ok(r1.templates.every(x=>x.effective_from==='2027-01-01'&&x.last_reviewed==='2026-11-10'&&x.dates_line==='From 2027-01-01 · reviewed 2026-11-10'&&x.dates_recorded_by_name==='Fictional MANAGER'&&x.dates_note==='Fictional: reviewed for the 2027 list'));

 // ---- a later record supersedes; what was left blank is carried forward; the history stays ----
 const one=all[0];
 await pt('PARTNER',{action:'service_category_dates',template_ids:[one],effective_from:'2027-03-01',confirm:true});
 const x1=(await read('PARTNER')).templates.find(x=>x.template_id===one);assert.equal(x1.effective_from,'2027-03-01');assert.equal(x1.last_reviewed,'2026-11-10','the blank date is carried forward');assert.equal(x1.dates_note,null);
 assert.equal(await count(`select count(*)::int n from erp_private.service_template_dates where template_id='${one}'`),2,'the earlier record stays');
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.service_template_dates set effective_from='2030-01-01'`),/permission denied/);
 await assert.rejects(as('PARTNER',()=>tx`delete from erp_private.service_template_dates`),/permission denied/);
 await assert.rejects(as('ASSISTANT',()=>tx`insert into erp_private.service_template_dates(template_id,effective_from,recorded_by) values(${one},'2027-01-01',${actors.ASSISTANT.staff_id})`),/./,'only a Partner or Manager records');
 await assert.rejects(as('MANAGER',()=>tx`insert into erp_private.service_template_dates(template_id,recorded_by) values(${one},${actors.MANAGER.staff_id})`),/./,'at least one date');
 await assert.rejects(as('MANAGER',()=>tx`insert into erp_private.service_template_dates(template_id,last_reviewed,recorded_by) values(${one},'2099-01-01',${actors.MANAGER.staff_id})`),/./,'the database refuses a future review date too');

 // ---- a new version with dates (bulk propose) and an approval with dates ----
 const pr=await pt('MANAGER',{action:'service_category_propose',template_ids:[one],due_days:{review:3,vat_review:4},effective_from:'2027-06-01',confirm:true});
 const prRow=pr.results[0];assert.equal(prRow.outcome,'Proposed',JSON.stringify(pr.results));assert.match(prRow.note,/Dates: From 2027-06-01/);
 const v2=(await read('PARTNER')).templates.find(x=>x.version===2);assert.equal(v2.effective_from,'2027-06-01');assert.equal(v2.last_reviewed,null);assert.equal(v2.dates_line,'From 2027-06-01');
 const ap2=await pt('PARTNER2',{action:'service_category_approve',template_ids:[v2.template_id],last_reviewed:'2026-11-12',confirm:true});assert.equal(ap2.results[0].outcome,'Approved');assert.match(ap2.results[0].note,/Dates: reviewed 2026-11-12/);
 const v2b=(await read('PARTNER')).templates.find(x=>x.version===2);assert.equal(v2b.status,'Approved');assert.equal(v2b.effective_from,'2027-06-01','effective-from kept when only the review date is given');assert.equal(v2b.last_reviewed,'2026-11-12');
 // The same dates are in force for the version that was retired, and a retired version takes no more dates.
 const v1=await rows(`select status from erp_private.service_templates where template_id='${one}'`);assert.equal(v1[0].status,'Retired');
 const ret=await pt('MANAGER',{...D,template_ids:[one],effective_from:'2028-01-01',confirm:true});assert.equal(ret.results[0].outcome,'Skipped');assert.match(ret.results[0].reason,/retired and keeps/);
 await assert.rejects(as('MANAGER',()=>tx`insert into erp_private.service_template_dates(template_id,effective_from,recorded_by) values(${one},'2028-01-01',${actors.MANAGER.staff_id})`),/retired service template keeps/);
 // Approving with a bad date is refused before anything is approved.
 const payId=(await rows(`select template_id from erp_private.service_templates where template_code='PAYROLL-MONTHLY' and version=1`))[0].template_id;
 await pt('MANAGER',{action:'service_category_propose',template_ids:[payId],due_days:{review:3},confirm:true});
 const draft=(await read('PARTNER')).templates.find(x=>x.status==='Draft');
 assert.ok(draft,'a draft exists');
 {await assert.rejects(pt('PARTNER2',{action:'service_category_approve',template_ids:[draft.template_id],last_reviewed:'2099-01-01',confirm:true}),/future/);assert.equal((await rows(`select status from erp_private.service_templates where template_id='${draft.template_id}'`))[0].status,'Draft');}

 // ---- dates are read by everyone who sets up engagements, and never block them ----
 const list=await as('ASSISTANT',a=>serviceTemplateAction(tx,a,{action:'service_template_list'}));
 assert.ok(list.templates.some(x=>x.effective_from==='2027-06-01'&&x.last_reviewed==='2026-11-12'),'the template list carries the dates');
 const bo=await as('MANAGER',a=>bulkSetupAction(tx,a,{action:'bulk_setup_options'}));
 assert.ok(bo.templates.some(x=>x.effective_from==='2027-06-01'&&x.last_reviewed==='2026-11-12'),'bulk set-up options carry the dates');
 assert.ok(await count(`select count(*)::int n from erp_private.audit_events where table_name='service_template_dates'`)>=8,'the audit trail records each date record');
});
