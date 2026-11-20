import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {validateCanonicalRate,registryParameters,taxTypes} from '../supabase/functions/staff-workspace-v12/tax-registry.mjs';import {turnoverWatch,trailingYear} from '../supabase/functions/staff-workspace-v12/turnover-watch.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {taxConfigAction}=await import('../supabase/functions/staff-workspace-v12/tax-config-actions.ts');
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const root=path.resolve(import.meta.dirname,'..');

const vatRule={rate_key:'KE_VAT_REG_THRESHOLD',parameters:{threshold:5000000},legal_review_status:'Pending'};
const totRule={rate_key:'KE_TOT',parameters:{minimum_turnover_exclusive:1000000,maximum_turnover:25000000},legal_review_status:'Confirmed'};
const codes=w=>w.alerts.map(a=>a.code);

test('turnover watch: no data, partial coverage and missing limits are reported, never guessed',()=>{
 let w=turnoverWatch({});assert.equal(w.status,'No data');assert.deepEqual(codes(w),['NO_SALES_DATA']);assert.equal(w.turnover,null);
 w=turnoverWatch({turnover:2000000,monthsCovered:12,profile:{regime:'Standard',obligations:[]}});
 assert(codes(w).includes('VAT_THRESHOLD_NOT_SET'));assert.equal(w.status,'Review');
 w=turnoverWatch({turnover:2000000,monthsCovered:6,profile:{regime:'Standard',obligations:[]},vatRule});
 assert(codes(w).includes('PARTIAL_COVERAGE'));assert(!codes(w).includes('VAT_REGISTRATION'));
 w=turnoverWatch({turnover:2000000,monthsCovered:12,profile:{regime:'TOT',obligations:['TOT']}});
 assert(codes(w).includes('TOT_BAND_NOT_SET'));
});

test('turnover watch: limits come from the register and VAT does not exclude TOT',()=>{
 let w=turnoverWatch({turnover:6000000,monthsCovered:12,profile:{regime:'TOT',obligations:['TOT']},totRule,vatRule});
 assert(codes(w).includes('VAT_REGISTRATION'));assert.match(w.alerts.find(a=>a.code==='VAT_REGISTRATION').message,/Provisional/);assert.match(w.alerts.find(a=>a.code==='VAT_REGISTRATION').message,/VAT and TOT can coexist/);
 assert(!codes(w).includes('TOT_CEILING'));assert.equal(w.status,'Review');
 w=turnoverWatch({turnover:6000000,monthsCovered:12,profile:{regime:'TOT',obligations:['TOT','VAT'],obligation_statuses:{VAT:{registered:'YES'}}},totRule,vatRule});
 assert(codes(w).includes('VAT_REGISTERED'));assert(!codes(w).includes('VAT_REGISTRATION'));assert.equal(w.status,'Clear');
 w=turnoverWatch({turnover:26000000,monthsCovered:12,profile:{regime:'TOT',obligations:['TOT']},totRule});
 assert(codes(w).includes('TOT_CEILING'));
 w=turnoverWatch({turnover:900000,monthsCovered:12,profile:{regime:'TOT',obligations:['TOT']},totRule});
 assert(codes(w).includes('TOT_FLOOR'));
 w=turnoverWatch({turnover:3000000,monthsCovered:12,profile:null,vatRule});
 assert(codes(w).includes('NO_VERIFIED_PROFILE'));
 assert.deepEqual(trailingYear('2026-11-07'),{start:'2025-11-08',end:'2026-11-07'});
 assert.throws(()=>trailingYear('nope'),/valid date/);
});

test('threshold rule type validates a positive figure only',()=>{
 assert(taxTypes.includes('Registration threshold'));
 assert.throws(()=>validateCanonicalRate('KE_VAT_REG_THRESHOLD','VAT',{treatment:'x'}),/Registration threshold/);
 assert.throws(()=>validateCanonicalRate('KE_VAT_REG_THRESHOLD','Registration threshold',{}),/threshold/i);
 assert.throws(()=>validateCanonicalRate('KE_VAT_REG_THRESHOLD','Registration threshold',{threshold:-1}),/threshold/i);
 validateCanonicalRate('KE_VAT_REG_THRESHOLD','Registration threshold',{threshold:1234});
 assert.equal(registryParameters('Registration threshold',{threshold:1234,rate:9}).threshold,1234);
});

test('MSME pack and VAT threshold row: Draft, no figure, watch handles a client with no sales',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'MSQA','Fictional rate firm')`;
 for(const role of ['PARTNER','MANAGER']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const act=(role,p)=>as(role,a=>taxConfigAction(tx,a,p));
 const th=(await tx`select * from erp_private.tax_rates where rate_key='KE_VAT_REG_THRESHOLD'`)[0];
 assert.equal(th.status,'Draft');assert.equal(th.legal_review_status,'Pending');assert.deepEqual(th.parameters,{});assert.equal(th.tax_type,'Registration threshold');
 const accts=await tx`select code,status,industry_packs,tax_note from erp_private.account_catalog where 'MSME'=any(industry_packs) order by code`;
 assert(accts.length>=6);assert(accts.every(a=>a.status==='Draft'));assert(accts.every(a=>!/\d\s*%/.test(a.tax_note)));
 await assert.rejects(()=>tx`insert into erp_private.account_catalog(code,name,account_group,category_code,statement,industry_packs,catalog_version,status) values('99999','x','Expenditure','EXP01','Profit or loss',ARRAY['Nonsense'],'v','Draft')`,/check|violates/i);
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional trader',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const w=await act('MANAGER',{action:'tax_profile_turnover_watch',client_id:C,as_of:'2026-11-07'});
 assert.equal(w.clients.length,1);assert.equal(w.clients[0].status,'No data');assert.equal(w.limits.vat_registration,null);assert.equal(w.window.start,'2025-11-08');
 await assert.rejects(()=>act('MANAGER',{action:'rate_save',rate_id:th.rate_id,revision:th.revision,rate_key:'KE_VAT_REG_THRESHOLD',tax_type:'Registration threshold',label:'x check',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{threshold:-5},legal_review_status:'Pending',legal_review_note:'Tax Lead to confirm the threshold figure'}),/valid number|permitted range|threshold/i);
});
