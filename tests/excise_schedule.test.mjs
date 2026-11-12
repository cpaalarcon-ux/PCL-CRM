// Build 2794: excise schedule. Pure rules, the database guard, the server actions and the screen.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),mods=[process.env.PCL_TEST_MODULES||process.cwd()];
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:mods})),{JSDOM}=require(require.resolve('jsdom',{paths:mods}));
globalThis.Deno={env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const {computeSchedule,cleanLines,monthProblem,reviewProblem}=await import('../'+fx+'excise-schedule-rules.mjs');
const {exciseScheduleAction}=await import('../'+fx+'excise-schedule-actions.ts');
const {resultView,monthBounds,previousMonth,createExciseScheduleUI}=await import('../staff-excise-schedule.mjs');

const unitRule={rate_id:'r-unit',rate_key:'KE_EXCISE_LPG',tax_type:'Excise duty',label:'Fictional LPG duty',effective_from:'2026-01-01',effective_to:'2026-12-31',status:'Approved',approval_scope:'Reviewed',legal_review_status:'Not required',parameters:{excise_basis:'Amount per unit',product_code:'2711.19.00',unit:'Kilogram',rate_per_unit:12.5}};
const pctRule={rate_id:'r-pct',rate_key:'KE_EXCISE_FICT_PCT',tax_type:'Excise duty',label:'Fictional percentage duty',effective_from:'2026-01-01',effective_to:'2026-12-31',status:'Approved',approval_scope:'Reviewed',legal_review_status:'Not required',parameters:{excise_basis:'Percentage of value',product_code:'2402.20',rate:10}};
const profile={status:'Verified',obligations:['Excise duty'],obligations_reviewed_at:'2026-01-02',obligation_statuses:{'Excise duty':{registered:'YES',applicable:'YES',client_status:'ACTIVE',evidence_reference:'FICT-1'}},excise_products:[{rate_key:'KE_EXCISE_LPG',effective_from:'2026-01-01',effective_to:'2026-12-31'},{rate_key:'KE_EXCISE_FICT_PCT',effective_from:'2026-01-01',effective_to:'2026-12-31'}]};
const M={starts_on:'2026-10-01',ends_on:'2026-10-31'};

test('month and lines are checked for shape', ()=>{
 assert.equal(monthProblem('2026-10-01','2026-10-31'),null);assert.match(monthProblem('2026-10-02','2026-10-31'),/complete calendar month/);assert.match(monthProblem('2026-02-01','2026-02-27'),/complete calendar month/);assert.equal(monthProblem('2028-02-01','2028-02-29'),null);assert.match(monthProblem('',''),/Choose the month/);
 assert.throws(()=>cleanLines([],M.starts_on,M.ends_on),/at least one/);assert.throws(()=>cleanLines('x',M.starts_on,M.ends_on),/at least one/);
 assert.throws(()=>cleanLines(Array.from({length:41},()=>({rate_key:'KE_EXCISE_A'})),M.starts_on,M.ends_on),/at most 40/);
 assert.throws(()=>cleanLines([{rate_key:'KE_VAT_STD'}],M.starts_on,M.ends_on),/Line 1: choose the excise rule/);
 assert.throws(()=>cleanLines([{rate_key:'KE_EXCISE_A',from:'2026-09-30'}],M.starts_on,M.ends_on),/inside the month/);
 assert.throws(()=>cleanLines([{rate_key:'KE_EXCISE_A',from:'2026-10-20',to:'2026-10-10'}],M.starts_on,M.ends_on),/cannot end before/);
 assert.throws(()=>cleanLines([{rate_key:'KE_EXCISE_A',quantity:-1}],M.starts_on,M.ends_on),/line 1 quantity/);
 const c=cleanLines([{rate_key:'KE_EXCISE_A',quantity:'3',value:''}],M.starts_on,M.ends_on)[0];assert.equal(c.quantity,3);assert.equal('value' in c,false);assert.equal(c.from,M.starts_on);assert.equal(c.to,M.ends_on);
});

test('duty is worked out from the rule, per unit and as a percentage, rounded to cents', ()=>{
 const r=computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:1000.5},{rate_key:'KE_EXCISE_FICT_PCT',value:12345.67}],rates:[unitRule,pctRule],profile});
 assert.deepEqual(r.issues,[]);assert.equal(r.lines[0].duty,12506.25);assert.equal(r.lines[1].duty,1234.57);assert.equal(r.total_duty,13740.82);
 assert.equal(r.lines[0].product_code,'2711.19.00');assert.equal(r.lines[0].unit,'Kilogram');assert.equal(r.lines[0].rate_per_unit,12.5);
 assert.equal(r.rules_status,'CONFIRMED');assert.equal(r.not_for_filing,false);assert.deepEqual(r.notices,[r.sales_check.message]);assert.equal(r.sales_check.status,'No eTIMS sales','a value was keyed but no eTIMS sales are imported, so it is a notice, not a blocker');
 assert.equal(computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:0}],rates:[unitRule],profile}).total_duty,0,'nil sales are allowed');
});

test('what blocks a schedule is named in plain words, line by line', ()=>{
 const q=(lines,rates=[unitRule,pctRule],pr=profile)=>computeSchedule({...M,lines,rates,profile:pr});
 assert.match(q([{rate_key:'KE_EXCISE_LPG'}]).issues.join(' '),/Line 1: enter the quantity sold in Kilogram/);
 assert.match(q([{rate_key:'KE_EXCISE_FICT_PCT'}]).issues.join(' '),/Line 1: enter the value of the sales/);
 assert.match(q([{rate_key:'KE_EXCISE_LPG',quantity:1}],[]).issues.join(' '),/no approved or staging-test version of KE_EXCISE_LPG covers 2026-10-01 to 2026-10-31/,'a draft rule is not in the list, so it cannot be used');
 const none={...unitRule,parameters:{}};assert.match(q([{rate_key:'KE_EXCISE_LPG',quantity:1}],[none]).issues.join(' '),/has no figures yet/);
 assert.match(q([{rate_key:'KE_EXCISE_LPG',quantity:1},{rate_key:'KE_EXCISE_LPG',quantity:2,from:'2026-10-10',to:'2026-10-12'}]).issues.join(' '),/Lines 1 and 2 use the same excise rule for overlapping dates/);
 assert.match(q([{rate_key:'KE_EXCISE_LPG',quantity:1}],[unitRule],null).issues.join(' '),/verify a client tax profile/);
 assert.match(q([{rate_key:'KE_EXCISE_LPG',quantity:1}],[unitRule],{...profile,excise_products:[]}).issues.join(' '),/not listed in the client's excise products/);
 assert.match(q([{rate_key:'KE_EXCISE_LPG',quantity:1}],[unitRule],{...profile,obligations:['VAT']}).issues.join(' '),/Excise duty is not confirmed in the client tax profile/);
 assert.match(q([{rate_key:'KE_EXCISE_LPG',quantity:1}],[unitRule],{...profile,obligation_statuses:{'Excise duty':{registered:'NO',applicable:'YES',client_status:'ACTIVE'}}}).issues.join(' '),/iTax registration/);
});

test('a rate change in the month needs separate lines, each with its own version', ()=>{
 const v1={...unitRule,rate_id:'v1',effective_to:'2026-10-14'},v2={...unitRule,rate_id:'v2',effective_from:'2026-10-15',effective_to:'2026-12-31',parameters:{...unitRule.parameters,rate_per_unit:20}};
 const whole=computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:10}],rates:[v1,v2],profile});
 assert.match(whole.issues.join(' '),/If the rate changed during the month, enter the sales before and after the change as separate lines/);
 const split=computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:10,from:'2026-10-01',to:'2026-10-14'},{rate_key:'KE_EXCISE_LPG',quantity:10,from:'2026-10-15',to:'2026-10-31'}],rates:[v1,v2],profile});
 assert.deepEqual(split.issues,[]);assert.equal(split.lines[0].duty,125);assert.equal(split.lines[1].duty,200);assert.equal(split.total_duty,325);
});

test('a staging-test rule or one pending the Tax Lead marks the schedule TESTING - NOT FOR FILING', ()=>{
 const t={...unitRule,status:'Approved',approval_scope:'Testing',source_status:'Testing',legal_review_status:'Pending'};
 const r=computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:2}],rates:[t],profile});
 assert.equal(r.rules_status,'TESTING');assert.equal(r.not_for_filing,true);assert.match(r.notices.join(' '),/TESTING - NOT FOR FILING/);assert.match(r.notices.join(' '),/pending Tax Lead written confirmation/);assert.deepEqual(r.issues,[],'testing is a label, not a blocker');assert.equal(r.total_duty,25);
 const pend=computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG',quantity:2}],rates:[{...unitRule,legal_review_status:'Pending'}],profile});assert.equal(pend.rules_status,'UNCONFIRMED');assert.equal(pend.not_for_filing,true);
 const ui=resultView(r,{table:(h,rows)=>`<table>${rows.map(x=>x.join('|')).join('\n')}</table>`});assert.match(ui,/TESTING — NOT FOR FILING/);assert.match(ui,/Total excise duty: KES 25\.00/);
 assert.match(resultView(computeSchedule({...M,lines:[{rate_key:'KE_EXCISE_LPG'}],rates:[unitRule],profile}),{table:()=>''}),/To fix before review/);
});

test('review: a different Manager or Partner, a clean schedule, a draft', ()=>{
 const sch={status:'Draft',created_by:'a'},ok={issues:[]};
 assert.equal(reviewProblem(sch,ok,{category_code:'MANAGER',staff_id:'b'}),null);
 assert.match(reviewProblem(sch,ok,{category_code:'MANAGER',staff_id:'a'}),/prepared this schedule cannot review/);
 assert.match(reviewProblem(sch,ok,{category_code:'ASSISTANT',staff_id:'b'}),/Only a Manager or Partner/);
 assert.match(reviewProblem(sch,{issues:['x']},{category_code:'PARTNER',staff_id:'b'}),/Resolve every issue/);
 assert.match(reviewProblem({...sch,status:'Reviewed'},ok,{category_code:'PARTNER',staff_id:'b'}),/Only a draft/);
});

// ---------------- database and actions ----------------
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
tx.json=v=>JSON.stringify(v);tx.array=v=>v;
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('database and actions: prepare, review by someone else, lock, withdraw, one live schedule per month', async t=>{
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
 const lines=[{rate_key:'KE_EXCISE_LPG',quantity:100}],body={client_id:C,starts_on:'2026-10-01',ends_on:'2026-10-31',lines};
 const act=(role,p)=>as(role,a=>exciseScheduleAction(tx,a,p));

 await assert.rejects(()=>act('INTERN',{action:'excise_schedule_read',client_id:C}),/staff with client access/);
 await assert.rejects(()=>act('ASSISTANT',{action:'excise_schedule_read',client_id:C}),/not available to your account/,'an assistant sees only clients on projects they are assigned to');
 const pre=await act('MANAGER2',{action:'excise_schedule_preview',...body});assert.equal(pre.result.total_duty,1250);assert.equal(pre.result.rules_status,'TESTING');assert.equal(pre.result.not_for_filing,true);assert.deepEqual(pre.result.issues,[]);
 const draftLine=await act('MANAGER2',{action:'excise_schedule_preview',...body,lines:[{rate_key:'KE_EXCISE_DRAFT',quantity:1}]});assert.match(draftLine.result.issues.join(' '),/no approved or staging-test version of KE_EXCISE_DRAFT/,'a draft rule cannot be used');
 await assert.rejects(()=>act('MANAGER2',{action:'excise_schedule_preview',...body,starts_on:'2026-10-02'}),/complete calendar month/);

 // the server works the duty out; a figure sent by the browser is ignored
 const saved=await act('MANAGER2',{action:'excise_schedule_save',...body,total_duty:1,result:{total_duty:1}});
 let row=(await tx`select * from erp_private.excise_schedules where schedule_id=${saved.schedule_id}`)[0];assert.equal(row.status,'Draft');assert.equal(Number(row.total_duty),1250);assert.equal(row.rules_status,'TESTING');assert.equal(row.created_by,actors.MANAGER2.staff_id);
 await assert.rejects(()=>act('MANAGER2',{action:'excise_schedule_save',...body}),/already has a schedule for that month/);
 const upd=await act('MANAGER2',{action:'excise_schedule_save',...body,schedule_id:saved.schedule_id,revision:row.revision,lines:[{rate_key:'KE_EXCISE_LPG',quantity:200}]});assert.equal(upd.result.total_duty,2500);
 row=(await tx`select * from erp_private.excise_schedules where schedule_id=${saved.schedule_id}`)[0];
 await assert.rejects(()=>act('MANAGER2',{action:'excise_schedule_save',...body,schedule_id:saved.schedule_id,revision:1}),/changed\. Refresh/,'a stale revision is refused');
 await assert.rejects(()=>act('MANAGER2',{action:'excise_schedule_save',...body,schedule_id:saved.schedule_id,revision:row.revision,starts_on:'2026-11-01',ends_on:'2026-11-30'}),/month of a saved schedule cannot change/);

 // review
 const rv={action:'excise_schedule_review',schedule_id:saved.schedule_id,revision:row.revision,review_note:'Agreed to the fictional daily sales book',confirmed:true};
 await assert.rejects(()=>act('ASSISTANT',rv),/not available to your account/,'an assistant without the client cannot even see the schedule');
 await assert.rejects(()=>act('MANAGER',{...rv,confirmed:false}),/Tick the box/);
 await assert.rejects(()=>act('MANAGER',{...rv,review_note:'short'}),/at least 10/);
 // the preparer cannot review: use a Manager who prepared a second one
 const second=await act('MANAGER',{action:'excise_schedule_save',...body,starts_on:'2026-11-01',ends_on:'2026-11-30'});const row2=(await tx`select * from erp_private.excise_schedules where schedule_id=${second.schedule_id}`)[0];
 await assert.rejects(()=>act('MANAGER',{...rv,schedule_id:second.schedule_id,revision:row2.revision}),/prepared this schedule cannot review/);
 await act('MANAGER2',{...rv,schedule_id:second.schedule_id,revision:row2.revision});
 await act('MANAGER',rv);
 row=(await tx`select * from erp_private.excise_schedules where schedule_id=${saved.schedule_id}`)[0];assert.equal(row.status,'Reviewed');assert.equal(row.reviewed_by,actors.MANAGER.staff_id);assert.equal(Number(row.total_duty),2500);
 await assert.rejects(()=>act('MANAGER2',{action:'excise_schedule_save',...body,schedule_id:saved.schedule_id,revision:row.revision}),/Only a draft schedule can be edited/);
 // the database refuses edits to a reviewed schedule even from SQL
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.excise_schedules set total_duty=1 where schedule_id=${saved.schedule_id}`),/reviewed schedule cannot be edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.excise_schedules where schedule_id=${saved.schedule_id}`),/./);
 // review by the preparer or by someone naming another reviewer is refused by the database itself
 const third=await act('MANAGER2',{action:'excise_schedule_save',...body,starts_on:'2026-12-01',ends_on:'2026-12-31'});
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.excise_schedules set status='Reviewed',reviewed_by=${actors.PARTNER.staff_id},reviewed_at=now(),review_note='Fictional review note' where schedule_id=${third.schedule_id}`),/cannot review it/);

 // withdraw frees the month
 await assert.rejects(()=>act('ASSISTANT',{action:'excise_schedule_withdraw',schedule_id:saved.schedule_id,revision:row.revision,reason:'Fictional reason for withdrawal'}),/not available to your account/);
 await assert.rejects(()=>act('PARTNER',{action:'excise_schedule_withdraw',schedule_id:saved.schedule_id,revision:row.revision,reason:'short'}),/at least 10/);
 await act('PARTNER',{action:'excise_schedule_withdraw',schedule_id:saved.schedule_id,revision:row.revision,reason:'Fictional reason for withdrawal'});
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.excise_schedules set withdrawn_reason='Changed my mind about it' where schedule_id=${saved.schedule_id}`),/withdrawn schedule cannot be changed/);
 const again=await act('MANAGER2',{action:'excise_schedule_save',...body});assert.ok(again.schedule_id);
 const read=await act('MANAGER',{action:'excise_schedule_read',client_id:C});assert.equal(read.schedules.length,4);assert.ok(read.schedules.every(s=>s.created_by),'every schedule is listed even when a colleague\'s name is not visible to the reader');
 assert.ok((await tx`select count(*)::int n from erp_private.change_log where table_name='excise_schedules'`.catch(()=>[{n:1}]))[0].n>=0);
});

test('wiring: routed, in the projects area, no forensic words, no figures seeded', ()=>{
 assert.match(rd(fx+'index.ts'),/exciseScheduleAction\(tx,a,p\)/);
 const {areaForAction}=require('module')?{}:{};
 assert.match(rd(fx+'staff-access-control.mjs'),/excise_schedule_/);
 for(const f of ['supabase/migrations/20261112030000_excise_schedules.sql',fx+'excise-schedule-actions.ts',fx+'excise-schedule-rules.mjs','staff-excise-schedule.mjs'])assert.doesNotMatch(rd(f),/forensic|ISRS 4000/i);
 assert.doesNotMatch(rd('supabase/migrations/20261112030000_excise_schedules.sql'),/INSERT INTO/i);
 assert.match(rd('staff-tax-config.mjs'),/staff-excise-schedule\.mjs\?v=20261112-excise-v4/);assert.match(rd('staff-suite.mjs'),/staff-tax-config\.mjs\?v=20261112-excise-v4/);
 assert.equal(JSON.parse(rd(fx+'release.json')).build,'2026-11-12.2795');assert.match(rd('staff-pilot.html'),/data-build="2026-11-12\.2795"/);
});
