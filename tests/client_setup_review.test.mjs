import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientSetupReviewAction}=await import('../supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');

const root=path.resolve(import.meta.dirname,'..');

test('set-up sections are submitted without blocking and reviewed later in one action',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),C=id(),PT=id(),PA=id(),actors={},sources=new Map();
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 const storage={download:async key=>({data:new Blob([sources.get(key)])})};
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDQA','Fictional audit firm')`;
 for(const [role,cat] of [['PARTNER','PARTNER'],['PREP','MANAGER'],['REV','MANAGER'],['ASST','ASSISTANT']]){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL AUDIT FLOW LIMITED','P051000001A','Wholesale & Retail','Nairobi','Limited company','CR-FICTIONAL-0001 fictional certificate',10,31,${actors.PREP.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${PT},${C},${F},'Fictional books','TAX-COMP',${actors.PREP.staff_id}),(${PA},${C},${F},'Fictional audit','AUD-STAT',${actors.PREP.staff_id})`;
 for(const p of [PT,PA])for(const r of ['PREP','REV','ASST'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${actors[r].staff_id},${F},'MANAGER')`;
 await readyForLedger(tx,C);
 async function doc(project,name,rows){const w=new ExcelJS.Workbook(),s=w.addWorksheet('Sheet1');rows.forEach(r=>s.addRow(r));const bytes=Buffer.from(await w.xlsx.writeBuffer()),d=id(),key='qa/'+d,sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');sources.set(key,bytes);
  await as('PREP',a=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${C},${F},${project},'Import Sources',${name},${key},${bytes.length},${sha},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${a.staff_id})`);return d;}
 const rv=(r,p)=>as(r,a=>clientSetupReviewAction(tx,a,{client_id:C,...p}));
 const sub=(code,kind='BRS',note='')=>({section_code:code,source_kind:kind,source_note:note});

 await t.test('an Assistant submits sections and is never held up; nothing is approved by submitting',async()=>{
  let r=await rv('ASST',{action:'client_setup_review_read'});
  assert.equal(r.sections.length,9);assert.ok(r.sections.every(x=>x.status==='Draft'));
  assert.equal(r.milestones.data_entry_completed,false);assert.equal(r.milestones.fully_approved,false);
  await assert.rejects(()=>rv('ASST',{action:'client_setup_section_submit',sections:[{section_code:'identity',source_kind:'',source_note:''}]}),/Say where this information came from/);
  await assert.rejects(()=>rv('ASST',{action:'client_setup_section_submit',sections:[{section_code:'identity',source_kind:'Other approved source',source_note:'x'}]}),/Name the other approved source/);
  r=await rv('ASST',{action:'client_setup_section_submit',sections:[sub('identity','BRS'),sub('tax','KRA'),sub('activities','Permanent file')]});
  assert.equal(r.sections.filter(x=>x.status==='Pending Review').length,3);
  assert.equal(r.sections.find(x=>x.code==='identity').submitted_by_name!==null,true);
  assert.equal(r.milestones.pending_review,3);assert.equal(r.milestones.fully_approved,false);
  r=await rv('ASST',{action:'client_setup_section_submit',sections:['registration','ownership','year_end','contacts','permanent_file','engagement'].map(c=>sub(c,'Client document'))});
  assert.equal(r.milestones.data_entry_completed,true,'all nine submitted means data entry is complete');
  assert.equal(r.milestones.fully_approved,false,'but nothing is approved, and the chart and opening TB are still outstanding');
  assert.equal(r.chart.status,'Approved','the test client already has an approved chart');assert.equal(r.opening.status,'Draft');
 });

 await t.test('an Assistant cannot decide; the queue lists everything for a Manager',async()=>{
  await assert.rejects(()=>rv('ASST',{action:'client_setup_section_decide',decisions:[{section_code:'identity',outcome:'Approved'}]}),/Manager or Partner/);
  await assert.rejects(()=>rv('ASST',{action:'client_setup_review_queue'}),/Manager or Partner/);
  const q=await as('REV',a=>clientSetupReviewAction(tx,a,{action:'client_setup_review_queue'}));
  assert.equal(q.total,9);assert.equal(q.clients[0].sections[0].mine,false);
 });

 await t.test('a Manager approves several at once and returns one with a comment',async()=>{
  await assert.rejects(()=>rv('REV',{action:'client_setup_section_decide',decisions:[{section_code:'identity',outcome:'Returned',note:'short'}]}),/at least 10 characters/);
  const r=await rv('REV',{action:'client_setup_section_decide',decisions:[...['identity','registration','tax','ownership','year_end','contacts','permanent_file','engagement'].map(c=>({section_code:c,outcome:'Approved',note:''})),{section_code:'activities',outcome:'Returned',note:'Add the end date for the retail activity.'}]});
  assert.equal(r.sections.filter(x=>x.status==='Approved').length,8);
  const act=r.sections.find(x=>x.code==='activities');assert.equal(act.status,'Correction Required');assert.match(act.review_note,/end date/);
  assert.equal(r.milestones.data_entry_completed,false,'a returned section means entry is not complete');
  assert.equal(r.history.filter(h=>h.action==='Approved').length,8);
 });

 await t.test('maker is not checker: the person who submitted cannot approve their own section',async()=>{
  await rv('PREP',{action:'client_setup_section_submit',sections:[sub('activities','BRS')]});
  await assert.rejects(()=>rv('PREP',{action:'client_setup_section_decide',decisions:[{section_code:'activities',outcome:'Approved',note:''}]}),/different Manager or Partner/);
  const r=await rv('REV',{action:'client_setup_section_decide',decisions:[{section_code:'activities',outcome:'Approved',note:'Dates now present.'}]});
  assert.equal(r.sections.find(x=>x.code==='activities').status,'Approved');
 });

 await t.test('changed information needs a new review; unchanged information does not',async()=>{
  let r=await rv('ASST',{action:'client_setup_section_submit',sections:[sub('year_end','KRA')]});
  assert.match(r.results[0].result,/Already approved and unchanged/);
  await tx`update erp_private.clients set year_end_month=6,year_end_day=30 where client_id=${C}`;
  r=await rv('ASST',{action:'client_setup_review_read'});
  const ye=r.sections.find(x=>x.code==='year_end');assert.equal(ye.status,'Approved');assert.equal(ye.changed,true,'shown as changed since approval');
  assert.equal(r.milestones.fully_approved,false);
  r=await rv('ASST',{action:'client_setup_section_submit',sections:[sub('year_end','KRA')]});
  assert.equal(r.sections.find(x=>x.code==='year_end').status,'Pending Review');
  await tx`update erp_private.clients set year_end_month=10,year_end_day=31 where client_id=${C}`;
  await assert.rejects(()=>rv('REV',{action:'client_setup_section_decide',decisions:[{section_code:'year_end',outcome:'Approved',note:''}]}),/changed after it was submitted/);
  r=await rv('ASST',{action:'client_setup_section_submit',sections:[sub('year_end','KRA')]});
  assert.match(r.results[0].result,/Unchanged since the last approval/);
  assert.equal(r.sections.find(x=>x.code==='year_end').status,'Approved');
  assert.equal(r.sections.find(x=>x.code==='year_end').unchanged_approval,true);
 });

 await t.test('history is kept and never edited or deleted',async()=>{
  const n=(await tx`select count(*)::int n from erp_private.client_setup_section_events where client_id=${C}`)[0].n;assert.ok(n>=20);
  await assert.rejects(()=>as('REV',()=>tx`update erp_private.client_setup_section_events set note='x' where client_id=${C}`),/permission denied|never edited/);
  await assert.rejects(()=>as('REV',()=>tx`delete from erp_private.client_setup_sections where client_id=${C}`),/./);
  assert.equal((await tx`select count(*)::int n from erp_private.client_setup_sections where client_id=${C}`)[0].n,9);
 });

 await t.test('the two mandatory approvals are reported on their own and decide full approval',async()=>{
  let r=await rv('ASST',{action:'client_setup_review_read'});
  assert.equal(r.milestones.data_entry_completed,true);assert.equal(r.milestones.fully_approved,false);
  await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Client confirmed there are no opening balances',opening_balance_confirmed_by=${actors.REV.staff_id},opening_balance_confirmed_at=now() where client_id=${C}`;
  const leaders=await tx`select staff_id from erp_private.staff_members where category_code in('PARTNER','MANAGER') order by category_code,staff_id limit 2`;
  r=await rv('ASST',{action:'client_setup_review_read'});
  assert.equal(r.opening.status,'Approved');assert.equal(r.chart.status,'Approved','the test client has an approved chart');
  assert.equal(r.milestones.fully_approved,true,'every section approved, chart approved, opening not applicable');
  void leaders;
 });
});
