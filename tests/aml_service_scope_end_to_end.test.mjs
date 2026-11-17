import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {amlAction,raiseAmlServiceFlag,amlServiceScope}=await import('../supabase/functions/staff-workspace-v12/aml-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>amlAction(tx,a,p));
test('build 2856: the MLRO decides which services need AML scope; set-up flags the client once per rule; records are never edited',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 const ax=(role,p)=>as(role,a=>amlAction(tx,a,p));
 const rule=(over={})=>({action:'aml_service_rule_set',service_code:'TAX-COMP',applicability:'Ask AML questions',reason:'Tax work can involve client money',source:'Fictional MLRO memo 1',...over});
 await as('PARTNER',()=>tx`select erp_private.staff_right_grant(${actors.MANAGER.staff_id}::uuid,'MLRO','Appointed as the firm MLRO',current_date+30)`);
 // Nothing is decided for the MLRO: every active service shows as not decided, and an undecided service is not exempt.
 const r0=await ax('ASSISTANT',{action:'aml_service_rules_read'});
 assert.ok(r0.services.length>=30);assert.ok(r0.services.every(s=>s.status==='MLRO has not decided'));assert.equal(r0.can_set,false);assert.match(r0.note,/not treated as exempt/);
 await assert.rejects(()=>ax('INTERN',{action:'aml_service_rules_read'}),/client access/);
 const sc0=await as('ASSISTANT',()=>amlServiceScope(tx,C,'TAX-COMP'));assert.equal(sc0.scope.code,'UNDECIDED');assert.equal(sc0.scope.needs_flag,false);
 assert.equal((await as('ASSISTANT',a=>raiseAmlServiceFlag(tx,a,C,'TAX-COMP',null))).raised,false);
 // Only the MLRO sets a rule; choices come from the MLRO's own lists.
 await assert.rejects(()=>ax('SUPERVISOR',rule()),/MLRO/);
 await assert.rejects(()=>ax('MANAGER',rule({service_code:'NOPE-XX'})),/catalogue/);
 await assert.rejects(()=>ax('MANAGER',rule({applicability:'Maybe'})),/Choose whether AML applies/);
 await assert.rejects(()=>ax('MANAGER',rule({reason:'no'})),/reason/i);
 await assert.rejects(()=>ax('MANAGER',rule({activities:['Underwater basket weaving']})),/not on the MLRO's current services/);
 await assert.rejects(()=>ax('MANAGER',rule({applicability:'Not relevant',activities:['Tax compliance and advice']})),/cannot list AML-relevant activities/);
 const set1=await ax('MANAGER',rule({activities:['Tax compliance and advice']}));assert.equal(set1.replaced,false);
 await assert.rejects(()=>ax('MANAGER',rule({activities:['Tax compliance and advice']})),/already the rule/);
 const r1=await ax('ASSISTANT',{action:'aml_service_rules_read'});const row=r1.services.find(s=>s.service_code==='TAX-COMP');assert.equal(row.status,'Ask AML questions');assert.deepEqual(row.activities,['Tax compliance and advice']);
 // A change ends the old rule with a reason and records a new one; history is kept.
 const set2=await ax('MANAGER',rule({applicability:'Refer to the MLRO',reason:'Handles client money for filing payments',source:'Fictional MLRO memo 2'}));assert.equal(set2.replaced,true);
 const r2=await ax('MANAGER',{action:'aml_service_rules_read'});assert.equal(r2.history.length,1);assert.match(r2.history[0].ended_reason,/Replaced/);assert.equal(r2.services.find(s=>s.service_code==='TAX-COMP').status,'Refer to the MLRO');
 // Records are never edited or removed, even by the database role that wrote them.
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.aml_service_rules set reason='Changed quietly' where service_code='TAX-COMP' and ended_at is null`),/not edited/);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.aml_service_rules set applicability='Not relevant' where service_code='TAX-COMP' and ended_at is not null`),/history/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.aml_service_rules where service_code='TAX-COMP'`),/archived|deleted|permission denied/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.aml_service_rules(service_code,applicability,reason,source,set_by) values('TAX-KRA','Not relevant','Staff cannot do this','Nowhere',${actors.ASSISTANT.staff_id})`),/row-level security|violates/);
 // Setting a service up flags the client once per rule; a second set-up of the same rule raises nothing.
 const f1=await as('ASSISTANT',a=>raiseAmlServiceFlag(tx,a,C,'TAX-COMP',null));assert.equal(f1.raised,true);assert.equal(f1.scope.code,'REFER');assert.equal(f1.scope.cleared,false);
 assert.equal((await as('ASSISTANT',a=>raiseAmlServiceFlag(tx,a,C,'TAX-COMP',null))).raised,false);
 const pv=await ax('ASSISTANT',{action:'aml_profile_read',client_id:C});assert.equal(pv.service_flags.length,1);assert.equal(pv.service_flags[0].answered,false);
 const ov=await ax('MANAGER',{action:'aml_overview'});assert.equal(ov.queue.services.length,1);assert.equal(ov.counts.services_flagged,1);assert.ok(ov.counts.services_undecided>=30);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.aml_service_flags set applicability='Ask AML questions'`),/not changed or removed|permission denied/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`delete from erp_private.aml_service_flags`),/not changed or removed|permission denied/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.aml_service_flags(client_id,service_code,rule_id,applicability,raised_by) select ${C},'TAX-COMP',rule_id,'Ask AML questions',${actors.MANAGER.staff_id} from erp_private.aml_service_rules where ended_at is null and service_code='TAX-COMP'`),/row-level security|violates/);
 // When the MLRO decides the client's profile after the flag, the flag counts as answered, and an approved profile is reported as cleared for the next set-up.
 await ax('ASSISTANT',{action:'aml_profile_save',client_id:C,fields:{purpose_of_relationship:'Annual tax compliance for a fictional trading company',expected_activity:'Monthly VAT and PAYE returns',pep_type:'No known PEP',screening_status:'No match',screening_list_source:'Fictional screening list',screening_list_date:'2026-11-01'},selections:[{category:'COUNTRY',context:'Incorporation or residence',value:'Kenya'},{category:'SOURCE_OF_FUNDS',value:'Business income'},{category:'SERVICE_ACTIVITY',value:'Tax compliance and advice'}]});
 await ax('ASSISTANT',{action:'aml_profile_submit',client_id:C});
 await ax('PARTNER',{action:'aml_decide',client_id:C,decision:'Accept',risk_rating:'Low',risk_reasons:'Routine local client with clear records',next_review:'2099-01-01'});
 const pv2=await ax('ASSISTANT',{action:'aml_profile_read',client_id:C});assert.equal(pv2.service_flags[0].answered,true);
 // Staff read the approval trail with the decider's name even though they cannot read that person's staff record (build 2855 hid it).
 assert.ok(pv2.decisions.length>=1);assert.equal(pv2.decisions[0].decided_by_name,(await tx`select full_name from erp_private.staff_members where staff_id=${actors.PARTNER.staff_id}`)[0].full_name);assert.equal(pv2.service_flags[0].raised_by_name,(await tx`select full_name from erp_private.staff_members where staff_id=${actors.ASSISTANT.staff_id}`)[0].full_name);
 const ov2=await ax('MANAGER',{action:'aml_overview'});assert.equal(ov2.queue.services.length,0);
 const sc2=await as('ASSISTANT',()=>amlServiceScope(tx,C,'TAX-COMP'));assert.equal(sc2.scope.cleared,true);assert.match(sc2.scope.line,/already approved/);
 // Ending a rule leaves the service undecided again.
 await assert.rejects(()=>ax('MANAGER',{action:'aml_service_rule_end',service_code:'TAX-COMP',reason:'no'}),/at least 5/);
 await ax('MANAGER',{action:'aml_service_rule_end',service_code:'TAX-COMP',reason:'Replaced by the firm-wide AML policy'});
 assert.equal((await as('ASSISTANT',()=>amlServiceScope(tx,C,'TAX-COMP'))).scope.code,'UNDECIDED');
 await assert.rejects(()=>ax('MANAGER',{action:'aml_service_rule_end',service_code:'TAX-COMP',reason:'Nothing to end here'}),/no live rule/);
});
