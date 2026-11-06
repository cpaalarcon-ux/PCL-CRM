import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {purchaseLedgerAction}=await import('../supabase/functions/staff-workspace-v12/purchase-ledger-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {taxSummary}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {workbookAction}=await import('../supabase/functions/staff-workspace-v12/workbook-actions.ts');
const {periodImportAction,summarySalesRows}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {reconSource}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {inventoryDetails}=await import('../supabase/functions/staff-workspace-v12/accounting-rules.mjs');
const {purchaseUploadHeaders}=await import('../supabase/functions/staff-workspace-v12/purchase-upload.mjs');
const root=path.resolve(import.meta.dirname,'..');
test('Payroll imports: residence assumptions, rounding tolerance and reasons',async t=>{
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
 for(const rule of JSON.parse(fs.readFileSync(root+'/supabase/functions/staff-workspace-v6/kenya-tax-catalog.json'))){await tx`insert into erp_private.tax_rates(rate_key,label,tax_type,effective_from,effective_to,parameters,source_url,source_note,status,created_by) values(${rule.rate_key},${rule.label},${rule.tax_type},${rule.effective_from},${rule.effective_to},${tx.json(rule.parameters)},${rule.source_url},${rule.source_note},'Testing',${actors.PARTNER.staff_id})`;}
 const header='Employee name,KRA PIN,ID number,Basic pay,Allowances,Deductions,Gross pay,NSSF,SHIF,AHL,NITA levy,Taxable pay,Income tax,P.M relief,PAYE deduction,Net amount\n';
 // Employee number i is on spreadsheet row i+1 (row 1 is the header).
 const row=(i,idno,gross=100000,paye=0)=>`Fictional Employee ${i},A${String(i).padStart(9,'0')}A,${idno},${gross},0,0,${gross},0,0,0,0,0,0,0,${paye},0`;
 const prev=(body,extra={})=>doc('Payroll-'+Math.random()+'.csv',header+body).then(d=>imp('ASSISTANT',{action:'period_import_preview',kind:'Payroll',document_id:d,starts_on:'2026-10-01',ends_on:'2026-10-31',...extra}));
 const startsRow=n=>i=>i.startsWith(`Row ${n}:`);
 const cap=(role,v,reason='Fictional cap change for the test')=>as(role,a=>periodImportAction(tx,a,{project_id:P,action:'period_import_tolerance',monthly_cap_kes:v,reason},storage));

 await t.test('residence: a national ID is assumed Resident until confirmed; a passport or blank ID is chosen by hand',async()=>{
  const body=[row(1,'12345678'),row(2,'A1234567'),row(3,''),row(4,'7654321')].join('\n');
  const first=await prev(body);
  assert.ok(first.payload.issues.some(i=>startsRow(3)(i)&&/choose Resident or Non-resident/.test(i)),'passport needs a choice');
  assert.ok(first.payload.issues.some(i=>startsRow(4)(i)&&/choose Resident or Non-resident/.test(i)),'blank ID needs a choice');
  assert.ok(first.payload.issues.some(i=>startsRow(2)(i)&&/assumed Resident from the national ID/.test(i)),'national IDs ask for the one-click confirmation');
  assert.equal(first.payload.residency.assumed,2);assert.equal(first.payload.residency.needs_choice,2);
  const confirmed=await prev(body,{residents_confirmed:true,residency_choices:{'3':'Resident','4':'Non-resident'}});
  assert.deepEqual(confirmed.payload.issues,[],'confirmation plus choices clear every residence issue');
  const by=Object.fromEntries(confirmed.payload.employees.map(e=>[e.source_row,e]));
  assert.equal(by[2].residency_basis,'Assumed Resident from national ID');assert.equal(by[2].resident,true);
  assert.equal(by[3].residency_basis,'Chosen by staff');assert.equal(by[3].resident,true);assert.equal(by[4].resident,false);assert.equal(by[5].residency_basis,'Assumed Resident from national ID');
  assert.notEqual(confirmed.source_hash,first.source_hash);
  const other=await prev(body,{residents_confirmed:true,residency_choices:{'3':'Non-resident','4':'Non-resident'}});
  assert.notEqual(other.source_hash,confirmed.source_hash,'the choices are part of what was previewed');
  const relief=r=>Number(confirmed.payload.calculated.find(c=>c.source_row===r).personal_relief);
  assert.ok(relief(4)<relief(2),'a non-resident gets no personal relief');
 });

 await t.test('rounding: KES 1 per employee is tolerated while the month stays within the Partner cap',async()=>{
  const ids=['10000001','10000002','10000003'];
  const learn=await prev(ids.map((x,i)=>row(i+1,x,150000,0)).join('\n'),{residents_confirmed:true});
  const calc=Object.fromEntries(learn.payload.calculated.map(c=>[c.source_row,Number(c.paye)]));
  const body=d=>ids.map((x,i)=>row(i+1,x,150000,(calc[i+2]+d[i]).toFixed(2))).join('\n');
  const near=await prev(body([0.6,-0.4,0]),{residents_confirmed:true});
  assert.equal(near.payload.differences.filter(d=>d.field==='paye'&&d.source!=null).length,0,'PAYE within KES 1 is not a difference');
  assert.equal(near.payload.rounding.filter(d=>d.field==='paye').length,2);
  assert.equal(near.payload.tolerance.per_employee,1);assert.equal(near.payload.tolerance.monthly_cap,50);assert.equal(near.payload.tolerance.within,true);assert.equal(near.payload.tolerance.used,1);
  const far=await prev(body([1.5,0,0]),{residents_confirmed:true});
  assert.ok(far.payload.differences.some(d=>d.field==='paye'&&Math.abs(d.difference)>1),'more than KES 1 is a real difference');
  assert.ok(!near.payload.rounding.some(d=>d.field==='gross'),'gross pay is never tolerated');
  await assert.rejects(()=>cap('MANAGER',0.5),/Only a Partner/);
  await assert.rejects(()=>cap('PARTNER',5000),/between KES 0 and KES 1,000/);
  await assert.rejects(()=>cap('PARTNER',2,'short'),/reason/);
  assert.equal((await cap('PARTNER',0.5)).monthly_cap_kes,0.5);
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='PAYROLL_ROUNDING_CAP_CHANGED'`)[0].n,1);
  const capped=await prev(body([0.6,-0.4,0]),{residents_confirmed:true});
  assert.equal(capped.payload.tolerance.within,false);assert.equal(capped.payload.rounding.length,0);
  assert.ok(capped.payload.differences.some(d=>d.field==='paye'&&d.source!=null),'over the cap, every difference needs a reason');
  assert.equal((await imp('ASSISTANT',{action:'period_import_list'})).payroll_cap,0.5);
  const hit=await as('MANAGER',()=>tx`update erp_private.payroll_tolerance set monthly_cap_kes=900 returning monthly_cap_kes`).catch(()=>[]);
  assert.equal(hit.length,0,'the database refuses a non-Partner change');
  await cap('PARTNER',50);
 });

 await t.test('saving: each difference needs a reason, and the residence assumption is logged',async()=>{
  const d=await doc('Payroll-save.csv',header+[row(1,'10000001',150000,111),row(2,'10000002',150000,222)].join('\n'));
  const b={kind:'Payroll',document_id:d,starts_on:'2026-10-01',ends_on:'2026-10-31',residents_confirmed:true};
  const pv=await imp('ASSISTANT',{action:'period_import_preview',...b});assert.deepEqual(pv.payload.issues,[]);
  const diffs=pv.payload.differences.filter(x=>x.source!=null);assert.ok(diffs.length>0);
  const nulls=pv.payload.differences.some(x=>x.source==null);
  const save=extra=>imp('ASSISTANT',{action:'period_import_save',...b,use_calculated:true,preview_hash:pv.source_hash,confirmed_client_id:C,...extra});
  await assert.rejects(()=>save({}),/(reason for each payroll difference|missing amounts)/);
  await assert.rejects(()=>save({difference_reasons:{[diffs[0].row+':'+diffs[0].field]:'ok'}}),/(reason for each payroll difference|missing amounts)/);
  const reasons=Object.fromEntries(diffs.map(x=>[x.row+':'+x.field,'Fictional reason: file used last month rates']));
  const out=await save({difference_reasons:reasons,notes:nulls?'Fictional note on columns missing from the file':''});
  const rec=(await imp('ASSISTANT',{action:'period_import_read',import_id:out.import_id})).record;
  const att=rec.payload.review_attestations;
  assert.equal(att.difference_reasons[diffs[0].row+':'+diffs[0].field],'Fictional reason: file used last month rates');
  assert.equal(att.residency_assumed.confirmed,true);assert.equal(att.residency_assumed.employees,2);assert.equal(att.residency_assumed.confirmed_by,actors.ASSISTANT.staff_id);
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='PAYROLL_RESIDENCY_ASSUMED'`)[0].n,1);
 });
 await t.test('casuals: housing levy only, register details required, signed sheet linked',async()=>{
  const head2='Employee name,KRA PIN,ID number,Employment type,Phone number,Date paid,Basic pay,Allowances,Deductions,Gross pay,NSSF,SHIF,AHL,NITA levy,Taxable pay,Income tax,P.M relief,PAYE deduction,Net amount\n';
  const r2=(n,pin,idn,type,phone,date,gross=20000,ahl=0,net=0)=>`${n},${pin},${idn},${type},${phone},${date},${gross},0,0,${gross},0,0,${ahl},0,0,0,0,0,${net}`;
  const pdf=id();await as('ASSISTANT',()=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${pdf},${C},${F},${P},${T},'Working Papers','Signed casual wage sheet October.pdf',${'qa/'+pdf},100,${'c'.repeat(64)},'application/pdf',${actors.ASSISTANT.staff_id})`);
  const listed=await imp('ASSISTANT',{action:'period_import_list'});assert.ok(listed.signed_documents.some(x=>x.document_id===pdf),'the signed sheet can be chosen');
  const run=async(rows,extra={})=>{const d=await doc('Casual-'+Math.random()+'.csv',head2+rows.join('\n'));return imp('ASSISTANT',{action:'period_import_preview',kind:'Payroll',document_id:d,starts_on:'2026-10-01',ends_on:'2026-10-31',residents_confirmed:true,...extra});};
  const mixed=[r2('Fictional Permanent','A000000021A','11111111','Permanent','','',100000),r2('Fictional Casual One','','22222222','Casual','0712345678','2026-10-15'),r2('Fictional Casual Two','','33333333','Casual','+254712345679','2026-10-16')];
  const a=await run(mixed);
  assert.ok(a.payload.issues.some(i=>/casuals in this file\. Choose the signed casual wage sheet/.test(i)),'the signed sheet is required');
  const b=await run(mixed,{signed_document_id:pdf});
  assert.deepEqual(b.payload.issues.filter(i=>!/Resident|PIN/.test(i)),[],b.payload.issues.join(' | '));
  assert.equal(b.payload.casual.count,2);assert.equal(b.payload.casual.file_name,'Signed casual wage sheet October.pdf');
  const calc=Object.fromEntries(b.payload.calculated.map(c=>[c.source_row,c]));
  assert.ok(calc[2].employee_nssf>0&&calc[2].shif>0&&calc[2].nita>0,'a permanent employee carries NSSF, SHIF and NITA');
  for(const row of [3,4]){const c=calc[row];assert.equal(c.employment_type,'Casual');assert.equal(c.employee_nssf,0);assert.equal(c.employer_nssf,0);assert.equal(c.shif,0);assert.equal(c.nita,0);assert.equal(c.employee_ahl,300);assert.equal(c.employer_ahl,300);assert.equal(c.paye,0,'pay below the taxable threshold has no PAYE');assert.equal(c.net_pay,19700);}
  assert.ok(!b.payload.differences.some(d=>[3,4].includes(d.row)&&['taxable','gross_tax','personal_relief','employee_nssf','shif'].includes(d.field)),'casuals are only compared on gross, housing levy, PAYE and net');
  // Missing register details are exceptions; so are a bad type and a date outside the month.
  const bad=await run([r2('Fictional Casual Three','','','Casual','','',20000),r2('Fictional Casual Four','','44444444','Casual','0712345680','2026-11-02'),r2('Fictional Other','','55555555','Seasonal','0712345681','2026-10-03')],{signed_document_id:pdf});
  const text=bad.payload.issues.join(' | ');
  assert.match(text,/Row 2: A casual needs an ID number/);assert.match(text,/Row 2: A casual needs a phone number/);assert.match(text,/Row 2: A casual needs the date paid/);
  assert.match(text,/Row 3: the date paid 2026-11-02 is outside the payroll month/);assert.match(text,/Row 4: Employment type must be Permanent, Casual or Contract/);
  // A casual-only file that agrees with the ERP saves, and records the signed sheet.
  const clean=await run([r2('Fictional Casual Five','','66666666','Casual','0712345682','2026-10-20',20000,300,19700),r2('Fictional Casual Six','','77777777','Casual','0712345683','2026-10-21',20000,300,19700)],{signed_document_id:pdf});
  assert.deepEqual(clean.payload.issues,[]);
  assert.equal(clean.payload.differences.length,0,JSON.stringify(clean.payload.differences));
  const out=await imp('ASSISTANT',{action:'period_import_save',kind:'Payroll',document_id:clean.document_id,starts_on:'2026-10-01',ends_on:'2026-10-31',residents_confirmed:true,signed_document_id:pdf,use_calculated:true,preview_hash:clean.source_hash,confirmed_client_id:C,replaces_ids:clean.overlaps.map(o=>o.import_id)});
  const rec=(await imp('ASSISTANT',{action:'period_import_read',import_id:out.import_id})).record;
  assert.equal(rec.payload.casual.document_id,pdf);assert.equal(rec.payload.totals.employer_ahl,600);assert.equal(rec.payload.totals.employee_nssf,0);
 });
 await t.test('owners and partners are paid through Drawings, not payroll',async()=>{
  const body=[row(1,'12345678'),row(2,'23456789'),row(3,'34567890')].join('\n');
  const clean=await prev(body,{residents_confirmed:true});
  assert.equal(clean.payload.issues.filter(i=>/Drawings/.test(i)).length,0,'a limited company may pay any employee');
  await tx`update erp_private.clients set legal_entity_type='Partnership' where client_id=${C}`;
  const grp=id();
  await tx`insert into erp_private.partner_interests(client_id,partner_name,partner_pin,recipient_type,profit_percentage,effective_from,effective_to,agreement_reference,created_by,group_id) values(${C},'Fictional Partner One','A000000001A','Individual',50,'2026-01-01','2026-12-31','Fictional partnership deed',${actors.MANAGER.staff_id},${grp}),(${C},'Fictional Employee 3','A000000777Z','Individual',50,'2026-01-01','2026-12-31','Fictional partnership deed',${actors.MANAGER.staff_id},${grp})`;
  const partner=await prev(body,{residents_confirmed:true});
  assert.ok(partner.payload.issues.some(i=>startsRow(2)(i)&&/partner of this partnership/.test(i)&&/Owner and partner payments must be routed to Drawings, not payroll/.test(i)),'matched by PIN');
  assert.ok(partner.payload.issues.some(i=>startsRow(4)(i)&&/Drawings/.test(i)),'matched by name');
  assert.ok(!partner.payload.issues.some(i=>startsRow(3)(i)&&/Drawings/.test(i)),'other employees are not blocked');
  await tx`update erp_private.clients set legal_entity_type='Sole proprietor',kra_pin='A000000003A' where client_id=${C}`;
  const sole=await prev(body,{residents_confirmed:true});
  assert.ok(sole.payload.issues.some(i=>startsRow(4)(i)&&/owner of this sole proprietorship/.test(i)));
  assert.equal(sole.payload.issues.filter(i=>/Drawings/.test(i)).length,1);
  await tx`update erp_private.clients set legal_entity_type=null,kra_pin=null where client_id=${C}`;
 });
});

test('the payroll screen shows the residence choices, the rounding summary and a reason for each difference',()=>{
 const ui=fs.readFileSync(root+'/staff-period-imports.mjs','utf8'),guide=fs.readFileSync(root+'/staff-guide-text.mjs','utf8');
 assert.match(ui,/residency_choices/);assert.match(ui,/difference_reasons/);assert.match(ui,/Within KES \$\{t\.per_employee\}/);assert.match(ui,/period_import_tolerance/);assert.match(guide,/KES 1/);assert.match(ui,/signed_document_id/);assert.match(ui,/Housing levy only/);assert.match(guide,/Casuals:/);
});
