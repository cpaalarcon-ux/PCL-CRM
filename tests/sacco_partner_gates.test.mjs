import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {sasraAction} from '../supabase/functions/staff-workspace-v12/sasra-actions.ts';
import {regulatoryAction} from '../supabase/functions/staff-workspace-v12/regulatory-actions.ts';
import {typeLabel,policyText,ratioRule,signoffSummary,createSasraUI} from '../staff-audit-sasra.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id(),C2=id(),C3=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
tx.json=x=>JSON.stringify(x);
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('S3 gates: SASRA eligibility, EQCR, ratio breach, policy and the sign-off block',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit adjustments firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 await db.exec('alter table erp_private.audit_files disable trigger planning_guard;alter table erp_private.audit_files disable trigger lead_guard;alter table erp_private.audit_files disable trigger report_guard;alter table erp_private.audit_files disable trigger analytics_guard');
 const M=actors.MANAGER.staff_id,FY=new Date().getFullYear()-1;
 const act=(role,p)=>as(role,a=>sasraAction(tx,a,p));
 const reg=(role,p)=>as(role,a=>regulatoryAction(tx,a,p));
 const sql=(role,q,v=[])=>as(role,()=>db.query(q,v).then(r=>r.rows));
 const doc=async(client,name)=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${client},${F},'Permanent File',${name},${'k/'+d},100,${'a'.repeat(64)},'application/pdf',${M})`;return d;};
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mkopo SACCO',${M}),(${C2},'Fictional Umoja NWDT SACCO',${M}),(${C3},'Fictional Biashara Ltd',${M})`;
 for(const c of [C,C2,C3])await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;
 await tx`update erp_private.clients set legal_structure='Co-operative Society',legal_subtype='Deposit-taking SACCO' where client_id=${C}`;
 await tx`update erp_private.clients set legal_structure='Co-operative Society',legal_subtype='Non-withdrawable-deposit-taking SACCO' where client_id=${C2}`;
 const mkProject=(client,name)=>tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${client},${F},${name},'AUD-STAT',${M})`;

 // 1. The eligibility gate: no project without a Partner's record, a "not listed" record still blocks, and proof is required.
 await assert.rejects(()=>mkProject(C,'Fictional SACCO audit'),/Partner must verify SASRA auditor eligibility first/);
 const D=await doc(C,'SASRA list.pdf'),DOther=await doc(C3,'Other client list.pdf');
 const elig=(role,over)=>act(role,{action:'audit_sasra_eligibility_record',client_id:C,firm_id:F,financial_year:FY,is_approved:true,confirm:true,proof_document_id:D,listing_reference:'Fictional circular 4, page 3',independence_note:'Fictional: no threats to independence found',...over});
 await assert.rejects(()=>elig('MANAGER',{}),/Only a Partner/);
 await assert.rejects(()=>elig('PARTNER',{confirm:false}),/Tick the confirmation/);
 await assert.rejects(()=>elig('PARTNER',{proof_document_id:null}),/Attach the SASRA approved auditor list/);
 await assert.rejects(()=>elig('PARTNER',{proof_document_id:DOther}),/Attach the SASRA approved auditor list/,'a document from another client is refused');
 await assert.rejects(()=>act('PARTNER',{action:'audit_sasra_eligibility_record',client_id:C3,firm_id:F,financial_year:FY,is_approved:true,confirm:true,proof_document_id:DOther,listing_reference:'Fictional',independence_note:'Fictional note about independence'}),/not classified as a SACCO/);
 await elig('PARTNER',{is_approved:false,proof_document_id:null,listing_reference:'Fictional: firm not on the list',confirm:false});
 await assert.rejects(()=>mkProject(C,'Fictional SACCO audit'),/Partner must verify SASRA auditor eligibility first/);
 await elig('PARTNER',{});
 await mkProject(C,'Fictional SACCO audit');
 await assert.rejects(()=>tx`update erp_private.sasra_verification_logs set is_approved=false`,/append-only/);
 for(const role of ['PARTNER','MANAGER','SUPERVISOR'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const FILE=id();
 await assert.rejects(()=>tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${id()},${P},${C},${F},${(FY-1)+'-01-01'},${(FY-1)+'-12-31'},'First-year','IFRS for SMEs',${M})`,/eligibility for financial year/);
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE},${P},${C},${F},${FY+'-01-01'},${FY+'-12-31'},'First-year','IFRS for SMEs',${M})`;
 // A non-SACCO client is not caught by the gate.
 const P3=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P3},${C3},${F},'Fictional ordinary audit','AUD-STAT',${M})`;
 assert.equal(await sql('MANAGER','select erp_private.sasra_file_overview($1) r',[FILE]).then(r=>r[0].r.sacco_type),'DT_SACCO');

 // 2. Ratios: a draft is not a rule; activation needs a Partner, a primary-source reference and confirmed definitions.
 const ratio={action:'audit_sasra_ratio_save',ratio_code:'core_capital_to_assets',label:'Fictional core capital to total assets',sacco_type:'DT_SACCO',measure:'Percentage',comparator:'At least',threshold:'8',numerator_line:'CORE_CAPITAL',denominator_line:'TOTAL_ASSETS',effective_from:(FY-1)+'-01-01'};
 await assert.rejects(()=>act('SUPERVISOR',ratio),/Manager or a Partner|Manager or Partner/);
 await assert.rejects(()=>act('MANAGER',{...ratio,threshold:'eight'}),/positive number/);
 await assert.rejects(()=>act('MANAGER',{...ratio,measure:'Percentage',denominator_line:''}),/Check the required text/);
 const saved=await act('MANAGER',ratio);let rr=(await tx`select * from erp_private.sasra_ratios where ratio_id=${saved.ratio_id}`)[0];
 assert.equal(rr.ratio_code,'CORE_CAPITAL_TO_ASSETS');assert.equal(rr.status,'Draft');
 assert.equal((await sql('MANAGER','select erp_private.sasra_breach_check($1) r',[FILE]))[0].r.length,0,'a draft ratio does not apply');
 const activate=()=>act('PARTNER',{action:'audit_sasra_ratio_activate',ratio_id:saved.ratio_id,revision:String(rr.revision),note:'Fictional: checked page 12 of the source'});
 await assert.rejects(()=>act('MANAGER',{action:'audit_sasra_ratio_activate',ratio_id:saved.ratio_id,revision:'1',note:'Fictional note ok here'}),/Only a Partner/);
 await assert.rejects(()=>activate(),/Link the SASRA source/);
 const refRow=(await tx`select * from erp_private.legal_references where ref_code='SASRA-CIRC-2025-12'`)[0];
 await act('MANAGER',{...ratio,ratio_id:saved.ratio_id,revision:String(rr.revision),reference_id:refRow.ref_id});rr=(await tx`select * from erp_private.sasra_ratios where ratio_id=${saved.ratio_id}`)[0];
 await assert.rejects(()=>activate(),/not verified from the primary source/);
 await reg('MANAGER',{action:'audit_reg_reference_save',ref_id:refRow.ref_id,revision:String(refRow.revision),title:refRow.title,instrument_type:'Circular',legal_status:'Binding direction',applies_to:['ALL_SACCO'],citation:'Fictional',source_url:'https://example.test/fictional-circular'});
 const r2=(await tx`select * from erp_private.legal_references where ref_id=${refRow.ref_id}`)[0];
 await reg('PARTNER',{action:'audit_reg_reference_verify',ref_id:r2.ref_id,revision:String(r2.revision),level:'Primary source verified',note:'Fictional: read on the SASRA site'});
 await assert.rejects(()=>activate(),/must confirm the definition of "Core capital"/);
 await act('PARTNER',{action:'audit_sasra_line_define',line_code:'CORE_CAPITAL',definition:'Fictional definition of core capital for the test'});
 await assert.rejects(()=>activate(),/must confirm the definition of "Total assets"/);
 await act('PARTNER',{action:'audit_sasra_line_define',line_code:'TOTAL_ASSETS',definition:'Fictional definition of total assets for the test'});
 await activate();rr=(await tx`select * from erp_private.sasra_ratios where ratio_id=${saved.ratio_id}`)[0];assert.equal(rr.status,'Active');assert.equal(rr.confirmed_by,actors.PARTNER.staff_id);
 await assert.rejects(()=>act('MANAGER',{...ratio,ratio_id:saved.ratio_id,revision:String(rr.revision)}),/cannot be edited/);

 // 3. The check: missing figures are not a pass, 6.5% is a breach, and the Partner must acknowledge it.
 const check=async()=>(await sql('MANAGER','select erp_private.sasra_breach_check($1) r',[FILE]))[0].r;
 let c=await check();assert.equal(c.length,1);assert.equal(c[0].state,'Figures missing');
 const issues=async()=>(await sql('MANAGER','select erp_private.sasra_signoff_issues($1) r',[FILE]))[0].r;
 assert.ok((await issues()).some(i=>/Enter the figures for Fictional core capital/.test(i)));
 const fig=(role,line,amount,over)=>act(role,{action:'audit_sasra_figure_save',audit_file_id:FILE,line_code:line,amount,source_note:'Fictional WP E1',...over});
 await assert.rejects(()=>fig('INTERN','CORE_CAPITAL','65'),/audit staff member|Intern/);
 await assert.rejects(()=>fig('SUPERVISOR','CORE_CAPITAL','-5'),/positive number/);
 await fig('SUPERVISOR','CORE_CAPITAL','65');await fig('SUPERVISOR','TOTAL_ASSETS','1000');
 c=await check();assert.equal(c[0].state,'Breach');assert.equal(Number(c[0].value),6.5);assert.equal(c[0].acknowledged,false);
 assert.ok((await issues()).some(i=>/Regulatory breach not acknowledged by a Partner/.test(i)&&/6\.5/.test(i)));
 const ack=(role,note='Fictional: disclosed in the SASRA report and the emphasis paragraph')=>act(role,{action:'audit_sasra_breach_ack',audit_file_id:FILE,ratio_id:saved.ratio_id,note});
 await assert.rejects(()=>ack('MANAGER'),/Only a Partner/);
 await assert.rejects(()=>ack('PARTNER','too short'),/at least 20/);
 await ack('PARTNER');c=await check();assert.equal(c[0].acknowledged,true);assert.equal(c[0].ack_by,'Fictional PARTNER');
 await fig('SUPERVISOR','CORE_CAPITAL','60');c=await check();assert.equal(c[0].acknowledged,false,'new figures need a new acknowledgement');assert.equal(c[0].ack_stale,true);
 await fig('SUPERVISOR','CORE_CAPITAL','90');c=await check();assert.equal(c[0].state,'Met');assert.equal(Number(c[0].value),9);
 await assert.rejects(()=>ack('PARTNER'),/not in breach/);
 await fig('SUPERVISOR','CORE_CAPITAL','65');await ack('PARTNER');
 // The Audit home lists the two SACCO clients.
 assert.equal((await sql('MANAGER','select erp_private.sasra_overview() r'))[0].r.saccos.length,2);

 // 4. EQCR: needed for a deposit-taking SACCO, by a Partner with no part in the engagement, and only while the file is In Review.
 assert.equal((await sql('MANAGER','select erp_private.audit_eqcr_required($1) r',[FILE]))[0].r,true);
 assert.ok((await issues()).some(i=>/EQCR Partner approval required before final sign-off/.test(i)));
 await assert.rejects(()=>act('PARTNER2',{action:'audit_eqcr_decide',audit_file_id:FILE,decision:'Approve',note:'Fictional review of the file and the opinion'}),/while the file is In Review/);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 const st=async role=>(await sql(role,'select erp_private.audit_eqcr_status($1) r',[FILE]))[0].r;
 let eq=await st('PARTNER');assert.equal(eq.can_act,false);assert.ok(eq.my_conflicts.includes('assigned to the engagement'));
 eq=await st('PARTNER2');assert.equal(eq.can_act,true);assert.equal(eq.eligible_partners,1);
 const decide=(role,decision,note='Fictional review of the file and the opinion')=>act(role,{action:'audit_eqcr_decide',audit_file_id:FILE,decision,note});
 await assert.rejects(()=>decide('PARTNER','Approve'),/cannot be the EQCR Partner.*assigned to the engagement/);
 await assert.rejects(()=>decide('MANAGER','Approve'),/Only a Partner/);
 await assert.rejects(()=>decide('PARTNER2','Approve','short'),/at least 20/);
 // A Partner who logged time on the file is also out.
 const tk=id();await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name,status) values(${tk},${P},${actors.PARTNER.staff_id},'Fieldwork','Pending')`;
 await tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,status) values(${actors.PARTNER2.staff_id},${P},${tk},current_date,1,'Fictional review time','Draft')`.catch(()=>null);
 const timeConflict=(await st('PARTNER2')).my_conflicts.includes('logged time on the engagement');
 if(timeConflict){await assert.rejects(()=>decide('PARTNER2','Approve'),/logged time/);await tx`update erp_private.timesheets set deleted_at=now() where staff_id=${actors.PARTNER2.staff_id}`;}
 await decide('PARTNER2','Approve');eq=await st('PARTNER');assert.equal(eq.approved,true);assert.equal(eq.last_by,'Fictional PARTNER2');
 assert.deepEqual((await issues()).filter(i=>!/SACCO statement layout|Section 10 item/.test(i)),[],'eligibility, acknowledged breach and EQCR: nothing blocks sign-off (the S4 layout and section-10 items are tested in sacco_statements.test.mjs)');
 // Returning the file withdraws the approval.
 await tx`update erp_private.audit_files set file_status='Returned' where audit_file_id=${FILE}`;
 eq=await st('PARTNER');assert.equal(eq.approved,false);assert.equal(eq.last_kind,'EQCR approval void');assert.ok((await issues()).some(i=>/EQCR Partner approval required/.test(i)));
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await decide('PARTNER2','Return','Fictional: further evidence needed on the loan book');
 assert.equal((await tx`select file_status from erp_private.audit_files where audit_file_id=${FILE}`)[0].file_status,'Returned');
 await assert.rejects(()=>tx`update erp_private.audit_quality_logs set note='Edited afterwards for the test'`,/append-only/);
 // The Partner setting can switch the deposit-taking EQCR off, and the engagement control keeps the flag while it is on.
 await tx`insert into erp_private.engagement_controls(project_id,eqr_required) values(${P},false)`;
 assert.equal((await tx`select eqr_required from erp_private.engagement_controls where project_id=${P}`)[0].eqr_required,true,'the flag cannot be left off for a deposit-taking SACCO');

 // 5. Firm policy and the report date: Partner only, shown as default until confirmed, and the deadline follows the setting.
 const pol=(role,key,value,note='Fictional: firm decision recorded')=>act(role,{action:'audit_policy_save',key,value,note});
 const settings=async()=>Object.fromEntries((await sql('MANAGER','select erp_private.sasra_overview() r'))[0].r.policy.map(p=>[p.key,p]));
 let s=await settings();assert.equal(s.AUDIT_FILE_LOCK_DAYS.value,'60');assert.equal(s.AUDIT_FILE_LOCK_DAYS.confirmed,false);assert.equal(s.AUDIT_FILE_LOCK_ANCHOR.value,'REPORT_DATE');
 await assert.rejects(()=>pol('MANAGER','AUDIT_FILE_LOCK_DAYS','90'),/Only a Partner/);
 await assert.rejects(()=>pol('PARTNER','AUDIT_FILE_LOCK_DAYS','0'),/1 to 365/);
 await assert.rejects(()=>pol('PARTNER','OTHER_KEY','1'),/valid option/);
 await assert.rejects(()=>pol('PARTNER','AUDIT_FILE_LOCK_DAYS','90','short'),/at least 10/);
 const assembly=async()=>(await sql('MANAGER','select erp_private.audit_assembly_deadline($1) r',[FILE]))[0].r;
 let as1=await assembly();assert.equal(as1.deadline,null,'no deadline until the report date is set');assert.equal(as1.days,60);assert.equal(as1.days_confirmed,false);
 const rdate=(role,d,note)=>act(role,{action:'audit_report_date_save',audit_file_id:FILE,audit_report_date:d,note});
 await assert.rejects(()=>rdate('MANAGER',(FY+1)+'-03-20'),/Only a Partner/);
 await assert.rejects(()=>rdate('PARTNER',FY+'-12-31'),/after the end of the audit period/);
 await rdate('PARTNER',(FY+1)+'-03-20');as1=await assembly();assert.equal(String(as1.deadline).slice(0,10),(FY+1)+'-05-19');
 await assert.rejects(()=>rdate('PARTNER',(FY+1)+'-03-25'),/Record why/);
 await rdate('PARTNER',(FY+1)+'-03-25','Fictional: report signed later');
 await pol('PARTNER','AUDIT_FILE_LOCK_DAYS','90');as1=await assembly();assert.equal(as1.days_confirmed,true);assert.equal(as1.days,90);assert.equal(String(as1.deadline).slice(0,10),new Date(Date.UTC(FY+1,2,25)+90*864e5).toISOString().slice(0,10));
 await pol('PARTNER','AUDIT_FILE_LOCK_ANCHOR','YEAR_END');as1=await assembly();assert.equal(String(as1.deadline).slice(0,10),new Date(Date.UTC(FY,11,31)+90*864e5).toISOString().slice(0,10));
 await pol('PARTNER','SACCO_DT_REQUIRES_EQCR','false');
 assert.equal((await sql('MANAGER','select erp_private.audit_eqcr_required($1) r',[FILE]))[0].r,true,'the engagement control still asks for an EQR on this project');
 assert.ok((await tx`select 1 from erp_private.audit_events where action='REPORT_DATE_SET'`).length>=2);

 // 6. NWDT clients and others: the gate applies to every SACCO type; an ordinary client has none of this.
 const P2=id();await assert.rejects(()=>tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${C2},${F},'Fictional NWDT audit','AUD-STAT',${M})`,/Partner must verify SASRA/);
 assert.equal(await sql('MANAGER','select erp_private.sasra_file_overview($1) r',[FILE]).then(r=>r[0].r.sacco_type),'DT_SACCO');
 assert.equal((await sql('INTERN','select erp_private.sasra_overview() r'))[0].r,null);assert.equal((await sql('INTERN','select erp_private.sasra_file_overview($1) r',[FILE]))[0].r,null);
 await assert.rejects(()=>tx`delete from erp_private.sasra_ratios`,/archived, not deleted/);
});

test('the SASRA screens show blocks, defaults and Partner-only buttons; wiring and the sign-off block are in place',()=>{
 assert.equal(typeLabel('DT_SACCO'),'Deposit-taking SACCO');assert.equal(typeLabel('NWDT_SACCO'),'Non-withdrawable-deposit-taking SACCO');assert.equal(typeLabel(undefined),'Not a SACCO');
 assert.equal(policyText({key:'AUDIT_FILE_LOCK_DAYS',value:'60'}),'60 days');assert.equal(policyText({key:'AUDIT_FILE_LOCK_ANCHOR',value:'REPORT_DATE'}),'The audit report date');assert.equal(policyText({key:'SACCO_DT_REQUIRES_EQCR',value:'true'}),'Yes');
 assert.equal(ratioRule({measure:'Percentage',comparator:'At least',threshold:'8.0000',numerator_line:'A',denominator_line:'B'}),'At least 8% A ÷ B');
 assert.deepEqual(signoffSummary({issues:['x'],ratios:[{state:'Breach',acknowledged:false},{state:'Met'}]}),{blocked:true,count:1,breaches:1,unacknowledged:1});assert.equal(signoffSummary(null),null);
 let me={category_code:'MANAGER'};
 const ui=()=>createSasraUI({esc,field:()=>'',select:()=>'',form:x=>x,modal(){},request(){},notice(){},shortDate:String,data:()=>({me}),snapshot:()=>({}),refresh(){}});
 const home={policy:[{key:'AUDIT_FILE_LOCK_DAYS',value:'60',confirmed:false}],lines:[{line_code:'CORE_CAPITAL',label:'Core capital',defined_by:null}],ratios:[{ratio_id:'r1',label:'Fictional ratio',status:'Draft',measure:'Percentage',comparator:'At least',threshold:'8',numerator_line:'A',denominator_line:'B',sacco_type:'DT_SACCO',effective_from:'2026-01-01'}],saccos:[{client_id:'c1',firm_id:'f1',company_name:'Fictional SACCO',sacco_type:'DT_SACCO',firm_code:'X',records:[]}]};
 let html=ui().homePanel(home);assert.match(html,/Default — not yet confirmed by a Partner/);assert.match(html,/None recorded/);assert.doesNotMatch(html,/data-sasra-policy|data-sasra-activate|data-sasra-elig=|data-sasra-line/,'a Manager has no Partner buttons');assert.match(html,/data-sasra-ratio="r1"/);
 me={category_code:'PARTNER'};html=ui().homePanel(home);assert.match(html,/data-sasra-policy="AUDIT_FILE_LOCK_DAYS"/);assert.match(html,/data-sasra-activate="r1"/);assert.match(html,/data-sasra-elig="c1\|f1"/);assert.match(html,/Not defined yet/);
 const file={audit_file_id:'f',file_status:'In Review',client_id:'c1',handling_firm_id:'f1'};
 const s={sasra:{sacco_type:'DT_SACCO',financial_year:2026,eligible:true,eligibility_log:[],issues:['EQCR Partner approval required before final sign-off.'],ratios:[{ratio_id:'r1',label:'Fictional ratio',state:'Breach',value:'6.5',measure:'Percentage',comparator:'At least',threshold:'8',acknowledged:false}],figures:[],assembly:{days:60,anchor:'REPORT_DATE',days_confirmed:false},eqcr:{required:true,approved:false,eligible_partners:0,can_act:false,my_conflicts:['assigned to the engagement']},quality_log:[]}};
 html=ui().filePanel(file,s);assert.match(html,/Final sign-off is blocked/);assert.match(html,/Regulatory breach/);assert.match(html,/data-sasra-ack="r1"/);assert.match(html,/No Partner is free of a part/);assert.match(html,/you assigned to the engagement/);assert.doesNotMatch(html,/data-sasra-eqcr/);
 me={category_code:'MANAGER'};html=ui().filePanel(file,s);assert.doesNotMatch(html,/data-sasra-ack|data-sasra-report-date/);
 assert.match(ui().filePanel(file,{}),/not for a SACCO/);
 const src=rd(fx+'audit-actions.ts');assert.match(src,/sasraSignoffIssues\(tx,f\.audit_file_id\)/);assert.match(src,/SACCO sign-off is blocked/);assert.match(src,/audit_eqcr_status/);
 assert.match(rd('staff-audit.mjs'),/'SASRA & quality'/);assert.match(rd('staff-audit.mjs'),/sasra\.handle\(b/);
});
