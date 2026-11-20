import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {obligationCheckAction,requireObligationsAllowed,allowedObligations}=await import('../supabase/functions/staff-workspace-v12/obligation-check-actions.ts');const {serviceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/service-template-actions.ts');
const {obligationState,checkObligations,exceptionCovers}=await import('../supabase/functions/staff-workspace-v12/obligation-check-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const oc=(role,p)=>as(role,a=>obligationCheckAction(tx,a,p));const st=(role,p)=>as(role,a=>serviceTemplateAction(tx,a,p));

const prof={status:'Verified',obligations:['VAT','PAYE','TOT'],effective_from:'2026-01-01',effective_to:'2026-12-31',obligations_reviewed_at:'2026-01-05',regime:'Standard',
 obligation_statuses:{VAT:{registered:'YES',applicable:'YES',client_status:'ACTIVE',evidence_reference:'iTax certificate',effective_from:'2026-01-01',effective_to:'2026-12-31'},
  PAYE:{registered:'NO',applicable:'YES',client_status:'NOT_REGISTERED',evidence_reference:'',effective_from:'2026-01-01',effective_to:'2026-12-31'},
  TOT:{registered:'YES',applicable:'NO',client_status:'ACTIVE',evidence_reference:'iTax',effective_from:'2026-01-01',effective_to:'2026-12-31'}}};
test('pure rules: four states from the verified profile, the dates and the reporting frequency',()=>{
 const ctx={start:'2026-03-01',end:'2026-12-31',frequency:'Monthly'};
 assert.equal(obligationState(prof,'VAT',ctx).state,'Confirmed');
 assert.equal(obligationState(prof,'PAYE',ctx).state,'Not registered');
 assert.equal(obligationState(prof,'TOT',ctx).state,'Exempt');
 assert.equal(obligationState(prof,'MRI',ctx).state,'Not registered');
 assert.equal(obligationState({...prof,status:'Draft'},'VAT',ctx).state,'Needs verification');
 assert.equal(obligationState(null,'VAT',ctx).state,'Needs verification');
 assert.equal(obligationState({...prof,obligations_reviewed_at:null},'VAT',ctx).state,'Needs verification');
 assert.equal(obligationState({...prof,obligation_statuses:{...prof.obligation_statuses,VAT:{...prof.obligation_statuses.VAT,evidence_reference:''}}},'VAT',ctx).state,'Needs verification');
 assert.equal(obligationState({...prof,obligation_statuses:{...prof.obligation_statuses,VAT:{...prof.obligation_statuses.VAT,registered:'UNKNOWN'}}},'VAT',ctx).state,'Needs verification');
 // The registration must cover the whole schedule, and the schedule's frequency must be one that generates the monthly return.
 assert.match(obligationState({...prof,obligation_statuses:{...prof.obligation_statuses,VAT:{...prof.obligation_statuses.VAT,effective_from:'2026-06-01'}}},'VAT',ctx).reason,/does not cover the whole schedule/);
 assert.match(obligationState(prof,'VAT',{...ctx,frequency:'Quarterly'}).reason,/schedule's frequency is Quarterly/);
 assert.equal(obligationState(prof,'VAT',{...ctx,frequency:'Weekly + Monthly'}).state,'Confirmed');
 assert.equal(checkObligations([prof,prof],['VAT'],ctx)[0].state,'Needs verification');
 assert.equal(exceptionCovers({status:'Approved',obligation_code:'PAYE',period_start:'2026-01-01',period_end:'2026-12-31'},'PAYE','2026-03-01','2026-12-31'),true);
 assert.equal(exceptionCovers({status:'Requested',obligation_code:'PAYE',period_start:'2026-01-01',period_end:'2026-12-31'},'PAYE','2026-03-01','2026-12-31'),false);
 assert.equal(exceptionCovers({status:'Approved',obligation_code:'PAYE',period_start:'2026-04-01',period_end:'2026-12-31'},'PAYE','2026-03-01','2026-12-31'),false);
});
test('obligation exceptions: a reason, a different Manager or Partner, and the schedule is blocked without one',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V4QA','Fictional V4 firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const C=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,entity_evidence,year_end_month,year_end_day) values(${C},'Fictional obligation client',${actors.MANAGER.staff_id},'Limited company','Certificate of incorporation CR-123',12,31)`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const statuses=prof.obligation_statuses;
 await tx`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,effective_from,effective_to,notes,status,created_by,verified_by,verified_at,obligation_statuses,obligations_reviewed_at) values(${C},'Company','Resident','Standard',${tx.array(['VAT','PAYE','TOT'])}::text[],'2026-01-01','2026-12-31','Fictional profile','Verified',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now(),${JSON.stringify(statuses)}::jsonb,now())`;
 const q={client_id:C,starts_on:'2026-03-01',ends_on:'2026-12-31',frequency:'Monthly',obligations:['VAT','PAYE','TOT','MRI']};
 // ---- The check shows the four states and refuses nothing by itself ----
 const chk=await oc('SUPERVISOR',{action:'obligation_check',...q});
 const by=Object.fromEntries(chk.rows.map(r=>[r.code,r]));
 assert.equal(by.VAT.state,'Confirmed');assert.equal(by.VAT.allowed,true);
 assert.equal(by.PAYE.state,'Not registered');assert.equal(by.TOT.state,'Exempt');assert.equal(by.MRI.state,'Not registered');
 for(const c of ['PAYE','TOT','MRI'])assert.equal(by[c].allowed,false,c);
 assert.match(chk.blocked,/Tax work cannot be scheduled for/);assert.equal(chk.can_decide,false);
 // Frequency matters: a quarterly schedule does not generate the monthly return.
 assert.equal((await oc('SUPERVISOR',{action:'obligation_check',...q,frequency:'Quarterly',obligations:['VAT']})).rows[0].state,'Needs verification');
 // Only staff who manage projects use it.
 await assert.rejects(()=>oc('ASSISTANT',{action:'obligation_check',...q}),/Supervisor, Manager or Partner/);

 // ---- Request: a reason is required, the state is worked out on the server, a confirmed obligation takes none ----
 const rq={action:'obligation_exception_request',client_id:C,obligation_code:'PAYE',starts_on:'2026-03-01',ends_on:'2026-12-31',frequency:'Monthly'};
 await assert.rejects(()=>oc('SUPERVISOR',{...rq,reason:'too short'}),/at least 15 characters/);
 await assert.rejects(()=>oc('SUPERVISOR',{...rq,obligation_code:'VAT',reason:'Client asked us to prepare it anyway'}),/No exception is needed/);
 const made=await oc('SUPERVISOR',{...rq,reason:'Client registered on iTax on 2 March; certificate to follow'});assert.equal(made.state,'Not registered');
 await assert.rejects(()=>oc('SUPERVISOR',{...rq,reason:'A second request for the same period and obligation'}),/already awaiting approval/);
 // Awaiting approval does not unlock the schedule.
 const pending=await oc('SUPERVISOR',{action:'obligation_check',...q,obligations:['PAYE']});assert.equal(pending.rows[0].allowed,false);assert.equal(pending.rows[0].exception_status,'Requested');
 assert.match(pending.blocked,/exception awaiting approval/);

 // ---- Decision: a Manager or Partner, never the requester, never a Supervisor ----
 await assert.rejects(()=>oc('SUPERVISOR',{action:'obligation_exception_decide',exception_id:made.exception_id,decision:'Approve'}),/Manager or Partner decides/);
 const own=await oc('MANAGER',{...rq,obligation_code:'TOT',reason:'Manager needs this one for the nil-return check'});
 await assert.rejects(()=>oc('MANAGER',{action:'obligation_exception_decide',exception_id:own.exception_id,decision:'Approve'}),/different Manager or Partner/);
 await assert.rejects(()=>oc('MANAGER2',{action:'obligation_exception_decide',exception_id:own.exception_id,decision:'Reject',note:'no'}),/reason for rejecting/);
 assert.equal((await oc('MANAGER2',{action:'obligation_exception_decide',exception_id:own.exception_id,decision:'Reject',note:'Exempt client: no return is filed'})).status,'Rejected');
 assert.equal((await oc('MANAGER',{action:'obligation_exception_decide',exception_id:made.exception_id,decision:'Approve',note:'Registration number seen on iTax'})).status,'Approved');
 await assert.rejects(()=>oc('PARTNER',{action:'obligation_exception_decide',exception_id:made.exception_id,decision:'Approve'}),/already been decided/);
 const ok=await oc('SUPERVISOR',{action:'obligation_check',...q,obligations:['VAT','PAYE']});assert.equal(ok.rows.every(r=>r.allowed),true);assert.equal(ok.blocked,null);
 // It covers that period and that obligation only.
 const shifted=await oc('SUPERVISOR',{action:'obligation_check',client_id:C,starts_on:'2026-01-01',ends_on:'2026-12-31',frequency:'Monthly',obligations:['PAYE','MRI']});
 assert.equal(shifted.rows.find(r=>r.code==='PAYE').allowed,false);assert.equal(shifted.rows.find(r=>r.code==='MRI').allowed,false);

 // ---- Database rules hold even if the app is bypassed ----
 await assert.rejects(()=>tx`update erp_private.obligation_task_exceptions set reason='Edited after approval, which must not be allowed' where exception_id=${made.exception_id}`,/never edited/);
 await assert.rejects(()=>tx`update erp_private.obligation_task_exceptions set status='Requested' where exception_id=${made.exception_id}`,/not allowed/);
 await assert.rejects(()=>tx`delete from erp_private.obligation_task_exceptions where exception_id=${made.exception_id}`,/./);
 await assert.rejects(()=>tx`insert into erp_private.obligation_task_exceptions(client_id,obligation_code,period_start,period_end,state_at_request,reason,requested_by,status,decided_by,decided_at) values(${C},'MRI','2026-03-01','2026-12-31','Not registered','Self approved straight away',${actors.MANAGER.staff_id},'Approved',${actors.MANAGER.staff_id},now())`,/./);

 // ---- The save-time gate uses the same answer (this is what project_save calls) ----
 const sched={obligations:['VAT','PAYE'],starts_on:'2026-03-01',ends_on:'2026-12-31',frequency:'Monthly'};
 await as('MANAGER',a=>requireObligationsAllowed(tx,C,sched));
 await assert.rejects(()=>as('MANAGER',a=>requireObligationsAllowed(tx,C,{...sched,obligations:['VAT','MRI']})),/Tax work cannot be scheduled for: MRI \(Not registered\)/);
 await assert.rejects(()=>as('MANAGER',a=>requireObligationsAllowed(tx,C,{...sched,frequency:'Annually',obligations:['VAT']})),/schedule's frequency is Annually/);
 const allowed=await as('MANAGER',a=>allowedObligations(tx,C,'2026-03-01','2026-12-31'));assert.deepEqual([...allowed].sort(),['PAYE','VAT']);
 // ---- Set-up: the engagement set-up counts only confirmed obligations or those under an approved exception ----
 const list=await oc('MANAGER',{action:'obligation_exception_list',client_id:C});assert.equal(list.exceptions.filter(e=>e.status==='Approved').length,1);
 // ---- Ending: an approved exception is ended with a reason and then blocks again ----
 await assert.rejects(()=>oc('MANAGER2',{action:'obligation_exception_end',exception_id:made.exception_id,reason:'no'}),/Give the reason for ending/);
 await oc('MANAGER2',{action:'obligation_exception_end',exception_id:made.exception_id,reason:'iTax shows the registration was refused'});
 const after=await oc('SUPERVISOR',{action:'obligation_check',...q,obligations:['PAYE']});assert.equal(after.rows[0].allowed,false);assert.equal(after.rows[0].exception_status,null);
 await assert.rejects(()=>oc('MANAGER2',{action:'obligation_exception_end',exception_id:made.exception_id,reason:'Ended twice by mistake'}),/Only an approved exception/);
 // The history stays.
 assert.equal(Number((await tx`select count(*) n from erp_private.obligation_task_exceptions where client_id=${C}`)[0].n),2);
});
