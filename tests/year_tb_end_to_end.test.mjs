import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {yearTbAction}=await import('../supabase/functions/staff-workspace-v12/year-tb-actions.ts');
const {comparativesSave}=await import('../supabase/functions/staff-workspace-v12/annual-pack.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('prior-year trial balances: recorded as versions, balanced and from the chart; comparatives derived only where the data exists, never zero-filled',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 const L0={client_id:C,project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'};
 const tb=(role,p)=>as(role,a=>yearTbAction(tx,a,L0,p));
 // Approve the seeded statement-line map so lines resolve; pick one account for each line we need.
 await db.exec('set session_replication_role=replica');try{await tx`update erp_private.account_statement_map set status='Approved',reviewed_by=${actors.PARTNER.staff_id},reviewed_at=now(),effective_from=date '2000-01-01' where status='Draft'`;}finally{await db.exec('set session_replication_role=origin');}
 const acct=async line=>(await tx`select account_code from erp_private.account_statement_map where line_code=${line} and status='Approved' order by account_code limit 1`)[0]?.account_code;
 const REV=await acct('PL.REVENUE'),SHARE=await acct('SFP.SHARE_CAP'),RET=await acct('SFP.RETAINED'),CASH=await acct('SFP.CASH');
 const EXP=(await tx`select m.account_code from erp_private.account_statement_map m join erp_private.statement_lines s using(line_code) where s.statement='Profit or loss' and s.normal_side='Debit' and s.line_code not in('PL.UNRESOLVED','PL.TAX') and m.status='Approved' order by m.account_code limit 1`)[0].account_code;
 assert.ok(REV&&SHARE&&RET&&CASH&&EXP,'seeded map gives accounts for each line');
 const END=`${CASH}\t600\t0\n${EXP}\t600\t0\n${REV}\t0\t1,000\n${SHARE}\t0\t100\n${RET}\t0\t100`,OPEN=`${CASH}\t200\t0\n${SHARE}\t0\t100\n${RET}\t0\t100`;
 const save=(role,x)=>tb(role,{action:'ledger_tb_save',source_reference:'Signed accounts for 2025 dated 30 April 2026',...x});

 // Nothing recorded: every statement is Not available. Nothing is zero.
 const none=await tb('MANAGER',{action:'ledger_comparatives_from_tbs'});
 assert.equal(none.statements['Profit or loss'].state,'Not available');assert.equal(none.statements['Changes in equity'].state,'Not available');assert.equal(none.texts.pl,'');assert.deepEqual(none.source_tb_ids,[]);
 assert.equal(none.expected.year_end,'2025-12-31');assert.equal(none.expected.opening,'2024-12-31');

 // Who and what can be recorded.
 await assert.rejects(()=>save('ASSISTANT',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',text:END}),/Manager or Partner/);
 await assert.rejects(()=>save('MANAGER',{tb_kind:'Year-end',as_of:'2026-01-01',closing_state:'Before year-end close',text:END}),/before this financial year/);
 await assert.rejects(()=>save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',text:END.replace('0\t1,000','0\t900')}),/does not balance/);
 await assert.rejects(()=>save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',text:END+`\n${CASH}\t5\t0`}),/appears twice/);
 await assert.rejects(()=>save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',text:END+'\nZZZ999\t5\t0\nZZZ998\t0\t5'}),/not in the chart of accounts/);
 await assert.rejects(()=>save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',source_reference:'short',text:END}),/at least 10/);
 await assert.rejects(()=>save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',text:''}),/no balances/);
 assert.equal((await tx`select count(*)::int n from erp_private.client_year_tbs`)[0].n,0,'refusals record nothing');

 // Year-end only: profit or loss is derived; equity is Not available because the start-of-year balances are not recorded.
 const ye=await save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',text:END});assert.equal(ye.trial_balance.version,1);assert.equal(ye.trial_balance.total_debit,1200);
 const a1=await tb('MANAGER',{action:'ledger_comparatives_from_tbs'});
 assert.equal(a1.statements['Profit or loss'].state,'Derived');assert.match(a1.texts.pl,/PL\.REVENUE\t1000\.00/);assert.equal(a1.statements['Changes in equity'].state,'Not available');assert.match(a1.statements['Changes in equity'].reason,/No opening trial balance is recorded for 2024-12-31/);
 assert.equal(a1.statements['Cash flow'].state,'Not available');assert.match(a1.statements['Cash flow'].reason,/No opening trial balance/);assert.equal(a1.texts.cf,'');assert.equal(a1.texts.eq,'');

 // With the opening trial balance, equity is derived and still needs a Partner's confirmation.
 await save('PARTNER',{tb_kind:'Opening',as_of:'2024-12-31',text:OPEN});
 const a2=await tb('PARTNER',{action:'ledger_comparatives_from_tbs'});
 assert.equal(a2.statements['Changes in equity'].state,'Needs review');assert.match(a2.texts.eq,/SFP\.SHARE_CAP\tOPENING\t100\.00/);assert.match(a2.texts.eq,/SFP\.RETAINED\tPROFIT\t400\.00/);
 assert.equal(a2.statements['Cash flow'].state,'Needs review');assert.match(a2.texts.cf,/CF\.PBT\t400\.00/);assert.match(a2.texts.cf,/CF\.CASH_OPEN\t200\.00/);assert.match(a2.texts.cf,/CF\.CASH_CLOSE\t600\.00/);
 assert.equal(a2.source_tb_ids.length,2);assert.match(a2.source_reference,/2025-12-31 and 2024-12-31/);

 // A year-end trial balance taken after the close no longer carries the year's activity: profit or loss is Not available, never zero.
 await save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'After year-end close',text:`${CASH}\t600\t0\n${SHARE}\t0\t100\n${RET}\t0\t500`});
 const a3=await tb('MANAGER',{action:'ledger_comparatives_from_tbs'});
 assert.equal(a3.statements['Cash flow'].state,'Not available');assert.equal(a3.texts.cf,'');
 assert.equal(a3.statements['Profit or loss'].state,'Not available');assert.match(a3.statements['Profit or loss'].reason,/after the year-end close/);assert.equal(a3.statements['Changes in equity'].state,'Not available');
 // Versions: the new one is current, the old one is kept; recorded versions are never edited or deleted.
 const vs=await tx`select version,status from erp_private.client_year_tbs where tb_kind='Year-end' order by version`;assert.deepEqual(vs.map(x=>[x.version,x.status]),[[1,'Superseded'],[2,'Current']]);
 assert.equal((await tx`select count(*)::int n from erp_private.client_year_tb_rows`)[0].n,5+3+3,'rows of every version are kept');
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_year_tbs set row_count=9 where tb_kind='Opening'`),/never edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.client_year_tbs where tb_kind='Opening'`));
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_year_tbs set status='Current' where version=1 and tb_kind='Year-end'`));
 // Back to a pre-close trial balance, then save comparatives built from them. The cash flow is the one derived from the same two trial balances.
 await save('MANAGER',{tb_kind:'Year-end',as_of:'2025-12-31',closing_state:'Before year-end close',text:END});
 const a4=await tb('MANAGER',{action:'ledger_comparatives_from_tbs'});assert.equal(a4.statements['Profit or loss'].state,'Derived');
 await db.exec('set session_replication_role=replica');
 let per;try{per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${C},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence for the period',${actors.PARTNER.staff_id}) returning *`)[0];}finally{await db.exec('set session_replication_role=origin');}
 const sv=(role,x)=>as(role,a=>comparativesSave(tx,a,per,{source_kind:'Recorded prior-year trial balances',source_reference:a4.source_reference,pl:a4.texts.pl,eq:a4.texts.eq,cf:a4.texts.cf,source_tb_ids:a4.source_tb_ids,...x}));
 const set=await sv('MANAGER',{});assert.equal(set.status,'Draft');
 const head=(await tx`select source_kind,source_tb_ids from erp_private.period_comparative_sets where set_id=${set.set_id}`)[0];assert.equal(head.source_kind,'Recorded prior-year trial balances');assert.deepEqual([...head.source_tb_ids].sort(),[...a4.source_tb_ids].sort());
 await assert.rejects(()=>sv('MANAGER',{source_tb_ids:[]}),/Choose the recorded trial balances/);
 // Replacing a trial balance makes the earlier derivation stale: saving with the old ids is refused.
 await save('MANAGER',{tb_kind:'Opening',as_of:'2024-12-31',text:OPEN+`\n${CASH}\t0\t0`});
 await assert.rejects(()=>sv('MANAGER',{}),/replaced|not this client/);
});
