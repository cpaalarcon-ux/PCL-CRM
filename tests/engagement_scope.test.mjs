import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientScopeAction}=await import('../supabase/functions/staff-workspace-v12/client-scope-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const sx=(role,p)=>as(role,a=>clientScopeAction(tx,a,p));
test('build 2864: work before the engagement scope is refused unless a Partner approves an override; opening balances are exempt',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 const S=actors.MANAGER.staff_id,Y=actors.PARTNER.staff_id;
 const period=(starts,ends,p=P)=>tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${p},${C},${F},${starts},${ends},'Limited company','Fictional certificate',${S}) returning period_id`;
 const journal=(per,kind,date,ref)=>tx`insert into erp_private.ledger_journals(period_id,project_id,kind,journal_date,reference,prepared_by,last_prepared_by) values(${per},${P},${kind},${date},${ref},${S},${S})`;
 const work=(a,b,kind='Annually')=>tx`insert into erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on) values(${P},${kind},${a},${b})`;
 // No scope recorded: nothing is gated, and the read says so.
 await work('2024-01-01','2024-12-31','Once-off');
 const r0=await sx('ASSISTANT',{action:'client_scope_read',client_id:C});assert.equal(r0.live.length,0);assert.match(r0.note,/./);
 // Who may record. A Manager records a scope that starts on the appointment date; a back-dated start is a Partner's decision.
 await assert.rejects(()=>sx('INTERN',{action:'client_scope_read',client_id:C}),/client access/);
 await assert.rejects(()=>sx('ASSISTANT',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2026-11-15',scope_start_date:'2026-11-15'}),/Manager or Partner/);
 await assert.rejects(()=>sx('MANAGER',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2026-11-15',scope_start_date:'2024-01-01'}),/Partner/);
 await assert.rejects(()=>sx('PARTNER',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2099-01-01',scope_start_date:'2099-01-01'}),/./,'an engagement date in the future is refused');
 await assert.rejects(()=>sx('PARTNER',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2026-11-15',scope_start_date:'2026-01-01',scope_end_date:'2025-12-31'}),/./,'the end cannot be before the start');
 const rec=await sx('PARTNER',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2026-11-15',scope_start_date:'2026-01-01',note:'Engaged for the 2026 year'});assert.equal(rec.ok,true);assert.equal(rec.live.length,1);
 // Replacing needs a Partner and a reason; the old scope is kept as history.
 await assert.rejects(()=>sx('MANAGER',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2026-11-15',scope_start_date:'2026-01-01'}),/Partner replaces/);
 await assert.rejects(()=>sx('PARTNER',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2026-11-15',scope_start_date:'2025-01-01'}),/why it is being replaced/);
 // Inside the scope: allowed. Before it: refused by the database, whichever screen it comes from.
 await period('2025-07-01','2026-06-30');const perS=(await tx`select period_id from erp_private.ledger_periods where ends_on='2026-06-30'`)[0].period_id;
 await assert.rejects(()=>period('2025-01-01','2025-12-31'),/TEMPORAL_BLOCK: This falls before the engagement scope, which starts on 1 Jan 2026/);
 await assert.rejects(()=>work('2025-01-01','2025-12-31'),/TEMPORAL_BLOCK/);
 await work('2026-01-01','2026-12-31');
 // A year that straddles the scope start is allowed (it ends inside the scope), but a posting dated before the start is refused.
 await journal(perS,'Sales','2026-03-31','S-2');
 await assert.rejects(()=>journal(perS,'Sales','2025-12-31','S-0'),/TEMPORAL_BLOCK/);
 // Opening balances and the prior-year trial balance are reference data: never refused, even for dates before the scope.
 await journal(perS,'Opening','2025-07-01','OPEN-1');
 // An override is asked for with a reason, judged by a different Partner, and then allows exactly that period.
 await assert.rejects(()=>sx('ASSISTANT',{action:'client_scope_override_request',client_id:C,firm_id:F,from_date:'2026-02-01',to_date:'2026-02-28',reason:'Already inside the scope'}),/already inside/);
 await assert.rejects(()=>sx('ASSISTANT',{action:'client_scope_override_request',client_id:C,firm_id:F,from_date:'2025-01-01',to_date:'2025-12-31',reason:'no'}),/./);
 await assert.rejects(()=>sx('INTERN',{action:'client_scope_override_request',client_id:C,firm_id:F,from_date:'2025-01-01',to_date:'2025-12-31',reason:'Client engaged us for the outstanding 2025 return'}),/client access/);
 const q=await sx('ASSISTANT',{action:'client_scope_override_request',client_id:C,firm_id:F,from_date:'2025-01-01',to_date:'2025-12-31',reason:'Client engaged us for the outstanding 2025 return'});assert.equal(q.already,false);
 assert.equal((await sx('ASSISTANT',{action:'client_scope_override_request',client_id:C,firm_id:F,from_date:'2025-03-01',to_date:'2025-03-31',reason:'Same request again'})).already,true,'a request already covering the period is not duplicated');
 await assert.rejects(()=>work('2025-01-01','2025-12-31','Quarterly'),/TEMPORAL_BLOCK/,'asking is not approval');
 await assert.rejects(()=>sx('MANAGER',{action:'client_scope_override_decide',client_id:C,override_id:q.override_id,decision:'Approve'}),/Partner/);
 assert.equal((await sx('PARTNER',{action:'client_scope_queue'})).requests.length,1);
 await assert.rejects(()=>sx('PARTNER',{action:'client_scope_override_decide',client_id:C,override_id:q.override_id,decision:'Reject'}),/Say why/);
 const ap=await sx('PARTNER2',{action:'client_scope_override_decide',client_id:C,override_id:q.override_id,decision:'Approve',note:'Engagement letter covers it'});assert.equal(ap.status,'Approved');assert.equal(ap.sole_partner_approval,false);
 await assert.rejects(()=>sx('PARTNER',{action:'client_scope_override_decide',client_id:C,override_id:q.override_id,decision:'Approve'}),/already been decided/);
 await work('2025-01-01','2025-12-31','Quarterly');
 await assert.rejects(()=>work('2024-01-01','2024-12-31','Quarterly'),/TEMPORAL_BLOCK/,'an override covers its own period only');
 // A rejected request keeps the work blocked; a decided request is history.
 const q2=await sx('ASSISTANT',{action:'client_scope_override_request',client_id:C,firm_id:F,from_date:'2024-01-01',to_date:'2024-12-31',reason:'Tidy up the 2024 books'});
 const rj=await sx('PARTNER',{action:'client_scope_override_decide',client_id:C,override_id:q2.override_id,decision:'Reject',note:'Not engaged for 2024'});assert.equal(rj.status,'Rejected');
 await assert.rejects(()=>work('2024-01-01','2024-12-31','Quarterly'),/TEMPORAL_BLOCK/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.scope_overrides set status='Approved' where override_id=${q2.override_id}`),/history|cannot change/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.scope_overrides set reason='Changed quietly' where override_id=${q.override_id}`),/history|cannot change/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.scope_overrides`),/archived|deleted|permission denied|not/i);
 // The firm's only Partner may approve their own request; it is recorded as such.
  const q3=await sx('PARTNER',{action:'client_scope_override_request',client_id:C,firm_id:F,from_date:'2023-01-01',to_date:'2023-06-30',reason:'Partner asks for an old period'});
 await assert.rejects(()=>sx('PARTNER',{action:'client_scope_override_decide',client_id:C,override_id:q3.override_id,decision:'Approve'}),/different Partner/,'with two Partners, you do not approve your own request');
 await tx`update erp_private.staff_members set access_status='Inactive' where staff_id=${actors.PARTNER2.staff_id}`;
 const sole=await sx('PARTNER',{action:'client_scope_override_decide',client_id:C,override_id:q3.override_id,decision:'Approve'});assert.equal(sole.sole_partner_approval,true,'the only Partner may approve their own request; it is recorded');
 // Replacing the scope ends the old one with a reason and keeps it.
 const rep=await sx('PARTNER',{action:'client_scope_record',client_id:C,firm_id:F,engagement_date:'2026-11-15',scope_start_date:'2025-01-01',reason:'Engaged to file the late returns'});assert.equal(rep.replaced,true);
 await work('2025-01-01','2025-12-31','Once-off');await assert.rejects(()=>work('2024-01-01','2024-12-31','Weekly'),/TEMPORAL_BLOCK/);
 const r1=await sx('MANAGER',{action:'client_scope_read',client_id:C});assert.equal(r1.live.length,1);assert.equal(r1.scopes.length,2);assert.match(r1.scopes.find(s=>s.ended_at).ended_reason,/late returns/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_engagement_scopes set scope_start_date='2000-01-01' where ended_at is null`),/not edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_engagement_scopes set ended_reason='Changed' where ended_at is not null`),/history/);
});
test('the engagement scope screens and server are wired in',()=>{
 const rd=f=>fs.readFileSync(path.resolve(import.meta.dirname,'..',f),'utf8');
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/clientScopeAction\(tx,a,p\)/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/client_scope_\|/);
 const ui=rd('staff-engagement-scope.mjs');assert.match(ui,/client_scope_override_request/);assert.match(ui,/max="\$\{today\(\)\}"/);assert.match(ui,/data-pre-engagement/);
 assert.match(rd('staff-service-setup.mjs'),/plan\.scope&&plan\.scope\.needs_override/);
 assert.match(rd('staff-improvements.mjs'),/createScopeUI\(ctx\)/);assert.match(rd('staff-client-master.mjs'),/scopeButton\?scopeButton\(x\.client\.client_id\)/);
 const st=rd('supabase/functions/staff-workspace-v12/service-template-actions.ts');assert.match(st,/erp_private\.scope_block/);
});
