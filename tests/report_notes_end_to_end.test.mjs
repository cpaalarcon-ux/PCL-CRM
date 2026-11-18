import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {isoWeek,profitByActivity,profitReport}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,p,{download:async()=>({data:null})}));
const {registerPack}=await import('../supabase/functions/staff-workspace-v12/report-notes-actions.ts');
const ExcelJS=(await import('exceljs')).default;

test('report notes are versioned and signed off with the report, internal notes never print, and every produced pack is registered, signed and filed by a named person',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'RNQA','Fictional activity firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional activity client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional activity project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 const W=id(),R=id();
 await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id}),(${R},${C},'retail',false,'Retail','Retail trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;

 await assert.rejects(()=>ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2024-01-01',ends_on:'2024-12-31'}),/periods ending 31 December 2025 onwards/);
 const period=await ledger('MANAGER',{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'}),base={project_id:P,period_id:period.period_id}; const jr=async jid=>ledger('ASSISTANT',{...base,action:'ledger_journal_read',journal_id:jid});
 const post=async jid=>{let x=await jr(jid);await ledger('ASSISTANT',{...base,action:'ledger_journal_submit',journal_id:jid,revision:x.journal.revision});await checkJournal(tx,jid);x=await jr(jid);await ledger('MANAGER',{...base,action:'ledger_journal_review',journal_id:jid,revision:x.journal.revision,status:'Posted',review_note:'Fictional independent review.'});};
 const line=(code,debit,credit,activity_id)=>({account_code:code,debit,credit,activity_id,source_status:'Confirmed',source_reference:'Fictional source'});
 const opening=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Opening',reference:'OPEN-2026',journal_date:'2026-01-01',evidence:'Fictional approved TB',lines:[line('10000',1000,0),line('30000',0,1000)]});await post(opening.journal_id);
 const sales=await ledger('ASSISTANT',{...base,action:'ledger_journal_save',kind:'Adjustment',reference:'SALES-JAN',journal_date:'2026-01-31',evidence:'Fictional sales schedules',lines:[line('10000',900,0),line('40000',0,600,W),line('40000',0,250,R),line('40000',0,50,null)]});await post(sales.journal_id);
 const notes=(role,p)=>ledger(role,{...base,report_kind:'Month',as_of:'2026-01-31',...p});
 const rd=role=>notes(role,{action:'ledger_report_notes_read'}),sv=(role,p)=>notes(role,{action:'ledger_report_notes_save',client_highlights:'',information_required:'',internal_notes:'',...p});
 const allText=async b64=>{const wb=new ExcelJS.Workbook();await wb.xlsx.load(Buffer.from(b64,'base64'));const out=[];for(const ws of wb.worksheets)ws.eachRow(r=>r.eachCell(c=>out.push(String(c.value??''))));return {text:out.join('\n'),sheets:wb.worksheets.map(w=>w.name),wb};};
 const HL='January sales grew by 20 percent on the fictional wholesale line.',INFO='Please send the fictional bank statement for 31 January.',INT='Client is slow to reply; chase the director by phone first.';

 // ----- who may read and write, and what is refused
 let r=await rd('ASSISTANT');assert.equal(r.current,null);assert.equal(r.can_edit,true);assert.deepEqual(r.printed_as,{client_highlights:'None',information_required:'None'},'a blank client note prints as None');assert.equal(r.fields.length,3);
 await assert.rejects(()=>rd('INTERN'),/Interns can access assigned tasks/);await assert.rejects(()=>sv('INTERN',{client_highlights:HL}),/Interns can access assigned tasks/);
 await assert.rejects(()=>notes('ASSISTANT',{action:'ledger_report_notes_read',as_of:'2027-01-31'}),/inside this financial year/);await assert.rejects(()=>notes('ASSISTANT',{action:'ledger_report_notes_read',report_kind:'Week'}),/./);
 await assert.rejects(()=>sv('ASSISTANT',{client_highlights:'x'.repeat(3001)}),/keep it to 3000 characters/);
 await assert.rejects(()=>sv('ASSISTANT',{}),/Nothing has changed/,'saving nothing over nothing is refused');

 // ----- versions: every save is a new version and the old ones stay
 let s=await sv('ASSISTANT',{client_highlights:HL,information_required:INFO,internal_notes:INT});assert.equal(s.version,1);assert.equal(s.client_notes_changed,true);assert.equal(s.needs_review,false);
 r=await rd('MANAGER');assert.equal(r.current.version,1);assert.equal(r.current.client_highlights,HL);assert.equal(r.current.internal_notes,INT);assert.deepEqual(r.printed_as,{client_highlights:HL,information_required:INFO},'only the two client notes are printed');assert.ok(!JSON.stringify(r.printed_as).includes('chase'));
 await assert.rejects(()=>sv('ASSISTANT',{client_highlights:HL,information_required:INFO,internal_notes:INT}),/Nothing has changed/);
 s=await sv('ASSISTANT',{client_highlights:HL,information_required:INFO,internal_notes:INT+' Second call tomorrow.'});assert.equal(s.version,2);assert.equal(s.client_notes_changed,false,'an internal-only change is not a client change');
 assert.equal((await rd('MANAGER')).history.length,2);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.ledger_report_notes set client_highlights='changed' where period_id=${period.period_id}`),/cannot be edited|permission denied/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.ledger_report_notes where period_id=${period.period_id}`),/./);
 assert.equal(Number((await tx`select count(*) n from erp_private.ledger_report_notes`)[0].n),2,'both versions are kept');
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.ledger_report_notes(period_id,project_id,client_id,report_kind,as_of,version,saved_by) values(${period.period_id},${P},${C},'Month','2026-01-31',9,${actors.ASSISTANT.staff_id})`),/version number is out of date/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.ledger_report_notes(period_id,project_id,client_id,report_kind,as_of,version,saved_by) values(${period.period_id},${P},${C},'Month','2027-01-31',1,${actors.ASSISTANT.staff_id})`),/inside the financial year/);

 // ----- the client notes are part of what the reviewer signs off; the internal notes are not
 await ledger('ASSISTANT',{...base,action:'ledger_report_submit',report_kind:'Month',as_of:'2026-01-31',prepared_note:'January report with its client notes.'});
 let rv=(await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'})).report_reviews[0];
 const snap=(await tx`select snapshot from erp_private.ledger_report_reviews where review_id=${rv.review_id}`)[0].snapshot;assert.equal(snap.notes.client_highlights,HL);assert.equal(snap.notes.information_required,INFO);assert.ok(!JSON.stringify(snap).includes('chase the director'),'the internal notes are never in the snapshot');
 await ledger('MANAGER',{...base,action:'ledger_report_review',review_id:rv.review_id,revision:rv.revision,status:'Approved',review_note:'Checked to the January schedules.'});
 const signedOff=async()=>(await ledger('ASSISTANT',{...base,action:'ledger_report_gate',report_kind:'Month',as_of:'2026-01-31'})).gate.checks.find(c=>c.code==='SIGN_OFF');
 assert.equal((await signedOff()).ok,true);
 s=await sv('ASSISTANT',{client_highlights:HL,information_required:INFO,internal_notes:'Only the internal note changed again.'});assert.equal(s.version,3);assert.equal(s.needs_review,false);assert.equal((await signedOff()).ok,true,'changing the internal notes keeps the sign-off');
 s=await sv('ASSISTANT',{client_highlights:HL+' Margins improved.',information_required:INFO,internal_notes:'x'});assert.equal(s.version,4);assert.equal(s.client_notes_changed,true);assert.equal(s.needs_review,true,'the screen is told the report needs review again');
 const so=await signedOff();assert.equal(so.ok,false);assert.match(so.detail,/changed after sign-off/);
 s=await sv('ASSISTANT',{client_highlights:HL,information_required:INFO,internal_notes:'x'});assert.equal(s.version,5);assert.equal((await signedOff()).ok,true,'putting the client notes back restores the same fingerprint, so the sign-off holds again');
 // an approval attempted on changed notes is refused
 await ledger('ASSISTANT',{...base,action:'ledger_report_submit',report_kind:'Quarter',as_of:'2026-03-31',prepared_note:'First quarter with its notes.'});
 const rq=(await ledger('ASSISTANT',{...base,action:'ledger_read',as_of:'2026-12-31'})).report_reviews.find(x=>x.report_kind==='Quarter');
 await ledger('ASSISTANT',{...base,action:'ledger_report_notes_save',report_kind:'Quarter',as_of:'2026-03-31',client_highlights:'Added after the report was sent.',information_required:'',internal_notes:''});
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_review',review_id:rq.review_id,revision:rq.revision,status:'Approved',review_note:'Trying to approve changed notes.'}),/client notes changed after this report was submitted/);

 // ----- the file carries the two client notes and never the internal ones
 const draft=await ledger('ASSISTANT',{...base,action:'ledger_report_export',report_kind:'Month',as_of:'2026-01-31'});assert.equal(draft.mark,'DRAFT');
 let w=await allText(draft.base64);assert.ok(w.sheets.includes('Notes'));assert.ok(w.text.includes(HL));assert.ok(w.text.includes(INFO));assert.ok(!w.text.includes('Only the internal note changed')&&!w.text.includes('chase the director')&&!w.text.includes('Second call tomorrow'),'internal notes are in no sheet');
 const ytd=await ledger('ASSISTANT',{...base,action:'ledger_report_export',report_kind:'Year to date',as_of:'2026-12-31'});w=await allText(ytd.base64);
 const nsheet=w.wb.getWorksheet('Notes'),cells=[];nsheet.eachRow(r=>r.eachCell(c=>cells.push(String(c.value))));assert.equal(cells.filter(x=>x==='None').length,2,'a report with no notes prints None twice');
 for(const ws of w.wb.worksheets)assert.match(String(ws.getRow(1).getCell(1).value),/^DRAFT/,ws.name);

 // ----- the register
 const reg=()=>ledger('ASSISTANT',{...base,action:'ledger_report_packs_read'});
 let g=await reg();assert.equal(g.items.length,2);assert.deepEqual(g.items.map(x=>[x.pack_kind,x.report_kind,x.status,x.is_final]).sort(),[['Monthly filing pack','Month','Draft',false],['Point-in-time status','Year to date','Draft',false]]);
 await ledger('ASSISTANT',{...base,action:'ledger_report_export',report_kind:'Month',as_of:'2026-01-31'});assert.equal((await reg()).items.length,2,'the same content is registered once');
 const monthDraft=g.items.find(x=>x.report_kind==='Month');
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_pack_sign',pack_id:monthDraft.pack_id}),/draft pack cannot be signed/);
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_report_pack_file',pack_id:monthDraft.pack_id,filed_on:'2026-02-05',reference:'Portal acknowledgement 1'}),/draft pack cannot be filed/);
 await assert.rejects(()=>as('MANAGER',()=>tx`insert into erp_private.ledger_report_pack_events(pack_id,project_id,event,actor_id) values(${monthDraft.pack_id},${P},'Signed',${actors.MANAGER.staff_id})`),/draft pack cannot be signed/,'the database refuses too');
 await assert.rejects(()=>ledger('INTERN',{...base,action:'ledger_report_packs_read'}),/Interns can access assigned tasks/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.ledger_report_packs set file_name='x.xlsx' where pack_id=${monthDraft.pack_id}`),/./);
 await assert.rejects(()=>as('MANAGER',()=>tx`insert into erp_private.ledger_report_packs(period_id,project_id,client_id,pack_kind,report_kind,as_of,file_format,file_name,status_word,fingerprint,is_final,generated_by) values(${period.period_id},${P},${C},'Annual filing pack','Month','2026-12-31','pdf','a.pdf','Draft',${'a'.repeat(64)},false,${actors.MANAGER.staff_id})`),/violates check constraint/);

 // ----- a final pack signed through its approved report review, then filed
 const L=(await tx`select * from erp_private.ledger_periods where period_id=${period.period_id}`)[0],review=(await tx`select * from erp_private.ledger_report_reviews where review_id=${rv.review_id}`)[0];
 const fpMonth=monthDraft.fingerprint,fin=(role,over={})=>as(role,a=>registerPack(tx,a,L,{pack_kind:'Monthly filing pack',report_kind:'Month',as_of:'2026-01-31',file_format:'xlsx',file_name:'Fictional_Month_2026-01-31.xlsx',status_word:'FINAL',fingerprint:fpMonth,is_final:true,review,...over}));
 assert.equal(fpMonth,review.snapshot_digest,'the report fingerprint is the digest the reviewer approved');
 const packId=await fin('ASSISTANT');assert.ok(packId);g=await reg();let item=g.items.find(x=>x.pack_id===packId);assert.equal(item.status,'Signed');assert.equal(item.signed_via,'report review');assert.ok(item.signed_name,'the reviewer is named');
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.ledger_report_packs(period_id,project_id,client_id,pack_kind,report_kind,as_of,file_format,file_name,status_word,fingerprint,is_final,review_id,generated_by) values(${period.period_id},${P},${C},'Monthly filing pack','Month','2026-01-31','xlsx','Wrong.xlsx','FINAL',${'b'.repeat(64)},true,${review.review_id},${actors.ASSISTANT.staff_id})`),/not an approved review of exactly these figures/);
 await as('ASSISTANT',async()=>assert.equal(await registerPack(tx,actors.ASSISTANT,L,{pack_kind:'Monthly filing pack',report_kind:'Month',as_of:'2026-01-31',file_format:'xlsx',file_name:'Other.xlsx',status_word:'FINAL',fingerprint:'c'.repeat(64),is_final:true,review}).then(x=>!!x),true),'a review of other figures never signs a pack: it is registered unsigned');
 assert.equal((await tx`select review_id from erp_private.ledger_report_packs where fingerprint=${'c'.repeat(64)}`)[0].review_id,null);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_pack_sign',pack_id:packId}),/signed already|signed off already|already/);
 const file=(role,p)=>ledger(role,{...base,action:'ledger_report_pack_file',pack_id:packId,filed_on:'2026-02-05',reference:'Emailed to the director, Fictional Co.',...p});
 await assert.rejects(()=>file('ASSISTANT',{filed_on:'2099-01-01'}),/cannot be in the future/);await assert.rejects(()=>file('ASSISTANT',{filed_on:'2026-01-30'}),/before the date it reports on/);await assert.rejects(()=>file('ASSISTANT',{reference:'ab'}),/at least 3 characters/);await assert.rejects(()=>file('INTERN',{}),/Interns can access assigned tasks/);
 assert.equal((await file('ASSISTANT',{})).status,'Filed');item=(await reg()).items.find(x=>x.pack_id===packId);assert.equal(item.status,'Filed');assert.equal(item.filed_on,'2026-02-05');assert.match(item.filed_reference,/Emailed to the director/);assert.ok(item.filed_name);
 await assert.rejects(()=>file('ASSISTANT',{}),/filed already/);

 // ----- a pack with no sign-off yet: maker is not checker, the sole Partner exception is recorded, and a changed report cannot be filed
 const fpOf=async(kind,asOf)=>{await ledger('ASSISTANT',{...base,action:'ledger_report_export',report_kind:kind,as_of:asOf});return (await reg()).items.find(x=>x.report_kind===kind&&x.as_of===asOf&&!x.is_final).fingerprint;};
 const fpQ=await fpOf('Quarter','2026-03-31'),gen=(role,fp,over={})=>as(role,a=>registerPack(tx,a,L,{pack_kind:'Point-in-time status',report_kind:'Quarter',as_of:'2026-03-31',file_format:'xlsx',file_name:'Fictional_Quarter_2026-03-31.xlsx',status_word:'FINAL',fingerprint:fp,is_final:true,...over}));
 const q1=await gen('ASSISTANT',fpQ);item=(await reg()).items.find(x=>x.pack_id===q1);assert.equal(item.status,'Generated');
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_report_pack_sign',pack_id:q1}),/Manager or Partner signs the pack/);
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_pack_file',pack_id:q1,filed_on:'2026-04-05',reference:'Emailed to the director'}),/Sign the pack first/);
 // changed after generation: the client notes of the quarter change, so the pack no longer matches
 await ledger('ASSISTANT',{...base,action:'ledger_report_notes_save',report_kind:'Quarter',as_of:'2026-03-31',client_highlights:'Changed again after the pack was generated.',information_required:'',internal_notes:''});
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_pack_sign',pack_id:q1}),/changed after this pack was generated/);
 const fpQ2=await fpOf('Quarter','2026-03-31');assert.notEqual(fpQ2,fpQ);const q2=await gen('ASSISTANT',fpQ2);
 const sg=await ledger('MANAGER',{...base,action:'ledger_report_pack_sign',pack_id:q2});assert.equal(sg.status,'Signed');item=(await reg()).items.find(x=>x.pack_id===q2);assert.equal(item.status,'Signed');assert.equal(item.signed_via,'recorded sign-off');assert.equal(item.signed_name,(await tx`select full_name from erp_private.staff_members where staff_id=${actors.MANAGER.staff_id}`)[0].full_name,'the signer is the signed-in Manager');assert.equal(item.generated_name,(await tx`select full_name from erp_private.staff_members where staff_id=${actors.ASSISTANT.staff_id}`)[0].full_name,'the person who generated it is named, even when not a Manager');
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_pack_sign',pack_id:q2}),/signed already/);
 // a Manager cannot sign what they generated; the only Partner can, and only by saying so
 
 const fpM=await fpOf('Month','2026-02-28'),mm=await gen('MANAGER',fpM,{pack_kind:'Monthly filing pack',report_kind:'Month',as_of:'2026-02-28',file_name:'Fictional_Month_2026-02-28.xlsx'});
 await assert.rejects(()=>ledger('MANAGER',{...base,action:'ledger_report_pack_sign',pack_id:mm}),/Someone else signs a pack you generated/);
 const fpP=await fpOf('Month','2026-03-31'),pp=await gen('PARTNER',fpP,{pack_kind:'Monthly filing pack',report_kind:'Month',as_of:'2026-03-31',file_name:'Fictional_Month_2026-03-31.xlsx'});
 await assert.rejects(()=>ledger('PARTNER',{...base,action:'ledger_report_pack_sign',pack_id:pp}),/only Partner/);
 const ps=await ledger('PARTNER',{...base,action:'ledger_report_pack_sign',pack_id:pp,sole_partner_approval:true});assert.equal(ps.sole_partner_approval,true);item=(await reg()).items.find(x=>x.pack_id===pp);assert.equal(item.sole_partner_approval,true);
 // filing a signed pack whose report changed since is refused
 await ledger('ASSISTANT',{...base,action:'ledger_report_notes_save',report_kind:'Quarter',as_of:'2026-03-31',client_highlights:'A late change to the quarter notes.',information_required:'',internal_notes:''});
 await assert.rejects(()=>ledger('ASSISTANT',{...base,action:'ledger_report_pack_file',pack_id:q2,filed_on:'2026-04-05',reference:'Emailed to the director'}),/changed after this pack was generated/);
 // filed and signed events are kept and never edited
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.ledger_report_pack_events set reference='changed ref' where pack_id=${packId}`),/./);await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.ledger_report_pack_events where pack_id=${packId}`),/./);
 // the register is a record: nothing was posted and no figure moved
 assert.equal(Number((await tx`select count(*) n from erp_private.ledger_journals where status='Posted'`)[0].n),2);
 s=await ledger('ASSISTANT',{...base,action:'ledger_report_packs_read'});assert.deepEqual(s.summary,{total:s.items.length,Draft:s.items.filter(x=>x.status==='Draft').length,Generated:s.items.filter(x=>x.status==='Generated').length,Signed:s.items.filter(x=>x.status==='Signed').length,Filed:1});
});
