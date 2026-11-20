import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const X=await import('../supabase/functions/staff-workspace-v12/ppe-actions.ts');
const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
let per,MOTOR='',OTHER='';
let TB=[];const getTb=async()=>({tb:TB});
const run=(role,p,l)=>as(role,a=>X.ppeAction(tx,a,l||per,p,getTb,'2026-12-31'));
const asset=(o={})=>({action:'ledger_ppe_asset_declare',asset_name:'Fictional delivery van',asset_account:MOTOR,class_code:'MOTOR',origin:'Added in the year',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:1000000,business_percentage:100,evidence:'Invoice INV-001 and delivery note',...o});
const tbFor=cost=>[{code:MOTOR,name:'Motor vehicles',net:cost,movement_debit:cost,movement_credit:0},{code:'15920',name:'Accumulated depreciation, motor vehicles',net:-cost/4,movement_debit:0,movement_credit:cost/4},{code:'67030',name:'Depreciation, motor vehicles',net:cost/4,movement_debit:cost/4,movement_credit:0}];

test('build 2883: a year with no reviewed rate lists the gap, only a Partner adds the rate, and the register then works out the year',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${CL},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 MOTOR=(await tx`select code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy and name ilike '%motor%' and code not in('15920') order by code limit 1`)[0].code;
 const L=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
 const per27=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2027-01-01','2027-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 const run27=(role,p)=>as(role,a=>X.ppeAction(tx,a,per27,p,getTb,'2027-12-31'));
 // A brought-forward vehicle at 31 Dec 2026, approved by a second person.
 const d=await run('ASSISTANT',{action:'ledger_ppe_asset_declare',asset_name:'Fictional lorry',asset_account:MOTOR,class_code:'MOTOR',origin:'Brought forward',acquired_on:'2025-03-01',first_use_on:'2025-03-01',cost:1000000,business_percentage:100,bf_as_of:'2026-12-31',bf_accumulated_depreciation:250000,bf_tax_wdv:750000,evidence:'Fictional prior-year schedule for the fixture'});
 await run('MANAGER',{action:'ledger_ppe_asset_review',record_id:d.record_id,decision:'Approved'});
 TB=[];
 let r=await run27('MANAGER',{action:'ledger_ppe_read'});
 assert.equal(r.register.rate_gaps.length,1);const g=r.register.rate_gaps[0];assert.deepEqual([g.class_code,g.start,g.end,g.assets],['MOTOR','2027-01-01','2027-12-31',['Fictional lorry']]);
 assert.equal(g.fill.effective_from,'2027-01-01');assert.equal(g.fill.effective_to,'2027-12-31');assert.equal(g.fill.annual_rate,25);assert.equal(g.fill.expense_account,'67030');assert.equal('source_reference' in g.fill,false);
 assert.equal(r.can_add_rate,false,'a Manager cannot add a rate');assert.equal(r.register.rows[0].charge,0,'no depreciation is invented for an unrated year');assert.ok(r.readiness.problems.some(p=>/No reviewed rate/.test(p)));
 assert.equal((await run27('PARTNER',{action:'ledger_ppe_read'})).can_add_rate,true);
 const save=(role,over={})=>as(role,a=>L.ledgerAction(tx,a,{action:'ledger_rate_add',project_id:P,class_code:g.class_code,name:g.fill.name,first_rate:g.fill.first_rate,annual_rate:g.fill.annual_rate,later_basis_percentage:g.fill.later_basis_percentage,tax_cost_cap:g.fill.tax_cost_cap,expense_account:g.fill.expense_account,contra_account:g.fill.contra_account,effective_from:g.fill.effective_from,effective_to:g.fill.effective_to,source_checked_on:'2026-11-18',source_reference:'Fictional authority checked by the Partner for 2027',scope:g.fill.scope||'Fictional scope',...over},{}));
 await assert.rejects(()=>save('MANAGER'),/Engagement Partner/);
 const added=await save('PARTNER');assert.ok(added.rate_id);
 await assert.rejects(()=>save('PARTNER'),/already has a rate for these dates/);
 r=await run27('PARTNER',{action:'ledger_ppe_read'});
 assert.equal(r.register.rate_gaps.length,0);assert.equal(r.register.rows[0].charge,250000,'25% of cost, from the new rate');assert.equal(r.register.rows[0].closing_acc,500000);
 assert.ok(!r.readiness.problems.some(p=>/No reviewed rate/.test(p)));
 // The 2026 year is unchanged by the new row.
 assert.equal((await run('PARTNER',{action:'ledger_ppe_read'})).register.rate_gaps.length,0);
});
