// Client support tickets linked to KRA notices, with priority, due dates and assignment notes (build 2774).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const {clientSupportAction}=await import('../supabase/functions/staff-workspace-v12/client-support-actions.ts');
const {physicalFileAction,setPhysicalPdfLib}=await import('../supabase/functions/staff-workspace-v12/physical-file-actions.ts');
let PDFLib;try{PDFLib=require('pdf-lib');}catch{PDFLib=require(path.resolve(root,'supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));}
setPhysicalPdfLib(PDFLib);
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
tx.json=v=>JSON.stringify(v);
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('physical files: reference, movements, scanned copy, dispatch note, archive and lock',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,SUP=actors.SUPERVISOR.staff_id,INT=actors.INTERN.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const Z=await mk('UAT Fictional Paper Client Ltd','A400000070Z'),Z2=await mk('UAT Fictional Other Client Ltd','A400000071Z');const W=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${W},'UAT Fictional Unlinked Ltd','A400000072Z','Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${M})`;
 const pf=(role,p)=>as(role,a=>physicalFileAction(tx,a,p)),cs=(role,p)=>as(role,a=>clientSupportAction(tx,a,p));
 const D=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
 const year=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric'}).format(new Date());
 // a non-billable ticket for the same client
 const tk=await cs('MANAGER',{action:'client_support_open',client_id:Z,firm_id:F,service_code:'GENERAL_QUERY',subject:'Paper records for the audit',details:'The client dropped off a box file.',assigned_to:SUP,response_due_on:D(1),resolution_due_on:D(7)});
 const T=tk.ticket_id;
 const reg={action:'physical_file_register',client_id:Z,firm_id:F,description:'Original bank statements, box file',location:'Shelf B, Box 4',received_from:'Client driver'};
 // registering: roles, link to a firm, date, ticket of the same client
 await assert.rejects(pf('INTERN',reg),/does not handle physical files/);
 await assert.rejects(pf('MANAGER',{...reg,client_id:W}),/not linked to the chosen firm/);
 await assert.rejects(pf('MANAGER',{...reg,received_on:D(3)}),/cannot be in the future/);
 await assert.rejects(pf('MANAGER',{...reg,description:'x'}),/Check the required text|violates/i);
 const other=await cs('MANAGER',{action:'client_support_open',client_id:Z2,firm_id:F,service_code:'GENERAL_QUERY',subject:'Another client',details:'Other.',assigned_to:SUP,response_due_on:D(1),resolution_due_on:D(7)});
 await assert.rejects(pf('MANAGER',{...reg,ticket_id:other.ticket_id}),/Link a ticket of this client and firm/);
 const r1=await pf('MANAGER',{...reg,ticket_id:T});
 assert.equal(r1.file_ref,`PHY-${year}-001`);
 const r2=await pf('MANAGER',{...reg,description:'Signed contracts folder',location:'Shelf A'});
 assert.equal(r2.file_ref,`PHY-${year}-002`,'the number counts up');
 let rd=await pf('MANAGER',{action:'physical_file_read',file_id:r1.file_id});
 assert.deepEqual([rd.file.status,rd.file.location,rd.file.ticket_number!=null,rd.file.holder_id],['In store','Shelf B, Box 4',true,null]);
 assert.deepEqual(rd.movements.map(m=>m.kind),['Received']);assert.equal(rd.movements[0].note,'Client driver');
 // a movement of kind Received cannot be added by hand
 await assert.rejects(q('MANAGER',`insert into erp_private.physical_file_movements(file_id,kind,moved_by,status_after) values($1,'Received',$2,'In store')`,[r1.file_id,M]),/received when it is registered/);
 // moving: needs a person or a place; the person must handle client work
 let rev=rd.file.revision;
 await assert.rejects(pf('MANAGER',{action:'physical_file_move',file_id:r1.file_id,revision:rev}),/Say who has the file now/);
 await assert.rejects(pf('MANAGER',{action:'physical_file_move',file_id:r1.file_id,revision:rev,to_holder:INT}),/active member of staff who handles client work/);
 await assert.rejects(pf('MANAGER',{action:'physical_file_move',file_id:r1.file_id,revision:'999'}),/changed\. Refresh/);
 await pf('MANAGER',{action:'physical_file_move',file_id:r1.file_id,revision:rev,to_holder:SUP,note:'For the bank reconciliation'});
 rd=await pf('MANAGER',{action:'physical_file_read',file_id:r1.file_id});assert.deepEqual([rd.file.status,rd.file.holder_id],['With staff',SUP]);
 await assert.rejects(pf('MANAGER',{action:'physical_file_move',file_id:r1.file_id,revision:rev,to_holder:SUP}),/changed\. Refresh/,'a stale screen cannot move it again');
 rev=rd.file.revision;
 await pf('SUPERVISOR',{action:'physical_file_move',file_id:r1.file_id,revision:rev,to_location:'Shelf C, Box 1'});
 rd=await pf('MANAGER',{action:'physical_file_read',file_id:r1.file_id});assert.deepEqual([rd.file.status,rd.file.holder_id,rd.file.location],['In store',null,'Shelf C, Box 1'],'moved to a place with nobody holding it');
 assert.deepEqual(rd.movements.map(m=>m.kind),['Received','Moved','Moved']);assert.equal(rd.movements[1].to_holder,SUP);assert.equal(rd.movements[1].moved_by,undefined);assert.ok(rd.movements[1].moved_by_name);
 // the log is only added to
 await assert.rejects(()=>tx`update erp_private.physical_file_movements set note='edited' where file_id=${r1.file_id}`,/only added to/);
 await assert.rejects(()=>tx`delete from erp_private.physical_file_movements where file_id=${r1.file_id}`,/only added to/);
 // the screen cannot write a status or a reference directly
 await assert.rejects(q('MANAGER',`update erp_private.physical_files set status='Archived' where file_id=$1`,[r1.file_id]),/permission denied/);
 await assert.rejects(q('MANAGER',`update erp_private.physical_files set file_ref='PHY-1999-001' where file_id=$1`,[r1.file_id]),/permission denied/);
 await assert.rejects(q('MANAGER',`delete from erp_private.physical_files where file_id=$1`,[r1.file_id]),/permission denied|cannot be deleted|archived, not deleted|Historical/i);
 // pending dispatch, and the scanned-copy rule
 rev=rd.file.revision;
 await pf('SUPERVISOR',{action:'physical_file_pending',file_id:r1.file_id,revision:rev});
 rd=await pf('MANAGER',{action:'physical_file_read',file_id:r1.file_id});rev=rd.file.revision;assert.equal(rd.file.status,'Pending dispatch');
 await assert.rejects(pf('MANAGER',{action:'physical_file_pending',file_id:r1.file_id,revision:rev}),/already pending dispatch/);
 const ret={action:'physical_file_return',file_id:r1.file_id,revision:rev,dispatch_method:'Courier',dispatch_recipient:'Client driver, Mr Fictional',dispatch_reference:'Waybill 4471'};
 await assert.rejects(pf('MANAGER',ret),/Link the scanned copy, or record why there is none/);
 await assert.rejects(pf('MANAGER',{action:'physical_file_copy',file_id:r1.file_id,revision:rev}),/Choose the scanned document, or write why/);
 await assert.rejects(pf('MANAGER',{action:'physical_file_copy',file_id:r1.file_id,revision:rev,no_scan_reason:'too short'}),/at least 10 characters/);
 const doc=async(client,name)=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${client},${F},'PBC Documents',${name},${'k/'+d},1000,${'a'.repeat(64)},'application/pdf',${M})`;return d;};
 const dOther=await doc(Z2,'other-client.pdf'),dOk=await doc(Z,'bank-statements-scan.pdf');
 await assert.rejects(pf('MANAGER',{action:'physical_file_copy',file_id:r1.file_id,revision:rev,document_id:dOther}),/Link a document of this client and firm/);
 const offered=(await pf('MANAGER',{action:'physical_file_documents',client_id:Z,firm_id:F})).documents.map(x=>x.file_name);assert.deepEqual(offered,['bank-statements-scan.pdf'],'only this client\'s documents are offered');
 await pf('MANAGER',{action:'physical_file_copy',file_id:r1.file_id,revision:rev,document_id:dOk});
 rd=await pf('MANAGER',{action:'physical_file_read',file_id:r1.file_id});rev=rd.file.revision;assert.equal(rd.file.digital_name,'bank-statements-scan.pdf');
 // the ticket cannot be closed while the file is in the office
 const tr=(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets.find(x=>x.ticket_id===T);
 assert.equal(Number(tr.files_in_office),1);
 await assert.rejects(cs('MANAGER',{action:'client_support_close',ticket_id:T,revision:tr.revision,resolution:'Everything was done and checked.'}),/PHY-\d{4}-001 linked to this ticket has not been returned/);
 // the return needs method, recipient and reference
 await assert.rejects(pf('MANAGER',{...ret,revision:rev,dispatch_method:'Teleport'}),/Choose a valid option/);
 await assert.rejects(pf('MANAGER',{...ret,revision:rev,dispatch_recipient:''}),/Check the required text/);
 await assert.rejects(pf('MANAGER',{...ret,revision:rev,dispatch_reference:'  '}),/Check the required text/);
 await assert.rejects(pf('MANAGER',{action:'physical_file_dispatch_note',file_id:r1.file_id}),/only once the file has been returned/);
 await pf('MANAGER',{...ret,revision:rev});
 rd=await pf('MANAGER',{action:'physical_file_read',file_id:r1.file_id});
 assert.deepEqual([rd.file.status,rd.file.holder_id,rd.file.location],['Returned to client',null,'Returned to client']);
 const last=rd.movements.at(-1);assert.deepEqual([last.kind,last.dispatch_note_no,last.dispatch_method,last.dispatch_reference],['Returned to client',`DN-${year}-001`,'Courier','Waybill 4471']);
 // locked: no move, copy, pending or archive, and the database says the same
 for(const [action,extra] of [['physical_file_move',{to_location:'Shelf Z'}],['physical_file_pending',{}],['physical_file_archive',{to_location:'Archive 1'}],['physical_file_copy',{no_scan_reason:'Changed my mind later on'}]])
  await assert.rejects(pf('MANAGER',{action,file_id:r1.file_id,revision:rd.file.revision,...extra}),/locked/,action);
 await assert.rejects(q('MANAGER',`update erp_private.physical_files set no_scan_reason='A later change of mind' where file_id=$1`,[r1.file_id]),/locked/);
 // the dispatch note is a PDF with a signature block, and the same record gives the same bytes
 const n1=await pf('MANAGER',{action:'physical_file_dispatch_note',file_id:r1.file_id}),n2=await pf('PARTNER',{action:'physical_file_dispatch_note',file_id:r1.file_id});
 assert.equal(n1.mime_type,'application/pdf');assert.equal(n1.file_name,`DN_${year}_001.pdf`);assert.equal(Buffer.from(n1.base64,'base64').subarray(0,5).toString(),'%PDF-');assert.equal(n1.base64,n2.base64);
 // now the ticket can be closed
 await cs('MANAGER',{action:'client_support_close',ticket_id:T,revision:(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets.find(x=>x.ticket_id===T).revision,resolution:'Everything was done and checked.'});
 // a closed ticket takes no new file
 await assert.rejects(pf('MANAGER',{...reg,ticket_id:T}),/ticket is closed/);
 // the archive path: a shelf is required, and so is the scanned copy or a reason
 let r2d=await pf('MANAGER',{action:'physical_file_read',file_id:r2.file_id});
 await assert.rejects(pf('MANAGER',{action:'physical_file_archive',file_id:r2.file_id,revision:r2d.file.revision,to_location:'Archive shelf 2'}),/Link the scanned copy, or record why there is none/);
 await pf('MANAGER',{action:'physical_file_copy',file_id:r2.file_id,revision:r2d.file.revision,no_scan_reason:'Originals only; the client asked us not to scan.'});
 r2d=await pf('MANAGER',{action:'physical_file_read',file_id:r2.file_id});
 await assert.rejects(pf('MANAGER',{action:'physical_file_archive',file_id:r2.file_id,revision:r2d.file.revision}),/Check the required text/);
 await pf('MANAGER',{action:'physical_file_archive',file_id:r2.file_id,revision:r2d.file.revision,to_location:'Archive shelf 2, box 9'});
 r2d=await pf('MANAGER',{action:'physical_file_read',file_id:r2.file_id});
 assert.deepEqual([r2d.file.status,r2d.file.location],['Archived','Archive shelf 2, box 9']);
 await assert.rejects(pf('MANAGER',{action:'physical_file_move',file_id:r2.file_id,revision:r2d.file.revision,to_holder:SUP}),/archived and its record is locked|locked/);
 await assert.rejects(pf('MANAGER',{action:'physical_file_dispatch_note',file_id:r2.file_id}),/only once the file has been returned/);
 // the list: open files first, the locked ones after; filtered by client
 const list=(await pf('MANAGER',{action:'physical_file_list',client_id:Z})).files;assert.deepEqual(list.map(f=>f.file_ref).sort(),[`PHY-${year}-001`,`PHY-${year}-002`]);assert.equal((await pf('MANAGER',{action:'physical_file_list',client_id:Z2})).files.length,0);
 // a staff member with no access to the client sees none of its files
 await assert.deepEqual((await pf('ASSISTANT',{action:'physical_file_list'})).files,[],'row security follows client access');
 // interns see nothing
 await assert.rejects(pf('INTERN',{action:'physical_file_list'}),/does not handle/);
 assert.equal((await q('INTERN',`select count(*)::int n from erp_private.physical_files`))[0].n,0,'the database hides the register from an Intern too');
 // retention is not decided: no column stores a period
 const cols=(await tx`select column_name from information_schema.columns where table_schema='erp_private' and table_name in('physical_files','physical_file_movements')`).map(r=>r.column_name);
 assert.ok(!cols.some(c=>/retention|retain|destroy|dispose/i.test(c)),'no retention period is stored or enforced');
 // high-priority tickets not started within 24 hours are flagged (a default, not a firm rule)
 const hp=await cs('MANAGER',{action:'client_support_open',client_id:Z,firm_id:F,service_code:'GENERAL_QUERY',subject:'Urgent request from client',details:'Needs action now.',assigned_to:SUP,priority:'High',response_due_on:D(1),resolution_due_on:D(3)});
 let hl=(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets.find(x=>x.ticket_id===hp.ticket_id);assert.equal(hl.high_priority_stale,false,'a new ticket is not flagged');
 await db.exec('alter table erp_private.client_support_tickets disable trigger user');await tx`update erp_private.client_support_tickets set opened_at=now()-interval '30 hours' where ticket_id=${hp.ticket_id}`;await db.exec('alter table erp_private.client_support_tickets enable trigger user');
 hl=(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets.find(x=>x.ticket_id===hp.ticket_id);assert.equal(hl.high_priority_stale,true);
 await cs('MANAGER',{action:'client_support_update',ticket_id:hp.ticket_id,revision:hl.revision,status:'In progress'});
 hl=(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets.find(x=>x.ticket_id===hp.ticket_id);assert.equal(hl.high_priority_stale,false,'once it is in progress the flag goes');
});
