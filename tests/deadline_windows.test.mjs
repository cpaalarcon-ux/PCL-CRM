// Filing deadline windows (build 2710): the PAYE / VAT / Annual warning and late-alert matrix, its settings, the card figures and the nightly alert.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Filing deadline windows: matrix defaults, Partner-only changes, card figures and nightly alert',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id,AST=actors.ASSISTANT.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const A=await mk('UAT Fictional Services Ltd','A400000001Z'),B=await mk('UAT Fictional Traders Ltd','A400000002Z'),E=await mk('UAT Fictional Hauliers Ltd','A400000003Z');
 const T0=(await tx`select (now() at time zone 'Africa/Nairobi')::date::text d`)[0].d;
 const D=n=>{const x=new Date(T0+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 const PJ=await proj(A,'TAX-KRA');
 const mkTask=async(client,key,dueOffset,status='Pending',name)=>{const pr=client===A?PJ:await proj(client,'TAX-KRA');const t=id();await tx`insert into erp_private.tasks(task_id,project_id,task_name,due_at,status,template_key,recurring_key) values(${t},${pr},${name||('Fictional '+key)},(${D(dueOffset)}::date + time '12:00') at time zone 'Africa/Nairobi',${status},${key},${key+':'+t})`;return t;};
 await db.exec('alter table erp_private.tasks disable trigger user');
 const card=(role,ids)=>q(role,`select client_id,filing_soon,filing_soon_days,filing_late,filing_late_days from erp_private.client_card_flags($1::uuid[])`,[ids]);

 // ---- 1. The matrix is in the database with the Partner's values, as defaults not yet confirmed ----------------------------------------------------
 const rows=await tx`select setting_key,int_value,rule_status,confirmed_by from erp_private.deadline_settings order by setting_key`;
 assert.deepEqual(rows.map(r=>[r.setting_key,r.int_value]),[['annual_late_days',3],['annual_warn_days',14],['paye_late_days',3],['paye_warn_days',3],['vat_late_days',3],['vat_warn_days',5]]);
 assert.ok(rows.every(r=>r.rule_status==='Suggested'&&r.confirmed_by===null),'seeded as defaults; the confirmation is recorded by a Partner, never by the build');
 // ---- 2. Only a Partner changes a value; a change withdraws the confirmation; limits; no delete ------------------------------------------------------
 for(const role of ['MANAGER','SUPERVISOR','ASSISTANT']){const r=await db.query('select 1');await as(role,async()=>{await db.query(`update erp_private.deadline_settings set int_value=4 where setting_key='paye_warn_days'`);});}
 assert.equal((await tx`select int_value from erp_private.deadline_settings where setting_key='paye_warn_days'`)[0].int_value,3);
 await assert.rejects(q('PARTNER',`update erp_private.deadline_settings set int_value=0 where setting_key='paye_warn_days'`),/1 to 90/);
 await assert.rejects(q('PARTNER',`update erp_private.deadline_settings set int_value=61 where setting_key='vat_late_days'`),/1 to 60/);
 await assert.rejects(q('PARTNER',`update erp_private.deadline_settings set rule_status='Confirmed',confirmed_by=$1,source_note='short' where setting_key='vat_warn_days'`,[PT]),/at least 10/);
 await q('PARTNER',`update erp_private.deadline_settings set rule_status='Confirmed',confirmed_by=$1,source_note='Partner minute of 10 Nov 2026' where setting_key='vat_warn_days'`,[PT]);
 assert.equal((await tx`select rule_status from erp_private.deadline_settings where setting_key='vat_warn_days'`)[0].rule_status,'Confirmed');
 await q('PARTNER',`update erp_private.deadline_settings set int_value=6 where setting_key='vat_warn_days'`);
 const w=(await tx`select int_value,rule_status,confirmed_by,source_note from erp_private.deadline_settings where setting_key='vat_warn_days'`)[0];
 assert.deepEqual([w.int_value,w.rule_status,w.confirmed_by,w.source_note],[6,'Suggested',null,null],'changing a value withdraws the confirmation');
 await q('PARTNER',`update erp_private.deadline_settings set int_value=5 where setting_key='vat_warn_days'`);
 await assert.rejects(q('PARTNER',`delete from erp_private.deadline_settings where setting_key='vat_warn_days'`),/./);
 // ---- 3. The card: due soon inside the warning window of its own kind, late once past the due date -----------------------------------------------
 const H=await mk('UAT Fictional Window Client Ltd','A400000010Z');
 assert.deepEqual(await card('MANAGER',[H]),[{client_id:H,filing_soon:0,filing_soon_days:null,filing_late:0,filing_late_days:null}]);
 await mkTask(H,'monthly-paye',4);
 assert.equal((await card('MANAGER',[H]))[0].filing_soon,0,'PAYE due in 4 days is outside its 3-day window');
 const tPaye=await mkTask(H,'monthly-payroll',3);
 let h=(await card('MANAGER',[H]))[0];assert.deepEqual([h.filing_soon,h.filing_soon_days],[1,3],'PAYE/payroll due in 3 days is inside the 3-day window');
 await mkTask(H,'monthly-vat',5);
 h=(await card('MANAGER',[H]))[0];assert.deepEqual([h.filing_soon,h.filing_soon_days],[2,3],'VAT due in 5 days is inside the 5-day window; the nearest is 3 days');
 await mkTask(H,'monthly-vat',6,'Pending','VAT six days out');
 assert.equal((await card('MANAGER',[H]))[0].filing_soon,2,'VAT due in 6 days is outside the 5-day window');
 const K=await mk('UAT Fictional Annual Client Ltd','A400000011Z');
 await mkTask(K,'annual-compile',15);assert.equal((await card('MANAGER',[K]))[0].filing_soon,0,'annual due in 15 days is outside the 14-day window');
 await mkTask(K,'annual-review',14);assert.deepEqual([(await card('MANAGER',[K]))[0].filing_soon,(await card('MANAGER',[K]))[0].filing_soon_days],[1,14]);
 await mkTask(K,'weekly-sales',1);assert.equal((await card('MANAGER',[K]))[0].filing_soon,1,'weekly tasks have no window');
 await mkTask(K,'monthly-paye',0);assert.equal((await card('MANAGER',[K]))[0].filing_soon_days,0,'due today counts, with 0 days left');
 await mkTask(K,'monthly-vat',3,'Completed');await mkTask(K,'monthly-vat',3,'Cancelled');
 assert.equal((await card('MANAGER',[K]))[0].filing_soon,2,'completed and cancelled filings are not counted');
 // late
 await mkTask(H,'monthly-vat',-1);await mkTask(H,'monthly-paye',-4);
 h=(await card('PARTNER',[H]))[0];assert.deepEqual([h.filing_late,h.filing_late_days],[2,4],'any filing past its due date shows on the card; the most days late is shown');
 // a Partner change moves the late alert too
 await q('PARTNER',`update erp_private.deadline_settings set int_value=1 where setting_key='vat_late_days'`);
 assert.equal((await tx`select count(*)::int n from erp_private.filing_state() where filing_class='VAT' and days_left<0 and -days_left>=late_days`)[0].n,1);
 await q('PARTNER',`update erp_private.deadline_settings set int_value=3 where setting_key='vat_late_days'`);
 // a Partner change moves the window
 await q('PARTNER',`update erp_private.deadline_settings set int_value=4 where setting_key='paye_warn_days'`);
 assert.equal((await card('MANAGER',[H]))[0].filing_soon,3,'the PAYE window follows the Partner setting (now 4 days)');
 await q('PARTNER',`update erp_private.deadline_settings set int_value=3 where setting_key='paye_warn_days'`);
 // who gets the figures
 assert.equal((await card('SUPERVISOR',[H])).length,1);
 for(const role of ['ASSISTANT','INTERN'])assert.deepEqual(await card(role,[H]),[],role+' gets no card facts');
 // ---- 4. The nightly alert: once per Partner per filing, at the late-alert days, nothing locked --------------------------------------------------
 const before=(await tx`select count(*)::int n from erp_private.notifications`)[0].n;
 const n1=(await tx`select erp_private.filing_late_scan() n`)[0].n;
 assert.equal(n1,2,'both Partners are alerted about the one filing that is at least 3 days late (the 4-day-late PAYE); the 1-day-late VAT filing waits');
 assert.equal((await tx`select count(*)::int n from erp_private.notifications`)[0].n,before+2);
 assert.equal((await tx`select erp_private.filing_late_scan() n`)[0].n,0,'running it again alerts nobody twice');
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where message like '%days late%' and recipient_id=${actors.MANAGER.staff_id}`)[0].n,0,'only Partners are alerted');
 assert.equal((await tx`select count(*)::int n from erp_private.tasks where status not in('Completed','Cancelled') and template_key like 'monthly-%'`)[0].n>0,true);
 // ---- 5. Closed doors ------------------------------------------------------------------------------------------------------------------------------
 assert.deepEqual((await tx`select has_function_privilege('anon','erp_private.client_card_flags(uuid[])','execute') a,has_function_privilege('erp_api','erp_private.client_card_flags(uuid[])','execute') b,has_function_privilege('erp_api','erp_private.filing_state(uuid[])','execute') c,has_function_privilege('erp_api','erp_private.filing_late_scan()','execute') d,has_function_privilege('erp_api','erp_private.deadline_int(text)','execute') e`)[0],{a:false,b:true,c:false,d:false,e:false});
 assert.equal((await tx`select count(*)::int n from erp_private.deadline_settings where label ~* 'ISRS 4000'`)[0].n,0);
});
