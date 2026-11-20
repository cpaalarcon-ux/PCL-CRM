import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ExcelJS from 'exceljs';

const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),DOC=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const storage={download:async key=>key===`qa/${DOC}`?{data:new Blob([workbookBytes]),error:null}:{data:null,error:new Error('missing')}};
let workbookBytes;
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p,storage));

test('ending several client account mappings with one shared date is atomic, independent and scoped to the client',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'MAPQA','Fictional mapping QA firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mapping Client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const account=(await tx`select code,name,category_code from erp_private.account_catalog where code='10000' and status='Active' and not is_legacy`)[0];assert.ok(account);
 const add=(role,code,name)=>call(role,{action:'v3_client_account_mapping_add',client_id:C,source_account_code:code,source_account_name:name,erp_account_code:account.code,effective_from:'2026-01-01'});
 await add('MANAGER','M-1','Manager mapping one');await add('MANAGER','M-2','Manager mapping two');await add('PARTNER','P-1','Partner mapping one');
 // Mappings only become Active through the posting review; set that state directly for this test of the end-date action.
 const approver=actors.PARTNER.staff_id;
 await db.exec('begin');await db.exec('set local session_replication_role = replica');
 await tx`update erp_private.client_account_mappings set status='Active',approved_at=now(),approved_by=${approver} where client_id=${C}`;
 await db.exec('commit');
 const read=async()=>await tx`select mapping_id,source_account_code,revision,status,effective_to,created_by from erp_private.client_account_mappings where client_id=${C} order by source_account_code`;
 const rows=await read(),byCode=Object.fromEntries(rows.map(r=>[r.source_account_code,r])),item=r=>({mapping_id:r.mapping_id,revision:r.revision});
 const day=v=>v?new Date(v).toISOString().slice(0,10):null;

 await assert.rejects(()=>call('ASSISTANT',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(byCode['M-1'])],effective_to:'2026-06-30'}),/Partner or Manager must maintain client configuration/,'an Audit Assistant cannot end-date mappings');
 await assert.rejects(()=>call('MANAGER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(byCode['M-1']),item(byCode['M-2'])],effective_to:'2026-06-30'}),/different Manager or Partner/,'the creator cannot end-date their own mappings');
 await assert.rejects(()=>call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[],effective_to:'2026-06-30'}),/Select between 1 and 2,000/);
 await assert.rejects(()=>call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(byCode['M-1'])]}),/shared end date/);
 await assert.rejects(()=>call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(byCode['M-1']),item(byCode['M-1'])],effective_to:'2026-06-30'}),/more than once/);
 await assert.rejects(()=>call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(byCode['M-1']),{...item(byCode['M-2']),revision:Number(byCode['M-2'].revision)+5}],effective_to:'2026-06-30'}),/changed/,'a stale revision stops the whole batch');
 await assert.rejects(()=>call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(byCode['M-1']),item(byCode['M-2'])],effective_to:'2025-12-31'}),/before/,'an end date before a start date stops the whole batch');
 assert.ok((await read()).every(r=>!r.effective_to),'a refused batch changes nothing');

 const ok=await call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(byCode['M-1']),item(byCode['M-2'])],effective_to:'2026-06-30'});
 assert.equal(ok.updated_count,2);assert.equal(ok.effective_to,'2026-06-30');
 const after=Object.fromEntries((await read()).map(r=>[r.source_account_code,r]));
 assert.equal(day(after['M-1'].effective_to),'2026-06-30');assert.equal(day(after['M-2'].effective_to),'2026-06-30');assert.equal(after['P-1'].effective_to,null,'unselected mappings are untouched');
 await assert.rejects(()=>call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(after['M-1'])],effective_to:'2026-05-31'}),/no longer an active ongoing mapping/,'an already ended mapping is not ended again');
 // A different client's mapping cannot be reached through this client.
 await assert.rejects(()=>call('PARTNER',{action:'v3_client_account_mapping_end_batch',client_id:id(),items:[item(after['P-1'])],effective_to:'2026-06-30'}),/Record unavailable|no longer available/);
 // A Manager can end the Partner-created mapping.
 assert.equal((await call('MANAGER',{action:'v3_client_account_mapping_end_batch',client_id:C,items:[item(after['P-1'])],effective_to:'2026-06-30'})).updated_count,1);
});
