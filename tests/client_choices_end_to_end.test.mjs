import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {clientChoicesAction}=await import('../supabase/functions/staff-workspace-v12/client-choices-actions.ts');
const {exportProfileAction}=await import('../supabase/functions/staff-workspace-v12/export-profile-actions.ts');
const {staffRightsAction}=await import('../supabase/functions/staff-workspace-v12/staff-rights-actions.ts');const {clientSetupReviewAction}=await import('../supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const cc=(role,p)=>as(role,a=>clientChoicesAction(tx,a,p)),ep=(role,p)=>as(role,a=>exportProfileAction(tx,a,p)),rights=(role,p)=>as(role,a=>staffRightsAction(tx,a,p)),rv=(role,p)=>as(role,a=>clientSetupReviewAction(tx,a,p));

test('client choices: chosen payroll returns and approved tax rule exceptions, through the real actions',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CHQA','Fictional choices firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','ASSISTANT','INTERN']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const C=id(),P=id();
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL CHOICES LIMITED','P051000008A','Wholesale & Retail','Nairobi','Limited company','CR-FICTIONAL-0008 fictional certificate',10,31,${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional books','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const r of ['PARTNER','PARTNER2','MANAGER','MANAGER2','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[r].staff_id},${F},'MANAGER')`;
 const tasks=role=>rv(role,{action:'client_setup_tasks_read',client_id:C});

 // ---- payroll returns ----
 await assert.rejects(cc('INTERN',{action:'client_setup_returns_read',client_id:C}),/client access/);
 const r0=await cc('ASSISTANT',{action:'client_setup_returns_read',client_id:C});assert.equal(r0.configured,false);assert.equal(r0.can_edit,false);assert.ok(r0.offered.every(o=>o.profile===null&&!o.chosen),'starter profiles are drafts, so none is in force yet');
 await assert.rejects(cc('ASSISTANT',{action:'client_setup_returns_choose',client_id:C,return_code:'NSSF',effective_from:'2026-01-01'}),/Manager or Partner/);
 await assert.rejects(cc('MANAGER',{action:'client_setup_returns_choose',client_id:C,return_code:'NSSF',effective_from:'2026-01-01'}),/No published export profile covers NSSF/);
 const list0=await ep('MANAGER',{action:'export_profile_list'});
 for(const code of ['NSSF','SHIF','PAYE_P10']){const pr=list0.profiles.find(x=>x.return_code===code);await ep('PARTNER',{action:'export_profile_publish',profile_id:pr.profile_id,revision:pr.revision,verified_against:'Fictional agency specification for the test',verified_on:'2026-11-15'});}
 const r1=await cc('MANAGER',{action:'client_setup_returns_read',client_id:C});assert.ok(r1.offered.every(o=>o.profile&&o.profile.version>=1),'published profiles are in force');assert.equal(r1.can_edit,true);
 await assert.rejects(cc('MANAGER',{action:'client_setup_returns_choose',client_id:C,return_code:'XX',effective_from:'2026-01-01'}),/Choose the return/);
 const ch=await cc('MANAGER',{action:'client_setup_returns_choose',client_id:C,return_code:'NSSF',effective_from:'2026-01-01',note:'Fictional: client files NSSF'});assert.equal(ch.chosen,true);
 await assert.rejects(cc('PARTNER',{action:'client_setup_returns_choose',client_id:C,return_code:'NSSF',effective_from:'2026-02-01'}),/already chosen/);
 const r2=await cc('MANAGER',{action:'client_setup_returns_read',client_id:C});assert.equal(r2.configured,true);assert.equal(r2.offered.find(o=>o.return_code==='NSSF').chosen,true);assert.equal(r2.history[0].selected_by_name,'Fictional MANAGER');
 // the database refuses an edit, a delete and an end by someone else
 await assert.rejects(as('MANAGER',()=>tx`update erp_private.client_payroll_returns set return_code='SHIF' where selection_id=${ch.selection_id}`),/cannot be edited/);
 await assert.rejects(as('MANAGER',()=>tx`delete from erp_private.client_payroll_returns where selection_id=${ch.selection_id}`),/./);
 await assert.rejects(cc('MANAGER',{action:'client_setup_returns_end',client_id:C,selection_id:ch.selection_id,revision:'1',effective_to:'2026-02-01',reason:'no'}),/Say why/);
 await assert.rejects(cc('MANAGER',{action:'client_setup_returns_end',client_id:C,selection_id:ch.selection_id,revision:'99',effective_to:'2026-06-30',reason:'Fictional: client stopped NSSF'}),/Refresh first/);
 const ended=await cc('MANAGER',{action:'client_setup_returns_end',client_id:C,selection_id:ch.selection_id,revision:String(r2.history[0].revision),effective_to:'2026-06-30',reason:'Fictional: client stopped NSSF'});assert.equal(ended.ended,true);
 await assert.rejects(cc('MANAGER',{action:'client_setup_returns_end',client_id:C,selection_id:ch.selection_id,revision:'2',effective_to:'2026-07-31',reason:'Fictional: again'}),/already ended|Refresh first/);
 const r3=await cc('MANAGER',{action:'client_setup_returns_read',client_id:C});assert.equal(r3.history[0].status,'Ended');assert.equal(r3.history[0].ended_reason,'Fictional: client stopped NSSF');assert.equal(r3.offered.find(o=>o.return_code==='NSSF').chosen,false,'history is kept and the return can be chosen again');
 await cc('MANAGER',{action:'client_setup_returns_choose',client_id:C,return_code:'NSSF',effective_from:'2026-07-01'});
 assert.equal((await tx`select count(*)::int n from erp_private.client_payroll_returns where client_id=${C}`)[0].n,2,'ended choice and the new one are both on record');

 // ---- tax rule exceptions ----
 await db.exec('set session_replication_role=replica');
 for(const k of ['FICT_RULE_A','FICT_RULE_B'])await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,created_by,approved_by,approved_at) values(${k},'VAT',${'Fictional '+k},'2026-01-01','2099-12-31','{"rate":0.16}'::jsonb,'https://example.invalid/fictional','Fictional source note for the test','Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now())`;
 await db.exec('set session_replication_role=origin');
 const key=(await tx`select rate_key from erp_private.tax_rates where deleted_at is null and status in('Approved','Testing') order by rate_key limit 1`)[0].rate_key;
 const prop={action:'client_setup_exception_propose',client_id:C,rate_key:key,kind:'NOT_APPLICABLE',effective_from:'2026-01-01',reason:'Fictional: the client makes only exempt supplies this year.',legal_basis:'Fictional: VAT Act schedule reference'};
 await assert.rejects(cc('ASSISTANT',prop),/Manager or Partner/);
 await assert.rejects(cc('MANAGER',{...prop,rate_key:'NOT_A_RULE'}),/central library/);
 await assert.rejects(cc('MANAGER',{...prop,reason:'too short'}),/20 to 1,000/);
 await assert.rejects(cc('MANAGER',{...prop,legal_basis:'x'}),/legal basis/);
 const made=await cc('MANAGER',prop);assert.equal(made.proposed,true);
 await assert.rejects(cc('MANAGER',prop),/already waiting/);
 const x0=await cc('MANAGER',{action:'client_setup_exceptions_read',client_id:C}),e0=x0.exceptions[0];
 assert.equal(e0.status,'Draft');assert.equal(e0.mine,true);assert.equal(x0.can_approve,false,'a Manager without the Tax Lead right cannot approve');
 const dec=(role,extra={})=>cc(role,{action:'client_setup_exception_decide',client_id:C,exception_id:made.exception_id,revision:e0.revision,outcome:'Approve',...extra});
 // the queue shows it; own proposal does not need the proposer's action
 const q1=await tasks('MANAGER');assert.equal(q1.tasks.find(t=>t.kind==='exception_review').blocked_mine,1);assert.equal(q1.tasks.find(t=>t.kind==='exception_review').needs_me,false);
 assert.equal((await tasks('PARTNER')).tasks.find(t=>t.kind==='exception_review').needs_me,true);
 // maker-checker: nobody approves their own proposal, and a plain Manager cannot approve at all
 await assert.rejects(dec('MANAGER'),/A Partner, or the Tax Lead|proposed this exception/);
 await assert.rejects(dec('MANAGER2'),/A Partner, or the Tax Lead/);
 // the database holds the same line even if the action were bypassed
 await assert.rejects(as('MANAGER2',()=>tx`update erp_private.client_tax_exceptions set status='Active',approved_by=${actors.MANAGER2.staff_id},approved_at=now() where exception_id=${made.exception_id}`),/Partner, or the Tax Lead/);
 await assert.rejects(as('MANAGER',()=>tx`update erp_private.client_tax_exceptions set reason='Fictional: edited after the fact to something longer' where exception_id=${made.exception_id}`),/cannot be edited/);
 // the Tax Lead right lets a Manager approve, but never their own proposal
 await rights('PARTNER',{action:'staff_right_grant',staff_id:actors.MANAGER2.staff_id,capability:'APPROVE_TAX_RULES',reason:'Designated Tax Lead for the test',expires_on:new Date(Date.now()+100*86400000).toISOString().slice(0,10)});
 assert.equal((await cc('MANAGER2',{action:'client_setup_exceptions_read',client_id:C})).can_approve,true);
 // a second proposal by the Tax Lead, to show the Tax Lead cannot approve it
 const k2=(await tx`select rate_key from erp_private.tax_rates where deleted_at is null and status in('Approved','Testing') and rate_key<>${key} order by rate_key limit 1`)[0]?.rate_key||key;
 if(k2!==key){const m2=await cc('MANAGER2',{...prop,rate_key:k2});const read=await cc('MANAGER2',{action:'client_setup_exceptions_read',client_id:C});const row=read.exceptions.find(x=>x.exception_id===m2.exception_id);
  await assert.rejects(cc('MANAGER2',{action:'client_setup_exception_decide',client_id:C,exception_id:m2.exception_id,revision:row.revision,outcome:'Approve'}),/proposed this exception/);
  await cc('MANAGER2',{action:'client_setup_exception_decide',client_id:C,exception_id:m2.exception_id,revision:row.revision,outcome:'Withdraw',reason:'Fictional: proposed in error'});}
 const ok=await dec('MANAGER2');assert.equal(ok.approved,true);
 const row=(await tx`select status,approved_by,created_by from erp_private.client_tax_exceptions where exception_id=${made.exception_id}`)[0];
 assert.equal(row.status,'Active');assert.equal(row.approved_by,actors.MANAGER2.staff_id);assert.notEqual(row.approved_by,row.created_by);
 await assert.rejects(dec('PARTNER'),/Refresh first|not waiting/);
 // only one approved exception per rule and dates
 await cc('MANAGER',prop).then(async p2=>{const rd=await cc('MANAGER',{action:'client_setup_exceptions_read',client_id:C}),r2x=rd.exceptions.find(x=>x.exception_id===p2.exception_id);
  await assert.rejects(cc('PARTNER',{action:'client_setup_exception_decide',client_id:C,exception_id:p2.exception_id,revision:r2x.revision,outcome:'Approve'}),/already covers some of these dates/);
  await cc('MANAGER',{action:'client_setup_exception_decide',client_id:C,exception_id:p2.exception_id,revision:r2x.revision,outcome:'Withdraw',reason:'Fictional: duplicate of the approved one'});});
 // ending needs a reason and a date; an approved exception is never edited or deleted
 const rd2=await cc('MANAGER',{action:'client_setup_exceptions_read',client_id:C}),live=rd2.exceptions.find(x=>x.exception_id===made.exception_id);
 await assert.rejects(cc('MANAGER',{action:'client_setup_exception_close',client_id:C,exception_id:made.exception_id,revision:live.revision,effective_to:'2026-06-30',reason:'short'}),/Say why/);
 await assert.rejects(as('MANAGER',()=>tx`delete from erp_private.client_tax_exceptions where exception_id=${made.exception_id}`),/./);
 const end=await cc('MANAGER',{action:'client_setup_exception_close',client_id:C,exception_id:made.exception_id,revision:live.revision,effective_to:'2026-06-30',reason:'Fictional: the client began making taxable supplies'});assert.equal(end.ended,true);
 const rd3=await cc('MANAGER',{action:'client_setup_exceptions_read',client_id:C});
 const fin=rd3.exceptions.find(x=>x.exception_id===made.exception_id);assert.equal(fin.status,'Ended');assert.equal(fin.approved_by_name,'Fictional MANAGER2');assert.equal(fin.closed_reason,'Fictional: the client began making taxable supplies');
 assert.equal(rd3.exceptions.filter(x=>x.status==='Withdrawn').length>=1,true,'withdrawn proposals stay on record');
 const audit=await tx`select count(*)::int n from erp_private.audit_events where table_name in('client_tax_exceptions','client_payroll_returns')`;assert.ok(audit[0].n>=8,'every change is in the audit trail');
});
