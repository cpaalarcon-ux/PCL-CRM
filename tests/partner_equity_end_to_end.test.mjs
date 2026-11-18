import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const Pg=await import('../supabase/functions/staff-workspace-v12/partner-equity-actions.ts');
const {buildEquityStatement}=await import('../supabase/functions/staff-workspace-v12/annual-pack-flows.mjs');
const {buildPartnerEquity,partnerEquityState,partnerEquityCheck}=await import('../supabase/functions/staff-workspace-v12/annual-pack-partner-equity.mjs');
const {allocateProfit}=await import('../supabase/functions/staff-workspace-v12/partner-shares-rules.mjs');
const H=await import('./helpers/partner_equity_ready.mjs');

const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),CL2=id(),P=id(),P2=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
let per,per2,tbRows=H.tb();
// What the statements engine would hand over for this year: the equity statement, the face allocation and the partners' statement built from the approved record.
const get=async()=>{
 const rec=await Pg.partnerEquityFor(tx,per),eq=buildEquityStatement({lineDefs:H.lineDefs,maps:H.maps,tb:tbRows,asOf:'2026-12-31'}),
  alloc=allocateProfit(eq.current.rows.find(r=>r.move==='PROFIT').total,H.shares,0),face={rows:alloc.rows.map(r=>({partner_name:r.partner_name,amount:r.amount})),total:alloc.total};
 const built=buildPartnerEquity({record:rec.approved,shares:H.shares,equity:eq,alloc:face}),pe=partnerEquityState({relevant:true,record:rec.approved?{}:null,draft:!!rec.draft,built});
 return {statements:{partner_equity:built,partner_equity_check:pe,changes_in_equity:eq,presentation:{unit_label:'KES'}}};
};
const act=(role,p,l=per)=>as(role,a=>Pg.partnerEquityAction(tx,a,l,p,get,'2026-12-31'));
const EV=H.EVIDENCE;

test('partners accounts: declared, approved by someone else, tied to the equity statement, frozen by an audit lock, and held by the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional partners firm')`;
 const mk=async(key,role)=>{const a=actors[key]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${key},${key.toLowerCase()},${'Fictional '+key},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;};
 await mk('PARTNER','PARTNER');await mk('MANAGER','MANAGER');await mk('ASSISTANT','ASSISTANT');await mk('INTERN','INTERN');await mk('PARTNER2','PARTNER');
 for(const [c,n,ty] of [[CL,'Fictional Amani and Zawadi Traders','Partnership'],[CL2,'Fictional Mlima Limited','Limited company']]){await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${c},${n},${actors.MANAGER.staff_id},${ty})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;}
 for(const [pr,c] of [[P,CL],[P2,CL2]]){await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${pr},${c},${F},'Fictional project','TAX-COMP',${actors.MANAGER.staff_id})`;
  for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${pr},${actors[role].staff_id},${F},${role==='PARTNER2'?'PARTNER':role})`;}
 const mkPer=async(pr,c,ty)=>(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${pr},${c},${F},'2026-01-01','2026-12-31',${ty},'Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 per=await mkPer(P,CL,'Partnership');per2=await mkPer(P2,CL2,'Limited company');
 const D=(role,over={},l=per)=>act(role,{action:'ledger_partner_equity_declare',evidence:EV,rows:H.rows(),...over},l);
 // ----- only a partnership has partners' accounts, and not before the profit shares are approved
 await assert.rejects(()=>act('MANAGER',{action:'ledger_partner_equity_read'},per2),/for a partnership/);
 let r=await act('ASSISTANT',{action:'ledger_partner_equity_read'});assert.equal(r.shares_status,'none');assert.deepEqual(r.partners,[]);assert.equal(r.can_declare,false);
 await assert.rejects(()=>D('ASSISTANT'),/profit shares are not approved yet/);
 await assert.rejects(()=>as('INTERN',a=>Pg.partnerEquityAction(tx,a,per,{action:'ledger_partner_equity_read'},get,'2026-12-31')),/staff who prepare/);
 // approved profit shares name the partners (seeded the way the shares build leaves them)
 await db.exec('set session_replication_role=replica');
 {const s=id();await tx`insert into erp_private.period_partner_share_sets(set_id,period_id,project_id,client_id,version,source_reference,ratio_only,status,entered_by,reviewed_by,reviewed_at) values(${s},${per.period_id},${P},${CL},1,'Fictional partnership deed clause 5',true,'Approved',${actors.MANAGER.staff_id},${actors.PARTNER.staff_id},now())`;
  for(const l of H.shares)await tx`insert into erp_private.period_partner_share_lines(set_id,project_id,partner_name,share_bp) values(${s},${P},${l.partner_name},${l.share_bp})`;}
 await db.exec('set session_replication_role=origin');
 r=await act('ASSISTANT',{action:'ledger_partner_equity_read'});assert.deepEqual(r.partners,['Fictional Amani','Fictional Zawadi']);assert.equal(r.can_declare,true);assert.equal(r.approved,null);assert.equal(r.matrix,null);
 assert.match(r.problems.join(' '),/not declared/);assert.deepEqual(r.equity_rows.map(x=>x.move),['OPENING','PROFIT','DIVIDENDS_DRAWINGS','CAPITAL','OTHER','CLOSING']);
 // ----- declaring: a line for every partner, to the cent
 await assert.rejects(()=>D('ASSISTANT',{evidence:'short'}),/what supports/);
 await assert.rejects(()=>D('ASSISTANT',{rows:[H.rows()[0]]}),/Add a line for Fictional Zawadi/);
 await assert.rejects(()=>D('ASSISTANT',{rows:[H.rows()[0],{...H.rows()[1],partner_name:'Fictional Stranger'}]}),/not a partner in the approved profit shares/);
 await assert.rejects(()=>D('ASSISTANT',{rows:[{...H.rows()[0],drawings:-1},H.rows()[1]]}),/positive figure/);
 const d1=await D('ASSISTANT',{rows:[{...H.rows()[0],drawings:110000},H.rows()[1]]});assert.equal(d1.version,1);assert.equal(d1.status,'Draft');
 r=await act('MANAGER',{action:'ledger_partner_equity_read'});assert.equal(r.can_review,true);assert.equal(r.approved,null,'a draft is not used');assert.equal(r.draft.declared_by_me,false);assert.match(r.problems.join(' '),/wait for approval/);
 await assert.rejects(()=>act('ASSISTANT',{action:'ledger_partner_equity_review',equity_id:d1.equity_id,decision:'Approved'}),/Manager or Partner/);
 await assert.rejects(()=>act('MANAGER',{action:'ledger_partner_equity_review',equity_id:d1.equity_id,decision:'Returned',review_note:'no'}),/at least 10/);
 assert.equal((await act('MANAGER',{action:'ledger_partner_equity_review',equity_id:d1.equity_id,decision:'Returned',review_note:'Fictional: drawings are 120,000 in the ledger.'})).status,'Returned');
 r=await act('ASSISTANT',{action:'ledger_partner_equity_read'});assert.equal(r.returned.version,1);assert.equal(r.draft,null);
 // ----- approved but not agreeing: the difference is named, and nothing is absorbed
 const d2=await D('ASSISTANT',{rows:[{...H.rows()[0],drawings:110000},H.rows()[1]]});assert.equal(d2.version,2);
 await assert.rejects(()=>act('MANAGER',{action:'ledger_partner_equity_review',equity_id:d1.equity_id,decision:'Approved'}),/has changed/,'a replaced record cannot be reviewed');
 assert.equal((await act('MANAGER',{action:'ledger_partner_equity_review',equity_id:d2.equity_id,decision:'Approved'})).sole_partner_approval,false);
 r=await act('MANAGER',{action:'ledger_partner_equity_read'});assert.equal(r.approved.version,2);assert.equal(r.statement.ties,false);assert.deepEqual(r.tie.filter(x=>!x.ties).map(x=>x.move),['DIVIDENDS_DRAWINGS','CLOSING']);assert.match(r.problems.join(' '),/Drawings: the partners’ accounts give -190,000\.00 and the statement of changes in equity -200,000\.00/);
 await assert.rejects(()=>D('ASSISTANT',{rows:[{...H.rows()[0],drawings:110000},H.rows()[1]]}),/already approved/);
 // ----- the corrected record replaces it only once approved; history is kept
 const d3=await D('PARTNER2');assert.equal(d3.version,3);
 r=await act('MANAGER',{action:'ledger_partner_equity_read'});assert.equal(r.approved.version,2,'the approved version stays in force');assert.equal(r.draft.version,3);
 await assert.rejects(()=>act('PARTNER2',{action:'ledger_partner_equity_review',equity_id:d3.equity_id,decision:'Approved'}),/Someone else approves/);
 await assert.rejects(()=>act('PARTNER2',{action:'ledger_partner_equity_review',equity_id:d3.equity_id,decision:'Approved',sole_partner_approval:true}),/sole Partner|only Partner/,'a second Partner exists, so the exception does not apply');
 assert.equal((await act('PARTNER',{action:'ledger_partner_equity_review',equity_id:d3.equity_id,decision:'Approved'})).status,'Approved');
 r=await act('MANAGER',{action:'ledger_partner_equity_read'});assert.equal(r.statement.ties,true,r.problems.join(' '));assert.deepEqual(r.problems,[]);assert.equal(r.matrix.rows.at(-1).cells[2],1450000);assert.deepEqual(r.matrix.columns,['Fictional Amani','Fictional Zawadi','Total']);
 assert.deepEqual((await tx`select version,status from erp_private.period_partner_equity order by version`).map(x=>[x.version,x.status]),[[1,'Returned'],[2,'Superseded'],[3,'Approved']]);
 const chk=partnerEquityCheck((await get()).statements.partner_equity_check);assert.equal(chk.status,'Pass');
 // ----- a sole Partner may approve their own record, with the confirmation, and it is recorded
 const d4=await D('PARTNER',{evidence:'Fictional partners ledger, re-checked at the year end'});assert.equal(d4.version,4);
 await assert.rejects(()=>act('PARTNER',{action:'ledger_partner_equity_review',equity_id:d4.equity_id,decision:'Approved',sole_partner_approval:true}),/./,'with another active Partner on the firm the exception does not apply');
 await db.exec("update erp_private.staff_members set access_status='Inactive' where staff_identifier='PARTNER2'");
 await assert.rejects(()=>act('PARTNER',{action:'ledger_partner_equity_review',equity_id:d4.equity_id,decision:'Approved'}),/Someone else approves/,'the confirmation is required');
 assert.equal((await act('PARTNER',{action:'ledger_partner_equity_review',equity_id:d4.equity_id,decision:'Approved',sole_partner_approval:true})).sole_partner_approval,true);
 assert.deepEqual((await tx`select version,status,sole_partner_approval from erp_private.period_partner_equity where version>=3 order by version`).map(x=>[x.version,x.status,x.sole_partner_approval]),[[3,'Superseded',false],[4,'Approved',true]]);
 // ----- the database holds the same rules
 await assert.rejects(()=>tx`update erp_private.period_partner_equity set evidence='Changed after approval by someone' where status='Approved'`,/cannot be edited/);
 await assert.rejects(()=>tx`delete from erp_private.period_partner_equity`);
 await assert.rejects(()=>tx`insert into erp_private.period_partner_equity(period_id,project_id,client_id,version,evidence,lines,declared_by) values(${per.period_id},${P},${CL},9,${EV},'[{},{}]',${actors.MANAGER.staff_id})`,/version number is out of date/);
 await assert.rejects(()=>tx`insert into erp_private.period_partner_equity(period_id,project_id,client_id,version,evidence,lines,declared_by) values(${per.period_id},${P},${CL},4,${EV},'[{}]',${actors.MANAGER.staff_id})`,/./,'a partnership has at least two partners');
 assert.equal((await as('ASSISTANT',a=>tx`update erp_private.period_partner_equity set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now() where version=2 returning equity_id`)).length,0,'staff below Manager cannot approve: row-level security leaves the row untouched');
 // ----- an audit lock freezes the record
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.period_audit_locks(period_id,project_id,client_id,mode,notes_set_id,notes_digest,figures_digest,audit_file_id,report_reference,report_date,opinion,locked_by) values(${per.period_id},${P},${CL},'In-house audit',${id()},${'a'.repeat(64)},${'b'.repeat(64)},${id()},'Fictional report','2027-03-01','Unmodified',${actors.PARTNER.staff_id})`;
 await db.exec('set session_replication_role=origin');
 r=await act('MANAGER',{action:'ledger_partner_equity_read'});assert.equal(r.locked,true);assert.equal(r.can_declare,false);assert.equal(r.can_review,false);
 await assert.rejects(()=>D('ASSISTANT',{evidence:'A changed ledger after the lock'}),/locked by an audit/);
 await assert.rejects(()=>tx`insert into erp_private.period_partner_equity(period_id,project_id,client_id,version,evidence,lines,declared_by) values(${per.period_id},${P},${CL},4,${EV},'[{},{}]',${actors.ASSISTANT.staff_id})`,/locked by an audit/);
 assert.equal(await Pg.partnerEquityAction(tx,actors.MANAGER,per,{action:'something_else'},get,'2026-12-31'),undefined);
});

