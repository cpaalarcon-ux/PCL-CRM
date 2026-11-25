import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const activate=async pid=>{await db.exec('set session_replication_role=replica');await db.query(`update erp_private.projects set status='Active' where project_id=$1`,[pid]);await db.exec('reset session_replication_role');};
const q=(role,sql,...v)=>as(role,async()=>(await db.query(sql,v)).rows);
test('monthly work period: four weekly clearances, then extra tasks, then a locked month',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const s=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(s);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional firm')`;
 for(const [key,cat] of [['PARTNER','PARTNER'],['MANAGER','MANAGER'],['MANAGER2','MANAGER'],['SUPERVISOR','SUPERVISOR'],['ASSISTANT','ASSISTANT'],['INTERN','INTERN']]){const a=actors[key]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${key},${key.toLowerCase()},${'Fictional '+key},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,entity_evidence,year_end_month,year_end_day,opening_balance_status,opening_balance_note,opening_balance_confirmed_by,opening_balance_confirmed_at) values(${C},'Fictional client',${actors.ASSISTANT.staff_id},'Limited company','Certificate of incorporation sighted',12,31,'No opening balances','New company, no opening balances',${actors.PARTNER.staff_id},now())`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id,status) values(${P},${C},${F},'Fictional tax engagement','TAX-COMP',${actors.MANAGER.staff_id},'Draft')`;await activate(P);
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors.SUPERVISOR.staff_id},${F},'SUPERVISOR')`;
 const A=actors.ASSISTANT.staff_id,month='2026-12-01';
 // Opening: leaders only, and the preparer must be an Assistant.
 await assert.rejects(()=>q('ASSISTANT','select erp_private.month_open($1,$2,$3)',P,month,A),/Partner, Manager or Supervisor/);
 await assert.rejects(()=>q('MANAGER','select erp_private.month_open($1,$2,$3)',P,month,actors.MANAGER2.staff_id),/Assistant/);
 const wp=(await q('MANAGER','select erp_private.month_open($1,$2,$3) w',P,month,A))[0].w;
 assert.equal((await q('MANAGER','select erp_private.month_open($1,$2,$3) w',P,month,A))[0].w,wp,'opening twice gives the same month');
 let ov=(await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o[0];
 assert.equal(ov.cleared,0);assert.equal(ov.weeks.length,1,'week 1 is created when the month opens');assert.equal(ov.weeks[0].week_no,1);
 const w1=ov.weeks[0].task_id;
 // Repeated clicks make no second week while week 1 is not cleared.
 for(let i=0;i<3;i++)assert.equal((await q('MANAGER','select erp_private.month_new_week($1) t',wp))[0].t,w1);
 assert.equal((await tx`select count(*)::int n from erp_private.work_period_weeks`)[0].n,1);
 // Extra tasks wait for the four clearances.
 await assert.rejects(()=>q('MANAGER',`select erp_private.month_add_task($1,'Extra reconciliation','2026-12-20',$2)`,wp,A),/four weekly/);
 // Only the assigned Assistant submits, with the whole checklist.
 await assert.rejects(()=>q('SUPERVISOR',`select erp_private.month_week_submit($1,'{}')`,w1),/assigned/);
 await assert.rejects(()=>q('ASSISTANT',`select erp_private.month_week_submit($1,'{"sales":true}')`,w1),/Tick every/);
 const all='{"sales":true,"purchases":true,"bank":true,"mapping":true,"review":true,"reporting":true}';
 await assert.rejects(()=>q('MANAGER',`select erp_private.month_week_clear($1,true)`,w1),/not submitted/);
 await q('ASSISTANT',`select erp_private.month_week_submit($1,$2::jsonb)`,w1,all);
 // Independent clearance: an Assistant cannot clear; a reviewer returns with a note, the preparer resubmits.
 await assert.rejects(()=>q('ASSISTANT',`select erp_private.month_week_clear($1,true)`,w1),/Partner, Manager or Supervisor/);
 await assert.rejects(()=>q('SUPERVISOR',`select erp_private.month_week_clear($1,false,'short')`,w1),/at least 10/);
 await q('SUPERVISOR',`select erp_private.month_week_clear($1,false,'Bank reconciliation is missing March')`,w1);
 assert.equal((await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o[0].cleared,0,'a returned week does not count');
 await q('ASSISTANT',`select erp_private.month_week_submit($1,$2::jsonb)`,w1,all);
 // The database itself refuses a clearance by the submitter even if a screen forgot to check.
 await assert.rejects(()=>tx`update erp_private.work_period_weeks set status='Cleared',cleared_by=${A},cleared_at=now() where task_id=${w1}`,/different reviewer|cleared_by/);
 await q('SUPERVISOR',`select erp_private.month_week_clear($1,true)`,w1);
 ov=(await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o[0];assert.equal(ov.cleared,1);
 // Cancelled or ordinary tasks never count; each next week appears only after the previous is cleared, once.
 for(let n=2;n<=4;n++){
  const wk=(await q('MANAGER','select erp_private.month_new_week($1) t',wp))[0].t;
  assert.equal((await q('MANAGER','select erp_private.month_new_week($1) t',wp))[0].t,wk);
  assert.equal((await tx`select count(*)::int n from erp_private.work_period_weeks`)[0].n,n);
  assert.equal((await tx`select week_no from erp_private.work_period_weeks where task_id=${wk}`)[0].week_no,n);
  await q('ASSISTANT',`select erp_private.month_week_submit($1,$2::jsonb)`,wk,all);await q('MANAGER',`select erp_private.month_week_clear($1,true)`,wk);
 }
 ov=(await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o[0];assert.equal(ov.cleared,4);assert.equal(ov.can_add_extra,true);
 assert.equal((await q('MANAGER','select erp_private.month_new_week($1) t',wp)).length,1,'a fifth call creates nothing new');
 assert.equal((await tx`select count(*)::int n from erp_private.work_period_weeks`)[0].n,4);
 // Extra tasks: any number, assigned to an Assistant only.
 await q('SUPERVISOR',`select erp_private.month_add_task($1,'Late sales invoices','2026-12-22',$2)`,wp,A);
 await q('MANAGER',`select erp_private.month_add_task($1,'Payroll tie-out','2026-12-23',$2)`,wp,A);
 await assert.rejects(()=>q('MANAGER',`select erp_private.month_add_task($1,'Manager task','2026-12-23',$2)`,wp,actors.MANAGER.staff_id),/Assistant/);
 assert.equal((await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o[0].extra_tasks,2);
 // Month-end flag for a month with fewer than four clearances.
 const wpOld=(await q('MANAGER','select erp_private.month_open($1,$2,$3) w',P,'2026-01-01',A))[0].w;
 const old=(await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o.find(x=>x.work_period_id===wpOld);assert.match(old.flag,/Fewer than four/);
 // A second record for the same client and month needs a documented reason and a Manager or Partner.
 const P2=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id,status) values(${P2},${C},${F},'Second engagement','TAX-COMP',${actors.MANAGER.staff_id},'Draft')`;await activate(P2);await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P2},${actors.SUPERVISOR.staff_id},${F},'SUPERVISOR')`;
 await assert.rejects(()=>q('MANAGER','select erp_private.month_open($1,$2,$3)',P2,month,A),/second one/);
 await assert.rejects(()=>q('SUPERVISOR','select erp_private.month_open($1,$2,$3,$4)',P2,month,A,'Client uses two engagements by agreement'),/Manager or Partner/);
 await q('MANAGER','select erp_private.month_open($1,$2,$3,$4)',P2,month,A,'Client uses two engagements by agreement');
 // The lock: a filing record that covers the month closes it; ordinary tasks are refused; only a supplementary task under an open amendment is accepted.
 const case0=id(),manager=actors.MANAGER.staff_id,partner=actors.PARTNER.staff_id;
 await tx`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,status,prepared_by,reviewed_by,review_snapshot,reviewed_at,filing_date) values(${case0},${P},'VAT','2026-12-01','2026-12-31','Filed',${A},${manager},'{}'::jsonb,now(),'2027-01-15')`.catch(async e=>{console.log('tax_cases insert needs more columns: '+e.message);throw e;});
 await tx`insert into erp_private.tax_filings(case_id,project_id,client_id,kind,starts_on,ends_on,prepared_by,filed_on,itax_reference,acknowledgement_status,recorded_by,legacy) values(${case0},${P},${C},'VAT','2026-12-01','2026-12-31',${A},'2027-01-15','ITAX0001','ACKNOWLEDGEMENT_RECEIVED',${partner},true)`;
 assert.equal((await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o.find(x=>x.work_period_id===wp).closed,true);
 await assert.rejects(()=>q('MANAGER',`select erp_private.month_add_task($1,'Another task','2027-01-20',$2)`,wp,A),/closed/);
 await assert.rejects(()=>q('MANAGER',`select erp_private.month_new_week($1)`,wp),/closed/);
 await assert.rejects(()=>tx`insert into erp_private.tasks(project_id,assigned_to,task_name,due_at) values(${P},${A},'Side door','2026-12-30T17:00:00+03:00')`,/closed/);
 // Late iTax data: a supplementary task under an open amendment, linked to the original month.
 const amend=id();await tx`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,status,prepared_by,amends_case_id,amendment_no,amendment_reason) values(${amend},${P},'VAT','2026-12-01','2026-12-31','Draft',${A},${case0},1,'Late iTax invoices were found')`;
 const sup=(await q('MANAGER',`select erp_private.month_add_task($1,'Late iTax invoices','2027-01-20',$2,$3) t`,wp,A,amend))[0].t;
 assert.equal((await tx`select task_kind from erp_private.work_period_tasks where task_id=${sup}`)[0].task_kind,'Supplementary');
 // Other months stay open.
 assert.ok((await q('MANAGER','select erp_private.month_overview($1) o',P))[0].o.find(x=>x.work_period_id===wpOld).closed===false);
});
