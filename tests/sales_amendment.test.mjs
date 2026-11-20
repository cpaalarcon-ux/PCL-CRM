import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {periodImportAction}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {salesAmendAction}=await import('../supabase/functions/staff-workspace-v12/sales-amend-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('Amend a confirmed sales period: approval, reversal, replacement',async t=>{
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
 await readyForLedger(tx,C);
 const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,{project_id:P,...p},storage));
 const amend=(role,p)=>as(role,a=>salesAmendAction(tx,a,{project_id:P,...p}));
 const setup=await ledger('MANAGER',{action:'ledger_period_create',starts_on:'2026-01-01',ends_on:'2026-12-31'}),LP={period_id:setup.period_id};
 const status=async x=>(await tx`select status from erp_private.period_imports where import_id=${x}`)[0].status;
 const amStatus=async x=>(await tx`select status from erp_private.import_amendments where amendment_id=${x}`)[0].status;
 const jread=async j=>await ledger('ASSISTANT',{...LP,action:'ledger_journal_read',journal_id:j});
 const post=async(prep,j,poster='PARTNER')=>{let r=await jread(j);await ledger(prep,{...LP,action:'ledger_journal_submit',journal_id:j,revision:r.journal.revision});await checkJournal(tx,j);r=await jread(j);await ledger(poster,{...LP,action:'ledger_journal_review',journal_id:j,revision:r.journal.revision,status:'Posted',review_note:'Fictional independent review of the sales entry.'});};
 // A saved sales summary, optionally posted to the ledger (then it is confirmed by the posting review) or confirmed for tax use only.
 async function confirmed(month,net,vat,{ledgerEntry=true}={}){
  const [y,m]=month.split('-'),last=new Date(Date.UTC(+y,+m,0)).getUTCDate();
  const src=await doc('Sales-'+month+'-'+net+'.csv',salesCsv(month,net,vat));
  const base={action:'period_import_preview',kind:'Sales',document_id:src,starts_on:month+'-01',ends_on:month+'-'+String(last).padStart(2,'0'),credit_basis:'After credit notes',notes:'Fictional totals'};
  const pv=await imp('ASSISTANT',base);assert.deepEqual(pv.payload.issues,[]);
  const saved=await imp('ASSISTANT',{...base,action:'period_import_save',preview_hash:pv.source_hash,confirmed_client_id:C,replaces_ids:[]});
  let r=(await tx`select * from erp_private.period_imports where import_id=${saved.import_id}`)[0];
  await imp('ASSISTANT',{action:'period_import_submit',import_id:r.import_id,revision:r.revision});
  if(ledgerEntry){const j=await ledger('ASSISTANT',{action:'ledger_period_import_create',...LP,import_id:r.import_id});await post('ASSISTANT',j.journal_id);}
  else{r=(await tx`select * from erp_private.period_imports where import_id=${r.import_id}`)[0];await imp('MANAGER',{action:'period_import_review',import_id:r.import_id,revision:r.revision,status:'Confirmed',review_note:'Fictional independent review of the sales summary.'});}
  assert.equal(await status(r.import_id),'Confirmed');return {import_id:r.import_id,base};
 }
 async function corrected(month,net,vat,replaces){
  const [y,m]=month.split('-'),last=new Date(Date.UTC(+y,+m,0)).getUTCDate(),src=await doc('Sales-'+month+'-fix-'+net+'.csv',salesCsv(month,net,vat));
  const base={action:'period_import_preview',kind:'Sales',document_id:src,starts_on:month+'-01',ends_on:month+'-'+String(last).padStart(2,'0'),credit_basis:'After credit notes',notes:'Fictional corrected totals'};
  const pv=await imp('ASSISTANT',base);assert.deepEqual(pv.payload.issues,[]);
  return ()=>imp('ASSISTANT',{...base,action:'period_import_save',preview_hash:pv.source_hash,confirmed_client_id:C,replaces_ids:replaces});
 }
 const confirmNew=async id=>{let r=(await tx`select * from erp_private.period_imports where import_id=${id}`)[0];await imp('ASSISTANT',{action:'period_import_submit',import_id:id,revision:r.revision});r=(await tx`select * from erp_private.period_imports where import_id=${id}`)[0];await imp('MANAGER',{action:'period_import_review',import_id:id,revision:r.revision,status:'Confirmed',review_note:'Fictional independent review of the corrected summary.'});};

 await t.test('a posted, confirmed summary is amended only through request, approval, reversal and a confirmed replacement',async()=>{
  const old=await confirmed('2026-09',1000,160);
  // Nobody can simply overwrite it.
  await assert.rejects(async()=>(await corrected('2026-09',900,144,[old.import_id]))(),/accounting entry|approved amendment/);
  await assert.rejects(()=>amend('INTERN',{action:'sales_amend_request',import_id:old.import_id,outcome:'Replace',reason_type:'Wrong amounts',reason:'Totals were typed wrongly'}),/Interns/);
  await assert.rejects(()=>amend('ASSISTANT',{action:'sales_amend_request',import_id:old.import_id,outcome:'Replace',reason_type:'Wrong amounts',reason:'short'}),/at least 10/);
  const req=await amend('ASSISTANT',{action:'sales_amend_request',import_id:old.import_id,outcome:'Replace',reason_type:'Wrong amounts',reason:'Net sales were typed wrongly in the source file'});
  const A=req.amendment.amendment_id;assert.equal(req.amendment.status,'Requested');assert.equal(req.amendment.original_totals.gross,1160);
  await assert.rejects(()=>amend('MANAGER',{action:'sales_amend_request',import_id:old.import_id,outcome:'Replace',reason_type:'Wrong amounts',reason:'A second request for the same summary'}),/already open/);
  // cancel and ask again
  await amend('ASSISTANT',{action:'sales_amend_cancel',amendment_id:A,revision:req.amendment.revision});assert.equal(await amStatus(A),'Cancelled');
  const req2=await amend('ASSISTANT',{action:'sales_amend_request',import_id:old.import_id,outcome:'Replace',reason_type:'Wrong amounts',reason:'Net sales were typed wrongly in the source file'});
  const B=req2.amendment.amendment_id,rev=()=>tx`select revision from erp_private.import_amendments where amendment_id=${B}`.then(r=>r[0].revision);
  // approval: a preparer cannot decide, a note is required
  await assert.rejects(async()=>amend('ASSISTANT',{action:'sales_amend_decide',amendment_id:B,revision:await rev(),decision:'Approved',note:'I approve my own request'}),/Manager or Partner/);
  await assert.rejects(async()=>amend('MANAGER',{action:'sales_amend_decide',amendment_id:B,revision:await rev(),decision:'Approved',note:'short'}),/at least 10/);
  await assert.rejects(async()=>amend('MANAGER',{action:'sales_amend_prepare',amendment_id:B,revision:await rev()}),/Only an approved/);
  await amend('MANAGER',{action:'sales_amend_decide',amendment_id:B,revision:await rev(),decision:'Approved',note:'Checked the source file against the till totals.'});
  assert.equal(await amStatus(B),'Approved');
  // reversals are prepared by a leader; the entry cannot be rebuilt meanwhile
  await assert.rejects(async()=>amend('ASSISTANT',{action:'sales_amend_prepare',amendment_id:B,revision:await rev()}),/Manager or Partner/);
  const prep=await amend('MANAGER',{action:'sales_amend_prepare',amendment_id:B,revision:await rev()});
  assert.equal(prep.amendment.status,'Reversing');assert.equal(prep.reversals.length,1);
  await assert.rejects(()=>ledger('ASSISTANT',{action:'ledger_period_import_create',...LP,import_id:old.import_id}),/being amended/);
  // still blocked until the reversal is posted
  await assert.rejects(async()=>(await corrected('2026-09',900,144,[old.import_id]))(),/accounting entry/);
  const RJ=prep.reversals[0].reversal_id;let rj=await jread(RJ);
  await ledger('MANAGER',{...LP,action:'ledger_journal_submit',journal_id:RJ,revision:rj.journal.revision});await checkJournal(tx,RJ);rj=await jread(RJ);
  await assert.rejects(()=>ledger('MANAGER',{...LP,action:'ledger_journal_review',journal_id:RJ,revision:rj.journal.revision,status:'Posted',review_note:'The Manager who prepared it tries to post it'}),/./);
  await ledger('PARTNER',{...LP,action:'ledger_journal_review',journal_id:RJ,revision:rj.journal.revision,status:'Posted',review_note:'Fictional independent review of the reversal.'});
  const ready=await amend('ASSISTANT',{action:'sales_amend_read',import_id:old.import_id});
  assert.equal(ready.amendments[0].amendment.status,'Ready');
  // the corrected summary replaces it, and the replacement is confirmed independently
  const save=await corrected('2026-09',900,144,[old.import_id]),fresh=await save();
  assert.equal(await amStatus(B),'Replacement saved');
  await confirmNew(fresh.import_id);
  assert.equal(await status(old.import_id),'Superseded');assert.equal(await status(fresh.import_id),'Confirmed');assert.equal(await amStatus(B),'Complete');
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action like 'SALES_AMENDMENT_%'`)[0].n>=5,true);
 });

 await t.test('a confirmed summary with no ledger entry still needs an approved amendment, and discarding the replacement reopens it',async()=>{
  const old=await confirmed('2026-07',500,80,{ledgerEntry:false});
  await assert.rejects(async()=>(await corrected('2026-07',450,72,[old.import_id]))(),/approved amendment/);
  const req=await amend('MANAGER',{action:'sales_amend_request',import_id:old.import_id,outcome:'Replace',reason_type:'Wrong file',reason:'The wrong month export was used for this summary'});
  const A=req.amendment.amendment_id,rev=()=>tx`select revision from erp_private.import_amendments where amendment_id=${A}`.then(r=>r[0].revision);
  await assert.rejects(async()=>amend('MANAGER',{action:'sales_amend_decide',amendment_id:A,revision:await rev(),decision:'Approved',note:'Approving my own request here'}),/different Manager or Partner/);
  await amend('PARTNER',{action:'sales_amend_decide',amendment_id:A,revision:await rev(),decision:'Approved',note:'Reason accepted after checking the export date.'});
  assert.equal((await amend('MANAGER',{action:'sales_amend_prepare',amendment_id:A,revision:await rev()})).amendment.status,'Ready');
  const fresh=await (await corrected('2026-07',450,72,[old.import_id]))();assert.equal(await amStatus(A),'Replacement saved');
  const r=(await tx`select * from erp_private.period_imports where import_id=${fresh.import_id}`)[0];
  await imp('ASSISTANT',{action:'period_import_discard',import_id:fresh.import_id,revision:r.revision,reason:'Typed the wrong figure again'});
  assert.equal(await amStatus(A),'Ready');
  const again=await (await corrected('2026-07',455,72.8,[old.import_id]))();assert.equal(await amStatus(A),'Replacement saved');
  await confirmNew(again.import_id);assert.equal(await amStatus(A),'Complete');assert.equal(await status(old.import_id),'Superseded');
 });

 await t.test('a summary entered for the wrong month is withdrawn after reversal, freeing the dates',async()=>{
  const old=await confirmed('2026-08',700,112);
  const req=await amend('ASSISTANT',{action:'sales_amend_request',import_id:old.import_id,outcome:'Withdraw',reason_type:'Wrong month',reason:'This is the September file entered as August'});
  const A=req.amendment.amendment_id,rev=()=>tx`select revision from erp_private.import_amendments where amendment_id=${A}`.then(r=>r[0].revision);
  await amend('PARTNER',{action:'sales_amend_reject_probe',amendment_id:A,revision:await rev()}).catch(e=>assert.match(e.message,/Unknown amendment action/));
  await amend('PARTNER',{action:'sales_amend_decide',amendment_id:A,revision:await rev(),decision:'Approved',note:'Confirmed against the original export dates.'});
  const prep=await amend('MANAGER',{action:'sales_amend_prepare',amendment_id:A,revision:await rev()});
  await assert.rejects(async()=>amend('MANAGER',{action:'sales_amend_complete',amendment_id:A,revision:await rev()}),/not posted yet/);
  await post('MANAGER',prep.reversals[0].reversal_id,'PARTNER');
  await assert.rejects(async()=>amend('ASSISTANT',{action:'sales_amend_complete',amendment_id:A,revision:await rev()}),/Manager or Partner/);
  const done=await amend('MANAGER',{action:'sales_amend_complete',amendment_id:A,revision:await rev()});
  assert.equal(done.amendment.status,'Complete');assert.equal(await status(old.import_id),'Superseded');
  const src=await doc('Sales-Aug-correct.csv',salesCsv('2026-08',650,104)),base={action:'period_import_preview',kind:'Sales',document_id:src,starts_on:'2026-08-01',ends_on:'2026-08-31',credit_basis:'After credit notes',notes:'Fictional correct totals'};
  const pv=await imp('ASSISTANT',base);assert.equal((await imp('ASSISTANT',{...base,action:'period_import_save',preview_hash:pv.source_hash,confirmed_client_id:C,replaces_ids:[]})).import_id.length>10,true);
 });
});
