import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {settingsOverviewAction}=await import('../supabase/functions/staff-workspace-v12/settings-overview-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>settingsOverviewAction(tx,a,p));
test('settings register: one shared reading of state, feeds, record pages and change history, read only',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${F2},'V3OTHER','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,PT=actors.PARTNER.staff_id,SUP=actors.SUPERVISOR.staff_id;
 const iso=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
 const rep=on=>db.exec(`set session_replication_role=${on?'replica':'origin'}`);
 const base=await act('MANAGER',{action:'settings_overview_read'});
 await rep(true);
 const rate=async(key,status,{from=iso(-200),to=iso(400),params='{}',src='',approved=false,label=key}={})=>(await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,created_by,approved_by,approved_at) values(${key},'VAT',${label},${from},${to},${params}::jsonb,'',${src},${status},${M},${approved?PT:null},${approved?new Date():null}) returning rate_id`)[0].rate_id;
 const RDRAFT=await rate('FICT_DRAFT','Draft',{label:'Fictional draft rule'});
 const RTEST=await rate('FICT_TEST','Testing',{label:'Fictional testing rule',params:'{"rate":16}',src:'Fictional memo'});
 const RA1=await rate('FICT_OVER','Approved',{label:'Fictional approved one',params:'{"rate":16}',src:'Fictional memo',approved:true});
 const RA2=await rate('FICT_OVER','Approved',{label:'Fictional approved two',params:'{"rate":16}',src:'Fictional memo',approved:true,from:iso(-100),to:iso(300)});
 const RFUT=await rate('FICT_FUT','Approved',{label:'Fictional future rule',params:'{"rate":8}',src:'Fictional memo',approved:true,from:iso(30),to:iso(400)});
 const RPAST=await rate('FICT_PAST','Approved',{label:'Fictional ended rule',params:'{"rate":8}',src:'Fictional memo',approved:true,from:iso(-300),to:iso(-5)});
 const REND=await rate('FICT_SOON','Approved',{label:'Fictional ending rule',params:'{"rate":8}',src:'Fictional memo',approved:true,from:iso(-300),to:iso(20)});
 const TD=(await tx`insert into erp_private.service_templates(template_code,name,service_group,status,proposed_by) values('FICT-T1','Fictional template','Tax Compliance','Draft',${M}) returning template_id`)[0].template_id;
 const TA=(await tx`insert into erp_private.service_templates(template_code,name,service_group,status,proposed_by,approved_by,approved_at) values('FICT-T2','Fictional approved template','Tax Compliance','Approved',${M},${PT},now()) returning template_id`)[0].template_id;
 const EP=(await tx`insert into erp_private.statutory_export_profiles(return_code,authority,version,layout_code,template_version,effective_from,effective_to,status,created_by,published_by,published_at,verified_against,verified_on) values('NSSF','NSSF',5,'NSSF_MONTHLY_7COL_V1','fict-v5',${iso(-100)},null,'Published',${M},${PT},now(),'Fictional authority page',${iso(-90)}) returning profile_id`)[0].profile_id;
 const EP2=(await tx`insert into erp_private.statutory_export_profiles(return_code,authority,version,layout_code,template_version,effective_from,effective_to,status,created_by) values('NSSF','NSSF',6,'NSSF_MONTHLY_7COL_V1','fict-v6',${iso(-50)},null,'Draft',${M}) returning profile_id`)[0].profile_id;
 const EV=(await tx`insert into erp_private.service_eligibility_records(service_code,kind,authority,reference,evidence_note,valid_from,expires_on,status,recorded_by,verified_by,verified_at,verification_note) values('ADV-VAL','Licence','Fictional body','L-1','Fictional evidence on file',${iso(-400)},${iso(-3)},'Verified',${M},${PT},now(),'Fictional verification') returning record_id`)[0].record_id;
 const EVOK=(await tx`insert into erp_private.service_eligibility_records(service_code,kind,authority,reference,evidence_note,valid_from,expires_on,status,recorded_by) values('ADV-VAL','Authorization','Fictional body','L-2','Fictional evidence on file',${iso(-40)},${iso(25)},'Recorded',${M}) returning record_id`)[0].record_id;
 const POL=(await tx`insert into erp_private.system_policies(policy_code,policy_name,statement,status) values('FICT_POL','Fictional policy','Fictional statement','Pending') returning policy_code`)[0].policy_code;
 await rep(false);

 // Who can read: Managers and Partners only. Anyone else gets nothing from the database and a refusal from the action.
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN'])assert.deepEqual(await as(role,()=>db.query('select erp_private.settings_register() r').then(r=>r.rows[0].r)),[],role+' sees no register');
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN'])await assert.rejects(act(role,{action:'settings_overview_read'}),/Managers and Partners/);
 assert.equal(await act('SUPERVISOR',{action:'something_else'}),undefined,'other actions are not claimed');

 const before=(await tx`select (select count(*) from erp_private.audit_events) n`)[0].n;
 const ov=await act('MANAGER',{action:'settings_overview_read'});
 assert.equal((await tx`select (select count(*) from erp_private.audit_events) n`)[0].n,before,'reading writes nothing');
 const st=(area,s)=>ov.counts[area][s]-base.counts[area][s];
 assert.equal(st('tax_rate','Draft'),1,'a draft rule is Draft');assert.equal(st('tax_rate','In Review'),1,'a Testing rule is In Review');
 assert.equal(st('tax_rate','Approved'),1,'an approved rule whose start date has not come is Approved');
 assert.equal(st('tax_rate','Retired'),1,'an approved rule whose period is over is Retired');
 assert.equal(st('tax_rate','Active'),3,'in-force approved rules are Active');
 assert.equal(st('service_template','Draft'),1);assert.equal(st('service_template','Active'),1);
 assert.equal(st('export_profile','Active'),1);assert.equal(st('export_profile','Draft'),1);
 assert.equal(st('eligibility','Suspended'),1,'an expired verified authorisation is Suspended');assert.equal(st('eligibility','In Review'),1,'a recorded one awaits verification');
 assert.equal(st('policy','In Review'),1);
 assert.equal(ov.areas.length,7);
 // Feeds
 const pc=o=>Object.fromEntries(o.pending.map(p=>[p.area,p.count])),pend=Object.fromEntries(Object.entries(pc(ov)).map(([k,v])=>[k,v-(pc(base)[k]||0)]));
 assert.equal(pend.tax_rate,2);assert.equal(pend.service_template,1);assert.equal(pend.export_profile,1);assert.equal(pend.eligibility,1);assert.equal(pend.policy,1);
 assert.ok(ov.expiring.some(e=>e.record_id===EV&&e.lapsed),'a lapsed authorisation is listed as ended');
 assert.ok(ov.expiring.some(e=>e.record_id===EVOK&&e.days===25&&!e.lapsed),'an authorisation ending in 25 days is listed');
 assert.ok(ov.expiring.some(e=>e.record_id===REND&&e.days===20),'a rule whose period ends in 20 days is listed');
 assert.ok(!ov.expiring.some(e=>e.record_id===RPAST),'a retired rule is not listed');
 const fail=(rid,check)=>ov.failing.some(f=>f.record_id===rid&&f.check===check);
 assert.ok(fail(RA1,'OVERLAP')&&fail(RA2,'OVERLAP'),'two approved versions on the same dates are reported');
 assert.ok(fail(RDRAFT,'SOURCE')&&fail(RDRAFT,'FIGURES'),'a draft with no source and no figures is reported');
 assert.ok(fail(EV,'LAPSED'),'the lapsed authorisation is reported');
 assert.ok(!ov.failing.some(f=>f.check==='TEST_FILE'),'test-file status is information, not a failure');
 assert.ok(!ov.failing.some(f=>f.record_id===RPAST),'a retired record is not checked');

 // Change history: a status change shows who, when, before and after. Changes are made as the person who is signed in.
 await as('PARTNER',async()=>{await db.query(`update erp_private.service_templates set status='Retired',retired_by=$2,retired_at=now(),retired_reason='Fictional replaced by a newer template' where template_id=$1`,[TD,PT]);});
 const ov2=await act('PARTNER',{action:'settings_overview_read'});
 const ch=ov2.recent.find(c=>c.record_id===TD&&c.action==='Changed');
 assert.ok(ch,'the change is in the feed');assert.equal(ch.status_before,'Draft');assert.equal(ch.status_after,'Retired');assert.ok(ch.actor&&ch.actor.length>1,'the person who made the change is named');assert.ok(ch.fields.includes('status'));
 assert.equal(ov2.counts.service_template.Retired-base.counts.service_template.Retired,1);

 // Record page: overview checks, configuration, versions and approvals, change history, action bar
 const rr=await act('PARTNER',{action:'settings_record_read',area:'export_profile',record_id:EP});
 assert.equal(rr.record.state,'Active');assert.equal(rr.group,'Upload & Export Templates');
 assert.deepEqual(rr.versions.filter(v=>v.version>=5).map(v=>[v.version,v.current]),[[6,false],[5,true]],'both new versions of the profile are listed beside the seeded starter, newest first');
 assert.ok(rr.checks.some(c=>c.code==='TEST_FILE'&&!c.ok&&/not tracked/.test(c.message)),'the test-file status says plainly that it is not tracked');
 assert.ok(rr.fields.some(f=>f[0]==='Layout'&&f[1]==='NSSF_MONTHLY_7COL_V1'));
 assert.ok(rr.actions.some(a=>a.action==='export-profiles-open'));
 const rt=await act('MANAGER',{action:'settings_record_read',area:'tax_rate',record_id:RA1});
 assert.deepEqual(rt.actions.map(a=>a.key),['revise','view'],'an in-force rule offers a new version, never an edit');
 assert.equal(rt.tax.parameters.rate,16);
 const rd=await act('MANAGER',{action:'settings_record_read',area:'tax_rate',record_id:RDRAFT});
 assert.ok(['edit','test','legal','approve','view'].every(k=>rd.actions.some(a=>a.key===k)));
 const rtpl=await act('PARTNER',{action:'settings_record_read',area:'service_template',record_id:TA});
 assert.deepEqual(rtpl.actions.map(a=>[a.kind,a.action]),[['svc','retire'],['svc','templates']]);
 const rp=await act('PARTNER',{action:'settings_record_read',area:'policy',record_id:POL});assert.equal(rp.record.state,'In Review');
 await assert.rejects(act('PARTNER',{action:'settings_record_read',area:'tax_rate',record_id:crypto.randomUUID()}),/not found/);
 await assert.rejects(act('PARTNER',{action:'settings_record_read',area:'nonsense',record_id:RA1}),/Choose a settings area/);
 await assert.rejects(act('PARTNER',{action:'settings_record_read',area:'tax_rate',record_id:'not-a-uuid'}),/Invalid record reference/);
 const hist=await act('PARTNER',{action:'settings_record_read',area:'service_template',record_id:TD});
 assert.equal(hist.history[0].status_after,'Retired');assert.equal(hist.record.state,'Retired');
 // The database functions have no write path
 for(const fn of ['settings_register()','settings_changes(text,text,integer)'])assert.match((await tx`select prosrc from pg_proc where oid=${'erp_private.'+fn}::regprocedure`)[0].prosrc.toLowerCase().replace(/\s+/g,' '),/^(?!.*\b(insert into|update erp_private|delete from)\b)/);
});
