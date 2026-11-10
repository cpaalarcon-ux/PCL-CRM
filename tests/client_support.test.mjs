// Client support services: seeded billable flags, ticket rules, and a draft invoice only when a billable ticket is closed (build 2750).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Client support services and closure-time invoicing',async t=>{
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
 // ---- 1. The six services and their billable flags, as the Partner wrote them ---------------------------------------------------------------------------------
 const sv=await tx`select service_code,service_name,is_billable from erp_private.client_support_services order by sort_order`;
 assert.deepEqual(sv.map(r=>[r.service_name,r.is_billable]),[['KRA Agency Notice Lifting',true],['Compliance Certificate Application',true],['KRA Ledger Reconciliation',true],['KRA VAT/Tax Compounding',true],['KRA Obligation Addition/Removal',false],['General Queries',false]]);
 await q('MANAGER',`update erp_private.client_support_services set is_billable=false,source_note='Manager tries to change it' where service_code='KRA_NOTICE_LIFTING'`);
 assert.equal((await tx`select is_billable from erp_private.client_support_services where service_code='KRA_NOTICE_LIFTING'`)[0].is_billable,true,'only a Partner changes a billing flag');
 await assert.rejects(q('PARTNER',`update erp_private.client_support_services set is_billable=false where service_code='KRA_NOTICE_LIFTING'`),/where the Partner/,'a change needs a written source');
 await assert.rejects(q('PARTNER',`update erp_private.client_support_services set service_name='Renamed' where service_code='GENERAL_QUERY'`),/cannot be renamed/);
 await assert.rejects(()=>tx`delete from erp_private.client_support_services where service_code='GENERAL_QUERY'`,/archived, not deleted|Historical/);
 // ---- 2. Opening and working a ticket -----------------------------------------------------------------------------------------------------------------------
 const open=(role,code='KRA_NOTICE_LIFTING',o={})=>q(role,`insert into erp_private.client_support_tickets(client_id,firm_id,project_id,service_code,subject,details,opened_by,assigned_to) values($1,$2,$3,$4,$5,'Client asked for the notice to be lifted.',$6,$7) returning ticket_id`,[Z,F,o.project===undefined?PJ:o.project,code,o.subject||'Lift the agency notice on the main account',actors[role].staff_id,o.to||SUP]);
 await assert.rejects(open('INTERN'),/does not handle|row-level security/);
 await assert.rejects(open('MANAGER','KRA_NOTICE_LIFTING',{to:actors.INTERN.staff_id}),/Assign the ticket/,'not to an Intern');
 const T1=(await open('MANAGER'))[0].ticket_id;
 const get=async t=>(await tx`select * from erp_private.client_support_tickets where ticket_id=${t}`)[0];
 let tk=await get(T1);assert.deepEqual([tk.status,tk.fee_amount,tk.invoice_id,tk.opened_by===M],['Open',null,null,true]);
 await assert.rejects(q('MANAGER',`insert into erp_private.client_support_tickets(client_id,firm_id,service_code,subject,details,opened_by,assigned_to,status) values($1,$2,'GENERAL_QUERY','A question','Details here',$3,$4,'Closed')`,[Z,F,M,SUP]),/starts open|check|constraint/i,'a ticket cannot be opened already closed');
 await assert.rejects(q('MANAGER',`update erp_private.client_support_tickets set client_id=$2 where ticket_id=$1`,[T1,id()]),/cannot be changed|violates/i,'client/firm/service are fixed');
 await q('SUPERVISOR',`update erp_private.client_support_tickets set status='In progress' where ticket_id=$1`,[T1]);
 await q('SUPERVISOR',`update erp_private.client_support_tickets set status='Work done' where ticket_id=$1`,[T1]);
 // ---- 3. Closing a billable ticket: needs a fee, an engagement and its draft invoice, and nothing else creates one ----------------------------------------
 await assert.rejects(q('SUPERVISOR',`update erp_private.client_support_tickets set status='Closed',resolution='Notice lifted and confirmed on iTax.' where ticket_id=$1`,[T1]),/needs the fee/);
 await assert.rejects(q('SUPERVISOR',`update erp_private.client_support_tickets set status='Closed',resolution='Notice lifted and confirmed on iTax.',fee_amount=5000 where ticket_id=$1`,[T1]),/together with its draft invoice/);
 await assert.rejects(q('SUPERVISOR',`update erp_private.client_support_tickets set invoice_id=$2 where ticket_id=$1`,[T1,id()]),/only when a billable ticket is closed/,'an invoice cannot be attached before closure');
 const inv=async(net,status='Draft')=>{const i=id(),vat=Math.round(net*16)/100;await tx`insert into erp_private.invoices(invoice_id,request_id,project_id,client_id,firm_id,description,invoice_date,due_date,lines,net_amount,vat_amount,created_by) values(${i},${id()},${PJ},${Z},${F},'Fictional support invoice',current_date,current_date+14,${JSON.stringify([{description:'Fictional support fee',quantity:1,unit_price:net,line_type:'Fee',net,vat_rate:16,vat:vat}])}::jsonb,${net},${vat},${M})`;return i;};
 const wrong=await inv(4000);
 await assert.rejects(q('SUPERVISOR',`update erp_private.client_support_tickets set status='Closed',resolution='Notice lifted and confirmed on iTax.',fee_amount=5000,invoice_id=$2 where ticket_id=$1`,[T1,wrong]),/does not match the ticket/,'the invoice must carry the ticket fee');
 const good=await inv(5000);
 await assert.rejects(q('SUPERVISOR',`update erp_private.client_support_tickets set status='Closed',resolution='short',fee_amount=5000,invoice_id=$2 where ticket_id=$1`,[T1,good]),/check|constraint/i,'a written resolution');
 await q('SUPERVISOR',`update erp_private.client_support_tickets set status='Closed',resolution='Notice lifted and confirmed on iTax.',fee_amount=5000,invoice_id=$2 where ticket_id=$1`,[T1,good]);
 tk=await get(T1);assert.deepEqual([tk.status,tk.invoice_id===good,tk.closed_by===SUP,Number(tk.fee_amount)],['Closed',true,true,5000]);
 assert.equal((await tx`select status from erp_private.invoices where invoice_id=${good}`)[0].status,'Draft','the invoice stays a draft until a person posts it');
 await assert.rejects(q('MANAGER',`update erp_private.client_support_tickets set subject='Edited after closing' where ticket_id=$1`,[T1]),/cannot be changed/,'closed is final');
 await assert.rejects(()=>tx`delete from erp_private.client_support_tickets where ticket_id=${T1}`,/archived, not deleted|Historical/);
 const T2=(await open('MANAGER','KRA_LEDGER_RECONCILIATION',{subject:'Reconcile the VAT ledger'}))[0].ticket_id;
 await assert.rejects(q('MANAGER',`update erp_private.client_support_tickets set status='Closed',resolution='Ledger reconciled with KRA.',fee_amount=5000,invoice_id=$2 where ticket_id=$1`,[T2,good]),/duplicate|unique/i,'one invoice per ticket');
 // ---- 4. Non-billable services: closing creates no invoice and takes no fee ---------------------------------------------------------------------------------------
 const T3=(await open('MANAGER','GENERAL_QUERY',{project:null,subject:'Question about filing dates'}))[0].ticket_id;
 await assert.rejects(q('MANAGER',`update erp_private.client_support_tickets set fee_amount=100 where ticket_id=$1`,[T3]),/not a billable service/);
 const stray=await inv(100);
 await assert.rejects(q('MANAGER',`update erp_private.client_support_tickets set status='Closed',resolution='Answered by phone and email.',invoice_id=$2 where ticket_id=$1`,[T3,stray]),/not billable|check|constraint/i);
 await q('MANAGER',`update erp_private.client_support_tickets set status='Closed',resolution='Answered by phone and email.' where ticket_id=$1`,[T3]);
 tk=await get(T3);assert.deepEqual([tk.status,tk.invoice_id,tk.fee_amount],['Closed',null,null]);
 // ---- 5. Cancelling, the Partner switch, visibility ------------------------------------------------------------------------------------------------------------------
 const T4=(await open('MANAGER','KRA_OBLIGATION_CHANGE',{subject:'Remove an old obligation'}))[0].ticket_id;
 await q('MANAGER',`update erp_private.client_support_tickets set status='Cancelled',resolution='Client withdrew the request.' where ticket_id=$1`,[T4]);
 assert.equal((await get(T4)).status,'Cancelled');
 await q('PARTNER',`update erp_private.client_support_services set is_active=false,source_note='Partner switched this service off on 10 Nov 2026' where service_code='GENERAL_QUERY'`);
 await assert.rejects(open('MANAGER','GENERAL_QUERY',{project:null}),/switched off/);
 await q('PARTNER',`update erp_private.client_support_services set is_active=true,source_note='Partner switched this service back on' where service_code='GENERAL_QUERY'`);
 assert.equal((await q('INTERN',`select * from erp_private.client_support_tickets`)).length,0,'interns see no client support tickets');
 assert.equal((await q('INTERN',`select * from erp_private.client_support_services`)).length,0);
 // the staff help desk is untouched
 assert.equal((await tx`select count(*)::int n from erp_private.support_tickets`)[0].n,0);
 for(const fn of ['client_support_service_guard','client_support_ticket_guard']){const r=(await tx`select p.prosecdef,p.proconfig::text cfg,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname=${fn}`)[0];assert.deepEqual([r.prosecdef,/search_path=/.test(r.cfg),r.anon],[true,true,false],fn);}
});
