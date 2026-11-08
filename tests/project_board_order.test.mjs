// Project board: most overdue first, then client name; stable paging; who is handling and at which stage.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const page=(role,p)=>as(role,a=>workspaceAction(tx,a,{action:'project_hub_page',year:'2026',show:'all',...p}));
test('project board: most overdue first, stable pages, people and stages per row',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRBO','Fictional board firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const mk=async(name,rows)=>{const C=id(),P=id(),W=id();await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},${name},${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
  await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id,tax_master) values(${P},${C},${F},${'Tax compliance '+name},'TAX-COMP',${actors.MANAGER.staff_id},true)`;
  await tx`insert into erp_private.project_work_periods(work_period_id,project_id,period_kind,starts_on,ends_on) values(${W},${P},'Monthly','2026-11-01','2026-11-30')`;
  for(const who of new Set(rows.map(r=>r[0])))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[who].staff_id},${F},${who==='MANAGER'?'MANAGER':'ASSISTANT'})`;
  for(const [who,status,due] of rows){const T=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,due_at,status) values(${T},${P},${actors[who].staff_id},'Task',${due},${status})`;await tx`insert into erp_private.work_period_tasks(task_id,work_period_id) values(${T},${W})`;}
  return P;};
 const Z=await mk('UAT Fictional Zeta Ltd',[['ASSISTANT','In Progress','2026-10-01T12:00:00Z'],['ASSISTANT','In Progress','2026-10-02T12:00:00Z']]);
 const M=await mk('UAT Fictional Mid Ltd',[['ASSISTANT','Pending','2026-10-03T12:00:00Z']]);
 const A=await mk('UAT Fictional Alpha Ltd',[['MANAGER','In Review','2099-01-01T12:00:00Z']]);
 // Most overdue first, then client name. Alpha has none overdue, so it comes last although it sorts first by name.
 const all=await page('PARTNER',{page_size:50});assert.deepEqual(all.items.map(x=>x.project_id),[Z,M,A]);assert.deepEqual(all.items.map(x=>x.overdue_count),[2,1,0]);assert.equal(all.has_more,false);
 // Who is handling and at which stage, without loading any task.
 const zeta=all.items[0];assert.deepEqual(zeta.handlers,[{staff_id:actors.ASSISTANT.staff_id,tasks:2}]);assert.deepEqual(zeta.stages,[{stage:'In Progress',tasks:2}]);assert.equal(new Date(zeta.next_due).toISOString().slice(0,10),'2026-10-01','next due is the earliest open deadline');
 const alpha=all.items[2];assert.deepEqual(alpha.handlers,[{staff_id:actors.MANAGER.staff_id,tasks:1}]);assert.deepEqual(alpha.stages,[{stage:'In Review',tasks:1}]);
 assert.equal(zeta.handler_sets,undefined,'raw tallies are not sent to the browser');
 // Pages of one: every project exactly once, in the same order, with one snapshot.
 const seen=[];let cursor={},snap=null,pages=0;
 for(;;){const r=await page('PARTNER',{page_size:1,...(snap?{snapshot_at:snap}:{}),...cursor});snap=snap||new Date(r.snapshot_at).toISOString();seen.push(...r.items.map(x=>x.project_id));pages++;if(!r.has_more)break;cursor={after_overdue:r.next_cursor.overdue_count,after_name:r.next_cursor.sort_name,after_project_id:r.next_cursor.project_id};}
 assert.deepEqual(seen,[Z,M,A]);assert.equal(pages,3);
 // Filters: overdue only, and an incomplete cursor is refused.
 assert.deepEqual((await page('PARTNER',{show:'overdue'})).items.map(x=>x.project_id),[Z,M]);
 await assert.rejects(()=>page('PARTNER',{after_overdue:1}),/incomplete/);
 await assert.rejects(()=>page('PARTNER',{after_overdue:-1,after_name:'x',after_project_id:Z}),/invalid/);
 // An Assistant sees only the engagements where they hold tasks, in the same order.
 assert.deepEqual((await page('ASSISTANT',{})).items.map(x=>x.project_id),[Z,M]);
});
test('the board draws who and which stage, deduplicates pages, and uses the new cursor',()=>{
 const v6=fs.readFileSync(path.resolve(import.meta.dirname,'../staff-workspace-v6.mjs'),'utf8'),css=fs.readFileSync(path.resolve(import.meta.dirname,'../staff-pilot.css'),'utf8');
 assert.match(v6,/after_overdue=workHub\.cursor\.overdue_count/);assert.doesNotMatch(v6,/after_created_at/);
 assert.match(v6,/boardMeta\(r\.p\)/);assert.match(v6,/Handled by/);assert.match(v6,/<em>Stage<\/em>/);assert.match(v6,/<em>Next due<\/em>/);
 assert.match(v6,/seen\.has\(x\.project_id\)/,'a project that moves between pages is not listed twice');
 assert.match(css,/\.work-row-meta\{/);
});
