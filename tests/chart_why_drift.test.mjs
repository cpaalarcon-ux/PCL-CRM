import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientChartAction,proposeAccounts,accountWhy,chartDrift}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');

const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chart=(role,p)=>as(role,a=>clientChartAction(tx,a,p));

test('chart: every account says why it is there, and drift since approval is named',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CHARTQA','Fictional chart firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional chart client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional chart project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await tx`update erp_private.clients set legal_structure='Limited Company',legal_subtype='Private Limited Company' where client_id=${C}`;
 await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional CR12',${actors.MANAGER.staff_id})`;

 const read=()=>chart('ASSISTANT',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-01-01'});
 const approve=async codes=>{await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,extra_accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C},'2026-01-01','Limited company',${'{Wholesale}'},${'{'+codes.join(',')+'}'},${tx.json([])},'Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now(),'Fictional approval')`;};
 let r=await read();
 // Every account says why it is there.
 assert.ok(r.accounts.every(x=>Array.isArray(x.why)&&x.why.length>0&&x.why.every(w=>w.length>8)),'each proposed account carries a reason');
 assert.deepEqual(r.accounts.find(x=>x.code==='10000').why,['Core account used by every client']);
 assert.ok(r.accounts.find(x=>x.code==='30000').why.some(w=>/Limited company clients/.test(w)),'entity layer is named');
 assert.ok(r.accounts.find(x=>x.code==='21000').why.some(w=>/VAT obligation/.test(w)),'statutory layer names the obligation');
 const wholesale=r.accounts.find(x=>(x.industry_packs||[]).includes('Wholesale'));assert.ok(wholesale.why.some(w=>/Wholesale activity/.test(w)),'industry layer names the activity');
 // Pure helper: an obligation that is switched off leaves no statutory reason and a confirmed one says so.
 assert.deepEqual(accountWhy({statutory_tags:['PAYE']},'Limited company',[],{PAYE:'yes'}),['PAYE obligation applies to this client']);
 assert.match(accountWhy({statutory_tags:['VAT']},'Limited company',[],{VAT:'unconfirmed'})[0],/not confirmed yet/);
 assert.deepEqual(accountWhy({statutory_tags:['VAT']},'Limited company',[],{VAT:'no'}),['Core account used by every client']);

 // Chart drift: an approved chart that matches today's rules is current.
 await approve(r.accounts.map(x=>x.code));
 r=await read();
 assert.equal(r.status,'Approved');assert.equal(r.drift.total,0);
 // 1. A Partner activates a Draft account that now applies to this client: it is named, with its reason.
 const draft=(await tx`select code from erp_private.account_catalog where status='Draft' and not is_legacy and proposed and (cardinality(entity_types)=0 or 'Limited company'=any(entity_types)) and (cardinality(industry_packs)=0 or 'Wholesale'=any(industry_packs)) and cardinality(statutory_tags)=0 order by code limit 1`)[0];
 assert.ok(draft,'a Draft account applies to a wholesale limited company');
 await db.exec(`alter table erp_private.account_catalog disable trigger user;update erp_private.account_catalog set status='Active' where code='${draft.code}';alter table erp_private.account_catalog enable trigger user;`);
 r=await read();
 assert.equal(r.status,'Out of date');assert.ok(r.drift.added.some(x=>x.code===draft.code&&x.why.length>0));assert.equal(r.drift.retired.length,0);
 // 2. The chart is replaced by a version that includes it: no drift again.
 await approve(r.accounts.map(x=>x.code));
 r=await read();assert.equal(r.status,'Approved');assert.equal(r.drift.total,0);
 // 3. An account in the chart is retired in the master chart: it is named as retired.
 await db.exec(`alter table erp_private.account_catalog disable trigger user;update erp_private.account_catalog set is_legacy=true where code='10000';alter table erp_private.account_catalog enable trigger user;`);
 r=await read();assert.equal(r.status,'Out of date');assert.ok(r.drift.retired.some(x=>x.code==='10000'));
 await db.exec(`alter table erp_private.account_catalog disable trigger user;update erp_private.account_catalog set is_legacy=false where code='10000';alter table erp_private.account_catalog enable trigger user;`);
 // 4. A new activity begins: the packs and their accounts are named.
 await tx`insert into erp_private.client_activities(client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${C},'transport',false,'Transport','Transport services','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;
 r=await read();assert.equal(r.status,'Out of date');assert.deepEqual(r.drift.packs_added,['Transport']);

 // Pure helper: entity change, ended activity and deliberate extras.
 const approved={codes:new Set(['10000','30000','99999']),entity_type:'Limited company',packs:['Wholesale','Retail'],extras:['99999']};
 const d=chartDrift({approved,proposed:[{code:'10000',name:'Cash',why:['Core']},{code:'35000',name:'Capital',why:['Sole']}],catalog:[{code:'10000',name:'Cash',status:'Active'},{code:'30000',name:'Share capital',status:'Active'},{code:'99999',name:'Extra',status:'Active'},{code:'35000',name:'Capital',status:'Active'}],entityType:'Sole proprietor',packs:['Wholesale']});
 assert.deepEqual(d.added.map(x=>x.code),['35000']);assert.deepEqual(d.dropped.map(x=>x.code),['30000'],'a deliberate extra is not reported as dropped');
 assert.deepEqual(d.entity_changed,{from:'Limited company',to:'Sole proprietor'});assert.deepEqual(d.packs_ended,['Retail']);assert.equal(d.total,4);

});

test('the chart screen shows why each account is there and what drifted; the bank form suggests the ledger account',()=>{
 const imp=fs.readFileSync(root+'/staff-improvements.mjs','utf8'),led=fs.readFileSync(root+'/staff-ledger.mjs','utf8');
 assert.match(imp,/Why it is here/);assert.match(imp,/x\.why/);assert.match(imp,/chart-drift/);assert.match(imp,/This chart no longer matches the current rules/);assert.match(imp,/dr\.entity_changed/);
 assert.match(led,/ledger_bank_suggest/);assert.match(led,/ledger_bank_propose_chart/);assert.match(led,/Propose chart amendment/);assert.match(led,/id="bankSuggest"/);
});
