import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {nonEtimsAction}=await import('../supabase/functions/staff-workspace-v12/non-etims-actions.ts');
const {taxSummary}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {findDuplicates,exceptionDetails,basisText,grossOf}=await import('../supabase/functions/staff-workspace-v12/non-etims-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const map=(role,p)=>as(role,a=>accountingAction(tx,a,p)),ne=(role,p)=>as(role,a=>nonEtimsAction(tx,a,{project_id:P,...p}));


test('Duplicate finder: same supplier, date and amount; same invoice; bank debits within three days',()=>{
 const row=(row_id,dataset,n,source_row=2)=>({row_id,dataset,source_row,normalized:n});
 const target=row('t','Non-eTIMS',{party:'Fictional Bank Ltd',date:'2026-09-10',amount:1000,vat:0,invoice:'FEE-1'});
 const found=findDuplicates(target,[
  row('a','Purchases',{party:'fictional  bank ltd',date:'2026-09-10',amount:862.07,vat:137.93,invoice:'X'}),   // same party/date, gross 1000
  row('b','Purchases',{party:'Fictional Bank Ltd',date:'2026-09-12',amount:1000,vat:0,invoice:'FEE-1'}),         // same invoice and party, other date
  row('c','Bank',{date:'2026-09-13',debit:1000}),                                                                   // 3 days: counts
  row('d','Bank',{date:'2026-09-14',debit:1000}),                                                                   // 4 days: too far
  row('e','Purchases',{party:'Other',date:'2026-09-10',amount:1000,vat:0,invoice:'Z'}),                            // other party
  row('t','Non-eTIMS',{party:'Fictional Bank Ltd',date:'2026-09-10',amount:1000,vat:0}),                             // itself
  {...row('s','Purchases',{party:'Fictional Bank Ltd',date:'2026-09-10',amount:1000,vat:0}),is_split_parent:true}]);
 assert.deepEqual(found.map(x=>x.row_id).sort(),['a','b','c']);
 assert.match(found.find(x=>x.row_id==='c').kind,/Bank payment/);assert.equal(grossOf(row('x','Purchases',{amount:100,vat:16})),116);
});
test('Exception details need a basis plus evidence, and a written reason to keep a possible duplicate',()=>{
 const basis={basis_code:'NE-BANKCHG',label:'Bank charge',legal_category:'Bank charge',legal_reference:'',status:'Testing'};
 assert.match(exceptionDetails(basis,{},null,{actor:'s',at:'now'}).error,/evidence/);
 const ok=exceptionDetails(basis,{evidence_reference:'Statement line 14'},null,{actor:'s',at:'now'}).details;
 assert.equal(ok.basis_code,'NE-BANKCHG');assert.equal(ok.evidence,'Statement line 14');assert.match(ok.legal_basis,/not yet approved/);assert.equal(ok.duplicate_override,undefined);
 const m=[{row_id:'a',dataset:'Purchases',source_row:5,kind:'Same supplier, date and amount'}];
 assert.match(exceptionDetails(basis,{evidence_reference:'abc'},null,{matches:m,actor:'s',at:'now'}).error,/duplicate/);
 assert.match(exceptionDetails(basis,{evidence_reference:'abc',duplicate_reason:'short'},null,{matches:m,actor:'s',at:'now'}).error,/at least 10/);
 const kept=exceptionDetails({...basis,legal_reference:'Verified source 12'},{evidence_reference:'abc',duplicate_reason:'Two separate monthly charges'},{document_id:'d1',file_name:'stmt.pdf'},{matches:m,actor:'s',at:'now'}).details;
 assert.equal(kept.evidence_document_id,'d1');assert.match(kept.evidence,/stmt\.pdf/);assert.equal(kept.duplicate_override.matches.length,1);assert.match(basisText({...basis,legal_reference:'Verified source 12'}),/Verified source 12/);
});

test('Non-eTIMS exceptions: approved bases, evidence, duplicate check, and the tax-review blocker',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const W=id();await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',5,5,0,0,${actors.ASSISTANT.staff_id})`;
 const row=async(key,dataset,n)=>{const r=await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},${dataset},${Math.floor(Math.random()*9000)+10},${key},'{}',${tx.json(n)}) returning row_id`;return r[0].row_id;};
 const get=key=>tx`select * from erp_private.workbook_rows where row_key=${key}`.then(r=>r[0]);
 await row('NE1','Non-eTIMS',{date:'2026-09-10',amount:1000,vat:0,invoice:'FEE-1',party:'Fictional Bank Ltd',description:'Account fee'});
 await row('NE2','Non-eTIMS',{date:'2026-09-15',amount:777,vat:0,invoice:'FEE-2',party:'Fictional Courier',description:'Courier'});
 await row('DUP','Purchases',{date:'2026-09-10',amount:862.07,vat:137.93,invoice:'ETIMS-9',party:'Fictional Bank Ltd'});
 await row('BANK','Bank',{date:'2026-09-11',debit:1000,credit:0,reference:'Fictional fee debit'});
 const doc=(await tx`select document_id,file_name from erp_private.documents where document_id=${D}`)[0];
 const mapNe=(role,key,p)=>get(key).then(r=>map(role,{action:'workbook_map',project_id:P,row_id:r.row_id,revision:r.revision,route:2,category:'EXP08',account_code:'62500',...p}));

 await t.test('the nine workbook categories are seeded in testing, with no legal reference invented',async()=>{
  const r=await ne('ASSISTANT',{action:'non_etims_bases'});
  assert.equal(r.bases.length,9);assert.ok(r.bases.every(b=>b.status==='Testing'&&b.legal_reference===''));assert.equal(r.can_approve,false);assert.equal(r.can_edit,false);
  assert.equal((await ne('PARTNER',{action:'non_etims_bases'})).can_approve,true);
 });
 await t.test('rights: only a Manager or Partner adds a basis; only a Partner approves or retires; the preparer cannot approve it',async()=>{
  const mk=(code)=>({action:'non_etims_basis_save',basis_code:code,legal_category:'Import',label:'Import with customs entry',guidance:'Customs entry',legal_reference:''});
  await assert.rejects(()=>ne('ASSISTANT',mk('NE-TEST')),/Partner or Manager/);
  await ne('MANAGER',mk('NE-TEST'));
  await assert.rejects(()=>ne('MANAGER',mk('NE-TEST')),/already exists/);
  await assert.rejects(()=>ne('MANAGER',{...mk('bad code!')}),/capital letters/);
  const b=(await ne('MANAGER',{action:'non_etims_bases'})).bases.find(x=>x.basis_code==='NE-TEST');
  await assert.rejects(()=>ne('MANAGER',{action:'non_etims_basis_approve',basis_id:b.basis_id,revision:b.revision,legal_reference:'Verified reference 1',confirm_verified:true}),/Only a Partner/);
  await ne('MANAGER',{action:'non_etims_basis_save',basis_id:b.basis_id,revision:b.revision,legal_category:'Import',label:'Import with customs entry and invoice',guidance:'x',legal_reference:'draft'});
  await assert.rejects(()=>ne('MANAGER',{action:'non_etims_basis_save',basis_id:b.basis_id,revision:b.revision,legal_category:'Import',label:'Stale edit',guidance:'',legal_reference:''}),/changed/);
  const fresh=(await ne('PARTNER',{action:'non_etims_bases'})).bases.find(x=>x.basis_code==='NE-TEST');
  await ne('PARTNER',{action:'non_etims_basis_approve',basis_id:fresh.basis_id,revision:fresh.revision,legal_reference:'Verified reference 1',confirm_verified:true});
 assert.equal((await ne('PARTNER',{action:'non_etims_bases'})).bases.find(x=>x.basis_code==='NE-TEST').status,'Active');
 });
 await t.test('a Partner approves a seeded basis only with a legal reference and confirmation; approved wording is then fixed',async()=>{
  let list=(await ne('PARTNER',{action:'non_etims_bases'})).bases;const bank=list.find(x=>x.basis_code==='NE-BANKCHG');
  await assert.rejects(()=>ne('PARTNER',{action:'non_etims_basis_approve',basis_id:bank.basis_id,revision:bank.revision,legal_reference:'short',confirm_verified:true}),/at least 10/);
  await assert.rejects(()=>ne('PARTNER',{action:'non_etims_basis_approve',basis_id:bank.basis_id,revision:bank.revision,legal_reference:'Verified reference 2',confirm_verified:false}),/Confirm that you verified/);
  await ne('PARTNER',{action:'non_etims_basis_approve',basis_id:bank.basis_id,revision:bank.revision,legal_reference:'Verified reference 2',confirm_verified:true});
  list=(await ne('PARTNER',{action:'non_etims_bases'})).bases;const now=list.find(x=>x.basis_code==='NE-BANKCHG');
  assert.equal(now.status,'Active');assert.equal(now.legal_reference,'Verified reference 2');assert.ok(now.approved_at);
  await assert.rejects(()=>ne('MANAGER',{action:'non_etims_basis_save',basis_id:now.basis_id,revision:now.revision,legal_category:'Bank charge',label:'Changed',guidance:'',legal_reference:'Other'}),/Only a basis in Testing/);
  await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.non_etims_bases set label='Sneaky edit' where basis_code='NE-BANKCHG'`),/cannot be edited/);
  await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.non_etims_bases set status='Testing' where basis_code='NE-BANKCHG'`),/cannot go back/);
  await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.non_etims_bases where basis_code='NE-BANKCHG'`),/permission denied/);
  assert.ok((await tx`select count(*)::int n from erp_private.audit_events where table_name='non_etims_bases'`)[0].n>=2);
 });
 await t.test('duplicate check lists the other purchase and the bank debit, for the row concerned only',async()=>{
  const ne1=await get('NE1'),ne2=await get('NE2');
  const r=await ne('ASSISTANT',{action:'non_etims_check',row_ids:[ne1.row_id,ne2.row_id]});
  assert.deepEqual(Object.keys(r.duplicates),[ne1.row_id]);assert.deepEqual(r.duplicates[ne1.row_id].map(x=>x.dataset).sort(),['Bank','Purchases']);
  await assert.rejects(()=>ne('ASSISTANT',{action:'non_etims_check',row_ids:[]}),/Select 1/);
 });
 await t.test('mapping: free text is refused; evidence is required; a possible duplicate needs a reason; the details are stored',async()=>{
  await assert.rejects(()=>mapNe('ASSISTANT','NE1',{legal_basis:'Because it is a bank fee',evidence:'Receipt'}),/Choose a legal basis from the list/);
  await assert.rejects(()=>mapNe('ASSISTANT','NE2',{basis_code:'NE-NOPE',evidence_reference:'Receipt 1'}),/Choose a legal basis/);
  await assert.rejects(()=>mapNe('ASSISTANT','NE2',{basis_code:'NE-FIFEE'}),/evidence/);
  await assert.rejects(()=>mapNe('ASSISTANT','NE2',{basis_code:'NE-FIFEE',evidence_document_id:crypto.randomUUID()}),/unavailable/);
  await assert.rejects(()=>mapNe('ASSISTANT','NE2',{basis_code:'NE-FIFEE',legal_category:'Interest',evidence_reference:'Receipt 1'}),/does not match/);
  await mapNe('ASSISTANT','NE2',{basis_code:'NE-FIFEE',legal_category:'Financial-institution fee',evidence_document_id:doc.document_id,evidence_reference:'Slip 5'});
  const two=await get('NE2');assert.equal(two.review_details.basis_code,'NE-FIFEE');assert.equal(two.review_details.evidence_document_id,doc.document_id);assert.ok(two.review_details.evidence.includes(doc.file_name));assert.match(two.review_details.legal_basis,/NE-FIFEE/);assert.equal(two.review_details.duplicate_override,undefined);
  await assert.rejects(()=>mapNe('ASSISTANT','NE1',{basis_code:'NE-BANKCHG',evidence_reference:'Statement line 14'}),/looks like a duplicate/);
  await assert.rejects(()=>mapNe('ASSISTANT','NE1',{basis_code:'NE-BANKCHG',evidence_reference:'Statement line 14',duplicate_reason:'too short'}),/at least 10/);
  assert.equal((await get('NE1')).account_code,null,'nothing was saved by the refusals');
  await mapNe('ASSISTANT','NE1',{basis_code:'NE-BANKCHG',evidence_reference:'Statement line 14',duplicate_reason:'Monthly fee; the other row is a different supplier invoice'});
  const one=await get('NE1');assert.equal(one.account_code,'62500');assert.equal(one.review_details.basis_status,'Active');assert.equal(one.review_details.duplicate_override.by,actors.ASSISTANT.staff_id);assert.equal(one.review_details.duplicate_override.matches.length,2);
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='NON_ETIMS_DUPLICATE_OVERRIDE'`)[0].n,1);
 });
 await t.test('tax review is blocked while a row rests on a basis that is not approved, and clears once a Partner approves it',async()=>{
  const summary=async()=>{const old=globalThis.Deno;globalThis.Deno={env:{get:()=>'https://yfjiculexbzpkvtapudk.supabase.co'}};try{return await as('ASSISTANT',()=>taxSummary(tx,{case_id:id(),project_id:P,kind:'VAT',status:'Draft',starts_on:'2026-09-01',ends_on:'2026-09-30',inputs:{}}));}finally{globalThis.Deno=old;}};
  const issue=s=>s.issues.find(x=>/legal basis a Partner has not approved/.test(x));
  let s=await summary();assert.ok(issue(s),'NE2 rests on a basis still in testing');assert.match(issue(s),/1 non-eTIMS row/);assert.match(issue(s),/net KES 777\.00/);
  const fi=(await ne('PARTNER',{action:'non_etims_bases'})).bases.find(x=>x.basis_code==='NE-FIFEE');
  await ne('PARTNER',{action:'non_etims_basis_approve',basis_id:fi.basis_id,revision:fi.revision,legal_reference:'Verified reference 3',confirm_verified:true});
  assert.equal(issue(await summary()),undefined,'both rows are now on approved bases');
 });
 await t.test('retiring: a Partner with a reason; earlier rows keep the basis, new rows cannot choose it, and review flags the old rows',async()=>{
  const bank=(await ne('PARTNER',{action:'non_etims_bases'})).bases.find(x=>x.basis_code==='NE-BANKCHG');
  await assert.rejects(()=>ne('MANAGER',{action:'non_etims_basis_retire',basis_id:bank.basis_id,revision:bank.revision,reason:'No longer relied on'}),/Only a Partner/);
  await assert.rejects(()=>ne('PARTNER',{action:'non_etims_basis_retire',basis_id:bank.basis_id,revision:bank.revision,reason:'short'}),/at least 10/);
  await ne('PARTNER',{action:'non_etims_basis_retire',basis_id:bank.basis_id,revision:bank.revision,reason:'Replaced by a narrower basis'});
  const now=(await ne('PARTNER',{action:'non_etims_bases'})).bases.find(x=>x.basis_code==='NE-BANKCHG');assert.equal(now.status,'Retired');assert.equal(now.used,1);
  await assert.rejects(()=>mapNe('ASSISTANT','NE2',{basis_code:'NE-BANKCHG',evidence_reference:'Slip'}),/retired/);
  assert.equal((await get('NE1')).review_details.basis_code,'NE-BANKCHG');
  {const o=globalThis.Deno;globalThis.Deno={env:{get:()=>'https://yfjiculexbzpkvtapudk.supabase.co'}};try{const sum=await as('ASSISTANT',()=>taxSummary(tx,{case_id:id(),project_id:P,kind:'VAT',status:'Draft',starts_on:'2026-09-01',ends_on:'2026-09-30',inputs:{}}));assert.match(sum.issues.find(x=>/legal basis a Partner has not approved/.test(x))||'',/1 non-eTIMS row.*retired/);}finally{globalThis.Deno=o;}}
  await assert.rejects(()=>ne('PARTNER',{action:'non_etims_basis_retire',basis_id:bank.basis_id,revision:now.revision,reason:'Retire it again please'}),/already retired/);
 });
 await t.test('wiring: rights, screens and cache tags',()=>{
  const cat=fs.readFileSync(root+'/staff-rights-catalog.mjs','utf8');
  assert.match(cat,/acct\.non_etims_bases[\s\S]*non_etims_basis_approve/);assert.match(cat,/'non_etims_check'/);
  assert.equal(cat,fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs','utf8'));
  assert.match(fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/staff-access-control.mjs','utf8'),/non_etims_/);
  const ui=fs.readFileSync(root+'/staff-non-etims.mjs','utf8');
  for(const k of ['non_etims_bases','non_etims_check','non_etims_basis_approve','non_etims_basis_retire','non_etims_basis_save','duplicate_reason','evidence_document_id'])assert.match(ui,new RegExp(k));
  assert.match(fs.readFileSync(root+'/staff-accounting.mjs','utf8'),/id=\\"neException\\"|id="neException"/);
  assert.match(fs.readFileSync(root+'/staff-tax-config.mjs','utf8'),/ne-bases/);
 });
});
