import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientUnderstandingAction}=await import('../supabase/functions/staff-workspace-v12/client-understanding-actions.ts');
const {setPdfLib}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const rules=await import('../supabase/functions/staff-workspace-v12/client-understanding-rules.mjs');
const {permanentFilePdf}=await import('../supabase/functions/staff-workspace-v12/permanent-file-pdf.mjs');
const root=path.resolve(import.meta.dirname,'..'),PDFLib=require(path.join(root,'supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));setPdfLib(PDFLib);
const rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={},stored=[];
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const storage={upload:async(key,bytes,o)=>{stored.push({key,size:bytes.length,type:o.contentType});return {error:null};}};
const sx=(role,p)=>as(role,a=>clientUnderstandingAction(tx,a,p,storage,async()=>{}));
const FULL={nature_of_business:'Wholesale of building materials from two depots in Kisumu since 2014.',ownership_governance:'Owned equally by two directors who also sign the bank mandate.',operating_environment:'Holds a county trading licence; no sector regulator beyond KRA.',customers_suppliers:'Mostly contractors on 30 day terms; main supplier is a cement manufacturer.',records_systems:'Books kept on a desktop package; sales through eTIMS; monthly bank statements by email.'};

test('build 2867: pure rules for sections, review and file state',()=>{
 const {cleanSections,missingSections,reviewProblem,understandingState,digestInput,SECTIONS}=rules;
 assert.equal(SECTIONS.filter(s=>s.required).length,5);assert.equal(SECTIONS.at(-1).required,false);
 assert.deepEqual(cleanSections({nature_of_business:'  hello  ',junk:'x'}).sections,{nature_of_business:'hello'},'unknown keys are dropped and text is trimmed');
 assert.match(cleanSections({nature_of_business:'x'.repeat(4001)}).problems[0],/longer than 4000/);
 assert.equal(missingSections(FULL).length,0);assert.equal(missingSections({...FULL,records_systems:'short'}).length,1);assert.equal(missingSections({}).length,5);
 const row={status:'Submitted',prepared_by:'a',submitted_by:'b'};
 assert.match(reviewProblem({row,staffId:'c',category:'SUPERVISOR'}),/Manager or Partner/);
 assert.match(reviewProblem({row,staffId:'a',category:'MANAGER'}),/different/);assert.match(reviewProblem({row,staffId:'b',category:'PARTNER'}),/different/);
 assert.equal(reviewProblem({row,staffId:'b',category:'PARTNER',soleActivePartner:true}),null,'the sole active Partner may approve their own');
 assert.equal(reviewProblem({row,staffId:'b',category:'MANAGER',soleActivePartner:true})!==null,true,'only a Partner has the sole-Partner exception');
 assert.equal(reviewProblem({row,staffId:'c',category:'MANAGER'}),null);assert.match(reviewProblem({row:{status:'Draft'},staffId:'c',category:'MANAGER'}),/submitted/);
 const f=[{field_key:'kra_pin',value:'A123456789B',status:'Verified',source_kind:'Document'}],u={understanding_id:'u1',version:1};
 const d1=digestInput({facts:f,understanding:u,aml:null});assert.equal(d1,digestInput({facts:[...f],understanding:u,aml:null}),'same input, same fingerprint');
 assert.notEqual(d1,digestInput({facts:[{...f[0],value:'A123456780B'}],understanding:u,aml:null}));assert.notEqual(d1,digestInput({facts:f,understanding:{...u,understanding_id:'u2'},aml:null}));assert.notEqual(d1,digestInput({facts:f,understanding:u,aml:{stage:'Decided'}}));
 assert.equal(understandingState({rows:[],issues:[],digest:'x'}).file,'none');
 const ap={status:'Approved',understanding_id:'u1'};assert.equal(understandingState({rows:[ap],issues:[{facts_digest:'x',understanding_id:'u1'}],digest:'x'}).file,'current');
 assert.equal(understandingState({rows:[ap],issues:[{facts_digest:'y',understanding_id:'u1'}],digest:'x'}).file,'out_of_date');assert.equal(understandingState({rows:[ap],issues:[{facts_digest:'x',understanding_id:'u0'}],digest:'x'}).file,'out_of_date');
});

test('build 2867: the Permanent File PDF is the same for the same inputs and says what is missing',async()=>{
 const base={draft:false,issued_at:'2026-11-17T09:00:00Z',issued_on:'2026-11-17',issued_by_name:'Fictional Manager',digest:'a'.repeat(64),firm:{legal_name:'Fictional firm',physical_address:'Kisumu'},client:{name:'Fictional client',kra_pin:'A123456789B',entity_type:'Limited company'},
  facts:[{key:'kra_pin',label:'KRA PIN',value:'A123456789B',status:'Verified',source:'Document (DOC-2026-0001)',verified_by:'Fictional Partner',verified_on:'2026-11-16'}],
  understanding:{version:1,sections:FULL,prepared_by_name:'P',approved_by_name:'Q',approved_on:'2026-11-17'},aml:{stage:'Decided',decision:'Accept',risk_rating:'Low',next_review:'2027-11-17'}};
 const a=await permanentFilePdf(base,PDFLib),b=await permanentFilePdf(base,PDFLib);assert.equal(Buffer.from(a).equals(Buffer.from(b)),true,'the same inputs give the same bytes');
 assert.equal(Buffer.from(a).subarray(0,5).toString(),'%PDF-');
 const none=await permanentFilePdf({...base,draft:true,facts:[],understanding:null,aml:null},PDFLib);assert.equal(Buffer.from(none).subarray(0,5).toString(),'%PDF-');assert.notEqual(none.length,a.length);
 const long=await permanentFilePdf({...base,facts:Array.from({length:120},(_,i)=>({key:'k'+i,label:'Fact '+i,value:'Value '+i+' '.repeat(2)+'Ŝ✓',status:'Recorded',source:'Client statement'}))},PDFLib);
 assert.ok((await PDFLib.PDFDocument.load(long)).getPageCount()>=3,'a long fact list runs onto more pages and still opens');
});

test('build 2867: understanding is versioned, reviewed by a different person, and the Permanent File is filed from approved facts',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type,kra_pin) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company','A123456789B')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.client_onboarding_allocations(client_id,staff_id,allocated_by) values(${C},${actors.SUPERVISOR.staff_id},${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,recorded_by) values(${C},'contact_phone','+254700000000','Client statement',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,source_reference,recorded_by) values(${C},'registration_number','CPR/2014/1234','Online register','BRS search 2026-11-10',${actors.MANAGER.staff_id})`;
 await tx`update erp_private.client_field_facts set status='Verified',verified_by=${actors.PARTNER.staff_id},verified_at=now(),verification_note='Matches the search' where field_key='registration_number'`;

 // Reading: staff with client access see it; an Intern does not; an Assistant reads but does not write.
 const r0=await sx('ASSISTANT',{action:'client_understanding_read',client_id:C});assert.equal(r0.approved,null);assert.equal(r0.open,null);assert.equal(r0.can_prepare,false);assert.equal(r0.file,'none');assert.equal(r0.facts.count,2);assert.equal(r0.facts.verified,1);assert.equal(r0.sections.length,6);
 await assert.rejects(()=>sx('INTERN',{action:'client_understanding_read',client_id:C}),/client access/);
 await assert.rejects(()=>sx('ASSISTANT',{action:'client_understanding_save',client_id:C,sections:FULL}),/Supervisor, Manager or Partner/);
 // A draft can be saved in part, but cannot be submitted until every required section is written.
 await assert.rejects(()=>sx('SUPERVISOR',{action:'client_understanding_save',client_id:C,sections:{}}),/at least one section/);
 const s1=await sx('SUPERVISOR',{action:'client_understanding_save',client_id:C,sections:{nature_of_business:FULL.nature_of_business}});assert.equal(s1.version,1);
 let st=await sx('SUPERVISOR',{action:'client_understanding_read',client_id:C});assert.equal(st.open.status,'Draft');
 await assert.rejects(()=>sx('SUPERVISOR',{action:'client_understanding_submit',client_id:C,revision:st.open.revision}),/Complete these sections/);
 await assert.rejects(()=>sx('SUPERVISOR',{action:'client_understanding_save',client_id:C,sections:FULL,revision:'99'}),/changed|Refresh/);
 await sx('SUPERVISOR',{action:'client_understanding_save',client_id:C,sections:FULL,revision:st.open.revision});
 st=await sx('SUPERVISOR',{action:'client_understanding_read',client_id:C});
 await sx('SUPERVISOR',{action:'client_understanding_submit',client_id:C,revision:st.open.revision});
 st=await sx('SUPERVISOR',{action:'client_understanding_read',client_id:C});assert.equal(st.open.status,'Submitted');
 // A submitted version is frozen; only a Manager or Partner who did not write it reviews it.
 await assert.rejects(()=>sx('SUPERVISOR',{action:'client_understanding_save',client_id:C,sections:FULL,revision:st.open.revision}),/waiting for review/);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`update erp_private.client_understanding set sections='{}'::jsonb where client_id=${C}`),/cannot be edited|Return/);
 await assert.rejects(()=>sx('SUPERVISOR',{action:'client_understanding_approve',client_id:C,revision:st.open.revision}),/Manager or Partner/);
 await assert.rejects(()=>sx('ASSISTANT',{action:'client_understanding_approve',client_id:C,revision:st.open.revision}),/Manager or Partner/);
 await assert.rejects(()=>sx('MANAGER',{action:'client_pf_file',client_id:C}),/after the understanding of the client is approved/);
 const pre=await sx('MANAGER',{action:'client_pf_preview',client_id:C});assert.equal(pre.draft,true);assert.match(pre.file_name,/_DRAFT\.pdf$/);assert.equal(Buffer.from(pre.base64,'base64').subarray(0,5).toString(),'%PDF-');
 await assert.rejects(()=>sx('SUPERVISOR',{action:'client_pf_preview',client_id:C}),/Manager or Partner/);
 // Returned, then edited, then submitted again.
 await assert.rejects(()=>sx('MANAGER',{action:'client_understanding_return',client_id:C,revision:st.open.revision,note:'x'}),/at least 3/);
 await sx('MANAGER',{action:'client_understanding_return',client_id:C,revision:st.open.revision,note:'Say who signs the bank mandate'});
 st=await sx('SUPERVISOR',{action:'client_understanding_read',client_id:C});assert.equal(st.open.status,'Draft');assert.match(st.open.return_note,/bank mandate/);assert.equal(st.open.submitted_by,null);
 await sx('SUPERVISOR',{action:'client_understanding_submit',client_id:C,revision:st.open.revision});
 st=await sx('SUPERVISOR',{action:'client_understanding_read',client_id:C});
 const ap=await sx('MANAGER',{action:'client_understanding_approve',client_id:C,revision:st.open.revision});assert.equal(ap.sole_partner_approval,false);
 st=await sx('MANAGER',{action:'client_understanding_read',client_id:C});assert.equal(st.approved.version,1);assert.equal(st.open,null);assert.equal(st.approved.approved_by_name,'Fictional MANAGER');
 // An approved version is never edited, deleted or approved twice.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_understanding set sections='{}'::jsonb where status='Approved'`),/not edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.client_understanding`),/./);
 await assert.rejects(()=>sx('MANAGER',{action:'client_understanding_approve',client_id:C,revision:'1'}),/no version waiting/i);
 await assert.rejects(()=>tx`update erp_private.client_understanding set approved_by=prepared_by where status='Approved'`,/./,'the preparer cannot be recorded as the approver');

 // Filing: a Manager or Partner only, into the client's Permanent File folder, recorded with what it contained.
 await assert.rejects(()=>sx('SUPERVISOR',{action:'client_pf_file',client_id:C}),/Manager or Partner/);
 const filed=await sx('MANAGER',{action:'client_pf_file',client_id:C});assert.match(filed.file_name,/^Permanent_File_\d{4}-\d{2}-\d{2}_v1\.pdf$/);
 assert.equal(stored.length,1);assert.match(stored[0].key,/^Clients\/Fictional_V3_client-[0-9a-f]{8}\/Permanent_File\//);assert.equal(stored[0].type,'application/pdf');
 const doc=(await tx`select category,mime_type,file_size_bytes,doc_ref from erp_private.documents where document_id=${filed.document_id}`)[0];assert.equal(doc.category,'Permanent File');assert.equal(doc.mime_type,'application/pdf');assert.equal(Number(doc.file_size_bytes),stored[0].size);assert.match(doc.doc_ref,/^DOC-/);
 st=await sx('MANAGER',{action:'client_understanding_read',client_id:C});assert.equal(st.file,'current');assert.equal(st.issues.length,1);assert.equal(st.issues[0].understanding_version,1);assert.equal(st.can_file,true);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.permanent_file_issues set fact_count=0`),/history|cannot change|permission denied/);
 // A changed fact makes the filed copy out of date; a new approved version does too.
 await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,recorded_by) values(${C},'secondary_email','office@example.test','Client statement',${actors.MANAGER.staff_id})`;
 st=await sx('MANAGER',{action:'client_understanding_read',client_id:C});assert.equal(st.file,'out_of_date');
 const filed2=await sx('MANAGER',{action:'client_pf_file',client_id:C});assert.match(filed2.file_name,/_v2\.pdf$/);st=await sx('MANAGER',{action:'client_understanding_read',client_id:C});assert.equal(st.file,'current');assert.equal(stored.length,2);

 // A new version supersedes the old one with a reason; the old one stays as history.
 const v2=await sx('SUPERVISOR',{action:'client_understanding_save',client_id:C,sections:{...FULL,matters_to_know:'The directors travel in December.'}});assert.equal(v2.version,2);
 st=await sx('SUPERVISOR',{action:'client_understanding_read',client_id:C});assert.equal(st.approved.version,1,'the approved version stays in force while the new one is a draft');
 await sx('SUPERVISOR',{action:'client_understanding_submit',client_id:C,revision:st.open.revision});st=await sx('SUPERVISOR',{action:'client_understanding_read',client_id:C});
 await sx('PARTNER',{action:'client_understanding_approve',client_id:C,revision:st.open.revision});
 st=await sx('PARTNER',{action:'client_understanding_read',client_id:C});assert.equal(st.approved.version,2);assert.equal(st.history.length,1);assert.equal(st.history[0].version,1);assert.match(st.history[0].superseded_reason,/Replaced by version 2/);assert.equal(st.file,'out_of_date','a new approved version makes the filed copy out of date');
 // Only one live approved version, and one open draft, at a time.
 assert.equal(Number((await tx`select count(*) n from erp_private.client_understanding where status='Approved'`)[0].n),1);

 // Preparer cannot approve their own work, unless they are the sole active Partner.
 await sx('PARTNER',{action:'client_understanding_save',client_id:C,sections:FULL});st=await sx('PARTNER',{action:'client_understanding_read',client_id:C});await sx('PARTNER',{action:'client_understanding_submit',client_id:C,revision:st.open.revision});st=await sx('PARTNER',{action:'client_understanding_read',client_id:C});
 await assert.rejects(()=>sx('PARTNER',{action:'client_understanding_approve',client_id:C,revision:st.open.revision}),/different Manager or Partner/);
 await tx`update erp_private.staff_members set access_status='Inactive' where staff_id=${actors.PARTNER2.staff_id}`;
 const own=await sx('PARTNER',{action:'client_understanding_approve',client_id:C,revision:st.open.revision});assert.equal(own.sole_partner_approval,true);
 st=await sx('PARTNER',{action:'client_understanding_read',client_id:C});assert.equal(st.approved.version,3);assert.equal(st.approved.sole_partner_approval,true);
 // Every step is on the audit trail.
 assert.ok(Number((await tx`select count(*) n from erp_private.audit_events where table_name='client_understanding'`)[0].n)>=8);
});

test('build 2867: wiring, access area and screen',()=>{
 const idx=rd('supabase/functions/staff-workspace-v12/index.ts'),ac=rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),imp=rd('staff-improvements.mjs'),prof=rd('staff-client-profile.mjs'),pilot=rd('staff-pilot.mjs'),ui=rd('staff-understanding.mjs');
 assert.match(idx,/clientUnderstandingAction\(tx,a,p,admin\.storage\.from\(BUCKET\),bucket\)/);assert.match(ac,/client_understanding_\|client_pf_\|/);
 assert.match(prof,/\['understanding','Understanding the client'\]/);assert.match(prof,/understanding:\(\)=>host\('understanding'\)/);
 assert.match(imp,/staff-understanding\.mjs\?v=20261121-und-v1/);assert.match(imp,/tab==='understanding'&&host\.dataset\.id===id\)\{await understanding\.paint\(host,id\)/);
 assert.match(pilot,/\['aml','understanding'\]\.includes\(clientTab\)/);assert.match(pilot,/staff-improvements\.mjs\?v=20261119-drafts2-v1/);assert.match(pilot,/staff-client-profile\.mjs\?v=20261121-und-v1/);
 for(const a of ['client_understanding_read','client_understanding_save','client_understanding_submit','client_understanding_return','client_understanding_approve','client_pf_preview','client_pf_file'])assert.match(rd('supabase/functions/staff-workspace-v12/client-understanding-actions.ts'),new RegExp(a));
 for(const w of ['Write the understanding','Start a new version','Submit for review','Approve this version','Return to the preparer','Preview the PDF','File it in the Permanent File','out of date'])assert.ok(ui.includes(w),w);
 assert.match(ui,/document\.addEventListener\('click'/);assert.doesNotMatch(ui,/innerHTML=.*\$\{r\.message/);
});
