// Tax Manager role gate and annual due-date rules (build 2770).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const {taxConfigAction}=await import('../supabase/functions/staff-workspace-v12/tax-config-actions.ts');
const {taxManagerAction}=await import('../supabase/functions/staff-workspace-v12/tax-manager-actions.ts');
const {dueDateAction}=await import('../supabase/functions/staff-workspace-v12/due-date-actions.ts');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>"{"+x.join(",")+"}";
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Tax Manager role gate and annual due_month_offset rules',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const SUP=actors.SUPERVISOR.staff_id;
 const Z=await mk('UAT Fictional Role Client Ltd','A400000050Z'),PJ=await proj(Z,'TAX-KRA'),Z2=await mk('UAT Fictional Role Client Two Ltd','A400000051Z'),PJ2=await proj(Z2,'TAX-KRA');
 const tm=(role,p)=>as(role,a=>taxManagerAction(tx,a,p));
 const cfg=(role,p)=>as(role,a=>taxConfigAction(tx,a,p));
 const day=d=>d instanceof Date?d.toISOString().slice(0,10):d;
 const lead=role=>q(role,`select erp_private.tax_rules_approver() ok`).then(r=>r[0].ok);
 const vat=async(key)=>(await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,created_by) values(${key},'VAT','Staging rule for the role check','2040-01-01','2040-12-31','{"rate":16,"treatment":"Standard"}','https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax','VAT Act, section 5. Staging check of the role gate.',${M}) returning rate_id`)[0].rate_id;
 const approve=(role,rate)=>as(role,()=>db.query(`update erp_private.tax_rates set status='Approved',approved_by=$2,approved_at=now(),partner_source_verified_on=current_date where rate_id=$1`,[rate,actors[role].staff_id]));
 // ======================== A. Role-based Tax Manager =============================================================================================================
 const R=await vat('KE_FICT_ROLE1');
 // 1. Out of the box nobody can approve: the permission is OFF and nobody is assigned
 const base=await tm('PARTNER',{action:'tax_manager_read'});
 assert.deepEqual([base.permission.allowed,base.assignments.length,base.i_can_approve_tax_rules],[false,0,false]);
 assert.equal(base.rules.length,3);assert.equal(base.candidates.length,2,'a Partner can pick from the active Managers');
 for(const role of ['PARTNER','MANAGER','MANAGER2'])assert.equal(await lead(role),false);
 await assert.rejects(approve('MANAGER2',R),/designated Tax Manager/);
 // 2. Only a Partner assigns; only to an active Manager; one per engagement; with a reason
 const assign=(role,project,staff,reason='Designated Tax Manager for this engagement')=>tm(role,{action:'tax_manager_assign',project_id:project,staff_id:staff,reason});
 await assert.rejects(assign('MANAGER',PJ,M2),/Only an Engagement Partner/);
 await assert.rejects(assign('PARTNER',PJ,SUP),/The Tax Manager is a Manager/,'a Supervisor cannot hold the role');
 await assert.rejects(assign('PARTNER',PJ,actors.ASSISTANT.staff_id),/The Tax Manager is a Manager/);
 await assert.rejects(assign('PARTNER',PJ,M2,'short'),/at least 10/);
 const a1=(await assign('PARTNER',PJ,M2)).assignment_id;
 await assert.rejects(assign('PARTNER',PJ,M),/already has a Tax Manager/);
 // 3. Assigned but the permission is still OFF: still cannot approve
 assert.equal(await lead('MANAGER2'),false,'assignment alone does not give the permission');
 await assert.rejects(approve('MANAGER2',R),/designated Tax Manager/);
 // 4. Only a Partner switches the permission, with a written source; then the assigned Tax Manager (and only they) can approve
 const rev=async()=>(await tx`select revision from erp_private.tax_role_permissions`)[0].revision;
 await assert.rejects(tm('MANAGER2',{action:'tax_role_permission_set',allowed:true,revision:await rev(),source_note:'Partner decision of 10 Nov 2026'}),/Only an Engagement Partner/);
 await assert.rejects(tm('PARTNER',{action:'tax_role_permission_set',allowed:true,revision:await rev(),source_note:'short'}),/at least 10/);
 await tm('PARTNER',{action:'tax_role_permission_set',allowed:true,revision:await rev(),source_note:'Partner decision of 10 Nov 2026 20:16'});
 assert.equal(await lead('MANAGER2'),true,'assigned Tax Manager with the permission on');
 assert.equal(await lead('MANAGER'),false,'another Manager, not assigned');
 assert.equal(await lead('PARTNER'),false,'a Partner is not the Tax Manager by being a Partner');
 assert.equal(await lead('SUPERVISOR'),false);assert.equal(await lead('ASSISTANT'),false);
 await assert.rejects(approve('PARTNER',R),/designated Tax Manager/);
 await approve('MANAGER2',R);
 assert.equal((await tx`select status,approved_by from erp_private.tax_rates where rate_id=${R}`)[0].approved_by,M2,'approved by the assigned Tax Manager');
 // the Tax Manager cannot approve a rule they prepared
 const R2=await vat('KE_FICT_ROLE2');await tx`update erp_private.tax_rates set created_by=${M2} where rate_id=${R2}`;
 await assert.rejects(approve('MANAGER2',R2),/cannot confirm or approve/);
 // 5. Ending the assignment, switching the permission off, or a deleted engagement removes the ability
 const R3=await vat('KE_FICT_ROLE3');
 await tm('PARTNER',{action:'tax_manager_end',assignment_id:a1,reason:'Fictional: Tax Manager changed'});
 assert.equal(await lead('MANAGER2'),false,'assignment ended');
 await assert.rejects(approve('MANAGER2',R3),/designated Tax Manager/);
 const a2=(await assign('PARTNER',PJ2,M2)).assignment_id;assert.equal(await lead('MANAGER2'),true,'any current engagement assignment counts');
 await tm('PARTNER',{action:'tax_role_permission_set',allowed:false,revision:await rev(),source_note:'Partner decision to switch off'});
 assert.equal(await lead('MANAGER2'),false,'permission off');
 await tm('PARTNER',{action:'tax_role_permission_set',allowed:true,revision:await rev(),source_note:'Partner decision to switch on again'});
 assert.equal(await lead('MANAGER2'),true);
 // the individual named-person right still works beside the role
 await q('PARTNER',`select erp_private.staff_right_grant('${M}'::uuid,'APPROVE_TAX_RULES','Named Tax Manager formally assigned','${new Date(Date.now()+100*86400000).toISOString().slice(0,10)}'::date)`);
 assert.equal(await lead('MANAGER'),true,'a named person with the individual right');
 // read model for Managers: visible, but no candidates and no write
 const mread=await tm('MANAGER',{action:'tax_manager_read'});assert.deepEqual([mread.candidates.length,mread.permission.allowed],[0,true]);
 await assert.rejects(tm('SUPERVISOR',{action:'tax_manager_read'}),/Managers and Partners/);
 await assert.rejects(tm('MANAGER',{action:'tax_manager_end',assignment_id:a2,reason:'Fictional ending attempt'}),/Only an Engagement Partner/);
 // tables are read-only from the application role
 await assert.rejects(q('PARTNER',`update erp_private.tax_role_permissions set allowed=true`),/permission denied|row-level/i);
 await assert.rejects(q('PARTNER',`insert into erp_private.engagement_tax_managers(project_id,staff_id,assigned_by,reason) values('${PJ}','${M}','${PT}','Fictional direct insert attempt')`),/permission denied|row-level/i);
 // ======================== B. Annual due-date rules ==============================================================================================================
 const rd=(kind,ends)=>tx`select erp_private.period_due_suggest_kind(${kind},${ends}::date) d`.then(r=>day(r[0].d));
 assert.equal(await rd('Company','2026-12-31'),'2027-06-30','31 Dec year end: 30 June');
 assert.equal(await rd('Partnership','2026-12-31'),'2027-06-30');
 assert.equal(await rd('Company','2026-06-30'),'2026-12-30','a 30 June year end: six months later, on day 30');
 assert.equal(await rd('Individual','2026-12-31'),'2027-04-30','individual: 30 April of the following year');
 assert.equal(await rd('Individual','2025-12-31'),null,'no individual rule applies to periods before the 2026 year of income');
 assert.equal(await rd('VAT','2026-09-30'),'2026-10-20');assert.equal(await rd('WHT','2026-09-30'),null);
 assert.equal(day((await tx`select erp_private.period_due_internal_kind('Individual','2026-12-31') d`)[0].d),'2027-03-31','internal 31 March');
 assert.equal(day((await tx`select erp_private.period_due_internal_kind('Company','2026-12-31') d`)[0].d),'2027-05-31','internal 31 May');
 assert.equal((await tx`select erp_private.rule_date('2027-01-31'::date,1,30) d`)[0].d.toISOString().slice(0,10),'2027-02-28','the day is capped at the end of a short month');
 // the due-date gate shows the suggestion and the rule status; the Tax Team still confirms by hand
 const dstate=(role,kind,s,e)=>as(role,a=>dueDateAction(tx,a,{action:'due_date_state',project_id:PJ,kind,starts_on:s,ends_on:e}));
 let st=(await dstate('MANAGER','Company','2026-01-01','2026-12-31')).state;
 assert.deepEqual([day(st.suggested_due_date),day(st.internal_suggestion),st.status],['2027-06-30','2027-05-31',null],'suggested only, nothing confirmed');
 assert.match(st.suggestion_rule,/Company: 6 months after the period end, on day 30 \(rule suggested, not yet confirmed by a Partner\)/);
 st=(await dstate('MANAGER','Individual','2025-01-01','2025-12-31')).state;assert.equal(st.suggested_due_date,null,'no suggestion for an earlier individual period');
 await as('MANAGER',a=>dueDateAction(tx,a,{action:'due_date_confirm',project_id:PJ,kind:'Company',starts_on:'2026-01-01',ends_on:'2026-12-31',kra_due_date:'2027-06-30',itax_confirmed:'on'}));
 const saved=(await tx`select filing_class,kra_due_date::text d,suggested_due_date::text s,suggestion_rule from erp_private.period_due_dates where client_id=${Z}`)[0];
 assert.deepEqual([saved.filing_class,saved.d,saved.s],['ANNUAL','2027-06-30','2027-06-30']);
 // only a Partner changes or confirms a rule, with a written source; a change withdraws confirmation
 const rule=(await tx`select rule_id,revision from erp_private.annual_due_rules where tax_kind='Company'`)[0];
 await assert.rejects(tm('MANAGER',{action:'annual_due_rule_confirm',rule_id:rule.rule_id,revision:rule.revision,source_note:'Tax Lead memo 10 Nov 2026'}),/Only a Partner/);
 await assert.rejects(tm('PARTNER',{action:'annual_due_rule_confirm',rule_id:rule.rule_id,revision:rule.revision,source_note:'short'}),/at least 10/);
 await tm('PARTNER',{action:'annual_due_rule_confirm',rule_id:rule.rule_id,revision:rule.revision,source_note:'Tax Lead memo of 10 Nov 2026 (fictional)'});
 let r2=(await tx`select rule_status,confirmed_by from erp_private.annual_due_rules where rule_id=${rule.rule_id}`)[0];assert.deepEqual([r2.rule_status,r2.confirmed_by===PT],['Confirmed',true]);
 await assert.rejects(tm('PARTNER',{action:'annual_due_rule_confirm',rule_id:rule.rule_id,revision:rule.revision,source_note:'Stale revision attempt'}),/changed/);
 const cur=(await tx`select revision from erp_private.annual_due_rules where rule_id=${rule.rule_id}`)[0].revision;
 await assert.rejects(tm('PARTNER',{action:'annual_due_rule_set',rule_id:rule.rule_id,revision:cur,due_month_offset:13,external_deadline_day:30,internal_month_offset:5,internal_deadline_day:31}),/between 1 and 12/);
 await tm('PARTNER',{action:'annual_due_rule_set',rule_id:rule.rule_id,revision:cur,due_month_offset:5,external_deadline_day:31,internal_month_offset:4,internal_deadline_day:30});
 r2=(await tx`select rule_status,confirmed_by,due_month_offset from erp_private.annual_due_rules where rule_id=${rule.rule_id}`)[0];assert.deepEqual([r2.rule_status,r2.confirmed_by,r2.due_month_offset],['Suggested',null,5],'a change withdraws the confirmation');
 assert.equal(await rd('Company','2026-12-31'),'2027-05-31','the rule is data, not code');
 // the Partner's rules are seeded as Suggested, never as confirmed
 assert.deepEqual((await tx`select tax_kind,rule_status from erp_private.annual_due_rules order by tax_kind`).map(r=>r.tax_kind+':'+r.rule_status),['Company:Suggested','Individual:Suggested','Partnership:Suggested']);
 // closed doors
 const priv=(await tx`select has_function_privilege('anon','erp_private.tax_manager_assign(uuid,uuid,text)','execute') a,has_function_privilege('authenticated','erp_private.annual_due_rule_confirm(uuid,text)','execute') b,has_function_privilege('erp_api','erp_private.annual_due_rule_confirm(uuid,text)','execute') c`)[0];
 assert.deepEqual([priv.a,priv.b,priv.c],[false,false,true]);
 assert.equal((await tx`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname in('tax_manager_assign','tax_manager_end','tax_role_permission_set','rule_date','annual_due_rule_row','period_due_suggest_kind','period_due_internal_kind','period_due_rule_text','annual_due_rule_set','annual_due_rule_confirm','tax_rules_approver') and exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')`)[0].n,11);
});
