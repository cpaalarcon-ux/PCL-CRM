import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {checkAmendRows,readDate,resultingTotal}=await import('../supabase/functions/staff-workspace-v12/owner-amend-rules.mjs');
const {ownerAmendStage}=await import('../supabase/functions/staff-workspace-v12/owner-amend-actions.ts');
const {ownerBatchAction}=await import('../supabase/functions/staff-workspace-v12/owner-batch-actions.ts');
const {proposalAction}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const {policyAction}=await import('../supabase/functions/staff-workspace-v12/policy-actions.ts');
const {engagementAction}=await import('../supabase/functions/staff-workspace-v12/engagement-actions.ts');
const {default:ExcelJS}=await import('exceljs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
tx.savepoint=async fn=>{await db.exec('savepoint rs');try{const r=await fn(tx);await db.exec('release savepoint rs');return r;}catch(e){await db.exec('rollback to savepoint rs');throw e;}};
const runAs=a=>{const run=async q=>{
 if(q.action==='client_proposal_check'||q.action==='client_proposal_approve')return proposalAction(tx,a,q,run);
 if(q.action==='owner_add'||q.action==='owner_share_amend')return engagementAction(tx,a,q);
 throw new Error('unexpected '+q.action);};return run;};
const stage=(role,f)=>as(role,a=>ownerAmendStage(tx,a,f)),batch=(role,p)=>as(role,a=>ownerBatchAction(tx,a,p,runAs(a)));
const book=async sheets=>{const wb=new ExcelJS.Workbook();for(const [name,rows] of Object.entries(sheets)){const ws=wb.addWorksheet(name);for(const r of rows)ws.addRow(r);}return Buffer.from(await wb.xlsx.writeBuffer());};
const upload=async sheets=>{const f=new FormData();f.set('file',new File([await book(sheets)],'amend.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));return f;};
const AH=['client_kra_pin','client_name','full_name','ownership_percentage','evidence_reference','sighted_by','sighted_on'];
const row=(pin,client,name,share,extra={})=>{const o={client_kra_pin:pin,client_name:client,full_name:name,ownership_percentage:share,evidence_reference:'CR12 dated 20 Nov 2026',sighted_by:'Seller Fictional',sighted_on:'2026-11-20',...extra};return AH.map(h=>o[h]??'');};
const rowsOf=list=>list.map((r,i)=>({row:i+2,values:Object.fromEntries(AH.map((h,j)=>[h,r[j]??'']))}));


test('amendment rules: each row needs a share, the evidence, who saw it and a real past date',()=>{
 const ok=checkAmendRows(rowsOf([row('P000000021A','One Ltd','Amina',60),row('P000000021A','One Ltd','Brian','40%'),row('P000000022B','Two Ltd','Carol',0.5),row('P000000022B','Two Ltd','Daniel',0.5)]),{today:'2026-11-26'});
 assert.deepEqual(ok.errors,[]);assert.equal(ok.clients.length,2);
 // Percentages and Excel fractions are both read; mixed values are not guessed.
 assert.deepEqual(ok.clients[0].owners.map(o=>o.share),[60,40]);assert.deepEqual(ok.clients[1].owners.map(o=>o.share),[0.5,0.5],'a sheet that mixes forms is read as written, never guessed');
 assert.deepEqual(checkAmendRows(rowsOf([row('P000000022B','Two Ltd','Carol',0.5),row('P000000022B','Two Ltd','Daniel',0.5)]),{today:'2026-11-26'}).clients[0].owners.map(o=>o.share),[50,50],'a sheet of Excel percentage cells is read as fractions');
 const bad=checkAmendRows(rowsOf([row('P000000021A','One Ltd','Amina',''),row('P000000021A','One Ltd','Brian','half'),row('P000000021A','One Ltd','Carol',50,{evidence_reference:''}),
  row('P000000021A','One Ltd','Dan',50,{sighted_by:''}),row('P000000021A','One Ltd','Eve',50,{sighted_on:'31 Feb 2026'}),row('P000000021A','One Ltd','Fay',50,{sighted_on:'2026-12-01'}),
  row('P000000021A','One Ltd','Gus',50,{evidence_reference:'A1234567'}),row('NOTAPIN','X','Hal',50),row('P000000021A','One Ltd','Amina',50)]),{today:'2026-11-26'});
 const m=JSON.stringify(bad.errors);for(const re of [/new share is blank/,/not a percentage/,/no evidence reference/,/who sighted the evidence is blank/,/not a date/,/in the future/,/identity-document number/,/not a valid KRA PIN/,/listed twice/])assert.match(m,re);
 assert.equal(readDate('20 Nov 2026'),'2026-11-20');assert.equal(readDate('20/11/2026'),'2026-11-20');assert.equal(readDate('soon'),null);
 assert.equal(resultingTotal(20,[{share:50},{share:30}]),100);
});


test('owner share amendments go through proposal, check and approval, and change only the owners named',async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},${a.category_code==='MANAGER'?'Firm':'Assigned'})`;}
 await as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true}));

 const C1=id(),C2=id();
 for(const [cid,name,pin] of [[C1,'UAT Fictional One Ltd','P000000021A'],[C2,'UAT Fictional Two Ltd','P000000022B']]){
  await tx`insert into erp_private.clients(client_id,company_name,kra_pin,record_status,owner_staff_id,is_uat_fixture) values(${cid},${name},${pin},'Existing',${actors.ASSISTANT.staff_id},true)`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${F})`;}
 const own=async(cid,name,pct)=>(await tx`insert into erp_private.beneficial_owners(client_id,full_name,identity_reference,ownership_percentage,control_basis,created_by) values(${cid},${name},'Not recorded: identity document not yet sighted',${pct},'Director',${actors.MANAGER.staff_id}) returning owner_id`)[0].owner_id;
 const a1=await own(C1,'Fictional Amina Otieno',0),b1=await own(C1,'Fictional Brian Kiprop',0);
 const a2=await own(C2,'Fictional Carol Wanjiru',0),b2=await own(C2,'Fictional Daniel Mwangi',0),c2=await own(C2,'Fictional Esther Njeri',20);
 const proposals=async()=>(await tx`select count(*)::int n from erp_private.change_proposals`)[0].n;
 const shares=async cid=>(await tx`select full_name,ownership_percentage::float8 p from erp_private.beneficial_owners where client_id=${cid} and deleted_at is null order by full_name`);
 // Only a preparer uploads; the sheet and its columns are required.
 await assert.rejects(async()=>stage('MANAGER',await upload({'Owner Amendments':[AH]})),/access/);
 await assert.rejects(async()=>stage('ASSISTANT',await upload({Other:[['x']]})),/Owner Amendments/);
 await assert.rejects(async()=>stage('ASSISTANT',await upload({'Owner Amendments':[['client_kra_pin','full_name']]})),/ownership_percentage/);
 // A name that is not on the record, and shares that do not total 100%, each stop the whole file.
 const notOwner=await stage('ASSISTANT',await upload({'Owner Amendments':[AH,row('P000000021A','UAT Fictional One Ltd','Fictional Stranger',100)]}));
 assert.equal(notOwner.status,'VALIDATION_FAILED');assert.match(JSON.stringify(notOwner.errors),/is not recorded as an owner/);
 const short=await stage('ASSISTANT',await upload({'Owner Amendments':[AH,row('P000000021A','UAT Fictional One Ltd','Fictional Amina Otieno',60),row('P000000021A','UAT Fictional One Ltd','Fictional Brian Kiprop',30)]}));
 assert.equal(short.status,'VALIDATION_FAILED');assert.match(JSON.stringify(short.errors),/add to 90%/);
 // Owners not named in the file keep their share: Carol and Daniel must take the remaining 80%.
 const rest=await stage('ASSISTANT',await upload({'Owner Amendments':[AH,row('P000000022B','UAT Fictional Two Ltd','Fictional Carol Wanjiru',50),row('P000000022B','UAT Fictional Two Ltd','Fictional Daniel Mwangi',50)]}));
 assert.equal(rest.status,'VALIDATION_FAILED');assert.match(JSON.stringify(rest.errors),/add to 120%/);assert.equal(await proposals(),0);
 const good=await upload({'Owner Amendments':[AH,row('P000000021A','UAT Fictional One Ltd','Fictional Amina Otieno',60),row('P000000021A','UAT Fictional One Ltd','Fictional Brian Kiprop',40),
  row('P000000022B','UAT Fictional Two Ltd','Fictional Carol Wanjiru',50),row('P000000022B','UAT Fictional Two Ltd','Fictional Daniel Mwangi',30)]});
 const out=await stage('ASSISTANT',good);
 if(out.status!=='PROPOSED')console.log(JSON.stringify(out.errors));
 assert.equal(out.status,'PROPOSED');assert.equal(out.proposed.length,4);assert.match(out.batch_ref,/^OA-\d{8}-/);
 // Nothing on the record changes before approval, and the proposal carries the evidence.
 assert.deepEqual((await shares(C1)).map(o=>o.p),[0,0]);
 const props=await tx`select * from erp_private.change_proposals where payload->>'batch_ref'=${out.batch_ref} order by (payload->>'batch_row')::int`;
 assert.equal(props.length,4);assert.ok(props.every(p=>p.action==='owner_share_amend'&&p.status==='Proposed'&&p.payload.evidence_reference==='CR12 dated 20 Nov 2026'&&p.payload.sighted_by==='Seller Fictional'&&p.payload.sighted_on==='2026-11-20'));
 assert.match(props[0].summary,/Change owner share: .* to \d+(\.\d+)?%/);
 // The same file again proposes nothing new.
 const again=await stage('ASSISTANT',good);assert.equal(again.proposed.length,0);assert.equal(again.skipped_existing.length,4);assert.equal(await proposals(),4);
 // Check, then a different Manager approves; the shares are applied and the other owner is untouched.
 await assert.rejects(()=>batch('MANAGER2',{action:'owner_batch_approve',batch_ref:out.batch_ref,note:'Agreed to the CR12 extracts'}),/waiting for approval/);
 const checked=await batch('MANAGER',{action:'owner_batch_check',batch_ref:out.batch_ref,note:'Matches the CR12 sighted on 20 Nov 2026'});assert.equal(checked.done.length,4);
 const approved=await batch('MANAGER2',{action:'owner_batch_approve',batch_ref:out.batch_ref,note:'Agreed to the CR12 extracts'});assert.equal(approved.held.length,0,JSON.stringify(approved.held));assert.equal(approved.done.length,4);
 assert.deepEqual(await shares(C1),[{full_name:'Fictional Amina Otieno',p:60},{full_name:'Fictional Brian Kiprop',p:40}]);
 assert.deepEqual((await shares(C2)).map(o=>o.p),[50,30,20]);
 // A change that would take the client over 100% is refused when applied, and a record changed after the proposal is refused as stale.
 await assert.rejects(()=>as('MANAGER',a=>engagementAction(tx,a,{action:'owner_share_amend',owner_id:a1,ownership_percentage:70,evidence_reference:'CR12 dated 20 Nov 2026',sighted_by:'Seller Fictional',sighted_on:'2026-11-20',change_reason:'Test over 100'})),/cannot add to more than 100%/);
 await assert.rejects(()=>as('MANAGER',a=>engagementAction(tx,a,{action:'owner_share_amend',owner_id:a1,revision:'1',ownership_percentage:55,evidence_reference:'CR12 dated 20 Nov 2026',sighted_by:'Seller Fictional',sighted_on:'2026-11-20',change_reason:'Test stale'})),/changed after the amendment was proposed/);
 await assert.rejects(()=>as('MANAGER',a=>engagementAction(tx,a,{action:'owner_share_amend',owner_id:b1,ownership_percentage:30,evidence_reference:'',sighted_by:'Seller Fictional',sighted_on:'2026-11-20'})),/Say which document/);
});

test('owner share amendments are wired into the screen, rights, catalogue and server',()=>{
 const R=f=>fs.readFileSync(path.join(root,f),'utf8'),V='supabase/functions/staff-workspace-v12/';
 for(const f of ['staff-action-rights.mjs',V+'staff-action-rights.mjs'])assert.match(R(f),/'owner_add','owner_share_amend','party_add'/);
 for(const f of ['staff-rights-catalog.mjs',V+'staff-rights-catalog.mjs']){assert.match(R(f),/PROPOSABLE_ACTIONS=Object\.freeze\(\[[^\]]*'owner_share_amend'/);assert.match(R(f),/actions:\['owner_add','owner_share_amend'/);}
 assert.match(R(V+'index.ts'),/form\.get\('mode'\)==='amend'\?ownerAmendStage/);
 assert.match(R(V+'owner-batch-actions.ts'),/const KINDS=\['owner_add','owner_share_amend','contact_save'\]/);
 assert.match(R('staff-proposals.mjs'),/data-propose="owner-amend"/);assert.match(R('staff-proposals.mjs'),/\^O\[WA\]-/);
 assert.match(R(V+'proposal-actions.ts'),/Change owner share:/);
 assert.doesNotMatch(R('supabase/migrations/20261215000000_owner_share_amend.sql'),/GRANT[^;]*(INSERT|UPDATE|DELETE)/);
});
