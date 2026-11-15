import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {recordReopenAction}=await import('../supabase/functions/staff-workspace-v12/record-reopen-actions.ts');
const {confirmPeriodImport}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ro=(role,p)=>as(role,a=>recordReopenAction(tx,a,{project_id:P,...p}));
test('partner exceptional reopen: only a Partner, only with nothing posted, reason required, coverage released, recorded permanently, confirmed again by an independent reviewer',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const emp=(name,n,gross,x={})=>({name,employee_id:'E'+n,pin:'A00000000'+n+'Z',gross,source_row:Number(n)+1,...x});
 const calc=(gross,paye,nssf,shif,ahl)=>({gross,paye,employee_nssf:nssf,shif,employee_ahl:ahl,other_deductions:0,employer_nssf:nssf,employer_ahl:ahl,nita:50,net_pay:Math.round((gross-paye-nssf-shif-ahl)*100)/100});
 const month=(start,end,rows,calcRows,status='Submitted',extra={})=>({import_id:id(),start,end,rows,calcRows,status,...extra});
 async function addImport(m){await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.period_imports(import_id,project_id,client_id,document_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by) values(${m.import_id},${P},${C},${D},'Payroll','PAYROLL','PAYROLL_MONTHLY',${m.start},${m.end},${tx.json({employees:m.rows,calculated:m.calcRows,issues:m.issues||[],differences:m.differences||[]})},${'h'+m.import_id},${m.status},${actors.ASSISTANT.staff_id})`;}finally{await db.exec('set session_replication_role=origin');}}
 const row=(name,n,gross)=>emp(name,n,gross),cr=calc(100000,20000,2160,2000,1500);
 const mk=(s,e)=>month(s,e,[row('Wanjiru','1',100000)],[cr],'Submitted');
 const confirm=async m=>as('SUPERVISOR',async a=>{const r=(await tx`select * from erp_private.period_imports where import_id=${m.import_id}`)[0];await confirmPeriodImport(tx,a,{project_id:P,client_id:C},r,'Independent review of the payroll summary found it correct.');});
 const aug=mk('2026-08-01','2026-08-31'),sep=mk('2026-09-01','2026-09-30'),oct=mk('2026-10-01','2026-10-31'),nov=mk('2026-11-01','2026-11-30');
 for(const m of [aug,sep,oct,nov])await addImport(m);
 for(const m of [aug,sep,oct])await confirm(m);
 const days=async m=>(await tx`select count(*)::int n from erp_private.period_import_days where import_id=${m.import_id}`)[0].n;
 assert.equal(await days(aug),31);
 const rev=async m=>(await tx`select revision from erp_private.period_imports where import_id=${m.import_id}`)[0].revision;
 const REASON='Wrong month was uploaded: the file is for July payroll, found when comparing to the client payslips.';

 // Only a Partner. A Manager is told so; the check says it is Partner only.
 await assert.rejects(async()=>ro('MANAGER',{action:'record_reopen_apply',import_id:aug.import_id,revision:await rev(aug),reason:REASON}),/Only a Partner/);
 const chk0=await ro('MANAGER',{action:'record_reopen_check',import_id:aug.import_id});assert.equal(chk0.can_reopen,false);assert.equal(chk0.partner_only,true);
 const chk1=await ro('PARTNER',{action:'record_reopen_check',import_id:aug.import_id});assert.equal(chk1.can_reopen,true);assert.deepEqual(chk1.blockers,[]);
 // A reason is required and must be real.
 await assert.rejects(async()=>ro('PARTNER',{action:'record_reopen_apply',import_id:aug.import_id,revision:await rev(aug),reason:'too short'}),/at least 30/);
 await assert.rejects(async()=>ro('PARTNER',{action:'record_reopen_apply',import_id:aug.import_id,revision:await rev(aug),reason:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}),/real reason/);
 await assert.rejects(async()=>ro('PARTNER',{action:'record_reopen_apply',import_id:aug.import_id,revision:'1',reason:REASON}),/changed/);
 assert.equal((await tx`select status from erp_private.period_imports where import_id=${aug.import_id}`)[0].status,'Confirmed','nothing changed by the refusals');
 // A summary that is not confirmed cannot be reopened this way.
 await assert.rejects(async()=>ro('PARTNER',{action:'record_reopen_apply',import_id:nov.import_id,revision:await rev(nov),reason:REASON}),/Only a confirmed summary/);

 // Reopen: returned with the reason and the Partner's name, coverage released, recorded, preparer told.
 const done=await ro('PARTNER',{action:'record_reopen_apply',import_id:aug.import_id,revision:await rev(aug),reason:REASON});
 assert.equal(done.status,'Returned');assert.equal(done.sole_partner,true);
 const r=(await tx`select status,review_note,reviewed_by from erp_private.period_imports where import_id=${aug.import_id}`)[0];
 assert.equal(r.status,'Returned');assert.match(r.review_note,/Partner exceptional reopen/);assert.match(r.review_note,/Wrong month was uploaded/);assert.equal(r.reviewed_by,actors.PARTNER.staff_id);
 assert.equal(await days(aug),0,'coverage days are released');
 const rec=(await ro('PARTNER',{action:'record_reopen_list',import_id:aug.import_id})).reopens;
 assert.equal(rec.length,1);assert.equal(rec[0].reason,REASON);assert.equal(rec[0].prior_totals.employees,1);assert.equal(rec[0].prior_totals.gross,100000);assert.match(rec[0].prior_review_note,/Independent review/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='PARTNER_EXCEPTIONAL_REOPEN'`)[0].n,1);
 // The record is insert-only.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.record_reopens set reason='changed after the event, edited reason text here' where record_id=${aug.import_id}`),/never edited|permission|policy/i);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.record_reopens where record_id=${aug.import_id}`));
 assert.equal((await ro('PARTNER',{action:'record_reopen_list'})).reopens.length,1);
 // It must be submitted and confirmed again: the preparer submits, a reviewer other than the preparer confirms; coverage is held again.
 await as('ASSISTANT',()=>tx`update erp_private.period_imports set status='Submitted' where import_id=${aug.import_id}`);
 await assert.rejects(()=>as('ASSISTANT',async a=>{const x=(await tx`select * from erp_private.period_imports where import_id=${aug.import_id}`)[0];await confirmPeriodImport(tx,a,{project_id:P,client_id:C},x,'Own review of own summary is not allowed.');}),/different Supervisor/);
 await confirm(aug);assert.equal(await days(aug),31);
 // A second reopen is allowed (each is recorded).
 await ro('PARTNER',{action:'record_reopen_apply',import_id:aug.import_id,revision:await rev(aug),reason:REASON+' Second time, after the client sent a corrected payslip file.'});
 assert.equal((await ro('PARTNER',{action:'record_reopen_list',import_id:aug.import_id})).reopens.length,2);

 // Entries prepared from the summary: refused by the action and, separately, by the database.
 await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id) values('Period import',${sep.import_id},${id()},${P})`;}finally{await db.exec('set session_replication_role=origin');}
 const chk2=await ro('PARTNER',{action:'record_reopen_check',import_id:sep.import_id});assert.equal(chk2.can_reopen,false);assert.match(chk2.blockers.join(' '),/accounting entr/);
 await assert.rejects(async()=>ro('PARTNER',{action:'record_reopen_apply',import_id:sep.import_id,revision:await rev(sep),reason:REASON}),/Amend the summary/);
 await assert.rejects(()=>as('PARTNER',async()=>{await tx`select set_config('erp.partner_reopen','period_import',true)`;await tx`update erp_private.period_imports set status='Returned',reviewed_by=${actors.PARTNER.staff_id},review_note=${REASON} where import_id=${sep.import_id}`;}),/Entries were prepared/);
 assert.equal(await days(sep),30);
 // Without the switch, nobody can move Confirmed to Returned directly, a Partner included.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.period_imports set status='Returned',reviewed_by=${actors.PARTNER.staff_id},review_note=${REASON} where import_id=${oct.import_id}`),/exceptional reopen/);
 // A live amendment blocks it.
 await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.import_amendments(project_id,client_id,import_id,kind,outcome,reason_type,reason,status,starts_on,ends_on,requested_by) values(${P},${C},${oct.import_id},'Payroll','Replace','Wrong amounts','Amounts were keyed wrongly in the file.','Requested','2026-10-01','2026-10-31',${actors.ASSISTANT.staff_id})`;}finally{await db.exec('set session_replication_role=origin');}
 const chk3=await ro('PARTNER',{action:'record_reopen_check',import_id:oct.import_id});assert.equal(chk3.can_reopen,false);assert.match(chk3.blockers.join(' '),/amendment is already in progress/);
 assert.equal((await tx`select status from erp_private.period_imports where import_id=${oct.import_id}`)[0].status,'Confirmed');
});
