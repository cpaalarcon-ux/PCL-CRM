import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {yearTbAction}=await import('../supabase/functions/staff-workspace-v12/year-tb-actions.ts');
const {comparativesSave}=await import('../supabase/functions/staff-workspace-v12/annual-pack.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('several years of trial balances: previewed per year, recorded all or none, replacing earlier versions and feeding the comparatives',async t=>{
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
 // an account in the chart that no approved map reaches, to show "not mapped"
 await db.exec('set session_replication_role=replica');
 const UNMAPPED=(await tx`select m.account_code code from erp_private.account_statement_map m where m.status='Approved' and m.account_code not in(${CASH},${EXP},${REV},${SHARE},${RET}) order by m.account_code limit 1`)[0]?.code;
 await tx`update erp_private.account_statement_map set status='Draft' where account_code=${UNMAPPED}`;await db.exec('set session_replication_role=origin');
 assert.ok(UNMAPPED,'an account is left without an approved map');
 const row=(c,o,e)=>`${c}\t${o}\t${e}`;
 const TXT=['Code\t31/12/2024\t31/12/2025',row(CASH,'200','600'),row(EXP,'','600'),row(REV,'','(1,000)'),row(SHARE,'(100)','(100)'),row(RET,'(100)','(100)')].join('\n');
 const REF='Signed accounts for 2024 and 2025 dated 30 April 2026';
 const prev=(role,x={})=>tb(role,{action:'ledger_tb_multi_preview',text:TXT,...x}),savem=(role,x={})=>tb(role,{action:'ledger_tb_multi_save',text:TXT,source_reference:REF,closing_state:'Before year-end close',...x});
 // ----- who may, and what the preview says (nothing is recorded by a preview)
 await assert.rejects(()=>prev('ASSISTANT'),/Manager or Partner/);await assert.rejects(()=>prev('INTERN'),/Manager or Partner/);
 let r=await prev('MANAGER');assert.equal(r.saved,false);assert.equal(r.can_save,true,JSON.stringify(r.problems));assert.deepEqual(r.years.map(y=>[y.as_of,y.role,y.balanced,y.state,y.replaces]),[['2024-12-31','Opening',true,'Ready',null],['2025-12-31','Year-end',true,'Ready',null]]);
 assert.equal(Number((await tx`select count(*) n from erp_private.client_year_tbs`)[0].n),0,'a preview records nothing');
 // ----- what stops it: an unbalanced year, an account not in the chart
 r=await prev('PARTNER',{text:TXT.replace('(1,000)','(900)')});assert.equal(r.can_save,false);assert.match(r.problems.join(' '),/2025-12-31: Does not balance/);assert.equal(r.years[0].state,'Ready','the other year is still shown');
 await assert.rejects(()=>savem('MANAGER',{text:TXT.replace('(1,000)','(900)')}),/Does not balance/);
 r=await prev('MANAGER',{text:TXT+'\nZZ-NOT-IN-CHART\t1\t(1)'});assert.equal(r.can_save,false);assert.match(r.problems.join(' '),/Not in the chart of accounts: ZZ-NOT-IN-CHART/);
 r=await prev('MANAGER',{text:'Code\tTotal\n'+CASH+'\t5'});assert.equal(r.can_save,false);assert.match(r.parse_errors[0],/not a balance date/);
 // ----- an unmapped account is named and must be acknowledged
 const T2=TXT.replace(/\n$/,'')+'\n'+row(UNMAPPED,'','50')+'\n'+row(CASH+'X','','');
 const T3=['Code\t31/12/2024\t31/12/2025',row(CASH,'200','650'),row(EXP,'','600'),row(REV,'','(1,000)'),row(SHARE,'(100)','(100)'),row(RET,'(100)','(100)'),row(UNMAPPED,'','(50)')].join('\n');
 r=await prev('MANAGER',{text:T3});assert.equal(r.can_save,true);assert.equal(r.needs_unmapped_ack,true);assert.deepEqual(r.years[1].unmapped.map(u=>u.code),[UNMAPPED]);assert.equal(r.years[1].state,'Accounts not mapped');
 await assert.rejects(()=>savem('MANAGER',{text:T3}),/Confirm that you want to record them anyway/);
 void T2;
 // ----- the save needs a source and a closing state, and only a Manager or Partner records
 await assert.rejects(()=>savem('MANAGER',{source_reference:'short'}),/at least 10 characters/);await assert.rejects(()=>savem('MANAGER',{closing_state:undefined}),/./);await assert.rejects(()=>savem('ASSISTANT'),/Manager or Partner/);
 // ----- recorded: the 2024 column as the opening trial balance, the 2025 column as the year-end one
 const s1=await savem('MANAGER');assert.equal(s1.saved,true);assert.deepEqual(s1.recorded.map(x=>[x.as_of,x.role,x.version,x.replaced,x.rows]),[['2024-12-31','Opening',1,false,3],['2025-12-31','Year-end',1,false,5]]);
 const list=await tb('MANAGER',{action:'ledger_tb_list'});assert.deepEqual(list.trial_balances.map(t=>[t.tb_kind,t.as_of,t.closing_state,t.version]).sort(),[['Opening','2024-12-31','After year-end close',1],['Year-end','2025-12-31','Before year-end close',1]]);
 // the single recorder and the comparatives see the same records
 const cmp=await tb('MANAGER',{action:'ledger_comparatives_from_tbs'});assert.equal(cmp.statements['Profit or loss'].state,'Derived');assert.equal(cmp.statements['Changes in equity'].state,'Needs review');
 // ----- a second upload replaces both as version 2 and keeps version 1; the preview says so beforehand
 r=await prev('MANAGER');assert.deepEqual(r.years.map(y=>[y.replaces,y.same_as_recorded]),[[{version:1},true],[{version:1},true]]);assert.match(r.warnings.join(' '),/same rows and totals as version 1/);
 const s2=await savem('PARTNER',{text:T3,accept_unmapped:true,closing_state:'After year-end close'});assert.deepEqual(s2.recorded.map(x=>[x.as_of,x.version,x.replaced,x.unmapped_accounts]),[['2024-12-31',2,true,0],['2025-12-31',2,true,1]]);
 assert.deepEqual((await tx`select tb_kind,version,status,closing_state from erp_private.client_year_tbs order by tb_kind,version`).map(x=>[x.tb_kind,x.version,x.status,x.closing_state]),[['Opening',1,'Superseded','After year-end close'],['Opening',2,'Current','After year-end close'],['Year-end',1,'Superseded','Before year-end close'],['Year-end',2,'Current','After year-end close']],'history is kept');
 const cmp2=await tb('MANAGER',{action:'ledger_comparatives_from_tbs'});assert.equal(cmp2.statements['Profit or loss'].state,'Needs review');assert.match(cmp2.statements['Profit or loss'].reason,/no approved statement line/,'the preview\u2019s unmapped account is what the comparatives then report');
 // ----- all or none: a bad second year records nothing, even when the first year is fine
 const before=Number((await tx`select count(*) n from erp_private.client_year_tbs`)[0].n);
 await assert.rejects(()=>savem('MANAGER',{text:['Code\t31/12/2023\t31/12/2025',row(CASH,'5','5'),row(SHARE,'(5)','(4)')].join('\n')}),/Does not balance/);
 assert.equal(Number((await tx`select count(*) n from erp_private.client_year_tbs`)[0].n),before,'nothing is recorded when any year is refused');
 // ----- a closed year records nothing
 await assert.rejects(()=>as('MANAGER',a=>yearTbAction(tx,a,{...L0,status:'Closed'},{action:'ledger_tb_multi_save',text:TXT,source_reference:REF,closing_state:'Before year-end close'})),/closed/);
});
