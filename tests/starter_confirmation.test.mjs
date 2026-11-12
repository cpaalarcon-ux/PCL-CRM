// Tax Lead confirmation for locked bank starter rules (build 2788): a Partner records it, nothing is edited or deleted, withdrawing locks the rule again.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const {STARTER_RULES,starterList,starterProblem,confirmedMap,lockedStarters}=await import('../'+fx+'bank-starter-rules.mjs');
const {starterConfirmAction}=await import('../'+fx+'starter-confirm-actions.ts');
const {startersView,confirmState,STARTER_CONFIRM_NOTE,createStarterConfirmUI}=await import('../staff-starter-confirm.mjs');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const chart=new Set(['62510','62500','62570','62000','62030','51070']);

test('pure: a confirmation unlocks only its own rule and only for its own account',()=>{
 const ex=STARTER_RULES.find(s=>s.key==='excise-duty');
 assert.match(starterProblem(ex,[],chart),/Tax Lead has not confirmed/);
 assert.match(starterProblem(ex,[],chart,new Map()),/Tax Lead has not confirmed/);
 assert.match(starterProblem(ex,[],chart,new Map([['excise-duty','10180']])),/Tax Lead has not confirmed/,'a confirmation for another account does not unlock it');
 assert.equal(starterProblem(ex,[],chart,new Map([['excise-duty','51070']])),null);
 assert.match(starterProblem(ex,[],new Set(),new Map([['excise-duty','51070']])),/not in this client's chart/,'the chart check still applies once unlocked');
 assert.match(starterProblem(ex,[{keyword:'excise duty',match_mode:'Contains',direction:'Money out',status:'Proposed'}],chart,new Map([['excise-duty','51070']])),/waiting for approval/);
 assert.equal(starterList([],chart,new Map([['excise-duty','51070']])).filter(s=>!s.problem).length,6);assert.equal(starterList([],chart).filter(s=>!s.problem).length,5);
 const cm=confirmedMap([{rule_key:'excise-duty',account_code:'51070',status:'Confirmed'},{rule_key:'ledger-fee',account_code:'62510',status:'Withdrawn'}]);assert.equal(cm.size,1);
 const ls=lockedStarters([{rule_key:'excise-duty',account_code:'51070',status:'Confirmed',confirmed_by_name:'Fictional Tax Lead'}]);assert.equal(ls.length,1);assert.equal(ls[0].locked,false);
 assert.equal(lockedStarters([])[0].locked,true);assert.equal(lockedStarters([{rule_key:'excise-duty',account_code:'10180',status:'Confirmed'}])[0].locked,true);
 assert.equal(lockedStarters([{rule_key:'excise-duty',account_code:'51070',status:'Withdrawn'}])[0].locked,true);
});

test('server action: checks before the database, and only a Partner writes',async()=>{
 const calls=[];const t=async(parts,...v)=>{calls.push(parts.join('?'));return [];};
 const rec={action:'bank_starter_confirm_record',rule_key:'excise-duty',account_code:'51070',confirmed_by_name:'Fictional Tax Lead',confirmed_on:'2026-11-10',source_note:'Fictional email of 10 Nov 2026',seen_in_writing:true};
 const P={category_code:'PARTNER',staff_id:id()};
 assert.equal(await starterConfirmAction(t,P,{action:'other'}),undefined);
 for(const c of ['MANAGER','SUPERVISOR','ASSISTANT','INTERN','ADMIN'])await assert.rejects(()=>starterConfirmAction(t,{category_code:c},rec),/Only a Partner/);
 await assert.rejects(()=>starterConfirmAction(t,{category_code:'ASSISTANT'},{action:'bank_starter_confirm_read'}),/Managers and Partners/);
 for(const [bad,re] of [[{rule_key:'ledger-fee'},/does not need/],[{rule_key:'nope'},/does not need/],[{account_code:'51071'},/must name the account 51070/],[{confirmed_by_name:' '},/required|Check/],[{confirmed_by_name:'x'},/name of the Tax Lead/],[{confirmed_on:'10/11/2026'},/date of the written/],[{confirmed_on:'2999-01-01'},/future/],[{source_note:'short'},/at least 10/],[{seen_in_writing:false},/Tick the box/],[{seen_in_writing:undefined},/Tick the box/]])
  await assert.rejects(()=>starterConfirmAction(t,P,{...rec,...bad}),re,JSON.stringify(bad));
 assert.equal(calls.length,0,'nothing reached the database while the input was wrong');
 await assert.rejects(()=>starterConfirmAction(t,P,{action:'bank_starter_confirm_withdraw',confirmation_id:'not-an-id'}),/Invalid record/);
});

test('database: Partner records, others cannot, nothing is edited or deleted, one live confirmation, withdraw locks again',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const act=(role,p)=>as(role,a=>starterConfirmAction(tx,a,p));
 const rec={action:'bank_starter_confirm_record',rule_key:'excise-duty',account_code:'51070',confirmed_by_name:'Fictional Tax Lead',confirmed_on:'2026-11-10',source_note:'Fictional email of 10 Nov 2026',seen_in_writing:true};
 assert.ok((await tx`select 1 from erp_private.account_catalog where code='51070'`).length,'account 51070 exists in the catalogue');
 // Nothing recorded yet: locked, readable by a Manager.
 let r=await act('MANAGER',{action:'bank_starter_confirm_read'});assert.equal(r.starters[0].locked,true);assert.equal(r.history.length,0);
 await assert.rejects(()=>act('ASSISTANT',{action:'bank_starter_confirm_read'}),/Managers and Partners/);
 // The database refuses a non-Partner even if the action check were bypassed.
 await assert.rejects(()=>as('MANAGER',()=>tx`insert into erp_private.starter_rule_confirmations(rule_key,account_code,confirmed_by_name,confirmed_on,source_note,recorded_by) values('excise-duty','51070','Fictional Tax Lead','2026-11-10','Fictional email of 10 Nov 2026',${actors.MANAGER.staff_id})`),/row-level security|permission/i);
 await assert.rejects(()=>as('PARTNER',()=>tx`insert into erp_private.starter_rule_confirmations(rule_key,account_code,confirmed_by_name,confirmed_on,source_note,recorded_by) values('excise-duty','51070','Fictional Tax Lead','2026-11-10','Fictional email of 10 Nov 2026',${actors.PARTNER2.staff_id})`),/row-level security/i,'the recorder must be the signed-in Partner');
 await assert.rejects(()=>as('PARTNER',()=>tx`insert into erp_private.starter_rule_confirmations(rule_key,account_code,confirmed_by_name,confirmed_on,source_note,recorded_by) values('ledger-fee','62510','Fictional Tax Lead','2026-11-10','Fictional email of 10 Nov 2026',${actors.PARTNER.staff_id})`),/check constraint/i,'only the excise rule can hold a confirmation');
 // A Partner records it.
 const made=await act('PARTNER',rec);assert.equal(made.status,'Confirmed');
 await assert.rejects(()=>act('PARTNER2',rec),/already recorded/);
 r=await act('MANAGER',{action:'bank_starter_confirm_read'});assert.equal(r.starters[0].locked,false);assert.equal(r.starters[0].confirmation.confirmed_by_name,'Fictional Tax Lead');assert.equal(r.history.length,1);
 assert.equal((await tx`select recorded_by from erp_private.starter_rule_confirmations`)[0].recorded_by,actors.PARTNER.staff_id);
 assert.ok((await tx`select 1 from erp_private.audit_events where table_name='starter_rule_confirmations' and action='INSERT'`).length,'the recording is in the change log');
 // Never edited, never deleted.
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.starter_rule_confirmations set confirmed_by_name='Someone else' where confirmation_id=${made.confirmation_id}`),/cannot be edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.starter_rule_confirmations set source_note='Changed note here' where confirmation_id=${made.confirmation_id}`),/cannot be edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.starter_rule_confirmations where confirmation_id=${made.confirmation_id}`),/delet|permission/i);
 await as('MANAGER',()=>tx`update erp_private.starter_rule_confirmations set status='Withdrawn',withdrawn_by=${actors.MANAGER.staff_id},withdrawn_reason='Fictional: manager tries' where confirmation_id=${made.confirmation_id}`); // the row is hidden from the update by row-level security, so nothing changes
 assert.equal((await tx`select status from erp_private.starter_rule_confirmations`)[0].status,'Confirmed');
 // Withdraw: needs a reason, a Partner, the current revision. The row stays as history, and a new confirmation can then be recorded.
 const live=(await tx`select confirmation_id,revision from erp_private.starter_rule_confirmations`)[0];
 await assert.rejects(()=>act('MANAGER',{action:'bank_starter_confirm_withdraw',confirmation_id:live.confirmation_id,revision:live.revision,reason:'Fictional reason long enough'}),/Only a Partner/);
 await assert.rejects(()=>act('PARTNER',{action:'bank_starter_confirm_withdraw',confirmation_id:live.confirmation_id,revision:live.revision,reason:'short'}),/at least 10/);
 await assert.rejects(()=>act('PARTNER',{action:'bank_starter_confirm_withdraw',confirmation_id:live.confirmation_id,revision:'99',reason:'Fictional reason long enough'}),/changed/);
 await act('PARTNER2',{action:'bank_starter_confirm_withdraw',confirmation_id:live.confirmation_id,revision:live.revision,reason:'Fictional: wording to be re-checked'});
 await assert.rejects(()=>act('PARTNER',{action:'bank_starter_confirm_withdraw',confirmation_id:live.confirmation_id,revision:'2',reason:'Fictional reason long enough'}),/already withdrawn/);
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.starter_rule_confirmations set status='Confirmed',withdrawn_by=null,withdrawn_at=null,withdrawn_reason=null where confirmation_id=${live.confirmation_id}`),/withdrawn confirmation cannot be changed/);
 r=await act('PARTNER',{action:'bank_starter_confirm_read'});assert.equal(r.starters[0].locked,true,'locked again');assert.equal(r.history[0].status,'Withdrawn');assert.equal(r.history[0].withdrawn_reason,'Fictional: wording to be re-checked');
 await act('PARTNER',rec);assert.equal((await tx`select count(*)::int c from erp_private.starter_rule_confirmations`)[0].c,2,'history is kept');
});

test('UI: card, table by role, form, escaping and wiring',()=>{
 const button=(a,l,i='')=>`<button data-suite="${a}" data-id="${i}">${l}</button>`;
 const locked=lockedStarters([]),open=lockedStarters([{confirmation_id:'c1',rule_key:'excise-duty',account_code:'51070',status:'Confirmed',confirmed_by_name:'<b>Fictional</b>',confirmed_on:'2026-11-10T00:00:00Z',source_note:'Fictional "email"'}]);
 const v=startersView({starters:locked,history:[],partner:true,button});assert.match(v,/Locked: no Tax Lead confirmation recorded/);assert.match(v,/data-suite="starter-confirm" data-id="excise-duty"/);assert.match(v,new RegExp(STARTER_CONFIRM_NOTE.slice(0,40)));
 assert.doesNotMatch(startersView({starters:locked,history:[],partner:false,button}),/<button/,'a Manager sees no buttons');
 const o=startersView({starters:open,history:[{status:'Withdrawn',rule_key:'excise-duty',confirmed_by_name:'Old',confirmed_on:'2026-10-01',withdrawn_at:'2026-10-05',withdrawn_reason:'Fictional reason'}],partner:true,button});
 assert.match(o,/Unlocked: confirmed in writing by &lt;b&gt;Fictional&lt;\/b&gt; on 2026-11-10/);assert.match(o,/data-suite="starter-withdraw" data-id="c1"/);assert.match(o,/Withdrawn confirmations/);assert.match(o,/Fictional &quot;email&quot;/);
 assert.equal(confirmState(open[0]).startsWith('Unlocked'),true);
 const ui=role=>createStarterConfirmUI({field:()=>'',form:()=>'',modal:()=>{},request:async()=>({}),button,area:()=>'',data:()=>({me:{category_code:role}})});
 assert.match(ui('PARTNER').card(),/Bank starter rules waiting for the Tax Lead/);assert.match(ui('MANAGER').card(),/starterConfirmCard/);for(const r of ['SUPERVISOR','ASSISTANT','INTERN','ADMIN'])assert.equal(ui(r).card(),'');
 const suite=rd('staff-suite.mjs');assert.match(suite,/staff-starter-confirm\.mjs\?v=20261111-excise-v1/);assert.match(suite,/\$\{starterConfirm\.card\(\)\}/);assert.match(suite,/starterConfirm\.handle\(action,id\)/);
 assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261112-rateform-v1/);
 assert.match(rd(fx+'staff-access-control.mjs'),/bank_starter_confirm_\|/);assert.match(rd(fx+'index.ts'),/starterConfirmAction/);
 assert.equal(JSON.parse(rd(fx+'release.json')).build,'2026-11-11.2791');assert.match(rd('staff-pilot.html'),/2026-11-11\.2791/);
 const mig=rd('supabase/migrations/20261111060000_starter_rule_confirmations.sql');assert.doesNotMatch(mig,/forensic|ISRS 4000/i);assert.doesNotMatch(rd('staff-starter-confirm.mjs')+rd(fx+'starter-confirm-actions.ts'),/forensic|ISRS 4000/i);
 assert.doesNotMatch(mig+rd(fx+'bank-starter-rules.mjs'),/\d+(\.\d+)?\s*%/,'no rate is stored');
});
