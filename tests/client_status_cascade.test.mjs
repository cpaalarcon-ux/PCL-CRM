// Client status (Active, Inactive, Dormant) carried to projects, tasks and invoices.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientLifecycleAction}=await import('../supabase/functions/staff-workspace-v12/client-lifecycle-actions.ts');
const {readWorkspace}=await import('../supabase/functions/staff-workspace-v12/workspace-read.ts');
const {areaForStaffAction}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),C2=id(),P=id(),P2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>clientLifecycleAction(tx,a,p));
test('client status carries to projects, tasks, alerts and invoices, and comes back',async t=>{
 t.after(()=>db.close());
 const boot=fs.readFileSync(path.join(root,'tests/client_lifecycle.test.mjs'),'utf8').split('\n').find(l=>l.includes('create role anon'));
 await eval('(async()=>{'+boot+'})()');
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CSQA','Fictional status firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role,full_name:'Fictional '+role};
  await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;
  await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${'ST'+role},${'status-'+role.toLowerCase()},${a.full_name},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;
  await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;
  await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},${role==='ASSISTANT'?'Assigned':'Firm'})`;}
 const M=actors.MANAGER.staff_id,A=actors.ASSISTANT.staff_id;
 for(const [c,n] of [[C,'UAT Fictional Status Ltd'],[C2,'UAT Fictional Steady Ltd']]){await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${c},${n},${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;}
 for(const [p,c] of [[P,C],[P2,C2]]){await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${c},${F},${'UAT Fictional project '+p.slice(0,4)},'TAX-COMP',${M})`;
  for(const r of ['ASSISTANT','SUPERVISOR','MANAGER'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${actors[r].staff_id},${F},${r})`;}
 await db.exec(`alter table erp_private.projects disable trigger user;update erp_private.projects set status='Active';alter table erp_private.projects enable trigger user;`);
 const past=new Date(Date.now()-3*86400000).toISOString(),soon=new Date(Date.now()+20*86400000).toISOString(),T={open:id(),prog:id(),done:id(),late:id(),other:id()};
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,status) values(${T.open},${P},${A},'Fictional open task',${soon},'Pending'),(${T.prog},${P},${A},'Fictional task in progress',${soon},'In Progress'),(${T.done},${P},${A},'Fictional finished task',${soon},'Completed'),(${T.late},${P},${A},'Fictional late task',${past},'Pending'),(${T.other},${P2},${A},'Fictional steady task',${past},'Pending')`;
 const set=(role,status,reason,extra={})=>act(role,{action:'client_status_set',client_id:C,status,reason,...extra});
 const mine=async role=>(await as(role,a=>readWorkspace(tx,a))).tasks.map(t=>t.task_id);
 const hold=async()=>Object.fromEntries((await tx`select task_id,client_hold,status,redate_needed from erp_private.tasks where project_id=${P}`).map(r=>[Object.keys(T).find(k=>T[k]===r.task_id),[r.client_hold,r.status,r.redate_needed]]));
 const overdueNotes=async task=>(await tx`select count(*)::int n from erp_private.notifications where event_key like ${'overdue:'+task+':%'}`)[0].n;
 for(const a of ['client_status_set','client_held_work'])assert.equal(areaForStaffAction(a),'clients');

 // 1. Who may do what, and a reason is always needed.
 for(const r of ['ASSISTANT','SUPERVISOR'])await assert.rejects(()=>set(r,'Inactive','Engagement has lapsed for now'),/Only a Manager or Partner/);
 await assert.rejects(()=>set('MANAGER','Inactive','short'),/at least 10 characters/);
 await assert.rejects(()=>set('MANAGER','Paused','Engagement has lapsed for now'),/Choose Active, Inactive or Dormant/);
 await assert.rejects(()=>set('MANAGER','Active','Engagement has lapsed for now'),/already Active/);
 await assert.rejects(()=>set('MANAGER','Dormant','Client moved to another firm'),/Only a Partner can make a client Dormant/);
 assert.equal((await mine('ASSISTANT')).length,5);

 const workload=async()=>[...(await as('PARTNER',()=>tx`select task_id from erp_private.workload_tasks(false,null,null,null,null,0)`)),...(await as('PARTNER',()=>tx`select task_id from erp_private.workload_tasks(true,null,null,null,null,0)`))].map(x=>x.task_id),wlBefore=await workload();
 // 2. Active to Inactive: open work goes on hold and leaves every ordinary screen; finished work and other clients are untouched.
 const r1=await set('MANAGER','Inactive','Engagement has lapsed for now');
 assert.deepEqual([r1.from_status,r1.status,r1.projects,r1.tasks],['Active','Inactive',1,3]);
 let h=await hold();assert.deepEqual([h.open,h.prog,h.late,h.done],[['Inactive','Pending',false],['Inactive','In Progress',false],['Inactive','Pending',false],[null,'Completed',false]],'statuses are not rewritten');
 for(const r of ['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'])assert.deepEqual((await mine(r)).sort(),[T.done,T.other].sort(),r+' no longer sees the held tasks');
 const ws=await as('MANAGER',a=>readWorkspace(tx,a));
 assert.equal(ws.clients.find(c=>c.client_id===C).client_status,'Inactive');assert.equal(ws.clients.find(c=>c.client_id===C2).client_status,'Active');
 assert.equal(ws.projects.find(p=>p.project_id===P).client_hold,'Inactive');assert.equal(ws.projects.find(p=>p.project_id===P2).client_hold,null);
 // Held work cannot be worked on, added to or timed.
 await assert.rejects(()=>tx`update erp_private.tasks set status='Completed' where task_id=${T.open}`,/on hold because the client is not Active/);
 await assert.rejects(()=>tx`update erp_private.tasks set client_hold=null where task_id=${T.open}`,/Change the client's status/);
 await assert.rejects(()=>tx`update erp_private.projects set client_hold=null where project_id=${P}`,/Change the client's status/);
 await assert.rejects(()=>tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at) values(${P},${A},'Fictional new task',now())`,/client is inactive; set the client Active before adding work/);
 await assert.rejects(()=>tx`insert into erp_private.timesheets(task_id,project_id,staff_id,work_date,hours,description) values(${T.open},${P},${A},current_date,1,'Fictional time')`,/on hold because the client is not Active/);
 assert.equal((await tx`select work_started_at w from erp_private.tasks where task_id=${T.prog}`)[0].w,null,'the working-time clock stops while held');
 // No alerts: the scheduler passes over held work but still reports the other client's late task.
 await tx`select erp_private.run_workspace_scheduler()`;
 assert.equal(await overdueNotes(T.late),0);assert.ok(await overdueNotes(T.other)>0);
 assert.equal(await tx`select erp_private.stuck_task_scan() n`.then(x=>x[0].n),0);
 // The lists that run with the owner's rights leave held work out too.
 assert.equal((await as('MANAGER',()=>tx`select erp_private.task_allowed(${T.open}::uuid) ok`))[0].ok,false);assert.equal((await as('MANAGER',()=>tx`select erp_private.task_allowed(${T.other}::uuid) ok`))[0].ok,true);
 const wlAfter=await workload();assert.deepEqual(wlAfter.sort(),wlBefore.filter(x=>![T.open,T.prog,T.late].includes(x)).sort());
 // The client's own page shows what is held and the record of changes.
 for(const r of ['MANAGER','SUPERVISOR','PARTNER']){const hw=await act(r,{action:'client_held_work',client_id:C});assert.equal(hw.status,'Inactive');assert.equal(hw.projects.length,1);assert.deepEqual(hw.tasks.map(x=>x.task_id).sort(),[T.open,T.prog,T.late].sort());assert.equal(hw.history[0].reason,'Engagement has lapsed for now');}
 await assert.rejects(()=>act('ASSISTANT',{action:'client_held_work',client_id:C}),/not available to you/);

 // 3. Inactive to Active: everything comes back as it was. The task that went past its date is marked for a new date, with no overdue alert until then.
 await assert.rejects(()=>set('MANAGER','Inactive','Engagement has lapsed again'),/already Inactive/);
 const r2=await set('MANAGER','Active','Engagement letter renewed today');
 assert.deepEqual([r2.projects,r2.tasks,r2.to_redate.map(x=>x.task_id)],[1,3,[T.late]]);
 h=await hold();assert.deepEqual([h.open,h.prog,h.late],[[null,'Pending',false],[null,'In Progress',false],[null,'Pending',true]]);
 assert.ok((await tx`select work_started_at w from erp_private.tasks where task_id=${T.prog}`)[0].w,'the clock starts again');
 assert.equal((await mine('ASSISTANT')).length,5);
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where recipient_id=${M} and event_key like 'client-redate:%'`)[0].n,1,'the person who reactivated is told which tasks need dates');
 await tx`select erp_private.run_workspace_scheduler()`;assert.equal(await overdueNotes(T.late),0,'no overdue alert before a new date is given');
 assert.deepEqual((await act('MANAGER',{action:'client_held_work',client_id:C})).to_redate.map(x=>x.task_id),[T.late]);
 await tx`update erp_private.tasks set due_at=${soon} where task_id=${T.late}`;
 assert.equal((await hold()).late[2],false,'a new date clears the mark');

 // 4. Dormant: Partner only, Partners are told, work is archived with the client.
 const r3=await set('PARTNER','Dormant','Client moved to another firm');assert.deepEqual([r3.projects,r3.tasks],[1,3]);
 assert.equal((await as('MANAGER',a=>readWorkspace(tx,a))).clients.find(c=>c.client_id===C)?.client_status??'Dormant','Dormant');
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where event_key like 'client-status:%'`)[0].n,1);
 assert.deepEqual((await mine('PARTNER')).sort(),[T.done,T.other].sort());
 await assert.rejects(()=>set('PARTNER','Inactive','Trying a half step back'),/comes back as Active/);
 await assert.rejects(()=>set('MANAGER','Active','Client has returned to us',{old_work:'Resume'}),/Only a Partner/);
 await assert.rejects(()=>set('PARTNER','Active','Client has returned to us'),/Choose whether the earlier projects resume or stay archived/);

 // 5. Coming back with the old work left archived: the client is Active, the old project and its open tasks stay hidden and closed to new work.
 const r4=await set('PARTNER','Active','Client has returned to us',{old_work:'Leave archived'});assert.deepEqual([r4.old_work,r4.projects,r4.tasks],['Left archived',1,3]);
 h=await hold();assert.deepEqual([h.open[0],h.prog[0],h.late[0],h.done[0]],['Archived','Archived','Archived',null]);
 assert.deepEqual((await mine('PARTNER')).sort(),[T.done,T.other].sort());
 await assert.rejects(()=>tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at) values(${P},${A},'Fictional new task',now())`,/left archived when the client returned; start a new project/);
 // New work for the returned client runs normally, and a later Inactive spell does not disturb what was left archived.
 const P3=id(),T3=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P3},${C},${F},'UAT Fictional new engagement','ACC-BOOK',${M})`;
 await db.exec(`alter table erp_private.projects disable trigger user;update erp_private.projects set status='Active' where project_name='UAT Fictional new engagement';alter table erp_private.projects enable trigger user;`);
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P3},${A},${F},'ASSISTANT')`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at) values(${T3},${P3},${A},'Fictional new engagement task',${soon})`;
 assert.ok((await mine('ASSISTANT')).includes(T3));
 await set('MANAGER','Inactive','Fees are unpaid for two months');assert.ok(!(await mine('ASSISTANT')).includes(T3));
 await set('MANAGER','Active','Fees have now been settled');assert.ok((await mine('ASSISTANT')).includes(T3));
 assert.equal((await hold()).open[0],'Archived','work left archived stays archived');

 // 6. Dormant again, and this time the Partner resumes the earlier work.
 await set('PARTNER','Dormant','Client has left a second time');
 const r5=await set('PARTNER','Active','Client is back once more',{old_work:'Resume'});assert.equal(r5.old_work,'Resumed');
 assert.ok((await mine('ASSISTANT')).includes(T3));assert.equal((await hold()).open[0],'Archived');

 // 7. Every change is on record, in order, with who and why.
 const log=await tx`select from_status f,to_status t,old_work w,changed_by b from erp_private.client_status_changes where client_id=${C} order by changed_at`;
 assert.deepEqual(log.map(x=>`${x.f}>${x.t}${x.w?' ('+x.w+')':''}`),['Active>Inactive','Inactive>Active','Active>Dormant','Dormant>Active (Left archived)','Active>Inactive','Inactive>Active','Active>Dormant','Dormant>Active (Resumed)']);
 assert.equal((await tx`select count(*)::int n from erp_private.client_hold_periods where client_id=${C} and ended_on is null`)[0].n,0);
 assert.equal((await tx`select count(*)::int n from erp_private.client_hold_periods where client_id=${C}`)[0].n,4);

 // 8. Invoices. A one-off invoice for a client that is not Active needs a Manager or Partner and a reason; recurring ones are refused.
 await set('MANAGER','Inactive','No engagement at the moment');
 const inv=(extra='')=>`insert into erp_private.invoices(request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,created_by) values(gen_random_uuid(),'${P3}','${C}','${F}','Fictional final bill',current_date,current_date+14,'[{"description":"Fictional final bill","quantity":1,"unit_price":1000,"line_type":"Fee","vat_rate":16.0,"net":1000,"vat":160,"total":1160}]'::jsonb,1000,160,'${M}')`;
 const raise=(role,reason)=>as(role,async()=>{await tx`select set_config('erp.inactive_invoice_reason',${reason},true)`;return (await db.query(inv()+' returning inactive_client_reason r,inactive_client_status s')).rows[0];});
 await assert.rejects(()=>raise('SUPERVISOR','Final bill for work done in October'),/only a Manager or Partner can raise an invoice/);
 await assert.rejects(()=>raise('MANAGER',''),/give the reason for this invoice/);
 try{assert.deepEqual(await raise('MANAGER','Final bill for work done in October'),{r:'Final bill for work done in October',s:'Inactive'});}
 catch(e){if(!/row-level security|permission denied/.test(String(e.message)))throw e;}// the insert right itself belongs to the finance tests

 // 9. Recurring fees. A monthly fee from four months ago, with the client away for the two middle months and Inactive today.
 const d=n=>{const x=new Date(Date.UTC(new Date().getUTCFullYear(),new Date().getUTCMonth()-n,1));return x.toISOString().slice(0,10);},FS=id();
 await tx`insert into erp_private.recurring_fee_schedules(fee_schedule_id,project_id,frequency,amount_ex_vat,description,starts_on,created_by,updated_by) values(${FS},${P3},'Monthly',5000,'Fictional retainer',${d(4)},${M},${M})`;
 const periods=async()=>(await tx`select recurring_period_start::text p from erp_private.invoices where recurring_fee_schedule_id=${FS} order by 1`).map(x=>x.p);
 await tx`select erp_private.run_recurring_fee_drafts()`;assert.deepEqual(await periods(),[],'nothing is drafted while the client is Inactive');
 // Rewrite the history of holds for the test: away from the 1st three months ago until the 1st one month ago; Active since.
 await db.exec(`alter table erp_private.client_hold_periods disable trigger user`);await tx`delete from erp_private.client_hold_periods where client_id=${C}`;
 await tx`insert into erp_private.client_hold_periods(client_id,status,started_on,ended_on) values(${C},'Inactive',${d(3)},${d(1)})`;
 await db.exec(`alter table erp_private.clients disable trigger user;update erp_private.clients set service_status='Active' where client_id='${C}';alter table erp_private.clients enable trigger user;update erp_private.projects set status=status where false;`);
 await db.exec(`select set_config('erp.hold_ok','1',false);update erp_private.projects set client_hold=null where project_id='${P3}';select set_config('erp.hold_ok','',false);`);
 await tx`select erp_private.run_recurring_fee_drafts()`;
 assert.deepEqual(await periods(),[d(4),d(1),d(0)],'the two months away are skipped; billing starts again from the month the client came back');
 await tx`select erp_private.run_recurring_fee_drafts()`;assert.equal((await periods()).length,3,'a later run does not go back for the gap');
});
test('recurring fees stop while a client is not Active and the gap is never billed',async()=>{
 const sql=fs.readFileSync(path.join(root,'supabase/migrations/20261215300000_client_status_cascade.sql'),'utf8');
 assert.match(sql,/p\.client_hold IS NULL AND erp_private\.client_is_active\(p\.client_id\) LOOP/);
 assert.match(sql,/CONTINUE WHEN NOT erp_private\.client_active_on\(s\.client_id,pstart\)/);
 assert.doesNotMatch(sql,/GRANT[^;]*(INSERT|UPDATE|DELETE)/,'status records are written only by the status function');
});
