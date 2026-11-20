// Build .107: holiday compliance lock, go-live date and dated policy reviews.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('holiday compliance lock, go-live date and dated policy reviews',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;


 for(const role of ['ASSISTANT','SUPERVISOR','PARTNER','MANAGER2'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;

 const rejects=(fn,re)=>assert.rejects(fn,re);
 const sign=(role,code)=>as(role,()=>tx`update erp_private.system_policies set status='Signed_Off' where policy_code=${code}`);
 const pol=async code=>(await tx`select status,review_due_date::text d,signed_by from erp_private.system_policies where policy_code=${code}`)[0];
 const scan=()=>tx`select erp_private.policy_review_scan() n`.then(r=>Number(r[0].n));
 const notes=async like=>(await tx`select recipient_id,message from erp_private.notifications where event_key like ${like}`);
 const day=k=>new Date(Date.now()+3*3600000+k*86400000).toISOString().slice(0,10);
 // 1. Holiday compliance lock.
 const monthStart=new Date(Date.now()+3*3600000).toISOString().slice(0,8)+'15';
 await tx`delete from erp_private.public_holidays where false`;
 assert.equal((await tx`select erp_private.holiday_lock_active() l`)[0].l,(await tx`select count(*)::int n from erp_private.public_holidays where not confirmed and to_char(holiday_date,'YYYY-MM')=to_char(now() at time zone 'Africa/Nairobi','YYYY-MM')`)[0].n>0,'lock follows unconfirmed holidays of this month');
 await tx`insert into erp_private.public_holidays(holiday_date,name,confirmed,source_note) values(${monthStart},'Fictional unconfirmed holiday',false,'Seeded for the lock test')`;
 assert.equal((await tx`select erp_private.holiday_lock_active() l`)[0].l,true,'an unconfirmed holiday this month turns the lock on');
 await tx`update erp_private.staff_members set manager_id=${actors.MANAGER.staff_id} where staff_id=${actors.ASSISTANT.staff_id}`;
 const T=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,status) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional stuck task','In Progress')`;
 await tx`update erp_private.tasks set work_seconds=9*3600,work_started_at=now() where task_id=${T}`;
 assert.equal(Number((await tx`select erp_private.stuck_task_scan() n`)[0].n),0,'the scan does nothing while the lock is on');
 assert.equal((await notes('stuck:%')).length,0,'no stuck-task alert was raised');
 const lockNotes=await notes('holiday-lock:%');assert.deepEqual(lockNotes.map(x=>x.recipient_id).sort(),[actors.PARTNER.staff_id,actors.PARTNER2.staff_id].sort(),'both Partners are told');assert.match(lockNotes[0].message,/paused/);
 await tx`select erp_private.stuck_task_scan()`;assert.equal((await notes('holiday-lock:%')).length,2,'the Partner alert is sent once a month, not on every run');
 await as('PARTNER',()=>tx`select erp_private.holiday_save(${monthStart}::date,'Fictional unconfirmed holiday',false,'Gazette Notice No. 1234')`);
 assert.equal((await tx`select erp_private.holiday_lock_active() l`)[0].l,false,'confirming lifts the lock');
 await tx`select erp_private.stuck_task_scan()`;assert.ok((await notes('stuck:%')).length>0,'alerts resume once the lock is lifted');
 // 2. Go-live date and policy reviews.
 await sign('PARTNER','ASSISTANT_DATA_ENTRY');
 assert.deepEqual(await pol('ASSISTANT_DATA_ENTRY').then(x=>[x.status,x.d]),['Signed_Off',null],'no go-live date: signed with no review date');
 assert.equal(await scan(),0,'nothing runs while the go-live date is empty');
 await rejects(()=>as('MANAGER',()=>tx`select erp_private.go_live_save(${day(30)}::date,'Planned go-live for the firm')`),/Only a Partner/);
 await rejects(()=>as('PARTNER',()=>tx`select erp_private.go_live_save(${day(30)}::date,'short')`),/at least 10/);
 await as('PARTNER',()=>tx`select erp_private.go_live_save(${day(30)}::date,'Planned go-live for the firm')`);
 assert.equal((await pol('ASSISTANT_DATA_ENTRY')).d,day(44),'review date is go-live plus 14 days, recalculated for policies already signed');
 await sign('PARTNER','SECURITY_POLICY');assert.equal((await pol('SECURITY_POLICY')).d,day(44),'signing after the go-live date is set uses the same rule');
 assert.equal(await scan(),0,'not due yet');
 // 3. Warning three days before, then expiry on the date.
 await tx`update erp_private.system_policies set review_due_date=${day(3)} where policy_code='SECURITY_POLICY'`;
 assert.equal(await scan(),1,'one warning');let w=await notes('policy-warning:SECURITY_POLICY:%');assert.equal(w.length,2);assert.match(w[0].message,/due for review/);
 assert.equal(await scan(),1,'a second run counts it again');assert.equal((await notes('policy-warning:SECURITY_POLICY:%')).length,2,'but each Partner is warned only once');
 await tx`update erp_private.system_policies set review_due_date=${day(0)} where policy_code='ASSISTANT_DATA_ENTRY'`;
 await scan();assert.equal((await pol('ASSISTANT_DATA_ENTRY')).status,'Expired','on the review date the policy expires');
 assert.equal((await notes('policy-expired:ASSISTANT_DATA_ENTRY:%')).length,2);
 assert.equal((await pol('SECURITY_POLICY')).status,'Signed_Off','a policy not yet due stays signed');
 await as('MANAGER',()=>tx`update erp_private.system_policies set status='Signed_Off' where policy_code='ASSISTANT_DATA_ENTRY'`).catch(()=>{});
 assert.equal((await pol('ASSISTANT_DATA_ENTRY')).status,'Expired','a Manager cannot sign it again');
 await as('PARTNER',()=>tx`select erp_private.go_live_save(${day(-30)}::date,'Go-live happened 30 days ago')`);
 await sign('PARTNER','ASSISTANT_DATA_ENTRY');
 const re=await pol('ASSISTANT_DATA_ENTRY');assert.equal(re.status,'Signed_Off');assert.equal(re.d,day(365),'go-live plus 14 days has passed here, so the next review is one cycle (365 days) away');
 // 4. Clearing the go-live date pauses the timers again.
 await as('PARTNER',()=>tx`select erp_private.go_live_save(null,'Go-live postponed by the Partners')`);
 assert.equal((await pol('ASSISTANT_DATA_ENTRY')).d,null);assert.equal(await scan(),0);
});
test('screens and server show the review countdown, the go-live card and the lock banner',async()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
 const {reviewLine,goLiveCard}=await import('../staff-policies.mjs');
 assert.match(reviewLine({status:'Signed_Off',review_due_date:null,go_live_date:null}),/paused until Go-Live/);
 assert.match(reviewLine({status:'Signed_Off',review_due_date:'2026-11-26',go_live_date:'2026-11-12'},String,'2026-11-15'),/Review due in 11 days \(Based on Go-Live Date: 2026-11-12\)/);
 assert.match(reviewLine({status:'Expired',review_due_date:'2026-11-26'}),/Expired/);
 assert.equal(reviewLine({status:'Pending'}),'');
 assert.equal(goLiveCard({me:{category_code:'MANAGER'},policies:[]}),'');assert.match(goLiveCard({me:{category_code:'PARTNER'},policies:[]}),/Set go-live date/);
 assert.match(rd(fx+'policy-actions.ts'),/go_live_save/);assert.match(rd(fx+'policy-actions.ts'),/has expired/);assert.match(rd(fx+'holiday-actions.ts'),/lock_active/);assert.match(rd('staff-holidays.mjs'),/Compliance lock/);
});
