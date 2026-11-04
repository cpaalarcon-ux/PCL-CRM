import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {discussionAction}=await import('../supabase/functions/staff-workspace-v12/discussion-actions.ts');
const {defaultStaffAreas,areaForStaffAction,staffAreaCanUse}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chat=(role,p)=>as(role,a=>discussionAction(tx,a,p));
const count=(role,table)=>as(role,async()=>(await db.query('select count(*)::int n from erp_private.'+table)).rows[0].n);
const newStaff=async(role,cat=role.replace(/\d/,''))=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat,full_name:'Fictional '+role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${a.full_name},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;return a;};
test('System Administrators run logins and chat groups without seeing client work; groups behave like a messenger',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'MSQA','Fictional messenger firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT','ASSISTANT2','INTERN','ADMIN','ADMIN2','ADMIN3'])await newStaff(role);
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Mlima monthly tax','TAX-COMP',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors.ASSISTANT.staff_id},${F},'ASSISTANT')`;

 // Three System Administrators at most; only a Partner manages their accounts; they never hold client work.
 await assert.rejects(()=>newStaff('ADMIN4','ADMIN'),/at most three/);
 await assert.rejects(()=>as('MANAGER',()=>tx`insert into erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,employment_type,manager_id) values(${id()},'NEWADM','newadm','Fictional New Admin','ADMIN','Permanent',${actors.MANAGER.staff_id})`),/System Administrator|row-level security/);
 await assert.rejects(()=>tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors.ADMIN.staff_id},${F},'ADMIN')`,/cannot be assigned to client work/);
 for(const table of ['clients','projects','tasks','documents','ledger_lines'])assert.equal(await count('ADMIN',table),0,`a System Administrator sees no ${table}`);
 assert.deepEqual(defaultStaffAreas('ADMIN'),['communications','staff_access']);
 assert.equal(staffAreaCanUse('ADMIN',[],areaForStaffAction('client_save')),false);assert.equal(staffAreaCanUse('ADMIN',[],areaForStaffAction('staff_save')),true);assert.equal(staffAreaCanUse('ADMIN',[],areaForStaffAction('discussion_list')),true);

 // Logins: an administrator creates ordinary staff but never a Manager or another administrator.
 const ordinary=id();
 await as('ADMIN',()=>tx`insert into erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,employment_type,manager_id) values(${ordinary},'NEWAST','newast','Fictional New Assistant','ASSISTANT','Permanent',null)`);
 await assert.rejects(()=>as('ADMIN',()=>tx`insert into erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,employment_type,manager_id) values(${id()},'NEWMGR','newmgr','Fictional New Manager','MANAGER','Permanent',null)`),/row-level security|violates/);
 assert.ok((await as('ADMIN',()=>tx`select staff_id from erp_private.staff_members where staff_id=${actors.PARTNER.staff_id}`)).length===1,'the administrator can list staff');

 // Groups: created and staffed by an administrator only.
 await assert.rejects(()=>chat('ASSISTANT',{action:'discussion_staff_directory'}),/Only a System Administrator/);
 await assert.rejects(()=>chat('MANAGER',{action:'discussion_group_create',title:'Not allowed',member_ids:[actors.ASSISTANT.staff_id,actors.ASSISTANT2.staff_id]}),/Only a System Administrator/);
 const directory=(await chat('ADMIN',{action:'discussion_staff_directory'})).staff.map(x=>x.full_name);
 assert.ok(directory.includes('Fictional ASSISTANT')&&directory.includes('Fictional MANAGER'));
 await assert.rejects(()=>chat('ADMIN',{action:'discussion_group_create',title:'Too small',member_ids:[actors.ASSISTANT.staff_id]}),/at least two/);
 const g=await chat('ADMIN',{action:'discussion_group_create',title:'Filing deadlines',member_ids:[actors.ASSISTANT.staff_id,actors.ASSISTANT2.staff_id,actors.MANAGER.staff_id]});
 assert.ok(g.channel_id);
 const overview=(await chat('ADMIN',{action:'discussion_group_overview'})).groups;
 assert.equal(overview.length,1);assert.equal(overview[0].members.length,3);
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where message like 'You were added to the chat group%'`)[0].n,3);

 // Members see it; outsiders, interns and the administrator (not a member) do not, and the administrator cannot read it.
 assert.deepEqual((await chat('ASSISTANT',{action:'discussion_list'})).channels.map(c=>c.display_title),['Filing deadlines']);
 assert.equal((await chat('INTERN',{action:'discussion_list'})).channels.length,0);
 assert.equal((await chat('ADMIN',{action:'discussion_list'})).channels.length,0,'an administrator is not silently a member');
 await assert.rejects(()=>chat('ADMIN',{action:'discussion_messages',channel_id:g.channel_id}),/not available/);
 await assert.rejects(()=>chat('INTERN',{action:'discussion_messages',channel_id:g.channel_id}),/not available/);
 const sent=await chat('ASSISTANT',{action:'discussion_send',channel_id:g.channel_id,request_id:id(),body:'Please post the PAYE returns by Friday.'});
 assert.ok(sent.message_id);
 const l2=(await chat('ASSISTANT2',{action:'discussion_list'})).channels[0];
 assert.equal(l2.unread,1);assert.equal(l2.last_body,'Please post the PAYE returns by Friday.');
 assert.equal(l2.last_author_name,'Fictional ASSISTANT','the list says who wrote the last message');
 assert.equal((await chat('ASSISTANT',{action:'discussion_list'})).channels[0].unread,0,'your own message is not unread');
 await assert.rejects(()=>chat('INTERN',{action:'discussion_send',channel_id:g.channel_id,request_id:id(),body:'I am not a member.'}),/not available/);
 assert.equal((await chat('ASSISTANT2',{action:'discussion_messages',channel_id:g.channel_id})).messages.length,1);
 assert.equal((await chat('MANAGER',{action:'discussion_group_overview',channel_id:g.channel_id})).groups[0].members.length,3,'a member sees who is in the group');
 assert.equal((await chat('INTERN',{action:'discussion_group_overview',channel_id:g.channel_id})).groups.length,0);

 // Membership changes take effect at once; history stays.
 await chat('ADMIN',{action:'discussion_group_members_set',channel_id:g.channel_id,add:[actors.INTERN.staff_id],remove:[actors.ASSISTANT2.staff_id]});
 await assert.rejects(()=>chat('ASSISTANT2',{action:'discussion_messages',channel_id:g.channel_id}),/not available/);
 assert.equal((await chat('INTERN',{action:'discussion_messages',channel_id:g.channel_id})).messages.length,1);
 await chat('INTERN',{action:'discussion_send',channel_id:g.channel_id,request_id:id(),body:'Noted, thank you.'});
 await chat('ADMIN',{action:'discussion_group_members_set',channel_id:g.channel_id,add:[actors.ASSISTANT2.staff_id],remove:[]});
 assert.equal((await chat('ASSISTANT2',{action:'discussion_messages',channel_id:g.channel_id})).messages.length,2,'a re-added member sees the whole history');

 // One-to-one: any active colleague of a shared firm; an intern may reply but not start.
 const dm=await chat('ASSISTANT',{action:'discussion_open',kind:'Direct',staff_id:actors.ASSISTANT2.staff_id});
 assert.equal(dm.channel.kind,'Direct');
 await assert.rejects(()=>chat('INTERN',{action:'discussion_open',kind:'Direct',staff_id:actors.ASSISTANT.staff_id}),/cannot start/);
 await assert.rejects(()=>chat('ASSISTANT',{action:'discussion_open',kind:'Direct',staff_id:actors.ASSISTANT.staff_id}),/another staff member/);
 // An administrator cannot open client work chats.
 await assert.rejects(()=>chat('ADMIN',{action:'discussion_open',project_id:P}),/not available/);
});
