// Step 8 (joined-practice review): Incoming Review and linked documents (internal side).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Step 8: incoming review, sender matching, duplicates, accept and link, document links',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id,AST=actors.ASSISTANT.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M,firm=F)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${firm})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};

 const SUP=actors.SUPERVISOR.staff_id,PT2=actors.PARTNER2.staff_id;
 const A=await mk('UAT Fictional Services Ltd','A500000001Z'),B=await mk('UAT Fictional Traders Ltd','A500000002Z'),E=await mk('UAT Fictional Hauliers Ltd','A500000003Z');
 const contact=async(client,name,phone,email)=>{const c=id();await tx`insert into erp_private.client_contacts(contact_id,client_id,full_name,phone_number,email_address) values(${c},${client},${name},${phone},${email})`;return c;};
 const cA=await contact(A,'Fictional Alice','+254 712 345 678','Accounts@A.example'),cB=await contact(B,'Fictional Bob','0722 000 111',null),cE=await contact(E,'Fictional Eve','0744 100 200',null);
 const G=await mk('UAT Fictional Growers Ltd','A500000004Z'),H=await mk('UAT Fictional Hotels Ltd','A500000005Z');await contact(G,'Fictional Gina','0733 555 000',null);await contact(H,'Fictional Hal','0733-555-000',null);
 const pA=await proj(A,'TAX-COMP','Active',M),pB=await proj(B,'TAX-COMP','Active',M);
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pA},${SUP},${F},'SUPERVISOR')`;
 const F2=id();await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F2},'OTHR','Another fictional firm')`;
 const X=await mk('UAT Fictional Outsiders Ltd','A500000006Z',M,F2);await contact(X,'Fictional Xavier','0755 600 700',null);
 const sha=n=>n.toString(16).padStart(64,'0');
 let counter=100;
 const reg=async(role,o={})=>{const item=id();const v={src:'WhatsApp',name:'Fictional sender',addr:'+254 712 345 678',subject:'Bank statement for March',msg:'Please find the statement.',file:'statement.pdf',size:1200,sha:sha(++counter),mime:'application/pdf',kyc:false,client:null,...o};
  const r=await q(role,`select erp_private.incoming_register($1,$2,$3,$4,now(),$5,$6,$7,$8,$9,$10,$11,$12,$13) r`,[item,v.src,v.name,v.addr,v.subject,v.msg,v.file,'incoming/'+item+'/'+v.file,v.size,v.sha,v.mime,v.kyc,v.client]);return {item,...j(r[0].r)};};
 const itemRow=async i=>j((await tx`select * from erp_private.incoming_items where item_id=${i}`)[0]);
 const accept=(role,i,o={})=>{const v={client:A,firm:F,cat:'Correspondence',proj:null,task:null,kra:null,ps:null,pe:null,conf:null,comm:null,create:false,ref:null,req:null,dup:false,note:null,...o};
  return q(role,`select erp_private.incoming_accept($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) r`,[i,v.client,v.firm,v.cat,v.proj,v.task,v.kra,v.ps,v.pe,v.conf,v.comm,v.create,v.ref,v.req,v.dup,v.note]).then(r=>j(r[0].r));};
 const archive=(role,i,res,why)=>q(role,`select erp_private.incoming_archive($1,$2,$3) r`,[i,res,why]).then(r=>j(r[0].r));
 const setting=async(k,v)=>q('PARTNER',`update erp_private.incoming_settings set text_value=$2 where setting_key=$1`,[k,v]);

 // ---- 1. Settings are defaults until a Partner confirms them -------------------------------------------------------------------------------
 const st=j(await tx`select setting_key,int_value,text_value,rule_status from erp_private.incoming_settings order by setting_key`);
 assert.equal(st.length,5);assert.ok(st.every(s=>s.rule_status==='Suggested'));
 const sv=k=>st.find(s=>s.setting_key===k);
 assert.deepEqual([sv('accept_min_role').text_value,sv('restricted_min_role').text_value,sv('kyc_route').text_value,sv('retention_days').int_value],['SUPERVISOR','MANAGER','LEADERS_ONLY',365]);
 assert.equal(sv('overdue_days').int_value,3,'the menu count turns red after 3 days (default, not confirmed)');
 await q('MANAGER',`update erp_private.incoming_settings set text_value='PARTNER' where setting_key='accept_min_role'`);
 assert.equal((await tx`select text_value from erp_private.incoming_settings where setting_key='accept_min_role'`)[0].text_value,'SUPERVISOR','a Manager cannot change a setting');
 await assert.rejects(setting('accept_min_role','INTERN'),/Supervisor, Manager or Partner/);
 await assert.rejects(setting('restricted_min_role','SUPERVISOR'),/Manager or Partner/);
 await assert.rejects(setting('kyc_route','EVERYONE'),/LEADERS_ONLY or SAME_QUEUE/);
 await assert.rejects(q('PARTNER',`update erp_private.incoming_settings set int_value=5 where setting_key='retention_days'`),/30 to 3650/);
 await q('PARTNER',`update erp_private.incoming_settings set rule_status='Confirmed',confirmed_by=$1,source_note='Partner minute of 10 Nov 2026' where setting_key='retention_days'`,[PT]);
 assert.equal((await tx`select rule_status from erp_private.incoming_settings where setting_key='retention_days'`)[0].rule_status,'Confirmed');
 await q('PARTNER',`update erp_private.incoming_settings set int_value=400 where setting_key='retention_days'`);
 assert.equal((await tx`select rule_status from erp_private.incoming_settings where setting_key='retention_days'`)[0].rule_status,'Suggested','changing a value withdraws its confirmation');
 await q('PARTNER',`update erp_private.incoming_settings set int_value=365 where setting_key='retention_days'`);

 // ---- 2. Categories, channel, direction ----------------------------------------------------------------------------------------------------
 const d0=await tx`insert into erp_private.documents(client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${A},${F},'Correspondence','a.pdf','k/a',10,${sha(1)},'application/pdf',${M}),(${A},${F},'KRA Notices','b.pdf','k/b',10,${sha(2)},'application/pdf',${M}) returning source_type,confidentiality`;
 assert.deepEqual(j(d0),[{source_type:'Upload',confidentiality:'Normal'},{source_type:'Upload',confidentiality:'Normal'}]);
 await assert.rejects(tx`insert into erp_private.documents(client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${A},${F},'Bank Statements','a.pdf','k/c',10,${sha(3)},'application/pdf',${M})`,/check constraint/);
 const comm=async(client,ch,dir,project=null)=>{const c=id();await tx`insert into erp_private.communications(communication_id,request_id,reference,client_id,firm_id,project_id,channel,direction,subject,purpose,details,communication_date,signatory_id,owner_id) values(${c},${id()},${'COM/T/'+c.slice(0,8)},${client},${F},${project},${ch},${dir},'Subject','Purpose','Details',current_date,${M},${M})`;return c;};
 await assert.rejects(comm(A,'WhatsApp',null),/communications_direction_channel/);
 await assert.rejects(comm(A,'Meeting','Incoming'),/communications_direction_channel/);
 await comm(A,'WhatsApp','Outgoing');await comm(A,'Email','Incoming');await comm(A,'Internal note',null);

 // ---- 3. Phone and email keys ---------------------------------------------------------------------------------------------------------------
 const key=async v=>(await q('MANAGER',`select erp_private.incoming_norm_key($1) k`,[v]))[0].k;
 assert.equal(await key('+254 712 345 678'),'712345678');assert.equal(await key('0712-345-678'),'712345678');assert.equal(await key('254712345678'),'712345678');
 assert.equal(await key(' Accounts@A.EXAMPLE '),'accounts@a.example');assert.equal(await key('12345'),null);assert.equal(await key(null),null);

 // ---- 4. Registering a received file: who may, and sender matching ---------------------------------------------------------------------------
 await assert.rejects(reg('ASSISTANT'),/Only a Supervisor, Manager or Partner/);
 await assert.rejects(reg('INTERN'),/Only a Supervisor, Manager or Partner/);
 await assert.rejects(reg('SUPERVISOR',{src:'Carrier pigeon'}),/Choose how the file was received/);
 const r1=await reg('SUPERVISOR');
 assert.deepEqual([r1.status,r1.match_result,r1.match_count,r1.client_id],['Received','One match',1,A]);
 assert.equal((await itemRow(r1.item)).contact_id,cA,'the single contact is recorded');
 const rEmail=await reg('SUPERVISOR',{src:'Email',addr:'ACCOUNTS@a.example',file:'mail.pdf'});assert.deepEqual([rEmail.status,rEmail.client_id],['Received',A],'email matches case-insensitively');
 // The Supervisor has no access to the other firm's client X, so X is invisible to them: no match. A Partner sees the match.
 const rB1=await reg('SUPERVISOR',{addr:'0755 600 700',file:'b1.pdf'});assert.deepEqual([rB1.status,rB1.match_result,rB1.client_id],['Needs Review','No match',null]);
 const rB2=await reg('PARTNER',{addr:'0755600700',file:'b2.pdf'});assert.deepEqual([rB2.status,rB2.match_result,rB2.client_id],['Received','One match',X]);
 // The shared number belongs to two clients (A and E): several matches, so it is not routed.
 const rS=await reg('PARTNER',{addr:'0733555000',file:'shared.pdf'});assert.deepEqual([rS.status,rS.match_result,rS.match_count,rS.client_id],['Needs Review','Several matches',2,null]);
 const cand=await q('PARTNER',`select client_name,contact_name from erp_private.incoming_candidates($1) order by client_name`,[rS.item]);
 assert.deepEqual(j(cand).map(x=>x.client_name),['UAT Fictional Growers Ltd','UAT Fictional Hotels Ltd']);
 const rU=await reg('SUPERVISOR',{addr:'0799 999 999',file:'unknown.pdf'});assert.deepEqual([rU.status,rU.match_result,rU.match_count,rU.client_id],['Needs Review','No match',0,null]);
 const rChosen=await reg('SUPERVISOR',{addr:'0799 888 888',file:'chosen.pdf',client:A});assert.deepEqual([rChosen.status,rChosen.match_result,rChosen.client_id],['Received','Chosen by staff',A]);
 await assert.rejects(reg('SUPERVISOR',{client:X,file:'x.pdf'}),/not available to you/);
 // Duplicate hash against another waiting item.
 const dupS=sha(777);const first=await reg('SUPERVISOR',{sha:dupS,file:'one.pdf'});const second=await reg('SUPERVISOR',{sha:dupS,file:'two.pdf'});
 assert.equal(first.status,'Received');assert.deepEqual([second.status,second.duplicate_item_id],['Needs Review',first.item]);
 await assert.rejects(tx`insert into erp_private.incoming_items(item_id,source_type,received_at,subject,file_name,object_key,file_size_bytes,sha256,mime_type,match_result,status,logged_by) values(${id()},'Email',now(),'Subject here','f.pdf','incoming/x',5,${sha(9)},'application/pdf','No match','Received',${M})`,/check constraint/);

 // ---- 5. Who sees the queue ---------------------------------------------------------------------------------------------------------------------
 const ids=async role=>new Set((await q(role,`select item_id from erp_private.incoming_items`)).map(x=>x.item_id));
 assert.equal((await ids('ASSISTANT')).size,0,'an Assistant sees nothing');assert.equal((await ids('INTERN')).size,0,'an Intern sees nothing');
 assert.equal((await q('ASSISTANT',`select * from erp_private.incoming_list(false)`)).length,0);
 const supSees=await ids('SUPERVISOR'),mgrSees=await ids('MANAGER');
 assert.ok(supSees.has(r1.item)&&supSees.has(rU.item)&&supSees.has(rS.item),'a Supervisor sees routed items for their clients and unrouted items');
 assert.ok(!supSees.has(rB2.item),'but not an item routed to a client they cannot see');
 assert.ok(!mgrSees.has(rB2.item)&&mgrSees.has(rS.item));assert.ok((await ids('PARTNER')).has(rB2.item));
 assert.equal((await q('SUPERVISOR',`select count(*)::int n from erp_private.incoming_list(false)`))[0].n,supSees.size);
 const lst=j(await q('MANAGER',`select client_name,logged_by_name,source_type from erp_private.incoming_list(false) where item_id=$1`,[r1.item]));assert.deepEqual(lst,[{client_name:'UAT Fictional Services Ltd',logged_by_name:'Fictional SUPERVISOR',source_type:'WhatsApp'}]);
 await assert.rejects(q('SUPERVISOR',`update erp_private.incoming_items set status='Archived' where item_id=$1`,[r1.item]),/permission denied/);
 await assert.rejects(q('MANAGER',`insert into erp_private.incoming_items(item_id) values($1)`,[id()]),/permission denied/);
 await assert.rejects(tx`delete from erp_private.incoming_items where item_id=${r1.item}`,/archived, not deleted/);
 // The client's communication level hides its items from Supervisors (build 109).
 await db.exec("select set_config('erp.comm_ok','1',false)");await tx`update erp_private.clients set comm_access_level='MANAGERS_AND_PARTNERS' where client_id=${E}`;
 const rE=await reg('PARTNER',{addr:'0700 111 222',file:'e.pdf',client:E});assert.equal(rE.client_id,E);
 assert.ok(!(await ids('SUPERVISOR')).has(rE.item),'a client limited to Managers and Partners is hidden from Supervisors');assert.ok((await ids('MANAGER')).has(rE.item));
 await tx`update erp_private.clients set comm_access_level='SUPERVISORS_AND_ABOVE' where client_id=${E}`;await db.exec("select set_config('erp.comm_ok','',false)");

 // ---- 6. Choosing the client ---------------------------------------------------------------------------------------------------------------------
 await assert.rejects(q('SUPERVISOR',`select erp_private.incoming_choose_client($1,$2)`,[rU.item,X]),/not available to you/);
 await q('SUPERVISOR',`select erp_private.incoming_choose_client($1,$2)`,[rU.item,A]);
 let u=await itemRow(rU.item);assert.deepEqual([u.client_id,u.match_result,u.status],[A,'Chosen by staff','Received']);
 await q('MANAGER',`select erp_private.incoming_choose_client($1,$2)`,[rS.item,G]);
 u=await itemRow(rS.item);assert.deepEqual([u.client_id,u.status],[G,'Received']);assert.ok(u.contact_id,'the matching contact of the chosen client is recorded');
 await q('MANAGER',`select erp_private.incoming_choose_client($1,$2)`,[second.item,A]);assert.equal((await itemRow(second.item)).status,'Needs Review','a duplicate stays in review');

 // ---- 7. Accept and link ---------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(accept('ASSISTANT',r1.item),/not available to you/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{cat:'Final Reports'}),/Supervisor files correspondence/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{cat:'Working Papers'}),/Supervisor files correspondence/,'other evidence needs a project');
 await assert.rejects(accept('SUPERVISOR',r1.item,{cat:'Import Sources'}),/Choose a document category/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{cat:null}),/Choose a document category/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{firm:wrongFirmId()}),/Choose a firm/);
 function wrongFirmId(){return id();}
 await assert.rejects(accept('SUPERVISOR',r1.item,{client:X}),/not available to you/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{proj:pB}),/not available to you|project must belong/);
 await assert.rejects(accept('MANAGER',r1.item,{proj:pB}),/project must belong to the chosen client/);
 await assert.rejects(accept('MANAGER',r1.item,{task:id()}),/Choose a project before choosing a task/);
 await assert.rejects(accept('MANAGER',r1.item,{ps:'2026-01-01'}),/both ends of the period/);
 await assert.rejects(accept('MANAGER',r1.item,{ps:'2026-02-01',pe:'2026-01-01'}),/both ends of the period/);
 await assert.rejects(accept('MANAGER',r1.item,{comm:await comm(B,'Email','Incoming')}),/same client and firm|must belong to the chosen client/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{conf:'Restricted'}),/Restricted file is accepted by a Manager or Partner/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{conf:'Forensic'}),/Choose Normal or Restricted/);
 await assert.rejects(accept('SUPERVISOR',r1.item,{create:true}),/needs a reference/);
 assert.equal((await itemRow(r1.item)).status,'Received','failed attempts change nothing');
 const sh1=(await itemRow(r1.item)).sha256;
 const ok1=await accept('SUPERVISOR',r1.item,{create:true,ref:'COM/AUDB/2026/00001',req:id(),note:'Checked against the contact list'});
 assert.deepEqual([ok1.ok,ok1.category],[true,'Correspondence']);
 const d1=j((await tx`select client_id,handling_firm_id,category,source_type,confidentiality,uploaded_by,communication_id,incoming_item_id,sha256,object_key,is_locked from erp_private.documents where document_id=${ok1.document_id}`)[0]);
 assert.deepEqual(d1,{client_id:A,handling_firm_id:F,category:'Correspondence',source_type:'WhatsApp',confidentiality:'Normal',uploaded_by:SUP,communication_id:ok1.communication_id,incoming_item_id:r1.item,sha256:sh1,object_key:'incoming/'+r1.item+'/statement.pdf',is_locked:false});
 const c1=j((await tx`select channel,direction,sender_address,reference,owner_id,signatory_id,status,contact_id,communication_date::text d from erp_private.communications where communication_id=${ok1.communication_id}`)[0]);
 assert.deepEqual([c1.channel,c1.direction,c1.sender_address,c1.reference,c1.owner_id,c1.contact_id],['WhatsApp','Incoming','+254 712 345 678','COM/AUDB/2026/00001',SUP,cA]);
 const i1=await itemRow(r1.item);assert.deepEqual([i1.status,i1.resolution,i1.document_id,i1.communication_id,i1.decided_by,i1.category,i1.decision_note],['Accepted and Linked','Accepted',ok1.document_id,ok1.communication_id,SUP,'Correspondence','Checked against the contact list']);
 await assert.rejects(accept('SUPERVISOR',r1.item),/already accepted and linked/);
 await assert.rejects(q('MANAGER',`select erp_private.incoming_choose_client($1,$2)`,[r1.item,A]),/already accepted and linked/);
 assert.equal((await q('MANAGER',`select document_id from erp_private.documents where document_id=$1`,[ok1.document_id])).length,1,'the filed document is visible to a Manager');
 // Duplicate of a filed document.
 const dupAgain=await reg('SUPERVISOR',{sha:sh1,file:'statement-again.pdf'});
 assert.deepEqual([dupAgain.status,dupAgain.duplicate_document_id],['Needs Review',ok1.document_id]);
 await assert.rejects(accept('SUPERVISOR',dupAgain.item),/already filed for this client/);
 const ok2=await accept('SUPERVISOR',dupAgain.item,{dup:true});assert.equal(ok2.ok,true);
 // KRA notice link, period link, project and task.
 const kcase=async(client,ref)=>{const r=await q('MANAGER',`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,logged_by) values($1,$2,$3,'Audit notice','VAT','2025-01-01','2025-12-31',current_date,current_date,current_date+30,'Fictional audit notice for the year 2025.',$4) returning case_id`,[client,F,ref,M]);return r[0].case_id;};
 const kA=await kcase(A,'KRA/STEP8/A'),kB=await kcase(B,'KRA/STEP8/B');
 const rK=await reg('MANAGER',{file:'kra-notice.pdf',subject:'KRA audit notice',client:A});
 await assert.rejects(accept('MANAGER',rK.item,{cat:'KRA Notices',kra:kB}),/KRA notice is not available/);
  await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pA},${M},${F},'MANAGER') on conflict do nothing`;
 const task=id();await db.exec('alter table erp_private.tasks disable trigger user');await tx`insert into erp_private.tasks(task_id,project_id,task_name,assigned_to,status,due_at) values(${task},${pA},'Step 8 task',${M},'Pending',now()+interval '3 days')`;await db.exec('alter table erp_private.tasks enable trigger user');
 const okK=await accept('MANAGER',rK.item,{cat:'KRA Notices',kra:kA,ps:'2025-01-01',pe:'2025-12-31',proj:pA,task});
 const dK=j((await tx`select category,project_id,task_id from erp_private.documents where document_id=${okK.document_id}`)[0]);assert.deepEqual(dK,{category:'KRA Notices',project_id:pA,task_id:task});
 const lk=j(await tx`select kra_case_id,period_start::text,period_end::text from erp_private.document_links where document_id=${okK.document_id} order by period_start nulls first`);
 assert.deepEqual(lk,[{kra_case_id:kA,period_start:null,period_end:null},{kra_case_id:null,period_start:'2025-01-01',period_end:'2025-12-31'}]);
 assert.equal(okK.communication_id,null,'no communication unless asked');

 // ---- 8. Restricted and KYC ---------------------------------------------------------------------------------------------------------------------
 const rR=await reg('MANAGER',{file:'restricted.pdf',client:A});
 await q('MANAGER',`select erp_private.incoming_set_handling($1,'Restricted',false)`,[rR.item]);
 assert.ok(!(await ids('SUPERVISOR')).has(rR.item),'a Restricted item is hidden from a Supervisor');assert.ok((await ids('MANAGER')).has(rR.item));
 await assert.rejects(q('SUPERVISOR',`select erp_private.incoming_set_handling($1,'Normal',false)`,[rR.item]),/not available to you/);
 await assert.rejects(q('MANAGER',`select erp_private.incoming_set_handling($1,'Forensic',false)`,[rR.item]),/Forensic level is not offered/);
 const okR=await accept('MANAGER',rR.item);
 assert.equal((await tx`select confidentiality from erp_private.documents where document_id=${okR.document_id}`)[0].confidentiality,'Restricted');
 assert.equal((await q('SUPERVISOR',`select 1 from erp_private.documents where document_id=$1`,[okR.document_id])).length,0,'a Supervisor cannot read a Restricted document');
 assert.equal((await q('MANAGER',`select 1 from erp_private.documents where document_id=$1`,[okR.document_id])).length,1);
 assert.equal((await q('SUPERVISOR',`select 1 from erp_private.kra_client_documents($1) where document_id=$2`,[A,okR.document_id])).length,0,'nor list it in the KRA notice screen');
 assert.equal((await q('MANAGER',`select 1 from erp_private.kra_client_documents($1) where document_id=$2`,[A,okR.document_id])).length,1);
 await assert.rejects(q('SUPERVISOR',`update erp_private.documents set confidentiality='Normal' where document_id=$1`,[okR.document_id]),/permission denied/);
 // KYC under the default route (leaders only).
 await assert.rejects(reg('SUPERVISOR',{kyc:true,file:'id.pdf'}),/logged by a Manager or Partner/);
 const rKyc=await reg('MANAGER',{kyc:true,file:'id-card.pdf',client:A});
 assert.ok(!(await ids('SUPERVISOR')).has(rKyc.item),'KYC items stay out of the Supervisor queue');
 await assert.rejects(accept('MANAGER',rKyc.item,{proj:pA}),/filed at client level/);
 const okKyc=await accept('MANAGER',rKyc.item,{cat:'Correspondence'});
 const dKyc=j((await tx`select category,is_locked from erp_private.documents where document_id=${okKyc.document_id}`)[0]);assert.deepEqual(dKyc,{category:'Permanent File',is_locked:true},'a leader files KYC straight into the Permanent File');
 // Same queue: a Supervisor accepts into KYC Pending, and another leader approves with the existing approval.
 await setting('kyc_route','SAME_QUEUE');
 const rKyc2=await reg('SUPERVISOR',{kyc:true,file:'passport.pdf',client:A});assert.ok((await ids('SUPERVISOR')).has(rKyc2.item));
 const okKyc2=await accept('SUPERVISOR',rKyc2.item);
 assert.equal((await tx`select category from erp_private.documents where document_id=${okKyc2.document_id}`)[0].category,'KYC Pending');
 assert.equal((await q('SUPERVISOR',`select 1 from erp_private.documents where document_id=$1`,[okKyc2.document_id])).length,0,'the Supervisor cannot read it back');
 await q('MANAGER',`select erp_private.kyc_promote_document($1,$2)`,[okKyc2.document_id,A]);
 assert.equal((await tx`select category from erp_private.documents where document_id=${okKyc2.document_id}`)[0].category,'Permanent File');
 await setting('kyc_route','LEADERS_ONLY');

 // ---- 9. Who may accept ---------------------------------------------------------------------------------------------------------------------------
 const rP=await reg('SUPERVISOR',{file:'policy.pdf',client:A});
 await setting('accept_min_role','MANAGER');
 await assert.rejects(accept('SUPERVISOR',rP.item),/may not accept incoming files/);
 await assert.rejects(archive('SUPERVISOR',rP.item,'Rejected','Not for this client at all'),/may not reject incoming files/);
 await assert.rejects(q('SUPERVISOR',`select erp_private.incoming_choose_client($1,$2)`,[rP.item,A]),/may not review incoming files/);
 await accept('MANAGER',rP.item);
 await setting('accept_min_role','SUPERVISOR');
 await setting('restricted_min_role','PARTNER');
 const rR2=await reg('MANAGER',{file:'partner-only.pdf',client:A});await q('MANAGER',`select erp_private.incoming_set_handling($1,'Restricted',false)`,[rR2.item]);
 assert.ok(!(await ids('MANAGER')).has(rR2.item),'with the restricted role at Partner, a Manager no longer sees it');assert.ok((await ids('PARTNER')).has(rR2.item));
 await assert.rejects(accept('MANAGER',rR2.item),/not available to you/);
 await accept('PARTNER',rR2.item);
 await setting('restricted_min_role','MANAGER');

 // ---- 10. Reject, request a replacement ---------------------------------------------------------------------------------------------------------
 const rJ=await reg('SUPERVISOR',{file:'junk.pdf',client:A});
 await assert.rejects(archive('SUPERVISOR',rJ.item,'Rejected','short'),/at least 10 characters/);
 await assert.rejects(archive('SUPERVISOR',rJ.item,'Deleted','This is not a real choice'),/Choose Rejected/);
 await assert.rejects(archive('ASSISTANT',rJ.item,'Rejected','Assistants cannot do this'),/not available to you/);
 const arch=await archive('SUPERVISOR',rJ.item,'Replacement requested','The scan is unreadable; ask the client to resend');
 assert.equal(arch.resolution,'Replacement requested');
 const jr=await itemRow(rJ.item);assert.deepEqual([jr.status,jr.resolution,jr.decided_by,jr.document_id],['Archived','Replacement requested',SUP,null]);
 await assert.rejects(archive('SUPERVISOR',rJ.item,'Rejected','Trying to change my mind'),/already archived/);
 await assert.rejects(accept('SUPERVISOR',rJ.item),/already archived/);
 assert.equal((await tx`select count(*)::int n from erp_private.documents where incoming_item_id=${rJ.item}`)[0].n,0,'nothing is filed from a rejected item');
 const archived=j(await q('MANAGER',`select item_id,status,resolution,past_retention from erp_private.incoming_list(true) where item_id=$1`,[rJ.item]));assert.deepEqual(archived,[{item_id:rJ.item,status:'Archived',resolution:'Replacement requested',past_retention:false}]);
 await db.exec('alter table erp_private.incoming_items disable trigger user');await tx`update erp_private.incoming_items set decided_at=now()-interval '400 days' where item_id=${rJ.item}`;await db.exec('alter table erp_private.incoming_items enable trigger user');
 assert.equal((await q('MANAGER',`select past_retention from erp_private.incoming_list(true) where item_id=$1`,[rJ.item]))[0].past_retention,true,'an archived item older than the retention period is marked, not deleted');
 await assert.rejects(tx`update erp_private.incoming_items set file_name='other.pdf' where item_id=${rJ.item}`,/cannot change/);

 // ---- 11. Links from a document to more than one record ---------------------------------------------------------------------------------------
 const link=(role,doc,o={})=>{const v={comm:null,proj:null,task:null,kra:null,ps:null,pe:null,note:null,...o};return q(role,`select erp_private.document_link_add($1,$2,$3,$4,$5,$6,$7,$8) r`,[doc,v.comm,v.proj,v.task,v.kra,v.ps,v.pe,v.note]).then(r=>j(r[0].r));};
 const cm2=await comm(A,'Email','Incoming');
 const l1=await link('MANAGER',ok1.document_id,{comm:cm2,note:'Also mentioned in this email'});assert.equal(l1.ok,true);
 const l2=await link('MANAGER',ok1.document_id,{proj:pA});const l3=await link('MANAGER',ok1.document_id,{task});const l4=await link('MANAGER',ok1.document_id,{kra:kA});
 await assert.rejects(link('MANAGER',ok1.document_id,{kra:kA}),/duplicate key|unique/);
 await assert.rejects(link('MANAGER',ok1.document_id,{comm:await comm(B,'Email','Incoming')}),/same client|not available/);
 await assert.rejects(link('MANAGER',ok1.document_id,{proj:pB}),/not available|same client/);
 await assert.rejects(link('MANAGER',ok1.document_id,{kra:kB}),/same client|not available/);
 await assert.rejects(link('MANAGER',ok1.document_id,{comm:cm2,proj:pA}),/one record at a time/);
 await assert.rejects(link('MANAGER',ok1.document_id,{}),/one record at a time/);
 await assert.rejects(link('ASSISTANT',ok1.document_id,{proj:pA}),/Only a Supervisor, Manager or Partner/);
 await assert.rejects(link('MANAGER','00000000-0000-0000-0000-000000000000',{proj:pA}),/not available/);
 await assert.rejects(link('SUPERVISOR',okR.document_id,{proj:pA}),/not available/);
 // The trigger refuses a cross-client link even from a direct insert (definer or superuser).
 await assert.rejects(tx`insert into erp_private.document_links(document_id,project_id,created_by) values(${ok1.document_id},${pB},${M})`,/same client and the same firm/);
 await assert.rejects(tx`insert into erp_private.documents(client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by,communication_id) values(${A},${F},'Correspondence','z.pdf','k/z',10,${sha(5)},'application/pdf',${M},${await comm(B,'Email','Incoming')})`,/same client and firm/);
 const seen=j(await q('MANAGER',`select count(*)::int n from erp_private.document_links where document_id=$1 and removed_at is null`,[ok1.document_id]));assert.equal(seen[0].n,4);
 assert.equal((await q('ASSISTANT',`select 1 from erp_private.document_links`)).length,0,'an Assistant sees no links');
 await assert.rejects(q('SUPERVISOR',`select erp_private.document_link_remove($1,'Not needed any more here')`,[l1.link_id]),/not available to you/,'a client-level document is not visible to a Supervisor');
 const lk2=await link('MANAGER',okK.document_id,{comm:cm2});
 await assert.rejects(q('SUPERVISOR',`select erp_private.document_link_remove($1,'Not needed any more here')`,[lk2.link_id]),/Only the person who added a link/);
 const lk3=await link('SUPERVISOR',okK.document_id,{note:'Supervisor link',period_start:null,ps:'2025-06-01',pe:'2025-06-30'});
 await q('SUPERVISOR',`select erp_private.document_link_remove($1,'Added to the wrong period by mistake')`,[lk3.link_id]);
 await assert.rejects(q('MANAGER',`select erp_private.document_link_remove($1,'short')`,[l1.link_id]),/at least 10 characters/);
 await q('MANAGER',`select erp_private.document_link_remove($1,'Linked to the wrong email thread')`,[l1.link_id]);
 await assert.rejects(q('MANAGER',`select erp_private.document_link_remove($1,'Trying to remove it again')`,[l1.link_id]),/already been removed/);
 assert.equal((await tx`select count(*)::int n from erp_private.document_links where link_id=${l1.link_id}`)[0].n,1,'a removed link stays on the record');
 await link('MANAGER',ok1.document_id,{comm:cm2});
 await assert.rejects(tx`delete from erp_private.document_links where link_id=${l1.link_id}`,/archived, not deleted/);
 await assert.rejects(tx`update erp_private.document_links set communication_id=${cm2},project_id=null where link_id=${l2.link_id}`,/cannot be changed/);

 // ---- 12. Counts, row security, grants -----------------------------------------------------------------------------------------------------------
 const cnt=j((await q('MANAGER',`select erp_private.incoming_counts() c`))[0].c);assert.ok(cnt.incoming_waiting>=1&&cnt.incoming_needs_review>=1&&cnt.incoming_oldest_days>=0);
 assert.deepEqual(j((await q('SUPERVISOR',`select erp_private.incoming_counts() c`))[0].c),{});

 // ---- 12b. The menu count (build 2680): scoped to what the person may see, hidden from people who may not review ---------------------------------
 const badge=async role=>j((await q(role,`select erp_private.incoming_badge() b`))[0].b);
 const listN=async role=>(await q(role,`select count(*)::int n from erp_private.incoming_list(false)`))[0].n;
 for(const role of ['SUPERVISOR','MANAGER','PARTNER']){const b=await badge(role);assert.equal(b.waiting,await listN(role),role+': the count equals the waiting list the person can open');}
 const rBadge=await reg('MANAGER',{file:'badge-restricted.pdf',client:A});await q('MANAGER',`select erp_private.incoming_set_handling($1,'Restricted',false)`,[rBadge.item]);
 assert.equal((await badge('MANAGER')).waiting,await listN('MANAGER'));assert.equal((await badge('SUPERVISOR')).waiting,await listN('SUPERVISOR'));
 assert.ok((await badge('MANAGER')).waiting>(await badge('SUPERVISOR')).waiting,'a Restricted file is counted for a Manager but not for a Supervisor');
 for(const role of ['ASSISTANT','INTERN'])assert.deepEqual(await badge(role),{waiting:0,overdue:0},role+' has no queue and no count');
 // Counts on the page card are scoped the same way: with Restricted files limited to Partners a Manager no longer counts them.
 await q('PARTNER',`update erp_private.incoming_settings set text_value='PARTNER' where setting_key='restricted_min_role'`);
 assert.equal(j((await q('MANAGER',`select erp_private.incoming_counts() c`))[0].c).incoming_waiting,await listN('MANAGER'),'the page card count matches what a Manager can open');
 assert.equal((await badge('MANAGER')).waiting,await listN('MANAGER'));
 await q('PARTNER',`update erp_private.incoming_settings set text_value='MANAGER' where setting_key='restricted_min_role'`);
 // A role that may not accept sees no count even though it can read the queue.
 await q('PARTNER',`update erp_private.incoming_settings set text_value='MANAGER' where setting_key='accept_min_role'`);
 assert.deepEqual(await badge('SUPERVISOR'),{waiting:0,overdue:0},'a Supervisor who may not review gets no count');
 assert.ok((await badge('MANAGER')).waiting>0);
 await q('PARTNER',`update erp_private.incoming_settings set text_value='SUPERVISOR' where setting_key='accept_min_role'`);
 // The card figures per client use the same rules: only files the person may open, only for a role that may review.
 const cflags=(role,ids)=>q(role,`select client_id,incoming_waiting,incoming_overdue from erp_private.client_card_flags($1::uuid[])`,[ids]);
 const perClient=async role=>{const m=new Map();for(const r of await q(role,`select client_id,count(*)::int n from erp_private.incoming_list(false) where client_id is not null group by client_id`))m.set(r.client_id,r.n);return m;};
 for(const role of ['MANAGER','PARTNER','SUPERVISOR']){const want=await perClient(role);const got=await cflags(role,[...want.keys()]);
  assert.ok(got.length>=1,role);for(const r of got)assert.equal(r.incoming_waiting,want.get(r.client_id),role+': the client card shows the same waiting files the person can open');}
 assert.ok([...(await cflags('MANAGER',[A])).map(r=>r.incoming_waiting)][0]>(await cflags('SUPERVISOR',[A])).map(r=>r.incoming_waiting)[0],'a Restricted file counts on the card for a Manager, not for a Supervisor');
 await q('PARTNER',`update erp_private.incoming_settings set text_value='MANAGER' where setting_key='accept_min_role'`);
 assert.equal((await cflags('SUPERVISOR',[A]))[0].incoming_waiting,0,'a role that may not review sees no incoming figure on the card');
 await q('PARTNER',`update erp_private.incoming_settings set text_value='SUPERVISOR' where setting_key='accept_min_role'`);
 // Overdue: a waiting file logged longer ago than the setting turns the count red; the number of waiting files does not change.
 const before=await badge('MANAGER');assert.equal(before.overdue,0,'nothing is overdue yet');
 const oldOne=(await tx`select item_id from erp_private.incoming_items where deleted_at is null and status in('Received','Needs Review') order by logged_at limit 1`)[0].item_id;
 await db.exec('alter table erp_private.incoming_items disable trigger user');
 await tx`update erp_private.incoming_items set logged_at=now()-interval '4 days' where item_id=${oldOne}`;
 await db.exec('alter table erp_private.incoming_items enable trigger user');
 const after=await badge('PARTNER');assert.equal(after.overdue>=1,true,'a 4-day-old waiting file is overdue');assert.equal(after.waiting,await listN('PARTNER'));
 await q('PARTNER',`update erp_private.incoming_settings set int_value=10 where setting_key='overdue_days'`);
 assert.equal((await badge('PARTNER')).overdue,0,'a 10-day limit leaves the 4-day-old file not overdue');
 await assert.rejects(q('PARTNER',`update erp_private.incoming_settings set int_value=0 where setting_key='overdue_days'`),/1 to 60/);
 await assert.rejects(q('PARTNER',`update erp_private.incoming_settings set int_value=61 where setting_key='overdue_days'`),/1 to 60/);
 await q('MANAGER',`update erp_private.incoming_settings set int_value=2 where setting_key='overdue_days'`);
 assert.equal((await tx`select int_value from erp_private.incoming_settings where setting_key='overdue_days'`)[0].int_value,10,'only a Partner changes it');
 await q('PARTNER',`update erp_private.incoming_settings set int_value=3 where setting_key='overdue_days'`);
 assert.equal((await tx`select rule_status from erp_private.incoming_settings where setting_key='overdue_days'`)[0].rule_status,'Suggested');
 for(const t of ['incoming_items','incoming_settings','document_links'])assert.deepEqual(j((await tx`select relrowsecurity,relforcerowsecurity from pg_class where oid=${'erp_private.'+t}::regclass`)[0]),{relrowsecurity:true,relforcerowsecurity:true},t);
 const fns=['incoming_register','incoming_choose_client','incoming_set_handling','incoming_accept','incoming_archive','incoming_list','incoming_candidates','incoming_counts','incoming_badge','document_link_add','document_link_remove','incoming_can_see','incoming_matches'];
 for(const f of fns){const g=await tx`select has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') auth,has_function_privilege('service_role',p.oid,'execute') svc,has_function_privilege('erp_api',p.oid,'execute') api,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname=${f}`;assert.equal(g.length,1,f);assert.deepEqual([g[0].anon,g[0].auth,g[0].svc,g[0].api,g[0].prosecdef],[false,false,false,true,true],f);assert.ok(g[0].proconfig.some(x=>/search_path/.test(x)),f+' pins the search path');}
 // The Assistant's own evidence rules are unchanged.
 const ad=await q('SUPERVISOR',`select erp_private.document_allowed($1,$2,$3,null,'Correspondence',false) ok`,[A,F,pA]);assert.equal(ad[0].ok,true);
});
