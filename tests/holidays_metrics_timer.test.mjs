// Build .106: Partner-only holiday calendar, firm and manager metrics, and manual time as the recorded time.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('Partner-only holidays that drive the clocks, scoped metrics, and manual time as the recorded time',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;


 for(const role of ['ASSISTANT','SUPERVISOR','PARTNER','MANAGER2'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;

 const rejects=(fn,re)=>assert.rejects(fn,re);
 const hol=(role,d,n,w,s)=>as(role,()=>tx`select erp_private.holiday_save(${d}::date,${n},${w},${s})`);
 // 1. Holidays: Partner only, a reason is mandatory, nothing is deleted, every change is audited.
 const seeded=await tx`select holiday_date::text d,name,is_working_day,confirmed from erp_private.public_holidays where holiday_date between '2026-01-01' and '2026-12-31' order by holiday_date`;
 const names=seeded.map(x=>x.name).join('|');
 for(const n of ['New Year','Good Friday','Easter Monday','Labour Day','Madaraka Day','Eid al-Fitr','Mashujaa Day','Jamhuri Day','Christmas','Boxing Day','Eid al-Adha'])assert.match(names,new RegExp(n),n+' is seeded for the year');
 assert.ok(seeded.every(x=>x.is_working_day===false),'seeded holidays are non-working by default');
 for(const role of ['MANAGER','SUPERVISOR','ASSISTANT'])await rejects(()=>hol(role,'2026-11-11','Fictional firm closure day',false,'Partner meeting minute 12'),/Only a Partner/);
 await rejects(()=>hol('PARTNER','2026-11-11','Fictional firm closure day',false,'short'),/at least 10 characters/);
 await hol('PARTNER','2026-11-11','Fictional firm closure day',false,'Partner meeting minute 12');
 const added=(await tx`select confirmed,confirmed_by,confirmed_at,source,is_working_day from erp_private.public_holidays where holiday_date='2026-11-11'`)[0];
 assert.equal(added.confirmed,true);assert.equal(added.confirmed_by,actors.PARTNER.staff_id);assert.ok(added.confirmed_at);assert.equal(added.is_working_day,false);
 await rejects(()=>tx`delete from erp_private.public_holidays where holiday_date='2026-11-11'`,/./);
 assert.ok((await tx`select 1 from erp_private.audit_events where table_name='public_holidays' and record_key='2026-11-11' limit 1`).length===1,'the new holiday is audit-logged');
 // 2. The clock follows is_working_day: a holiday pauses the timer, a holiday the firm works does not.
 const ws=async(a,b)=>Number((await tx`select erp_private.working_seconds(${a}::timestamptz,${b}::timestamptz) s`)[0].s);
 assert.equal(await ws('2026-11-11T04:00:00Z','2026-11-11T15:00:00Z'),0,'a non-working holiday counts nothing');
 await hol('PARTNER','2026-11-11','Fictional firm closure day',true,'Partners decided the firm works this day');
 assert.equal(await ws('2026-11-11T04:00:00Z','2026-11-11T15:00:00Z'),9*3600,'marked as a working day, the clock runs 08:00 to 17:00');
 assert.equal(await ws('2026-12-25T05:00:00Z','2026-12-25T14:00:00Z'),0,'Christmas is still a pause');
 await hol('PARTNER','2026-12-25','Christmas Day',true,'Firm on duty for year-end filing');
 assert.equal(await ws('2026-12-25T05:00:00Z','2026-12-25T14:00:00Z'),9*3600,'a seeded holiday can be turned into a working day');
 await hol('PARTNER','2026-12-25','Christmas Day',false,'Reverted: firm closed after all');
 assert.equal(await ws('2026-12-25T05:00:00Z','2026-12-25T14:00:00Z'),0);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where table_name='public_holidays'`)[0].n>0,true,'holiday changes are audit-logged');
 // The stuck-task scan and the pool read the same clock: no alert is raised for time that falls on a holiday.
 // 3. Metrics. A second client belongs to the Partner only, so Manager scope can be checked.
 const C2=id(),P2=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C2},'UAT Fictional Other Client Ltd',${actors.PARTNER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C2},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${C2},${F},'UAT Fictional other project','TAX-COMP',${actors.PARTNER.staff_id})`;
 await tx`insert into erp_private.staff_rates(staff_id,effective_from,effective_to,cost_rate,billable_rate,created_by) values(${actors.ASSISTANT.staff_id},'2020-01-01','2099-12-31',500,2000,${actors.PARTNER.staff_id})`;
 const TK=id(),TK2=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${TK},${P},${actors.ASSISTANT.staff_id},'Fictional billed work')`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P2},${actors.ASSISTANT.staff_id},${F},'ASSISTANT')`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${TK2},${P2},${actors.ASSISTANT.staff_id},'Fictional other work')`;
 const ts=(T,PR,h,bill,date)=>tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,reviewed_by,reviewed_at) values(${actors.ASSISTANT.staff_id},${PR},${T},${date},${h},'Fictional work done',${bill},'Approved',${actors.SUPERVISOR.staff_id},now())`;
 await ts(TK,P,10,true,'2026-11-02');await ts(TK,P,2,false,'2026-11-03');await ts(TK2,P2,5,true,'2026-11-04');
 let n=1;const inv=(PR,CL,net,vat,date,due,status='Posted')=>tx`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,invoice_number,description,invoice_date,due_date,lines,net_amount,vat_amount,status,created_by,posted_by,posted_at) values(${id()},${PR},${CL},${F},${'FICT-'+(n++)},'Fictional fee',${date},${due},'[]'::jsonb,${net},${vat},${status},${actors.PARTNER.staff_id},${status==='Posted'?actors.PARTNER2.staff_id:null},now()) returning invoice_id`;
 const day=k=>new Date(Date.now()+k*86400000).toISOString().slice(0,10);
 const [i1]=await inv(P,C,15000,2400,'2026-11-05',day(30));const [i2]=await inv(P2,C2,8000,1280,'2026-11-05',day(10));
 await inv(P,C,99999,0,'2026-11-05',day(30),'Void');await inv(P,C,70000,0,'2020-01-01',day(-120));
 await tx`insert into erp_private.payments(request_id,invoice_id,project_id,client_id,firm_id,receipt_number,payment_date,method,reference,amount,created_by) values(${id()},${i1.invoice_id},${P},${C},${F},'FICT-R1','2026-11-06','Bank','FICT-REF',5000,${actors.PARTNER.staff_id})`;
 const m=(role,a='2026-11-01',b='2026-11-30')=>as(role,async()=>(await tx`select erp_private.metrics_summary(${a}::date,${b}::date) m`)[0].m);
 const mm=await m('MANAGER');
 assert.equal(mm.scope,'clients you oversee');assert.equal(mm.client_count,1,'a Manager sees only the client they oversee');
 assert.equal(Number(mm.billed_net),15000,'net of VAT, Posted only, in the period; the Void invoice and the one outside the period are left out');
 assert.equal(Number(mm.standard_value),20000,'10 approved billable hours x 2000; the 2 non-billable hours add nothing');
 assert.equal(Number(mm.realization_pct),75,'15000 / 20000 x 100');
 assert.equal(Number(mm.cash_collected),5000);assert.equal(Number(mm.staff_cost),6000,'12 hours x 500 cost rate');assert.equal(Number(mm.gross_margin),9000,'billed net less staff cost, kept apart from realization');
 assert.equal(Number(mm.hours_without_rate),0);
 const pm=await m('PARTNER');
 assert.equal(pm.scope,'firm');assert.equal(pm.client_count,2);assert.equal(Number(pm.billed_net),23000);assert.equal(Number(pm.standard_value),30000);assert.equal(Number(pm.realization_pct),76.7);
 assert.equal(Number(pm.receivables_total),(15000+2400-5000)+(8000+1280)+70000,'receivables are Posted invoices less payments');
 assert.equal(Number(pm.ageing.not_due),(15000+2400-5000)+(8000+1280),'invoices not yet due');
 assert.equal(Number(pm.ageing.over_90),70000,'an invoice 120 days overdue is in the over 90 bucket');
 assert.equal(Object.values(pm.ageing).reduce((x,y)=>x+Number(y),0),Number(pm.receivables_total),'ageing buckets add up to receivables');
 for(const role of ['SUPERVISOR','ASSISTANT'])await rejects(()=>m(role),/Managers and Partners only/);
 await rejects(()=>m('PARTNER','2026-11-30','2026-11-01'),/valid period/);
 // an unrelated Manager sees nothing of either client
 const M3=id(),A3=id(),S3=id();await tx`insert into auth.users(id) values(${A3})`;await tx`insert into auth.sessions(id,user_id) values(${S3},${A3})`;
 await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${M3},${A3},'MANAGER3','manager3','Fictional MANAGER3','MANAGER','Permanent','2027-12-31','Active',now()-interval '1 day')`;
 await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${S3},${M3},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${M3},${F},'Assigned')`;
 actors.MANAGER3={staff_id:M3,auth_user_id:A3,session:S3,category_code:'MANAGER'};
 const m3=await m('MANAGER3');assert.equal(m3.client_count,0);assert.equal(Number(m3.billed_net),0);assert.equal(m3.realization_pct,null,'no standard value, no percentage');
 // 4. Timer is only a helper: the timesheet records the keyed hours and remembers any timer figure beside it.
 const ex=await tx`select column_name from information_schema.columns where table_schema='erp_private' and table_name='task_timers' and column_name in ('suggested_seconds','suggested_task_id','suggested_date')`;assert.equal(ex.length,3);
 await tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,timer_seconds,time_source) values(${actors.ASSISTANT.staff_id},${P},${TK},'2026-11-08',1.5,'Keyed 1.5 hours; timer said 1h 5m',true,'Draft',3900,'Manual with timer')`;
 const kt=(await tx`select hours,timer_seconds,time_source from erp_private.timesheets where description like 'Keyed 1.5%'`)[0];assert.equal(Number(kt.hours),1.5,'the keyed hours are the recorded time');assert.equal(kt.timer_seconds,3900);assert.equal(kt.time_source,'Manual with timer');
 await rejects(()=>tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,time_source) values(${actors.ASSISTANT.staff_id},${P},${TK},'2026-11-08',1,'Bad source',true,'Draft','Timer')`,/time_source/);
 assert.equal((await tx`select time_source from erp_private.timesheets where description='Fictional work done' limit 1`)[0].time_source,'Manual','entries without a timer are Manual');
});
test('screens and server expose holidays, metrics, the bell and manual time with a timer helper',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
 const presence=rd(fx+'presence-actions.ts'),ws=rd(fx+'workspace-actions.ts'),idx=rd(fx+'index.ts'),acl=rd(fx+'staff-access-control.mjs');
 assert.doesNotMatch(presence.slice(presence.indexOf('timer_stop')),/insert into erp_private\.timesheets/,'stopping a timer never creates a time entry');
 assert.match(presence,/suggested_seconds/);assert.match(ws,/timer_seconds/);assert.match(ws,/Manual with timer/);
 assert.match(idx,/holidayAction/);assert.match(idx,/metricsAction/);assert.match(acl,/holiday_/);assert.match(acl,/metrics_/);
 assert.match(rd(fx+'holiday-actions.ts'),/category_code!=='PARTNER'/);assert.match(rd(fx+'metrics-actions.ts'),/\['PARTNER','MANAGER'\]/);
});
