import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientBatchStage,clientBatchAction}=await import('../supabase/functions/staff-workspace-v12/client-batch-actions.ts');
const {proposalAction}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const {policyAction}=await import('../supabase/functions/staff-workspace-v12/policy-actions.ts');
const {default:ExcelJS}=await import('exceljs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
tx.savepoint=async fn=>{await db.exec('savepoint rs');try{const r=await fn(tx);await db.exec('release savepoint rs');return r;}catch(e){await db.exec('rollback to savepoint rs');throw e;}};
const calls=[];let activityFails=false;
const runAs=a=>{const run=async q=>{
 if(q.action==='client_proposal_check'||q.action==='client_proposal_approve')return proposalAction(tx,a,q,run);
 if(q.action==='client_save'&&q.client_id){await tx`update erp_private.clients set primary_sector=coalesce(${q.primary_sector??null},primary_sector) where client_id=${q.client_id}`;return {ok:true};}
 if(q.action==='client_save'){const cid=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,record_status,owner_staff_id,is_uat_fixture) values(${cid},${q.company_name},${q.kra_pin},${q.primary_sector},${q.branch_location},${q.client_category},'Existing',${a.staff_id},true)`;for(const f of q.firm_ids)await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${f})`;return {ok:true,client_id:cid};}
 if(q.action==='v3_activities_preview'){if(activityFails)throw Object.assign(new Error('Exactly one released dependency-map version must cover 2026-01-01.'),{status:409});calls.push(q);return {change_id:id(),revision:1};}
 if(q.action==='v3_activities_submit'){calls.push(q);return {ok:true,status:'Pending review'};}
 throw new Error('unexpected '+q.action);};return run;};
const stage=(role,f)=>as(role,a=>clientBatchStage(tx,a,f)),batch=(role,p)=>as(role,a=>clientBatchAction(tx,a,p,runAs(a)));
const book=async sheets=>{const wb=new ExcelJS.Workbook();for(const [name,rows] of Object.entries(sheets)){const ws=wb.addWorksheet(name);for(const r of rows)ws.addRow(r);}return Buffer.from(await wb.xlsx.writeBuffer());};
const upload=async(sheets,firm)=>{const f=new FormData();f.set('firm_id',firm);f.set('file',new File([await book(sheets)],'clients.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return f;};
const good={
 'Client Import':[['company_name','kra_pin','primary_sector','branch_location','client_category'],
  ['UAT Fictional Builders Ltd','P000000011A','Construction','Bungoma','Corporate'],
  ['UAT Fictional Goods Trader','A000000012B','Wholesale & Retail','Bungoma','Individual'],
  ['UAT Fictional Existing Ltd','P000000013C','Construction','Bungoma','Corporate']],
 'Client Details':[['company_name','kra_pin','trading_name','legal_entity_type','incorporation_date','year_end_month','year_end_day'],
  ['UAT Fictional Builders Ltd','P000000011A','UAT Fictional Builders Ltd','Limited company','19/12/2017',12,31],
  ['UAT Fictional Goods Trader','A000000012B','Fictional Goods Corner','Sole proprietor','2020-02-03',6,30],
  ['UAT Fictional Existing Ltd','P000000013C','UAT Fictional Existing Ltd','Limited company','2015-05-05',12,31]],
 'Industry & Activities':[['client_kra_pin','client_name','pack_code','activity_name','effective_from','evidence','activity_code'],
  ['P000000011A','UAT Fictional Builders Ltd','Construction','Building and civil works','2026-01-01','Itax and BRS registration','construction'],
  ['A000000012B','UAT Fictional Goods Trader','Wholesale & Retail','Retail','2026-01-01','Itax and BRS registration','retail']],
 'Contacts':[['client_kra_pin','client_name','full_name','job_title','email_address','phone_number'],
  ['P000000011A','UAT Fictional Builders Ltd','Fictional Ken','Manager','ken@example.com','0710853151'],
  ['A000000012B','UAT Fictional Goods Trader',null,null,'not-an-email',null]]};
test('client batch loader: the assistant prepares, a supervisor checks, a manager approves, and nothing skips a rule',async t=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 const clientCount=async()=>(await tx`select count(*)::int n from erp_private.clients`)[0].n;
 await as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true}));
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,record_status,owner_staff_id) values(${id()},'UAT Fictional Existing Ltd','P000000013C','Existing',${actors.MANAGER.staff_id})`;
 // 1. One bad row stops the whole file: every problem is listed with row, column and suggestion, and no proposal is saved.
 const badSheets={...good,'Client Import':[good['Client Import'][0],good['Client Import'][1],['UAT Fictional Goods Trader','A000000012B','Supply of Goods','Bungoma','Individual'],good['Client Import'][3]]};
 const bad=await stage('ASSISTANT',await upload(badSheets,F));
 assert.equal(bad.status,'VALIDATION_FAILED');assert.ok(bad.errors.some(e=>e.row===3&&e.column==='Sector'&&e.suggestion==='Wholesale & Retail'));
 assert.equal((await tx`select count(*)::int n from erp_private.change_proposals`)[0].n,0);
 await assert.rejects(async()=>stage('ASSISTANT',await upload({'Other':[['x']]},F)),/Client Import/);
 // 2. Only a preparer proposes; a Manager uses the direct import instead.
 await assert.rejects(async()=>stage('MANAGER',await upload(good,F)),/access/);
 // 3. A clean file becomes one proposal per new client; an existing client is left untouched.
 const out=await stage('ASSISTANT',await upload(good,F));
 if(out.status!=='PROPOSED')console.log(JSON.stringify(out.errors));assert.equal(out.status,'PROPOSED');assert.equal(out.proposed.length,3,'an Assistant cannot see clients outside their own work, so a duplicate is caught at approval');assert.equal(out.skipped_existing.length,0);
 assert.ok(out.notices.some(n=>n.column==='contact_email'),'a value that is not valid is left out and listed');
 const ref=out.batch_ref,props=await tx`select * from erp_private.change_proposals where payload->>'batch_ref'=${ref} order by (payload->>'batch_row')::int`;
 assert.equal(props.length,3);assert.ok(props.every(p=>p.status==='Proposed'&&p.proposed_by===actors.ASSISTANT.staff_id));
 assert.equal(props[0].payload.import_facts.incorporation_date,'2017-12-19');assert.equal(props[0].payload.import_facts.year_end,'12-31');assert.equal(props[0].payload.import_facts.contact_email,'ken@example.com');
 assert.equal(props[1].payload.import_facts.trading_name,'Fictional Goods Corner');assert.equal(props[0].payload.import_facts.trading_name,undefined,'a trading name equal to the registered name is not repeated');
 assert.equal(props[0].payload.legal_subtype,'Private Limited Company');assert.match(props[0].reason,/assumed/);assert.equal(props[1].payload.legal_subtype,'Sole Proprietor');assert.doesNotMatch(props[1].reason,/assumed/);
 assert.equal(props[0].payload.planned_activity.activity_code,'construction');assert.equal(await clientCount(),1,'no client exists until approval');
 // 4. Each step belongs to the right person.
 await assert.rejects(()=>batch('ASSISTANT',{action:'client_batch_check',batch_ref:ref,note:'Checked against the workbook'}),/access/);
 await assert.rejects(()=>batch('MANAGER',{action:'client_batch_approve',batch_ref:ref,note:'Approved after the check'}),/checked and waiting/);
 await assert.rejects(()=>batch('SUPERVISOR',{action:'client_batch_check',batch_ref:ref,note:'short'}),/10 characters/);
 const checked=await batch('SUPERVISOR',{action:'client_batch_check',batch_ref:ref,note:'Matches the PIN certificates'});assert.equal(checked.done.length,3);assert.equal(checked.held.length,0);
 await assert.rejects(()=>batch('SUPERVISOR',{action:'client_batch_approve',batch_ref:ref,note:'Approved after the check'}),/Manager or Partner/);
 // 5. Approval creates the clients, records the other facts for a different person to verify, and prepares the activity change for a different Manager or Partner.
 activityFails=false;const done=await batch('MANAGER',{action:'client_batch_approve',batch_ref:ref,note:'Approved after the check'});
 assert.equal(done.done.length,2);assert.equal(done.held.length,1);assert.equal(done.held[0].name,'UAT Fictional Existing Ltd');assert.match(done.held[0].reason,/already exists/,'a client already on file is held back, never overwritten');assert.equal(done.done[0].activity,'submitted');assert.equal(calls.filter(c=>c.action==='v3_activities_submit').length,2);
 assert.equal(await clientCount(),3);
 const f1=await tx`select field_key,value,source_kind,status,recorded_by from erp_private.client_field_facts where client_id=${done.done[0].client_id} order by field_key`;
 assert.deepEqual(f1.map(x=>x.field_key),['contact_email','contact_person','contact_phone','incorporation_date','year_end']);
 assert.ok(f1.every(x=>x.source_kind==='Import'&&x.recorded_by===actors.MANAGER.staff_id));
 assert.ok((await tx`select 1 from erp_private.change_proposals where payload->>'batch_ref'=${ref} and status='Approved' and decided_by=${actors.MANAGER.staff_id}`).length===2);
 assert.equal((await tx`select status from erp_private.change_proposals where payload->>'batch_ref'=${ref} and payload->>'company_name'='UAT Fictional Existing Ltd'`)[0].status,'Checked','the held proposal stays open for the reviewer to return');
 // 7. A failing activity step does not undo the client; it is reported for a person to do by hand.
 const second={...good,'Client Import':[good['Client Import'][0],['UAT Fictional Second Ltd','P000000021A','Construction','Bungoma','Corporate']],'Client Details':[good['Client Details'][0],['UAT Fictional Second Ltd','P000000021A','UAT Fictional Second Ltd','Limited company','2021-01-01',12,31]],'Industry & Activities':[good['Industry & Activities'][0],['P000000021A','UAT Fictional Second Ltd','Construction','Building and civil works','2026-01-01','x','construction']],'Contacts':[good['Contacts'][0]]};
 const s2=await stage('SUPERVISOR',await upload(second,F));assert.equal(s2.proposed.length,1);
 // 8. The person who proposed cannot check their own batch; the held row says so.
 const own=await batch('SUPERVISOR',{action:'client_batch_check',batch_ref:s2.batch_ref,note:'Checked my own work'}).catch(e=>e);
 assert.ok(own instanceof Error?/waiting/.test(own.message):own.held.length===1&&own.done.length===0,'a proposer cannot check their own batch');
 await batch('MANAGER2',{action:'client_batch_check',batch_ref:s2.batch_ref,note:'Matches the workbook entry'});
 activityFails=true;const d2=await batch('PARTNER',{action:'client_batch_approve',batch_ref:s2.batch_ref,note:'Approved after the check'});
 assert.equal(d2.done.length,1);assert.match(d2.done[0].activity,/not prepared: .*dependency-map/);assert.equal(await clientCount(),4);
});
test('the proposals screen offers the workbook button to preparers and batch buttons to the right reviewers',async()=>{
 const ui=await import('../staff-proposals.mjs?x='+Date.now());
 const me=(role,id)=>({category_code:role,staff_id:id});
 const list=[{action:'client_save',client_id:null,status:'Proposed',proposed_by:'a',payload:{batch_ref:'CB-1'}},{action:'client_save',client_id:null,status:'Checked',proposed_by:'a',checked_by:'s',payload:{batch_ref:'CB-1'}},{action:'client_save',client_id:null,status:'Proposed',proposed_by:'a',payload:{}}];
 assert.deepEqual(ui.batchGroups(list,me('SUPERVISOR','s')).map(g=>[g.ref,g.total,g.check,g.approve]),[['CB-1',2,1,0]],'a Supervisor checks but never approves');
 assert.deepEqual(ui.batchGroups(list,me('MANAGER','m')).map(g=>[g.check,g.approve]),[[1,1]]);
 assert.deepEqual(ui.batchGroups(list,me('MANAGER','s')).map(g=>[g.check,g.approve]),[[1,0]],'the person who checked cannot approve');
 assert.deepEqual(ui.batchGroups(list,me('ASSISTANT','a')).map(g=>[g.check,g.approve]),[[0,0]]);
 assert.deepEqual(ui.batchGroups(list,me('SUPERVISOR','a')).map(g=>[g.check,g.approve]),[[0,0]],'nobody checks their own batch');
 assert.match(ui.batchBar(list,me('MANAGER','m')),/Check all \(1\)[\s\S]*Approve all \(1\)/);assert.equal(ui.batchBar(list,me('ASSISTANT','a')),'');
 assert.match(ui.batchIssuesHtml({message:'Nothing was proposed.',errors:[{row:3,column:'Sector',issue:'bad <x>',suggestion:'Wholesale & Retail'}]}),/bad &lt;x&gt;|bad <x>/);
});
test('update mode: an existing client gets a change proposal carrying only what the workbook adds, never blanks or overwrites',async t=>{
 t.after(()=>db.close());
 // Reuse the harness bound to the shared db: schema is already loaded by the first test only if it ran; load again here if needed.
 const have=(await db.query(`select to_regclass('erp_private.clients') r`)).rows[0].r;
 assert.ok(have,'schema must be loaded by the earlier test');
 await db.exec('begin');
 const cid=id();
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,record_status,owner_staff_id) values(${cid},'UAT Fictional Update Ltd','P000000031A',null,'Bungoma','Corporate','Existing',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${F})`;
 await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,source_reference,recorded_by) values(${cid},'incorporation_date','2010-01-01','Prior record','certificate',${actors.MANAGER.staff_id})`;
 await db.exec('commit');
 const sheets={'Client Import':[['company_name','kra_pin','primary_sector','branch_location','client_category'],['UAT Fictional Update Ltd','P000000031A','Construction','','']],
  'Client Details':[['company_name','kra_pin','trading_name','legal_entity_type','incorporation_date','year_end_month','year_end_day'],['UAT Fictional Update Ltd','P000000031A','UAT Fictional Update Ltd','Limited company','2015-05-05',12,31]]};
 // default: left alone
 const skip=await stage('ASSISTANT',await upload(sheets,F));assert.equal(skip.proposed.length,0);assert.equal(skip.skipped_existing.length,1);
 const f=await upload(sheets,F);f.set('existing','update');
 const out=await stage('ASSISTANT',f);assert.equal(out.status,'PROPOSED');assert.equal(out.proposed.length,1);assert.equal(out.updates,1);
 const [p]=await tx`select * from erp_private.change_proposals where payload->>'batch_ref'=${out.batch_ref}`;
 assert.equal(p.client_id,cid);assert.equal(p.payload.primary_sector,'Construction');
 assert.equal(p.payload.branch_location,undefined,'a blank workbook cell is not proposed');assert.equal(p.payload.client_category,undefined);
 assert.deepEqual(Object.keys(p.payload.import_facts).sort(),['year_end'],'a recorded incorporation date is kept, only the new fact is proposed');
 assert.ok(out.notices.some(n=>n.column==='incorporation_date'&&/already recorded/.test(n.issue)));
 assert.match(p.reason,/primary sector: \(blank\) → Construction/);
 await batch('PARTNER',{action:'client_batch_check',batch_ref:out.batch_ref,note:'Matches the workbook entry'});
 const ap=await batch('MANAGER',{action:'client_batch_approve',batch_ref:out.batch_ref,note:'Approved after the check'});
 assert.equal(ap.done.length,1);assert.equal(ap.held.length,0);assert.equal(ap.done[0].client_id,cid);
 const after=(await tx`select primary_sector,branch_location from erp_private.clients where client_id=${cid}`)[0];assert.equal(after.primary_sector,'Construction');assert.equal(after.branch_location,'Bungoma');
 assert.deepEqual((await tx`select field_key,value,source_kind from erp_private.client_field_facts where client_id=${cid} order by field_key`).map(r=>r.field_key+'='+r.value+'/'+r.source_kind),['incorporation_date=2010-01-01/Prior record','year_end=12-31/Import']);
 // A second identical upload proposes nothing for a client that is already up to date after approval is simulated by checking no-change detection.

 const f2=await upload(sheets,F);f2.set('existing','update');const none=await stage('ASSISTANT',f2);assert.equal(none.proposed.length,0);assert.match(none.skipped_existing[0].reason,/No change/);
});
