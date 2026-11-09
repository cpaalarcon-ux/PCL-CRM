// Final decisions 9 Nov 2026: a late re-sign restarts the full 365-day cycle; only Assistant data entry is a hard gate, other policies show a red warning and block nothing.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {policyWarnings,reviewLine} from '../staff-policies.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('Partner dashboard warning',()=>{
 const base=[{policy_code:'ASSISTANT_DATA_ENTRY',policy_name:'Assistant policy',status:'Expired'},{policy_code:'SECURITY_POLICY',policy_name:'Security policy',status:'Expired'},{policy_code:'ASSIGNMENT_POLICY',policy_name:'Assignment policy',status:'Signed_Off',review_due_date:'2026-12-02'},{policy_code:'LEAVE_HANDOVER_POLICY',policy_name:'Leave policy',status:'Signed_Off',review_due_date:'2027-05-01'}];
 const html=policyWarnings({me:{category_code:'PARTNER'},policies:base},esc,'2026-11-30');
 assert.match(html,/notice error/);assert.match(html,/role="alert"/);assert.match(html,/Policies have expired/);
 assert.match(html,/Assistant policy<\/b> — Assistant data entry is blocked/);assert.match(html,/Security policy<\/b> — advisory, nothing is blocked/);
 assert.match(html,/Assignment policy \(2026-12-02\)/);assert.doesNotMatch(html,/Leave policy/);
 assert.equal(policyWarnings({me:{category_code:'MANAGER'},policies:base},esc,'2026-11-30'),'','only Partners see it');
 assert.equal(policyWarnings({me:{category_code:'PARTNER'},policies:[{policy_code:'SECURITY_POLICY',status:'Signed_Off',review_due_date:'2027-05-01'}]},esc,'2026-11-30'),'');
 assert.match(policyWarnings({me:{category_code:'PARTNER'},policies:[{policy_code:'SECURITY_POLICY',policy_name:'Security policy',status:'Signed_Off',review_due_date:'2026-12-02'}]},esc,'2026-11-30'),/notice warn/);
 assert.match(reviewLine({policy_code:'SECURITY_POLICY',status:'Expired',review_due_date:'2026-11-01'},esc),/advisory: nothing is blocked/);
 assert.match(reviewLine({policy_code:'ASSISTANT_DATA_ENTRY',status:'Expired',review_due_date:'2026-11-01'},esc),/Assistant data entry is blocked/);
 assert.match(rd('staff-pilot.mjs'),/policyWarnings\(data,esc\)\+renderDashboard/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('expiry wording, no blocking of advisory policies, and the full cycle after a late re-sign',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 for(const role of ['PARTNER','PARTNER2']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:'PARTNER'};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},'PARTNER','Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;}
 const today=(await tx`select (now() at time zone 'Africa/Nairobi')::date d`)[0].d.toISOString().slice(0,10);
 const sign=code=>as('PARTNER',()=>tx`update erp_private.system_policies set status='Signed_Off' where policy_code=${code}`);
 // Go-live a long time ago: the first review (go-live + 14 days) is already in the past, so a signature starts a full cycle.
 await as('PARTNER',()=>tx`select erp_private.go_live_save('2026-03-01'::date,'Fictional go-live for the test')`);
 await sign('ASSISTANT_DATA_ENTRY');await sign('SECURITY_POLICY');
 const due=async code=>(await tx`select review_due_date::text d,status from erp_private.system_policies where policy_code=${code}`)[0];
 const plus=n=>(await_plus(n));function await_plus(n){const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
 assert.equal((await due('SECURITY_POLICY')).d,plus(365),'signed after go-live + 14 days: a full 365 days');
 // The review date arrives. Both expire; the wording differs; nothing in the database is blocked for the advisory policy.
 await tx`update erp_private.system_policies set review_due_date=${today}::date where policy_code in('ASSISTANT_DATA_ENTRY','SECURITY_POLICY')`;
 assert.equal((await tx`select erp_private.policy_review_scan() n`)[0].n,2);
 assert.equal((await due('SECURITY_POLICY')).status,'Expired');assert.equal((await due('ASSISTANT_DATA_ENTRY')).status,'Expired');
 const msgs=await tx`select message from erp_private.notifications where event_key like 'policy-expired:%' order by event_key`;
 assert.ok(msgs.some(m=>/Assistant policy|Audit Assistant Data Entry/i.test(m.message)&&/Assistant data entry is blocked until then/.test(m.message)),'the hard gate says it blocks');
 const adv=msgs.find(m=>/Security/i.test(m.message));assert.ok(adv);assert.match(adv.message,/advisory, so nothing is blocked/);assert.doesNotMatch(adv.message,/blocked until then/);
 // A late re-sign is a fresh start: 365 days from the signing date, and the next scan does not flag it again.
 await as('PARTNER2',()=>tx`update erp_private.system_policies set status='Signed_Off' where policy_code='SECURITY_POLICY'`);
 const re=await due('SECURITY_POLICY');assert.equal(re.status,'Signed_Off');assert.equal(re.d,plus(365));
 assert.equal((await tx`select erp_private.policy_review_scan() n`)[0].n,0,'nothing is due the next day');
 assert.equal((await due('SECURITY_POLICY')).status,'Signed_Off');
});
