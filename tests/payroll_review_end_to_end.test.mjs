import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {payrollRegisterAction}=await import('../supabase/functions/staff-workspace-v12/payroll-register-actions.ts');
const {payrollReviewAction}=await import('../supabase/functions/staff-workspace-v12/payroll-review-actions.ts');
const {routingMapAction}=await import('../supabase/functions/staff-workspace-v12/routing-map-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const reg=(role,p)=>as(role,a=>payrollRegisterAction(tx,a,{project_id:P,...p})),rev=(role,p)=>as(role,a=>payrollReviewAction(tx,a,{project_id:P,...p})),rm=(role,p)=>as(role,a=>routingMapAction(tx,a,{client_id:C,...p}));
test('payroll review: one-step approval of a clean run; exceptions, unmapped codes and late register changes block it; reopen returns the month for a new version',async t=>{
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
 const sepRows=[emp('Wanjiru','1',110000),emp('Kamau','3',60000)],sepCalc=[calc(110000,23000,2160,3025,1650),calc(60000,8000,2160,1650,900)];
 const aug=month('2026-08-01','2026-08-31',[emp('Wanjiru','1',100000),emp('Otieno','2',80000)],[calc(100000,20000,2160,2000,1500),calc(80000,14000,2160,2000,1200)],'Confirmed');
 const sep=month('2026-09-01','2026-09-30',sepRows,sepCalc);
 await addImport(aug);await addImport(sep);
 // Register: Wanjiru 100,000 then 110,000 from September; Otieno left; Kamau 60,000 from September.
 const person=(name,pin,x={})=>({name,kra_pin:pin,national_id:'E'+pin[9],relationship:'Employee',employment_type:'Permanent',started_on:'2026-01-01',...x});
 const pay=(gross,eff,reason='Contract signed January 2026')=>({gross,effective_from:eff,reason});
 const w=await reg('ASSISTANT',{action:'payroll_register_add',person:person('Wanjiru','A000000001Z'),pay:pay(100000,'2026-01-01')});
 await reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:110000,effective_from:'2026-09-01',reason:'Annual review approved August 2026'});
 const o=await reg('ASSISTANT',{action:'payroll_register_add',person:person('Otieno','A000000002Z'),pay:pay(80000,'2026-01-01')});
 const ol=(await reg('ASSISTANT',{action:'payroll_register_read'})).people.find(x=>x.name==='Otieno');
 await reg('ASSISTANT',{action:'payroll_register_leave',person_id:o.person_id,revision:ol.revision,left_on:'2026-08-31',reason:'Resigned, notice served August'});
 {const sr=(await reg('ASSISTANT',{action:'payroll_register_read'})).changes.find((c)=>c.kind==='Separation'&&c.status==='Requested');await reg('MANAGER',{action:'payroll_register_separation_decide',change_id:sr.change_id,decision:'Approve'});}
 await reg('ASSISTANT',{action:'payroll_register_add',person:person('Kamau','A000000003Z',{started_on:'2026-09-01'}),pay:pay(60000,'2026-09-01','Offer letter September 2026')});
 // Without approved payroll mappings the run is not clean and names the codes; nothing is guessed.
 const s0=await rev('SUPERVISOR',{action:'payroll_review_summary',import_id:sep.import_id});
 assert.equal(s0.clean,false);assert.ok(s0.unmapped.length>=8);assert.ok(s0.blockers.some(b=>/No approved mapping/.test(b)));assert.equal(s0.can_review,true);
 await assert.rejects(()=>rev('SUPERVISOR',{action:'payroll_review_approve',import_id:sep.import_id,revision:s0.revision}),/not clean/);
 // A Manager proposes and a Partner approves the payroll mappings.
 const A={GROSS_SALARY:'60000',NSSF_EMPLOYER:'60050',AHL_EMPLOYER:'60060',NITA_EMPLOYER:'60070',PAYE:'21600',NSSF_EMPLOYEE:'21603',SHIF:'21601',AHL_EMPLOYEE:'21602',NITA_PAYABLE:'21604',NET_PAY_PAYABLE:'21610'};
 await rm('MANAGER',{action:'routing_map_propose',rows:Object.entries(A).map(([routing_code,erp_account_code])=>({module:'Payroll',routing_code,erp_account_code,effective_from:'2026-01-01'}))});
 for(const d of (await rm('PARTNER',{action:'routing_map_read',module:'Payroll'})).maps)await rm('PARTNER',{action:'routing_map_approve',routing_id:d.routing_id,revision:d.revision});
 const s1=await rev('SUPERVISOR',{action:'payroll_review_summary',import_id:sep.import_id});
 assert.deepEqual(s1.blockers,[],'clean: '+JSON.stringify(s1.blockers));assert.equal(s1.clean,true);assert.equal(s1.journal.balanced,true);assert.equal(s1.totals.gross,170000);
 assert.deepEqual(s1.changes.new_staff.map(x=>x.name),['Kamau']);assert.deepEqual(s1.changes.left.map(x=>x.name),['Otieno']);assert.deepEqual(s1.changes.salary_changes.map(x=>x.name),['Wanjiru']);
 // The preparer cannot approve their own run; an Assistant is not a reviewer.
 await assert.rejects(()=>rev('ASSISTANT',{action:'payroll_review_approve',import_id:sep.import_id,revision:s1.revision}),/different Supervisor/);
 // A register change made after the run was saved blocks one-step approval and is named.
 await new Promise(r=>setTimeout(r,20));
 await reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:120000,effective_from:'2026-09-15',reason:'Backdated correction approved by client'});
 const s2=await rev('SUPERVISOR',{action:'payroll_review_summary',import_id:sep.import_id});
 assert.equal(s2.clean,false);assert.equal(s2.drift.late_changes.length,1);assert.match(s2.blockers.join(' '),/register changed after this run was saved: Wanjiru/);
 await assert.rejects(()=>rev('SUPERVISOR',{action:'payroll_review_approve',import_id:sep.import_id,revision:s2.revision}),/not clean/);
 // Reopen: returned with the reason and the register change in the note, then the month can be prepared again from the register.
 await assert.rejects(()=>rev('ASSISTANT',{action:'payroll_review_reopen',import_id:sep.import_id,revision:s2.revision}),/different Supervisor/);
 const back=await rev('SUPERVISOR',{action:'payroll_review_reopen',import_id:sep.import_id,revision:s2.revision});
 assert.equal(back.status,'Returned');
 const row=(await tx`select status,review_note,reviewed_by from erp_private.period_imports where import_id=${sep.import_id}`)[0];
 assert.equal(row.status,'Returned');assert.match(row.review_note,/new version/);assert.match(row.review_note,/Wanjiru 110000\.00 to 120000\.00/);assert.equal(row.reviewed_by,actors.SUPERVISOR.staff_id);
 const again=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09'});assert.equal(again.existing_run,null);assert.equal(again.returned_run.status,'Returned');assert.equal(again.lines.find(l=>l.name==='Wanjiru').gross,120000);
 // A clean month is approved in one step: confirmed, audited, with the numbers in the review note.
 const oct=month('2026-10-01','2026-10-31',[emp('Wanjiru','1',120000),emp('Kamau','3',60000)],[calc(120000,26000,2160,3300,1800),calc(60000,8000,2160,1650,900)]);await addImport(oct);
 const s3=await rev('MANAGER',{action:'payroll_review_summary',import_id:oct.import_id});assert.equal(s3.clean,true,JSON.stringify(s3.blockers));
 const ok=await rev('MANAGER',{action:'payroll_review_approve',import_id:oct.import_id,revision:s3.revision});assert.equal(ok.status,'Confirmed');
 const done=(await tx`select status,review_note from erp_private.period_imports where import_id=${oct.import_id}`)[0];assert.equal(done.status,'Confirmed');assert.match(done.review_note,/Clean run approved in one step: 2 employees, gross 180000\.00/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='PAYROLL_CLEAN_RUN_APPROVED'`)[0].n,1);
 assert.equal((await tx`select count(*)::int n from erp_private.ledger_journals`)[0].n,0,'approving posts nothing and prepares no entry');
 await assert.rejects(()=>rev('MANAGER',{action:'payroll_review_approve',import_id:oct.import_id,revision:s3.revision}),/Only a submitted payroll/);
});
