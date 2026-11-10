// Filing windows counted from the statutory return due date; the internal firm deadline drives the Urgent alert (build 2750).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Statutory due date windows and the internal Urgent alert',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id,AST=actors.ASSISTANT.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const T0=(await tx`select (now() at time zone 'Africa/Nairobi')::date::text d`)[0].d;
 const D=n=>{const x=new Date(T0+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 await db.exec('alter table erp_private.tasks disable trigger user');
 const card=(role,ids)=>q(role,`select client_id,filing_soon,filing_soon_days,filing_late,filing_late_days from erp_private.client_card_flags($1::uuid[])`,[ids]);
 const A=await mk('UAT Fictional Statutory Client Ltd','A400000020Z'),PJ=await proj(A,'TAX-KRA');
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${PJ},${AST},${F},'ASSISTANT')`;
 let n=0;
 // a filing task in a monthly work period whose client period carries the statutory and internal dates
 const filing=async(key,taskDue,statutory,internal,assigned=null)=>{n++;const t=id(),w=id(),s=`2026-${String(n).padStart(2,'0')}-01`,e=`2026-${String(n).padStart(2,'0')}-28`;
  await tx`insert into erp_private.tasks(task_id,project_id,task_name,due_at,status,template_key,recurring_key,assigned_to) values(${t},${PJ},${'Fictional '+key+' '+n},(${D(taskDue)}::date + time '12:00') at time zone 'Africa/Nairobi','Pending',${key},${key+':'+t},${assigned})`;
  await tx`insert into erp_private.project_work_periods(work_period_id,project_id,period_kind,starts_on,ends_on) values(${w},${PJ},'Monthly',${s},${e})`;
  await tx`insert into erp_private.work_period_tasks(task_id,work_period_id) values(${t},${w})`;
  if(statutory!==null)await tx`insert into erp_private.client_periods(client_id,starts_on,ends_on,return_due_date,internal_due_date,deadline_rule_reference,created_by) values(${A},${s},${e},${D(statutory)},${internal===null?null:D(internal)},'Fictional statutory calendar note',${M})`;
  return t;};
 const st=t=>tx`select * from erp_private.filing_state() where task_id=${t}`.then(r=>r[0]);
 // ---- 1. The window follows the statutory date, not the task's own date --------------------------------------------------------------------------------
 const t1=await filing('monthly-vat',-2,4,null);   // task date already passed, KRA date in 4 days
 let s=await st(t1);assert.deepEqual([s.due_source,s.days_left,s.internal_due_date===null?null:'x'],['PERIOD',4,'x'],'days left count from the KRA date; the task date becomes the internal date');
 let c=(await card('MANAGER',[A]))[0];assert.deepEqual([c.filing_soon,c.filing_soon_days,c.filing_late],[1,4,0],'VAT due on the KRA date in 4 days is inside the 5-day window and is not late');
 const t2=await filing('monthly-vat',0,6,null);
 c=(await card('MANAGER',[A]))[0];assert.deepEqual([c.filing_soon,c.filing_late],[1,0],'KRA date 6 days away is outside the 5-day window, even though the task date is today');
 const t3=await filing('monthly-paye',5,-4,null);
 c=(await card('PARTNER',[A]))[0];assert.deepEqual([c.filing_late,c.filing_late_days],[1,4],'a KRA date that has passed is late, whatever the task date says');
 // ---- 2. No statutory date recorded: the earlier behaviour, labelled ----------------------------------------------------------------------------------------
 const t4=await filing('monthly-vat',3,null,null);
 s=await st(t4);assert.deepEqual([s.due_source,s.days_left,s.internal_due_date,s.internal_days_left],['TASK',3,null,null],'without a period date the task date is used and no internal date is claimed');
 c=(await card('MANAGER',[A]))[0];assert.equal(c.filing_soon,2);
 // a task outside any work period behaves the same
 const lone=id();await tx`insert into erp_private.tasks(task_id,project_id,task_name,due_at,status,template_key,recurring_key) values(${lone},${PJ},'Fictional lone annual',(${D(10)}::date + time '12:00') at time zone 'Africa/Nairobi','Pending','annual-compile',${'annual-compile:'+lone})`;
 assert.equal((await st(lone)).due_source,'TASK');
 // ---- 3. The late alert goes by the KRA date -----------------------------------------------------------------------------------------------------------------------
 const before=(await tx`select count(*)::int n from erp_private.notifications`)[0].n;
 assert.equal((await tx`select erp_private.filing_late_scan() n`)[0].n,2,'the KRA date 4 days past (late alert at 3 days) alerts both Partners; the task whose own date is merely near does not');
 assert.equal((await tx`select count(*)::int n from erp_private.notifications`)[0].n,before+2);
 // ---- 4. The internal deadline drives the Urgent alert ---------------------------------------------------------------------------------------------------------
 const u1=await filing('monthly-vat',0,3,0,AST);          // internal date today, KRA date in 3 days -> urgent
 const u2=await filing('monthly-vat',5,8,5,AST);          // internal date still ahead -> not urgent
 const u3=await filing('monthly-vat',-1,-1,-1,AST);       // KRA date already passed -> late, not urgent
 const u4=await filing('monthly-vat',-1,3,-2,null);       // urgent but nobody assigned -> nobody to tell
 const sentU=(await tx`select erp_private.filing_urgent_scan() n`)[0].n;
 assert.equal(sentU,1,'only the assigned, internally due, not-yet-late filing is urgent');
 const note=(await tx`select recipient_id,task_id,message from erp_private.notifications where event_key like 'filing-urgent:%'`);
 assert.deepEqual([note.length,note[0].recipient_id===AST,note[0].task_id===u1],[1,true,true]);
 assert.match(note[0].message,/URGENT: .* reached the firm's internal deadline/);
 assert.equal((await tx`select erp_private.filing_urgent_scan() n`)[0].n,0,'running it again alerts nobody twice');
 assert.equal((await tx`select status from erp_private.tasks where task_id=${u1}`)[0].status,'Pending','nothing is blocked or changed');
 // an explicit internal date on the period wins over the task date
 const u5=await filing('monthly-vat',9,12,-1,AST);
 s=await st(u5);assert.deepEqual([s.internal_days_left,s.days_left],[-1,12]);
 assert.equal((await tx`select erp_private.filing_urgent_scan() n`)[0].n,1);
 // ---- 5. Closed doors and defaults ------------------------------------------------------------------------------------------------------------------------------
 const priv=(await tx`select has_function_privilege('anon','erp_private.filing_urgent_scan()','execute') a,has_function_privilege('erp_api','erp_private.filing_urgent_scan()','execute') b,has_function_privilege('erp_api','erp_private.filing_state(uuid[])','execute') c`)[0];
 assert.deepEqual([priv.a,priv.b,priv.c],[false,false,false]);
 assert.deepEqual((await tx`select setting_key,int_value from erp_private.deadline_settings order by setting_key`).map(r=>r.int_value),[3,14,3,3,3,5],'warning and late day counts are unchanged');
 assert.ok((await tx`select rule_status from erp_private.deadline_settings`).every(r=>r.rule_status==='Suggested'));
});
