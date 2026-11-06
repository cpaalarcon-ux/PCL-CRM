import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {legalReviewIssues,legalConfirmIssue,legalPendingRates,rateApprovalIssue,taxTypes,validateCanonicalRate} from '../supabase/functions/staff-workspace-v12/tax-registry.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {taxConfigAction}=await import('../supabase/functions/staff-workspace-v12/tax-config-actions.ts');
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const root=path.resolve(import.meta.dirname,'..');

test('pending legal review: pure rules',()=>{
 const rates=[{rate_key:'KE_A',legal_review_status:'Pending'},{rate_key:'KE_A',legal_review_status:'Pending'},{rate_key:'KE_B',legal_review_status:'Confirmed'},{rate_key:'KE_C'}];
 assert.equal(legalPendingRates(rates).length,2);
 const issues=legalReviewIssues(rates);assert.equal(issues.length,1);assert.match(issues[0],/KE_A.*cannot be submitted/);
 assert.deepEqual(legalReviewIssues([]),[]);
 assert.match(rateApprovalIssue({legal_review_status:'Pending',created_by:'a'},'b'),/pending legal review/);
 const good={legal_review_status:'Pending',status:'Draft',parameters:{rate:1},legal_citation:'Fictional Act section 1'};
 const partner={category_code:'PARTNER'},input={lead_name:'Fictional Lead',reference:'Memo 2026-11-07 fictional',confirmed:true};
 assert.equal(legalConfirmIssue(good,input,partner),null);
 assert.match(legalConfirmIssue(good,input,{category_code:'MANAGER'}),/Partner/);
 assert.match(legalConfirmIssue(good,{...input,reference:'short'},partner),/reference/);
 assert.match(legalConfirmIssue(good,{...input,lead_name:''},partner),/Tax Lead/);
 assert.match(legalConfirmIssue(good,{...input,confirmed:false},partner),/match/);
 assert.match(legalConfirmIssue({...good,parameters:{}},input,partner),/no figures/);
 assert.match(legalConfirmIssue({...good,legal_citation:''},input,partner),/citation/);
 assert.match(legalConfirmIssue({...good,legal_review_status:'Not required'},input,partner),/Pending/);
 assert(taxTypes.includes('Significant economic presence tax'));
 assert.throws(()=>validateCanonicalRate('KE_SEPT','Levy',{rate:1}),/Significant economic presence tax/);
 validateCanonicalRate('KE_SEPT','Significant economic presence tax',{rate:1});
});

test('rate register: SEPT placeholder carries no rate and the Tax Lead confirmation gates approval',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'RLQA','Fictional rate firm')`;
 for(const role of ['PARTNER','MANAGER']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const row=async()=>(await tx`select * from erp_private.tax_rates where rate_key='KE_SEPT'`)[0];
 const act=(role,p)=>as(role,a=>taxConfigAction(tx,a,p));

 // 1. The placeholder exists with no figure at all.
 let r=await row();
 assert.equal(r.status,'Draft');assert.equal(r.legal_review_status,'Pending');assert.equal(r.tax_type,'Significant economic presence tax');
 assert.deepEqual(r.parameters,{});assert.equal(r.parameters.rate,undefined);
 // It cannot be tested or confirmed while it has no figures.
 await assert.rejects(()=>act('MANAGER',{action:'rate_test',rate_id:r.rate_id,revision:r.revision,confirm_staging:true,testing_note:'Fictional staging test purpose and result'}),/rate|number|required|staging/i);
 await assert.rejects(()=>act('PARTNER',{action:'rate_legal_confirm',rate_id:r.rate_id,revision:r.revision,lead_name:'Fictional Lead',reference:'Memo 2026-11-07 fictional',legal_citation:'Fictional Act section 1',confirmed:true}),/no figures/);

 // 2. A Manager enters a FICTIONAL figure for this isolated test database and keeps it pending.
 await act('MANAGER',{action:'rate_save',rate_id:r.rate_id,revision:r.revision,rate_key:'KE_SEPT',tax_type:'Significant economic presence tax',label:'Isolated SEPT check',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{rate:5},source_url:'https://www.kra.go.ke/fictional',source_note:'Fictional Finance Act section 1 for isolated test',legal_citation:'Fictional Finance Act section 1',legal_review_status:'Pending',legal_review_note:'Awaiting Tax Lead written confirmation'});
 r=await row();assert.equal(r.parameters.rate,5);assert.equal(r.legal_review_status,'Pending');
 // Pending rates cannot be approved, by action or by direct update.
 await assert.rejects(()=>act('PARTNER',{action:'rate_approve',rate_id:r.rate_id,revision:r.revision,confirm_legal_basis:true}),/pending legal review/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.tax_rates set status='Approved',approved_by=${actors.PARTNER.staff_id},approved_at=now(),partner_source_verified_on=current_date where rate_id=${r.rate_id}`),/pending legal review/);
 // A Pending note is required.
 await assert.rejects(()=>act('MANAGER',{action:'rate_save',rate_id:r.rate_id,revision:r.revision,rate_key:'KE_SEPT',tax_type:'Significant economic presence tax',label:'Isolated SEPT check',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{rate:5},legal_review_status:'Pending',legal_review_note:'x'}),/Tax Lead still has to confirm/);

 // 3. Only a Partner can record the confirmation; not by action and not by direct update.
 await assert.rejects(()=>act('MANAGER',{action:'rate_legal_confirm',rate_id:r.rate_id,revision:r.revision,lead_name:'Fictional Lead',reference:'Memo 2026-11-07 fictional',legal_citation:'Fictional Finance Act section 1',confirmed:true}),/Partner/);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.tax_rates set legal_review_status='Confirmed',legal_reviewed_by=${actors.MANAGER.staff_id},legal_reviewed_at=now(),legal_review_reference='Memo 2026-11-07 fictional' where rate_id=${r.rate_id}`),/Partner/);
 await assert.rejects(()=>act('PARTNER',{action:'rate_legal_confirm',rate_id:r.rate_id,revision:r.revision,lead_name:'Fictional Lead',reference:'short',legal_citation:'Fictional Finance Act section 1',confirmed:true}),/reference/);
 await act('PARTNER',{action:'rate_legal_confirm',rate_id:r.rate_id,revision:r.revision,lead_name:'Fictional Lead',reference:'Memo 2026-11-07 fictional',legal_citation:'Fictional Finance Act section 1',confirmed:true});
 r=await row();assert.equal(r.legal_review_status,'Confirmed');assert.equal(r.legal_reviewed_by,actors.PARTNER.staff_id);assert.match(r.legal_review_note,/Fictional Lead/);
 // The confirmation covers these figures; a Manager cannot edit them, and it cannot be withdrawn.
 await assert.rejects(()=>act('MANAGER',{action:'rate_save',rate_id:r.rate_id,revision:r.revision,rate_key:'KE_SEPT',tax_type:'Significant economic presence tax',label:'Isolated SEPT check',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{rate:6}}),/Tax Lead confirmation covers/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.tax_rates set legal_review_status='Pending',legal_review_note='withdrawn for test purposes' where rate_id=${r.rate_id}`),/cannot be withdrawn/);

 // 4. Now the Partner can approve.
 await act('PARTNER',{action:'rate_approve',rate_id:r.rate_id,revision:r.revision,confirm_legal_basis:true});
 assert.equal((await row()).status,'Approved');
});
