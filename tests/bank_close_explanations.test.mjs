import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,{download:async()=>({data:null})}));

test('a bank difference is explained only after an independent review of the exact amount',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'BANKQA','Fictional bank close firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional bank client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional bank project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id};
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Import Sources','Fictional_bank.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Bank',1,'Bank','2026-09-01','2026-09-30','{}',1,1,0,0,${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,account_code) values(${B},${P},${C},'Bank',2,'BANK-1','{}','{"date":"2026-09-28","reference":"DEP-0928","credit":1000,"debit":0}','40000')`;
 const read=async()=>ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'});
 let r=await read(),check=r.close_checks.find(c=>c.code==='STATEMENT_TO_LEDGER');
 assert.equal(check.status,'Blocked');assert.equal(check.difference_cents,100000);
 assert.ok(r.issues.some(x=>/Bank close – Statement movement/.test(x)));
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_close_explanation_save',as_of:'2026-12-31',explanation:'too short',evidence_reference:'REC-09'}),/at least 20 characters/);
 const saved=await ledger('ASSISTANT',{...base,action:'ledger_close_explanation_save',as_of:'2026-12-31',explanation:'Fictional deposit of 28 September is posted in October after the client confirms the customer.',evidence_reference:'REC-2026-09'});
 assert.equal(Number(saved.difference_cents),100000,'the server records the amount it computed');
 r=await read();assert.match(r.close_checks.find(c=>c.code==='STATEMENT_TO_LEDGER').detail,/waiting for a different Manager or Partner/);
 const e=r.close_explanations[0];
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_close_explanation_review',as_of:'2026-12-31',explanation_id:e.explanation_id,revision:e.revision,status:'Accepted',review_note:'Self review attempt'}),/Manager or Partner/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.bank_close_explanations set explanation='Changed after submission to something else' where explanation_id=${e.explanation_id}`),/cannot be edited/);
 await ledger('MANAGER',{...base,action:'ledger_close_explanation_review',as_of:'2026-12-31',explanation_id:e.explanation_id,revision:e.revision,status:'Accepted',review_note:'Fictional deposit slip and October statement checked.'});
 r=await read();check=r.close_checks.find(c=>c.code==='STATEMENT_TO_LEDGER');
 assert.equal(check.status,'Explained');assert.ok(!r.issues.some(x=>/Statement movement/.test(x)),'an accepted explanation no longer blocks');
 await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,account_code) values(${B},${P},${C},'Bank',3,'BANK-2','{}','{"date":"2026-09-29","reference":"DEP-0929","credit":50,"debit":0}','40000')`;
 r=await read();assert.equal(r.close_checks.find(c=>c.code==='STATEMENT_TO_LEDGER').status,'Blocked','a changed difference blocks again');
});
