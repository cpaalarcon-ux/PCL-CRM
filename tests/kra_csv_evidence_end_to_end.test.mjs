import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {kraCsvAction}=await import('../supabase/functions/staff-workspace-v12/kra-csv-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>kraCsvAction(tx,a,p));
test("KRA VAT CSV evidence: retained originals, versions, reconciliation to the registers, reviews",async t=>{
 t.after(()=>db.close());
 const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,storage));let workbookBytes;const storage={download:async()=>({data:new Blob([workbookBytes])})};
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${F2},'V3OTHER','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Fictional hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',205,205,0,0,${actors.ASSISTANT.staff_id})`;
 const IM=id();
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_imports(import_id,project_id,client_id,document_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by) values(${IM},${P},${C},${D},'Sales','ETIMS','LEGACY','2026-10-01','2026-10-31',${tx.json({groups:[{month:'2026-10',vat_category:'16%',net:3000,vat:480},{month:'2026-10',vat_category:'8%',net:0,vat:0},{month:'2026-10',vat_category:'0%',net:0,vat:0},{month:'2026-10',vat_category:'Exempt',net:0,vat:0}]})},${'h'+IM},'Confirmed',${actors.ASSISTANT.staff_id})`;
 await db.exec('set session_replication_role=origin');
 const prow=(key,inv,pin,amount,vat,cat)=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${Math.floor(Math.random()*1e6)},${key},'{}',${tx.json({date:'2026-10-06',invoice:inv,party:'Fictional supplier',party_pin:pin,amount,vat,vat_category:cat})})`;
 await prow('K1','0001','P000000001A',1000,160,'16%');await prow('K2','0002','P000000002B',500,80,'16%');await prow('K3','0003','P000000003C',300,48,'Unconfirmed');
 const rowB=(pin,date,inv,net,vat,orig='')=>[pin,'Fictional customer','CU1',date,inv,'Goods',net,vat,orig,''].join(',');
 const csvB1=[rowB('P051234567Z','03/10/2026','000123','1000.00','160.00'),rowB('P051234567Z','10/10/2026','000124','2000.00','320.00')].join('\n')+'\n';
 const up=(role,p)=>act(role,{action:'kra_csv_upload',project_id:P,month:'2026-10',...p});

 // Upload keeps the file exactly, with the leading zeros, and never touches the registers.
 const regBefore=JSON.stringify(await tx`select * from erp_private.period_imports order by import_id`);
 const v1=await up('ASSISTANT',{file_name:'PIN_SEC_B_WITH_VAT_PIN1.CSV',csv_text:csvB1});
 assert.equal(v1.version,1);assert.equal(v1.section,'B');assert.equal(v1.totals.net,3000);assert.equal(v1.line_count,2);
 assert.equal(JSON.stringify(await tx`select * from erp_private.period_imports order by import_id`),regBefore);
 const orig=await act('ASSISTANT',{action:'kra_csv_original',project_id:P,batch_id:v1.batch_id});assert.equal(orig.content_text,csvB1);assert.equal(orig.sha256,v1.sha256);
 assert.equal((await tx`select invoice_no from erp_private.kra_csv_lines where batch_id=${v1.batch_id} order by line_no`)[0].invoice_no,'000123');

 // Refusals: same file, replacement without a reason, wrong shape, unknown section, interns, wrong month text.
 await assert.rejects(()=>up('ASSISTANT',{file_name:'PIN_SEC_B_WITH_VAT_PIN1.CSV',csv_text:csvB1}),/already retained as version 1/);
 const csvB2=[rowB('P051234567Z','03/10/2026','000123','1000.00','160.00'),rowB('P051234567Z','10/10/2026','000124','2100.00','336.00'),rowB('P051234567Z','12/10/2026','000125','50.00','8.00')].join('\n')+'\n';
 await assert.rejects(()=>up('ASSISTANT',{file_name:'SEC_B.CSV',csv_text:csvB2}),/Say why this file replaces it/);
 await assert.rejects(()=>up('ASSISTANT',{file_name:'SEC_B.CSV',csv_text:'a,b\n'}),/10 columns/);
 await assert.rejects(()=>up('ASSISTANT',{file_name:'sales.csv',csv_text:csvB1}),/section could not be read/);
 await assert.rejects(()=>up('INTERN',{file_name:'SEC_B.CSV',csv_text:csvB2}),/staff with client access/);
 await assert.rejects(()=>act('ASSISTANT',{action:'kra_csv_read',project_id:P,month:'October'}),/YYYY-MM/);

 // Reconciliation: B differs from the register (3000 vs 3000 agrees at v1; the other sections are not uploaded, which is not zero).
 let read=await act('ASSISTANT',{action:'kra_csv_read',project_id:P,month:'2026-10'});
 assert.equal(read.sales.status,'Incomplete');assert.equal(read.sales.categories[0].status,'Agrees');assert.equal(read.sales.categories[1].status,'CSV not uploaded');assert.equal(read.sales.differences.length,0);

 // A corrected file is a new version that supersedes the old; the original stays; changes are shown.
 const v2=await up('ASSISTANT',{file_name:'SEC_B.CSV',csv_text:csvB2,supersede_reason:'KRA re-issued the section after a late credit.'});
 assert.equal(v2.version,2);assert.deepEqual(v2.changes,{from_version:1,to_version:2,added:1,removed:0,changed:1,unchanged:1});
 assert.equal((await tx`select count(*)::int as n from erp_private.kra_csv_batches where section='B'`)[0].n,2);
 assert.equal((await act('ASSISTANT',{action:'kra_csv_original',project_id:P,batch_id:v1.batch_id})).content_text,csvB1);
 read=await act('ASSISTANT',{action:'kra_csv_read',project_id:P,month:'2026-10'});
 assert.equal(read.sales.status,'Differs');const d=read.sales.differences[0];assert.equal(d.scope_key,'category:16%');assert.equal(d.difference_net,150);assert.equal(d.review,null);
 assert.equal(read.version_changes.B.changed_count,1);assert.equal(read.version_changes.B.added_count,1);assert.equal(read.version_changes.B.reason,'KRA re-issued the section after a late credit.');
 assert.equal(read.sections.find(s=>s.section==='B').current.version,2);

 // A review is recorded as history; Query raised does not clear it; Explained does; a stale decision is refused.
 await assert.rejects(()=>act('MANAGER',{action:'kra_csv_review',project_id:P,month:'2026-10',side:'Sales',scope_key:d.scope_key,evidence_key:'old',disposition:'Explained',reason:'Timing difference noted.'}),/changed or no longer exists/);
 await assert.rejects(()=>act('MANAGER',{action:'kra_csv_review',project_id:P,month:'2026-10',side:'Sales',scope_key:d.scope_key,evidence_key:d.evidence_key,disposition:'Explained',reason:'short'}),/at least 10/);
 await act('MANAGER',{action:'kra_csv_review',project_id:P,month:'2026-10',side:'Sales',scope_key:d.scope_key,evidence_key:d.evidence_key,disposition:'Query raised',reason:'Asked the client about invoice 000124.'});
 read=await act('ASSISTANT',{action:'kra_csv_read',project_id:P,month:'2026-10'});assert.equal(read.sales.open,1);assert.equal(read.sales.differences[0].review.disposition,'Query raised');
 await act('MANAGER',{action:'kra_csv_review',project_id:P,month:'2026-10',side:'Sales',scope_key:d.scope_key,evidence_key:d.evidence_key,disposition:'Explained',reason:'Client confirmed the late credit note.'});
 read=await act('ASSISTANT',{action:'kra_csv_read',project_id:P,month:'2026-10'});assert.equal(read.sales.open,0);assert.equal(read.sales.cleared,1);
 assert.equal((await tx`select count(*)::int as n from erp_private.kra_csv_reviews`)[0].n,2);

 // A newer CSV version changes the evidence, so the earlier decision no longer applies.
 const csvB3=csvB2+rowB('P051234567Z','14/10/2026','000126','10.00','1.60')+'\n';
 await up('ASSISTANT',{file_name:'SEC_B.CSV',csv_text:csvB3,supersede_reason:'Second re-issue from KRA.'});
 read=await act('ASSISTANT',{action:'kra_csv_read',project_id:P,month:'2026-10'});assert.equal(read.sales.open,1);assert.equal(read.sales.differences[0].review,null);

 // Purchases: matched by invoice and PIN; a missing classification and an unmatched line go to review; nothing is inferred.
 const rowF=(pin,inv,net,vat)=>['', pin,'Fictional supplier','05/10/2026',inv,'Goods','',net,vat,'',''].join(',');
 const csvF=[rowF('P000000001A','0001','1000.00','160.00'),rowF('P000000002B','0002','550.00','88.00'),rowF('P000000003C','0003','300.00','48.00'),rowF('P000000009Z','0009','70.00','11.20')].join('\n')+'\n';
 const f=await up('ASSISTANT',{file_name:'PIN_SEC_F_WITH_VAT.CSV',csv_text:csvF});assert.equal(f.section,'F');assert.equal(f.line_count,4);
 read=await act('ASSISTANT',{action:'kra_csv_read',project_id:P,month:'2026-10'});
 const kinds=read.purchases.differences.map(x=>x.kind+':'+x.invoice);
 assert.equal(read.purchases.matched,3);assert.ok(kinds.includes('Net amount differs:0002'));assert.ok(kinds.includes('VAT amount differs:0002'));assert.ok(kinds.includes('Classification missing on the supplier invoice:0003'));assert.ok(kinds.includes('In KRA CSV, no supplier invoice:0009'));
 assert.ok(!kinds.some(k=>/:0001$/.test(k)));
 assert.equal((await tx`select normalized->>'vat_category' as c from erp_private.workbook_rows where row_key='K3'`)[0].c,'Unconfirmed');

 // The evidence tables are insert-only and forced-RLS; versions cannot be skipped.
 await assert.rejects(()=>tx`update erp_private.kra_csv_batches set file_name='x'`,/never edited/);
 await assert.rejects(()=>tx`delete from erp_private.kra_csv_lines`,/./);
 await assert.rejects(()=>tx`update erp_private.kra_csv_reviews set reason='changed reason here'`,/never edited/);
 await assert.rejects(()=>tx`insert into erp_private.kra_csv_batches(client_id,project_id,side,section,period_month,version,supersedes_batch_id,supersede_reason,file_name,content_text,content_sha256,line_count,uploaded_by) values(${C},${P},'Sales','B','2026-10-01',9,${v1.batch_id},'skipping versions on purpose','x','x',${'a'.repeat(64)},0,${actors.ASSISTANT.staff_id})`,/supersede the latest version/);
 for(const tbl of ['kra_csv_batches','kra_csv_lines','kra_csv_reviews'])assert.deepEqual((await tx`select relrowsecurity,relforcerowsecurity from pg_class where oid=('erp_private.'||${tbl})::regclass`)[0],{relrowsecurity:true,relforcerowsecurity:true});
});
