// Leads are open to Assistants and Supervisors; converting a lead stays with Managers and Partners.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
import {defaultStaffAreas} from '../staff-access-control.mjs';
import {defaultActionRights} from '../staff-action-rights.mjs';
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('Leads: area, action rights and screen follow the decision (open to staff, conversion with leaders)',()=>{
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'])assert.ok(defaultStaffAreas(role).includes('leads'),role);
 for(const role of ['INTERN','ADMIN'])assert.ok(!defaultStaffAreas(role).includes('leads'),role);
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const r=defaultActionRights(role);for(const c of ['lead.view','lead.create'])assert.ok(r.includes(c),role+' '+c);assert.equal(r.includes('lead.edit'),role!=='ASSISTANT',role+' edit');}
 for(const role of ['PARTNER','MANAGER'])assert.ok(defaultActionRights(role).includes('lead.approve'));
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN'])assert.ok(!defaultActionRights(role).includes('lead.approve'),role+' cannot convert');
 assert.equal(rd('staff-access-control.mjs').match(/TEAM_AREAS=\[[^\]]*\]/)[0],rd(fx+'staff-access-control.mjs').match(/TEAM_AREAS=\[[^\]]*\]/)[0]);
 assert.equal(rd('staff-action-rights.mjs'),rd(fx+'staff-action-rights.mjs'));
 const act=rd(fx+'lead-actions.ts');
 assert.match(act,/p\.lead_id&&a\.category_code==='ASSISTANT'\)fail\(403/);
 assert.match(act,/p\.action==='lead_convert'\)leader\(a\);else if\(!\['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'\]/);
 const ui=rd('staff-leads.mjs');assert.match(ui,/ctx\.canConvert\?\.\(\)\?btn\('convert'/);assert.match(ui,/ctx\.canEdit\?\.\(\)\?btn\('edit'/);
});
test('Leads: the database lets staff roles work their own leads, keeps interns out and keeps the Partner view firm-wide',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit adjustments firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 const [svc]=await tx`select service_code from erp_private.services limit 1`,A=actors.ASSISTANT,S=actors.SUPERVISOR;
 const ins=(role,name)=>as(role,a=>tx`insert into erp_private.leads(request_id,firm_id,company_name,primary_sector,branch_location,service_code,lead_source,owner_id) values(${id()},${F},${name},'Retail','Nairobi',${svc.service_code},'Referral',${a.staff_id}) returning lead_id`);
 const seen=role=>as(role,()=>tx`select company_name from erp_private.leads order by company_name`).then(r=>r.map(x=>x.company_name));
 const lead=(await ins('ASSISTANT','Fictional Lead A'))[0].lead_id;
 await ins('MANAGER','Fictional Lead M');
 await assert.rejects(()=>ins('INTERN','Fictional Lead I'),/row-level security/);
 assert.deepEqual(await seen('ASSISTANT'),['Fictional Lead A'],'an Assistant sees the leads they own');
 assert.deepEqual(await seen('PARTNER'),['Fictional Lead A','Fictional Lead M'],'a Partner sees the whole firm');
 assert.deepEqual(await seen('SUPERVISOR'),[],'a Supervisor outside the reporting line sees nothing');
 assert.deepEqual(await seen('INTERN'),[],'interns see no leads');
 await as('ASSISTANT',()=>tx`update erp_private.leads set stage='Contacted' where lead_id=${lead}`);
 assert.equal((await tx`select stage from erp_private.leads where lead_id=${lead}`)[0].stage,'New Lead','an Assistant adds leads but does not update them');
 await tx`update erp_private.staff_members set manager_id=${actors.MANAGER.staff_id} where staff_id=${A.staff_id}`;
 assert.deepEqual(await seen('MANAGER'),['Fictional Lead A','Fictional Lead M'],'a Manager sees their own leads and their reports leads');
 assert.deepEqual(await seen('SUPERVISOR'),[],'a Supervisor is not a line manager for lead visibility');
 await tx`update erp_private.staff_firm_access set scope='Firm' where staff_id=${S.staff_id} and firm_id=${F}`;
 assert.deepEqual(await seen('SUPERVISOR'),['Fictional Lead A','Fictional Lead M'],'Firm-wide access shows the firm pipeline');
 await as('SUPERVISOR',()=>tx`update erp_private.leads set temperature='Hot' where lead_id=${lead}`);
 assert.equal((await tx`select temperature from erp_private.leads where lead_id=${lead}`)[0].temperature,'Hot');
 await as('INTERN',()=>tx`update erp_private.leads set stage='Lost' where lead_id=${lead}`);
 assert.equal((await tx`select stage from erp_private.leads where lead_id=${lead}`)[0].stage,'New Lead','an intern update changes nothing');
});
