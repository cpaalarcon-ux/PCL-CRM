import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {reviewQueueAction}=await import('../supabase/functions/staff-workspace-v12/review-queue.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,{download:async()=>({data:null})}));

const queue=(role)=>as(role,a=>reviewQueueAction(tx,a,{action:'v3_review_queue'}));
test('submitting for review notifies the Managers and Partners who can decide it, and tells the preparer the outcome; setup changes join the Home list',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'RVQA','Fictional review firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','MANAGER3','ASSISTANT']){const cat=role.replace(/\d/,'');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional review client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional review project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id};
 const submit=(extra)=>ledger('MANAGER',{...base,action:'ledger_report_submit',report_kind:'Month',as_of:'2026-01-31',prepared_note:'January figures agree to the fictional schedules.',...extra});
 const review=(role,rv,status='Approved')=>ledger(role,{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status,review_note:'Checked to the fictional schedules.'});
 const read=async role=>(await ledger(role,{...base,action:'ledger_read',as_of:'2026-12-31'}));
 const notes=async(role)=>(await db.query(`select message from erp_private.notifications where recipient_id=$1 order by created_at,message`,[actors[role].staff_id])).rows.map(x=>x.message);
 const count=async()=>Object.fromEntries(await Promise.all(Object.keys(actors).map(async r=>[r,(await notes(r)).length])));
 assert.deepEqual(await count(),{PARTNER:0,MANAGER:0,MANAGER2:0,MANAGER3:0,ASSISTANT:0});

 // 1. Nobody named: every other Manager and Partner is told. The preparer and an Assistant are not.
 await submit();
 assert.deepEqual(await count(),{PARTNER:1,MANAGER:0,MANAGER2:1,MANAGER3:1,ASSISTANT:0});
 const first=(await notes('MANAGER2'))[0];
 assert.match(first,/Review needed: Month report as at 2026-01-31 for Fictional review client, prepared by Fictional MANAGER\./);assert.match(first,/Waiting for my review/);
 let rv=(await read('MANAGER')).report_reviews.find(x=>x.status==='Submitted');
 await ledger('MANAGER2',{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status:'Returned',review_note:'Please attach the fictional bank schedule.'});
 const back=await notes('MANAGER');assert.equal(back.length,1,'the preparer is told the outcome');
 assert.match(back[0],/Your Month report for Fictional review client was returned by Fictional MANAGER2: Please attach the fictional bank schedule\./);
 assert.equal((await notes('MANAGER2')).length,1,'the reviewer is not told about their own decision');

 // 2. A named reviewer: only that person and the Partners.
 await submit({as_of:'2026-02-28',requested_reviewer_id:actors.MANAGER2.staff_id});
 assert.deepEqual(await count(),{PARTNER:2,MANAGER:1,MANAGER2:2,MANAGER3:1,ASSISTANT:0});

 // 3. A client activity change that is waiting blocks the client's mappings. It is on the Home list of every other Manager and Partner.
 const version=(await db.query(`select version_id from erp_private.dependency_map_versions limit 1`)).rows[0].version_id;
 await db.query(`insert into erp_private.client_setup_change_sets(client_id,version_id,proposed_activities,preview,status,submitted_by,submitted_at,created_by) values($1,$2,$3,$4,'Pending review',$5,now(),$5)`,[C,version,JSON.stringify({activities:[]}),JSON.stringify({activities_to_add:[{activity_name:'Wholesale trade'}]}),actors.MANAGER.staff_id]);
 const setupItems=async role=>(await queue(role)).items.filter(x=>x.kind==='setup');
 assert.deepEqual(await setupItems('MANAGER'),[],'the person who submitted it is not asked to approve it');
 assert.deepEqual(await setupItems('ASSISTANT'),[]);
 for(const role of ['MANAGER2','MANAGER3','PARTNER']){const it=await setupItems(role);assert.equal(it.length,1,role+' sees the pending setup change');assert.equal(it[0].client_name,'Fictional review client');assert.match(it[0].title,/Wholesale trade/);assert.match(it[0].title,/blocks account mapping/);}
 // The outcome call is safe with no recipient and never tells people about their own action.
 await as('MANAGER',a=>tx`select erp_private.notify_outcome(${a.staff_id}::uuid,${C}::uuid,'x','Approved','',${'outcome:self'})`);
 assert.equal((await notes('MANAGER')).length,1);
});
