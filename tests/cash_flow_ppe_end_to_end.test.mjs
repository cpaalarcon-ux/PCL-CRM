// Annual pack slice 3 through the real action: formatted statements from the trial balance, the approved statement-line map and the approved comparatives. Fictional data only.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const C=await import('../supabase/functions/staff-workspace-v12/annual-pack-comparatives.mjs');
const A=await import('../supabase/functions/staff-workspace-v12/annual-pack.ts');
const root=path.resolve(import.meta.dirname,'..');
const PL='PL.REVENUE\t1,000,000\nPL.COST_SALES\t400,000\nPL.STAFF\t200,000\nPL.OTHER_OPEX\t100,000\nPL.TAX\t90,000';
const EQ='SFP.SHARE_CAP, OPENING, 100,000\nSFP.RETAINED, OPENING, 50,000\nSFP.RETAINED, PROFIT, 210,000\nSFP.RETAINED, DIVIDENDS_DRAWINGS, (60,000)';
const CF='CF.PBT\t300,000\nCF.DEPREC\t20,000\nCF.WC_REC\t(30,000)\nCF.TAX_PAID\t(80,000)\nCF.PPE_PURCHASE\t(50,000)\nCF.DIVIDENDS_PAID\t(60,000)\nCF.CASH_OPEN\t20,000\nCF.CASH_CLOSE\t120,000';
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('build 2882: the cash flow takes PPE purchases, proceeds and gain from the approved register, through the real pack',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const p2=actors.PARTNER2={staff_id:id(),auth_user_id:id(),session:id(),category_code:'PARTNER'};await tx`insert into auth.users(id) values(${p2.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${p2.session},${p2.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${p2.staff_id},${p2.auth_user_id},'PARTNER2','partner2','Fictional PARTNER2','PARTNER','Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${p2.session},${p2.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${p2.staff_id},${F},'Assigned')`;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${CL},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role==='PARTNER2'?'PARTNER':role})`;
 const per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 await as('PARTNER2',a=>A.statementMapAction(tx,a,{action:'ledger_statement_map_approve',all_seeded:true}));
 const code=async line=>(await tx`select account_code from erp_private.account_statement_map where line_code=${line} and status='Approved' order by account_code limit 1`)[0].account_code;
 const other=await code('PL.OTHER_INCOME');
 const row=(c,name,opening,debit,credit)=>({code:c,name,opening,movement_debit:debit,movement_credit:credit,net:opening+debit-credit});
 // Opening: bank 100,000 and equipment 300,000 against share capital 100,000 and retained earnings 300,000.
 // The year: equipment of 180,000 bought; the old asset (cost 300,000, no depreciation) sold for 350,000, a gain of 50,000. Bank rises by 170,000 to 270,000.
 const tb=[row('30000','Share capital',-100000,0,0),row('31000','Retained earnings',-300000,0,0),row('10020','Bank',100000,350000,180000),row('15004','Equipment',300000,180000,300000),row(other,'Gain on sale',0,0,50000)];
 const data={as_of:'2026-12-31',tb,issues:[],prior_year:{source:'Opening balances'}};
 const X=await import('../supabase/functions/staff-workspace-v12/ppe-actions.ts'),getTb=async()=>data;
 const run=(role,p)=>as(role,a=>X.ppeAction(tx,a,per,p,getTb,'2026-12-31'));
 const get=role=>as(role,a=>A.statementsFrom(tx,per,data));
 const cf=s=>s.statements.cash_flow,at=(s,c)=>cf(s).rows.find(r=>r.code===c);

 // Before the register: no approved assets, so the cash flow keeps the trial-balance figure and says why.
 let s=await get('ASSISTANT');
 assert.equal(cf(s).ppe_link,null);assert.match(cf(s).problems.join(' '),/taken from the trial-balance movement, not from the register/);
assert.equal(at(s,'CF.PPE_PURCHASE').current,120000,'the sale is still netted inside purchases until the register is approved');

 // Declare and approve the two assets and the sale, preparer and approver different.
 const before='2025-12-31';
 const old=await run('ASSISTANT',{action:'ledger_ppe_asset_declare',asset_name:'Fictional old plot',asset_account:'15004',class_code:'LAND',origin:'Brought forward',acquired_on:'2019-01-01',first_use_on:'2019-01-01',cost:300000,business_percentage:100,bf_as_of:before,bf_accumulated_depreciation:0,bf_tax_wdv:0,evidence:'Fictional prior-year schedule for the fixture'});
 const added=await run('ASSISTANT',{action:'ledger_ppe_asset_declare',asset_name:'Fictional new plot',asset_account:'15004',class_code:'LAND',origin:'Added in the year',acquired_on:'2026-03-01',first_use_on:'2026-03-01',cost:180000,business_percentage:100,evidence:'Fictional purchase invoice PI-1'});
 for(const d of [old,added])await run('MANAGER',{action:'ledger_ppe_asset_review',record_id:d.record_id,decision:'Approved'});
 const sale=await run('ASSISTANT',{action:'ledger_ppe_disposal_declare',asset_key:old.asset_key,kind:'Sold',disposed_on:'2026-09-30',proceeds:350000,evidence:'Fictional sale invoice SI-1'});
 s=await get('ASSISTANT');
 assert.match(cf(s).problems.join(' '),/taken from the trial-balance movement/,'a draft disposal keeps the register not ready');
 await run('MANAGER',{action:'ledger_ppe_disposal_review',record_id:sale.record_id,decision:'Approved'});

 s=await get('ASSISTANT');
 assert.equal(s.statements.ppe_register.ok,true,JSON.stringify(s.statements.ppe_register));
 assert.equal(cf(s).reconciles,true,cf(s).problems.join(' | '));assert.equal(cf(s).ppe_link.used,true);assert.equal(cf(s).ppe_link.difference,0);
 assert.equal(at(s,'CF.PPE_PURCHASE').current,-180000,'purchases at cost, from the register');assert.equal(at(s,'CF.PPE_PROCEEDS').current,350000);assert.equal(at(s,'CF.DISPOSAL').current,-50000,'the gain is taken out of operating');
 assert.equal(cf(s).cash_open,100000);assert.equal(cf(s).cash_close,270000);assert.equal(cf(s).net_change,170000);
 assert.equal(cf(s).problems.filter(p=>/property, plant/i.test(p)).length,0);

 // A trial balance that does not carry the sale (the proceeds never reached the bank) no longer agrees: reported, not absorbed.
 const bad={...data,tb:tb.map(r=>r.code==='10020'?row('10020','Bank',100000,0,180000):r)};
 const sBad=await as('ASSISTANT',a=>A.statementsFrom(tx,per,bad));
 assert.equal(cf(sBad).reconciles,false);assert.match(cf(sBad).problems.join(' '),/differs from the trial-balance movement|does not reconcile/);
});
