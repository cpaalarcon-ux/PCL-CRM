import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {practiceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/practice-template-actions.ts');
const {serviceTemplateAction}=await import('../supabase/functions/staff-workspace-v12/service-template-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
let sp=0;tx.savepoint=async fn=>{const n='sp'+(++sp);await db.exec('savepoint '+n);try{const r=await fn(tx);await db.exec('release savepoint '+n);return r;}catch(e){await db.exec('rollback to savepoint '+n);await db.exec('release savepoint '+n);throw e;}};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const pt=(role,p)=>as(role,a=>practiceTemplateAction(tx,a,p));
const status=async code=>(await db.query(`select status,approved_by,sole_partner_approval from erp_private.service_templates where template_code='${code}' order by version desc limit 1`)).rows[0];
const count=async sql=>(await db.query(sql)).rows[0].n;

test('practice size and service categories: one click form, in bulk; sole practitioner may do it alone, a team puts forward and a different person approves',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional practice firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','ASSISTANT']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 // ---- who may use it ----
 for(const a of ['practice_read','service_category_read'])await assert.rejects(pt('ASSISTANT',{action:a}),/Manager or Partner/);
 const r0=await pt('MANAGER',{action:'practice_read'});assert.equal(r0.firms.length,1);assert.equal(r0.firms[0].active_partners,2);assert.equal(r0.firms[0].mode,'TEAM');assert.equal(r0.firms[0].declared,null);assert.equal(r0.firms[0].can_declare,false);
 const pr0=await pt('PARTNER',{action:'practice_read'});assert.equal(pr0.firms[0].can_declare,true);

 // ---- declaring the number of practitioners ----
 await assert.rejects(pt('MANAGER',{action:'practice_declare',firm_id:F,practitioners:1,reason:'Sole practitioner, nobody else'}),/Partner declares/);
 await assert.rejects(pt('PARTNER',{action:'practice_declare',firm_id:F,practitioners:'x',reason:'Sole practitioner, nobody else'}),/whole number/);
 await assert.rejects(pt('PARTNER',{action:'practice_declare',firm_id:F,practitioners:0,reason:'Sole practitioner, nobody else'}),/from 1 to 500/);
 await assert.rejects(pt('PARTNER',{action:'practice_declare',firm_id:F,practitioners:1,reason:'short'}),/10 to 500/);
 await assert.rejects(pt('PARTNER',{action:'practice_declare',firm_id:F,practitioners:1,reason:'We are a sole practice (not true yet)'}),/2 active Partners/,'one practitioner cannot be declared while two Partners are active');
 assert.equal(await count('select count(*)::int n from erp_private.firm_practice_declarations'),0);

 // ---- service categories: the click form lists the five starter drafts ----
 const s0=await pt('PARTNER',{action:'service_category_read'});
 assert.equal(s0.templates.length,5);assert.ok(s0.templates.every(x=>x.status==='Draft'&&x.can_approve&&x.can_submit&&!x.waiting));assert.equal(s0.sole,false,'two active Partners, nothing declared: not the only practitioner');
 const by=code=>s0.templates.find(x=>x.template_code===code).template_id;
 // Put forward in bulk: a preview writes nothing, the apply needs confirmation, a second time says it was already done.
 const sub={action:'service_category_submit',template_ids:[by('ACC-MONTHLY'),by('PAYROLL-MONTHLY'),by('TAX-MONTHLY')]};
 await assert.rejects(pt('ASSISTANT',sub),/Manager or Partner/);
 await assert.rejects(pt('MANAGER',{...sub,template_ids:[]}),/at least one/);
 const pv=await pt('MANAGER',{...sub,dry:true});assert.deepEqual(pv.results.map(r=>r.outcome),['Ready','Ready','Ready']);assert.equal(await count('select count(*)::int n from erp_private.service_template_submissions'),0,'a preview writes nothing');
 await assert.rejects(pt('MANAGER',sub),/confirm/);
 const ap=await pt('MANAGER',{...sub,confirm:true,note:'Fictional: ready for the Partner'});assert.equal(ap.summary.done,3);assert.ok(ap.results.every(r=>r.outcome==='Put forward'));assert.equal(await count('select count(*)::int n from erp_private.service_template_submissions'),3);
 const again=await pt('MANAGER',{...sub,confirm:true});assert.equal(again.summary.skipped,3);assert.match(again.results[0].reason,/already been put forward/);
 // The person who put them forward cannot approve them; a different Partner can. Starters nobody put forward can be approved by anyone with the right.
 const m1=await pt('MANAGER',{action:'service_category_read'});assert.ok(m1.templates.filter(x=>x.waiting).every(x=>!x.can_approve&&/put this one forward/.test(x.approve_problem)),'the Manager cannot approve what the Manager put forward');
 const mApprove=await pt('MANAGER',{action:'service_category_approve',template_ids:[by('ACC-MONTHLY')],confirm:true});assert.equal(mApprove.results[0].outcome,'Skipped');assert.match(mApprove.results[0].reason,/different Partner or Manager/);
 await assert.rejects(as('MANAGER',()=>tx`update erp_private.service_templates set status='Approved',approved_by=${actors.MANAGER.staff_id},approved_at=now() where template_id=${by('ACC-MONTHLY')}`),/different Partner or Manager approves a template you put forward/,'and the database refuses it as well');
 // A Partner puts one forward and may not approve it while the firm has two practitioners.
 await pt('PARTNER',{action:'service_category_submit',template_ids:[by('AUDIT-ANNUAL')],confirm:true});
 const own=await pt('PARTNER',{action:'service_category_approve',template_ids:[by('AUDIT-ANNUAL')],confirm:true});assert.equal(own.results[0].outcome,'Skipped');assert.match(own.results[0].reason,/only practitioner/);
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.service_templates set status='Approved',approved_by=${actors.PARTNER.staff_id},approved_at=now(),sole_partner_approval=true where template_id=${by('AUDIT-ANNUAL')}`),/./);
 // The other Partner approves in bulk: preview first, then apply. Some rows pass, the one the Partner put forward themselves is not theirs.
 const ap2={action:'service_category_approve',template_ids:[by('ACC-MONTHLY'),by('PAYROLL-MONTHLY'),by('AUDIT-ANNUAL')]};
 const pv2=await pt('PARTNER2',{...ap2,dry:true});assert.deepEqual(pv2.results.map(r=>r.outcome),['Ready','Ready','Ready']);assert.equal((await status('ACC-MONTHLY')).status,'Draft','a preview approves nothing');
 const done2=await pt('PARTNER2',{...ap2,confirm:true});assert.equal(done2.summary.done,3);
 for(const c of ['ACC-MONTHLY','PAYROLL-MONTHLY','AUDIT-ANNUAL']){const s=await status(c);assert.equal(s.status,'Approved');assert.equal(s.approved_by,actors.PARTNER2.staff_id);assert.equal(s.sole_partner_approval,false);}

 // ---- the number of practitioners: a team of two, then one ----
 await db.exec(`update erp_private.staff_members set access_status='Inactive' where staff_id='${actors.PARTNER2.staff_id}'`);
 const r1=await pt('PARTNER',{action:'practice_read'});assert.equal(r1.firms[0].active_partners,1);assert.equal(r1.firms[0].mode,'SOLE');assert.equal(r1.firms[0].declared,null);
 await pt('PARTNER',{action:'practice_declare',firm_id:F,practitioners:2,reason:'Fictional: a second Partner joins in January'});
 await assert.rejects(pt('PARTNER',{action:'practice_declare',firm_id:F,practitioners:2,reason:'Fictional: a second Partner joins in January'}),/already the declared number/);
 const r2=await pt('PARTNER',{action:'practice_read'});assert.equal(r2.firms[0].mode,'TEAM');assert.equal(r2.firms[0].declared.practitioners,2);assert.equal(r2.firms[0].history.length,1);
 // Declared as two: the one active Partner is not "the only practitioner", so approving a version they proposed themselves is refused.
 const prop=await as('PARTNER',a=>serviceTemplateAction(tx,a,{action:'service_template_propose',from_template_id:(s0.templates.find(x=>x.template_code==='ACC-MONTHLY')).template_id,name:'Accounting and bookkeeping, monthly (v2)'}));
 const sTeam=await pt('PARTNER',{action:'service_category_read'});const v2=sTeam.templates.find(x=>x.template_id===prop.template_id);
 assert.equal(sTeam.sole,false,'declared two practitioners');assert.equal(v2.can_approve,false);assert.match(v2.approve_problem,/only practitioner/);assert.equal(v2.waiting,true);
 const refused=await pt('PARTNER',{action:'service_category_approve',template_ids:[prop.template_id],confirm:true});assert.equal(refused.results[0].outcome,'Skipped');
 // Declare one: allowed now, because only one Partner is active. The same Partner can then approve what they put forward, recorded as a sole-Partner approval.
 await pt('PARTNER',{action:'practice_declare',firm_id:F,practitioners:1,reason:'Fictional: sole practitioner, no other Partner'});
 const r3=await pt('PARTNER',{action:'practice_read'});assert.equal(r3.firms[0].mode,'SOLE');assert.equal(r3.firms[0].declared.practitioners,1);assert.equal(r3.firms[0].history.length,2);assert.equal(r3.firms[0].declared.declared_by_name,'Fictional PARTNER');
 // TAX-MONTHLY was put forward by the Manager earlier, so the sole practitioner approving it is an ordinary approval; the starter nobody put forward is too.
 const sCat2=await pt('PARTNER',{action:'service_category_read'});assert.equal(sCat2.sole,true);assert.ok(sCat2.templates.filter(x=>x.status==='Draft').every(x=>x.can_approve));
 const fin=await pt('PARTNER',{action:'service_category_approve',template_ids:sCat2.templates.filter(x=>x.status==='Draft').map(x=>x.template_id),confirm:true});
 assert.equal(fin.summary.skipped,0,JSON.stringify(fin.results));assert.equal((await status('TAX-MONTHLY')).status,'Approved');assert.equal((await status('ADVISORY-PROJECT')).status,'Approved');
 // The version the Partner proposed themselves (declared two, so refused above) is approved alone now that one practitioner is declared, and marked as a sole-Partner approval.
 assert.equal(fin.results.find(x=>x.template_id===prop.template_id)?.outcome,'Approved');assert.equal(fin.summary.sole,1);
 assert.equal((await db.query(`select sole_partner_approval from erp_private.service_templates where template_id='${prop.template_id}'`)).rows[0].sole_partner_approval,true);
 assert.equal((await db.query(`select status from erp_private.service_templates where template_code='ACC-MONTHLY' and version=1`)).rows[0].status,'Retired','the earlier version is retired when the new one is approved');
 await db.exec(`update erp_private.staff_members set access_status='Active' where staff_id='${actors.PARTNER2.staff_id}'`);
 // (two active Partners again: the declaration of one no longer makes the first Partner sole)
 assert.equal((await pt('PARTNER',{action:'service_category_read'})).sole,false,'a second active Partner ends the sole rule whatever was declared');
 await db.exec(`update erp_private.staff_members set access_status='Inactive' where staff_id='${actors.PARTNER2.staff_id}'`);
 assert.equal((await pt('PARTNER',{action:'service_category_read'})).sole,true);
 // The records cannot be changed or removed.
 await assert.rejects(as('PARTNER',()=>tx`update erp_private.firm_practice_declarations set practitioners=5`),/./);
 await assert.rejects(as('PARTNER',()=>tx`delete from erp_private.service_template_submissions`),/./);
 assert.ok(await count(`select count(*)::int n from erp_private.audit_events where table_name='firm_practice_declarations'`)>=2);
 assert.ok(await count(`select count(*)::int n from erp_private.audit_events where table_name='service_template_submissions'`)>=4);
});
