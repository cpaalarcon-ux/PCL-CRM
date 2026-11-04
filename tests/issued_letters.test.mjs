import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'..');
const {PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const PDFLib=require(path.join(root,'supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));
const {letterPdf,letterDetails}=await import('../supabase/functions/staff-workspace-v12/letter-pdf.mjs');
const {letterDetails:screenDetails}=await import('../staff-communication-qr.mjs');
const {suiteAction,setPdfLib}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const sha=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');

const input={reference:'COM/PCL/2026/00007',subject:'Engagement for 2026',issuedBy:'Fictional Consulting Ltd',addressedTo:'UAT Fictional Client Ltd',attention:'Fictional Director',signatory:'Fictional Partner',letterDate:'2026-11-04'};
test('server and screen QR text match; the issued PDF is reproducible byte for byte',async()=>{
 assert.equal(letterDetails(input),screenDetails(input),'the printed QR and the issued PDF QR carry the same text');
 const l={reference:input.reference,subject:input.subject,purpose:'Tax compliance',details:'Dear Sir,\n\nPlease find our terms — with thanks.\n\nYours faithfully',firm:{legal_name:'Fictional Consulting Ltd',physical_address:'Plot 1, Nairobi',phone:'+254 700 000 000',email:'info@example.com',kra_pin:'P000000000Z'},addressed_to:input.addressedTo,attention:'Fictional Director',letter_date_text:'4 November 2026',signatory_name:'Fictional Partner',signatory_role:'Engagement Partner',issued_at:'2026-11-04T10:00:00.000Z',issued_on:'2026-11-04',qr_text:letterDetails(input)};
 const a=await letterPdf(l,PDFLib),b=await letterPdf(l,PDFLib);
 assert.equal(String.fromCharCode(...a.subarray(0,5)),'%PDF-');
 assert.equal(await sha(a),await sha(b),'the same issued record gives the same PDF');
 const longBody=await letterPdf({...l,details:'Paragraph text '.repeat(900)},PDFLib);assert.ok((await PDFLib.PDFDocument.load(longBody)).getPageCount()>1,'long letters flow onto more pages');
});

test('only the signatory or a Partner issues a letter; issued letters are locked',async t=>{
 setPdfLib(PDFLib);
 const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};t.after(()=>db.close());
 const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 const as=async(role,fn)=>{const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}};
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name,physical_address,kra_pin) values(${F},'LTRQA','Fictional Letter Firm','Plot 1, Nairobi','P000000000Z')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Letter Client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional letter project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 const call=(role,p)=>as(role,a=>suiteAction(tx,a,p)),today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
 const saved=await call('MANAGER',{action:'communication_save',request_id:id(),client_id:C,firm_id:F,project_id:P,channel:'Letter',subject:'Request for records',purpose:'Document request',details:'Please send the January records.',communication_date:today,signatory_id:actors.MANAGER.staff_id,status:'Open'});
 const row=async()=>(await tx`select * from erp_private.communications where communication_id=${saved.communication_id}`)[0];
 await assert.rejects(async()=>call('ASSISTANT',{action:'communication_issue',communication_id:saved.communication_id,revision:(await row()).revision}),/signatory or an Engagement Partner/);
 await assert.rejects(()=>call('ASSISTANT',{action:'communication_letter_pdf',communication_id:saved.communication_id}),/Issue the letter/);
 const issued=await call('MANAGER',{action:'communication_issue',communication_id:saved.communication_id,revision:(await row()).revision});
 assert.match(issued.qr_text,new RegExp('^DATE: '+today+'\nREF: '));assert.match(issued.qr_text,/SIGNATORY: Fictional MANAGER$/);
 const r=await row();assert.equal(r.issued_sha256,issued.sha256);assert.equal(r.issued_by,actors.MANAGER.staff_id);
 const again=await call('ASSISTANT',{action:'communication_letter_pdf',communication_id:saved.communication_id});assert.equal(again.sha256,issued.sha256,'a later download is the identical issued PDF');
 await assert.rejects(()=>call('MANAGER',{action:'communication_issue',communication_id:saved.communication_id,revision:r.revision}),/already issued/);
 await assert.rejects(()=>call('MANAGER',{action:'communication_save',communication_id:saved.communication_id,revision:r.revision,client_id:C,firm_id:F,project_id:P,channel:'Letter',subject:'Changed after issue',purpose:'Document request',details:'Changed',communication_date:today,signatory_id:actors.MANAGER.staff_id,status:'Open'}),/issued and is locked/);
 await assert.rejects(()=>tx`update erp_private.communications set details='Tampered' where communication_id=${saved.communication_id}`,/issued and is locked/);
 await tx`update erp_private.communications set status='Closed' where communication_id=${saved.communication_id}`;
});
