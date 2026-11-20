// Step 4 (joined-practice review): licences and permits per client, expiry states, the audit flag.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('Step 4: licence register, expiry states, expected licences, audit flag',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,st,sub,fam)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate',${st},${sub},${fam},${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const A=await mk('UAT Fictional Fuel Station Ltd','A300000001Z','Limited Company','Private Limited Company','Limited company');
 const B=await mk('UAT Fictional Other Ltd','A300000002Z','Limited Company','Private Limited Company','Limited company');
 const DT=await mk('UAT Fictional Deposit SACCO','A300000003Z','Co-operative Society','Deposit-taking SACCO','Co-operative society');
 const NW=await mk('UAT Fictional Non-withdrawable SACCO','A300000004Z','Co-operative Society','Non-withdrawable-deposit-taking SACCO','Co-operative society');
 const dayOffset=async n=>(await tx`select ((now() at time zone 'Africa/Nairobi')::date+${n}::int)::text d`)[0].d;
 const D={};for(const n of [730,-400,-20,-10,-5,0,2,3,60,61,200,300,365,400])D[n]=await dayOffset(n);
 const add=async(role,client,o)=>q(role,`insert into erp_private.client_licences(client_id,licence_type,licence_number,issuing_authority,description,issued_on,expires_on,renews_licence_id,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning licence_id`,[client,o.type||'EPRA',o.number,o.authority||'Energy and Petroleum Regulatory Authority (EPRA)',o.description||'',o.issued||null,o.expires,o.renews||null,actors[role].staff_id]);
 const summary=async role=>j(await q(role,'select * from erp_private.licence_summary_all()'));
 const stateOf=(rows,lic)=>rows.find(r=>r.licence_id===lic)?.state;
 const end=(role,lic,on,reason)=>q(role,`update erp_private.client_licences set ended_on=$2,end_reason=$3,ended_by=$4 where licence_id=$1`,[lic,on,reason,actors[role].staff_id]);

 // ---- 1. The catalogue and who may record ------------------------------------------------------------------------------------------------------
 assert.deepEqual((await tx`select type_code from erp_private.licence_types order by sort_order`).map(r=>r.type_code),['EPRA','NTSA','COUNTY_PERMIT','SACCO_LICENCE','OTHER']);
 assert.ok((await tx`select count(*)::int n from erp_private.licence_types where warn_days=60 and rule_status='Suggested'`)[0].n===5,'default window and status: not yet confirmed');
 assert.equal((await tx`select count(*)::int n from erp_private.licence_expectations`)[0].n,1,'only the one rule the structure checklist already marks Required');
 await assert.rejects(()=>add('ASSISTANT',A,{number:'EPRA/0001',expires:D[200]}),/row-level security|Only a Manager or Partner/);
 await assert.rejects(()=>add('SUPERVISOR',A,{number:'EPRA/0001',expires:D[200]}),/row-level security|Only a Manager or Partner/);
 assert.deepEqual(await q('SUPERVISOR','select * from erp_private.client_licences'),[],'the register is for Manager and Partner');

 // ---- 2. States from the expiry date (Nairobi date, 60 day window) -------------------------------------------------------------------------------
 const expired=(await add('MANAGER',A,{number:'EPRA/EXPIRED',expires:D[-5],issued:D[-400]}))[0].licence_id;
 const today=(await add('MANAGER',A,{type:'NTSA',number:'NTSA/TODAY',authority:'National Transport and Safety Authority (NTSA)',expires:D[0]}))[0].licence_id;
 const edge=(await add('MANAGER',A,{type:'COUNTY_PERMIT',number:'CTY/EDGE',authority:'Nairobi City County',expires:D[60]}))[0].licence_id;
 const valid=(await add('MANAGER',A,{type:'OTHER',number:'OTH/VALID',description:'Fire safety certificate',authority:'County fire department',expires:D[61]}))[0].licence_id;
 let rows=await summary('MANAGER');
 assert.equal(stateOf(rows,expired),'Expired');assert.equal(stateOf(rows,today),'Expiring','expires today is not yet expired');
 assert.equal(stateOf(rows,edge),'Expiring','day 60 is inside the window');assert.equal(stateOf(rows,valid),'Valid','day 61 is outside it');
 assert.equal(rows.find(r=>r.licence_id===expired).days_left,-5);assert.equal(rows.find(r=>r.licence_id===edge).days_left,60);
 assert.deepEqual(await summary('ASSISTANT'),[],'nothing for staff below Manager');
 const counts=(await q('MANAGER','select erp_private.licence_counts() c'))[0].c;
 assert.deepEqual([counts.licences_expired,counts.licences_expiring,counts.expected_licences_missing],[1,2,1],'one expired, two expiring, one deposit-taking SACCO without a licence');

 // ---- 3. Entry rules ------------------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(()=>add('MANAGER',A,{number:'EPRA/EXPIRED',expires:D[300]}),/duplicate key|unique/i,'the same current number twice');
 await add('MANAGER',A,{type:'NTSA',number:'EPRA/EXPIRED',expires:D[300]});// same number under a different type is a different licence
 await assert.rejects(()=>add('MANAGER',A,{type:'OTHER',number:'OTH/NODESC',expires:D[300]}),/violates check constraint/,'Other needs a description');
 await assert.rejects(()=>add('MANAGER',A,{number:'EPRA/BACKWARDS',issued:D[-10],expires:D[-20]}),/violates check constraint/,'expiry after issue');
 await assert.rejects(()=>add('MANAGER',A,{number:'EPRA/FUTURE',issued:D[3],expires:D[300]}),/issue date cannot be in the future/);
 await assert.rejects(()=>add('MANAGER',A,{number:'X',expires:D[300]}),/violates check constraint/,'a number of at least 2 characters');

 // ---- 4. A recorded licence cannot be edited, only ended ---------------------------------------------------------------------------------------
 await assert.rejects(()=>q('MANAGER',`update erp_private.client_licences set expires_on=$2 where licence_id=$1`,[expired,D[400]]),/cannot be edited/,'moving an expiry date is a new entry');
 await assert.rejects(()=>q('MANAGER',`update erp_private.client_licences set licence_number='EPRA/CHANGED' where licence_id=$1`,[expired]),/cannot be edited/);
 await assert.rejects(()=>end('MANAGER',expired,D[0],'short'),/violates check constraint/,'a reason of 10 characters');
 await assert.rejects(()=>end('MANAGER',expired,D[2],'Surrendered to the authority'),/future/);
 await end('ASSISTANT',expired,D[0],'Surrendered to the authority');// hidden by row security: no change
 assert.equal((await tx`select ended_on from erp_private.client_licences where licence_id=${expired}`)[0].ended_on,null);

 // ---- 5. Renewal ------------------------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(()=>add('MANAGER',B,{number:'EPRA/EXPIRED/R',expires:D[365],renews:expired}),/same client and the same type/,'cannot renew another client\'s licence');
 await assert.rejects(()=>add('MANAGER',A,{type:'NTSA',number:'NTSA/R',authority:'National Transport and Safety Authority (NTSA)',expires:D[365],renews:expired}),/same client and the same type/);
 await assert.rejects(()=>add('MANAGER',A,{number:'EPRA/EXPIRED/R',expires:D[-5],renews:expired}),/expire after/);
 const renewed=(await add('MANAGER',A,{number:'EPRA/RENEWED',expires:D[365],renews:expired}))[0].licence_id;
 await end('MANAGER',expired,D[0],'Renewed by licence EPRA/RENEWED');
 rows=await summary('MANAGER');
 assert.equal(stateOf(rows,renewed),'Valid');assert.equal(stateOf(rows,expired),undefined,'the ended licence is no longer current');
 await assert.rejects(()=>end('MANAGER',expired,D[0],'Trying to end it a second time'),/stays ended/);
 assert.equal((await tx`select count(*)::int n from erp_private.client_licences where client_id=${A}`)[0].n,6,'history is kept');
 await assert.rejects(()=>tx`delete from erp_private.client_licences where licence_id=${expired}`,/delete|cannot/i);
 assert.ok(Number((await tx`select count(*)::int n from erp_private.audit_events where table_name='client_licences'`)[0].n)>=7,'changes are in the firm change log');

 // A renewal may keep the licence number: the server ends the old entry first, then adds the new one.
 await end('MANAGER',renewed,D[0],'Renewed by licence EPRA/RENEWED, expiring later');
 const again=(await add('MANAGER',A,{number:'EPRA/RENEWED',expires:D[730],renews:renewed}))[0].licence_id;
 assert.equal(stateOf(await summary('MANAGER'),again),'Valid');

 // ---- 6. Expected licences ---------------------------------------------------------------------------------------------------------------------------
 rows=await summary('MANAGER');
 assert.deepEqual(rows.filter(r=>r.state==='Missing').map(r=>[r.client_id,r.licence_type]),[[DT,'SACCO_LICENCE']],'a deposit-taking SACCO without a SASRA licence; nobody else is expected to hold one');
 const sasra=(await add('MANAGER',DT,{type:'SACCO_LICENCE',number:'SASRA/0042',authority:'SACCO Societies Regulatory Authority (SASRA)',expires:D[400]}))[0].licence_id;
 assert.equal((await summary('MANAGER')).filter(r=>r.state==='Missing').length,0);
 await end('MANAGER',sasra,D[0],'Licence withdrawn by the regulator');
 assert.equal((await summary('MANAGER')).filter(r=>r.state==='Missing').length,1,'ending the licence makes the gap show again');
 const c2=(await q('MANAGER','select erp_private.licence_counts() c'))[0].c;assert.equal(c2.expected_licences_missing,1);

 // ---- 7. The audit flag: type, authority, expiry and state; never the number --------------------------------------------------------------------
 const flags=j(await q('SUPERVISOR','select * from erp_private.audit_licence_flags($1)',[A]));
 assert.ok(flags.length>=4);assert.ok(flags.every(f=>!('licence_number' in f)&&!('evidence_id' in f)),'no licence number reaches the audit team');
 assert.equal(flags.find(f=>f.label==='NTSA licence').state,'Expiring');
 assert.deepEqual(j(await q('SUPERVISOR','select * from erp_private.audit_licence_flags($1)',[B])),[],'no licences, none expected');
 const dtFlags=j(await q('SUPERVISOR','select * from erp_private.audit_licence_flags($1)',[DT]));assert.deepEqual(dtFlags.map(f=>f.state),['Missing']);
 assert.deepEqual(j(await q('SUPERVISOR','select * from erp_private.audit_licence_flags($1)',[NW])),[],'the non-withdrawable type is not flagged: the checklist says "if applicable"');
 assert.deepEqual(j(await q('ASSISTANT','select * from erp_private.audit_licence_flags($1)',[A])),[],'staff with no access to the client see nothing');
 assert.deepEqual(j(await q('INTERN','select * from erp_private.audit_licence_flags($1)',[A])),[]);
});
