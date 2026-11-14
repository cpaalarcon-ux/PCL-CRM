// Build .108: View Staff. The database decides who may be viewed; the screens only show it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {hasPicker,pickerOptions,targetOf,attendanceTitle,teamTitle,narrowTasks,attendanceCards,DEFAULT,aggregateLabel} from '../staff-view-staff.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
test('dropdown, titles and task narrowing',()=>{
 const people=[{staff_id:'m1',full_name:'Sarah Arotini',category_code:'MANAGER'},{staff_id:'a1',full_name:'Tonnic Otieno',category_code:'ASSISTANT'}];
 const mgr={role:'MANAGER',people},sup={role:'SUPERVISOR',people:[people[1]]},asst={role:'ASSISTANT',people:[]};
 assert.ok(hasPicker(mgr));assert.ok(hasPicker(sup));assert.ok(!hasPicker(asst),'Assistants get no dropdown');assert.ok(!hasPicker(null));assert.equal(pickerOptions(asst,esc),'');
 let h=pickerOptions(mgr,esc,DEFAULT,'m1');assert.match(h,/>All Staff</);assert.match(h,/>My Profile</);assert.match(h,/Tonnic Otieno/);assert.doesNotMatch(h,/Sarah Arotini/,'you are listed as My Profile, not twice');
 assert.equal(aggregateLabel('SUPERVISOR'),'My Team');assert.match(pickerOptions(sup,esc,DEFAULT,'s1'),/>My Team</);
 assert.equal(targetOf(DEFAULT,'m1'),null);assert.equal(targetOf('me','m1'),'m1');assert.equal(targetOf('a1','m1'),'a1');
 assert.equal(attendanceTitle(DEFAULT,mgr),'Firm attendance');assert.equal(attendanceTitle(DEFAULT,sup),'Team attendance');assert.equal(attendanceTitle('me',mgr),'My attendance');assert.equal(attendanceTitle('m1',mgr),'Sarah’s attendance');
 assert.equal(teamTitle(DEFAULT,mgr),'All staff');assert.equal(teamTitle('a1',mgr),'Tonnic’s workload');
 const tasks=[{task_id:1,assigned_to:'a1'},{task_id:2,assigned_to:'m1'},{task_id:3,assigned_to:'x',prepared_by:'a1'}];
 assert.equal(narrowTasks(tasks,DEFAULT,'m1').length,3);assert.deepEqual(narrowTasks(tasks,'a1','m1').map(t=>t.task_id),[1,3]);assert.deepEqual(narrowTasks(tasks,'me','m1').map(t=>t.task_id),[2]);
});
test('attendance cards flag more than 10 hours clocked in',()=>{
 const html=attendanceCards([{staff_id:'a1',full_name:'Tonnic Otieno',category_code:'ASSISTANT',status:'Active',clock_in:'2026-11-09T04:00:00Z',open_hours:13.2,over_ten_hours:true},{staff_id:'a2',full_name:'Calm Person',category_code:'ASSISTANT',status:'Active',clock_in:'2026-11-09T05:00:00Z',open_hours:4,over_ten_hours:false},{staff_id:'a3',full_name:'Absent One',category_code:'ASSISTANT',status:'Not clocked in'}],esc);
 assert.equal((html.match(/Clocked in over 10 hours/g)||[]).length,1);assert.match(html,/att-card att-alert" data-staff="a1"/);assert.match(html,/Not clocked in today/);assert.match(attendanceCards([],esc),/Nobody to show/);
});
test('page and server wiring',()=>{
 assert.match(rd('staff-pilot.html'),/id="staffFilter"/);
 const pilot=rd('staff-pilot.mjs');assert.match(pilot,/staff-view-staff\.mjs\?v=20261109-vs-v1/);assert.match(pilot,/view_staff_options/);assert.match(pilot,/presence_team',target_staff_id/);assert.match(pilot,/narrowTasks\(data\.tasks,viewStaff/);
 assert.match(rd('staff-team.mjs'),/target_staff_id:ctx\.viewTarget/);
 assert.match(rd(fx+'presence-actions.ts'),/view_staff_ids\(\$\{target\}::uuid\)/);assert.match(rd(fx+'team-actions.ts'),/view_staff_ids\(\$\{target\}::uuid\)/);
 assert.match(rd(fx+'staff-access-control.mjs'),/presence_\|view_staff_/);assert.match(rd(fx+'index.ts'),/viewStaffAction\(tx,a,p\)/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('the database allows exactly the people each role may view',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 // Partner > Manager > Supervisor > Assistant1 (reports to Supervisor); Assistant2 reports to the Manager directly; Admin; an inactive person.
 const mk=async(key,cat,mgr,status='Active')=>{const a=actors[key]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,manager_id,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${key},${key.toLowerCase()},${'Fictional '+key},${cat},${mgr},'Permanent','2027-12-31',${status},now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;};
 await mk('PARTNER','PARTNER',null);await mk('MANAGER','MANAGER',actors.PARTNER.staff_id);await mk('SUPERVISOR','SUPERVISOR',actors.MANAGER.staff_id);
 await mk('ASSISTANT1','ASSISTANT',actors.SUPERVISOR.staff_id);await mk('ASSISTANT2','ASSISTANT',actors.MANAGER.staff_id);await mk('ADMIN','ADMIN',actors.PARTNER.staff_id);await mk('GONE','ASSISTANT',actors.SUPERVISOR.staff_id,'Inactive');
 const ids=(role,target=null)=>as(role,()=>tx`select staff_id from erp_private.view_staff_ids(${target}::uuid)`).then(r=>r.map(x=>x.staff_id).sort());
 const sort=(...k)=>k.map(x=>actors[x].staff_id).sort();
 // Assistants: only themselves, whoever they ask for.
 assert.deepEqual(await ids('ASSISTANT1'),sort('ASSISTANT1'));
 assert.deepEqual(await ids('ASSISTANT1',actors.ASSISTANT2.staff_id),sort('ASSISTANT1'),'a requested person is ignored');
 // Supervisor: self and the people who report to them; asking for anyone else is refused.
 assert.deepEqual(await ids('SUPERVISOR'),sort('SUPERVISOR','ASSISTANT1'),'suspended and unrelated people are not in the team');
 assert.deepEqual(await ids('SUPERVISOR',actors.ASSISTANT1.staff_id),sort('ASSISTANT1'));
 await assert.rejects(()=>ids('SUPERVISOR',actors.ASSISTANT2.staff_id),/not in your team/);
 await assert.rejects(()=>ids('SUPERVISOR',actors.PARTNER.staff_id),/not in your team/);
 // Manager and Partner: every active person except administrators, or any one of them.
 const everyone=sort('PARTNER','MANAGER','SUPERVISOR','ASSISTANT1','ASSISTANT2');
 assert.deepEqual(await ids('MANAGER'),everyone);assert.deepEqual(await ids('PARTNER'),everyone);
 assert.deepEqual(await ids('MANAGER',actors.ASSISTANT2.staff_id),sort('ASSISTANT2'));
 await assert.rejects(()=>ids('PARTNER',actors.ADMIN.staff_id),/not available/);await assert.rejects(()=>ids('PARTNER',actors.GONE.staff_id),/not available/);
 // The dropdown list matches the scope.
 const opts=role=>as(role,()=>tx`select staff_id from erp_private.view_staff_options()`).then(r=>r.map(x=>x.staff_id).sort());
 assert.deepEqual(await opts('SUPERVISOR'),sort('SUPERVISOR','ASSISTANT1'));assert.deepEqual(await opts('PARTNER'),everyone);assert.deepEqual(await opts('ASSISTANT2'),sort('ASSISTANT2'));
});
