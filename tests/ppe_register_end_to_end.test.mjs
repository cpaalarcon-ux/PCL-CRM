import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const X=await import('../supabase/functions/staff-workspace-v12/ppe-actions.ts');
const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
let per,MOTOR='',OTHER='';
let TB=[];const getTb=async()=>({tb:TB});
const run=(role,p,l)=>as(role,a=>X.ppeAction(tx,a,l||per,p,getTb,'2026-12-31'));
const asset=(o={})=>({action:'ledger_ppe_asset_declare',asset_name:'Fictional delivery van',asset_account:MOTOR,class_code:'MOTOR',origin:'Added in the year',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:1000000,business_percentage:100,evidence:'Invoice INV-001 and delivery note',...o});
const tbFor=cost=>[{code:MOTOR,name:'Motor vehicles',net:cost,movement_debit:cost,movement_credit:0},{code:'15920',name:'Accumulated depreciation, motor vehicles',net:-cost/4,movement_debit:0,movement_credit:cost/4},{code:'67030',name:'Depreciation, motor vehicles',net:cost/4,movement_debit:cost/4,movement_credit:0}];

test('the PPE register: declare, approval by someone else, versions, disposal, ending a record, the sole-Partner rule, the tie to the trial balance and the audit freeze',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${CL},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 MOTOR=(await tx`select code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy and name ilike '%motor%' and code not in('15920') order by code limit 1`)[0].code;
 assert.match(MOTOR,/^15\d{3}$/);OTHER=(await tx`select code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy and code<>${MOTOR} and code not between '15900' and '15999' order by code limit 1`)[0].code;
 // ----- nothing yet
 let r=await run('ASSISTANT',{action:'ledger_ppe_read'});assert.equal(r.assets.length,0);assert.equal(r.readiness.relevant,false);assert.equal(r.can_declare,true);assert.ok(r.classes.some(c=>c.code==='MOTOR'));assert.ok(r.accounts.some(x=>x.code===MOTOR));
 assert.equal((await as('ASSISTANT',a=>X.ppeRegisterFor(tx,per,[]))).readiness.ok,true,'a year with no PPE needs no register');
 // ----- a draft is not in the register until someone else approves it
 await assert.rejects(()=>run('ASSISTANT',asset({cost:0})),/cost of the asset/);await assert.rejects(()=>run('ASSISTANT',asset({asset_account:'61000'})),/not an active property|Choose the cost account/);
 await assert.rejects(()=>run('ASSISTANT',asset({evidence:'x'})),/supports the cost/);await assert.rejects(()=>run('ASSISTANT',asset({origin:'Brought forward'})),/brought-forward/i);
 const d1=await run('ASSISTANT',asset());assert.equal(d1.status,'Draft');assert.equal(d1.version,1);
 r=await run('ASSISTANT',{action:'ledger_ppe_read'});assert.equal(r.assets[0].state,'Waiting for approval');assert.equal(r.register.rows.length,0);assert.equal(r.assets[0].can_review,false);
 TB=tbFor(1000000);
 r=await run('MANAGER',{action:'ledger_ppe_read'});assert.equal(r.assets[0].can_review,true);assert.equal(r.readiness.ok,false);assert.ok(r.readiness.problems.some(p=>/waiting for approval/.test(p)));
 await assert.rejects(()=>run('ASSISTANT',{action:'ledger_ppe_asset_review',record_id:d1.record_id,decision:'Approved'}),/Manager or Partner/);
 await assert.rejects(()=>run('MANAGER',{action:'ledger_ppe_asset_review',record_id:d1.record_id,decision:'Returned',review_note:'no'}),/at least 10/);
 const ap=await run('MANAGER',{action:'ledger_ppe_asset_review',record_id:d1.record_id,decision:'Approved'});assert.deepEqual(ap,{status:'Approved',sole_partner_approval:false});
 // ----- the year: the charge is worked out and the register ties to the trial balance
 r=await run('MANAGER',{action:'ledger_ppe_read'});const x=r.register.rows[0];
 assert.deepEqual([x.additions,x.closing_cost,x.charge,x.closing_acc,x.nbv,x.tax_closing],[1000000,1000000,250000,250000,750000,750000]);assert.equal(r.reconciliation.ties,true);assert.equal(r.readiness.ok,true);assert.equal(r.schedule.totals.nbv,750000);
 TB=tbFor(1100000);r=await run('MANAGER',{action:'ledger_ppe_read'});assert.equal(r.reconciliation.ties,false);assert.equal(r.readiness.ok,false);assert.match(r.readiness.problems.join(' '),/out by/);
 TB=[...tbFor(1000000),{code:OTHER,name:'Fictional other PPE',net:80000}];const out=await run('MANAGER',{action:'ledger_ppe_read'});assert.equal(out.readiness.ok,false,'a PPE balance with no register assets is a difference');TB=tbFor(1000000);
 // ----- a record is never edited in the database; a correction is a new version that supersedes after approval
 await assert.rejects(()=>tx`update erp_private.ppe_assets set cost=1 where record_id=${d1.record_id}`,/never edited/);await assert.rejects(()=>tx`delete from erp_private.ppe_assets`);
 const v2=await run('ASSISTANT',asset({asset_key:d1.asset_key,cost:1200000}));assert.equal(v2.version,2);
 assert.equal((await run('ASSISTANT',{action:'ledger_ppe_read'})).register.totals.closing_cost,1000000,'the approved version stands until the new one is approved');
 await run('MANAGER',{action:'ledger_ppe_asset_review',record_id:v2.record_id,decision:'Approved'});
 assert.equal((await run('ASSISTANT',{action:'ledger_ppe_read'})).register.totals.closing_cost,1200000);
 assert.deepEqual((await tx`select version,status from erp_private.ppe_assets where asset_key=${d1.asset_key} order by version`).map(r=>r.status),['Superseded','Approved']);
 // ----- the sole Partner may approve their own record, and it is recorded; a Manager may not
 const mine=await run('MANAGER',asset({asset_name:'Fictional laptop',asset_account:MOTOR,cost:300000}));
 await assert.rejects(()=>run('MANAGER',{action:'ledger_ppe_asset_review',record_id:mine.record_id,decision:'Approved'}),/Someone else approves/);
 const pm=await run('PARTNER',asset({asset_name:'Fictional pickup',cost:500000}));
 await assert.rejects(()=>run('PARTNER',{action:'ledger_ppe_asset_review',record_id:pm.record_id,decision:'Approved'}),/only Partner/);
 assert.deepEqual(await run('PARTNER',{action:'ledger_ppe_asset_review',record_id:pm.record_id,decision:'Approved',sole_partner_approval:true}),{status:'Approved',sole_partner_approval:true});
 assert.equal((await tx`select sole_partner_approval from erp_private.ppe_assets where record_id=${pm.record_id}`)[0].sole_partner_approval,true);
 await run('PARTNER',{action:'ledger_ppe_asset_review',record_id:mine.record_id,decision:'Returned',review_note:'Cost does not agree to the invoice.'});
 r=await run('ASSISTANT',{action:'ledger_ppe_read'});assert.equal(r.assets.find(a=>a.name==='Fictional laptop').state,'Returned');
 // ----- a brought-forward asset starts from the approved figures
 const bf=await run('ASSISTANT',asset({asset_name:'Fictional old lorry',origin:'Brought forward',acquired_on:'2023-05-01',first_use_on:'2023-05-01',cost:800000,bf_as_of:'2025-12-31',bf_accumulated_depreciation:400000,bf_tax_wdv:300000}));
 await run('MANAGER',{action:'ledger_ppe_asset_review',record_id:bf.record_id,decision:'Approved'});
 r=await run('ASSISTANT',{action:'ledger_ppe_read'});const lorry=r.register.rows.find(q=>q.asset_name==='Fictional old lorry');assert.deepEqual([lorry.opening_cost,lorry.opening_acc,lorry.charge,lorry.closing_acc,lorry.nbv,lorry.tax_opening,lorry.tax_closing],[800000,400000,200000,600000,200000,300000,100000]);
 await assert.rejects(()=>run('ASSISTANT',asset({asset_name:'Fictional odd',origin:'Brought forward',acquired_on:'2023-05-01',first_use_on:'2023-05-01',cost:1,bf_as_of:'2025-12-31',bf_accumulated_depreciation:5,bf_tax_wdv:0})),/more than cost/);
 // ----- a disposal: separate approval, no charge in the year, gain or loss and a tax balancing figure
 await assert.rejects(()=>run('ASSISTANT',{action:'ledger_ppe_disposal_declare',asset_key:pm.asset_key,kind:'Sold',disposed_on:'2026-02-01',proceeds:1,evidence:'Sale invoice SI-9 to a fictional buyer'}),/before the asset was first used|first used/);
 await assert.rejects(()=>run('ASSISTANT',{action:'ledger_ppe_disposal_declare',asset_key:pm.asset_key,kind:'Donated',disposed_on:'2026-11-01',proceeds:5,evidence:'Gift deed to a fictional school'}),/no proceeds/);
 const dd=await run('ASSISTANT',{action:'ledger_ppe_disposal_declare',asset_key:pm.asset_key,kind:'Sold',disposed_on:'2026-11-01',proceeds:350000,evidence:'Sale invoice SI-9 to a fictional buyer'});assert.equal(dd.status,'Draft');
 r=await run('MANAGER',{action:'ledger_ppe_read'});assert.equal(r.register.rows.some(q=>q.asset_name==='Fictional pickup'&&q.disposed),false,'a draft disposal changes nothing');assert.equal(r.assets.find(a=>a.name==='Fictional pickup').can_review_disposal,true);
 await run('MANAGER',{action:'ledger_ppe_disposal_review',record_id:dd.record_id,decision:'Approved'});
 r=await run('MANAGER',{action:'ledger_ppe_read'});const pick=r.register.rows.find(q=>q.asset_name==='Fictional pickup');
 assert.deepEqual([pick.disposed,pick.charge,pick.closing_cost,pick.nbv,pick.proceeds,pick.gain_loss,pick.tax_balancing_allowance,pick.tax_balancing_charge],[true,0,0,0,350000,-150000,150000,0]);
 await assert.rejects(()=>run('MANAGER',{action:'ledger_ppe_asset_end',asset_key:pm.asset_key,reason:'Recorded in error, the asset is not ours.'}),/no approved record|disposal/i);
 await run('MANAGER',{action:'ledger_ppe_disposal_end',asset_key:pm.asset_key,reason:'The sale fell through before delivery.'});
 r=await run('MANAGER',{action:'ledger_ppe_read'});assert.equal(r.register.rows.find(q=>q.asset_name==='Fictional pickup').disposed,false);
 // ----- an asset recorded in error is ended with a reason, and keeps its history
 await assert.rejects(()=>run('MANAGER',{action:'ledger_ppe_asset_end',asset_key:pm.asset_key,reason:'short'}),/at least 10/);
 await run('MANAGER',{action:'ledger_ppe_asset_end',asset_key:pm.asset_key,reason:'Recorded in error, the asset is not ours.'});
 assert.equal((await tx`select status from erp_private.ppe_assets where asset_key=${pm.asset_key} order by version desc limit 1`)[0].status,'Ended');
 assert.equal((await run('MANAGER',{action:'ledger_ppe_read'})).register.rows.some(q=>q.asset_name==='Fictional pickup'),false);
 // ----- a purchase mapped to a PPE account is offered so it is not typed twice
 // ----- the audit freeze: no record changes while an audit lock covers the year
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_audit_locks(period_id,project_id,client_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,report_reference,report_date,opinion,locked_by) values(${per.period_id},${P},${CL},'In-house audit',${id()},${'a'.repeat(64)},${'b'.repeat(64)},${id()},'Fictional audit report AR-1','2027-02-01','Unmodified',${actors.PARTNER.staff_id})`;
 await db.exec('set session_replication_role=origin');
 await assert.rejects(()=>run('ASSISTANT',asset({asset_name:'Fictional late asset'})),/locked by an audit/);
 await assert.rejects(()=>run('MANAGER',{action:'ledger_ppe_asset_end',asset_key:d1.asset_key,reason:'Trying to end it during the audit.'}),/locked by an audit/);
 await assert.rejects(()=>as('ASSISTANT',a=>tx`insert into erp_private.ppe_assets(asset_key,version,client_id,asset_name,asset_account,class_code,acquired_on,first_use_on,cost,origin,evidence,prepared_by) values(${id()},1,${CL},'Fictional direct insert',${MOTOR},'MOTOR','2026-03-01','2026-03-01',10,'Added in the year','Direct insert during the audit',${a.staff_id})`),/locked by an audit/);
 assert.equal((await run('ASSISTANT',{action:'ledger_ppe_read'})).can_declare,false);
 // ----- the access rules
 await assert.rejects(()=>as('MANAGER',a=>X.ppeAction(tx,{...a,category_code:'INTERN'},per,{action:'ledger_ppe_read'},getTb,'2026-12-31')),/staff who prepare/);
});
