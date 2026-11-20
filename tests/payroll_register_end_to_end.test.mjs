import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {payrollRegisterAction}=await import('../supabase/functions/staff-workspace-v12/payroll-register-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const reg=(role,p)=>as(role,a=>payrollRegisterAction(tx,a,{project_id:P,...p}));
test('payroll register: add, change pay with effective dates, roll a month forward, leave, never edit; submitted months are reported not altered',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await assert.rejects(()=>reg('INTERN',{action:'payroll_register_read'}),/client access/);
 const person=(name,pin,x={})=>({name,kra_pin:pin,relationship:'Employee',employment_type:'Permanent',started_on:'2026-01-01',...x});
 const pay=(gross,eff='2026-01-01',reason='Contract signed January 2026')=>({gross,effective_from:eff,reason});
 const w=await reg('ASSISTANT',{action:'payroll_register_add',person:person('Wanjiru','A000000001Z'),pay:pay(100000)});
 const o=await reg('ASSISTANT',{action:'payroll_register_add',person:person('Otieno','A000000002Z'),pay:pay(80000)});
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_add',person:person('Wanjiru again','A000000001Z'),pay:pay(1)}),/already on this client/);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_add',person:{...person('Boss','A000000003Z'),relationship:'Owner'},pay:pay(5)}),/Drawings/);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_add',person:person('No reason','A000000004Z'),pay:{gross:5,effective_from:'2026-01-01',reason:'x'}}),/reason/);
 // A raise from 1 September: earlier months still draft the old pay, later months the new pay.
 const raise=await reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:110000,effective_from:'2026-09-01',reason:'Annual review approved August 2026'});assert.deepEqual(raise.affected_months,[]);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:111000,effective_from:'2026-09-01',reason:'Same date again please'}),/already changes on that date/);
 const aug=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-08'}),sep=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09'});
 assert.equal(aug.lines.find((l)=>l.name==='Wanjiru').gross,100000);assert.equal(sep.lines.find((l)=>l.name==='Wanjiru').gross,110000);
 assert.deepEqual(sep.changes.pay_changes.map((c)=>c.name),['Wanjiru']);assert.equal(sep.lines[0].evidence_reference,'','evidence for the month is entered new');assert.equal(sep.lines[0].other_deductions,'');
 // Pay is never edited or deleted, even by SQL as the API role.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_payroll_pay set gross=1`),/never edited|permission/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.client_payroll_pay`),/not allowed|permission|delete/i);
 // A person who leaves drops out of later months; earlier months are unchanged. A new person is reported as new staff.
 await reg('ASSISTANT',{action:'payroll_register_add',person:person('Kamau','A000000005Z',{started_on:'2026-10-01'}),pay:pay(60000,'2026-10-01','Offer letter October 2026')});
 const list=await reg('ASSISTANT',{action:'payroll_register_read'}),oti=list.people.find((x)=>x.name==='Otieno');
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_leave',person_id:o.person_id,revision:oti.revision,left_on:'2026-09-30',reason:'short'}),/reason/);
 await reg('ASSISTANT',{action:'payroll_register_leave',person_id:o.person_id,revision:oti.revision,left_on:'2026-09-30',reason:'Resigned, notice served September'});
 // Build 2819: the request does not remove anyone. The person stays on the payroll until a different Manager or Partner approves.
 const stillThere=(await reg('ASSISTANT',{action:'payroll_register_read'}));assert.equal(stillThere.people.find((x)=>x.name==='Otieno').status,'Active');
 const sepReq=stillThere.changes.find((c)=>c.kind==='Separation'&&c.status==='Requested');assert.ok(sepReq);assert.equal(sepReq.requested_by_name!==undefined,true);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_leave',person_id:o.person_id,revision:oti.revision,left_on:'2026-09-30',reason:'Asking again for the same person'}),/already waiting for approval/);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_separation_decide',change_id:sepReq.change_id,decision:'Approve'}),/Manager or Partner approves/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.client_payroll_people set status='Left',left_on='2026-09-30',left_reason='Trying to go round the approval' where person_id=${o.person_id}`),/approved separation/);
 await reg('MANAGER',{action:'payroll_register_separation_decide',change_id:sepReq.change_id,decision:'Approve',note:'Resignation letter seen'});
 const oct=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-10'});
 assert.deepEqual(oct.lines.map((l)=>l.name),['Kamau','Wanjiru']);assert.deepEqual(oct.changes.new_staff.map((c)=>c.name),['Kamau']);assert.deepEqual(oct.changes.left.map((c)=>c.name),['Otieno']);
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09'})).lines.length,2,'September still includes Otieno');
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_pay',person_id:o.person_id,gross:1,effective_from:'2026-11-01',reason:'After leaving date'}),/left/);
 // A pay change dated inside a month that is already submitted or approved is reported; the saved month is untouched.
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_imports(import_id,project_id,client_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by,entry_mode) values(${id()},${P},${C},'Payroll','PAYROLL','PAYROLL_MONTHLY','2026-09-01','2026-09-30',${tx.json({employees:[],calculated:[]})},${'h'+id()},'Confirmed',${actors.ASSISTANT.staff_id},'Manual')`;
 await db.exec('set session_replication_role=origin');
 const late=await reg('ASSISTANT',{action:'payroll_register_pay',person_id:w.person_id,gross:120000,effective_from:'2026-09-15',reason:'Backdated correction approved'});
 assert.deepEqual(late.affected_months.map((m)=>m.month),['2026-09']);assert.match(late.note,/keeps the figures/);
 const rows=await tx`select count(*)::int n from erp_private.period_imports where client_id=${C}`;assert.equal(rows[0].n,1,'no payroll was created or changed by the register');
 const ex=(await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09'})).existing_run;assert.equal(ex.status,'Confirmed','the draft warns that the month already exists');
 // ---- Build 2819: inactive for a period, return to active, approved separation, who carries forward ----
 const k=await reg('ASSISTANT',{action:'payroll_register_add',person:person('Njeri','A000000006Z',{started_on:'2026-01-01'}),pay:pay(70000)});
 const inact={action:'payroll_register_inactive',person_id:k.person_id,starts_on:'2026-11-01',ends_on:'2026-12-31',reason:'Unpaid leave agreed with the client',confirm:true};
 await assert.rejects(()=>reg('ASSISTANT',{...inact,confirm:false}),/Confirm that this person is inactive/);
 await assert.rejects(()=>reg('ASSISTANT',{...inact,reason:'short'}),/at least 10 characters/);
 await assert.rejects(()=>reg('ASSISTANT',{...inact,starts_on:'2025-12-01'}),/on or after the day they started/);
 await assert.rejects(()=>reg('ASSISTANT',{...inact,ends_on:'2026-10-01'}),/cannot be before the first/);
 assert.deepEqual((await reg('ASSISTANT',inact)).affected_months,[]);
 await assert.rejects(()=>reg('ASSISTANT',{...inact,starts_on:'2026-12-15',ends_on:'2027-01-10'}),/already inactive for part of that period/);
 // November and December are left out for her (with the reason); October still carries her; January carries her again.
 const nov=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-11'});
 assert.equal(nov.lines.some((l)=>l.name==='Njeri'),false);assert.match(nov.skipped.find((x)=>x.name==='Njeri').reason,/Inactive from 2026-11-01 to 2026-12-31: Unpaid leave/);assert.deepEqual(nov.changes.inactive.map((c)=>c.name),['Njeri']);
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-10'})).lines.some((l)=>l.name==='Njeri'),true);
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2027-01'})).lines.some((l)=>l.name==='Njeri'),true);
 // Part of a month: she stays in with a visible warning, and the pay is not prorated by guesswork.
 const part=await reg('ASSISTANT',{action:'payroll_register_inactive',person_id:w.person_id,starts_on:'2026-12-10',ends_on:'2026-12-20',reason:'Suspension on full investigation',confirm:true});assert.equal(part.ok,true);
 const dec=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-12'});assert.equal(dec.lines.some((l)=>l.name==='Wanjiru'),true);assert.match(dec.warnings.find((x)=>x.name==='Wanjiru').detail,/not prorated automatically/);
 // Return to active: needs a later date, a reason and a confirmation; the period ends the day before; she carries forward from that month.
 const hist=(await reg('ASSISTANT',{action:'payroll_register_read'})).changes.find((c)=>c.person_id===k.person_id&&c.kind==='Inactive');
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_return',change_id:hist.change_id,returned_on:'2026-11-01',reason:'Back from leave early',confirm:true}),/after the day the inactive period began/);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_return',change_id:hist.change_id,returned_on:'2026-12-01',reason:'Back from leave early',confirm:false}),/Confirm that this person returns/);
 await reg('ASSISTANT',{action:'payroll_register_return',change_id:hist.change_id,returned_on:'2026-12-01',reason:'Back from leave early, confirmed by the client',confirm:true});
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_return',change_id:hist.change_id,returned_on:'2026-12-02',reason:'Trying to return twice',confirm:true}),/already been closed/);
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-11'})).lines.some((l)=>l.name==='Njeri'),false,'November stays inactive');
 const dec2=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-12'});assert.equal(dec2.lines.some((l)=>l.name==='Njeri'),true,'December carries her again');assert.deepEqual(dec2.changes.returned.map((c)=>c.name),['Njeri']);
 // The facts of an inactive period are never edited or deleted, even by SQL.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.client_payroll_status_changes set reason='A rewritten explanation here' where change_id=${hist.change_id}`),/never edited|not allowed|closed change/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.client_payroll_status_changes where change_id=${hist.change_id}`),/./);
 // Separation: asked for by one person, decided by a different Manager or Partner; a rejection keeps the person on the payroll; the requester can withdraw.
 const kk=(await reg('ASSISTANT',{action:'payroll_register_read'})).people.find((x)=>x.name==='Njeri');
 await reg('MANAGER',{action:'payroll_register_leave',person_id:k.person_id,revision:kk.revision,left_on:'2027-01-31',reason:'Contract ended by agreement'});
 const req=(await reg('MANAGER',{action:'payroll_register_read'})).changes.find((c)=>c.kind==='Separation'&&c.status==='Requested'&&c.person_id===k.person_id);
 await assert.rejects(()=>reg('MANAGER',{action:'payroll_register_separation_decide',change_id:req.change_id,decision:'Approve'}),/different Manager or Partner decides a separation you asked for/);
 await assert.rejects(()=>reg('PARTNER',{action:'payroll_register_separation_decide',change_id:req.change_id,decision:'Reject',note:'no'}),/reason for rejecting/);
 assert.equal((await reg('PARTNER',{action:'payroll_register_separation_decide',change_id:req.change_id,decision:'Reject',note:'Contract not yet ended'})).status,'Rejected');
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_read'})).people.find((x)=>x.name==='Njeri').status,'Active');
 await reg('ASSISTANT',{action:'payroll_register_leave',person_id:k.person_id,revision:(await reg('ASSISTANT',{action:'payroll_register_read'})).people.find((x)=>x.name==='Njeri').revision,left_on:'2027-01-31',reason:'Contract ended by agreement'});
 const req2=(await reg('ASSISTANT',{action:'payroll_register_read'})).changes.find((c)=>c.kind==='Separation'&&c.status==='Requested');
 await assert.rejects(()=>reg('MANAGER',{action:'payroll_register_separation_withdraw',change_id:req2.change_id}),/Only the person who asked/);
 // The pending separation shows in the draft but does not remove her; approval does, from the effective date only.
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2027-02'})).lines.some((l)=>l.name==='Njeri'),true);
 assert.deepEqual((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2027-01'})).changes.pending_separations.map((c)=>c.name),['Njeri']);
 const done=await reg('PARTNER',{action:'payroll_register_separation_decide',change_id:req2.change_id,decision:'Approve'});assert.equal(done.status,'Approved');
 const after=await reg('ASSISTANT',{action:'payroll_register_read'}),gone=after.people.find((x)=>x.name==='Njeri');
 assert.equal(gone.status,'Left');assert.equal(gone.left_on,'2027-01-31');assert.equal(after.changes.find((c)=>c.change_id===req2.change_id).decided_by_name!==undefined,true);
 assert.equal((await reg('ASSISTANT',{action:'payroll_register_draft',month:'2027-01'})).lines.some((l)=>l.name==='Njeri'),true,'she is on January payroll');
 const feb=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2027-02'});assert.equal(feb.lines.some((l)=>l.name==='Njeri'),false);assert.deepEqual(feb.changes.left.map((c)=>c.name),['Njeri']);assert.ok(feb.changes.left[0].approved_by!==undefined);
 await assert.rejects(()=>reg('ASSISTANT',{action:'payroll_register_inactive',person_id:k.person_id,starts_on:'2027-03-01',reason:'Cannot be inactive after leaving',confirm:true}),/left the payroll/);
 // Choosing who carries forward: a person left out is listed as skipped, not silently dropped.
 const ex2=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-09',exclude_person_ids:[w.person_id]});
 assert.equal(ex2.lines.some((l)=>l.name==='Wanjiru'),false);assert.match(ex2.skipped.find((x)=>x.name==='Wanjiru').reason,/Left out of this month's draft by staff/);assert.ok(ex2.carry_forward.length>=2);
 // A past payroll is never changed by any of this.
 assert.equal((await tx`select count(*)::int n from erp_private.period_imports where client_id=${C}`)[0].n,1);
});
