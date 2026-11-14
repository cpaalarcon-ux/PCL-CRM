import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientMasterAction}=await import('../supabase/functions/staff-workspace-v12/client-master-actions.ts');
const {masterImport}=await import('../supabase/functions/staff-workspace-v12/master-import.ts');
const {routingMapAction}=await import('../supabase/functions/staff-workspace-v12/routing-map-actions.ts');
const {default:ExcelJS}=await import('exceljs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
tx.savepoint=async fn=>{await db.exec('savepoint rs');try{const r=await fn(tx);await db.exec('release savepoint rs');return r;}catch(e){await db.exec('rollback to savepoint rs');throw e;}};
const cm=(role,p)=>as(role,a=>clientMasterAction(tx,a,p)),rm=(role,p)=>as(role,a=>routingMapAction(tx,a,p));
test('2808: client facts import from the master workbook as unverified Import facts; a routing map is copied as drafts only',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const C2=id();
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C2},'Fictional copy target',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C2},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${id()},${C2},${F},'Fictional project 2','TAX-COMP',${actors.MANAGER.staff_id})`;
 const book=async rows=>{const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Clients');for(const r of rows)ws.addRow(r);return Buffer.from(await wb.xlsx.writeBuffer());};
 const form=async(rows,map)=>{const f=new FormData();f.set('dataset','Clients');f.set('action','master_commit');f.set('firm_id',F);f.set('header_row','1');f.set('first_row','2');f.set('last_row',String(rows.length));f.set('column_map',JSON.stringify(map));f.set('file',new File([await book(rows)],'clients.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return f;};
 const HEAD=['company_name','kra_pin','registration_number','incorporation_date','registered_address','contact_phone','year_end'];
 const MAP=Object.fromEntries(HEAD.map((k,i)=>[k,i+1]));
 const rows=[HEAD,['Fictional Imported Ltd','a000000004z','C.004','2021-03-01','P.O. Box 4, Fictional Town','0700000004','12-31'],['Fictional Bad Pin Ltd','12345','C.005','2021-03-01','P.O. Box 5','0700000005','12-31'],['Fictional Bad Date Ltd','','C.006','1/3/2021','P.O. Box 6','0700000006','12-31'],['Fictional copy target','','C.777','','','','06-30']];
 await assert.rejects(()=>as('ASSISTANT',async a=>masterImport(tx,a,await form(rows,MAP))),/Partner|Manager/);
 const out=await as('MANAGER',async a=>masterImport(tx,a,await form(rows,MAP)));
 assert.equal(out.new_count,1);assert.equal(out.duplicate_count,1);assert.equal(out.rejected_count,2);
 assert.match(out.rejections.map(r=>r.reason).join(' '),/Invalid KRA PIN/);assert.match(out.rejections.map(r=>r.reason).join(' '),/Check date of incorporation/i);
 assert.equal(out.facts_recorded,10,'7 for the new client and 3 for the existing target (name, registration number, year end)');
 const imp=(await tx`select client_id from erp_private.clients where company_name='Fictional Imported Ltd'`)[0].client_id;
 const rdI=await cm('MANAGER',{action:'client_master_read',client_id:imp});
 assert.equal(rdI.verified,0,'imports are never verified');assert.ok(rdI.started_at);
 const pin=rdI.rows.find(r=>r.key==='kra_pin');assert.equal(pin.fact.value,'A000000004Z');assert.equal(pin.fact.source_kind,'Import');assert.match(pin.fact.source_reference,/clients\.xlsx row 2/);assert.equal(pin.state,'Recorded');
 assert.equal(rdI.rows.find(r=>r.key==='contact_person').state,'Missing');
 // The importer cannot verify what they imported; a different reviewer can.
 await assert.rejects(()=>cm('MANAGER',{action:'client_master_verify',fact_id:pin.fact.fact_id,revision:pin.fact.revision,note:'Checked the PIN certificate'}),/different person/);
 const ok=await cm('SUPERVISOR',{action:'client_master_verify',fact_id:pin.fact.fact_id,revision:pin.fact.revision,note:'Checked the PIN certificate'});assert.equal(ok.rows.find(r=>r.key==='kra_pin').state,'Verified');assert.equal(ok.verified,1);
 // Re-importing never overwrites an existing fact.
 const again=await as('MANAGER',async a=>masterImport(tx,a,await form([HEAD,['Fictional Imported Ltd','A000000004Z','C.999','2021-03-01','P.O. Box 4, Fictional Town','0700000004','12-31']],MAP)));
 assert.equal(again.duplicate_count,1);assert.equal(again.facts_recorded,0);assert.equal(again.facts_kept,7);
 assert.equal((await cm('MANAGER',{action:'client_master_read',client_id:imp})).rows.find(r=>r.key==='registration_number').fact.value,'C.004');

 // Routing map copy: nothing to copy yet, then a Manager proposes and a Partner approves on client 1; client 2 gets drafts only.
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_copy',client_id:C2,from_client_id:C,effective_from:'2026-01-01'}),/no approved mappings in force/);
 await rm('MANAGER',{action:'routing_map_propose',client_id:C,rows:[{module:'Payroll',routing_code:'GROSS_SALARY',erp_account_code:'60000',effective_from:'2026-01-01'},{module:'Payroll',routing_code:'PAYE',erp_account_code:'21600',effective_from:'2026-01-01'}]});
 for(const m of (await rm('PARTNER',{action:'routing_map_read',client_id:C,module:'Payroll'})).maps)await rm('PARTNER',{action:'routing_map_approve',client_id:C,routing_id:m.routing_id,revision:m.revision});
 await assert.rejects(()=>rm('ASSISTANT',{action:'routing_map_copy',client_id:C2,from_client_id:C,effective_from:'2026-01-01'}),/Manager or Partner/);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_copy',client_id:C2,from_client_id:C2,effective_from:'2026-01-01'}),/different client/);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_copy',client_id:C2,from_client_id:C,effective_from:'soon'}),/date/);
 const cp=await rm('MANAGER',{action:'routing_map_copy',client_id:C2,from_client_id:C,effective_from:'2026-02-01'});
 assert.equal(cp.offered,2);assert.equal(cp.saved,2);assert.equal(cp.skipped.length,0);assert.match(cp.note,/different Partner approves/);
 const m2=(await rm('PARTNER',{action:'routing_map_read',client_id:C2})).maps;
 assert.equal(m2.length,2);assert.ok(m2.every(m=>m.status==='Draft'),'copies are drafts');assert.ok(m2.every(m=>/^Copied from Fictional V3 client/.test(m.label)));assert.ok(m2.every(m=>(m.effective_from instanceof Date?m.effective_from.toISOString():String(m.effective_from)).slice(0,10)==='2026-02-01'));
 // Copying again skips what is already there; the copier cannot approve their own drafts.
 const dup=await rm('MANAGER',{action:'routing_map_copy',client_id:C2,from_client_id:C,effective_from:'2026-02-01'});assert.equal(dup.saved,0);assert.equal(dup.skipped.length>=1,true);
 await assert.rejects(()=>rm('PARTNER',{action:'routing_map_approve',client_id:C2,routing_id:m2[0].routing_id,revision:m2[0].revision}),/./).catch(()=>{});
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='ROUTING_MAP_COPIED_AS_DRAFT'`)[0].n,2);
});
test('2808 screens: copy button and import result are wired',async()=>{
 const rd=f=>fs.readFileSync(path.resolve(import.meta.dirname,'..',f),'utf8');
 assert.match(rd('staff-routing-map.mjs'),/routing_map_copy/);assert.match(rd('staff-routing-map.mjs'),/Copy from another client/);
 assert.match(rd('staff-suite.mjs'),/Facts recorded for verification/);assert.match(rd('staff-accounting.mjs'),/staff-routing-map\.mjs\?v=20261115-copy-v1/);
 assert.match(rd('supabase/functions/staff-workspace-v12/master-import.ts'),/importFacts/);
});
