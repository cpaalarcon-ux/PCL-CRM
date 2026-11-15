import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {serviceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/service-template-actions.ts');const {clientMasterAction}=await import('../supabase/functions/staff-workspace-v12/client-master-actions.ts');
const {taxConfigAction}=await import('../supabase/functions/staff-workspace-v12/tax-config-actions.ts');const {requireRightChart}=await import('../supabase/functions/staff-workspace-v12/legal-structure-actions.ts');
const {cleanValue}=await import('../supabase/functions/staff-workspace-v12/client-master-rules.mjs');const {formalRegistration}=await import('../supabase/functions/staff-workspace-v12/client-template-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const st=(role,p)=>as(role,a=>serviceTemplateAction(tx,a,p));const cm=(role,p)=>as(role,a=>clientMasterAction(tx,a,p));
const client=async(name,structure,subtype,entity)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,legal_structure,legal_subtype) values(${c},${name},${actors.ASSISTANT.staff_id},${entity},${structure},${subtype})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
const rec=(role,c,key,value,ref='Register extract 2026')=>cm(role,{action:'client_master_record',client_id:c,field_key:key,value,source_kind:'Prior record',source_reference:ref});
const row=(r,k)=>r.rows.find(x=>x.key===k);
test('public sector, chama, estate and other-entity templates: they set the file, never the services',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V4QA','Fictional V4 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 // ---- Which template, from the legal structure ----
 const list=await st('MANAGER',{action:'client_template_list'});
 assert.deepEqual(list.templates.map(x=>x.template_code),['INDIVIDUAL','PARTNERSHIP','COMPANY','NONPROFIT','COOPERATIVE','PUBLIC_SECTOR','ASSOCIATION','ESTATE','OTHER_REGISTERED']);
 const m=Object.fromEntries(list.map.map(x=>[x.structure+'|'+x.subtype,x.template_code]));
 assert.equal(m['Public Entity|*'],'PUBLIC_SECTOR');assert.equal(m['Other|Chama or Investment Group'],'ASSOCIATION');assert.equal(m['Other|Estate'],'ESTATE');assert.equal(m['Other|Other registered entity'],'OTHER_REGISTERED');
 assert.equal(list.templates.some(x=>'services' in x||'tasks' in x),false);

 // ---- Public sector / statutory body ----
 const P1=await client('Fictional county department','Public Entity','County Government','Other legal entity');
 const r1=await cm('MANAGER',{action:'client_master_read',client_id:P1});
 assert.equal(r1.template.template_code,'PUBLIC_SECTOR');assert.equal(r1.required,10);
 for(const k of ['establishing_instrument','mandate','subtype_basis'])assert.ok(row(r1,k)&&!row(r1,k).optional,k);assert.equal(row(r1,'registration_number').optional,true);
 assert.deepEqual(r1.template.evidence.filter(e=>e.requirement==='Required').map(e=>e.key).sort(),['ACCOUNTING_OFFICER','ESTABLISHING_INSTRUMENT','KRA_PIN']);
 assert.equal(r1.exceptions.some(e=>e.key==='subtype'),false);
 // The subtype is chosen on the legal structure; without one the file is not ready.
 const P2=await client('Fictional statutory body','Public Entity',null,'Other legal entity');
 const r2=await cm('MANAGER',{action:'client_master_read',client_id:P2});assert.equal(r2.template.template_code,'PUBLIC_SECTOR');assert.ok(r2.exceptions.some(e=>e.key==='subtype'&&/Choose the subtype/.test(e.issue)));assert.equal(r2.ready,false);

 // ---- Chama / unincorporated association ----
 const A=await client('Fictional chama','Other','Chama or Investment Group','Other legal entity');
 const a0=await cm('MANAGER',{action:'client_master_read',client_id:A});
 assert.equal(a0.template.template_code,'ASSOCIATION');for(const k of ['registration_status'])assert.ok(row(a0,k)&&!row(a0,k).optional,k);
 const ev=Object.fromEntries(a0.template.evidence.map(e=>[e.key,e.requirement]));
 assert.equal(ev.GOVERNING_DOCUMENT,'Required');assert.equal(ev.OFFICE_BEARERS,'Required');assert.equal(ev.REGISTER_MEMBERS,'Required');assert.equal(ev.REGISTRATION_IDENTITY,'If applicable');assert.equal(ev.BOARD_RESOLUTION,'Required');
 // Registration status has a fixed shape, so a vague answer is not accepted.
 assert.equal(cleanValue('registration_status','Probably registered').ok,false);assert.equal(cleanValue('registration_status','Unregistered').ok,true);
 assert.equal(formalRegistration('Registered with the Registrar of Societies as a society, no. 55'),true);assert.equal(formalRegistration('Registered with Social Services as a self-help group'),false);assert.equal(formalRegistration('Unregistered'),false);
 await rec('ASSISTANT',A,'registration_status','Unregistered','Chairperson statement note');
 assert.equal((await cm('MANAGER',{action:'client_master_read',client_id:A})).exceptions.some(e=>e.key==='reclassify'),false);
 await as('ASSISTANT',a=>clientMasterAction(tx,a,{action:'client_master_record',client_id:A,field_key:'registration_status',value:'Registered with the Registrar of Societies as a society, no. 55',source_kind:'Prior record',source_reference:'Registrar certificate',reason:'The certificate was found in the documents'}));
 const a1=await cm('MANAGER',{action:'client_master_read',client_id:A});
 const flag=a1.exceptions.find(e=>e.key==='reclassify');assert.ok(flag);assert.match(flag.issue,/change the legal structure so that form's template applies/);assert.equal(a1.ready,false);
 assert.equal(a1.template.evidence.find(e=>e.key==='BOARD_RESOLUTION').requirement,'If applicable');
 // Reclassifying to the society's own legal form moves the file to that template; nothing else changes by itself.
 await tx`update erp_private.clients set legal_structure='Non-Profit Organisation',legal_subtype='Society',legal_entity_type='Non-profit organisation',legal_structure_note='Reclassified from the registrar certificate',legal_structure_changed_by=${actors.MANAGER.staff_id},legal_structure_changed_at=now() where client_id=${A}`;
 assert.equal((await cm('MANAGER',{action:'client_master_read',client_id:A})).template.template_code,'NONPROFIT');

 // ---- Estate ----
 const E=await client('Estate of the late Fictional Person','Other','Estate','Other legal entity');
 const e0=await cm('MANAGER',{action:'client_master_read',client_id:E});
 assert.equal(e0.template.template_code,'ESTATE');for(const k of ['deceased_name','deceased_id','date_of_death','grant_details'])assert.ok(row(e0,k)&&!row(e0,k).optional,k);
 assert.deepEqual(e0.template.evidence.filter(x=>x.requirement==='Required').map(x=>x.key).sort(),['KRA_PIN','NATIONAL_ID','PROBATE_LETTERS']);
 assert.equal(cleanValue('date_of_death','2999-01-01').ok,false);assert.equal(cleanValue('date_of_death','2026-03-02').ok,true);
 await rec('ASSISTANT',E,'grant_details','Grant of probate no. 77, High Court Nairobi, 2 March 2026','Grant of probate');
 const ef=(await cm('MANAGER',{action:'client_master_read',client_id:E})).rows.find(x=>x.key==='grant_details').fact;
 await cm('SUPERVISOR',{action:'client_master_verify',fact_id:ef.fact_id,revision:ef.revision,note:'Checked against the grant of probate'});
 assert.equal(row(await cm('MANAGER',{action:'client_master_read',client_id:E}),'grant_details').state,'Verified');

 // ---- Other registered entity (custom): a Partner classifies the legal form ----
 const O=await client('Fictional other entity','Other','Other registered entity','Other legal entity');
 const o0=await cm('MANAGER',{action:'client_master_read',client_id:O});
 assert.equal(o0.template.template_code,'OTHER_REGISTERED');for(const k of ['specific_legal_form','registration_authority','registration_number','authority_basis'])assert.ok(row(o0,k)&&!row(o0,k).optional,k);
 assert.deepEqual(o0.template.evidence.filter(x=>x.requirement==='Required').map(x=>x.key).sort(),['KRA_PIN','OFFICE_BEARERS','REGISTRATION_IDENTITY']);
 assert.equal(cleanValue('specific_legal_form','unknown').ok,false);
 const flagged=o0.exceptions.find(x=>x.key==='classification');assert.ok(flagged);assert.match(flagged.issue,/Partner classifies it before the client is activated/);assert.equal(o0.classification_pending,true);
 // A person who is not a Manager or Partner sees the same flag.
 assert.equal((await st('ASSISTANT',{action:'client_template_read',client_id:O})).checklist.classification_pending,true);
 // An engagement cannot be set up while the legal form is unclassified.
 const sl=(await st('MANAGER',{action:'service_template_list'})).templates;assert.equal(sl.length,5);assert.ok(sl.every(x=>x.status==='Draft'));
 const tax=sl.find(x=>x.template_code==='TAX-MONTHLY');
 const plan=(c,over={})=>st('MANAGER',{action:'engagement_setup_plan',client_id:c,firm_id:F,template_id:tax.template_id,service_code:'TAX-COMP',period_start:'2026-01-01',period_end:'2026-01-31',scope:'Monthly tax working for January 2026.',responsible_staff:actors.ASSISTANT.staff_id,reviewer_staff:actors.SUPERVISOR.staff_id,...over});
 assert.match((await plan(O)).plan.problems.join(' '),/legal form has not been classified/);
 assert.doesNotMatch((await plan(E)).plan.problems.join(' '),/classified/);
 // The legal form is recorded by hand with its source; only a Partner may verify it.
 await rec('ASSISTANT',O,'specific_legal_form','Statutory board registered by order','Gazette notice 2026');
 const lf=(await cm('MANAGER',{action:'client_master_read',client_id:O}));const fact=row(lf,'specific_legal_form').fact;
 assert.equal(row(lf,'specific_legal_form').can_verify,false);assert.equal((await cm('PARTNER',{action:'client_master_read',client_id:O})).rows.find(x=>x.key==='specific_legal_form').can_verify,true);
 await assert.rejects(()=>cm('MANAGER',{action:'client_master_verify',fact_id:fact.fact_id,revision:fact.revision,note:'Checked against the gazette'}),/only a Partner verifies/);
 await assert.rejects(()=>cm('SUPERVISOR',{action:'client_master_verify',fact_id:fact.fact_id,revision:fact.revision,note:'Checked against the gazette'}),/only a Partner verifies/);
 assert.equal((await st('MANAGER',{action:'client_template_read',client_id:O})).checklist.classification_pending,true);
 await cm('PARTNER',{action:'client_master_verify',fact_id:fact.fact_id,revision:fact.revision,note:'Checked against the gazette notice'});
 assert.equal((await st('MANAGER',{action:'client_template_read',client_id:O})).checklist.classification_pending,false);
 assert.doesNotMatch((await plan(O)).plan.problems.join(' '),/classified/);

 // ---- Officers and signatories: separate, evidence-backed records ----
 const hr0=await cm('MANAGER',{action:'client_master_read',client_id:P1});
 assert.deepEqual(hr0.holder_rules.map(x=>[x.kind,x.requirement,x.state]),[['Officer','Required','Missing'],['Signatory','Required','Missing']]);
 assert.ok(hr0.exceptions.some(e=>e.key==='holder:Officer')&&hr0.exceptions.some(e=>e.key==='holder:Signatory'));
 const hrec=(role,c,over={})=>cm(role,{action:'client_holder_record',client_id:c,kind:'Officer',holder_name:'Fictional Officer',holder_position:'Accounting officer',authority:'Heads the entity and signs its accounts',basis_kind:'Establishing instrument',source_reference:'Gazette notice 12 of 2026',...over});
 await assert.rejects(()=>hrec('ASSISTANT',P1,{source_reference:undefined}),/supports this/);
 await assert.rejects(()=>hrec('ASSISTANT',P1,{authority:'x'}),/authorised to do/);
 await assert.rejects(()=>hrec('ASSISTANT',P1,{kind:'Director'}));
 await assert.rejects(()=>hrec('ASSISTANT',P1,{basis_kind:'Verbal'}));
 const h1=await hrec('SUPERVISOR',P1);const ho=h1.holders[0];
 assert.equal(h1.holders.length,1);assert.equal(ho.status,'Recorded');assert.equal(h1.holder_rules.find(x=>x.kind==='Officer').state,'Recorded');assert.ok(h1.exceptions.some(e=>e.key==='holder:Officer'));
 await assert.rejects(()=>hrec('ASSISTANT',P1),/already recorded/);
 await assert.rejects(()=>cm('ASSISTANT',{action:'client_holder_verify',holder_id:ho.holder_id,revision:ho.revision,note:'Checked the gazette'}),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>cm('SUPERVISOR',{action:'client_holder_verify',holder_id:ho.holder_id,revision:ho.revision,note:'Checked the gazette'}),/different person/);
 assert.equal(h1.holders[0].can_verify,false);assert.equal((await cm('MANAGER',{action:'client_master_read',client_id:P1})).holders[0].can_verify,true);
 await assert.rejects(()=>cm('MANAGER',{action:'client_holder_verify',holder_id:ho.holder_id,revision:ho.revision,note:'x'}),/at least 3/);
 const v1=await cm('MANAGER',{action:'client_holder_verify',holder_id:ho.holder_id,revision:ho.revision,note:'Checked against gazette notice 12'});
 assert.equal(v1.holders[0].status,'Verified');assert.ok(v1.holders[0].verified_at);assert.equal(v1.holders[0].verified_by_name,'Fictional MANAGER');
 assert.equal(v1.holder_rules.find(x=>x.kind==='Officer').state,'Verified');assert.equal(v1.exceptions.some(e=>e.key==='holder:Officer'),false);assert.ok(v1.exceptions.some(e=>e.key==='holder:Signatory'));
 // The position, authority and supporting paper are kept; a record is never edited.
 assert.equal(v1.holders[0].holder_position,'Accounting officer');assert.equal(v1.holders[0].basis_kind,'Establishing instrument');assert.equal(v1.holders[0].source_reference,'Gazette notice 12 of 2026');
 await assert.rejects(()=>tx`update erp_private.client_office_holders set authority='Changed later' where holder_id=${ho.holder_id}`,/never edited/);
 // They are not directors, shareholders or trustees.
 assert.equal((await tx`select count(*)::int n from erp_private.client_parties where client_id=${P1}`)[0].n,0);
 const sg=await hrec('ASSISTANT',P1,{kind:'Signatory',holder_name:'Fictional Signatory',holder_position:'Finance officer',authority:'Signs payments up to KES 500,000',basis_kind:'Resolution',source_reference:'Council resolution 7 of 2026'});
 await cm('SUPERVISOR',{action:'client_holder_verify',holder_id:sg.holders.find(x=>x.kind==='Signatory').holder_id,revision:sg.holders.find(x=>x.kind==='Signatory').revision,note:'Checked against resolution 7'});
 assert.equal((await cm('MANAGER',{action:'client_master_read',client_id:P1})).exceptions.some(e=>String(e.key).startsWith('holder:')),false);
 // Ending needs a reason and keeps the record; the same person can then be recorded afresh.
 await assert.rejects(()=>cm('ASSISTANT',{action:'client_holder_end',holder_id:ho.holder_id,revision:v1.holders[0].revision,reason:'Left the entity'}),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>cm('MANAGER',{action:'client_holder_end',holder_id:ho.holder_id,revision:v1.holders[0].revision,reason:'no'}),/at least 5/);
 const cur=(await cm('MANAGER',{action:'client_master_read',client_id:P1})).holders.find(x=>x.holder_id===ho.holder_id);
 const ended=await cm('MANAGER',{action:'client_holder_end',holder_id:ho.holder_id,revision:cur.revision,reason:'Left the entity in March'});
 assert.equal(ended.holders.some(x=>x.holder_id===ho.holder_id),false);assert.ok(ended.exceptions.some(e=>e.key==='holder:Officer'));
 assert.equal((await tx`select status from erp_private.client_office_holders where holder_id=${ho.holder_id}`)[0].status,'Ended');
 await assert.rejects(()=>tx`update erp_private.client_office_holders set status='Verified' where holder_id=${ho.holder_id}`,/stays as it was/);
 await hrec('ASSISTANT',P1);
 // The other templates ask for their own holders.
 assert.deepEqual((await cm('MANAGER',{action:'client_master_read',client_id:E})).holder_rules.map(x=>[x.kind,x.requirement]),[['Officer','Required']]);
 assert.deepEqual((await cm('MANAGER',{action:'client_master_read',client_id:O})).holder_rules.map(x=>[x.kind,x.requirement]),[['Officer','Required'],['Signatory','If applicable']]);
 assert.equal((await cm('MANAGER',{action:'client_master_read',client_id:A})).holder_rules.length,0);

 // ---- A fallback entity gets no tax or accounting defaults until a Partner has classified it ----
 const O2=await client('Fictional fallback entity','Other','Other registered entity','Other legal entity');
 assert.equal((await as('MANAGER',()=>tx`select erp_private.client_classification_pending(${O2}) p`))[0].p,true);
 await assert.rejects(()=>as('MANAGER',a=>requireRightChart(tx,O2,'creating the project')),/Partner classifies this entity/);
 await assert.rejects(()=>as('MANAGER',a=>taxConfigAction(tx,a,{action:'tax_profile_save',client_id:O2})),/before tax defaults are applied/);
 // Entities that need no Partner classification are not held up by it.
 assert.equal((await as('MANAGER',()=>tx`select erp_private.client_classification_pending(${P1}) p`))[0].p,false);
 await assert.rejects(()=>as('MANAGER',a=>requireRightChart(tx,P1,'creating the project')),/chart of accounts/);
 await rec('ASSISTANT',O2,'specific_legal_form','Statutory board registered by order','Gazette notice 2026');
 const f2=(await tx`select fact_id from erp_private.client_field_facts where client_id=${O2} and field_key='specific_legal_form'`)[0].fact_id;
 // Verified by a Manager (not possible through the screen) still does not count; only a Partner's verification does.
 await tx`update erp_private.client_field_facts set status='Verified',verified_by=${actors.MANAGER.staff_id},verified_at=now(),verification_note='Checked' where fact_id=${f2}`;
 assert.equal((await as('MANAGER',()=>tx`select erp_private.client_classification_pending(${O2}) p`))[0].p,true);
 assert.equal((await cm('MANAGER',{action:'client_master_read',client_id:O2})).classification_pending,true);
 await db.exec('set session_replication_role=replica');await tx`update erp_private.client_field_facts set verified_by=${actors.PARTNER.staff_id} where fact_id=${f2}`;await db.exec('set session_replication_role=origin');
 assert.equal((await as('MANAGER',()=>tx`select erp_private.client_classification_pending(${O2}) p`))[0].p,false);
 await assert.rejects(()=>as('MANAGER',a=>requireRightChart(tx,O2,'creating the project')),/chart of accounts/);
 assert.doesNotMatch(await as('MANAGER',a=>taxConfigAction(tx,a,{action:'tax_profile_save',client_id:O2})).then(()=>'',e=>String(e.message)),/before tax defaults/);

 // ---- None of this selects a service ----
 for(const c of [P1,P2,A,E,O,O2]){assert.equal((await tx`select count(*)::int n from erp_private.engagement_setups where client_id=${c}`)[0].n,0);assert.equal((await tx`select count(*)::int n from erp_private.projects where client_id=${c}`)[0].n,0);}
 assert.deepEqual((await tx`select distinct status from erp_private.service_templates`).map(x=>x.status),['Draft']);
});
