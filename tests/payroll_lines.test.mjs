import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {manualPayrollRows,relationshipIssues,RELATIONSHIPS} from '../supabase/functions/staff-workspace-v12/payroll-lines.mjs';
import {RELATIONSHIPS as CLIENT_RELATIONSHIPS,RELATIONSHIP_HELP} from '../staff-payroll-lines.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {periodImportAction}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('relationship lists match between the screen and the server',()=>{
 assert.deepEqual(CLIENT_RELATIONSHIPS,RELATIONSHIPS);
 for(const r of RELATIONSHIPS)assert.ok(RELATIONSHIP_HELP[r],'help text for '+r);
});

const line=(o={})=>({name:'Fictional Person',pin:'A123456789B',employee_id:'12345678',relationship:'Employee',employment_type:'Permanent',resident:'Resident',gross:'60000',evidence_reference:'Payslip 001',...o});

test('manual lines: row shape, validation and duplicates',()=>{
 const ok=manualPayrollRows([line()]);assert.deepEqual(ok.issues,[]);
 const r=ok.rows[0];assert.equal(r.manual,true);assert.equal(r.gross,60000);assert.equal(r.resident,true);assert.equal(r.source_row,1);assert.equal(r.paye,undefined);
 assert.match(manualPayrollRows([]).issues[0],/at least one/);
 assert.ok(manualPayrollRows([line({name:''})]).issues.some(i=>/Name is missing/.test(i)));
 assert.ok(manualPayrollRows([line({pin:'BAD'})]).issues.some(i=>/PIN is missing or invalid/.test(i)));
 assert.ok(manualPayrollRows([line(),line({name:'Other'})]).issues.some(i=>/Line 2: Duplicate KRA PIN/.test(i)));
 assert.ok(manualPayrollRows([line({gross:''})]).issues.some(i=>/Gross pay is missing/.test(i)));
 assert.ok(manualPayrollRows([line({gross:'-5'})]).issues.some(i=>/cannot be negative/.test(i)));
 assert.ok(manualPayrollRows([line({evidence_reference:''})]).issues.some(i=>/evidence for this line/.test(i)));
 assert.ok(manualPayrollRows([line({gross:'abc'})]).issues.some(i=>/must be a number/.test(i)));
 const cas=manualPayrollRows([line({pin:'',employee_id:'',employment_type:'Casual',relationship:'Casual worker'})]);
 for(const re of [/ID number/,/phone number/,/date paid/])assert.ok(cas.issues.some(i=>re.test(i)),String(re));
 assert.deepEqual(manualPayrollRows([line({pin:'',employment_type:'Casual',relationship:'Casual worker',phone:'0700000000',date_paid:'2026-10-15'})]).issues,[]);
 assert.equal(manualPayrollRows([line({gross:'',basic:'50000',allowances:'5000'})]).rows[0].gross,55000);
});

test('relationship rules by entity type',()=>{
 const rows=(...ls)=>manualPayrollRows(ls).rows;
 const check=(entityType,l)=>relationshipIssues({entityType,lines:rows(l)});
 assert.deepEqual(check('Limited company',line()),[]);
 assert.deepEqual(check('Limited company',line({relationship:'Director',approval_reference:'Board resolution 4'})),[]);
 assert.match(check('Limited company',line({relationship:'Director'}))[0],/board resolution or contract/);
 assert.match(check('Limited company',line({relationship:'Shareholder'}))[0],/board resolution or contract/);
 assert.match(check('Limited company',line({relationship:'Family member',approval_reference:'Contract 2'}))[0],/duties performed/);
 assert.deepEqual(check('Limited company',line({relationship:'Family member',approval_reference:'Contract 2',related_basis:'Cashier, market rate for the role'})),[]);
 assert.match(check('Sole proprietor',line({relationship:'Owner'}))[0],/Drawings/);
 assert.match(check('Partnership',line({relationship:'Partner'}))[0],/Drawings/);
 assert.match(check('Limited company',line({relationship:'Owner'}))[0],/applies only to a sole proprietor/);
 assert.match(check('Limited company',line({relationship:'Partner'}))[0],/applies only to a partnership/);
 assert.match(check('Sole proprietor',line({relationship:'Director',approval_reference:'Board resolution 4'}))[0],/no directors/);
 assert.match(check('Partnership',line({relationship:'Shareholder',approval_reference:'Board resolution 4'}))[0],/no shareholders/);
 assert.match(check('Limited company',line({relationship:''}))[0],/choose how this person relates/);
 assert.match(check('Limited company',line({relationship:'Casual worker'}))[0],/must have the employment type Casual/);
 assert.match(check('Limited company',line({employment_type:'Casual',pin:''}))[0],/requires the relationship Casual worker/);
 // A family member of a sole proprietor is allowed on payroll with a basis.
 assert.deepEqual(check('Sole proprietor',line({relationship:'Family member',approval_reference:'Contract 2',related_basis:'Cashier, market rate for the role'})),[]);
});

test('manual payroll: preview, save, review and entity rules through the database',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PLQA','Fictional ledger firm'),(${F2},'PLHIDDEN','Fictional hidden firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional purchase ledger client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional purchase project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic accounting policy',${actors.MANAGER.staff_id})`;
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const storage={download:async()=>{throw new Error('Manual payroll must not read a file');}};
 const imp=(role,p)=>as(role,a=>periodImportAction(tx,a,{project_id:P,...p},storage));
 for(const rule of JSON.parse(fs.readFileSync(root+'/supabase/functions/staff-workspace-v6/kenya-tax-catalog.json'))){await tx`insert into erp_private.tax_rates(rate_key,label,tax_type,effective_from,effective_to,parameters,source_url,source_note,status,created_by) values(${rule.rate_key},${rule.label},${rule.tax_type},${rule.effective_from},${rule.effective_to},${tx.json(rule.parameters)},${rule.source_url},${rule.source_note},'Testing',${actors.PARTNER.staff_id})`;}

 const month={starts_on:'2026-10-01',ends_on:'2026-10-31'};
 const prev=(role,lines,extra={})=>imp(role,{action:'period_import_preview',kind:'Payroll',entry_mode:'Manual',...month,manual_basis:'Client sent a handwritten list; no payroll file exists',manual_lines:lines,residents_confirmed:true,...extra});
 const setEntity=type=>tx`update erp_private.clients set legal_entity_type=${type} where client_id=${C}`;
 await setEntity('Limited company');

 await t.test('a typed month previews with no file, no source comparison and the relationship carried through',async()=>{
  const x=await prev('ASSISTANT',[line({relationship:'Director',approval_reference:'Board resolution 4',gross:'120000'}),line({name:'Fictional Two',pin:'A222222222B',employee_id:'22222222',gross:'45000'})]);
  assert.deepEqual(x.payload.issues,[]);
  assert.equal(x.entry_mode,'Manual');assert.equal(x.document_id,null);assert.equal(x.payload.differences.length,0);
  assert.equal(x.payload.calculated.length,2);assert.ok(x.payload.totals.paye>0);
  assert.equal(x.payload.employees[0].relationship,'Director');assert.equal(x.payload.employees[0].approval_reference,'Board resolution 4');assert.equal(x.payload.manual.line_count,2);
  assert.equal(x.payload.employees[1].evidence_reference,'Payslip 001');
  const again=await prev('ASSISTANT',[line({relationship:'Director',approval_reference:'Board resolution 4',gross:'120000'}),line({name:'Fictional Two',pin:'A222222222B',employee_id:'22222222',gross:'45000'})]);
  assert.equal(again.source_hash,x.source_hash,'same lines give the same hash');
  const changed=await prev('ASSISTANT',[line({relationship:'Employee',gross:'120000'}),line({name:'Fictional Two',pin:'A222222222B',employee_id:'22222222',gross:'45000'})]);
  assert.notEqual(changed.source_hash,x.source_hash,'the relationship is part of what was previewed');
 });

 await t.test('the reason for typing, relationship rules and owner payments block the save',async()=>{
  const none=await prev('ASSISTANT',[line()],{manual_basis:'short'});
  assert.ok(none.payload.issues.some(i=>/why the payroll is typed in/.test(i)));
  const dir=await prev('ASSISTANT',[line({relationship:'Director'})]);
  assert.ok(dir.payload.issues.some(i=>/board resolution or contract/.test(i)));
  const owner=await prev('ASSISTANT',[line({relationship:'Owner'})]);
  assert.ok(owner.payload.issues.some(i=>/applies only to a sole proprietor/.test(i)));
  await setEntity('Sole proprietor');
  const sole=await prev('ASSISTANT',[line({relationship:'Owner'})]);
  assert.ok(sole.payload.issues.some(i=>/Drawings/.test(i)));
  const dirSole=await prev('ASSISTANT',[line({relationship:'Director',approval_reference:'Board resolution 4'})]);
  assert.ok(dirSole.payload.issues.some(i=>/no directors/.test(i)));
  await setEntity('Limited company');
 });

 await t.test('a typed month saves, goes to an independent reviewer and cannot be changed afterwards',async()=>{
  const lines=[line({gross:'80000'})];
  const x=await prev('ASSISTANT',lines);assert.deepEqual(x.payload.issues,[]);
  const saved=await imp('ASSISTANT',{action:'period_import_save',kind:'Payroll',entry_mode:'Manual',...month,manual_basis:'Client sent a handwritten list; no payroll file exists',manual_lines:lines,residents_confirmed:true,use_calculated:true,preview_hash:x.source_hash,confirmed_client_id:C,replaces_ids:[]});
  const row=(await tx`select * from erp_private.period_imports where import_id=${saved.import_id}`)[0];
  assert.equal(row.entry_mode,'Manual');assert.equal(row.document_id,null);assert.equal(row.status,'Draft');
  await assert.rejects(()=>imp('ASSISTANT',{action:'period_import_save',kind:'Payroll',entry_mode:'Manual',...month,manual_basis:'Client sent a handwritten list; no payroll file exists',manual_lines:lines,residents_confirmed:true,use_calculated:false,preview_hash:x.source_hash,confirmed_client_id:C,replaces_ids:[]}).then(r=>{if(r.reused)throw new Error('reused');}),/reused|confirm the displayed ERP calculations/);
  await imp('ASSISTANT',{action:'period_import_submit',import_id:saved.import_id,revision:row.revision});
  await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.period_imports set entry_mode='File' where import_id=${saved.import_id}`),/immutable|violates|check|source required/i);
  const sub=(await tx`select * from erp_private.period_imports where import_id=${saved.import_id}`)[0];
  await assert.rejects(()=>imp('ASSISTANT',{action:'period_import_review',import_id:saved.import_id,revision:sub.revision,status:'Confirmed',review_note:'Fictional self review attempt'}),/different|independent|reviewer/i);
  await imp('MANAGER',{action:'period_import_review',import_id:saved.import_id,revision:sub.revision,status:'Confirmed',review_note:'Fictional independent review of the typed lines'});
  assert.equal((await tx`select status from erp_private.period_imports where import_id=${saved.import_id}`)[0].status,'Confirmed');
 });

 await t.test('the database keeps file and manual imports apart',async()=>{
  await assert.rejects(()=>tx`insert into erp_private.period_imports(project_id,client_id,document_id,entry_mode,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,prepared_by) values(${P},${C},null,'File','Payroll','PAYROLL','PAYROLL_MONTHLY','2026-09-01','2026-09-30','{}','x1',${actors.ASSISTANT.staff_id})`,/check|null value|source required/i);
  await assert.rejects(()=>tx`insert into erp_private.period_imports(project_id,client_id,document_id,entry_mode,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,prepared_by) values(${P},${C},null,'Manual','Sales','ETIMS','LEGACY','2026-09-01','2026-09-30','{}','x2',${actors.ASSISTANT.staff_id})`,/check/i);
 });
});
