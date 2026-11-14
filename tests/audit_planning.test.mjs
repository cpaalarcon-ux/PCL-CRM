// Audit build A: materiality with Partner approval, risk register, and the database gates on the audit file.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {computeMateriality,planningGateSummary,createPlanningUI} from '../staff-audit-planning.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('materiality arithmetic and gate summary',()=>{
 assert.deepEqual(computeMateriality('10,000,000',1,75,5),{overall:100000,performance:75000,trivial:5000});
 assert.equal(computeMateriality('0',1,75,5),null);assert.equal(computeMateriality('abc',1,75,5),null);
 assert.equal(planningGateSummary(null).ready,false);
 assert.equal(planningGateSummary({materiality_approved:true,risks_open:2,fraud_risk_recorded:true,uncovered:[]}).ready,true);
 assert.equal(planningGateSummary({materiality_approved:true,risks_open:2,fraud_risk_recorded:true,uncovered:['R-002']}).ready,false);
});
test('screen shows approval and coverage by role',()=>{
 let me={staff_id:'p2',category_code:'PARTNER'},snap={file:{file_status:'Draft'},materiality:[{materiality_id:'m1',version_number:1,status:'Draft',benchmark:'Revenue',base_amount:'1000000',overall_pct:'1',performance_pct:'75',trivial_pct:'5',overall_amount:'10000',performance_amount:'7500',trivial_amount:'500',rationale:'<b>x</b>',prepared_by:'s1',prepared_by_name:'Sam'}],
  risks:[{risk_id:'r1',risk_ref:'R-001',description:'Revenue may be overstated',audit_area:'Revenue',assertion:'Occurrence',risk_level:'High',significant:true,fraud_risk:true,planned_response:'Test sales cut-off',status:'Open',created_by:'s1'}],risk_links:[],workpapers:[],planning_gate:{materiality_approved:false,risks_open:1,fraud_risk_recorded:true,uncovered:['R-001']}};
 const ui=()=>createPlanningUI({esc,field:()=>'',select:()=>'',form:x=>x,modal(){},request(){},notice(){},shortDate:String,data:()=>({me}),snapshot:()=>snap,refresh(){}});
 let html=ui().panel(snap.file,snap);
 assert.match(html,/data-audit-mat-approve="m1"/);assert.match(html,/No working paper yet/);assert.match(html,/Not covered by a working paper: R-001/);assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/);assert.match(html,/data-audit-risk-new/);
 me={staff_id:'s1',category_code:'SUPERVISOR'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-mat-approve/,'only a Partner approves');assert.doesNotMatch(html,/data-audit-risk-close/);
 me={staff_id:'a1',category_code:'ASSISTANT'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-mat-new|data-audit-risk-new|data-audit-risk-edit/,'an Assistant cannot plan');
 me={staff_id:'m1',category_code:'MANAGER'};html=ui().panel(snap.file,snap);assert.match(html,/data-audit-risk-close="r1"/);
 snap.file.file_status='Archived';html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-risk-new|data-audit-risk-edit/,'archived files are read-only');
});

test('wiring',()=>{
 assert.match(rd(fx+'audit-actions.ts'),/audit_materiality_approve/);assert.match(rd(fx+'audit-actions.ts'),/audit_risk_link/);assert.match(rd('staff-audit.mjs'),/Materiality & risk/);assert.match(rd('staff-audit.mjs'),/planning\.handle\(b/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('materiality, risks and file gates are enforced by the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDQ','Fictional audit planning firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Audit Planning Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional statutory audit','AUD-STAT',${M})`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const FILE=id();
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE},${P},${C},${F},'2025-01-01','2025-12-31','First-year','IFRS for SMEs',${M})`;
 const mat=(role,over={})=>as(role,()=>tx`select erp_private.audit_materiality_save(${FILE}::uuid,${over.b||'Revenue'},${''},${over.base??50000000}::numeric,${over.o??1}::numeric,${over.p??75}::numeric,${over.t??5}::numeric,${over.why||'Revenue is stable and users focus on turnover, so it is the benchmark'}) id`).then(r=>r[0].id);
 const risk=(role,o={})=>as(role,()=>tx`select erp_private.audit_risk_save(${FILE}::uuid,${o.id||null}::uuid,${o.d||'Revenue may be recognised before delivery'},${o.area||'Revenue'},${o.as||'Occurrence'},${o.lvl||'High'},${o.sig??true},${o.fraud??false},${o.resp||'Test sales cut-off around year end'}) id`).then(r=>r[0].id);
 const stat=async s=>(await tx`select file_status from erp_private.audit_files where audit_file_id=${FILE}`)[0].file_status;
 const move=async s=>tx`update erp_private.audit_files set file_status=${s} where audit_file_id=${FILE}`;
 // Materiality: who may prepare, arithmetic, trivial limit, approval by someone else.
 await assert.rejects(()=>mat('ASSISTANT'),/Supervisor, Manager or Partner prepares/);
 await assert.rejects(()=>mat('SUPERVISOR',{why:'too short'}),/at least 30 characters/);
 await assert.rejects(()=>mat('SUPERVISOR',{o:0}),/Percentages/);
 await assert.rejects(()=>mat('SUPERVISOR',{p:10,t:20}),/not be more than performance/);
 const m1=await mat('SUPERVISOR');
 const row=(await tx`select overall_amount,performance_amount,trivial_amount,status,version_number from erp_private.audit_materiality where materiality_id=${m1}`)[0];
 assert.deepEqual([Number(row.overall_amount),Number(row.performance_amount),Number(row.trivial_amount),row.status,row.version_number],[500000,375000,25000,'Draft',1]);
 assert.ok((await tx`select 1 from erp_private.notifications where event_key like ${'audit-materiality:'+m1+'%'}`).length>=2,'Partners are told');
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_materiality_approve(${m1}::uuid)`),/Only a Partner/);
 // The file cannot be marked Prepared yet.
 await assert.rejects(()=>move('Prepared'),/Partner must approve materiality/);
 await as('PARTNER',()=>tx`select erp_private.audit_materiality_approve(${m1}::uuid)`);
 assert.equal((await tx`select status from erp_private.audit_materiality where materiality_id=${m1}`)[0].status,'Approved');
 await move('Prepared');assert.equal(await stat(),'Prepared');
 // A Partner who prepared a version cannot approve it; a second Partner can. The new version replaces the approved one.
 const m2=await mat('PARTNER',{o:2});
 await assert.rejects(()=>as('PARTNER',()=>tx`select erp_private.audit_materiality_approve(${m2}::uuid)`),/Another Partner/);
 await as('PARTNER2',()=>tx`select erp_private.audit_materiality_approve(${m2}::uuid)`);
 assert.deepEqual((await tx`select version_number,status from erp_private.audit_materiality order by version_number`).map(x=>x.status),['Superseded','Approved']);
 await assert.rejects(()=>tx`update erp_private.audit_materiality set approved_by=prepared_by where materiality_id=${m2}`,/violates check/);
 // Risks: roles, fraud implies significant, numbering.
 await assert.rejects(()=>risk('ASSISTANT'),/Supervisor, Manager or Partner records/);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.audit_risk_save(${FILE}::uuid,null::uuid,'Revenue may be recognised early','Revenue','Occurrence','High',false,true,'Test sales cut-off properly')`),/always a significant risk/);
 const r1=await risk('SUPERVISOR'),r2=await risk('SUPERVISOR',{d:'Management could override controls to manipulate results',area:'Planning',as:'Presentation',fraud:true,resp:'Test journals and estimates for bias'});
 assert.deepEqual((await tx`select risk_ref from erp_private.audit_risks order by risk_seq`).map(x=>x.risk_ref),['R-001','R-002']);
 // Review gates: working paper cover, fraud risk, open risks.
 await assert.rejects(()=>move('In Review'),/Not covered yet: R-001, R-002|Every open risk needs a working paper/);
 const WP=id(),WP2=id();
 for(const [w,ref,st] of [[WP,'WP-REV','Draft'],[WP2,'WP-PLN','Draft']])await tx`insert into erp_private.audit_workpapers(audit_workpaper_id,audit_file_id,project_id,handling_firm_id,workpaper_ref,audit_area,objective,assertion,linked_risk,standard_reference,planned_procedure,responsible_staff_id,prepared_by,status) values(${w},${FILE},${P},${F},${ref},'Revenue','Objective','Occurrence','R','ISA 330','Procedure',${actors.ASSISTANT.staff_id},${actors.ASSISTANT.staff_id},${st})`;
 const link=(role,w,r,on=true)=>as(role,()=>tx`select erp_private.audit_risk_link(${w}::uuid,${r}::uuid,${on})`);
 await assert.rejects(()=>link('INTERN',WP,r1),/Not allowed/);
 await link('ASSISTANT',WP,r1);await link('SUPERVISOR',WP2,r2);
 assert.equal((await as('ASSISTANT',()=>tx`select * from erp_private.audit_workpaper_risks where unlinked_at is null`)).length,2);
 await move('In Review');assert.equal(await stat(),'In Review');
 // Unlinking keeps the record; the gate reacts. Submitted working papers cannot be re-linked.
 await move('Returned');
 await link('ASSISTANT',WP,r1,false);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_workpaper_risks where risk_id=${r1}`)[0].n,1,'the link row is kept');
 await assert.rejects(()=>move('In Review'),/Not covered yet: R-001/);
 await move('Prepared');
 await link('ASSISTANT',WP,r1,true);
 await tx`update erp_private.audit_workpapers set status='Submitted',submitted_at=now() where audit_workpaper_id=${WP}`;
 await assert.rejects(()=>link('SUPERVISOR',WP,r1,false),/draft or returned/);
 // Closing a risk: a different Manager or Partner, with a reason; a closed risk no longer needs cover.
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.audit_risk_close(${r1}::uuid,'No longer relevant at all')`),/Manager or Partner closes/);
 const r3=await risk('MANAGER',{d:'Cash may be misstated at a branch account',area:'Cash and bank',as:'Existence',lvl:'Low',sig:false});
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_risk_close(${r3}::uuid,'The branch account was closed in June')`),/Someone other than/);
 await assert.rejects(()=>as('PARTNER',()=>tx`select erp_private.audit_risk_close(${r3}::uuid,'short')`),/at least 10 characters/);
 await as('PARTNER',()=>tx`select erp_private.audit_risk_close(${r3}::uuid,'The branch account was closed in June')`);
 assert.equal((await as('PARTNER',()=>tx`select erp_private.audit_planning_gate(${FILE}::uuid) g`))[0].g.uncovered.length,0);
 // Read scope: Interns and unassigned staff see nothing.
 assert.equal((await as('INTERN',()=>tx`select * from erp_private.audit_risks`)).length,0);
 assert.equal((await as('INTERN',()=>tx`select * from erp_private.audit_materiality`)).length,0);
 // Closed files take no planning changes.
 await tx`update erp_private.audit_files set file_status='Archived',archived_by=${M},archived_at=now() where audit_file_id=${FILE}`;
 await assert.rejects(()=>mat('SUPERVISOR'),/closed to planning changes/);
});
