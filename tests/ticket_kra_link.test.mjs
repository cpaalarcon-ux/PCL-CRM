// Client support tickets linked to KRA notices, with priority, due dates and assignment notes (build 2774).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const {clientSupportAction}=await import('../supabase/functions/staff-workspace-v12/client-support-actions.ts');
const {kraAction}=await import('../supabase/functions/staff-workspace-v12/kra-actions.ts');
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('support tickets: due dates, priority, assignment note and the link to a KRA notice',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Support Client Ltd','A400000060Z'),PJ=await proj(Z,'TAX-KRA'),SUP=actors.SUPERVISOR.staff_id,AST=actors.ASSISTANT.staff_id;
 const cs=(role,p)=>as(role,a=>clientSupportAction(tx,a,p)),kr=(role,p)=>as(role,a=>kraAction(tx,a,p));
 const ymd=v=>v?(v instanceof Date?v.toISOString():String(v)).slice(0,10):null;
 const D=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
 const Z2=await mk('UAT Fictional Other Client Ltd','A400000061Z');
 await db.exec('alter table erp_private.kra_cases disable trigger user');
 const mkCase=async(client,ref,status='Open')=>(await tx`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,logged_by,status,closed_by,closed_at,close_note) values(${client},${F},${ref},'Audit notice','VAT','2025-01-01','2025-12-31',${D(-3)},${D(-2)},${D(20)},'Fictional audit notice for the year 2025.',${M},${status},${status==='Cancelled'?M:null},${status==='Cancelled'?new Date().toISOString():null},${status==='Cancelled'?'Logged in error, fictional.':null}) returning case_id`)[0].case_id;
 const K1=await mkCase(Z,'KRA/TKT/1'),K2=await mkCase(Z2,'KRA/TKT/2'),K3=await mkCase(Z,'KRA/TKT/3','Cancelled');
 const base={action:'client_support_open',client_id:Z,firm_id:F,project_id:PJ,service_code:'KRA_NOTICE_LIFTING',subject:'Lift the agency notice on the main account',details:'The client asked for the notice to be lifted.',assigned_to:SUP};
 // the dates are required, and the resolution date cannot be before the response date
 await assert.rejects(cs('MANAGER',{...base}),/response due date and the resolution due date/);
 await assert.rejects(cs('MANAGER',{...base,response_due_on:D(5),resolution_due_on:D(2)}),/cannot be before the response/);
 await assert.rejects(cs('MANAGER',{...base,response_due_on:D(2),resolution_due_on:D(9),priority:'Critical'}),/Choose a valid option/);
 // the choice list of KRA notices: only this client's, only open or responded
 const opts=(await cs('MANAGER',{action:'client_support_kra_cases',client_id:Z})).cases;
 assert.deepEqual(opts.map(c=>c.notice_reference),['KRA/TKT/1'],'another client\'s notice and a cancelled one are not offered');
 // the link must be to a notice of the same client that is still open or responded
 await assert.rejects(cs('MANAGER',{...base,response_due_on:D(2),resolution_due_on:D(9),kra_case_id:K2}),/Link a KRA notice of this client|foreign key|violates/i,'another client\'s notice');
 await assert.rejects(cs('MANAGER',{...base,response_due_on:D(2),resolution_due_on:D(9),kra_case_id:K3}),/still open or responded/,'a cancelled notice');
 const o=await cs('MANAGER',{...base,response_due_on:D(2),resolution_due_on:D(9),priority:'High',assignment_note:'Start with the iTax ledger and call the client first.',kra_case_id:K1});
 const T=o.ticket_id;
 let list=(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets,tk=list.find(x=>x.ticket_id===T);
 assert.deepEqual([tk.priority,tk.kra_reference,tk.kra_tax_head,tk.assignment_note.slice(0,10),tk.response_overdue,tk.resolution_overdue],['High','KRA/TKT/1','VAT','Start with',false,false]);
 assert.equal(ymd(tk.response_due_on),D(2));
 // the KRA notice shows the ticket
 const kc=await kr('MANAGER',{action:'kra_read',case_id:K1});
 assert.deepEqual(kc.tickets.map(x=>[x.ticket_number,x.priority,x.assigned_name!==undefined]),[[tk.ticket_number,'High',true]]);
 assert.deepEqual((await kr('MANAGER',{action:'kra_read',case_id:K2})).tickets,[],'another notice has none');
 // updating: change priority, dates, note; unlink; relink; a closed notice cannot be linked
 await cs('MANAGER',{action:'client_support_update',ticket_id:T,revision:tk.revision,priority:'Urgent',resolution_due_on:D(12),assignment_note:'Escalated by the Partner.',kra_case_id:''});
 tk=(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets.find(x=>x.ticket_id===T);
 assert.deepEqual([tk.priority,tk.kra_case_id,tk.assignment_note,ymd(tk.resolution_due_on)],['Urgent',null,'Escalated by the Partner.',D(12)],'an empty link removes it');
 assert.deepEqual((await kr('MANAGER',{action:'kra_read',case_id:K1})).tickets,[]);
 await assert.rejects(cs('MANAGER',{action:'client_support_update',ticket_id:T,revision:tk.revision,resolution_due_on:D(1)}),/cannot be before the response/);
 await cs('MANAGER',{action:'client_support_update',ticket_id:T,revision:tk.revision,kra_case_id:K1});
 assert.equal((await kr('MANAGER',{action:'kra_read',case_id:K1})).tickets.length,1);
 // overdue is shown, not enforced
 await db.exec(`alter table erp_private.client_support_tickets disable trigger user`);
 await tx`update erp_private.client_support_tickets set response_due_on=current_date-3,resolution_due_on=current_date-1 where ticket_id=${T}`;
 await db.exec(`alter table erp_private.client_support_tickets enable trigger user`);
 tk=(await cs('MANAGER',{action:'client_support_list',client_id:Z})).tickets.find(x=>x.ticket_id===T);assert.deepEqual([tk.response_overdue,tk.resolution_overdue],[true,true]);
 // the database refuses the same things when the server is bypassed
 await assert.rejects(q('MANAGER',`insert into erp_private.client_support_tickets(client_id,firm_id,project_id,service_code,subject,details,opened_by,assigned_to) values($1,$2,$3,'GENERAL_QUERY','A question','Details here',$4,$5)`,[Z,F,PJ,M,SUP]),/response due date and the resolution due date/);
 await assert.rejects(q('MANAGER',`insert into erp_private.client_support_tickets(client_id,firm_id,project_id,service_code,subject,details,opened_by,assigned_to,response_due_on,resolution_due_on,kra_case_id) values($1,$2,$3,'GENERAL_QUERY','A question','Details here',$4,$5,current_date,current_date+1,$6)`,[Z,F,PJ,M,SUP,K2]),/Link a KRA notice of this client|violates/i);
 await assert.rejects(q('MANAGER',`update erp_private.client_support_tickets set response_due_on=null where ticket_id=$1`,[T]),/keeps its response and resolution due dates/);
 // Interns and Admins see neither the tickets nor the notices
 await assert.rejects(cs('INTERN',{action:'client_support_kra_cases',client_id:Z}),/does not handle/);
});
