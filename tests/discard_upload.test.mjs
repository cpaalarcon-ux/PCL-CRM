import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {periodImportAction}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('Discard uploads: a saved summary can be discarded, and only human decisions lock an upload',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 assert.equal((await tx`select to_regclass('erp_private.purchase_ledger_items') as name`)[0].name,'erp_private.purchase_ledger_items');
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PLQA','Fictional ledger firm'),(${F2},'PLHIDDEN','Fictional hidden firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional purchase ledger client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional purchase project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional purchase capture')`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic accounting policy',${actors.MANAGER.staff_id})`;
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const call=(role,p)=>as(role,a=>purchaseLedgerAction(tx,a,{action:'purchase_ledger_read',project_id:P,...p}));
 await as('ASSISTANT',()=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Import Sources','Fictional.csv',${'qa/'+D},100,${'b'.repeat(64)},'text/csv',${actors.ASSISTANT.staff_id})`);
 assert.equal((await as('INTERN',()=>tx`select document_id from erp_private.documents where document_id=${D}`)).length,0);

 const sources=new Map();const storage={download:async key=>({data:new Blob([sources.get(key)])})};
 async function doc(name,body){const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))).toString('hex'),idd=id(),key='qa/'+idd;sources.set(key,body);await as('ASSISTANT',()=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${idd},${C},${F},${P},${T},'Import Sources',${name},${key},${body.length},${digest},'text/csv',${actors.ASSISTANT.staff_id})`);return idd;}
 const imp=(role,p)=>as(role,a=>periodImportAction(tx,a,{project_id:P,...p},storage));
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await db.exec('alter table erp_private.projects disable trigger user');await tx`update erp_private.projects set status='Active' where project_id=${P}`;await db.exec('alter table erp_private.projects enable trigger user');
 const salesCsv=(month,net,vat)=>[['Month','Sales category','Net sales','Output VAT','Gross amount','Credits','Credit notes net','Credit notes VAT'],...['16%','8%','0%','Exempt'].map(c=>[month,c,c==='16%'?net:0,c==='16%'?vat:0,c==='16%'?net+vat:0,0,0,0])].map(r=>r.join(',')).join('\n');
 const staffId=r=>actors[r].staff_id;
 const rec=async r=>(await tx`select * from erp_private.period_imports where import_id=${r.import_id}`)[0];
 const unchanged=async(role,fn)=>{try{return (await as(role,fn)).length===0;}catch{return true;}};
 await t.test('a saved sales summary can be discarded by its preparer or a leader, with a reason, and the same file can be saved again',async()=>{
  const src=await doc('Sales-Sep.csv',salesCsv('2026-09',1000,160));
  const base={action:'period_import_preview',kind:'Sales',document_id:src,starts_on:'2026-09-01',ends_on:'2026-09-30',credit_basis:'After credit notes',notes:'Fictional totals'};
  const pv=await imp('ASSISTANT',base);assert.deepEqual(pv.payload.issues,[]);
  const save=()=>imp('ASSISTANT',{...base,action:'period_import_save',preview_hash:pv.source_hash,confirmed_client_id:C,replaces_ids:[]});
  const s1=await rec(await save());assert.equal(s1.status,'Draft');
  const discard=(role,r,extra={})=>imp(role,{action:'period_import_discard',import_id:r.import_id,revision:r.revision,reason:'Wrong month uploaded',...extra});
  await assert.rejects(()=>discard('SUPERVISOR',s1),/preparer|Manager or a Partner/,'another staff member cannot discard it');
  await assert.rejects(()=>discard('ASSISTANT',s1,{reason:'no'}),/at least 5/);
  await assert.rejects(()=>discard('ASSISTANT',{...s1,revision:99}),/changed/);
  assert.equal((await tx`select status from erp_private.period_imports where import_id=${s1.import_id}`)[0].status,'Draft');
  const out=await discard('ASSISTANT',s1);assert.equal(out.ok,true);assert.equal(out.document_id,src);
  const row=(await tx`select status,discarded_by,discard_reason,discarded_at from erp_private.period_imports where import_id=${s1.import_id}`)[0];
  assert.equal(row.status,'Discarded');assert.equal(row.discarded_by,staffId('ASSISTANT'));assert.equal(row.discard_reason,'Wrong month uploaded');assert.ok(row.discarded_at);
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='PERIOD_IMPORT_DISCARDED' and record_key=${s1.import_id}`)[0].n,1);
  const curRev=(await rec(s1)).revision;
  await assert.rejects(()=>imp('ASSISTANT',{action:'period_import_discard',import_id:s1.import_id,revision:curRev,reason:'Again please'}),/already discarded|changed/);
  await assert.rejects(()=>db.query(`update erp_private.period_imports set status='Draft',discarded_at=null,discarded_by=null,discard_reason=null where import_id=$1`,[s1.import_id]),/immutable/,'a discarded record is frozen');
  const again=await imp('ASSISTANT',base);assert.ok(again.overlaps.every(o=>o.import_id!==s1.import_id),'a discarded summary is not an overlap');assert.deepEqual(again.payload.issues,[]);
  const saved2=await save(),s2=await rec(saved2);assert.notEqual(s2.import_id,s1.import_id);assert.ok(!saved2.reused);assert.equal(s2.status,'Draft');
  const out2=await discard('PARTNER',s2,{reason:'Partner correcting the draft'});assert.equal(out2.ok,true);
  assert.equal((await tx`select count(*)::int n from erp_private.period_imports where project_id=${P} and status<>'Discarded'`)[0].n,0);
 });
 await t.test('a submitted summary must be withdrawn first; a journal or tax computation blocks the discard',async()=>{
  const src=await doc('Sales-Oct.csv',salesCsv('2026-10',2000,320));
  const base={action:'period_import_preview',kind:'Sales',document_id:src,starts_on:'2026-10-01',ends_on:'2026-10-31',credit_basis:'After credit notes',notes:'Fictional totals'};
  const pv=await imp('ASSISTANT',base);assert.deepEqual(pv.payload.issues,[]);
  const s=await rec(await imp('ASSISTANT',{...base,action:'period_import_save',preview_hash:pv.source_hash,confirmed_client_id:C,replaces_ids:[]}));
  await imp('ASSISTANT',{action:'period_import_submit',import_id:s.import_id,revision:s.revision});
  const cur=(await tx`select revision from erp_private.period_imports where import_id=${s.import_id}`)[0];
  await assert.rejects(()=>imp('ASSISTANT',{action:'period_import_discard',import_id:s.import_id,revision:cur.revision,reason:'Wrong file chosen'}),/Withdraw this summary/);
  await db.exec('alter table erp_private.period_imports disable trigger user');await tx`update erp_private.period_imports set status='Draft' where import_id=${s.import_id}`;await db.exec('alter table erp_private.period_imports enable trigger user');
  const cur2=(await tx`select revision from erp_private.period_imports where import_id=${s.import_id}`)[0];
  await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,prepared_by,inputs) values(${P},'VAT','2026-10-01','2026-10-31',${staffId('ASSISTANT')},${tx.json({period_import_id:s.import_id})})`;
  await assert.rejects(()=>imp('ASSISTANT',{action:'period_import_discard',import_id:s.import_id,revision:cur2.revision,reason:'Wrong file chosen'}),/tax computation/);
 });
 await t.test('only a mapping a person confirmed, a tax review or a journal locks an upload; automatic mapping does not',async()=>{
  const codes=(await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code limit 1`)[0].code;
  async function upload(name,review,withReview=false){
   const d=await doc(name,'Date,Supplier\n2026-10-01,Fictional\n'),b=id();
   await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${b},${P},${d},${name},1,'Purchases','2026-10-01','2026-10-31','{}',1,1,0,0,${staffId('ASSISTANT')})`;
   const rid=(await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${b},${P},${C},'Purchases',2,${name},'{}','{}') returning row_id`)[0].row_id;
   if(review){await db.exec('alter table erp_private.workbook_rows disable trigger user');await tx`update erp_private.workbook_rows set route=2,account_code=${codes},category_code='X',review_details=${tx.json(review)} where row_id=${rid}`;await db.exec('alter table erp_private.workbook_rows enable trigger user');}
   if(withReview)await tx`insert into erp_private.tax_row_reviews(row_id,project_id,source_revision,decision,reason,reviewed_by) values(${rid},${P},1,'Eligible','Fictional review',${staffId('MANAGER')})`;
   return {d,b,rid};
  }
  const archiveDoc=(role,x)=>as(role,()=>tx`update erp_private.documents set archived_at=now(),archived_by=${staffId(role)},archive_reason='Wrong file uploaded' where document_id=${x.d} returning document_id`);
  const archiveBatch=(role,x)=>as(role,()=>tx`update erp_private.workbook_batches set archived_at=now(),archived_by=${staffId(role)},archive_reason='Wrong file uploaded' where batch_id=${x.b} returning batch_id`);
  const plain=await upload('plain.csv',null);
  const auto=await upload('auto.csv',{mapping_confirmation:{method:'Auto-mapped — chart verified',imported_by:staffId('ASSISTANT')}});
  const history=await upload('history.csv',{mapping_confirmation:{method:'Auto-mapped — supplier history',imported_by:staffId('ASSISTANT')}});
  const human=await upload('human.csv',{mapping_confirmation:{method:'Uploaded routing and TB codes',confirmed_by:staffId('SUPERVISOR')}});
  const manual=await upload('manual.csv',{});
  const reviewed=await upload('reviewed.csv',{mapping_confirmation:{method:'Auto-mapped — chart verified',imported_by:staffId('ASSISTANT')}},true);
  for(const x of [plain,auto,history]){assert.equal((await archiveDoc('ASSISTANT',x)).length,1,'the uploader can remove an upload nobody has confirmed');assert.equal((await archiveBatch('ASSISTANT',x)).length,1);}
  for(const [name,x] of [['human',human],['manual',manual],['reviewed',reviewed]]){
   assert.ok(await unchanged('ASSISTANT',()=>tx`update erp_private.documents set archived_at=now(),archived_by=${staffId('ASSISTANT')},archive_reason='Wrong file uploaded' where document_id=${x.d} returning document_id`),name+': the file stays');
   assert.ok(await unchanged('ASSISTANT',()=>tx`update erp_private.workbook_batches set archived_at=now(),archived_by=${staffId('ASSISTANT')},archive_reason='Wrong file uploaded' where batch_id=${x.b} returning batch_id`),name+': the batch stays');
   assert.equal((await archiveDoc('MANAGER',x)).length,1,name+': a Manager can archive it as a controlled correction');
  }
  assert.equal((await tx`select count(*)::int n from erp_private.workbook_rows where project_id=${P}`)[0].n,6,'no imported row is deleted');
 });
 await t.test('wiring: rights, buttons and the guide',()=>{
  const catalog=fs.readFileSync(root+'/staff-rights-catalog.mjs','utf8'),server=fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs','utf8');
  assert.equal(catalog,server);assert.match(catalog,/'period_import_discard'/);
  const imports=fs.readFileSync(root+'/staff-period-imports.mjs','utf8'),acc=fs.readFileSync(root+'/staff-accounting.mjs','utf8'),guide=fs.readFileSync(root+'/staff-guide-text.mjs','utf8');
  assert.match(imports,/Remove this upload/);assert.match(imports,/period_import_discard/);assert.match(imports,/Discard this summary/);
  assert.match(acc,/data-archive-source/);assert.match(acc,/remove a wrong upload/);
  assert.match(guide,/Uploaded the wrong file\?/);
 });
});
