import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,{}));

test('stock rolls carry the approved closing forward and propose a closing-stock journal',async t=>{
  t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const W=id();await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await call('MANAGER',{action:'v3_stock_policy_add',client_id:C,activity_id:W,inventory_method:'Periodic',effective_from:'2026-01-02',count_frequency:'Monthly'});
 const pol=(await tx`select policy_id from erp_private.stock_policy_versions where activity_id=${W}`)[0].policy_id;
 const roll=(start,end,opening,closing,extra={})=>tx`insert into erp_private.stock_controls(project_id,activity_id,policy_id,stock_class,starts_on,ends_on,inputs,result,snapshot,status,prepared_by,reviewed_by) values(${P},${W},${pol},'Wholesale',${start},${end},'{}',${tx.json({opening_value:opening,closing_value:closing,...extra})},${tx.json({result:{opening_value:opening,closing_value:closing,...extra}})},'Approved',${actors.ASSISTANT.staff_id},${actors.SUPERVISOR.staff_id}) returning control_id`.then(r=>r[0].control_id);
 const aug=await roll('2026-08-01','2026-08-31',1000,5000);

 // 1. A new roll opens at the last approved closing.
 const made=await call('ASSISTANT',{action:'v3_stock_create',project_id:P,activity_id:W,starts_on:'2026-09-01',ends_on:'2026-09-30',stock_class:'Wholesale'});
 assert.equal(made.carried_opening,5000);
 let c=(await tx`select * from erp_private.stock_controls where control_id=${made.control_id}`)[0];
 assert.equal(Number(c.inputs.opening_value),5000);assert.equal(c.inputs.carried_from,aug);assert.equal(c.inputs.carried_through,'2026-08-31');
 // An earlier period gets no carried opening.
 assert.equal((await call('ASSISTANT',{action:'v3_stock_create',project_id:P,activity_id:W,starts_on:'2026-07-01',ends_on:'2026-07-31',stock_class:'Wholesale'})).carried_opening,null);
 // 2. Changing the opening needs a reason; the carried figure cannot be forged.
 const save=async inputs=>{c=(await tx`select * from erp_private.stock_controls where control_id=${made.control_id}`)[0];await call('ASSISTANT',{action:'v3_stock_save',project_id:P,control_id:made.control_id,revision:c.revision,inputs});return (await tx`select inputs,result from erp_private.stock_controls where control_id=${made.control_id}`)[0];};
 const base={cost_basis:'Supported actual cost',cost_of_sales:100,evidence_reference:'Fictional evidence',reconciliation_note:'Fictional tie-out'};
 let r=await save({...base,opening_value:5200,carried_opening_value:5200,carried_from:null});
 assert.equal(Number(r.inputs.carried_opening_value),5000,'the carried figure is kept by the server');assert.equal(r.inputs.carried_from,aug);
 assert.ok(r.result.issues.some(x=>/differs from the last approved closing/.test(x)),'a change without a reason is flagged');
 r=await save({...base,opening_value:5200,opening_change_reason:'Recount of opening stock agreed with the client'});
 assert.ok(!r.result.issues.some(x=>/differs from the last approved closing/.test(x)),'a recorded reason clears the flag');
 r=await save({...base,opening_value:5000});assert.ok(!r.result.issues.some(x=>/differs from the last approved closing/.test(x)),'an unchanged opening needs no reason');

 // 3. Proposed closing-stock journal from approved periodic rolls.
 const oct=await roll('2026-10-01','2026-10-31',5000,4500);
 const per=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base2={project_id:P,period_id:per.period_id};
 const list=await ledger('ASSISTANT',{...base2,action:'ledger_stock_read'});
 assert.deepEqual(list.rolls.map(x=>[x.ends_on,x.movement,x.can_propose]),[['2026-08-31',4000,true],['2026-10-31',-500,true]]);
 const j1=await ledger('ASSISTANT',{...base2,action:'ledger_stock_propose',control_id:oct});
 const jr=await ledger('ASSISTANT',{...base2,action:'ledger_journal_read',journal_id:j1.journal_id});
 assert.equal(jr.journal.kind,'Stock');assert.equal(jr.journal.status,'Draft');
 assert.deepEqual(jr.lines.map(l=>[l.account_code,Number(l.debit),Number(l.credit)]),[['50140',500,0],['10190',0,500]],'a fall in stock debits the adjustment account');
 await assert.rejects(()=>ledger('ASSISTANT',{...base2,action:'ledger_stock_propose',control_id:oct}),/already exists/);
 const j2=await ledger('ASSISTANT',{...base2,action:'ledger_stock_propose',control_id:aug});
 assert.deepEqual((await ledger('ASSISTANT',{...base2,action:'ledger_journal_read',journal_id:j2.journal_id})).lines.map(l=>[l.account_code,Number(l.debit),Number(l.credit)]),[['10190',4000,0],['50140',0,4000]],'a rise in stock debits inventory');
 assert.ok((await ledger('ASSISTANT',{...base2,action:'ledger_stock_read'})).rolls.every(x=>x.journal_id&&!x.can_propose));
 await assert.rejects(()=>ledger('ASSISTANT',{...base2,action:'ledger_stock_propose',control_id:made.control_id}),/not an approved roll/);
});
