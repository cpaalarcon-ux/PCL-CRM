import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {amlAction}=await import('../supabase/functions/staff-workspace-v12/aml-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>amlAction(tx,a,p));
test('build 2855: the MLRO owns the POCAMLA lists, risk decision and gate',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const docRef=(await tx`select doc_ref from erp_private.documents where document_id=${D}`)[0].doc_ref;
 assert.match(docRef,/^DOC-\d{4}-\d{5}$/);
 const fields=(x={})=>({purpose_of_relationship:'Annual tax compliance for a fictional trading company',expected_activity:'Monthly VAT and PAYE returns; about 40 sales invoices a month',pep_type:'No known PEP',screening_status:'No match',screening_list_source:'Fictional consolidated list',screening_list_date:'2026-11-01',...x});
 const sels=(extra=[])=>[{category:'COUNTRY',context:'Incorporation or residence',value:'Kenya',doc_ref:docRef},{category:'SOURCE_OF_FUNDS',value:'Business income'},{category:'SERVICE_ACTIVITY',value:'Tax compliance and advice'},...extra];
 const save=(role,f,s,x={})=>ax(role,{action:'aml_profile_save',client_id:C,fields:f,selections:s,...x});

 // The MLRO right: only an Engagement Partner grants it, only to a Manager; until then a Manager is not the MLRO.
 await assert.rejects(()=>ax('MANAGER',{action:'aml_overview'}),/MLRO/);
 await assert.rejects(()=>ax('ASSISTANT',{action:'aml_lookup_add',category:'COUNTRY',value:'Fictionia',source:'Fictional source'}),/MLRO/);
 await assert.rejects(()=>as('PARTNER',()=>tx`select erp_private.staff_right_grant(${actors.SUPERVISOR.staff_id}::uuid,'MLRO','Appointed as the firm MLRO',current_date+30)`),/Manager/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.staff_right_grant(${actors.SUPERVISOR.staff_id}::uuid,'MLRO','Appointed as the firm MLRO',current_date+30)`),/Partner/);
 await as('PARTNER',()=>tx`select erp_private.staff_right_grant(${actors.MANAGER.staff_id}::uuid,'MLRO','Appointed as the firm MLRO',current_date+30)`);
 const ov0=await ax('MANAGER',{action:'aml_overview'});
 assert.equal(ov0.mlro_holders.length,1);assert.ok(ov0.counts.starter_values>100,'starter values are marked until confirmed');assert.equal(ov0.counts.without_profile,1);

 // Staff collect the facts; nothing is decided by them.
 const r0=await ax('ASSISTANT',{action:'aml_profile_read',client_id:C});
 assert.equal(r0.profile,null);assert.equal(r0.status.code,'INFO_NEEDED');assert.ok(r0.lookups.some(l=>l.category==='COUNTRY'&&l.value==='Kenya'));assert.equal(r0.can.decide,false);
 assert.ok(r0.documents.some(d=>d.doc_ref===docRef));
 const bad=await save('ASSISTANT',fields({pep_type:'Made-up PEP type'}),sels([{category:'COUNTRY',context:'Counterparties',value:'Atlantis'}]));
 assert.equal(bad.saved,false);assert.ok(bad.errors.some(e=>e.key==='pep_type'));assert.ok(bad.errors.some(e=>/Atlantis/.test(e.error)));
 await assert.rejects(()=>save('ASSISTANT',fields(),sels([{category:'COUNTRY',context:'Counterparties',value:'Uganda',doc_ref:'DOC-2026-99999'}])),/not a document of this client/);
 const partial=await save('ASSISTANT',{purpose_of_relationship:'Annual tax compliance'},[]);
 assert.equal(partial.saved,true);assert.equal(partial.status.code,'INFO_NEEDED');assert.ok(partial.missing.length>=4);
 await assert.rejects(()=>ax('ASSISTANT',{action:'aml_profile_submit',client_id:C}),/red first/);
 const full=await save('ASSISTANT',fields(),sels([{category:'COUNTRY',context:'Counterparties',value:'Uganda'}]));
 assert.equal(full.saved,true);assert.equal(full.missing.length,0);assert.equal(full.status.code,'STAFF_REVIEW');assert.equal(full.selections.find(s=>s.value==='Kenya'||s.lookup_value==='Kenya').doc_ref,docRef);
 assert.equal((await save('ASSISTANT',fields(),sels([{category:'COUNTRY',context:'Counterparties',value:'Uganda'}]))).changed,false,'saving the same thing changes nothing');
 await assert.rejects(()=>ax('ASSISTANT',{action:'aml_decide',client_id:C,decision:'Accept',risk_rating:'Low',risk_reasons:'Routine local client'}),/MLRO/);
 const sub=await ax('ASSISTANT',{action:'aml_profile_submit',client_id:C});assert.equal(sub.status.code,'MLRO_REVIEW');
 await assert.rejects(()=>ax('ASSISTANT',{action:'aml_profile_submit',client_id:C}),/already with the MLRO/);

 // The MLRO decides. Rating and reasons are always required; an acceptance needs a future review date.
 const miss=await ax('MANAGER',{action:'aml_decide',client_id:C,decision:'Accept'});assert.equal(miss.decided,false);assert.ok(miss.errors.some(e=>e.key==='risk_rating')&&miss.errors.some(e=>e.key==='next_review'));
 const q=await ax('MANAGER',{action:'aml_overview'});assert.equal(q.queue.waiting.length,1);
 const ret=await ax('MANAGER',{action:'aml_return',client_id:C,note:'Please add the director identity evidence reference'});assert.equal(ret.profile.stage,'Staff review');assert.match(ret.profile.return_note,/director identity/);
 // The person who last edited cannot decide: the MLRO edits, then needs someone else to decide.
 await save('MANAGER',fields({expected_activity:'Monthly VAT and PAYE returns; about 45 sales invoices a month'}),sels([{category:'COUNTRY',context:'Counterparties',value:'Uganda'}]));
 await ax('MANAGER',{action:'aml_profile_submit',client_id:C});
 await assert.rejects(()=>ax('MANAGER',{action:'aml_decide',client_id:C,decision:'Accept',risk_rating:'Low',risk_reasons:'Routine local client with clear records',next_review:'2099-01-01'}),/prepared or submitted/);
 const sup2=await ax('PARTNER',{action:'aml_decide',client_id:C,decision:'Accept',risk_rating:'Low',risk_reasons:'Routine local client with clear records',next_review:'2099-01-01'});
 assert.equal(sup2.decided,true);assert.equal(sup2.status.code,'APPROVED');assert.equal(sup2.decisions[0].kind,'Decision');
 assert.equal((await as('PARTNER',()=>tx`select erp_private.aml_cleared(${C}) as ok`))[0].ok,true);
 // Any later change by staff withdraws the clearance until the MLRO decides again.
 const edit=await save('ASSISTANT',fields({expected_activity:'Monthly VAT and PAYE returns; about 60 sales invoices a month'}),sels([{category:'COUNTRY',context:'Counterparties',value:'Uganda'}]));
 assert.equal(edit.profile.stage,'Staff review');assert.equal((await as('PARTNER',()=>tx`select erp_private.aml_cleared(${C}) as ok`))[0].ok,false);

 // A PEP is routed to the MLRO and cannot be accepted without enhanced due diligence and a verified KYC file.
 await save('ASSISTANT',fields({pep_type:'Domestic PEP',pep_role:'County executive',pep_jurisdiction:'Kenya'}),sels());
 await ax('ASSISTANT',{action:'aml_profile_submit',client_id:C});
 const pepView=await ax('MANAGER',{action:'aml_profile_read',client_id:C});assert.ok(pepView.attention.some(x=>/PEP/.test(x)));
 const noKyc=await ax('MANAGER',{action:'aml_decide',client_id:C,decision:'Accept with conditions',risk_rating:'High',risk_reasons:'Domestic PEP with a public role',decision_conditions:'Quarterly review and source of funds evidence',edd_note:'Checked the public register and asked for source of wealth evidence',next_review:'2099-01-01'});
 assert.equal(noKyc.decided,false);assert.ok(noKyc.errors.some(e=>/verify the KYC/i.test(e.error)));
 const edd=await ax('MANAGER',{action:'aml_edd_request',client_id:C,note:'Obtain source of wealth evidence and the appointment letter'});assert.equal(edd.status.code,'EDD_REQUIRED');
 const dec=await ax('PARTNER',{action:'aml_decide',client_id:C,decision:'Restrict',risk_rating:'High',risk_reasons:'Domestic PEP; evidence outstanding',decision_conditions:'No engagement until evidence is received',decision_reason:'Evidence outstanding'}).catch(e=>e);
 assert.ok(dec instanceof Error,'a profile with EDD requested must go back to MLRO review first');

 // The lists: the MLRO adds, confirms and ends values; nothing is edited.
 await assert.rejects(()=>ax('MANAGER',{action:'aml_lookup_add',category:'COUNTRY',value:'Kenya',source:'Fictional source'}),/already on/);
 await ax('MANAGER',{action:'aml_lookup_add',category:'RISK_INDICATOR',value:'Complex offshore structure',attention:true,source:'MLRO review of the FRC guidance'});
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.aml_lookups set value='Changed' where value='Kenya'`),/never edited/);
 const ov=await ax('MANAGER',{action:'aml_overview'});const starter=ov.lookups.filter(l=>l.status==='Starter').map(l=>l.lookup_id);
 assert.equal((await ax('MANAGER',{action:'aml_lookup_confirm',lookup_ids:starter.slice(0,3)})).confirmed,3);
 const ug=ov.lookups.find(l=>l.value==='Uganda'&&l.category==='COUNTRY');
 await ax('MANAGER',{action:'aml_lookup_end',lookup_id:ov.lookups.find(l=>l.value==='Complex offshore structure').lookup_id,reason:'Replaced by a wider indicator'});
 assert.ok(!(await ax('MANAGER',{action:'aml_overview'})).lookups.some(l=>l.value==='Complex offshore structure'));

 // The gate: a Partner records approval of the lists, the MLRO must have confirmed every starter value, then the Partner switches it on.
 await assert.rejects(()=>ax('MANAGER',{action:'aml_policy_approve',reference:'Board minute 4/2026'}),/Partner/);
 await assert.rejects(()=>ax('PARTNER',{action:'aml_gate_set',enforced:true,reason:'Start enforcing'}),/approval of the POCAMLA lists first/);
 await ax('PARTNER',{action:'aml_policy_approve',reference:'Board minute 4/2026',note:'Lists reviewed'});
 await assert.rejects(()=>ax('PARTNER',{action:'aml_gate_set',enforced:true,reason:'Start enforcing'}),/starter value/);
 await ax('MANAGER',{action:'aml_lookup_confirm',lookup_ids:(await ax('MANAGER',{action:'aml_overview'})).lookups.filter(l=>l.status==='Starter').map(l=>l.lookup_id)});
 await assert.rejects(()=>ax('MANAGER',{action:'aml_gate_set',enforced:true,reason:'Start enforcing'}),/Partner/);
 await ax('PARTNER',{action:'aml_gate_set',enforced:true,reason:'The lists are approved'});
 assert.equal((await ax('MANAGER',{action:'aml_overview'})).policy.gate_enforced,true);
 // With the gate on, an engagement cannot start for a client the MLRO has not cleared.
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Certificate of incorporation reviewed for this fictional client',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.projects set status='Active' where project_id=${P}`),/POCAMLA/);
 assert.ok((await tx`select pg_get_functiondef('erp_private.project_guard()'::regprocedure) as d`)[0].d.includes('aml_gate_enforced'));
});
