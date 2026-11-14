// Tax Lead right, confirmed KRA due dates and adjustments-only amendments (build 2760).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const {taxConfigAction}=await import('../supabase/functions/staff-workspace-v12/tax-config-actions.ts');
const {taxAction}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {staffRightsAction}=await import('../supabase/functions/staff-workspace-v12/staff-rights-actions.ts');
const {dueDateAction}=await import('../supabase/functions/staff-workspace-v12/due-date-actions.ts');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>"{"+x.join(",")+"}";
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Tax Lead right, confirmed KRA due dates, adjustments-only amendments',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const M3=actors.MANAGER2.staff_id,SUP=actors.SUPERVISOR.staff_id,AST=actors.ASSISTANT.staff_id;
 const Z=await mk('UAT Fictional Tax Lead Client Ltd','A400000040Z'),PJ=await proj(Z,'TAX-KRA');
 const rights=(role,p)=>as(role,a=>staffRightsAction(tx,a,p));
 const tax=(role,p)=>as(role,a=>taxAction(tx,a,p));
 const cfg=(role,p)=>as(role,a=>taxConfigAction(tx,a,p));
 // ============================ A. The Tax Lead right =====================================================================================================================
 const vat=async(key,from,to,type='VAT')=>(await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,created_by) values(${key},${type},'Staging rule for the Tax Lead check',${from},${to},'{"rate":16,"treatment":"Standard"}','https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax','VAT Act, section 5. Staging check of the Tax Lead right.',${M}) returning rate_id`)[0].rate_id;
 const R1=await vat('KE_VAT_STANDARD','2030-01-01','2030-12-31');
 await tx`update erp_private.tax_rates set legal_review_status='Pending',legal_review_note='Pending the Tax Lead review of the provision',legal_citation='VAT Act, section 5' where rate_id=${R1}`;
 const approve=(role,rate)=>as(role,()=>db.query(`update erp_private.tax_rates set status='Approved',approved_by=$2,approved_at=now(),partner_source_verified_on=current_date where rate_id=$1`,[rate,actors[role].staff_id]));
 await assert.rejects(approve('PARTNER',R1),/designated Tax Manager/,'a Partner without the right cannot approve a VAT rule');
 await assert.rejects(approve('MANAGER2',R1),/designated Tax Manager/,'a Manager without the right cannot approve it either');
 await assert.rejects(cfg('PARTNER',{action:'rate_approve',rate_id:R1,revision:1,confirm_legal_basis:true}),/designated Tax Manager/,'the action says the same');
 await assert.rejects(cfg('PARTNER',{action:'rate_legal_confirm',rate_id:R1,revision:1,lead_name:'Fictional Lead',reference:'Memo fictional 2030',legal_citation:'Fictional Act s1',confirmed:true}),/designated Tax Manager/);
 // only a Partner grants it, only to a Manager, with a reason and an end date
 const grant=(role,staff,extra={})=>rights(role,{action:'staff_right_grant',staff_id:staff,capability:'APPROVE_TAX_RULES',reason:'Designated Tax Lead for VAT and credit rules',expires_on:new Date(Date.now()+200*86400000).toISOString().slice(0,10),...extra});
 await assert.rejects(grant('MANAGER',M3),/Partner/);
 await assert.rejects(grant('PARTNER',SUP),/held by a Manager/,'the Tax Lead is a Manager');
 await assert.rejects(grant('PARTNER',actors.PARTNER2.staff_id),/Partners already hold|Partner/);
 assert.ok((await rights('PARTNER',{action:'staff_rights_read'})).grantable.some(g=>g.code==='APPROVE_TAX_RULES'));
 assert.equal((await tx`select count(*)::int n from erp_private.staff_capabilities where capability='APPROVE_TAX_RULES'`)[0].n,0,'nobody holds the right until a Partner grants it');
 await grant('PARTNER',M3);
 assert.equal((await tx`select count(*)::int n from erp_private.staff_capabilities where capability='APPROVE_TAX_RULES' and staff_id=${M3}`)[0].n,1);
 assert.equal((await q('MANAGER2',`select erp_private.tax_rules_approver() ok`))[0].ok,true);
 assert.equal((await q('PARTNER',`select erp_private.tax_rules_approver() ok`))[0].ok,false,'a Partner does not hold it implicitly');
 assert.equal((await q('MANAGER',`select erp_private.tax_rules_approver() ok`))[0].ok,false);
 // the Tax Lead acts: confirm the legal basis (action path), then approve (database path)
 await assert.rejects(approve('MANAGER2',await vat('KE_FICT_SELF','2031-01-01','2031-12-31').then(async r=>{await tx`update erp_private.tax_rates set created_by=${M3} where rate_id=${r}`;return r;})),/cannot confirm or approve/,'the Tax Lead cannot approve a rule they prepared');
 await cfg('MANAGER2',{action:'rate_legal_confirm',rate_id:R1,revision:(await tx`select revision from erp_private.tax_rates where rate_id=${R1}`)[0].revision,lead_name:'Fictional Tax Lead',reference:'Memo 2026-11-10 fictional',legal_citation:'VAT Act, section 5',confirmed:true});
 assert.equal((await tx`select legal_review_status,legal_reviewed_by from erp_private.tax_rates where rate_id=${R1}`)[0].legal_reviewed_by,M3,'the Tax Lead recorded the legal confirmation');
 await cfg('MANAGER2',{action:'rate_approve',rate_id:R1,revision:(await tx`select revision from erp_private.tax_rates where rate_id=${R1}`)[0].revision,confirm_legal_basis:true});
 assert.equal((await tx`select status,approved_by from erp_private.tax_rates where rate_id=${R1}`)[0].approved_by,M3,'approved by the Tax Lead');
 // a credit (withholding tax) rule is gated the same way; other types keep the earlier path
 const W1=await vat('KE_FICT_WHT','2032-01-01','2032-12-31','Withholding tax');
 await assert.rejects(approve('PARTNER',W1),/designated Tax Manager/);
 const L1=await vat('KE_FICT_LEVY','2033-01-01','2033-12-31','Levy');
 await approve('PARTNER',L1);
 assert.equal((await tx`select status from erp_private.tax_rates where rate_id=${L1}`)[0].status,'Approved','a non-VAT, non-credit rule is still approved by a Partner');
 // revoked or expired: the right stops working
 const grantRow=(await tx`select grant_id from erp_private.staff_capabilities where staff_id=${M3} and capability='APPROVE_TAX_RULES'`)[0].grant_id;
 await rights('PARTNER',{action:'staff_right_revoke',grant_id:grantRow,reason:'Fictional: Tax Lead changed'});
 assert.equal((await q('MANAGER2',`select erp_private.tax_rules_approver() ok`))[0].ok,false,'revoked');
 await assert.rejects(approve('MANAGER2',await vat('KE_FICT_VAT2','2034-01-01','2034-12-31')),/designated Tax Manager/);
 // ============================ B. KRA due dates ===========================================================================================================================
 const sug=async(c,e)=>(await tx`select erp_private.period_due_suggest(${c},${e}::date) d`)[0].d;
 const day=d=>d instanceof Date?d.toISOString().slice(0,10):d;
 assert.equal(day(await sug('PAYE','2026-09-30')),'2026-10-09');assert.equal(day(await sug('VAT','2026-09-30')),'2026-10-20');
 assert.equal(day(await sug('VAT','2026-12-31')),'2027-01-20','December rolls into the next year');
 assert.equal(await sug('ANNUAL','2026-12-31'),null,'annual dates are not suggested');
 assert.deepEqual((await tx`select erp_private.period_due_class('PAYE') a,erp_private.period_due_class('NSSF') b,erp_private.period_due_class('TOT') c,erp_private.period_due_class('Company') d,erp_private.period_due_class('NITA') e`)[0],{a:'PAYE',b:'PAYE',c:'VAT',d:'ANNUAL',e:'OTHER'});
 const dd=(role,kind,due,itax,s='2026-09-01',e='2026-09-30')=>q(role,`select erp_private.period_due_confirm($1::uuid,$2::date,$3::date,$4,$5::date,$6) id`,[Z,s,e,kind,due,itax]);
 await assert.rejects(dd('MANAGER','VAT','2026-10-20',false),/Tick the box/,'the iTax tick is required');
 await assert.rejects(dd('MANAGER','VAT',null,true),/Enter the KRA due date/);
 await assert.rejects(dd('MANAGER','VAT','2026-09-15',true),/before the period ends/);
 await assert.rejects(dd('SUPERVISOR','VAT','2026-10-20',true),/Tax Lead, a Manager or a Partner/);
 await assert.rejects(dd('ASSISTANT','VAT','2026-10-20',true),/Tax Lead, a Manager or a Partner/);
 await assert.rejects(dd('INTERN','VAT','2026-10-20',true),/Tax Lead, a Manager or a Partner|permission|row-level/i);
 // nothing is ready before a person confirms
 const ready=(kind,s='2026-09-01',e='2026-09-30')=>tx`select erp_private.period_due_ready(${Z}::uuid,${s}::date,${e}::date,${kind}) r`.then(r=>r[0].r);
 assert.equal(await ready('VAT'),false);
 // the server gate: a tax period cannot be opened without a confirmed date or the explicit fallback
 const create=(role,extra={})=>tax(role,{action:'tax_create',project_id:PJ,kind:'VAT',starts_on:'2026-09-01',ends_on:'2026-09-30',...extra});
 await assert.rejects(create('MANAGER'),/Confirm the KRA return due date/,'no date, no fallback: blocked');
 await assert.rejects(create('MANAGER',{kra_due_date:'2026-10-20'}),/Tick the box/,'a date without the iTax tick is blocked');
 await assert.rejects(create('MANAGER',{use_task_date_fallback:'on',kra_due_date:'2026-10-20',fallback_reason:'Fictional reason for fallback'}),/Clear the KRA due date/);
 await assert.rejects(create('MANAGER',{use_task_date_fallback:'on',fallback_reason:'short'}),/at least 10/,'the fallback needs a reason');
 assert.equal((await tx`select count(*)::int n from erp_private.tax_cases where project_id=${PJ}`)[0].n,0,'nothing was created by the refused attempts');
 const made=await create('MANAGER',{kra_due_date:'2026-10-20',itax_confirmed:'on'});
 assert.ok(made.case_id);
 const row=(await tx`select * from erp_private.period_due_dates where client_id=${Z} and filing_class='VAT'`)[0];
 assert.deepEqual([day(row.kra_due_date),row.status,row.itax_confirmed,row.confirmed_by===M,day(row.suggested_due_date),row.suggestion_rule],['2026-10-20','CONFIRMED',true,true,'2026-10-20','20th of the following month']);
 assert.equal(await ready('VAT'),true);assert.equal(await ready('PAYE'),false,'one period, two due dates: the VAT confirmation does not cover PAYE');
 await assert.rejects(create('MANAGER',{kind:'PAYE'}),/Confirm the KRA return due date/,'PAYE needs its own date');
 // the PAYE date is the 9th, entered separately
 await create('MANAGER2',{kind:'PAYE',kra_due_date:'2026-10-09',itax_confirmed:'on'}).catch(e=>{throw e;});
 assert.deepEqual((await tx`select filing_class,kra_due_date::text d from erp_private.period_due_dates where client_id=${Z} order by filing_class`).map(r=>r.filing_class+':'+r.d),['PAYE:2026-10-09','VAT:2026-10-20']);
 // the explicit fallback
 const fb=await create('MANAGER',{starts_on:'2026-08-01',ends_on:'2026-08-31',use_task_date_fallback:'on',fallback_reason:'Fictional: iTax calendar not yet published'});
 assert.ok(fb.case_id);
 const fr=(await tx`select status,kra_due_date,itax_confirmed,fallback_reason from erp_private.period_due_dates where client_id=${Z} and starts_on='2026-08-01'`)[0];
 assert.deepEqual([fr.status,fr.kra_due_date,fr.itax_confirmed],['TASK_DATE_FALLBACK',null,false]);
 // the same two actions stand alone, and the state is readable
 const st=await as('MANAGER',a=>dueDateAction(tx,a,{action:'due_date_state',project_id:PJ,kind:'VAT',starts_on:'2026-09-01',ends_on:'2026-09-30'}));
 assert.deepEqual([st.state.status,day(st.state.kra_due_date),day(st.state.suggested_due_date),st.state.confirmed_by_name],['CONFIRMED','2026-10-20','2026-10-20','Fictional MANAGER']);
 await assert.rejects(as('SUPERVISOR',a=>dueDateAction(tx,a,{action:'due_date_confirm',project_id:PJ,kind:'VAT',starts_on:'2026-07-01',ends_on:'2026-07-31',kra_due_date:'2026-08-20',itax_confirmed:'on'})),/Tax Lead, a Manager or a Partner/);
 const again=await as('PARTNER',a=>dueDateAction(tx,a,{action:'due_date_confirm',project_id:PJ,kind:'VAT',starts_on:'2026-09-01',ends_on:'2026-09-30',kra_due_date:'2026-10-21',itax_confirmed:'on'}));
 assert.equal(day(again.state.kra_due_date),'2026-10-21','a date can be corrected by re-confirming it');
 assert.equal((await tx`select count(*)::int n from erp_private.period_due_dates where client_id=${Z} and starts_on='2026-09-01' and filing_class='VAT'`)[0].n,1,'still one row per period and class');
 // the table is read-only from the application role, and rows are never deleted
 await assert.rejects(q('MANAGER',`insert into erp_private.period_due_dates(client_id,starts_on,ends_on,filing_class,kra_due_date,status,itax_confirmed,confirmed_by) values('${Z}','2026-05-01','2026-05-31','VAT','2026-06-20','CONFIRMED',true,'${M}')`),/permission denied|row-level/i);
 await assert.rejects(tx`delete from erp_private.period_due_dates`,/not allowed|cannot|delet/i);
 const priv=(await tx`select has_function_privilege('anon','erp_private.period_due_confirm(uuid,date,date,text,date,boolean)','execute') a,has_function_privilege('authenticated','erp_private.tax_rules_approver()','execute') b,has_function_privilege('erp_api','erp_private.period_due_confirm(uuid,date,date,text,date,boolean)','execute') c`)[0];
 assert.deepEqual([priv.a,priv.b,priv.c],[false,false,true]);
 assert.ok((await tx`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname in('period_due_confirm','period_due_fallback','period_due_state','period_due_ready','tax_rules_approver','tax_amendment_source_guard') and prosecdef and exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`)[0].n===6,'every new definer function pins search_path');
 // ============================ C. Amendments change adjustments only ====================================================================================================
 const orig=id();
 await db.query(`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by,reviewed_by,review_snapshot,status,filing_date,inputs) values($1,$2,'VAT','2026-06-01','2026-06-30',$3,$4,'{}','Filed','2026-07-18',$5)`,[orig,PJ,AST,M,JSON.stringify({opening_credit:100,withholding_credit:25,adjustments:[],adjustment_basis:'',bank_reconciliation:{note:'filed'}})]);
 const am=await tax('MANAGER',{action:'tax_amend',case_id:orig,reason:'Corrected output VAT on one sale invoice'});
 const A1=am.case_id;
 assert.equal((await tx`select prepared_by from erp_private.tax_cases where case_id=${A1}`)[0].prepared_by,M);
 const save=(p)=>tax('MANAGER',{action:'tax_save',case_id:A1,revision:1,...p});
 const rev=async()=>(await tx`select revision from erp_private.tax_cases where case_id=${A1}`)[0].revision;
 await assert.rejects(save({inputs:{opening_credit:999}}),/adjustments only/,'a source figure cannot be edited in an amendment');
 await assert.rejects(save({inputs:{withholding_credit:0}}),/adjustments only/);
 // the same refusal at the database, whoever writes
 await assert.rejects(tx`update erp_private.tax_cases set inputs=inputs||'{"opening_credit":5}'::jsonb where case_id=${A1}`,/adjustments only/);
 // submitting an amendment with no adjustment is refused
 await assert.rejects(tax('MANAGER',{action:'tax_submit',case_id:A1,revision:await rev()}),/Record at least one adjustment|adjustment/);
 // an adjustment is accepted, and the source figures stay exactly the filed ones
 await save({inputs:{opening_credit:100,withholding_credit:25,adjustment_basis:'Fictional basis for the corrected output VAT'}});
 const saved=(await tx`select inputs from erp_private.tax_cases where case_id=${A1}`)[0].inputs;
 assert.deepEqual([saved.opening_credit,saved.withholding_credit,saved.adjustment_basis,saved.bank_reconciliation.note],[100,25,'Fictional basis for the corrected output VAT','filed'],'source figures are the filed version\'s; only the adjustment changed');
 // the original is untouched
 assert.deepEqual((await tx`select inputs->>'opening_credit' c,status from erp_private.tax_cases where case_id=${orig}`)[0],{c:'100',status:'Filed'});
 // PAYE (and any tax with no adjustment fields) cannot be amended yet
 const po=id();await db.query(`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by,reviewed_by,review_snapshot,status,filing_date,inputs) values($1,$2,'PAYE','2026-06-01','2026-06-30',$3,$4,'{}','Filed','2026-07-08','{"employees":[]}')`,[po,PJ,AST,M]);
 await assert.rejects(tax('MANAGER',{action:'tax_amend',case_id:po,reason:'Correct one employee gross pay'}),/no adjustment lines yet/);
 // the guard lets a genuine adjustment through at the database
 await tx`update erp_private.tax_cases set inputs=inputs||'{"adjustments":[{"note":"fictional"}],"adjustment_basis":"Fictional basis"}'::jsonb where case_id=${A1}`;
 assert.equal((await tx`select inputs->>'opening_credit' c from erp_private.tax_cases where case_id=${A1}`)[0].c,'100');
 // the filed original and its source remain closed to editing
 await assert.rejects(tx`update erp_private.tax_cases set inputs='{"opening_credit":1}'::jsonb where case_id=${orig}`,/locked|Locked|Tax file/i);
 assert.equal((await tx`select erp_private.tax_period_open(${PJ}::uuid,'2026-06-01'::date,'2026-06-30'::date) o`)[0].o,false,'source rows for the filed period stay frozen');
});
