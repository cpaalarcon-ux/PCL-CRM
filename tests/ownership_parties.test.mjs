// Step 3 (joined-practice review): directors, shareholders and trustees as data, ownership links, the 100% limit and the group profile.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('Step 3: parties register, ownership links, 100% limit, group profile',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,st,sub,fam)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate',${st},${sub},${fam},${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const A=await mk('UAT Fictional Operating Ltd','A200000001Z','Limited Company','Private Limited Company','Limited company');
 const B=await mk('UAT Fictional Holding Ltd','A200000002Z','Limited Company','Private Limited Company','Limited company');
 const T=await mk('UAT Fictional Family Trust','A200000003Z','Other','Trust','Other legal entity');
 const S=await mk('UAT Fictional Shop','A200000004Z','Individual','Sole Proprietor','Sole proprietor');
 const add=(role,client,o)=>q(role,`insert into erp_private.client_parties(client_id,role,party_kind,full_name,identity_reference,holder_client_id,shareholding_percentage,appointed_on,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning party_id`,[client,o.role,o.kind||'Individual',o.name,o.ident===undefined?'ID12345678':o.ident,o.holder||null,o.pct??null,o.on||'2024-01-01',actors[role].staff_id]);
 const status=async(role)=>j(await q(role,'select * from erp_private.ownership_status_all()'));
 const of=(rows,c)=>rows.find(r=>r.client_id===c);

 // ---- 1. Who may record -------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(()=>add('ASSISTANT',A,{role:'Director',name:'Fictional Assistant Entry'}),/row-level security|Only a Manager or Partner/);
 await assert.rejects(()=>add('SUPERVISOR',A,{role:'Director',name:'Fictional Supervisor Entry'}),/row-level security|Only a Manager or Partner/);
 const dir=(await add('MANAGER',A,{role:'Director',name:'Fictional Director One'}))[0].party_id;
 assert.deepEqual((await q('ASSISTANT','select * from erp_private.client_parties')),[],'staff below Manager cannot read the register');
 assert.deepEqual(await status('ASSISTANT'),[],'nor its status');

 // ---- 2. Shareholdings: never above 100, advisory below ------------------------------------------------------------------------------------------
 let st=of(await status('MANAGER'),A);
 assert.deepEqual(st.expects,['Director','Shareholder']);assert.ok(st.issues.includes('No current shareholder is recorded'));
 const sh1=(await add('MANAGER',A,{role:'Shareholder',name:'Fictional Shareholder One',pct:60}))[0].party_id;
 st=of(await status('MANAGER'),A);assert.deepEqual(st.issues,['Shareholdings add up to 60.0000 percent, not 100']);assert.equal(Number(st.shareholding_total),60);
 await assert.rejects(()=>add('MANAGER',A,{role:'Shareholder',name:'Fictional Shareholder Two',ident:'ID22222222',pct:40.0001}),/cannot exceed 100/);
 const sh2=(await add('MANAGER',A,{role:'Shareholder',name:'Fictional Shareholder Two',ident:'ID22222222',pct:40}))[0].party_id;
 st=of(await status('MANAGER'),A);assert.deepEqual(st.issues,[],'director and 100% recorded');
 await assert.rejects(()=>add('MANAGER',A,{role:'Shareholder',name:'Fictional Shareholder Three',ident:'ID33333333',pct:0.0001}),/cannot exceed 100/);
 await assert.rejects(()=>add('MANAGER',A,{role:'Director',name:'Fictional Director One'}),/duplicate key|unique/i,'the same current person twice');
 await assert.rejects(()=>add('MANAGER',A,{role:'Director',name:'Fictional Director Two',pct:5,ident:'ID44444444'}),/violates check constraint/,'a percentage belongs to shareholders only');
 await assert.rejects(()=>add('MANAGER',A,{role:'Shareholder',name:'Fictional Nobody',ident:'ID55555555'}),/violates check constraint/,'a shareholder needs a percentage');

 // ---- 3. Ending an entry frees its share and keeps history ----------------------------------------------------------------------------------------
 const end=(role,party,on,reason)=>q(role,`update erp_private.client_parties set ceased_on=$2,end_reason=$3,ended_by=$4 where party_id=$1`,[party,on,reason,actors[role].staff_id]);
 await assert.rejects(()=>end('MANAGER',sh2,'2025-01-01','short'),/violates check constraint/,'a reason of 10 characters is needed');
 await assert.rejects(()=>end('MANAGER',sh2,'2999-01-01','Sold all shares to the other shareholder'),/future/);
 await end('ASSISTANT',sh2,'2025-01-01','Sold all shares to the other shareholder');// row security hides the row from staff below Manager, so nothing changes
 assert.equal((await tx`select ceased_on from erp_private.client_parties where party_id=${sh2}`)[0].ceased_on,null);
 await end('MANAGER',sh2,'2025-01-01','Sold all shares to the other shareholder');
 st=of(await status('MANAGER'),A);assert.deepEqual(st.issues,['Shareholdings add up to 60.0000 percent, not 100']);
 await assert.rejects(()=>end('MANAGER',sh2,'2025-02-01','Trying to end an ended entry again'),/stays ended/);
 await add('MANAGER',A,{role:'Shareholder',name:'Fictional Shareholder Three',ident:'ID33333333',pct:40});
 assert.equal(Number((await tx`select count(*)::int n from erp_private.client_parties where client_id=${A}`)[0].n),4,'the ended row is kept');
 await assert.rejects(()=>q('MANAGER',`update erp_private.client_parties set full_name='Renamed Person' where party_id=$1`,[dir]),/cannot be edited/);
 await assert.rejects(()=>q('MANAGER',`update erp_private.client_parties set shareholding_percentage=10 where party_id=$1`,[sh1]),/cannot be edited/);
 await assert.rejects(()=>tx`delete from erp_private.client_parties where party_id=${sh2}`,/delete|cannot/i);
 assert.ok(Number((await tx`select count(*)::int n from erp_private.audit_events where table_name='client_parties'`)[0].n)>=5,'changes are in the firm change log');

 // ---- 4. Ownership link between entities, no loops ---------------------------------------------------------------------------------------------------
 await add('MANAGER',B,{role:'Shareholder',kind:'Entity',name:'UAT Fictional Operating Ltd',ident:'A200000001Z',holder:A,pct:30});
 await assert.rejects(()=>add('MANAGER',A,{role:'Shareholder',kind:'Entity',name:'UAT Fictional Holding Ltd',ident:'A200000002Z',holder:B,pct:0.0001}),/loop|cannot exceed/,'A holds B would loop');
 // free a little room on A so the loop check is the reason, not the percentage
 await end('MANAGER',sh1,'2025-03-01','Shares transferred, entry to be re-entered');
 await assert.rejects(()=>add('MANAGER',A,{role:'Shareholder',kind:'Entity',name:'UAT Fictional Holding Ltd',ident:'A200000002Z',holder:B,pct:10}),/loop/);
 await assert.rejects(()=>add('MANAGER',A,{role:'Shareholder',kind:'Entity',name:'UAT Fictional Operating Ltd',ident:'A200000001Z',holder:A,pct:10}),/own shareholder/);
 await assert.rejects(()=>add('MANAGER',A,{role:'Director',kind:'Entity',name:'Corporate Director Ltd',ident:'A200000009Z',holder:T}),/violates check constraint/,'only shareholders link to a client');
 const C3=await mk('UAT Fictional Third Ltd','A200000005Z','Limited Company','Private Limited Company','Limited company');
 await add('MANAGER',C3,{role:'Shareholder',kind:'Entity',name:'UAT Fictional Holding Ltd',ident:'A200000002Z',holder:B,pct:100});
 await assert.rejects(()=>add('MANAGER',A,{role:'Shareholder',kind:'Entity',name:'UAT Fictional Third Ltd',ident:'A200000005Z',holder:C3,pct:10}),/loop/,'A holds C3, which B holds, which A holds');

 // ---- 5. Trusts expect trustees; a sole proprietor expects nothing -----------------------------------------------------------------------------
 let all=await status('MANAGER');
 assert.deepEqual(of(all,T).expects,['Trustee']);assert.deepEqual(of(all,T).issues,['No current trustee is recorded']);
 assert.deepEqual(of(all,S).expects,[]);assert.deepEqual(of(all,S).issues,[]);
 await add('PARTNER',T,{role:'Trustee',name:'Fictional Trustee One'});
 assert.deepEqual(of(await status('PARTNER'),T).issues,[]);

 // ---- 6. Group profile -------------------------------------------------------------------------------------------------------------------------------
 const grp=(role,c,o)=>q(role,`insert into erp_private.client_group_profile(client_id,group_status,ultimate_parent_client_id,ultimate_parent_name,ultimate_parent_country,assessed_by) values($1,$2,$3,$4,$5,$6)`,[c,o.status,o.parent||null,o.name||null,o.country||null,actors[role].staff_id]);
 assert.equal(await q('MANAGER','select erp_private.group_unassessed_count() n').then(r=>Number(r[0].n)),5,'five clients, none assessed');
 await assert.rejects(()=>grp('ASSISTANT',A,{status:'Standalone'}),/row-level security|Only a Manager/);
 await assert.rejects(()=>grp('MANAGER',A,{status:'Part of a group'}),/violates check constraint/,'a group member needs a parent');
 await assert.rejects(()=>grp('MANAGER',A,{status:'Standalone',name:'Stray Parent Ltd',country:'Kenya'}),/violates check constraint/,'a standalone client has no parent');
 await assert.rejects(()=>grp('MANAGER',A,{status:'Part of a group',parent:A}),/violates check constraint/,'not its own parent');
 await grp('MANAGER',A,{status:'Part of a group',parent:B});
 await grp('MANAGER',B,{status:'Part of a group',name:'Fictional Foreign Parent GmbH',country:'Germany'});
 await grp('MANAGER',S,{status:'Standalone'});
 assert.equal(await q('MANAGER','select erp_private.group_unassessed_count() n').then(r=>Number(r[0].n)),2);
 await assert.rejects(()=>tx`delete from erp_private.client_group_profile where client_id=${S}`,/delete|cannot/i);
});
