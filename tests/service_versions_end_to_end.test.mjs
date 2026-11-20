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

test('bulk retire and bulk new version of service categories: per-row checks, previews write nothing, a new version is a draft a different person approves',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional practice firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','ASSISTANT']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 const read=async role=>(await pt(role,{action:'service_category_read'}));
 const rows=async(sql)=>(await db.query(sql)).rows;
 const cat=async()=>{const r=await read('PARTNER');return code=>r.templates.filter(x=>x.template_code===code);};
 // Approve the five starters (nobody put them forward, so a Partner may).
 const s0=await read('PARTNER');const all=s0.templates.map(x=>x.template_id);
 await pt('PARTNER',{action:'service_category_approve',template_ids:all,confirm:true});
 const keysOf=async code=>(await rows(`select k.task_key from erp_private.service_template_tasks k join erp_private.service_templates t using(template_id) where t.template_code='${code}' and t.version=1 order by k.sort_order`)).map(x=>x.task_key);
 const idOf=async(code,v=1)=>(await rows(`select template_id from erp_private.service_templates where template_code='${code}' and version=${v}`))[0].template_id;
 const s1=await read('MANAGER');assert.equal(s1.can_retire,false);assert.ok(s1.templates.every(x=>x.status==='Approved'&&x.can_propose&&!x.can_retire));
 assert.equal((await read('PARTNER')).can_retire,true);

 // ---- who may do what, and what is asked for ----
 const prop={action:'service_category_propose',template_ids:all,due_days:{review:3,vat_review:4}};
 await assert.rejects(pt('ASSISTANT',prop),/Manager or Partner/);
 await assert.rejects(pt('MANAGER',{...prop,due_days:undefined}),/Say what changes/);
 await assert.rejects(pt('MANAGER',{...prop,due_days:{Review:3}}),/not a task key/);
 await assert.rejects(pt('MANAGER',{...prop,due_days:{review:400}}),/0 to 366/);
 await assert.rejects(pt('MANAGER',{...prop,template_ids:[]}),/at least one/);
 await assert.rejects(pt('MANAGER',{...prop,confirm:true,due_days:{review:3},drop_task_keys:['review']}),/both removed and changed/);
 await assert.rejects(pt('MANAGER',prop),/confirm/);
 await assert.rejects(pt('MANAGER',{action:'service_category_retire',template_ids:all,reason:'Replaced by the new list',confirm:true}),/Partner retires/);

 // ---- bulk new version: due days changed wherever the task exists; the rest say none applies ----
 const hasReview=[],hasNone=[];
 for(const c of s0.templates.map(x=>x.template_code)){const k=await keysOf(c);(k.includes('review')||k.includes('vat_review')?hasReview:hasNone).push(c);}
 assert.ok(hasReview.length>=2&&hasNone.length>=1,'the fixture has both kinds: '+JSON.stringify({hasReview,hasNone}));
 const before=await count('select count(*)::int n from erp_private.service_templates');
 const pv=await pt('MANAGER',{...prop,dry:true});
 assert.equal(pv.summary.done,hasReview.length);assert.equal(pv.summary.skipped,hasNone.length);
 for(const r of pv.results.filter(x=>x.outcome==='Skipped'))assert.match(r.reason,/None of the changes applies/);
 for(const r of pv.results.filter(x=>x.outcome==='Ready'))assert.equal(r.version,2);
 assert.equal(await count('select count(*)::int n from erp_private.service_templates'),before,'a preview writes nothing');
 const run=await pt('MANAGER',{...prop,confirm:true});assert.equal(run.summary.done,hasReview.length);assert.ok(run.results.filter(x=>x.outcome==='Proposed').every(x=>x.version===2&&/change/.test(x.note)));
 assert.equal(await count('select count(*)::int n from erp_private.service_templates'),before+hasReview.length);
 for(const c of hasReview){
  const [v2]=await rows(`select template_id,status,proposed_by,name from erp_private.service_templates where template_code='${c}' and version=2`);assert.equal(v2.status,'Draft');assert.equal(v2.proposed_by,actors.MANAGER.staff_id);
  const v1=await keysOf(c),n2=(await rows(`select task_key,due_days from erp_private.service_template_tasks where template_id='${v2.template_id}'`));assert.equal(n2.length,v1.length,'every task is copied');
  for(const k of n2)if(k.task_key==='review')assert.equal(k.due_days,3);else if(k.task_key==='vat_review')assert.equal(k.due_days,4);
  assert.equal((await rows(`select status from erp_private.service_templates where template_code='${c}' and version=1`))[0].status,'Approved','the version in use stays approved until the new one is');
 }
 // A second run says a draft is already waiting; the approved row cannot be proposed again.
 const again=await pt('MANAGER',{...prop,confirm:true});assert.equal(again.summary.done,0);assert.ok(again.results.every(x=>x.outcome==='Skipped'));
 assert.ok(again.results.some(x=>/already waiting for approval/.test(x.reason||'')));
 const mgr=await read('MANAGER');const waiting=mgr.templates.filter(x=>x.version===2);assert.ok(waiting.every(x=>x.waiting&&!x.can_approve&&x.status==='Draft'),'the Manager who proposed cannot approve');
 assert.ok(mgr.templates.filter(x=>x.version===1&&hasReview.includes(x.template_code)).every(x=>!x.can_propose&&/already waiting/.test(x.propose_problem)));
 // A different Partner approves the new versions in bulk; the version they replace is retired then.
 const ap=await pt('PARTNER2',{action:'service_category_approve',template_ids:waiting.map(x=>x.template_id),confirm:true});assert.equal(ap.summary.done,hasReview.length);
 for(const c of hasReview){assert.equal((await rows(`select status from erp_private.service_templates where template_code='${c}' and version=1`))[0].status,'Retired');assert.equal((await rows(`select status from erp_private.service_templates where template_code='${c}' and version=2`))[0].status,'Approved');}

 // ---- drop tasks and add to the name; a key a category lacks is left alone and said; dropping every task is refused ----
 const cur=await read('MANAGER');const approved=cur.templates.filter(x=>x.status==='Approved');
 const m=await pt('MANAGER',{action:'service_category_propose',template_ids:approved.map(x=>x.template_id),drop_task_keys:['month_pack'],mandatory:{bank_rec:false},name_suffix:'(2027)',confirm:true});
 const accRow=m.results.find(x=>/Accounting/i.test(x.label)&&x.outcome==='Proposed');assert.ok(accRow,JSON.stringify(m.results));
 const nonAcc=m.results.filter(x=>x.outcome==='Proposed'&&x!==accRow);assert.ok(nonAcc.length>=1);assert.ok(nonAcc.every(x=>/left alone: month_pack, bank_rec|left alone: bank_rec, month_pack/.test(x.note)),JSON.stringify(nonAcc));
 const accId=(await rows(`select template_id,name from erp_private.service_templates where template_code='ACC-MONTHLY' and status='Draft'`))[0];assert.match(accId.name,/\(2027\)$/);
 const accKeys=(await rows(`select task_key,mandatory from erp_private.service_template_tasks where template_id='${accId.template_id}'`));assert.ok(!accKeys.some(k=>k.task_key==='month_pack'));assert.equal(accKeys.find(k=>k.task_key==='bank_rec').mandatory,false);
 // Retire that draft first (a Partner may retire a draft), then try to drop every task from the payroll category.
 const payKeys=await keysOf('PAYROLL-MONTHLY');
 const pAll=await pt('PARTNER',{action:'service_category_read'});
 const draftIds=pAll.templates.filter(x=>x.status==='Draft').map(x=>x.template_id);
 const rd1=await pt('PARTNER',{action:'service_category_retire',template_ids:draftIds,reason:'Fictional: cancelled before approval',confirm:true});assert.equal(rd1.summary.done,draftIds.length);assert.ok(rd1.results.every(x=>x.outcome==='Retired'));
 const payId=(await pAll.templates.find(x=>x.template_code==='PAYROLL-MONTHLY'&&x.status==='Approved')).template_id;
 const dropAll=await pt('MANAGER',{action:'service_category_propose',template_ids:[payId],drop_task_keys:payKeys,confirm:true});assert.equal(dropAll.results[0].outcome,'Skipped');assert.match(dropAll.results[0].reason,/at least one task/);
 assert.equal(await count(`select count(*)::int n from erp_private.service_templates where template_code='PAYROLL-MONTHLY' and status='Draft'`),0,'a refused row leaves nothing behind');

 // ---- bulk retire: a Partner, one reason, preview first, every row on its own ----
 const now=await read('PARTNER');const ok=now.templates.filter(x=>x.status==='Approved');assert.ok(ok.length>=3);
 const pick=ok.slice(0,2).map(x=>x.template_id);
 await assert.rejects(pt('PARTNER',{action:'service_category_retire',template_ids:pick,reason:'no',dry:true}),/5 to 500/);
 await assert.rejects(pt('PARTNER',{action:'service_category_retire',template_ids:pick,reason:'Fictional: replaced by the 2028 list'}),/confirm/);
 const rpv=await pt('PARTNER',{action:'service_category_retire',template_ids:pick,reason:'Fictional: replaced by the 2028 list',dry:true});assert.equal(rpv.summary.done,2);assert.ok(rpv.results.every(x=>x.outcome==='Ready'&&/No approved version of this category will remain/.test(x.note)));
 assert.equal(await count(`select count(*)::int n from erp_private.service_templates where status='Retired' and retired_reason like 'Fictional: replaced%'`),0,'a preview retires nothing');
 const rr=await pt('PARTNER',{action:'service_category_retire',template_ids:[...pick,pick[0],'00000000-0000-4000-8000-00000000dead'],reason:'  Fictional:   replaced by the 2028 list ',confirm:true});
 assert.equal(rr.summary.done,2);assert.equal(rr.summary.skipped,1);assert.match(rr.results.find(x=>x.outcome==='Skipped').reason,/not found/);
 const gone=await rows(`select status,retired_by,retired_reason from erp_private.service_templates where template_id in ('${pick.join("','")}')`);
 assert.ok(gone.every(x=>x.status==='Retired'&&x.retired_by===actors.PARTNER.staff_id&&x.retired_reason==='Fictional: replaced by the 2028 list'),JSON.stringify(gone));
 const twice=await pt('PARTNER',{action:'service_category_retire',template_ids:pick,reason:'Fictional: replaced by the 2028 list',confirm:true});assert.equal(twice.summary.done,0);assert.match(twice.results[0].reason,/already retired/);
 // The database still refuses a Manager retiring one directly, and the audit trail shows the bulk changes.
 await assert.rejects(as('MANAGER',()=>tx`update erp_private.service_templates set status='Retired',retired_by=${actors.MANAGER.staff_id},retired_at=now(),retired_reason='Fictional: no right' where status='Approved'`),/Partner retires/);
 assert.ok(await count(`select count(*)::int n from erp_private.audit_events where table_name='service_templates'`)>=10);
 const left=(await read('MANAGER')).templates;assert.ok(left.every(x=>!pick.includes(x.template_id)),'retired ones leave the list');
});
