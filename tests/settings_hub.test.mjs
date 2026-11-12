// Settings hub, first slice (build 2787): the read-only list of settings sections with counts of defaults and waiting approvals.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const fx='supabase/functions/staff-workspace-v12/';
const {buildHub,searchSections,SECTIONS,OWNER_NOTE,COMPUTED_KEYS}=await import('../'+fx+'settings-hub-rules.mjs');
const {settingsHubAction}=await import('../'+fx+'settings-hub-actions.ts');
const {waitingView,tableView,hubView,createSettingsHubUI}=await import('../staff-settings-hub.mjs');
const esc=s=>String(s??'');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('pure: every section is listed once, owners are labelled as suggestions, nothing forensic',()=>{
 assert.equal(new Set(SECTIONS.map(s=>s.key)).size,SECTIONS.length);
 assert.match(OWNER_NOTE,/suggestions/);assert.match(OWNER_NOTE,/Partner has not yet confirmed/);
 assert.doesNotMatch(JSON.stringify(SECTIONS),/forensic|ISRS 4000/i);
 const h=buildHub([{section_key:'deadline_windows',pending:3,total:5},{section_key:'approve_chart',pending:2,total:90},{section_key:'licences',pending:0,total:4}]);
 const by=k=>h.sections.find(s=>s.key===k);
 assert.equal(by('deadline_windows').status,'3 of 5 still a default');assert.equal(by('licences').status,'All confirmed');assert.equal(by('kyc_rules').status,'Nothing set');
 assert.equal(by('approve_chart').pending,2);assert.match(by('approve_chart').status,/^2 /);assert.equal(by('approve_policies').status,'Nothing waiting');
 assert.deepEqual(h.waiting.map(s=>s.key),['approve_chart']);assert.equal(h.defaults,3,'only defaults, not approvals, are added up');
 assert.equal(h.note,OWNER_NOTE);
 assert.deepEqual(buildHub([]).waiting,[]);assert.equal(buildHub(null).defaults,0);
 assert.ok(searchSections(h.sections,'DEADLINE').some(s=>s.key==='deadline_windows'));assert.equal(searchSections(h.sections,'zzzz').length,0);assert.equal(searchSections(h.sections,'  ').length,h.sections.length);
});

test('server action: only Partners and Managers, and other actions pass through',async()=>{
 const rows=[{section_key:'licences',pending:'2',total:'4'}];let conf=[];const t=async(parts)=>String(parts[0]).includes('starter_rule_confirmations')?conf:rows;
 const out=await settingsHubAction(t,{category_code:'PARTNER'},{action:'settings_hub_read'});assert.equal(out.sections.find(s=>s.key==='licences').pending,2);
 await settingsHubAction(t,{category_code:'MANAGER'},{action:'settings_hub_read'});
 for(const c of ['SUPERVISOR','ASSISTANT','INTERN','ADMIN'])await assert.rejects(()=>settingsHubAction(t,{category_code:c},{action:'settings_hub_read'}),/Managers and Partners/);
 const sc=x=>x.sections.find(s=>s.key==='starter_confirmations');
 assert.equal(sc(out).pending,1,'the excise starter is locked, so one is waiting');assert.ok(out.waiting.some(s=>s.key==='starter_confirmations'));
 conf=[{rule_key:'excise-duty',account_code:'51070',status:'Confirmed'}];assert.equal(sc(await settingsHubAction(t,{category_code:'PARTNER'},{action:'settings_hub_read'})).pending,0,'a recorded confirmation clears it');
 assert.equal(await settingsHubAction(t,{category_code:'PARTNER'},{action:'something_else'}),undefined);
});

test('settings_hub(): counts agree with the tables, and only Partners and Managers get rows',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const hub=role=>as(role,()=>db.query('select section_key,pending,total from erp_private.settings_hub()').then(r=>Object.fromEntries(r.rows.map(x=>[x.section_key,x]))));
 const before=await hub('PARTNER');
 assert.deepEqual(Object.keys(before).sort(),SECTIONS.map(s=>s.key).filter(k=>!COMPUTED_KEYS.includes(k)).sort(),'the database answers for every section except those counted by the server code');
 // Direct counts, as the database owner, for tables with no client scoping.
 const n=async(sql)=>Number((await tx([sql]))[0].c);
 assert.equal(before.deadline_windows.total,await n(`select count(*) c from erp_private.deadline_settings`));
 assert.equal(before.deadline_windows.pending,await n(`select count(*) c from erp_private.deadline_settings where rule_status='Suggested'`));
 assert.equal(before.approve_chart.pending,await n(`select count(*) c from erp_private.account_catalog where status='Draft'`));
 assert.equal(before.approve_tax_rates.pending,await n(`select count(*) c from erp_private.tax_rates where status='Draft'`));
 // A Draft account and a proposed bank rule raise the waiting counts by one each.
 await tx`insert into erp_private.account_catalog(code,name,account_group,route,category_code,statement,catalog_version,status) values('99991','Fictional draft account','Test',1,'EXP','P&L','test','Draft')`;
 const C=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${C},'UAT Fictional Hub Ltd','A400000009Z','Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.bank_mapping_rules(client_id,keyword,account_code,status,created_by) values(${C},'fictional hub keyword','99991','Proposed',${actors.MANAGER.staff_id})`;
 const after=await hub('MANAGER');
 assert.equal(after.approve_chart.pending,before.approve_chart.pending+1);assert.equal(after.approve_chart.total,before.approve_chart.total+1);
 assert.equal(after.approve_bank_rules.pending,before.approve_bank_rules.pending+1,'the Manager owns the client, so the rule counts');
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN'])assert.deepEqual(Object.keys(await hub(role)),[],role+' gets no rows');
 // The database refuses the question to everyone but the application role.
 await db.exec('begin');await db.exec('set local role anon');await assert.rejects(()=>db.query('select * from erp_private.settings_hub()'),/permission denied/);await db.exec('rollback');
});

test('access: the action belongs to the settings area, which is for Managers and Partners',()=>{
 const src=rd(fx+'staff-access-control.mjs');assert.match(src,/settings_hub_\|/);
 const idx=rd(fx+'index.ts');assert.match(idx,/settingsHubAction/);
 for(const f of [fx+'settings-hub-rules.mjs','staff-settings-hub-rules.mjs'])assert.equal(rd(f),rd(fx+'settings-hub-rules.mjs'),'the two copies of the rules are identical');
});

test('UI: hub view, waiting list, search, escaping, roles, wiring and build label',()=>{
 const h=buildHub([{section_key:'approve_policies',pending:2,total:6},{section_key:'licences',pending:1,total:4}]);
 const v=hubView(h,'');assert.match(v,/Settings hub/);assert.match(v,/suggestions/);assert.match(v,/<b>1<\/b> setting is still a default/);assert.match(v,/Needs approval \(2\)/);assert.match(v,/id="hubSearch"/);assert.match(v,/id="hubTable"/);assert.match(v,/Defaults awaiting confirmation/);
 assert.match(hubView(buildHub([]),''),/Nothing is waiting for approval/);
 assert.match(tableView([]),/No settings section matches/);
 assert.match(hubView(h,'"><script>'),/value="&quot;&gt;&lt;script&gt;"/,'the search text is escaped');
 assert.doesNotMatch(v,/forensic/i);
 const ui=(role,req)=>createSettingsHubUI({request:req,render(){},data:()=>({me:{category_code:role}})});
 assert.equal(ui('SUPERVISOR',async()=>({})).card(),'');assert.equal(ui('ADMIN',async()=>({})).card(),'');
 assert.match(ui('PARTNER',async()=>h).card(),/Loading/);
 const suite=rd('staff-suite.mjs');assert.match(suite,/createSettingsHubUI/);assert.match(suite,/\$\{settingsHub\.card\(\)\}<section class="card"><div class="section-head"><h2>Reference documents/);
 assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261112-rateform-v1/);assert.match(suite,/staff-settings-hub\.mjs\?v=20261112-hubwait-v1/);
 assert.equal(JSON.parse(rd(fx+'release.json')).build,'2026-11-11.2791');assert.match(rd('staff-pilot.html'),/2026-11-11\.2791/);
 const mig=rd('supabase/migrations/20261111050000_settings_hub.sql');assert.doesNotMatch(mig,/forensic/i);assert.match(mig,/REVOKE EXECUTE ON FUNCTION erp_private\.settings_hub\(\) FROM PUBLIC,anon,authenticated,service_role;/);assert.match(mig,/GRANT EXECUTE ON FUNCTION erp_private\.settings_hub\(\) TO erp_api;/);
});
