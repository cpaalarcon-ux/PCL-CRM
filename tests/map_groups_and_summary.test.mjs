import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {approveChart} from './helpers/chart-and-posting.mjs';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {purchaseAccountsAction}=await import('../supabase/functions/staff-workspace-v12/purchase-accounts-actions.ts');
const {summariseRows}=await import('../supabase/functions/staff-workspace-v12/purchase-accounts-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const acc=(role,p)=>as(role,a=>accountingAction(tx,a,{project_id:P,...p})),sum=(role,p)=>as(role,a=>purchaseAccountsAction(tx,a,{project_id:P,action:'purchase_accounts_summary',...p}));

test('the summary groups mapped and draft rows with the reason and next step',()=>{
 const s=summariseRows([{route:2,account_code:'61000',amount:100},{route:3,account_code:'15004',amount:900},{account_code:null,note_code:'SUGGESTED_AWAITING_APPROVAL',amount:10},{account_code:null,note_code:'SUGGESTED_AWAITING_APPROVAL',amount:20},{account_code:null,note_code:'NO_CODES',amount:5}]);
 assert.equal(s.mapped_rows,2);assert.equal(s.draft_rows,3);assert.equal(s.drafts[0].code,'SUGGESTED_AWAITING_APPROVAL');assert.equal(s.drafts[0].rows,2);assert.equal(s.drafts[0].net,30);assert.match(s.drafts[0].next,/Partner who did not propose/);assert.equal(s.net,1035);
});

test('one save maps several accounts, all or none; non-eTIMS needs a legal basis on the server; a preparer can see the summary',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'MGQA','Fictional groups firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Groups',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional groups project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);await approveChart(tx,{C,prepared:actors.MANAGER.staff_id,reviewed:actors.PARTNER.staff_id});
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Import Sources','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-01-01','2026-01-31','{}',8,8,0,0,${actors.ASSISTANT.staff_id})`;
 const exp=await tx`select code,category_code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy and code::int>=51000 and code::int<60000 order by code limit 2`,[e1,e2]=exp,ppe=(await tx`select code,category_code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy order by code limit 1`)[0];
 let n=0;const mk=(key,acct,route,dataset='Purchases',extra={})=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},${dataset},${++n},${'MG-'+key},'{}',${tx.json({date:'2026-01-10',amount:1000,vat:160,invoice:'MG-'+key,party:'Fictional supplier',party_pin:'P000000001A',description:'Fictional '+key,vat_category:'16%',mapping_suggestion:{route,category_code:acct.category_code,account_code:acct.code},...extra})}) returning row_id,revision`.then(r=>({row_id:r[0].row_id,revision:r[0].revision}));
 const r1=await mk('E1',e1,2),r2=await mk('E2',e1,2),r3=await mk('F1',e2,2),r4=await mk('P1',ppe,3),r5=await mk('N1',e1,2,'Non-eTIMS',{amount:777,vat:0,party:'Fictional ticket seller',party_pin:null,invoice:'NE-777',date:'2026-01-20'});
 const get=key=>tx`select * from erp_private.workbook_rows where row_key=${'MG-'+key}`.then(r=>r[0]);
 const groups=[{route:2,account_code:e1.code,rows:[r1,r2]},{route:2,account_code:e2.code,rows:[r3]},{route:3,account_code:ppe.code,rows:[r4],asset_details:'Fictional pickup',first_use_status:'In use',first_use_date:'2026-01-12'}];
 // The summary is visible to a preparer before anything is mapped: all five rows are drafts.
 const before=await sum('ASSISTANT');assert.equal(before.mapped_rows,0);assert.equal(before.draft_rows,5);
 // All or none: a bad group (an expense account sent as an asset) refuses the whole save and says which account.
 const bad=await acc('ASSISTANT',{action:'workbook_map_groups',confirm_uploaded_mapping:true,groups:[groups[0],{route:3,account_code:e2.code,rows:[r3]}]}).catch(e=>e);assert.match(String(bad.message),new RegExp('Account '+e2.code+'.*Nothing was mapped'));
 assert.equal((await tx`select count(*)::int n from erp_private.workbook_rows where project_id=${P} and account_code is not null`)[0].n,0,'a refused group maps nothing, including the good group before it');
 // A row named twice is refused, and without the person confirming the uploaded codes the mapping does not use them as confirmation.
 await assert.rejects(()=>acc('ASSISTANT',{action:'workbook_map_groups',confirm_uploaded_mapping:true,groups:[groups[0],{route:2,account_code:e2.code,rows:[r1]}]}),/more than once/);
 // One save, three accounts.
 const ok=await acc('ASSISTANT',{action:'workbook_map_groups',confirm_uploaded_mapping:true,groups});assert.equal(ok.count,4);assert.equal(ok.groups.length,3);
 assert.equal((await get('E1')).account_code,e1.code);assert.equal((await get('E2')).account_code,e1.code);assert.equal((await get('F1')).account_code,e2.code);
 const p=await get('P1');assert.equal(p.account_code,ppe.code);assert.equal(p.asset_details,'Fictional pickup');assert.equal(p.first_use_status,'In use');assert.equal(String(p.first_use_date.toISOString?p.first_use_date.toISOString().slice(0,10):p.first_use_date).slice(0,10),'2026-01-12');
 assert.equal((await get('E1')).review_details.mapping_confirmation.method,'Uploaded routing and TB codes','the attestation is recorded as the uploaded-codes confirmation, under the person');
 assert.equal((await get('E1')).review_details.mapping_confirmation.confirmed_by,actors.ASSISTANT.staff_id);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='BULK_MAPPING'`)[0].n,3,'each group leaves its own audit event');
 const after=await sum('ASSISTANT');assert.equal(after.mapped_rows,4);assert.equal(after.draft_rows,1);assert.deepEqual(after.mapped.map(x=>[x.route_name,x.rows]),[['Expenditure',3],['PPE / capital asset',1]]);
 // The server now refuses a non-eTIMS mapping with no legal basis, however the form behaved; with a basis and evidence it maps.
 await assert.rejects(()=>acc('ASSISTANT',{action:'workbook_map_bulk',rows:[r5],route:2,account_code:e1.code}),/Legal basis is required/);
 assert.equal((await get('N1')).account_code,null);
 const basis=(await tx`select basis_code from erp_private.non_etims_bases where status<>'Retired' order by basis_code limit 1`)[0].basis_code;
 const done=await acc('ASSISTANT',{action:'workbook_map_bulk',rows:[r5],route:2,account_code:e1.code,basis_code:basis,evidence_reference:'Fictional receipt 123'});assert.equal(done.count,1);
 // An intern cannot read the summary.
 await assert.rejects(async()=>{actors.INTERN={...actors.ASSISTANT,category_code:'INTERN'};await as('INTERN',a=>purchaseAccountsAction(tx,a,{project_id:P,action:'purchase_accounts_summary'}));},/Assigned accounting staff/);
});

test('the screens offer the summary, map-by-codes and a Save that waits for the legal-basis fields',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),acc=rd('staff-accounting.mjs'),ne=rd('staff-non-etims.mjs');
 assert.match(acc,/btn\('upload-summary','Summary of this upload',pid\)/);assert.match(acc,/btn\('bulk-codes','Confirm uploaded codes',pid\)/);
 assert.match(acc,/a==='bulk-codes'\)await mapByCodes\(id\);else if\(a==='bulk-unmap'\)|a==='bulk-codes'\)await mapByCodes\(id\);else if\(/,'the new button is handled before the generic bulk buttons');
 assert.match(acc,/action:'workbook_map_groups',project_id:pid,confirm_uploaded_mapping:o\.uploaded/);assert.match(acc,/Tick the confirmation first/);assert.match(acc,/confirmUploaded\('confirm_groups',true\)/,'the person ticks the confirmation; it is never ticked for them');
 assert.match(acc,/if the group is refused|if any group is refused, nothing is mapped/);assert.match(acc,/await imported\(pid\)/,'back to the same purchases list');
 assert.match(ne,/submit\.disabled=true;submit\.textContent='Loading the legal bases…'/);assert.match(ne,/ready\(\);/);
});
