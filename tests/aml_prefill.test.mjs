import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {amlAction}=await import('../supabase/functions/staff-workspace-v12/aml-actions.ts');const {amlSuggestions}=await import('../supabase/functions/staff-workspace-v12/aml-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>amlAction(tx,a,p));
const rd=f=>fs.readFileSync(path.join(root,f),'utf8');
test('build 2866: suggestions come only from facts held, carry their basis and evidence, and skip what is already chosen',()=>{
 const lookups=[{category:'SERVICE_ACTIVITY',value:'Tax compliance and advice',status:'Starter'},{category:'SERVICE_ACTIVITY',value:'Payroll',status:'Active'},{category:'COUNTRY',value:'Kenya',status:'Starter'}];
 const services=[{service_code:'TAX-COMP',service_name:'Tax compliance',applicability:'Ask AML questions',activities:['tax compliance and advice','Underwater basket weaving']},{service_code:'PAYROLL',service_name:'Payroll',applicability:'Not relevant',activities:['Payroll']},{service_code:'ACC',service_name:'Bookkeeping',applicability:null,activities:[]}];
 const facts=[{field_key:'registration_number',value:'CPR/2015/123456',doc_ref:'DOC-2026-00012',status:'Verified'},{field_key:'county',value:'Bungoma',doc_ref:null,status:'Recorded'}];
 const s=amlSuggestions({clientName:'Chev Ltd',facts,services,lookups,profile:null,selections:[],engagementDate:'2026-01-05'});
 assert.equal(s.text.length,1);assert.equal(s.text[0].key,'purpose_of_relationship');assert.equal(s.text[0].value,'To provide Tax compliance, Payroll and Bookkeeping to Chev Ltd from 5 Jan 2026.');assert.match(s.text[0].basis,/engagement date/);
 assert.deepEqual(s.picks.map(p=>[p.category,p.context,p.value]),[['SERVICE_ACTIVITY','','Tax compliance and advice'],['COUNTRY','Incorporation or residence','Kenya'],['COUNTRY','Business operations','Kenya']],'a rule that is not relevant, an undecided rule and a value not on the MLRO list suggest nothing');
 assert.equal(s.picks[1].doc_ref,'DOC-2026-00012');assert.match(s.picks[1].basis,/Confirm the country/);assert.match(s.picks[2].basis,/Bungoma/);
 // Already filled or chosen: nothing is offered again. Superseded facts and an ended country list offer nothing.
 const done=amlSuggestions({clientName:'Chev Ltd',facts,services,lookups,profile:{purpose_of_relationship:'Annual tax filing'},selections:[{category:'SERVICE_ACTIVITY',context:'',lookup_value:'Tax compliance and advice'},{category:'COUNTRY',context:'Incorporation or residence',lookup_value:'KENYA'}]});
 assert.equal(done.text.length,0);assert.deepEqual(done.picks.map(p=>p.context),['Business operations']);
 assert.equal(amlSuggestions({facts:facts.map(f=>({...f,status:'Superseded'})),lookups,services:[]}).picks.length,0);
 assert.equal(amlSuggestions({facts,lookups:[{category:'COUNTRY',value:'Kenya',status:'Ended'}],services:[]}).picks.length,0);
 // Nothing is suggested for what no record answers.
 const cats=new Set(amlSuggestions({facts,services,lookups}).picks.map(p=>p.category));for(const c of ['SOURCE_OF_FUNDS','SOURCE_OF_WEALTH','RISK_INDICATOR'])assert.ok(!cats.has(c),c);
});
test('build 2866: the profile read offers suggestions to staff who can edit, and the screen shows them with the evidence label',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 await as('PARTNER',()=>tx`select erp_private.staff_right_grant(${actors.MANAGER.staff_id}::uuid,'MLRO','Appointed as the firm MLRO',current_date+30)`);
 const rule=(over={})=>({action:'aml_service_rule_set',service_code:'TAX-COMP',applicability:'Ask AML questions',reason:'Tax work can involve client money',source:'Fictional MLRO memo 1',activities:['Tax compliance and advice'],...over});
 const none=await ax('MANAGER',{action:'aml_profile_read',client_id:C});
 assert.equal(none.suggestions.picks.length,0,'no rule, no facts: nothing to suggest');const blind=await ax('ASSISTANT',{action:'aml_profile_read',client_id:C});assert.equal(blind.suggestions.text.length,0,'services come from projects the person can open');assert.match(none.suggestions.text[0].value,/^To provide .+ to Fictional V3 client\.$/);
 await ax('MANAGER',rule());
 await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,recorded_by) values(${C},'registration_number','CPR/2015/123456','Client statement',${actors.ASSISTANT.staff_id}),(${C},'county','Bungoma','Client statement',${actors.ASSISTANT.staff_id})`;
 const v=await ax('MANAGER',{action:'aml_profile_read',client_id:C});
 assert.deepEqual(v.suggestions.picks.map(p=>[p.category,p.context,p.value]),[['SERVICE_ACTIVITY','','Tax compliance and advice'],['COUNTRY','Incorporation or residence','Kenya'],['COUNTRY','Business operations','Kenya']]);
 assert.match(v.suggestions.picks[0].basis,/MLRO’s rule for/);assert.equal(v.profile,null,'reading never saves a suggestion');
 await tx`insert into erp_private.client_engagement_scopes(client_id,firm_id,engagement_date,scope_start_date,recorded_by) values(${C},${F},'2026-02-02','2026-02-02',${actors.PARTNER.staff_id})`;
 assert.match((await ax('MANAGER',{action:'aml_profile_read',client_id:C})).suggestions.text[0].value,/ from 2 Feb 2026\.$/);
 await assert.rejects(()=>ax('INTERN',{action:'aml_profile_read',client_id:C}),/client access/);
 // Accepted and saved by a person: the suggestion is then gone, and the saved row carries the note.
 await ax('MANAGER',{action:'aml_profile_save',client_id:C,fields:{purpose_of_relationship:'Annual tax filing for a fictional trading company'},selections:[{category:'SERVICE_ACTIVITY',context:'',value:'Tax compliance and advice',note:'Suggested: The MLRO’s rule for Tax compliance lists this activity.'}]});
 const after=await ax('MANAGER',{action:'aml_profile_read',client_id:C});assert.equal(after.suggestions.text.length,0);assert.deepEqual(after.suggestions.picks.map(p=>p.context),['Incorporation or residence','Business operations']);
 assert.equal(after.selections.find(s=>s.category==='SERVICE_ACTIVITY').note.startsWith('Suggested:'),true);
 // The screen.
 const ui=rd('staff-aml.mjs');
 assert.match(ui,/Evidence \(DOC-…\), optional/);assert.match(ui,/data-am-use/);assert.match(ui,/Nothing here is saved until you accept it and press Save draft/);assert.match(ui,/\[data-am-act\],\[data-am-use\]/);
 assert.match(ui,/\$\{suggestPanel\(\)\}\$\{profileBody\(\)\}/);assert.match(ui,/stage!=='Staff review'\)\)return ''/);
 assert.match(rd('supabase/functions/staff-workspace-v12/aml-actions.ts'),/amlSuggestions\(\{clientName:client\.company_name/);
 assert.match(rd('staff-pilot.css'),/\.am-suggest\{/);
});
