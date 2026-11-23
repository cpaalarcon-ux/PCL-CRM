import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {statementMapAction}=await import('../supabase/functions/staff-workspace-v12/annual-pack.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {settingsOwnerAction}=await import('../supabase/functions/staff-workspace-v12/settings-owner-actions.ts');
const {settingsStarterProposalAction}=await import('../supabase/functions/staff-workspace-v12/settings-starter-proposals.ts');
const {settingsHubAction}=await import('../supabase/functions/staff-workspace-v12/settings-hub-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const map=(role,p)=>as(role,a=>statementMapAction(tx,a,p));
const account=(role,p)=>as(role,a=>accountingAction(tx,a,p));
const own=(role,p)=>as(role,a=>settingsOwnerAction(tx,a,p));
test('grouped statement-line review, Owner Matrix and My Approvals through the real actions',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V4QA','Fictional V4 firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 // ---- grouped review ----
 await assert.rejects(map('SUPERVISOR',{action:'ledger_statement_map_review_read'}),/Managers and Partners/);
 const r0=await map('MANAGER',{action:'ledger_statement_map_review_read'});
 const s=r0.summary;assert(s.total>300);assert.equal(s.consistent+s.unchanged+s.exceptions,s.total);
 assert.equal(r0.groups.reduce((n,g)=>n+g.count,0),s.consistent,'the groups hold every consistent mapping');
 assert(s.consistent>250,'most seeded mappings are consistent');assert(s.exceptions>0,'the seed has exceptions that need a person');
 assert(r0.exceptions.every(x=>x.reasons.length>0),'every exception says why');
 assert(r0.exceptions.some(x=>x.reasons.some(r=>r.code==='legacy')),'a legacy account is an exception');
 await assert.rejects(map('MANAGER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:[r0.groups[0].accounts[0].map_id]}),/Only a Partner/);
 const g=r0.groups[0],ids=g.accounts.map(a=>a.map_id);
 // an exception inside a group approval stops the whole approval and changes nothing
 const ex=r0.exceptions[0],draftBefore=(await tx`select count(*)::int n from erp_private.account_statement_map where status='Draft'`)[0].n;
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:[...ids,ex.map_id]}),/no longer in the consistent group/);
 assert.equal((await tx`select count(*)::int n from erp_private.account_statement_map where status='Draft'`)[0].n,draftBefore,'nothing was approved');
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:[]}),/at least one group/);
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:[ids[0],ids[0]]}),/more than once/);
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve'}),/group or one mapping/);
 // approve one group: the reviewer is recorded on every mapping
 const done=await map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:ids,review_note:'Fictional group review'});
 assert.equal(done.reviewed,ids.length);
 const rec=await tx`select status,reviewed_by,review_note from erp_private.account_statement_map where map_id=any($1::uuid[])`.catch(()=>null);
 const rows=(await db.query('select status,reviewed_by,review_note from erp_private.account_statement_map where map_id=any($1::uuid[])',[ids])).rows;
 assert(rows.every(r=>r.status==='Approved'&&r.reviewed_by===actors.PARTNER.staff_id&&r.review_note==='Fictional group review'),'approver and note on every item');
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:ids}),/no longer waiting/);
 // an exception needs a reason; one that is blocked cannot be approved at all
 const r1=await map('PARTNER',{action:'ledger_statement_map_review_read'});assert.equal(r1.summary.consistent,s.consistent-ids.length);
 const soft=r1.exceptions.find(x=>!x.blocked);assert(soft,'a non-blocking exception exists');
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'one',map_id:soft.map_id}),/Say why/);
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'one',map_id:soft.map_id,review_note:'short'}),/Say why/);
 const one=await map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'one',map_id:soft.map_id,review_note:'Fictional reason: legacy account kept on its line'});assert.equal(one.reviewed,1);
 const hard=r1.exceptions.find(x=>x.blocked);
 if(hard)await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'one',map_id:hard.map_id,review_note:'Fictional long reason here'}),/draft in the chart|more than one change/);
 // a proposal by the Partner cannot be group-approved by the same Partner (maker-checker still holds)
 const pick=(await tx`select m.account_code,m.line_code,l.statement from erp_private.account_statement_map m join erp_private.statement_lines l using(line_code) where m.status='Approved' and m.effective_to is null and l.statement in ('Profit or loss','Financial position') limit 1`)[0];
 const acct=pick.account_code;
 const otherLine=(await tx`select line_code from erp_private.statement_lines where statement=${pick.statement} and line_code<>${pick.line_code} limit 1`)[0].line_code;
 await map('PARTNER',{action:'ledger_statement_map_propose',account_code:acct,line_code:otherLine,effective_from:'2099-01-01',reason:'Fictional move for the test'});
 const r2=await map('PARTNER',{action:'ledger_statement_map_review_read'});
 const moved=r2.exceptions.find(x=>x.account_code===acct);assert(moved&&moved.reasons.some(r=>r.code==='replaces_open'),'a change to an approved account is an exception that says it replaces the open line');
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'one',map_id:moved.map_id,review_note:'Fictional reason of my own'}),/different than the person|other than the person who proposed/);
 const mv=await map('PARTNER2',{action:'ledger_statement_map_review_approve',scope:'one',map_id:moved.map_id,review_note:'Fictional second Partner approves'});assert.equal(mv.reviewed,1);

 // the replaced mapping was closed and the account still has exactly one open mapping
 const openFor=(await tx`select count(*)::int n from erp_private.account_statement_map where account_code=${acct} and status='Approved' and effective_to is null`)[0].n;assert.equal(openFor,1,'the account keeps one open mapping after a replacement');
 // one request approves every remaining consistent mapping, and a bad item in the same request changes nothing
 const r3=await map('PARTNER',{action:'ledger_statement_map_review_read'});
 const bulkIds=r3.groups.slice(0,-1).flatMap(x=>x.accounts.map(a=>a.map_id));assert(r3.groups.length>1&&bulkIds.length>150,'a large batch is available, and one group is left for the later approvals test ('+bulkIds.length+')');
 const draftBulk=(await tx`select count(*)::int n from erp_private.account_statement_map where status='Draft'`)[0].n;
 await assert.rejects(map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:[...bulkIds,ids[0]]}),/no longer waiting|no longer in the consistent group/);
 assert.equal((await tx`select count(*)::int n from erp_private.account_statement_map where status='Draft'`)[0].n,draftBulk,'a failed large batch changes nothing');
 const t0=Date.now();const bulk=await map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:bulkIds,review_note:'Fictional bulk review'});const took=Date.now()-t0;
 assert.equal(bulk.reviewed,bulkIds.length);assert(took<15000,'a large batch finishes in seconds, not minutes ('+took+' ms)');
 assert.equal((await tx`select count(*)::int n from erp_private.account_statement_map where map_id=any(${tx.array(bulkIds)}::uuid[]) and status='Approved' and reviewed_by=${actors.PARTNER.staff_id} and review_note='Fictional bulk review'`)[0].n,bulkIds.length,'every mapping carries the reviewer and note');
 assert.equal((await tx`select count(*)::int n from (select account_code from erp_private.account_statement_map where status='Approved' and effective_to is null group by 1 having count(*)>1) x`)[0].n,0,'no account has two open mappings');

 // ---- Owner Matrix ----
 await assert.rejects(own('SUPERVISOR',{action:'settings_owners_read'}),/Managers and Partners/);
 const m0=await own('MANAGER',{action:'settings_owners_read'});assert.equal(m0.can_confirm,false);assert.equal(m0.confirmed,0);assert.equal(m0.rows.length,21);
 assert(m0.rows.find(r=>r.key==='approve_tax_rates').suggested_role==='TAX_LEAD');assert.equal(m0.rows.find(r=>r.key==='svc_templates').suggested_role,null,'no owner is guessed for a register');
 await assert.rejects(own('MANAGER',{action:'settings_owners_confirm',items:[{section_key:'approve_chart',owner_role:'PARTNER'}]}),/A Partner confirms/);
 for(const bad of [[],[{section_key:'nope',owner_role:'PARTNER'}],[{section_key:'approve_chart',owner_role:'KING'}],[{section_key:'approve_chart',owner_role:'PARTNER'},{section_key:'approve_chart',owner_role:'MANAGER'}],[{section_key:'approve_chart',owner_role:'PARTNER',staff_id:id()}]])await assert.rejects(own('PARTNER',{action:'settings_owners_confirm',items:bad}));
 const c1=await own('PARTNER',{action:'settings_owners_confirm',items:[{section_key:'approve_chart',owner_role:'PARTNER'},{section_key:'approve_tax_rates',owner_role:'TAX_LEAD',staff_id:actors.MANAGER.staff_id,note:'Fictional note'}]});
 assert.deepEqual(c1,{confirmed:2,unchanged:0});
 assert.deepEqual(await own('PARTNER',{action:'settings_owners_confirm',items:[{section_key:'approve_chart',owner_role:'PARTNER'}]}),{confirmed:0,unchanged:1},'the same owner is not confirmed twice');
 await own('PARTNER2',{action:'settings_owners_confirm',items:[{section_key:'approve_chart',owner_role:'MANAGER'}]});
 const hist=await tx`select owner_role,ended_at is null open,confirmed_by by,ended_by ended from erp_private.settings_section_owners where section_key='approve_chart' order by confirmed_at`;
 assert.equal(hist.length,2);assert.equal(hist.filter(h=>h.open).length,1,'one confirmation is in force');assert.equal(hist.find(h=>!h.open).ended,actors.PARTNER2.staff_id,'who ended it is kept');assert.equal(hist.find(h=>!h.open).by,actors.PARTNER.staff_id);
 await assert.rejects(as('PARTNER',()=>db.query(`update erp_private.settings_section_owners set owner_role='HR' where ended_at is null`)),/never edited/);
 await assert.rejects(as('PARTNER',()=>db.query(`delete from erp_private.settings_section_owners`)),/./);
 const m1=await own('MANAGER',{action:'settings_owners_read'});assert.equal(m1.confirmed,2);assert.equal(m1.rows.find(r=>r.key==='approve_chart').confirmed.role,'MANAGER');
 assert.equal(m1.rows.find(r=>r.key==='approve_tax_rates').confirmed.staff_name,'Fictional MANAGER');
 const hub=await as('PARTNER',a=>settingsHubAction(tx,a,{action:'settings_hub_read'}));
 assert.equal(hub.owners_confirmed,2);assert.match(hub.note,/2 of 16 sections/);assert.equal(hub.sections.find(x=>x.key==='approve_chart').confirmed_owner.owner_label,'Manager');
 assert(hub.sections.every(x=>x.go),'every hub row has somewhere to open');

 // ---- My Approvals ----
 const before=(await tx`select count(*)::int n from erp_private.audit_events`)[0].n;
 const apP=await own('PARTNER',{action:'settings_approvals_read'}),apM=await own('MANAGER',{action:'settings_approvals_read'});
 assert.ok(Array.isArray(apP.renewals),'renewals are returned beside queues and records');assert.ok(apP.renewals.every(r=>typeof r.days==='number'&&typeof r.lapsed==='boolean'&&r.label),'each renewal says what ends and when');
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events`)[0].n,before,'reading writes nothing');
 const q=(ap,k)=>ap.queues.find(x=>x.key===k);
 assert(q(apP,'approve_statement_lines').count>0);assert.equal(q(apP,'approve_statement_lines').needs_my_action,true);assert.equal(q(apM,'approve_statement_lines').needs_my_action,false,'a Manager does not approve statement lines');
 assert.equal(q(apP,'approve_chart').owner_label,'Manager');assert.match(q(apP,'approve_tax_rates').owner_label,/Tax Lead/);
 assert(Array.isArray(apP.records)&&Array.isArray(apP.scopes)&&apP.roles.length===6);
 await assert.rejects(own('SUPERVISOR',{action:'settings_approvals_read'}),/Managers and Partners/);

 // ---- Actionable approval batches ----
 await account('MANAGER',{action:'accounting_account_add',code:'99976',name:'Fictional batch expense A',route:2,category_code:'EXP01',statement:'Profit or loss',notes:'Fictional test proposal A'});
 await account('MANAGER',{action:'accounting_account_add',code:'99977',name:'Fictional batch expense B',route:2,category_code:'EXP01',statement:'Profit or loss',notes:'Fictional test proposal B'});
 const chart=(await own('PARTNER',{action:'settings_approval_items_read',queue_keys:['approve_chart']})).groups[0];
 const first=chart.items.find(x=>x.id==='99976'),second=chart.items.find(x=>x.id==='99977');
 assert(first?.eligible&&second?.eligible,'another Partner may review the Manager proposals');
 await assert.rejects(own('MANAGER',{action:'settings_approval_batch_approve',review_confirmed:true,selections:[{queue_key:'approve_chart',items:[{id:first.id,revision:first.revision}]}]}),/Partner approval required/);
 await assert.rejects(own('PARTNER',{action:'settings_approval_batch_approve',review_confirmed:false,selections:[{queue_key:'approve_chart',items:[{id:first.id,revision:first.revision}]}]}),/Confirm that you reviewed/);
 await assert.rejects(own('PARTNER',{action:'settings_approval_batch_approve',review_confirmed:true,selections:[{queue_key:'approve_chart',items:[{id:first.id,revision:first.revision},{id:second.id,revision:999}]}]}),/This record changed\. Refresh before saving/);
 assert.equal((await tx`select count(*)::int n from erp_private.approval_batches`)[0].n,0,'failed batches leave no audit record');
 assert.equal((await tx`select count(*)::int n from erp_private.account_catalog where code in ('99976','99977') and status='Draft'`)[0].n,2,'a stale item rolls back the earlier item in the same batch');
 const chartSelection=[{queue_key:'approve_chart',items:[{id:first.id,revision:first.revision}]}];
 const preview=await own('PARTNER',{action:'settings_approval_batch_approve',preview_only:true,selections:chartSelection});
 assert.match(preview.review_version,/^[a-f0-9]{64}$/);
 assert.equal(preview.groups[0].items[0].code,first.id);
 assert.equal((await tx`select count(*)::int n from erp_private.approval_batches`)[0].n,0,'preview changes nothing');
 await assert.rejects(own('PARTNER',{action:'settings_approval_batch_approve',review_confirmed:true,review_version:'wrong',selections:chartSelection}),/details changed/);
 const chartDone=await own('PARTNER',{action:'settings_approval_batch_approve',review_confirmed:true,review_version:preview.review_version,selections:chartSelection});
 assert.equal(chartDone.approved_by,'Fictional PARTNER');
 assert(chartDone.approved_at);
 assert.equal(chartDone.groups[0].items[0].code,first.id);
 assert.equal(chartDone.total,1);
 const approved=(await tx`select status,approved_by,approved_at from erp_private.account_catalog where code='99976'`)[0];
 assert.equal(approved.status,'Active');assert.equal(approved.approved_by,actors.PARTNER.staff_id);assert(approved.approved_at);

 await account('PARTNER',{action:'accounting_account_add',code:'99978',name:'Fictional self-check expense',route:2,category_code:'EXP01',statement:'Profit or loss',notes:'Fictional self-check proposal'});
 const ownProposal=(await own('PARTNER',{action:'settings_approval_items_read',queue_keys:['approve_chart']})).groups[0].items.find(x=>x.id==='99978');
 assert(ownProposal);
 await assert.rejects(own('PARTNER',{action:'settings_approval_batch_approve',review_confirmed:true,selections:[{queue_key:'approve_chart',items:[{id:ownProposal.id,revision:ownProposal.revision}]}]}),/cannot approve it/);
 const otherPartner=await own('PARTNER2',{action:'settings_approval_batch_approve',review_confirmed:true,selections:[{queue_key:'approve_chart',items:[{id:ownProposal.id,revision:ownProposal.revision}]}]});
 assert.equal(otherPartner.total,1,'a different Partner can approve the proposal');

 const mapGroup=(await own('PARTNER',{action:'settings_approval_items_read',queue_keys:['approve_statement_lines']})).groups[0];
 const mapItem=mapGroup.items.flatMap(g=>g.items).find(x=>x.eligible);
 assert(mapItem,'a consistent statement-line item is available for the grouped path');
 const selection=[{queue_key:'approve_statement_lines',items:[{id:mapItem.id,revision:mapItem.revision}]}];
 const mappingPreview=await own('PARTNER',{action:'settings_approval_batch_approve',preview_only:true,selections:selection});
 assert(mappingPreview.groups[0].items[0].statement_line);
 await assert.rejects(own('PARTNER',{action:'settings_approval_batch_approve',preview_only:true,selections:[{queue_key:'approve_statement_lines',items:[{id:mapItem.id,revision:0}]}]}),/changed after you opened/);
 const mapDone=await own('PARTNER',{action:'settings_approval_batch_approve',review_confirmed:true,review_version:mappingPreview.review_version,selections:selection});
 assert.equal(mapDone.total,1);
 assert.equal((await tx`select count(*)::int n from erp_private.approval_batches`)[0].n,3,'each successful typed group has one batch audit row');
 assert.equal((await tx`select count(*)::int n from erp_private.approval_batches where review_confirmed`)[0].n,3,'all successful batches retain the reviewer confirmation');

 // Adopt existing starter records, preserving their contents and the distinct approval step.
 const rate=(await tx`insert into erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note)
  values('KE_VAT_SAMPLE_APPROVAL','VAT','Sample VAT rule','2026-01-01','2026-12-31','{"rate":16,"treatment":"Standard"}',
         'https://new.kenyalaw.org/akn/ke/act/2013/35','Value Added Tax Act, 2013, section 5.') returning rate_id,revision`)[0];
 const chartSeed=(await tx`insert into erp_private.account_catalog(code,name,route,category_code,statement,account_group,catalog_version,status,tax_note)
  values('99974','Sample starter account',2,'EXP01','Profit or loss','Custom account','CUSTOM-2026','Draft','Sample notes for proposal') returning revision`)[0];
 const mapSeed=(await tx`insert into erp_private.account_statement_map(account_code,line_code,effective_from,reason)
  values('99974','PL.OTHER_OPEX','2026-01-01','Sample statement line') returning map_id`)[0];
 const starter=(role,p)=>as(role,a=>settingsStarterProposalAction(tx,a,p));
 const list=await starter('MANAGER',{action:'settings_starter_proposals_read'});
 const items=[{type:'tax_rate',id:rate.rate_id,revision:rate.revision},
  {type:'chart_account',id:'99974',revision:chartSeed.revision},{type:'statement_map',id:mapSeed.map_id}];
 for(const item of items)assert(list.groups.find(g=>g.type===item.type).items.some(row=>row.id===item.id));
 const proposal={action:'settings_starter_propose',review_confirmed:true,items};
 await assert.rejects(starter('SUPERVISOR',proposal),/Manager or Partner/);
 await assert.rejects(starter('MANAGER',{...proposal,review_confirmed:false}),/Confirm that you reviewed/);
 await assert.rejects(starter('MANAGER',{...proposal,items:[items[0],{...items[1],revision:999}]}),/selected draft changed/);
 assert.equal((await tx`select created_by from erp_private.tax_rates where rate_id=${rate.rate_id}`)[0].created_by,null);
 await assert.rejects(as('MANAGER',()=>tx`update erp_private.account_statement_map set proposed_by=${actors.MANAGER.staff_id},proposed_at=now(),reason='Changed mapping' where map_id=${mapSeed.map_id}`),/cannot be edited/);
 assert.deepEqual(await starter('MANAGER',proposal),{proposed:3});
 await assert.rejects(starter('PARTNER',proposal),/selected draft changed/);
 const taxAfter=(await tx`select created_by,status,source_note,revision from erp_private.tax_rates where rate_id=${rate.rate_id}`)[0];
 assert.equal(taxAfter.created_by,actors.MANAGER.staff_id);
 assert.equal(taxAfter.status,'Draft');
 assert.equal(taxAfter.source_note,'Value Added Tax Act, 2013, section 5.');
 const accountAfter=(await tx`select proposed_by,status,revision from erp_private.account_catalog where code='99974'`)[0];
 assert.equal(accountAfter.proposed_by,actors.MANAGER.staff_id);
 assert.equal(accountAfter.status,'Draft');
 assert.equal((await tx`select proposed_by from erp_private.account_statement_map where map_id=${mapSeed.map_id}`)[0].proposed_by,actors.MANAGER.staff_id);
 const proposalAudit=await tx`select table_name from erp_private.audit_events where actor_auth_id=${actors.MANAGER.auth_user_id}
  and action='UPDATE' and record_key in (${rate.rate_id},'99974',${mapSeed.map_id}) order by table_name`;
 assert.deepEqual(proposalAudit.map(row=>row.table_name),['account_catalog','account_statement_map','tax_rates']);
 const result=await own('PARTNER',{action:'settings_approval_batch_approve',review_confirmed:true,selections:[
  {queue_key:'approve_chart',items:[{id:'99974',revision:accountAfter.revision}]},
  {queue_key:'approve_tax_rates',items:[{id:rate.rate_id,revision:taxAfter.revision}]}]});
 assert.equal(result.total,2);
 await map('PARTNER',{action:'ledger_statement_map_review_approve',scope:'group',map_ids:[mapSeed.map_id]});
 assert.equal((await tx`select reviewed_by from erp_private.account_statement_map where map_id=${mapSeed.map_id}`)[0].reviewed_by,actors.PARTNER.staff_id);
});
test('reviewing mappings uses a fixed number of queries however many are selected',()=>{
 const src=fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/annual-pack.ts','utf8');
 const start=src.indexOf('async function decideMaps('),end=src.indexOf('\nasync function',start+10);
 const body=src.slice(start,end<0?undefined:end);assert(start>=0&&body.length>100,'decideMaps found');
 assert(((body.match(/await tx`/g)||[]).length)<=6,'a handful of set-based queries');
 assert.doesNotMatch(body,/for\s*\([^)]*\)\s*\{[^}]*await tx`/,'no query inside a loop');
 assert.doesNotMatch(body,/\.map\(\s*async/,'no per-item async work');
});
