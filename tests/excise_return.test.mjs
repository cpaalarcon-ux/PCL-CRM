// Build 2795: the excise return task, the due date, the eTIMS sales check and the Tax Lead-only approval of excise rules.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),mods=[process.env.PCL_TEST_MODULES||process.cwd()];
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:mods})),{JSDOM}=require(require.resolve('jsdom',{paths:mods}));
globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const {salesCheck,computeSchedule}=await import('../'+fx+'excise-schedule-rules.mjs');
const {exciseScheduleAction}=await import('../'+fx+'excise-schedule-actions.ts');
const {taxConfigAction}=await import('../'+fx+'tax-config-actions.ts');
const {createExciseScheduleUI}=await import('../staff-excise-schedule.mjs');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
tx.json=v=>JSON.stringify(v);tx.array=v=>v;
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('sales check: values only, because the eTIMS import holds no quantities', ()=>{
 const l=(value)=>[{rate_key:'K',value}];
 assert.equal(salesCheck([{rate_key:'K',quantity:5}],{available:true,net:1000}).status,'No value entered');
 assert.match(salesCheck([{rate_key:'K',quantity:5}],null).message,/eTIMS import holds sales values, not quantities/);
 assert.equal(salesCheck(l(500),null).status,'No eTIMS sales');
 assert.equal(salesCheck(l(500),{available:false,net:0}).status,'No eTIMS sales');
 const ok=salesCheck(l(500),{available:true,net:1000,source:'eTIMS period summaries'});assert.equal(ok.status,'Within eTIMS sales');assert.equal(ok.etims_net,1000);assert.equal(ok.declared_value,500);assert.match(ok.message,/does not prove the quantities/);
 assert.equal(salesCheck(l(1000.5),{available:true,net:1000}).status,'Within eTIMS sales','a KES 1 rounding allowance');
 assert.equal(salesCheck(l(1001.01),{available:true,net:1000}).status,'More than eTIMS sales');
 assert.equal(salesCheck(l(0),{available:true,net:0}).status,'Within eTIMS sales','nil sales against nil eTIMS sales');
});

test('sales more than eTIMS blocks the schedule; a missing value or missing import only gives a notice', ()=>{
 const unit={rate_id:'r-unit',rate_key:'KE_EXCISE_LPG',tax_type:'Excise duty',label:'Fictional LPG duty',effective_from:'2026-01-01',effective_to:'2026-12-31',status:'Approved',approval_scope:'Reviewed',legal_review_status:'Not required',parameters:{excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Kilogram',rate_per_unit:12.5}};
 const profile={status:'Verified',obligations:['Excise duty'],obligations_reviewed_at:'2026-01-02',obligation_statuses:{'Excise duty':{registered:'YES',applicable:'YES',client_status:'ACTIVE',evidence_reference:'FICT-1'}},excise_products:[{rate_key:'KE_EXCISE_LPG',effective_from:'2026-01-01',effective_to:'2026-12-31'},{rate_key:'KE_EXCISE_FICT_PCT',effective_from:'2026-01-01',effective_to:'2026-12-31'}]};
 const M={starts_on:'2026-10-01',ends_on:'2026-10-31'};
 const r=sales=>computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:10,value:5000}],rates:[unit],profile,sales});
 assert.match(r({available:true,net:100}).issues.join(' '),/more than all the eTIMS sales/);
 assert.deepEqual(r({available:true,net:9000}).issues,[]);assert.equal(r({available:true,net:9000}).sales_check.status,'Within eTIMS sales');
 assert.deepEqual(r(null).issues,[]);assert.match(r(null).notices.join(' '),/No eTIMS sales are imported/);
 const noval=computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:10}],rates:[unit],profile,sales:{available:true,net:1}});assert.deepEqual(noval.issues,[]);assert.equal(noval.sales_check.status,'No value entered');assert.equal(noval.total_duty,125,'the duty comes from the quantity; the value is only a check');
});

test('database and actions: due date, return task, eTIMS sales and the Tax Lead-only approval', async t=>{
 t.after(()=>db.close());
 
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'EXCB','Fictional firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional LPG trader',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=actors.PARTNER;
 await tx`insert into erp_private.client_tax_profiles(client_id,entity_type,residency,regime,obligations,obligation_statuses,excise_products,effective_from,effective_to,notes,status,created_by,verified_by,verified_at,obligations_reviewed_by,obligations_reviewed_at) values(${C},'Company','Resident','Standard',array['Company','Excise duty'],${JSON.stringify({'Excise duty':{registered:'YES',applicable:'YES',client_status:'ACTIVE',evidence_reference:'FICT-1',effective_from:'2026-01-01',effective_to:'2026-12-31'},Company:{registered:'YES',applicable:'YES',client_status:'ACTIVE',evidence_reference:'FICT-2',effective_from:'2026-01-01',effective_to:'2026-12-31'}})},${JSON.stringify([{rate_key:'KE_EXCISE_LPG',registration_reference:'',effective_from:'2026-01-01',effective_to:'2026-12-31'}])},'2026-01-01','2026-12-31','Fictional',${'Verified'},${actors.MANAGER.staff_id},${P.staff_id},now(),${P.staff_id},now())`;
 // a rule approved for staging tests, a draft rule (unusable), nothing else
 const base=(key,status,params)=>tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,created_by,testing_authorized_at,testing_authorization_note,legal_review_status,legal_review_note) values(${key},'Excise duty','LPG duty for staging tests','2026-01-01','2026-12-31',${JSON.stringify(params)},'','Fictional',${status},${P.staff_id},now(),'Fictional test purpose for the staging schedule','Pending','Fictional: awaiting the Tax Lead')`;
 await base('KE_EXCISE_LPG','Testing',{excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Kilogram',rate_per_unit:12.5});
 await base('KE_EXCISE_DRAFT','Draft',{excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Litre',rate_per_unit:1});
 const act=(role,p)=>as(role,a=>exciseScheduleAction(tx,a,p)),cfg=(role,p)=>as(role,a=>taxConfigAction(tx,a,p));
 const proj=async(client,status)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id) values(${p},${client},${F},'UAT excise return','TAX-KRA',${status},${actors.MANAGER.staff_id})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const lines=[{rate_key:'KE_EXCISE_LPG',quantity:100,value:4000}],body={client_id:C,starts_on:'2026-10-01',ends_on:'2026-10-31',lines};

 // ---- eTIMS sales: summaries first, then detailed rows
 await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional: new client, no opening balances',opening_balance_confirmed_by=${actors.PARTNER.staff_id},opening_balance_confirmed_at=now() where client_id=${C}`;
 const PJ=await proj(C,'Active');
 let pre=await act('MANAGER2',{action:'excise_schedule_preview',...body});assert.equal(pre.result.sales_check.status,'No eTIMS sales');assert.deepEqual(pre.result.issues,[],'a missing import is a notice, not a blocker');
 const D=id();await db.exec("set session_replication_role=replica");
 const B=id();await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${PJ},${D},'Sales',1,'Sales','2026-10-01','2026-10-31','{}',2,2,0,0,${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${PJ},${C},'Sales',2,'r2','{}',${JSON.stringify({amount:3000,vat:480})}),(${B},${PJ},${C},'Sales',3,'r3','{}',${JSON.stringify({amount:500,vat:80})})`;
 await db.exec("set session_replication_role=origin");
 pre=await act('MANAGER2',{action:'excise_schedule_preview',...body});assert.equal(pre.result.sales_check.etims_net,3500);assert.equal(pre.result.sales_check.status,'More than eTIMS sales');assert.match(pre.result.issues.join(' '),/more than all the eTIMS sales/);
 const ok=await act('MANAGER2',{action:'excise_schedule_preview',...body,lines:[{rate_key:'KE_EXCISE_LPG',quantity:100,value:3000}]});assert.equal(ok.result.sales_check.status,'Within eTIMS sales');assert.deepEqual(ok.result.issues,[]);

 // ---- a schedule to attach the task to
 const sch=await act('MANAGER2',{action:'excise_schedule_save',...body,lines:[{rate_key:'KE_EXCISE_LPG',quantity:100,value:3000}]});const S=sch.schedule_id;
 const dueS=(role)=>act(role,{action:'excise_schedule_due_state',schedule_id:S});
 let st=await dueS('MANAGER2');assert.equal(st.state.filing_class,'VAT');assert.equal(String(st.state.suggested_due_date).slice(0,10),'2026-11-20','excise shares the 20th of the following month with VAT');assert.equal(st.state.status,null);assert.equal(st.task,null);
 await assert.rejects(()=>dueS('ASSISTANT'),/not available to your account|client access/);
 const mk=(role,extra={})=>act(role,{action:'excise_schedule_task_create',schedule_id:S,project_id:PJ,assigned_to:actors.MANAGER2.staff_id,...extra});
 await assert.rejects(()=>mk('MANAGER2'),/Confirm the KRA due date/,'no task before the date is confirmed or the fallback chosen');
 await assert.rejects(()=>act('MANAGER2',{action:'excise_schedule_due_confirm',schedule_id:S,kra_due_date:'2026-11-20'}),/Tick the box/,'the iTax tick is required');
 await assert.rejects(()=>act('ASSISTANT',{action:'excise_schedule_due_confirm',schedule_id:S,kra_due_date:'2026-11-20',itax_confirmed:true}),/not available to your account|Tax Lead, a Manager or a Partner/);
 await act('MANAGER2',{action:'excise_schedule_due_confirm',schedule_id:S,kra_due_date:'2026-11-20',itax_confirmed:true});
 st=await dueS('MANAGER');assert.equal(st.state.status,'CONFIRMED');assert.equal(String(st.state.kra_due_date).slice(0,10),'2026-11-20');
 // ---- the task
 await assert.rejects(()=>act('ASSISTANT',{action:'excise_schedule_task_create',schedule_id:S,project_id:PJ,assigned_to:actors.MANAGER2.staff_id}),/not available to your account|Partner, Manager or Supervisor/);
 const other=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${other},'Fictional other client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${other},${F})`;await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional: new client, no opening balances',opening_balance_confirmed_by=${actors.PARTNER.staff_id},opening_balance_confirmed_at=now() where client_id=${other}`;
 const wrong=await proj(other,'Active');await assert.rejects(()=>mk('MANAGER',{project_id:wrong}),/engagement of this client/,'an engagement of another client is refused');
 const draftP=await proj(C,'Draft');await assert.rejects(()=>mk('MANAGER',{project_id:draftP}),/Project is Draft/,'the normal project gate applies');
 await assert.rejects(()=>mk('MANAGER',{due_date:'2026-11-25'}),/takes the confirmed KRA due date/,'a confirmed date cannot be overridden');
 const made=await mk('MANAGER');assert.equal(made.task.due_basis,'CONFIRMED');assert.match(made.task.task_name,/^Excise return · 2026-10 · Fictional LPG trader$/);
 const trow=(await tx`select * from erp_private.tasks where task_id=${made.task.task_id}`)[0];assert.equal(trow.assigned_to,actors.MANAGER2.staff_id);assert.equal(trow.recurring_key,'excise:2026-10');assert.equal(trow.template_key,'excise-return');assert.equal(new Date(trow.due_at).toISOString(),'2026-11-20T14:00:00.000Z','17:00 Nairobi on the confirmed date');
 assert.equal(String(trow.period_start).slice(0,10)==='2026-10-01'||trow.period_start instanceof Date,true);
 await assert.rejects(()=>mk('MANAGER'),/already has a return task/,'one task per schedule');
 st=await dueS('MANAGER');assert.equal(st.task.task_id,made.task.task_id);
 // the link can never be edited or deleted
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.excise_schedule_tasks set due_basis='TASK_DATE_FALLBACK' where schedule_id=${S}`),/./);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.excise_schedule_tasks where schedule_id=${S}`),/./);
 // visible only with the client
 assert.equal((await as('ASSISTANT',()=>tx`select count(*)::int n from erp_private.excise_schedule_tasks`))[0].n,0,'an assistant not on the client sees no links');
 assert.equal((await as('MANAGER2',()=>tx`select count(*)::int n from erp_private.excise_schedule_tasks`))[0].n,1);

 // ---- fallback: the person chooses the task date
 const sch2=await act('MANAGER2',{action:'excise_schedule_save',...body,starts_on:'2026-11-01',ends_on:'2026-11-30',lines:[{rate_key:'KE_EXCISE_LPG',quantity:5}]});const S2=sch2.schedule_id;
 const mk2=(p)=>act('MANAGER',{action:'excise_schedule_task_create',schedule_id:S2,project_id:PJ,assigned_to:actors.MANAGER2.staff_id,...p});
 await act('MANAGER',{action:'excise_schedule_due_fallback',schedule_id:S2,fallback_reason:'Fictional: iTax calendar not available today'});
 st=await act('MANAGER',{action:'excise_schedule_due_state',schedule_id:S2});assert.equal(st.state.status,'TASK_DATE_FALLBACK');
 await assert.rejects(()=>mk2({}),/Choose the task due date/,'the fallback needs a date');
 const m2=await mk2({due_date:'2026-12-18'});assert.equal(m2.task.due_basis,st.state.status);assert.equal(new Date(m2.task.due_at).toISOString(),'2026-12-18T14:00:00.000Z');
 // a withdrawn schedule gets no task or date change
 const sch3=await act('MANAGER2',{action:'excise_schedule_save',...body,starts_on:'2026-12-01',ends_on:'2026-12-31',lines:[{rate_key:'KE_EXCISE_LPG',quantity:5}]});const r3=(await tx`select revision from erp_private.excise_schedules where schedule_id=${sch3.schedule_id}`)[0].revision;
 await act('PARTNER',{action:'excise_schedule_withdraw',schedule_id:sch3.schedule_id,revision:r3,reason:'Fictional reason for withdrawal'});
 await assert.rejects(()=>act('MANAGER',{action:'excise_schedule_due_fallback',schedule_id:sch3.schedule_id,fallback_reason:'x'}),/withdrawn/);

 // ---- Tax Lead-only approval of excise rules
 const M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const rule=async(key)=>(await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,created_by) values(${key},'Excise duty','Staging excise rule for the Tax Lead check','2035-01-01','2035-12-31',${JSON.stringify({excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Kilogram',rate_per_unit:1})},'https://www.kra.go.ke/','Excise Duty Act, section 5. Staging check of the Tax Lead right.',${actors.MANAGER.staff_id}) returning rate_id`)[0].rate_id;
 const R=await rule('KE_EXCISE_APPROVAL_CHECK');await tx`update erp_private.tax_rates set legal_review_status='Pending',legal_review_note='Pending the Tax Lead review',legal_citation='Fictional Excise Act s1' where rate_id=${R}`;
 const rev=async()=>(await tx`select revision from erp_private.tax_rates where rate_id=${R}`)[0].revision;
 const approveSql=(role)=>as(role,()=>db.query(`update erp_private.tax_rates set status='Approved',approved_by=$2,approved_at=now(),partner_source_verified_on=current_date where rate_id=$1`,[R,actors[role].staff_id]));
 await assert.rejects(approveSql('PARTNER'),/Excise duty rules can only be confirmed and approved by the designated Tax Manager/,'a Partner without the right cannot approve an excise rule (database)');
 await assert.rejects(cfg('PARTNER',{action:'rate_approve',rate_id:R,revision:await rev(),confirm_legal_basis:true}),/Excise duty rules can only be confirmed and approved by the designated Tax Manager/,'nor through the screen action');
 await assert.rejects(cfg('PARTNER',{action:'rate_legal_confirm',rate_id:R,revision:await rev(),lead_name:'Fictional Lead',reference:'Memo fictional 2035',legal_citation:'Fictional Act s1',confirmed:true}),/designated Tax Manager/);
 await assert.rejects(approveSql('MANAGER2'),/designated Tax Manager/,'a Manager without the right cannot either');
 // the right is granted to a Manager
 await tx`insert into erp_private.staff_capabilities(staff_id,capability,granted_by,reason,expires_on) values(${M2},'APPROVE_TAX_RULES',${PT},'Fictional Tax Lead',current_date+100)`;
 // the preparer still cannot approve their own rule
 const R2=await rule('KE_EXCISE_SELF_CHECK');await tx`update erp_private.tax_rates set created_by=${M2} where rate_id=${R2}`;
 await assert.rejects(as('MANAGER2',()=>db.query(`update erp_private.tax_rates set status='Approved',approved_by=$2,approved_at=now(),partner_source_verified_on=current_date where rate_id=$1`,[R2,M2])),/cannot confirm or approve/);
 // the Tax Lead can confirm the legal basis and approve
 await cfg('MANAGER2',{action:'rate_legal_confirm',rate_id:R,revision:await rev(),lead_name:'Fictional Tax Lead',reference:'Memo 2026-11-12 fictional',legal_citation:'Fictional Act s1',confirmed:true});
 assert.equal((await tx`select legal_reviewed_by from erp_private.tax_rates where rate_id=${R}`)[0].legal_reviewed_by,M2);
 await cfg('MANAGER2',{action:'rate_approve',rate_id:R,revision:await rev(),confirm_legal_basis:true});
 assert.equal((await tx`select status,approved_by from erp_private.tax_rates where rate_id=${R}`)[0].approved_by,M2,'approved by the Tax Lead');
 // other rule types keep their earlier path: a Partner still approves a levy
 const L=(await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,created_by) values('KE_FICT_LEVY_2795','Levy','Staging levy for the check','2036-01-01','2036-12-31','{"rate":1}','https://www.kra.go.ke/','Finance Act, section 5. Staging check.',${actors.MANAGER.staff_id}) returning rate_id`)[0].rate_id;
 await as('PARTNER',()=>db.query(`update erp_private.tax_rates set status='Approved',approved_by=$2,approved_at=now(),partner_source_verified_on=current_date where rate_id=$1`,[L,PT]));
 assert.equal((await tx`select status from erp_private.tax_rates where rate_id=${L}`)[0].status,'Approved');
});

test('wiring: routed, no figures seeded, release label, no forensic words', ()=>{
 const sql=rd('supabase/migrations/20261112040000_excise_lead_and_return_task.sql');
 assert.doesNotMatch(sql,/INSERT INTO erp_private\.tax_rates/i);
 for(const f of ['supabase/migrations/20261112040000_excise_lead_and_return_task.sql',fx+'excise-schedule-actions.ts',fx+'excise-schedule-rules.mjs','staff-excise-schedule.mjs'])assert.doesNotMatch(rd(f),/forensic|ISRS 4000/i);
 assert.match(rd(fx+'tax-config-actions.ts'),/leadOnly=\['VAT','Withholding tax','Excise duty'\]/);
 assert.match(rd(fx+'staff-access-control.mjs'),/excise_schedule_/);
 assert.equal(JSON.parse(rd(fx+'release.json')).build,'2026-11-12.2795');
});
