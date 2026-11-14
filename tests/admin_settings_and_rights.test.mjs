import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {staffRightsAction}=await import('../supabase/functions/staff-workspace-v12/staff-rights-actions.ts');
const {referenceAction}=await import('../supabase/functions/staff-workspace-v12/reference-actions.ts');
const {taxConfigAction}=await import('../supabase/functions/staff-workspace-v12/tax-config-actions.ts');
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const {effectiveStaffAreas,areaForStaffAction,staffAreaCanUse}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
const root=path.resolve(import.meta.dirname,'..');

test('System Administrator settings rights and Partner-granted additional rights',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'RGT','Fictional rights firm')`;
 for(const [role,cat] of [['PARTNER','PARTNER'],['PARTNER2','PARTNER'],['MGR','MANAGER'],['SUP','SUPERVISOR'],['ASST','ASSISTANT'],['ADM','ADMIN']]){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2030-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const rights=(r,p)=>as(r,a=>staffRightsAction(tx,a,p)),ref=(r,p)=>as(r,a=>referenceAction(tx,a,p)),rel=(r,p)=>as(r,a=>taxConfigAction(tx,a,p)),ws=(r,p)=>as(r,a=>workspaceAction(tx,a,p));

 await t.test('Administrator areas: settings yes; clients, projects, documents, billing, audit no',()=>{
  const areas=effectiveStaffAreas('ADMIN',[]);assert.deepEqual([...areas].sort(),['communications','settings','staff_access']);
  for(const area of ['clients','projects','documents','billing_wip','audit','leads','time_hr'])assert.equal(staffAreaCanUse('ADMIN',[],area),false,area);
  assert.equal(areaForStaffAction('staff_rights_read'),'staff_access');assert.equal(areaForStaffAction('staff_right_grant'),'staff_access');
 });
 await t.test('Administrator can add a sector, upload and list reference documents, and read release readiness',async()=>{
  const s=await ws('ADM',{action:'sector_save',name:'Fictional logistics'});assert.equal(s.sector.name,'Fictional logistics');
  await assert.rejects(()=>ws('ASST',{action:'sector_save',name:'Not allowed'}),/must add sectors/);
  const rid=id(),a=actors.ADM;
  await as('ADM',()=>tx`insert into erp_private.reference_documents(reference_id,title,version_label,file_name,object_key,sha256,mime_type,file_size_bytes,uploaded_by) values(${rid},'Fictional spec','v1','spec.pdf','references/x/spec.pdf',${'a'.repeat(64)},'application/pdf',10,${a.staff_id})`);
  await as('ADM',()=>tx`insert into erp_private.reference_access_events(reference_id,actor_id,action) values(${rid},${a.staff_id},'UPLOAD')`);
  const list=await ref('ADM',{action:'reference_list'});assert.equal(list.references.length,1);assert.equal(list.references[0].status,'Awaiting review');
  await assert.rejects(()=>ref('ADM',{action:'reference_approve',reference_id:rid,approval_note:'Admin tries to approve'}),/Managers and the Engagement Partner/);
  await assert.rejects(()=>as('ADM',()=>tx`update erp_private.reference_documents set status='Approved' where reference_id=${rid} returning 1`).then(r=>{if(!r.length)throw new Error('no rows');}),/no rows|permission|policy/);
  await assert.rejects(()=>as('ADM',()=>tx`insert into erp_private.reference_documents(title,version_label,file_name,object_key,sha256,mime_type,file_size_bytes,uploaded_by,status) values('x','v','f','k',${'b'.repeat(64)},'application/pdf',1,${a.staff_id},'Approved')`),/policy|violates/);
  const r=await rel('ADM',{action:'release_read'});assert.equal(r.read_only,true);assert.equal(r.automatic_checks,null);assert.ok(Array.isArray(r.checks));
  await assert.rejects(()=>rel('ADM',{action:'release_check_save',check_code:'X',revision:1,status:'Passed',evidence:'x'}),/Partner approval/);
 });
 await t.test('Administrator still has no client data or tax rule rights',async()=>{
  await assert.rejects(()=>rel('ADM',{action:'rate_save',rate_key:'X',tax_type:'VAT',label:'x',effective_from:'2026-01-01',effective_to:'2026-12-31',parameters:{}}),/Partner or Manager/);
  const c=await as('ADM',()=>tx`select count(*)::int n from erp_private.clients`);assert.equal(c[0].n,0);
  await assert.rejects(()=>as('ADM',()=>tx`insert into erp_private.clients(company_name,owner_staff_id) values('UAT FICTIONAL X',${actors.ADM.staff_id})`),/policy|violates/);
 });
 await t.test('Only a Partner grants additional rights, with a reason and an end date',async()=>{
  const today=(await tx`select (now() at time zone 'Africa/Nairobi')::date::text d`)[0].d,plus=n=>(await_=>new Date(Date.parse(today)+n*864e5).toISOString().slice(0,10))();
  for(const r of ['MGR','SUP','ASST','ADM'])await assert.rejects(()=>rights(r,{action:'staff_rights_read'}),/Only an Engagement Partner/);
  const base={action:'staff_right_grant',staff_id:actors.SUP.staff_id,capability:'FINANCE',reason:'Covers client advances while the Manager is on leave',expires_on:plus(30)};
  await assert.rejects(()=>rights('MGR',base),/Only an Engagement Partner/);
  await assert.rejects(()=>rights('PARTNER',{...base,reason:'short'}),/reason/);
  await assert.rejects(()=>rights('PARTNER',{...base,expires_on:plus(-1)}),/end date/);
  await assert.rejects(()=>rights('PARTNER',{...base,expires_on:plus(400)}),/end date/);
  await assert.rejects(()=>rights('PARTNER',{...base,expires_on:undefined}),/end date/);
  await assert.rejects(()=>rights('PARTNER',{...base,capability:'HR'}),/Only the FINANCE right/);
  await assert.rejects(()=>rights('PARTNER',{...base,staff_id:actors.PARTNER.staff_id}),/yourself/);
  await assert.rejects(()=>rights('PARTNER',{...base,staff_id:actors.PARTNER2.staff_id}),/already hold/);
  await assert.rejects(()=>rights('PARTNER',{...base,staff_id:actors.ADM.staff_id}),/Administrators/);
  const g=await rights('PARTNER',base);assert.ok(g.grant_id);
  assert.equal((await as('SUP',()=>tx`select erp_private.has_capability('FINANCE') ok`))[0].ok,true);
  assert.equal((await as('ASST',()=>tx`select erp_private.has_capability('FINANCE') ok`))[0].ok,false);
  await assert.rejects(()=>rights('PARTNER',base),/already has the right/);
  const o=await rights('PARTNER',{action:'staff_rights_read'});const row=o.staff.find(s=>s.staff_id===actors.SUP.staff_id);assert.equal(row.grants.length,1);assert.equal(row.grants[0].capability,'FINANCE');assert.equal(row.grants[0].granted_by_name,'Fictional PARTNER');assert.equal(o.history[0].event,'Granted');
  // the right stops by itself on the end date
  await tx`update erp_private.staff_capabilities set expires_on=(now() at time zone 'Africa/Nairobi')::date-1 where grant_id=${g.grant_id}`;
  assert.equal((await as('SUP',()=>tx`select erp_private.has_capability('FINANCE') ok`))[0].ok,false,'expired right no longer applies');
  await tx`update erp_private.staff_capabilities set expires_on=(now() at time zone 'Africa/Nairobi')::date+5 where grant_id=${g.grant_id}`;
  assert.equal((await as('SUP',()=>tx`select erp_private.has_capability('FINANCE') ok`))[0].ok,true);
  await assert.rejects(()=>rights('MGR',{action:'staff_right_revoke',grant_id:g.grant_id,reason:'Not allowed'}),/Only an Engagement Partner/);
  await rights('PARTNER2',{action:'staff_right_revoke',grant_id:g.grant_id,reason:'Manager is back from leave'});
  assert.equal((await as('SUP',()=>tx`select erp_private.has_capability('FINANCE') ok`))[0].ok,false);
  await assert.rejects(()=>rights('PARTNER',{action:'staff_right_revoke',grant_id:g.grant_id,reason:'Again'}),/already withdrawn/);
  const o2=await rights('PARTNER',{action:'staff_rights_read'});assert.deepEqual(o2.history.map(h=>h.event).sort(),['Granted','Revoked']);
  // can be granted again after withdrawal
  await rights('PARTNER',base);
  const audit=await tx`select action from erp_private.audit_events where table_name='staff_capabilities' order by event_id`;assert.deepEqual(audit.map(x=>x.action),['STAFF_RIGHT_GRANTED','STAFF_RIGHT_REVOKED','STAFF_RIGHT_GRANTED']);
 });
});
