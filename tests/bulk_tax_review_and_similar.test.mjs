import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {taxAction}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {similarity,pickSimilar,pickFromHistory,descKey,SIMILAR_MIN}=await import('../supabase/functions/staff-workspace-v12/purchase-history.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B1=id(),B2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const tax=(role,p)=>as(role,a=>taxAction(tx,a,p));

test('similar descriptions are suggested with their match percentage, never from unrelated or thin history',()=>{
 assert.equal(similarity('diesel fuel','diesel fuel'),1);assert.ok(similarity('office stationery supplies','office stationery supply')>=SIMILAR_MIN);assert.ok(similarity('diesel fuel','office chairs')<0.3);
 const g=(account,n,route=2)=>[{account_code:account,route,category_code:'EXP01',n,posted:0}];
 const history={byPin:new Map(),byDesc:new Map([[descKey('Office stationery supply'),g('61010',3)],[descKey('Office stationery supplies delivered'),g('61010',1)],[descKey('Fuel for generator'),g('61070',4)]])};
 const row={normalized:{description:'Office stationery supplies'}},pick=pickSimilar(history,row);
 assert.equal(pick.basis,'similar');assert.equal(pick.group.account_code,'61010');assert.ok(pick.similarity>=80&&pick.similarity<100);assert.equal(pick.total,4);
 assert.equal(pickFromHistory(history,row).basis,'similar','used as the last fallback after supplier and identical description');
 assert.equal(pickSimilar(history,{normalized:{description:'Cleaning materials monthly'}}),null,'nothing close enough, no suggestion');
 const thin={byPin:new Map(),byDesc:new Map([[descKey('Office stationery supply'),g('61010',1)]])};assert.equal(pickSimilar(thin,row),null,'one earlier row is not enough');
 const mixed={byPin:new Map(),byDesc:new Map([[descKey('Office stationery supply'),[...g('61010',2),...g('61020',2)]]])};assert.equal(pickSimilar(mixed,row),null,'mixed history gives no suggestion');
});

test('a bulk tax review records one decision on every selected row under the reviewer; the whole action is refused if the reviewer imported any',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'BTQA','Fictional bulk tax firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Bulk Tax',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional bulk tax project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Import Sources','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const batch=(b,by,name)=>tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${b},${P},${D},${name},1,'Purchases','2026-01-01','2026-01-31','{}',3,3,0,0,${by})`;
 await batch(B1,actors.ASSISTANT.staff_id,'Assistant purchases');await batch(B2,actors.MANAGER.staff_id,'Manager purchases');
 const acct=(await tx`select code,category_code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy and code::int>=51000 and code::int<60000 order by code limit 1`)[0];
 let n=0;const mk=(b,key,amount)=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,category_code,account_code) values(${b},${P},${C},'Purchases',${++n},${'BT-'+key},'{}',${tx.json({date:'2026-01-10',amount,vat:amount*0.16,invoice:'BT-'+key,party:'Fictional supplier '+key,description:'Fictional '+key,vat_category:'16%'})},2,${acct.category_code},${acct.code}) returning row_id,revision`.then(r=>({row_id:r[0].row_id,revision:r[0].revision}));
 const a1=await mk(B1,'A1',1000),a2=await mk(B1,'A2',2000),a3=await mk(B1,'A3',3000),m1=await mk(B2,'M1',4000);
 const review=(role,rows,extra={})=>tax(role,{action:'tax_row_review_batch',rows,decision:'Eligible',deductible_percentage:100,income_treatment:'Allowable',reason:'Fictional evidence: invoices and receipts checked together',...extra});
 const reviews=()=>tx`select r.row_id,v.decision,v.deductible_percentage,v.income_treatment,v.reviewed_by,v.reason from erp_private.workbook_rows r join erp_private.tax_row_reviews v using(row_id) where r.project_id=${P}`;
 // Rights: a preparer cannot review.
 await assert.rejects(()=>review('ASSISTANT',[a1,a2]),/Supervisor, Manager or Partner/);
 // Maker is not checker: the Manager imported M1, so a batch that includes it is refused whole and names it; nothing is recorded.
 await assert.rejects(()=>review('MANAGER',[a1,a2,m1]),/Another reviewer must review rows you imported\. Nothing was reviewed\. Rows you imported: Purchases 4/);
 assert.equal((await reviews()).length,0);
 // One decision on three rows, each under the Supervisor's own name.
 const ok=await review('SUPERVISOR',[a1,a2,a3]);assert.equal(ok.count,3);
 const got=await reviews();assert.equal(got.length,3);for(const r of got){assert.equal(r.decision,'Eligible');assert.equal(Number(r.deductible_percentage),100);assert.equal(r.income_treatment,'Allowable');assert.equal(r.reviewed_by,actors.SUPERVISOR.staff_id);assert.match(r.reason,/invoices and receipts/);}
 // The Manager reviews the Assistant's rows, and the Supervisor reviews the Manager's row: either direction works, never your own.
 await review('SUPERVISOR',[m1]);assert.equal((await reviews()).length,4);
 // All or none: a stale revision on one row refuses the whole batch and names the source row; the others keep their earlier decision.
 const bad=await review('MANAGER',[a1,{row_id:a2.row_id,revision:a2.revision+5}],{decision:'Excluded',deductible_percentage:0,income_treatment:'Disallowable'}).catch(e=>e);assert.match(String(bad.message),/Source row 2: .*Nothing was reviewed/);
 assert.equal((await reviews()).filter(r=>r.decision==='Excluded').length,0,'the good row before the stale one was not saved either');
 // Mixed kinds, duplicates and size are refused.
 await assert.rejects(()=>review('SUPERVISOR',[a1,a1]),/more than once/);await assert.rejects(()=>review('SUPERVISOR',[]),/Select between 1 and 200 rows/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='TAX_ROW_REVIEW_BATCH'`)[0].n,2);
});

test('the filing pack offers a bulk review that returns to the same pack',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),su=rd('staff-suite.mjs'),acc=rd('staff-accounting.mjs');
 assert.match(su,/data-tax-pick=/);assert.match(su,/button\('tax-bulk','Confirm decision',id,/);assert.match(su,/action:'tax_row_review_batch'/);assert.match(su,/reviewImportRows\(rows\.filter\(row=>selected\.has\(row\.row_id\)\),\(\)=>taxOpen\(id\)\)/,'back to the same filing pack');
 assert.match(su,/if any row cannot take this decision nothing is saved/);assert.match(su,/You cannot review rows you imported/);
 assert.match(acc,/btn\('map-suggested','Map every suggested group on this page in one save',pid\)/);assert.match(acc,/uploaded:false/,'suggested groups are never recorded as the uploaded-codes confirmation');assert.match(acc,/name="confirm_groups" value="yes" required/);assert.match(acc,/A suggestion only/);
});
