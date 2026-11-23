import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),G=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const rows=(role,sql,params=[])=>as(role,()=>db.query(sql,params).then(r=>r.rows));
test('Manager staff scope: a Manager reaches the Supervisors, Assistants and Interns of her firms, and nothing wider',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}

 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'MSQA','Fictional staff scope firm'),(${G},'MSQB','Fictional other firm')`;
 const mk=async(role,cat,firms)=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;for(const f of firms)await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${f},'Assigned')`;};
 await mk('PARTNER','PARTNER',[F,G]);await mk('MANAGER','MANAGER',[F]);await mk('PEERMANAGER','MANAGER',[F]);await mk('OTHERMANAGER','MANAGER',[G]);
 await mk('SUPERVISOR','SUPERVISOR',[F]);await mk('ASSISTANT','ASSISTANT',[F]);await mk('ASSISTANTG','ASSISTANT',[G]);await mk('INTERN','INTERN',[F]);await mk('BOTH','ASSISTANT',[F,G]);
 // Everyone reports to the Partner, as in production: nobody reports to MANAGER.
 await tx`update erp_private.staff_members set manager_id=${actors.PARTNER.staff_id} where staff_id<>${actors.PARTNER.staff_id}`;
 const M=actors.MANAGER.staff_id,names=role=>rows(role,'select full_name from erp_private.staff_members order by 1').then(r=>r.map(x=>x.full_name.replace('Fictional ','')));

 // A Manager with no direct reports sees herself and every Supervisor, Assistant and Intern in her firm. Not Partners, other Managers or other firms.
 assert.deepEqual(await names('MANAGER'),['ASSISTANT','BOTH','INTERN','MANAGER','SUPERVISOR']);
 assert.deepEqual(await names('OTHERMANAGER'),['ASSISTANTG','BOTH','OTHERMANAGER'],'a Manager of another firm sees only that firm');
 assert.deepEqual(await names('PEERMANAGER'),['ASSISTANT','BOTH','INTERN','PEERMANAGER','SUPERVISOR']);
 assert.deepEqual((await names('PARTNER')).length,9,'a Partner sees everyone');
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN'])assert.deepEqual(await names(role),[role],role+' sees only themselves');
 assert.equal((await rows('MANAGER','select erp_private.manager_staff_scope($1::uuid) ok',[actors.ASSISTANT.staff_id]))[0].ok,true);
 for(const k of ['ASSISTANTG','PARTNER','PEERMANAGER','OTHERMANAGER'])assert.equal((await rows('MANAGER','select erp_private.manager_staff_scope($1::uuid) ok',[actors[k].staff_id]))[0].ok,false,k+' is outside the Manager firm scope');
 assert.equal((await rows('SUPERVISOR','select erp_private.manager_staff_scope($1::uuid) ok',[actors.ASSISTANT.staff_id]))[0].ok,false,'only Managers get this scope');
 // The firm links she needs to place them.
 assert.deepEqual((await rows('MANAGER','select distinct s.full_name from erp_private.staff_firm_access f join erp_private.staff_members s using(staff_id) order by 1')).map(r=>r.full_name.replace('Fictional ','')),['ASSISTANT','BOTH','INTERN','MANAGER','SUPERVISOR'],'firm links of Partners and other Managers stay hidden');

 // Area and right restrictions: she can restrict and restore an Assistant in her firm, and nobody outside it.
 const restrict=(role,target,area)=>as(role,a=>db.query(`insert into erp_private.staff_area_restrictions(staff_id,area_code,reason,created_by) values($1,$2,'Fictional reason',$3)`,[target,area,a.staff_id]));
 await restrict('MANAGER',actors.ASSISTANT.staff_id,'billing_wip');await restrict('MANAGER',actors.SUPERVISOR.staff_id,'leads');await restrict('MANAGER',actors.BOTH.staff_id,'audit');
 for(const k of ['ASSISTANTG','PARTNER','PEERMANAGER'])await assert.rejects(restrict('MANAGER',actors[k].staff_id,'leads'),/row-level security/,'cannot restrict '+k);
 assert.equal((await rows('MANAGER','select count(*)::int n from erp_private.staff_area_restrictions'))[0].n,3);
 assert.equal((await rows('MANAGER',`delete from erp_private.staff_area_restrictions where staff_id=$1 returning area_code`,[actors.SUPERVISOR.staff_id])).length,1,'she can restore access');
 const right=(role,target)=>as(role,a=>db.query(`insert into erp_private.staff_right_restrictions(staff_id,right_code,reason,created_by) values($1,'clientops.review','Fictional reason',$2)`,[target,a.staff_id]));
 await right('MANAGER',actors.ASSISTANT.staff_id);await assert.rejects(right('MANAGER',actors.ASSISTANTG.staff_id),/row-level security/);await assert.rejects(right('MANAGER',actors.PARTNER.staff_id),/row-level security/);
 // Updating a profile follows the same scope.
 const upd=(role,target)=>rows(role,`update erp_private.staff_members set branch_location='Nairobi' where staff_id=$1 returning staff_id`,[target]);
 assert.equal((await upd('MANAGER',actors.ASSISTANT.staff_id)).length,1);
 for(const k of ['ASSISTANTG','PARTNER','PEERMANAGER'])assert.equal((await upd('MANAGER',actors[k].staff_id)).length,0,'cannot update '+k);
 assert.equal((await rows('MANAGER',`update erp_private.staff_members set category_code='PARTNER' where staff_id=$1 returning staff_id`,[actors.ASSISTANT.staff_id]).catch(()=>[])).length,0,'a Manager cannot promote anyone');
 // Sensitive records keep the reporting-line check: attendance of someone who does not report to her stays hidden.
 await tx`insert into erp_private.attendance(staff_id,work_date,clock_in,location,status) values(${actors.ASSISTANT.staff_id},current_date,now(),'Office','Present')`;
 assert.equal((await rows('MANAGER','select count(*)::int n from erp_private.attendance'))[0].n,0,'attendance is not opened by the firm scope');
 assert.equal((await rows('PARTNER','select count(*)::int n from erp_private.attendance'))[0].n,1);
 await tx`update erp_private.staff_members set manager_id=${M} where staff_id=${actors.ASSISTANT.staff_id}`;
 assert.equal((await rows('MANAGER','select count(*)::int n from erp_private.attendance'))[0].n,1,'the reporting line still opens it');
 // Leaving the firm ends her reach.
 await tx`update erp_private.staff_firm_access set deleted_at=now() where staff_id=${actors.INTERN.staff_id}`;
 assert.ok(!(await names('MANAGER')).includes('INTERN'),'a person who left the firm is no longer listed');
});
