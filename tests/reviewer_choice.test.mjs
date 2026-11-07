import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {reviewQueueAction}=await import('../supabase/functions/staff-workspace-v12/review-queue.ts');
const {clientChartAction}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,{download:async()=>({data:null})}));

const queue=(role)=>as(role,a=>reviewQueueAction(tx,a,{action:'v3_review_queue'}));
test('a preparer can name the reviewer; only that reviewer or a Partner decides; the Home list shows it',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'RVQA','Fictional review firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','MANAGER3','ASSISTANT']){const cat=role.replace(/\d/,'');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional review client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional review project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id};
 const submit=(extra)=>ledger('MANAGER',{...base,action:'ledger_report_submit',report_kind:'Month',as_of:'2026-01-31',prepared_note:'January figures agree to the fictional schedules.',...extra});
 const review=(role,rv,status='Approved')=>ledger(role,{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status,review_note:'Checked to the fictional schedules.'});
 const read=async role=>(await ledger(role,{...base,action:'ledger_read',as_of:'2026-12-31'}));

 const r0=await read('MANAGER');
 assert.deepEqual(r0.reviewers.map(x=>x.full_name).sort(),['Fictional MANAGER2','Fictional MANAGER3','Fictional PARTNER'],'reviewers are the other Managers and Partners, never the preparer or an Assistant');
 await assert.rejects(()=>submit({requested_reviewer_id:actors.MANAGER.staff_id}),/other than yourself/);
 await assert.rejects(()=>submit({requested_reviewer_id:actors.ASSISTANT.staff_id}),/not a Manager or Partner available/);
 await submit({requested_reviewer_id:actors.MANAGER2.staff_id});
 let rv=(await read('MANAGER')).report_reviews[0];
 assert.equal(rv.requested_reviewer_id,actors.MANAGER2.staff_id);assert.equal(rv.requested_reviewer_name,'Fictional MANAGER2');

 assert.deepEqual((await queue('MANAGER')).items,[],'the preparer never reviews their own submission');
 const q2=(await queue('MANAGER2')).items,q3=(await queue('MANAGER3')).items,qp=(await queue('PARTNER')).items;
 assert.equal(q2.length,1);assert.equal(q2[0].sent_to_me,true);assert.equal(q2[0].kind,'report');assert.equal(q2[0].client_name,'Fictional review client');
 assert.equal(q3.length,0,'a Manager it was not sent to does not see it');assert.equal(qp.length,1,'a Partner can always step in');assert.equal(qp[0].sent_to_me,false);
 assert.deepEqual((await queue('ASSISTANT')).items,[]);

 await assert.rejects(()=>review('MANAGER3',rv),/sent to Fictional MANAGER2/);
 await review('MANAGER2',rv);
 assert.equal((await read('MANAGER')).report_reviews[0].status,'Approved');
 assert.equal((await queue('MANAGER2')).items.length,0,'a decided item leaves the list');

 // blank choice: any Manager or Partner may take it; Partner override works for a named reviewer too
 await submit({as_of:'2026-02-28'});
 rv=(await read('MANAGER')).report_reviews.find(x=>x.status==='Submitted');assert.equal(rv.requested_reviewer_id,null);
 assert.equal((await queue('MANAGER3')).items.length,1);await review('MANAGER3',rv,'Returned');
 await submit({as_of:'2026-03-31',report_kind:'Quarter',requested_reviewer_id:actors.MANAGER3.staff_id});
 rv=(await read('MANAGER')).report_reviews.find(x=>x.status==='Submitted');await assert.rejects(()=>review('MANAGER2',rv),/sent to Fictional MANAGER3/);await review('PARTNER',rv);
 
 // Ledger journals are the unit of independent review: a submitted journal is listed for every Manager or Partner except the people who prepared it.
 const computer=(await ledger('ASSISTANT',{action:'ledger_periods',project_id:P})).rates.find(x=>x.class_code==='COMPUTER');assert.ok(computer);
 const asset=await ledger('MANAGER',{...base,action:'ledger_asset_save',asset_name:'Fictional queue laptop',asset_account:'15006',rate_id:computer.rate_id,first_use_date:'2026-01-01',cost:100000,business_percentage:100,noncommercial_vehicle:false,evidence:'Fictional invoice, ownership and first-use evidence'});
 const arev=async()=>(await ledger('MANAGER',{...base,action:'ledger_asset_read',asset_id:asset.asset_id})).asset.revision;
 await ledger('MANAGER',{...base,action:'ledger_asset_submit',asset_id:asset.asset_id,revision:await arev()});
 const charge=await ledger('MANAGER',{...base,action:'ledger_depreciation_create',asset_id:asset.asset_id,starts_on:'2026-01-01',ends_on:'2026-12-31',reference:'DEP-Q1',evidence:'Fictional annual class-rate calculation'});
 const jrev=async()=>(await ledger('MANAGER',{...base,action:'ledger_journal_read',journal_id:charge.journal_id})).journal.revision;
 assert.deepEqual((await queue('PARTNER')).items.filter(x=>x.kind==='journal'),[],'a draft journal is not yet in the queue');
 await ledger('MANAGER',{...base,action:'ledger_journal_submit',journal_id:charge.journal_id,revision:await jrev()});
 const jq=async role=>(await queue(role)).items.filter(x=>x.kind==='journal');
 assert.deepEqual(await jq('MANAGER'),[],'the preparer never reviews their own journal');
 assert.deepEqual(await jq('ASSISTANT'),[],'an Assistant does not see the review list');
 for(const role of ['MANAGER2','MANAGER3','PARTNER']){const it=await jq(role);assert.equal(it.length,1,role+' sees the submitted journal');assert.equal(it[0].id,charge.journal_id);assert.equal(it[0].project_id,P);assert.equal(it[0].period_id,base.period_id);assert.equal(it[0].client_name,'Fictional review client');assert.ok(it[0].submitted_at);}
 await ledger('MANAGER2',{...base,action:'ledger_journal_review',journal_id:charge.journal_id,revision:await jrev(),status:'Posted',review_note:'Fictional independent review of class, rate and charge.'});
 assert.deepEqual(await jq('PARTNER'),[],'a posted journal leaves the queue');
});
