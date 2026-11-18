import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const Pg=await import('../supabase/functions/staff-workspace-v12/support-schedules-actions.ts');const S=await import('../supabase/functions/staff-workspace-v12/annual-pack-schedules.mjs');

const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

let per;
// What the statements engine would hand over: the notes of the year with their accounts, and the approved schedule (if any) tied to them.
const NOTES=[
 {number:1,ref:'INV',title:'Inventories',kind:'STOCK',accounts:[{code:'10100',name:'Stock',cents:25000000}]},
 {number:2,ref:'REC',title:'Receivables and prepayments',kind:'RECEIVABLES',accounts:[{code:'10060',name:'Trade receivables',cents:32000000},{code:'10070',name:'Allowance',cents:-2000000}]},
 {number:3,ref:'PAY',title:'Trade and other payables',kind:'PAYABLES',accounts:[{code:'20000',name:'Trade payables',cents:13000000}]},
 {number:4,ref:'TAX',title:'Taxation',kind:'TAX',accounts:[{code:'80000',name:'Income tax',cents:0}]}
];
const get=async()=>{
 const sch=await Pg.schedulesFor(tx,per);
 const items=NOTES.map(n=>({number:n.number,ref:n.ref,title:n.title,support_basis:{kind:n.kind,accounts:n.accounts.map(a=>({...a,amount:a.cents/100}))},support:sch.forNotes[n.kind]?S.buildSupport({kind:n.kind,schedule:sch.forNotes[n.kind],basis:n.accounts}):null}));
 return {statements:{notes:{items}},client:{name:'Fictional Mlima Traders',legal_form:'Company'},reporting:{},as_of:'2026-12-31'};
};
const act=(role,p)=>as(role,a=>Pg.schedulesAction(tx,a,per,p,get,'2026-12-31'));
const ln=(category,description,account,amount,reference='')=>({category,description,account,amount,reference});
const EV='Fictional count sheet signed at the year end';

test('supporting schedules: declared, approved by someone else, tied to the figures, frozen by an audit lock, and held by the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const p2=actors.PARTNER2={staff_id:id(),auth_user_id:id(),session:id(),category_code:'PARTNER'};await tx`insert into auth.users(id) values(${p2.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${p2.session},${p2.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${p2.staff_id},${p2.auth_user_id},'PARTNER2','partner2','Fictional PARTNER2','PARTNER','Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${p2.session},${p2.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${p2.staff_id},${F},'Assigned')`;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${CL},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role==='PARTNER2'?'PARTNER':role})`;
 per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 // ----- nothing declared: every note with a balance needs a schedule, and a note with no balance does not
 let r=await act('ASSISTANT',{action:'ledger_schedules_read'});
 assert.deepEqual(r.kinds.filter(k=>k.has_note).map(k=>k.kind),['STOCK','RECEIVABLES','PAYABLES','TAX']);assert.equal(r.kinds.find(k=>k.kind==='LOANS').has_note,false,'a year with no borrowings note shows no schedule for it');
 assert.deepEqual(r.kinds.filter(k=>k.relevant).map(k=>k.kind),['STOCK','RECEIVABLES','PAYABLES']);assert.equal(r.ok,false);assert.match(r.problems.join(' '),/Inventories \(note 1\): no supporting schedule/);
 assert.deepEqual(r.kinds.find(k=>k.kind==='RECEIVABLES').accounts.map(a=>[a.code,a.amount]),[['10060',320000],['10070',-20000]]);
 // ----- declaring
 const D=(role,kind,lines,over={})=>act(role,{action:'ledger_schedule_declare',kind,evidence:EV,lines,...over});
 await assert.rejects(()=>D('ASSISTANT','STOCK',[ln('Goods for resale','Hardware','10100',250000)],{evidence:'short'}),/what supports/);
 await assert.rejects(()=>D('ASSISTANT','STOCK',[ln('Goods for resale','Hardware','20000',250000)]),/not one this note holds/);
 await assert.rejects(()=>D('ASSISTANT','LOANS',[ln('Bank loan','Loan','10100',1)]),/no note for that schedule/);
 await assert.rejects(()=>D('ASSISTANT','NOPE',[]),/./);
 await assert.rejects(()=>as('ASSISTANT',()=>Pg.schedulesAction(tx,{category_code:'INTERN'},per,{action:'ledger_schedules_read'},get,'2026-12-31')),/staff who prepare/);
 const s1=await D('ASSISTANT','STOCK',[ln('Goods for resale','Hardware','10100',240000),ln('Goods for resale','Tools','10100',9000)]);assert.equal(s1.version,1);assert.equal(s1.status,'Draft');
 r=await act('MANAGER',{action:'ledger_schedules_read'});let st=r.kinds.find(k=>k.kind==='STOCK');assert.equal(st.state,'Waiting for approval');assert.equal(st.can_review,true);assert.equal(st.approved,null);assert.match(r.problems.join(' '),/Inventories \(note 1\): the schedule waits for approval/);
 assert.equal(st.tie,null,'a draft is not printed and not tied');
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_schedule_review',schedule_id:s1.schedule_id,decision:'Approved'}),/Manager or Partner/);
 await assert.rejects(()=>act('MANAGER',{action:'ledger_schedule_review',schedule_id:s1.schedule_id,decision:'Returned',review_note:'no'}),/at least 10/);
 assert.equal((await act('MANAGER',{action:'ledger_schedule_review',schedule_id:s1.schedule_id,decision:'Returned',review_note:'Fictional: the count sheet total is 250,000.'})).status,'Returned');
 r=await act('ASSISTANT',{action:'ledger_schedules_read'});assert.equal(r.kinds.find(k=>k.kind==='STOCK').state,'Returned');assert.match(r.problems.join(' '),/returned/);
 const s2=await D('ASSISTANT','STOCK',[ln('Goods for resale','Hardware','10100',241000),ln('Goods for resale','Tools','10100',9000)]);assert.equal(s2.version,2);
 // the approval gives the schedule to the notes, and it is $250,000 against 250,000 in the ledger
 assert.equal((await act('MANAGER',{action:'ledger_schedule_review',schedule_id:s2.schedule_id,decision:'Approved'})).sole_partner_approval,false);
 r=await act('ASSISTANT',{action:'ledger_schedules_read'});st=r.kinds.find(k=>k.kind==='STOCK');assert.equal(st.state,'Approved');assert.equal(st.tie.ties,true);assert.equal(st.approved.lines.length,2);assert.equal(st.approved.reviewed_name!==null,true);
 // the same schedule cannot be declared again; a changed one replaces it only when approved
 await assert.rejects(()=>D('ASSISTANT','STOCK',[ln('Goods for resale','Hardware','10100',241000),ln('Goods for resale','Tools','10100',9000)]),/already approved/);
 await assert.rejects(()=>act('MANAGER',{action:'ledger_schedule_review',schedule_id:s1.schedule_id,decision:'Approved'}),/has changed/,'a replaced schedule cannot be reviewed');
 // ----- a difference to the trial balance is shown, never absorbed, and it blocks the readiness
 const rec=await D('ASSISTANT','RECEIVABLES',[ln('Trade receivables','Customers at year end','10060',310000,'Debtors listing'),ln('Allowance for expected credit losses','Allowance','10070',-20000)]);
 await act('MANAGER',{action:'ledger_schedule_review',schedule_id:rec.schedule_id,decision:'Approved'});
 r=await act('MANAGER',{action:'ledger_schedules_read'});const rk=r.kinds.find(k=>k.kind==='RECEIVABLES');assert.equal(rk.tie.ties,false);assert.equal(rk.tie.rows.find(x=>x.account==='10060').difference,-10000);assert.match(r.problems.join(' '),/account 10060 Trade receivables is 310,000\.00 on the schedule and 320,000\.00/);
 // ----- a declarer does not approve their own work; a Partner may only when the firm has no other Partner
 const pay=await act('MANAGER',{action:'ledger_schedule_declare',kind:'PAYABLES',evidence:EV,lines:[ln('Trade payables','Suppliers','20000',130000)]});
 await assert.rejects(()=>act('MANAGER',{action:'ledger_schedule_review',schedule_id:pay.schedule_id,decision:'Approved'}),/Someone else approves/);
 const payP=await act('PARTNER',{action:'ledger_schedule_declare',kind:'PAYABLES',evidence:EV,lines:[ln('Trade payables','Suppliers','20000',130000)]});assert.equal(payP.version,2);
 await assert.rejects(()=>act('PARTNER',{action:'ledger_schedule_review',schedule_id:payP.schedule_id,decision:'Approved'}),/Someone else approves/);
 await assert.rejects(()=>act('PARTNER',{action:'ledger_schedule_review',schedule_id:payP.schedule_id,decision:'Approved',sole_partner_approval:true}),/only Partner|sole Partner/);
 assert.equal((await act('MANAGER',{action:'ledger_schedule_review',schedule_id:payP.schedule_id,decision:'Approved'})).status,'Approved');
 // fixing the receivables replaces the approved version only once the new one is approved
 const rec2=await D('ASSISTANT','RECEIVABLES',[ln('Trade receivables','Customers at year end','10060',320000,'Debtors listing'),ln('Allowance for expected credit losses','Allowance','10070',-20000)]);
 r=await act('MANAGER',{action:'ledger_schedules_read'});assert.equal(r.kinds.find(k=>k.kind==='RECEIVABLES').approved.version,1,'the approved version stays in force');assert.equal(r.kinds.find(k=>k.kind==='RECEIVABLES').draft.version,2);
 await act('MANAGER',{action:'ledger_schedule_review',schedule_id:rec2.schedule_id,decision:'Approved'});
 r=await act('MANAGER',{action:'ledger_schedules_read'});assert.equal(r.ok,true,r.problems.join(' '));assert.deepEqual(r.problems,[]);assert.equal(r.relevant,3);
 assert.deepEqual((await tx`select version,status from erp_private.period_support_schedules where kind='RECEIVABLES' order by version`).map(x=>[x.version,x.status]),[[1,'Superseded'],[2,'Approved']],'history is kept');
 // ----- prefill: only a register that exists can propose lines, nothing is saved, and lines on an account the note does not hold are left out
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_schedule_prefill',kind:'STOCK'}),/Only receivables and payables/);
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_schedule_prefill',kind:'RECEIVABLES'}),/nothing to propose/);
 const before=Number((await tx`select count(*) n from erp_private.period_support_schedules`)[0].n);
 {const D1=id(),T1=id(),BS=id();
  await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T1},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
  await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D1},${CL},${F},${P},${T1},'Working Papers','Fictional.xlsx',${'qa/'+D1},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
  await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${BS},${P},${D1},'Sales',1,'Sales','2026-01-01','2026-12-31','{}',2,2,0,0,${actors.ASSISTANT.staff_id})`;
  for(const [k,date,inv,amt,vat] of [[2,'2026-12-20','INV1',100000,16000],[3,'2026-09-01','INV2',50000,8000]])await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${BS},${P},${CL},'Sales',${k},${'S'+k},'{}',${tx.json({date,invoice:inv,party:'Fictional Duka Ltd',party_pin:'P000000001A',amount:amt,vat})})`;}
 const pre=await act('ASSISTANT',{action:'ledger_schedule_prefill',kind:'RECEIVABLES'});
 assert.equal(pre.saved,false);assert.deepEqual(pre.lines.map(x=>[x.account,x.amount]),[['10060',116000],['10060',58000]],'one line per age band that holds a balance');assert.match(pre.evidence,/Debtors ageing from the sales register/);
 assert.equal(Number((await tx`select count(*) n from erp_private.period_support_schedules`)[0].n),before,'a proposal is not saved');
 // payables: a posted purchase with no supplier on the source shows as a posting that is not matched
 await db.exec('set session_replication_role=replica');
 {const j=id();await tx`insert into erp_private.ledger_journals(journal_id,period_id,project_id,kind,journal_date,reference,status,prepared_by,last_prepared_by,posted_at) values(${j},${per.period_id},${P},'Purchases','2026-12-20','FICTIONAL-PUR-1','Posted',${actors.MANAGER.staff_id},${actors.MANAGER.staff_id},now())`;
  await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,debit,credit) values(${j},${P},1,'20000',0,70000)`;await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,debit,credit) values(${j},${P},2,'50000',70000,0)`;}
 await db.exec('set session_replication_role=origin');
 const pp=await act('ASSISTANT',{action:'ledger_schedule_prefill',kind:'PAYABLES'});assert.deepEqual(pp.lines.map(x=>[x.description,x.account,x.amount]),[['Postings not matched to a supplier','20000',70000]]);assert.match(pp.evidence,/Supplier ledger rebuilt/);
 // ----- the database holds the same rules
 await assert.rejects(()=>tx`update erp_private.period_support_schedules set evidence='Changed after approval by someone' where kind='STOCK' and status='Approved'`,/cannot be edited/);
 await assert.rejects(()=>tx`delete from erp_private.period_support_schedules`);
 await assert.rejects(()=>tx`insert into erp_private.period_support_schedules(period_id,project_id,client_id,kind,version,evidence,lines,declared_by) values(${per.period_id},${P},${CL},'STOCK',9,${EV},'[{"category":"Goods for resale"}]',${actors.MANAGER.staff_id})`,/version number is out of date/);
 await assert.rejects(()=>tx`insert into erp_private.period_support_schedules(period_id,project_id,client_id,kind,version,evidence,lines,declared_by) values(${per.period_id},${P},${CL},'STOCK',3,${EV},'[]',${actors.MANAGER.staff_id})`,/./,'a schedule has at least one line');
 await assert.rejects(()=>tx`insert into erp_private.period_support_schedules(period_id,project_id,client_id,kind,version,evidence,lines,declared_by) values(${per.period_id},${P},${CL},'LAND',3,${EV},'[{}]',${actors.MANAGER.staff_id})`,/./,'only the listed kinds');
 await assert.rejects(()=>as('MANAGER',a=>tx`update erp_private.period_support_schedules set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now() where kind='RECEIVABLES' and status='Superseded'`),/This schedule is closed|must review/);
 // ----- an audit lock freezes the schedules
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_audit_locks(period_id,project_id,client_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,report_reference,report_date,opinion,locked_by) values(${per.period_id},${P},${CL},'In-house audit',${id()},${'a'.repeat(64)},${'b'.repeat(64)},${id()},'Fictional report','2027-03-01','Unmodified',${actors.PARTNER.staff_id})`;
 await db.exec('set session_replication_role=origin');
 r=await act('MANAGER',{action:'ledger_schedules_read'});assert.equal(r.locked,true);assert.equal(r.can_declare,false);assert.ok(r.kinds.every(k=>k.can_review===false));
 await assert.rejects(()=>D('ASSISTANT','STOCK',[ln('Goods for resale','Hardware','10100',250000)],{evidence:'A changed count sheet after the lock'}),/locked by an audit/);
 await assert.rejects(()=>tx`insert into erp_private.period_support_schedules(period_id,project_id,client_id,kind,version,evidence,lines,declared_by) values(${per.period_id},${P},${CL},'STOCK',3,${EV},'[{"category":"Goods for resale"}]',${actors.ASSISTANT.staff_id})`,/locked by an audit/);
 assert.equal(await Pg.schedulesAction(tx,actors.MANAGER,per,{action:'something_else'},get,'2026-12-31'),undefined);
});
