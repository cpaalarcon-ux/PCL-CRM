import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {readWorkspaceLanding} from '../supabase/functions/staff-workspace-v12/workspace-read.ts';

test('the landing read returns a bounded list of assigned open work within the permitted firms', async ()=>{
 const db=new PGlite();
 try{
  await db.exec(`
    create schema erp_private;
    create function erp_private.uat_scope_enabled() returns boolean language sql as $$ select false $$;
    create table erp_private.staff_area_restrictions (staff_id text, area_code text);
    create table erp_private.staff_right_restrictions (staff_id text, right_code text);
    create table erp_private.firms (firm_id uuid, firm_code text, legal_name text, deleted_at timestamptz);
    create table erp_private.clients (client_id text, deleted_at timestamptz);
    create table erp_private.projects (project_id text, client_id text, handling_firm_id uuid, project_name text, deleted_at timestamptz);
    create table erp_private.tasks (task_id text, project_id text, assigned_to text, task_name text, status text, due_at timestamptz, deleted_at timestamptz);
    insert into erp_private.firms values
      ('00000000-0000-4000-8000-000000000001','ONE','Firm One',null),
      ('00000000-0000-4000-8000-000000000002','TWO','Firm Two',null),
      ('00000000-0000-4000-8000-000000000003','OFF','Deleted Firm',now());
    insert into erp_private.clients values ('client',null);
    insert into erp_private.projects values
      ('p1','client','00000000-0000-4000-8000-000000000001','Project One',null),
      ('p2','client','00000000-0000-4000-8000-000000000002','Project Two',null);
    insert into erp_private.tasks
      select 'task-'||n,'p1','my-staff','My task '||n,'Pending',now()+interval '2 days',null from generate_series(1,6) n;
    insert into erp_private.tasks values
      ('overdue','p2','my-staff','My overdue task','Pending',now()-interval '2 days',null),
      ('other','p1','other-staff','Someone else’s task','Pending',now()-interval '2 days',null),
      ('done','p1','my-staff','Completed task','Completed',null,null),
      ('deleted','p1','my-staff','Deleted task','Pending',null,now());
  `);
  const tx=async(strings,...parameters)=>(await db.query(strings.reduce((query,part,i)=>query+(i?'$'+i:'')+part,''),parameters)).rows;
  const actor={staff_id:'my-staff',login_id:'test-assistant',full_name:'Test Assistant',category_code:'ASSISTANT'};
  const landing=await readWorkspaceLanding(tx,actor);
  assert.deepEqual(Object.keys(landing).sort(),['firm_id','firms','me','my_work','uat_client_scope']);
  assert.equal(landing.firms.length,2);
  assert.equal(landing.me.allowed_areas.includes('billing_wip'),false);
  assert.equal(landing.me.can_open_messenger,true);
  assert.equal(landing.my_work.open_count,7);
  assert.equal(landing.my_work.overdue_count,1);
  assert.equal(landing.my_work.tasks.length,5);
  assert.equal(landing.my_work.tasks[0].task_id,'overdue');
  assert.deepEqual(Object.keys(landing.my_work.tasks[0]).sort(),['due_at','project_name','status','task_id','task_name']);

  const firmLanding=await readWorkspaceLanding(tx,actor,landing.firms[0].firm_id);
  assert.equal(firmLanding.my_work.open_count,6);
  assert.equal(firmLanding.my_work.overdue_count,0);
  assert.ok(firmLanding.my_work.tasks.every(t=>t.project_name==='Project One'));
  assert.equal((await readWorkspaceLanding(tx,{...actor,category_code:'ADMIN'})).my_work,null);
  await db.exec("insert into erp_private.staff_right_restrictions values ('my-staff','task.view'),('my-staff','messenger.view')");
  assert.equal((await readWorkspaceLanding(tx,actor)).my_work,null);
  assert.equal((await readWorkspaceLanding(tx,actor)).me.can_open_messenger,false);
  await db.exec("delete from erp_private.staff_right_restrictions; insert into erp_private.staff_area_restrictions values ('my-staff','projects')");
  const restricted=await readWorkspaceLanding(tx,actor);
  assert.equal(restricted.my_work,null);
  assert.equal(restricted.me.allowed_areas.includes('projects'),false);
 }finally{
  await db.close();
 }
});
