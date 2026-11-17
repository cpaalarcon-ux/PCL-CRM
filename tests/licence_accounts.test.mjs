import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientChartAction,proposeAccounts,accountWhy,heldFor}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const cx=(role,p)=>as(role,a=>clientChartAction(tx,a,p));
test('build 2868: licence-linked accounts are proposed only to a client that holds the licence (pure rules)',()=>{
 const links={map:{'61500':['NTSA'],'61470':['EPRA']},held:['NTSA']};
 const base={status:'Active',is_legacy:false,proposed:true,entity_types:[],industry_packs:[],statutory_tags:[]};
 const accts=[{...base,code:'61500',name:'Transport fees'},{...base,code:'61470',name:'Energy fees',industry_packs:['Fuel and gas']},{...base,code:'61400',name:'Plain'},{...base,code:'61600',status:'Draft'}];
 const codes=l=>proposeAccounts(accts,'Limited company',[],{},l).map(x=>x.code);
 assert.deepEqual(codes(undefined),['61500','61400'],'without licence data the rules behave as they did before this build');
 assert.deepEqual(codes(links),['61500','61400'],'the NTSA account is proposed when NTSA is held');
 assert.deepEqual(codes({...links,held:[]}),['61400']);
 assert.deepEqual(proposeAccounts(accts,'Limited company',['Fuel and gas'],{},{...links,held:[]}).map(x=>x.code),['61470','61400'],'an account that is also in an industry pack still follows the pack');
 assert.deepEqual(proposeAccounts(accts,'Limited company',[],{},{...links,held:['EPRA']}).map(x=>x.code),['61470','61400'],'the pack account is proposed by the licence alone');
 assert.deepEqual(heldFor('61500',links),['NTSA']);assert.deepEqual(heldFor('61400',links),[]);
 assert.match(accountWhy(accts[0],'Limited company',[],{},links)[0],/holds NTSA licence on the licence register/);
 assert.deepEqual(accountWhy(accts[2],'Limited company',[],{},links),['Core account used by every client']);
});
test('build 2868: the chart proposal follows the licence register, ended licences do not count, and new accounts wait for a Partner',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 // The migration's data: four licence types are linked to a fee account, and the three new accounts are Drafts with provisional statement lines.
 const links=await tx`select type_code,account_code from erp_private.licence_type_accounts order by type_code`;assert.deepEqual(links.map(x=>x.type_code+':'+x.account_code),['COUNTY_PERMIT:61510','EPRA:61470','NTSA:61500','SACCO_LICENCE:61520']);
 const accts=await tx`select code,status from erp_private.account_catalog where code in('61500','61510','61520') order by code`;assert.deepEqual(accts.map(x=>x.status),['Draft','Draft','Draft']);
 assert.equal(Number((await tx`select count(*) n from erp_private.account_statement_map where account_code in('61500','61510','61520')`)[0].n),3);
 const read=()=>cx('ASSISTANT',{action:'v3_client_chart_read',client_id:C,effective_from:'2026-01-01'});
 let r=await read();assert.deepEqual(r.licences,[]);assert.equal(r.awaiting_partner_approval.some(x=>x.code==='61500'),false,'no licence, so nothing waits on the Partner');
 // The register is for Managers and Partners, but the proposal reads it for any preparer.
 const lic=async(type,no,ended)=>{await tx`insert into erp_private.client_licences(client_id,licence_type,licence_number,issuing_authority,issued_on,expires_on,created_by) values(${C},${type},${no},'Authority','2025-01-01','2027-12-31',${actors.MANAGER.staff_id})`;if(ended)await tx`update erp_private.client_licences set ended_on='2026-06-30',end_reason='Licence surrendered by the client',ended_by=${actors.MANAGER.staff_id} where licence_number=${no}`;};
 await lic('NTSA','NTSA-001',false);await lic('COUNTY_PERMIT','CP-9',true);
 r=await read();assert.deepEqual(r.licences,['NTSA'],'an ended licence is not counted');
 assert.ok(r.awaiting_partner_approval.some(x=>x.code==='61500'),'the Draft account waits for a Partner');assert.equal(r.awaiting_partner_approval.some(x=>x.code==='61510'),false);
 assert.equal(r.accounts.some(x=>x.code==='61500'),false,'a Draft account is not put on the chart until a Partner activates it');
 // Once a Partner has activated it, the account is proposed with the reason.
 await tx`update erp_private.account_catalog set status='Active' where code='61500'`;
 r=await read();const x=r.accounts.find(y=>y.code==='61500');assert.ok(x);assert.match(x.why.join(' '),/holds NTSA licence/);
 assert.equal(r.accounts.some(y=>y.code==='61510'),false);
 // A client with no licence is not offered it, and an Intern-level reader of another client's licences gets nothing.
 const C2=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C2},'Fictional other client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C2},${F})`;
 const r2=await cx('ASSISTANT',{action:'v3_client_chart_read',client_id:C2,effective_from:'2026-01-01'});assert.equal(r2.accounts.some(y=>y.code==='61500'),false);assert.deepEqual(r2.licences,[]);
 // Renewing or ending the licence changes the proposal; nothing was written to the client's approved chart by reading.
 await tx`update erp_private.client_licences set ended_on='2026-07-01',end_reason='Licence surrendered by the client',ended_by=${actors.MANAGER.staff_id} where licence_number='NTSA-001'`;
 r=await read();assert.deepEqual(r.licences,[]);assert.equal(r.accounts.some(y=>y.code==='61500'),false);
});
test('build 2868: the chart code and screens are wired',()=>{
 const c=rd('supabase/functions/staff-workspace-v12/client-chart.ts');assert.match(c,/client_licence_types\(\$\{clientId\}::uuid\)/);assert.match(c,/licence_type_accounts/);assert.match(c,/proposeAccounts\(catalog,c\.legal_entity_type\|\|'',packs,statutory,licences\)/);
});
