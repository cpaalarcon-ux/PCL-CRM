import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {regulatoryAction} from '../supabase/functions/staff-workspace-v12/regulatory-actions.ts';
import {ruleSummary,registerSummary,appliesLabel,createRegulatoryUI} from '../staff-audit-regulatory.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),C2=id(),C3=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('S2 registers: legal references, regulatory calendar and legislative monitoring',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'LSQA','Fictional legal structure firm')`;
 const staff=async(role,cat,firm)=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${firm},'Assigned')`;};
 await staff('PARTNER','PARTNER',F);await staff('MANAGER','MANAGER',F);await staff('SUPERVISOR','SUPERVISOR',F);
 await staff('INTERN','INTERN',F);
 const act=(role,p)=>as(role,a=>regulatoryAction(tx,a,p));
 const reg=role=>as(role,async()=>(await tx`select erp_private.regulatory_register() r`)[0].r);
 const ref=async code=>(await tx`select * from erp_private.legal_references where ref_code=${code}`)[0];
 const item=async code=>(await tx`select * from erp_private.regulatory_calendar where item_code=${code}`)[0];

 // Seeds: everything starts unverified/unconfirmed and no date is shown.
 const refs=await tx`select * from erp_private.legal_references`,cal=await tx`select * from erp_private.regulatory_calendar`,mon=await tx`select * from erp_private.legislative_monitor`;
 assert.equal(refs.length,7);assert.ok(refs.every(r=>r.verification==='Unverified'&&r.verified_by===null));assert.equal(cal.length,3);assert.ok(cal.every(c=>c.status==='Unconfirmed'&&c.rule_type==='Unresolved'));assert.equal(mon.length,3);
 assert.equal((await ref('SACCO-AMEND-BILL-2025')).legal_status,'Proposed (Bill)','the Bill is proposed only');
 const s44=await item('S44-SEPARATE-AUDITOR-REPORT');assert.match(s44.as_reported,/not less than four months after year-end/);assert.match(s44.conflicting_wording,/within four months/,'both wordings are kept verbatim');
 assert.equal((await as('MANAGER',()=>tx`select erp_private.regulatory_due_date(${s44.item_id},'2026-12-31') d`))[0].d,null,'no date for an unconfirmed rule');
 for(const r of refs)assert.doesNotMatch(r.summary,/\b\d+(\.\d+)?\s?%/,'no ratio is stored in the reference summaries');

 // Reading: staff see the register, an Intern does not.
 const view=await reg('SUPERVISOR');assert.equal(view.references.length,7);assert.equal(view.calendar.length,3);assert.equal(registerSummary(view).unverifiedRefs,7);
 assert.equal(await reg('INTERN'),null);

 // Writing: Manager or Partner only.
 const newRef={ref_code:'sasra-guidance-2026',title:'Fictional SASRA guidance note 2026',instrument_type:'Guidance',legal_status:'Guidance only',applies_to:['DT_SACCO'],citation:'Fictional para 4'};
 await assert.rejects(()=>act('SUPERVISOR',{action:'audit_reg_reference_save',...newRef}),/Manager or Partner/);
 const made=await act('MANAGER',{action:'audit_reg_reference_save',...newRef});assert.ok(made.ref_id);assert.equal((await ref('SASRA-GUIDANCE-2026')).verification,'Unverified','code is upper-cased');
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_reference_save',...newRef,ref_code:'SASRA-GUIDANCE-2026'}),/duplicate|unique/i);
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_reference_save',...newRef,ref_code:'BAD-URL',source_url:'ftp://x'}),/http/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_reference_save',...newRef,ref_code:'BAD-APPLIES',applies_to:['EVERYONE']}),/valid option/);

 // Verification: Partner only; primary-source needs a web address and a legal status.
 const act2=ref0=>({action:'audit_reg_reference_verify',ref_id:ref0.ref_id,revision:String(ref0.revision)});
 let act2ref=await ref('SACCO-ACT-2008');
 await assert.rejects(()=>act('MANAGER',{...act2(act2ref),level:'Secondary source',note:'Fictional note about a trade summary'}),/Only a Partner/);
 await assert.rejects(()=>act('PARTNER',{...act2(act2ref),level:'Primary source verified',note:'Read on the official site'}),/primary-source web address/);
 await act('MANAGER',{action:'audit_reg_reference_save',ref_id:act2ref.ref_id,revision:String(act2ref.revision),title:act2ref.title,instrument_type:'Act',legal_status:'In force',applies_to:['ALL_SACCO'],citation:act2ref.citation,source_url:'https://example.test/fictional-act'});
 act2ref=await ref('SACCO-ACT-2008');
 await assert.rejects(()=>act('PARTNER',{...act2(act2ref),revision:'1',level:'Primary source verified',note:'Read on the official site'}),/changed/);
 await assert.rejects(()=>act('PARTNER',{...act2(act2ref),level:'Primary source verified',note:'short'}),/at least 10/);
 await act('PARTNER',{...act2(act2ref),level:'Primary source verified',note:'Fictional: read the Act on the official site'});
 act2ref=await ref('SACCO-ACT-2008');assert.equal(act2ref.verification,'Primary source verified');assert.equal(act2ref.verified_by,actors.PARTNER.staff_id);

 // Calendar: cannot be confirmed while unresolved, unlinked, or linked to an unverified reference.
 const agm=await item('AGM'),ab=await item('AUDIT-AND-SASRA-SUBMISSION');
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_calendar_confirm',item_id:ab.item_id,revision:String(ab.revision),note:'Fictional confirmation note'}),/Only a Partner/);
 await assert.rejects(()=>act('PARTNER',{action:'audit_reg_calendar_confirm',item_id:ab.item_id,revision:String(ab.revision),note:'Fictional confirmation note'}),/Enter the rule/);
 const save=(it,over)=>act('MANAGER',{action:'audit_reg_calendar_save',item_id:it.item_id,revision:String(it.revision),title:it.title,reference_id:it.reference_id,applies_to:it.applies_to,as_reported:it.as_reported,conflicting_wording:it.conflicting_wording,rule_type:it.rule_type,offset_months:it.offset_months,offset_days:it.offset_days,fixed_month:it.fixed_month,fixed_day:it.fixed_day,direction:it.direction,...over});
 await assert.rejects(()=>save(agm,{rule_type:'Period after year end'}),/months or days/);
 await save(agm,{rule_type:'Period after year end',offset_months:4,direction:'On or before'});
 const agm2=await item('AGM');
 await assert.rejects(()=>act('PARTNER',{action:'audit_reg_calendar_confirm',item_id:agm2.item_id,revision:String(agm2.revision),note:'Fictional confirmation note'}),/not verified from the primary source/);
 await save(ab,{rule_type:'Period after year end',offset_months:3,direction:'On or before'});
 let ab2=await item('AUDIT-AND-SASRA-SUBMISSION');
 await assert.rejects(()=>act('PARTNER',{action:'audit_reg_calendar_confirm',item_id:ab2.item_id,revision:String(ab2.revision),note:'short'}),/at least 10/);
 await act('PARTNER',{action:'audit_reg_calendar_confirm',item_id:ab2.item_id,revision:String(ab2.revision),note:'Fictional: matches the Act text'});
 ab2=await item('AUDIT-AND-SASRA-SUBMISSION');assert.equal(ab2.status,'Confirmed');

 // Dates come only from a confirmed rule, and keep the direction and the reported wording.
 const due=async(it,ye)=>(await act('SUPERVISOR',{action:'audit_reg_due_date',item_id:it.item_id,year_end:ye})).due;
 assert.deepEqual({...(await due(ab2,'2026-12-31')),date:undefined},{date:undefined,direction:'On or before',as_reported:ab2.as_reported});
 assert.equal(String((await due(ab2,'2026-12-31')).date).slice(0,10),'2027-03-31');assert.equal(String((await due(ab2,'2026-06-30')).date).slice(0,10),'2026-09-30');
 assert.equal((await due(await item('AGM'),'2026-12-31')),null,'unconfirmed rule gives no date');

 // Changing a confirmed rule, or the substance of its verified reference, takes the confirmation away.
 await save(ab2,{offset_months:2});assert.equal((await item('AUDIT-AND-SASRA-SUBMISSION')).status,'Unconfirmed');
 ab2=await item('AUDIT-AND-SASRA-SUBMISSION');await save(ab2,{offset_months:3});
 await act('PARTNER',{action:'audit_reg_calendar_confirm',item_id:ab2.item_id,revision:String((await item('AUDIT-AND-SASRA-SUBMISSION')).revision),note:'Fictional: matches the Act text again'});
 assert.equal((await item('AUDIT-AND-SASRA-SUBMISSION')).status,'Confirmed');
 const cur=await ref('SACCO-ACT-2008');
 const out=await act('MANAGER',{action:'audit_reg_reference_save',ref_id:cur.ref_id,revision:String(cur.revision),title:cur.title,instrument_type:'Act',legal_status:'In force',applies_to:['ALL_SACCO'],citation:'Fictional changed citation',source_url:cur.source_url});
 assert.equal(out.verification_reset,true);assert.equal(out.rules_unconfirmed,1);
 assert.equal((await ref('SACCO-ACT-2008')).verification,'Unverified');assert.equal((await item('AUDIT-AND-SASRA-SUBMISSION')).status,'Unconfirmed');
 // A Partner can withdraw a confirmed rule with a reason; it is audited.
 const fixed=await item('S44-SEPARATE-AUDITOR-REPORT');
 await assert.rejects(()=>act('PARTNER',{action:'audit_reg_calendar_withdraw',item_id:fixed.item_id,note:'Fictional withdrawal reason'}),/not confirmed/);
 // Fixed-date rule: the first such date on or after the year end.
 const cur2=await ref('SACCO-ACT-2008');await act('PARTNER',{action:'audit_reg_reference_verify',ref_id:cur2.ref_id,revision:String(cur2.revision),level:'Primary source verified',note:'Fictional: read the Act again'});
 await save(fixed,{rule_type:'Fixed date each year',fixed_month:3,fixed_day:31,direction:'Not earlier than'});
 const f2=await item('S44-SEPARATE-AUDITOR-REPORT');await act('PARTNER',{action:'audit_reg_calendar_confirm',item_id:f2.item_id,revision:String(f2.revision),note:'Fictional: wording settled by the Partner'});
 assert.equal(String((await due(f2,'2026-12-31')).date).slice(0,10),'2027-03-31');assert.equal((await due(f2,'2026-12-31')).direction,'Not earlier than');
 await act('PARTNER',{action:'audit_reg_calendar_withdraw',item_id:f2.item_id,note:'Fictional withdrawal reason'});
 assert.equal((await item('S44-SEPARATE-AUDITOR-REPORT')).status,'Unconfirmed');
 assert.ok((await tx`select 1 from erp_private.audit_events where action='RULE_WITHDRAWN'`).length>=1);

 // Monitoring: Manager logs checks, only a Partner closes, the next check is required, changes alert the Partners, checks are append-only.
 const bill=(await tx`select * from erp_private.legislative_monitor where title like 'Sacco Societies (Amendment)%'`)[0];
 assert.equal((await reg('MANAGER')).monitor.find(m=>m.entry_id===bill.entry_id).overdue,true,'no check scheduled counts as due');
 const tomorrow=new Date(Date.now()+864e5*30).toISOString().slice(0,10);
 await assert.rejects(()=>act('SUPERVISOR',{action:'audit_reg_monitor_check',entry_id:bill.entry_id,outcome:'No change',note:'Fictional check note here',next_check_due:tomorrow}),/Manager or Partner/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_monitor_check',entry_id:bill.entry_id,outcome:'No change',note:'Fictional check note here'}),/next check/);
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_monitor_check',entry_id:bill.entry_id,outcome:'No change',note:'short',next_check_due:tomorrow}),/at least 10|check/i);
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_monitor_check',entry_id:bill.entry_id,outcome:'Closed',note:'Fictional closing note here'}),/Only a Partner can close/);
 await act('MANAGER',{action:'audit_reg_monitor_check',entry_id:bill.entry_id,outcome:'Changed - needs review',note:'Fictional: committee stage reported',next_check_due:tomorrow});
 assert.ok((await tx`select 1 from erp_private.notifications where event_key like ${'regmon:'+bill.entry_id+'%'}`).length>=1,'Partners are alerted');
 assert.equal((await reg('MANAGER')).monitor.find(m=>m.entry_id===bill.entry_id).overdue,false);
 await assert.rejects(()=>tx`update erp_private.legislative_monitor_checks set note='Changed afterwards for test'`,/append-only/);
 await act('PARTNER',{action:'audit_reg_monitor_check',entry_id:bill.entry_id,outcome:'Closed',note:'Fictional: Bill lapsed, nothing to track'});
 await assert.rejects(()=>act('MANAGER',{action:'audit_reg_monitor_save',entry_id:bill.entry_id,revision:'9',title:bill.title,item_type:'Bill'}),/closed|changed/i);
 assert.equal((await tx`select count(*)::int n from erp_private.legislative_monitor_checks where entry_id=${bill.entry_id}`)[0].n,2);

 // Nothing is ever deleted.
 await assert.rejects(()=>tx`delete from erp_private.legal_references`,/archived, not deleted/);
});

test('register helpers describe a rule exactly and never invent a date',()=>{
 assert.equal(ruleSummary({rule_type:'Unresolved'}),'Rule not entered yet');
 assert.equal(ruleSummary({rule_type:'Period after year end',offset_months:4,direction:'On or before'}),'4 month(s) after the year end · On or before');
 assert.equal(ruleSummary({rule_type:'Fixed date each year',fixed_month:3,fixed_day:31,direction:'Not earlier than'}),'31 March each year · Not earlier than');
 assert.equal(appliesLabel(['DT_SACCO','OTHER']),'Deposit-taking SACCOs, Other entities');
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const ui=createRegulatoryUI({esc,field:()=>'',select:()=>'',form:x=>x,modal:()=>{},request:()=>{},notice:()=>{},shortDate:x=>String(x).slice(0,10),data:()=>({me:{category_code:'SUPERVISOR'}})});
 const html=ui.panel({references:[{ref_id:'r1',ref_code:'X-1',title:'Fictional Act',instrument_type:'Act',legal_status:'Not yet confirmed',applies_to:['ALL_SACCO'],verification:'Unverified'}],calendar:[{item_id:'c1',title:'AGM',as_reported:'AGM within 4 months',rule_type:'Unresolved',status:'Unconfirmed',applies_to:['DT_SACCO']}],monitor:[]});
 assert.match(html,/Unconfirmed — no date shown/);assert.doesNotMatch(html,/data-reg-cal-due/);assert.doesNotMatch(html,/data-reg-ref-edit|data-reg-ref-verify|data-reg-cal-confirm/,'a Supervisor sees no edit or Partner buttons');
 assert.equal(ui.panel(null),'');
});
