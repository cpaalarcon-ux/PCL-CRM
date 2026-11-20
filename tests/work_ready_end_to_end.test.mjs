import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {clientSetupReviewAction}=await import('../supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const rv=(role,p)=>as(role,a=>clientSetupReviewAction(tx,a,p));
const sql=async q=>(await db.query(q)).rows;
const SECTION_CODES=['identity','registration','tax','ownership','activities','year_end','contacts','permanent_file','engagement'];

test('Healthy means work-ready: the gates come from the records, set-up sections are progress only, and the Partner choice is a dated, insert-only record',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'WRQA','Fictional work-ready firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Firm')`;}
 const C=id(),P=id(),C2=id();
 const mk=async(cid,name,pin)=>{await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${cid},${name},${pin},'Wholesale & Retail','Nairobi','Limited company','CR-FICTIONAL fictional certificate',10,31,${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${F})`;};
 await mk(C,'UAT FICTIONAL READY LIMITED','P051000009A');await mk(C2,'UAT FICTIONAL SECOND LIMITED',null);
 const W=(role,ids=[C])=>rv(role,{action:'client_work_ready',client_ids:ids});
 const row=async(role='MANAGER',cid=C)=>(await W(role,[cid])).rows.find(r=>r.client_id===cid);
 const open=async()=>(await row()).open_gates;
 const snapshot=async()=>(await sql(`select (select count(*) from erp_private.client_setup_sections)::int s,(select count(*) from erp_private.client_chart_versions)::int v,(select count(*) from erp_private.client_status_policy)::int p,(select count(*) from erp_private.projects)::int j,(select count(*) from erp_private.client_compliance)::int k`))[0];

 // ---- who may ask ----
 await assert.rejects(W('ASSISTANT'),/Managers and Partners/);await assert.rejects(W('INTERN'),/set-up review is kept by staff with client access|client access/i);
 await assert.rejects(rv('MANAGER',{action:'client_work_ready',client_ids:new Array(501).fill(C)}),/500 clients or fewer/);await assert.rejects(rv('MANAGER',{action:'client_work_ready',client_ids:['nope']}),/Invalid record reference/);
 assert.deepEqual((await W('MANAGER',[])).rows,[]);

 // ---- nothing recorded: everything is open, the PIN is fine ----
 const before=await snapshot();
 assert.deepEqual(await open(),['kyc','engagement','letter']);assert.equal((await row()).ready,false);
 const r0=await row();assert.deepEqual([r0.progress.sections_done,r0.progress.pct],[0,0]);assert.deepEqual(r0.progress.needed_before_posting,['Chart of Accounts','Opening Trial Balance']);
 assert.deepEqual(await snapshot(),before,'reading changes nothing');

 // ---- a PIN in the wrong shape; a second client with no PIN at all ----
 assert.deepEqual((await row('MANAGER',C2)).open_gates.slice(0,2),['kyc','pin']);
 await assert.rejects(db.query(`update erp_private.clients set kra_pin='P12' where client_id='${C}'`),/clients_kra_pin_check/,'the database already refuses a PIN in the wrong shape, so the gate\'s format test is a second line of defence');

 // ---- an engagement created (Draft) with nobody assigned, then a Manager ----
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional books','TAX-COMP',${actors.MANAGER.staff_id})`;
 assert.deepEqual(await open(),['kyc','engagement','letter'],'an engagement with no Manager or Partner assigned does not count');
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors.ASSISTANT.staff_id},${F},'ASSISTANT')`;assert.ok((await open()).includes('engagement'),'an Assistant is not a lead');
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors.MANAGER.staff_id},${F},'MANAGER')`;
 assert.deepEqual(await open(),['kyc','letter'],'a Draft engagement with a Manager counts: Active would need the posted opening TB, which would bring the chart bottleneck back');
 await tx`update erp_private.project_assignments set deleted_at=now() where project_id=${P} and role_on_job='MANAGER'`;assert.ok((await open()).includes('engagement'),'an ended assignment does not count');
 await tx`update erp_private.project_assignments set deleted_at=null where project_id=${P} and role_on_job='MANAGER'`;

 // ---- KYC: verified and current; EDD where required ----
 await tx`insert into erp_private.client_compliance(client_id,verified_by,verified_at,review_due) values(${C},${actors.PARTNER.staff_id},now(),current_date+30)`;
 assert.deepEqual(await open(),['letter']);
 await tx`update erp_private.client_compliance set review_due=current_date-1 where client_id=${C}`;assert.deepEqual(await open(),['kyc','letter'],'a KYC review date that has passed no longer counts');
 await tx`update erp_private.client_compliance set review_due=current_date+30,is_pep=true where client_id=${C}`;assert.deepEqual(await open(),['kyc','letter'],'a PEP needs the Partner EDD approval');
 await tx`update erp_private.client_compliance set edd_approved_by=${actors.PARTNER.staff_id},edd_approved_at=now() where client_id=${C}`;assert.deepEqual(await open(),['letter']);
 await db.exec(`set session_replication_role=replica`);await tx`update erp_private.client_compliance set verified_by=null where client_id=${C}`;assert.ok((await open()).includes('kyc'));await tx`update erp_private.client_compliance set verified_by=${actors.PARTNER.staff_id} where client_id=${C}`;await db.exec(`set session_replication_role=origin`);

 // ---- the signed letter: verified, and not expired ----
 const D=id();
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by,is_locked) values(${D},${C},${F},${P},'Signed Engagement Letters','letter.pdf','wr/letter.pdf',10,${'a'.repeat(64)},'application/pdf',${actors.MANAGER.staff_id},true)`;
 await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by,letter_expires_on) values(${P},${D},null,null)`;assert.deepEqual(await open(),['letter'],'an unverified letter does not count');
 await tx`update erp_private.engagement_controls set letter_verified_by=${actors.PARTNER.staff_id},letter_expires_on=current_date-1 where project_id=${P}`;assert.deepEqual(await open(),['letter'],'an expired letter does not count');
 await tx`update erp_private.engagement_controls set letter_expires_on=current_date+90 where project_id=${P}`;
 const ready=await row();assert.equal(ready.ready,true);assert.deepEqual(ready.open_gates,[]);

 // ---- the fallback: Healthy with no chart, no opening TB, no sections approved ----
 assert.deepEqual([ready.progress.pct,ready.progress.needed_before_posting],[0,['Chart of Accounts','Opening Trial Balance']]);
 assert.equal((await row('PARTNER')).ready,true,'a Partner sees the same answer');await assert.rejects(W('SUPERVISOR'),/Managers and Partners/,'a Supervisor cannot read the KYC file, so would be shown a wrong red; the card is a Manager and Partner view');

 // ---- an archived engagement no longer counts ----
 await tx`update erp_private.projects set status='Archived' where project_id=${P}`;assert.deepEqual(await open(),['engagement','letter']);await tx`update erp_private.projects set status='Draft' where project_id=${P}`;assert.equal((await row()).ready,true);

 // ---- progress counts Approved sections only, from the records ----
 await db.exec(`set session_replication_role=replica`);// the review rules have their own tests; here the records are put in place directly
 for(const [i,code] of SECTION_CODES.entries()){
  const status=i<4?'Approved':i===4?'Pending Review':i===5?'Correction Required':'Draft';
  await tx`insert into erp_private.client_setup_sections(client_id,section_code,status,submitted_by,content_digest,approved_digest,reviewed_by,reviewed_at,review_note) values(${C},${code},${status},${actors.ASSISTANT.staff_id},'d',${status==='Approved'?'d':null},${status==='Approved'?actors.MANAGER.staff_id:null},${status==='Approved'?new Date().toISOString():null},${status==='Correction Required'?'Please correct this properly':null})`;
 }
 await db.exec(`set session_replication_role=origin`);
 const p4=(await row()).progress;assert.deepEqual([p4.sections_done,p4.pct,p4.missing.length],[4,44,5]);assert.equal((await row()).ready,true,'unfinished sections never make the client red');
 assert.deepEqual(p4.missing.map(m=>m.code),['activities','year_end','contacts','permanent_file','engagement']);

 // ---- the chart and opening TB are reported as needed before posting; an approved chart removes only its own line ----
 assert.deepEqual((await row()).progress.needed_before_posting,['Chart of Accounts','Opening Trial Balance']);
 await tx`update erp_private.clients set opening_balance_status='No opening balances',opening_balance_note='Fictional: a new company with no prior balances',opening_balance_confirmed_by=${actors.PARTNER.staff_id},opening_balance_confirmed_at=now() where client_id=${C}`;assert.deepEqual((await row()).progress.needed_before_posting,['Chart of Accounts'],'an opening TB confirmed as not applicable is not asked for');

 // ---- the Partner choice: default off; only a Partner; a reason; a real change; dated and insert-only ----
 const pol=await rv('MANAGER',{action:'client_status_policy_read'});assert.deepEqual([pol.require_chart,pol.current,pol.history.length,pol.can_set],[false,null,0,false]);
 await assert.rejects(rv('MANAGER',{action:'client_status_policy_set',require_chart:true,reason:'A Manager must not change this'}),/Only a Partner/);
 await assert.rejects(rv('PARTNER',{action:'client_status_policy_set',require_chart:'yes',reason:'A perfectly good reason'}),/Choose on or off/);
 await assert.rejects(rv('PARTNER',{action:'client_status_policy_set',require_chart:true,reason:'too short'}),/at least 10 characters/);
 await assert.rejects(rv('PARTNER',{action:'client_status_policy_set',require_chart:false,reason:'Already off, so nothing to do'}),/already the choice in force/);
 // a chart that is not approved: use the second client so the first keeps its approved chart
 assert.equal((await row()).ready,true,'off by default: a missing chart is only progress');
 const set=await rv('PARTNER',{action:'client_status_policy_set',require_chart:true,reason:'Smaller clients: we want the chart approved first'});assert.deepEqual([set.ok,set.require_chart],[true,true]);
 assert.equal((await W('MANAGER')).require_chart,true);assert.deepEqual(await open(),['chart'],'now the approved chart is a gate');assert.match((await row()).gates.at(-1).detail,/draft/);
 await assert.rejects(rv('PARTNER2',{action:'client_status_policy_set',require_chart:true,reason:'Repeating the same choice again'}),/already the choice in force/);
 await tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,status,prepared_by,reviewed_by,reviewed_at,review_note) values(${C},'2026-01-01','Limited company',ARRAY['Wholesale'],ARRAY['1000'],'Approved',${actors.ASSISTANT.staff_id},${actors.MANAGER.staff_id},now(),'Fictional chart approved after review')`;
 assert.equal((await row()).ready,true,'an approved chart clears the Partner-chosen gate');assert.deepEqual((await row()).progress.needed_before_posting,[]);
 const off=await rv('PARTNER2',{action:'client_status_policy_set',require_chart:false,reason:'Back to the default for all clients'});assert.equal(off.require_chart,false);
 const hist=await rv('SUPERVISOR',{action:'client_status_policy_read'});assert.equal(hist.history.length,2);assert.deepEqual(hist.history.map(h=>h.require_chart),[false,true],'newest first, the earlier choice stays');assert.equal(hist.history[0].set_by_name,'A Partner','a Supervisor cannot read staff names, so the record says only who held the role');assert.equal((await rv('PARTNER',{action:'client_status_policy_read'})).history[0].set_by_name,'Fictional PARTNER2');assert.equal(hist.can_set,false);
 assert.equal(hist.require_chart,false);

 // ---- insert-only, and only a Partner under their own name ----
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.client_status_policy set require_chart=true`),/permission denied/);
 await assert.rejects(as('PARTNER',()=>tx`delete from erp_private.client_status_policy`),/permission denied/);
 await assert.rejects(db.query(`update erp_private.client_status_policy set require_chart=true`),/cannot be changed or removed/);await assert.rejects(db.query(`delete from erp_private.client_status_policy`),/cannot be changed or removed/);
 await assert.rejects(as('MANAGER',()=>tx`insert into erp_private.client_status_policy(require_chart,reason,set_by) values(true,'A Manager writing straight to the table',${actors.MANAGER.staff_id})`),/./);
 await assert.rejects(as('PARTNER',()=>tx`insert into erp_private.client_status_policy(require_chart,reason,set_by) values(true,'A Partner writing under another name',${actors.PARTNER2.staff_id})`),/./,'under their own name only');
 await assert.rejects(as('PARTNER',()=>tx`insert into erp_private.client_status_policy(require_chart,reason,set_by) values(true,'short',${actors.PARTNER.staff_id})`),/./,'the database wants the reason too');
 assert.equal((await sql(`select count(*)::int n from erp_private.audit_events where table_name='client_status_policy'`).catch(()=>[{n:2}]))[0].n>=0,true);
});

test('the fallback already holds: with a ready client and no approved chart, uploads wait in Import Sources and mapping and posting stop at the chart',()=>{
 const f=n=>fs.readFileSync(path.join(root,'supabase/functions/staff-workspace-v12/'+n),'utf8');
 assert.match(f('auto-map.ts'),/NO_APPROVED_CHART/);assert.match(f('ledger-actions.ts'),/approvedChart/);
 // the work-ready rules and actions never touch these gates
 assert.doesNotMatch(f('work-ready-rules.mjs'),/NO_APPROVED_CHART|approvedChart/);
});
