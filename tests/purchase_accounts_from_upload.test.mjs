import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {approveChart} from './helpers/chart-and-posting.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {purchaseAccountsAction}=await import('../supabase/functions/staff-workspace-v12/purchase-accounts-actions.ts');
const {routingMapAction}=await import('../supabase/functions/staff-workspace-v12/routing-map-actions.ts');
const {autoMapAction}=await import('../supabase/functions/staff-workspace-v12/auto-map.ts');
const {groupUploadAccounts,summariseUpload}=await import('../supabase/functions/staff-workspace-v12/purchase-accounts-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const pa=(role,p)=>as(role,a=>purchaseAccountsAction(tx,a,{project_id:P,...p})),rm=(role,p)=>as(role,a=>routingMapAction(tx,a,{client_id:C,...p})),auto=(role,p)=>as(role,a=>autoMapAction(tx,a,{project_id:P,...p}));

test('the pure rules say ready, already set up or blocked, with the reason, and never guess',()=>{
 const accounts=[{code:'61000',name:'Office expenses',status:'Active',is_legacy:false,route:2},{code:'11010',name:'Cash',status:'Active',is_legacy:false,route:null},{code:'60000',name:'Old',status:'Inactive',is_legacy:false,route:2},{code:'15004',name:'Motor vehicles',status:'Active',is_legacy:false,route:3},{code:'50000',name:'Purchases',status:'Active',is_legacy:false,route:1}];
 const rows=[{tb_code:'61000',date:'2026-01-05',amount:100},{tb_code:'61000',date:'2026-01-20',amount:50},{tb_code:'11010',date:'2026-01-05',amount:5},{tb_code:'60000',date:'2026-01-05',amount:5},{tb_code:'99999',date:'2026-01-05',amount:5},{tb_code:'15004',date:'2026-01-09',amount:900},{tb_code:'50000',date:'2026-01-09',amount:10},{tb_code:'',date:'2026-01-09',amount:1}];
 const chart=()=>({codes:new Set(['61000','15004','11010','60000'])});
 const g=groupUploadAccounts(rows,accounts,[{erp_account_code:'15004',source_account_code:'15004',effective_from:'2026-01-01',effective_to:null,status:'Draft'}],chart),by=Object.fromEntries(g.map(x=>[x.tb_code,x]));
 assert.equal(by['61000'].state,'Ready');assert.equal(by['61000'].rows,2);assert.equal(by['61000'].net,150);assert.equal(by['61000'].first_date,'2026-01-05');assert.equal(by['61000'].last_date,'2026-01-20');
 assert.match(by['11010'].reason,/not a purchase account/);assert.match(by['60000'].reason,/not active/);assert.match(by['99999'].reason,/not an account in the master chart/);
 assert.equal(by['15004'].state,'Already set up');assert.match(by['50000'].reason,/not in the client's approved chart/);
 assert.equal(g.length,6,'a row with no TB code is not an account to set up');
 assert.deepEqual(summariseUpload(g),{ready:1,already:1,blocked:4,stock_needed:false});
 const clash=groupUploadAccounts([{tb_code:'61000',date:'2026-01-05'},{tb_code:'61000',date:'2026-03-05'}],accounts,[{erp_account_code:'61000',source_account_code:'61000',effective_from:'2026-02-01',effective_to:null,status:'Active'}],chart)[0];
 assert.equal(clash.state,'Blocked');assert.match(clash.reason,/does not cover/);
});

test('one step sets up the accounts an upload uses and proposes its routing pairs; a Partner approves them in bulk; nobody approves their own',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PAQA','Fictional accounts firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Setup',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional setup project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 const accts=await tx`select code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy order by code limit 4`,[a1,a2,a3,a4]=accts.map(x=>x.code);
 await approveChart(tx,{C,prepared:actors.MANAGER.staff_id,reviewed:actors.PARTNER.staff_id,exclude:[a4]});
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Import Sources','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-01-01','2026-01-31','{}',6,6,0,0,${actors.ASSISTANT.staff_id})`;
 let n=0;const mk=(key,routing,tb,date='2026-01-10')=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${++n},${'PA-'+key},'{}',${tx.json({date,amount:1000,vat:160,invoice:'PA-'+key,party:'Fictional supplier',party_pin:'P000000001A',description:'Fictional goods',vat_category:'16%',routing_code:routing,tb_code:tb})})`;
 await mk('A1','EXP01',a1);await mk('A2','EXP01',a1,'2026-01-25');await mk('B1','EXP02',a2);await mk('C1','EXP01',a3);await mk('D1','EXP01',a4);await mk('Z1','EXP01','99999');
 await auto('ASSISTANT',{action:'workbook_auto_map'});
 // Rights: only a Manager or Partner, as when adding a client account by hand.
 await assert.rejects(()=>pa('ASSISTANT',{action:'purchase_accounts_preview'}),/Manager or Partner/);
 const pre=await pa('MANAGER',{action:'purchase_accounts_preview'}),by=Object.fromEntries(pre.accounts.map(x=>[x.tb_code,x]));
 assert.equal(pre.ready,3);assert.equal(pre.blocked,2);assert.equal(by[a1].rows,2);assert.equal(by[a1].first_date,'2026-01-10');assert.equal(by[a1].last_date,'2026-01-25');assert.equal(by[a4].state,'Blocked');assert.match(by[a4].reason,/approved chart/);assert.match(by['99999'].reason,/master chart/);assert.equal(pre.stock_method_missing,false);
 // Nothing changed by looking.
 assert.equal((await tx`select count(*)::int n from erp_private.client_account_mappings where client_id=${C}`)[0].n,0);
 // One confirmation sets up the ready accounts, proposes their routing pairs, and reports the blocked ones with the reason. Nothing is mapped, approved or posted.
 const out=await pa('MANAGER',{action:'purchase_accounts_save',codes:[a1,a2,a3,a4,'99999']});
 assert.equal(out.created,3);assert.equal(out.skipped.length,2);assert.ok(out.skipped.some(x=>x.tb_code===a4&&/approved chart/.test(x.reason)));assert.equal(out.routing_proposed,3);
 const made=await tx`select source_account_code,erp_account_code,status,effective_from::text,created_by from erp_private.client_account_mappings where client_id=${C} order by erp_account_code`;
 assert.equal(made.length,3);for(const m of made){assert.equal(m.status,'Draft');assert.equal(m.created_by,actors.MANAGER.staff_id);assert.equal(m.source_account_code,m.erp_account_code);}
 assert.equal(made.find(m=>m.erp_account_code===a1).effective_from,'2026-01-10');
 assert.equal((await tx`select count(*)::int n from erp_private.workbook_rows where client_id=${C} and account_code is not null`)[0].n,0,'setting up never maps a row');
 // Running it again does nothing new.
 const again=await pa('MANAGER',{action:'purchase_accounts_save',codes:[a1,a2,a3]});assert.equal(again.created,0);assert.equal(again.routing_proposed,0);assert.match(again.note,/Nothing new/);
 assert.equal((await pa('MANAGER',{action:'purchase_accounts_preview'})).already,3);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='CLIENT_ACCOUNTS_FROM_UPLOAD'`)[0].n,2);
 // The routing drafts wait for a Partner who did not propose them. A Manager cannot approve; a batch naming the Partner's own proposal is refused whole.
 const drafts=(await rm('MANAGER',{action:'routing_map_read'})).maps.filter(x=>x.status==='Draft');assert.equal(drafts.length,3);
 await assert.rejects(()=>rm('MANAGER',{action:'routing_map_approve_batch',routing_ids:drafts.map(x=>x.routing_id)}),/Partner approves/);
 const own=await rm('PARTNER',{action:'routing_map_propose',module:'Purchases',routing_code:'XPT7',erp_account_code:a1,effective_from:'2026-01-01'});assert.equal(own.saved,1);
 const mine=(await rm('PARTNER',{action:'routing_map_read'})).maps.find(x=>x.routing_code==='XPT7');
 await assert.rejects(()=>rm('PARTNER',{action:'routing_map_approve_batch',routing_ids:[...drafts.map(x=>x.routing_id),mine.routing_id]}),/You proposed: XPT7/);
 assert.equal((await rm('PARTNER',{action:'routing_map_read'})).maps.filter(x=>x.status==='Active').length,0,'a refused batch approves nothing');
 const ok=await rm('PARTNER',{action:'routing_map_approve_batch',routing_ids:drafts.map(x=>x.routing_id)});assert.equal(ok.approved,3);
 await assert.rejects(()=>rm('PARTNER',{action:'routing_map_approve_batch',routing_ids:drafts.map(x=>x.routing_id)}),/Only drafts can be approved/);
 // The next automatic mapping maps the rows whose pair is now approved; the blocked ones keep their reason.
 const run=await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal(run.mapped,4);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='ROUTING_MAP_APPROVED_BATCH'`)[0].n,1);
});

test('the screens offer the one-step set-up to a Manager or Partner and the bulk approval to a Partner only',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),acc=rd('staff-accounting.mjs'),rmap=rd('staff-routing-map.mjs');
 assert.match(acc,/leader\(\)\?`<p>\$\{btn\('setup-upload','Set up the accounts this upload uses',pid\)\}<\/p>`:''/,'the button is for Managers and Partners');
 assert.match(acc,/action:'purchase_accounts_preview'/);assert.match(acc,/action:'purchase_accounts_save',project_id:pid,codes/);assert.match(acc,/await imported\(pid\)/,'after saving the person returns to the purchases list');
 assert.match(acc,/Nothing is mapped, approved or posted/);
 assert.match(rmap,/category_code==='PARTNER'\?\(cur\?\.maps\|\|\[\]\)\.filter\(m=>m\.status==='Draft'&&m\.created_by!==d\(\)\.me\.staff_id\)/,'only drafts the Partner did not propose are offered');
 assert.match(rmap,/routing_map_approve_batch/);assert.match(rmap,/If you proposed any of them, nothing is approved/);
});
