import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {applyLegalStructure,requireClassified,requireRightChart,classifyClientsAction} from '../supabase/functions/staff-workspace-v12/legal-structure-actions.ts';
import {FAMILIES,accountingEnabled,saccoTypeFor} from '../supabase/functions/staff-workspace-v12/legal-structure.mjs';
import {subtypesOf} from '../staff-legal-structure.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),C2=id(),C3=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('Co-operative family: the two SACCO types, the retired single SACCO row, and no accounting engine yet',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'LSQA','Fictional legal structure firm')`;
 const staff=async(role,cat,firm)=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${firm},'Assigned')`;};
 await staff('PARTNER','PARTNER',F);await staff('MANAGER','MANAGER',F);await staff('SUPERVISOR','SUPERVISOR',F);
 const client=async cid=>(await tx`select legal_structure,legal_subtype,legal_entity_type from erp_private.clients where client_id=${cid}`)[0];
 const rows=()=>tx`select structure,subtype,engine_family,retired,sacco_type from erp_private.legal_structure_types`;

 // Reference rows: both SACCO types and the other co-operatives are one family; the old single row is retired; nobody chooses it again.
 const r=await rows(),co=r.filter(x=>x.structure==='Co-operative Society');
 assert.deepEqual(co.map(x=>x.subtype).sort(),['Co-operative Society','Co-operative Union','Deposit-taking SACCO','Non-withdrawable-deposit-taking SACCO','SACCO']);
 for(const x of co.filter(x=>x.subtype!=='SACCO'))assert.equal(x.engine_family,'Co-operative society',x.subtype);
 assert.ok(FAMILIES.includes('Co-operative society'));assert.equal(accountingEnabled('Co-operative society'),false,'the SACCO chart is a later build');
 assert.equal(co.find(x=>x.subtype==='SACCO').retired,true);assert.equal(co.filter(x=>x.retired).length,1);
 assert.equal(saccoTypeFor(r,'Co-operative Society','Deposit-taking SACCO'),'DT_SACCO');assert.equal(saccoTypeFor(r,'Co-operative Society','Non-withdrawable-deposit-taking SACCO'),'NWDT_SACCO');
 for(const s of ['Co-operative Society','Co-operative Union','SACCO'])assert.equal(saccoTypeFor(r,'Co-operative Society',s),'NOT_SACCO',s);
 assert.equal(saccoTypeFor(r,'Limited Company','Private Limited Company'),'NOT_SACCO');
 // The picker hides the retired row unless the client already has it.
 assert.ok(!subtypesOf(r,'Co-operative Society').includes('SACCO'));assert.ok(subtypesOf(r,'Co-operative Society','SACCO').includes('SACCO'));

 // A new client can take a SACCO type, and the SACCO type is read from the subcategory in the database.
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,client_category) values(${C},'Fictional Mkopo SACCO',${actors.MANAGER.staff_id},'Corporate'),(${C2},'Fictional Umoja SACCO',${actors.MANAGER.staff_id},'Corporate'),(${C3},'Fictional Ng''ombe Co-op',${actors.MANAGER.staff_id},'Corporate')`;
 await as('MANAGER',a=>applyLegalStructure(tx,a,C,{legal_structure:'Co-operative Society',legal_subtype:'Deposit-taking SACCO'},true));
 await as('MANAGER',a=>applyLegalStructure(tx,a,C2,{legal_structure:'Co-operative Society',legal_subtype:'Non-withdrawable-deposit-taking SACCO'},true));
 await as('MANAGER',a=>applyLegalStructure(tx,a,C3,{legal_structure:'Co-operative Society',legal_subtype:'Co-operative Society'},true));
 const st=async cid=>(await tx`select erp_private.client_sacco_type(${cid}) as t`)[0].t;
 assert.equal(await st(C),'DT_SACCO');assert.equal(await st(C2),'NWDT_SACCO');assert.equal(await st(C3),'NOT_SACCO');
 assert.equal((await client(C)).legal_entity_type,null,'the family is confirmed at the identity step, as for every client');

 // The retired row is refused by the server and by the database; a client keeps it until reclassified.
 await assert.rejects(()=>as('MANAGER',a=>applyLegalStructure(tx,a,C3,{legal_structure:'Co-operative Society',legal_subtype:'SACCO',legal_structure_reason:'Fictional attempt to use the retired row'})),/retired/);
 await assert.rejects(()=>tx`update erp_private.clients set legal_subtype='SACCO' where client_id=${C3}`,/retired/);
 const C4=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,client_category) values(${C4},'Fictional old SACCO',${actors.MANAGER.staff_id},'Corporate')`;
 await tx`alter table erp_private.clients disable trigger legal_subtype_not_retired`;
 await tx`update erp_private.clients set legal_structure='Co-operative Society',legal_subtype='SACCO' where client_id=${C4}`;
 await tx`alter table erp_private.clients enable trigger legal_subtype_not_retired`;
 assert.equal((await as('MANAGER',a=>applyLegalStructure(tx,a,C4,{legal_structure:'Co-operative Society',legal_subtype:'SACCO'}))).changed,false,'unchanged keeps the retired row');
 assert.equal(await st(C4),'NOT_SACCO','the retired row does not count as a SASRA type');
 await as('MANAGER',a=>applyLegalStructure(tx,a,C4,{legal_structure:'Co-operative Society',legal_subtype:'Non-withdrawable-deposit-taking SACCO',legal_structure_reason:'Fictional reclassification after review'}));
 assert.equal(await st(C4),'NWDT_SACCO');

 // Checklist: the SASRA licence is required for the deposit-taking type only; everything else matches the co-operative list.
 const req=async s=>await tx`select rule_code,requirement from erp_private.legal_structure_requirements where structure='Co-operative Society' and subtype=${s}`;
 const m=a=>Object.fromEntries(a.map(x=>[x.rule_code,x.requirement]));
 const dt=m(await req('Deposit-taking SACCO')),nw=m(await req('Non-withdrawable-deposit-taking SACCO')),co1=m(await req('Co-operative Society'));
 assert.equal(dt.SACCO_LICENCE,'Required');assert.equal(nw.SACCO_LICENCE,'If applicable');assert.equal(co1.SACCO_LICENCE,undefined);
 for(const k of Object.keys(co1)){assert.equal(dt[k],co1[k],'DT keeps '+k);assert.equal(nw[k],co1[k],'NWDT keeps '+k);}
 assert.equal(dt.KRA_PIN,'Required');
 for(const s of ['Deposit-taking SACCO','Non-withdrawable-deposit-taking SACCO']){
  const d=(await tx`select taxpayer_class,rule_status,suggested_obligations,note from erp_private.legal_structure_tax_defaults where structure='Co-operative Society' and subtype=${s}`)[0];
  assert.ok(d,s+' has a suggested classification');assert.equal(d.rule_status,'Suggested');assert.ok(d.suggested_obligations.includes('Other entity income tax'));assert.match(d.note,/does not compute/);
 }

 // A co-operative client cannot propose a chart yet, with a clear reason rather than a database error.
 const all=await tx`select count(*)::int n from erp_private.legal_structure_types`;assert.equal(all[0].n,33);
 await assert.rejects(()=>tx`delete from erp_private.legal_structure_types where subtype='SACCO'`,/delete|not allowed|reject/i,'reference rows are never deleted');
});

test('the S1 migration stores no rate, ratio or deadline',()=>{
 const f=fs.readdirSync(root+'/supabase/migrations').find(x=>x.endsWith('_cooperative_family_sacco_types.sql')),sql=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8');
 assert.doesNotMatch(sql,/\b\d+(\.\d+)?\s?%/);assert.doesNotMatch(sql,/\b31 March\b|\bfour months\b/i);
});
