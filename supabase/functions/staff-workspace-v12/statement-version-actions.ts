import {fail,uuid,text,date,choice} from './validation.mjs';
import {KINDS,LINK_KINDS,previousKind,digestOf,diffSnapshots,describe,nextSteps} from './statement-version-rules.mjs';
// Builds 2825 and 2826: three linked locked versions of a client's annual statements, with links to the audit file, adjustment journals and KRA notice records.
// Table rules are in 20261116220000_statement_versions.sql. Called from ledger-actions with the financial year and a function that captures the current statements.
const ACTIONS=['ledger_fsver_read','ledger_fsver_prepare','ledger_fsver_lock','ledger_fsver_link','ledger_fsver_unlink'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[],m='That record is unavailable to your account.')=>{if(!r.length)fail(404,m);return r[0];};
const said=(v:any,min:number,max:number,what:string)=>{const t=String(v??'').replace(/\s+/g,' ').trim();if(t.length<min)fail(400,`${what} (at least ${min} characters).`);if(t.length>max)fail(400,`Keep this to ${max} characters or fewer.`);return t;};
export const isFsverAction=(a:string)=>ACTIONS.includes(a);

async function versionsOf(tx:any,periodId:string){
 const rows=await tx`select version_id,kind,seq,supersedes_version_id,supersede_reason,based_on_version_id,as_of,snapshot_digest,ready_at_capture,basis_note,no_adjustments,signed_on,signer_name,report_reference,status,prepared_at,locked_at,
   erp_private.reviewer_label(prepared_by) as prepared_by_name,erp_private.reviewer_label(locked_by) as locked_by_name,snapshot from erp_private.statement_versions where period_id=${periodId} order by kind,seq`;
 return rows.map((r:any)=>({...r,as_of:day(r.as_of),signed_on:r.signed_on?day(r.signed_on):null}));
}
async function linksOf(tx:any,ids:string[]){
 if(!ids.length)return [];
 return await tx`select l.link_id,l.version_id,l.link_kind,l.audit_file_id,l.journal_id,l.kra_case_id,l.review_project_id,l.note,l.linked_at,l.ended_at,l.end_reason,erp_private.reviewer_label(l.linked_by) as linked_by_name,
   j.reference as journal_reference,j.journal_date,f.file_status as audit_file_status,f.reporting_framework,c.notice_reference,c.notice_type,c.notice_date,c.deadline_date,c.status as notice_status,p.project_name as review_project_name
   from erp_private.statement_version_links l left join erp_private.ledger_journals j on j.journal_id=l.journal_id left join erp_private.audit_files f on f.audit_file_id=l.audit_file_id
   left join erp_private.kra_cases c on c.case_id=l.kra_case_id left join erp_private.projects p on p.project_id=l.review_project_id where l.version_id=any(${ids}::uuid[]) order by l.linked_at`;
}
export async function statementVersionAction(tx:any,a:any,p:any,l:any,capture:(asOf:string)=>Promise<any>):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 const leaderish=['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code);
 if(p.action==='ledger_fsver_read'){
  const all=describe(await versionsOf(tx,l.period_id)),links=await linksOf(tx,all.map((v:any)=>v.version_id));
  const byId=new Map(all.map((v:any)=>[v.version_id,v]));
  const versions=all.map((v:any)=>{const base=v.based_on_version_id?byId.get(v.based_on_version_id):null;const {snapshot,...rest}=v;
   return {...rest,links:links.filter((x:any)=>x.version_id===v.version_id).map((x:any)=>({...x,journal_date:x.journal_date?day(x.journal_date):null,notice_date:x.notice_date?day(x.notice_date):null,deadline_date:x.deadline_date?day(x.deadline_date):null,linked_at:day(x.linked_at),ended_at:x.ended_at?day(x.ended_at):null})),
    changes_from_base:base?diffSnapshots(base.snapshot,snapshot):[]};});
  const candidates={
   audit_files:(await tx`select audit_file_id,file_status,reporting_framework,starts_on,ends_on from erp_private.audit_files where client_id=${l.client_id} and starts_on<=${day(l.ends_on)} and ends_on>=${day(l.starts_on)} order by starts_on desc`).map((f:any)=>({...f,starts_on:day(f.starts_on),ends_on:day(f.ends_on)})),
   journals:(await tx`select journal_id,reference,journal_date,kind from erp_private.ledger_journals where period_id=${l.period_id} and status='Posted' and kind<>'Opening' order by journal_date desc,created_at desc limit 200`).map((j:any)=>({...j,journal_date:day(j.journal_date)})),
   kra_cases:(await tx`select case_id,notice_reference,notice_type,notice_date,deadline_date,status from erp_private.kra_cases where client_id=${l.client_id} and status<>'Cancelled' order by notice_date desc limit 100`).map((c:any)=>({...c,notice_date:day(c.notice_date),deadline_date:day(c.deadline_date)})),
   engagements:(await tx`select project_id,project_name,service_code from erp_private.projects where client_id=${l.client_id} and deleted_at is null and project_id<>${l.project_id} order by project_name limit 100`)};
  return {period:{period_id:l.period_id,starts_on:day(l.starts_on),ends_on:day(l.ends_on)},versions,next_steps:nextSteps(all),candidates};
 }
 if(!leaderish)fail(403,'Statement versions are prepared and linked by a Supervisor, Manager or Partner.');
 if(l.status==='Closed'&&p.action!=='ledger_fsver_link')fail(400,'This financial year is closed.');
 if(p.action==='ledger_fsver_prepare'){
  const kind=choice(p.kind,KINDS),all=await versionsOf(tx,l.period_id),asOf=p.as_of?date(p.as_of):day(l.ends_on);
  const latest=all.filter((v:any)=>v.kind===kind).sort((x:any,y:any)=>y.seq-x.seq)[0]||null;
  const prev=previousKind(kind);let base:any=null;
  if(prev){base=all.filter((v:any)=>v.kind===prev).sort((x:any,y:any)=>y.seq-x.seq)[0];
   if(!base)fail(409,`There is no ${prev} version yet. Prepare and lock it first.`);if(base.status!=='Locked')fail(409,`The ${prev} version must be locked before this one is prepared.`);}
  if(latest&&latest.status==='Prepared'&&!p.supersede_reason)fail(409,'A version of this kind is waiting to be locked. Lock it, or say why this one replaces it.');
  const reason=latest?said(p.supersede_reason,10,500,'Say why this version replaces the earlier one'):null;
  const basis=said(p.basis_note,10,1000,kind==='Draft'?'Say what this draft is prepared from':kind==='Final Signed'?'Say what the signed version is based on':'Say what the adjustments are');
  const snap=await capture(asOf);
  if(kind!=='Draft'&&!snap.ready)fail(409,'The statements are not ready: '+(snap.problems?.slice(0,2).join(' ')||'open checks remain')+' Resolve them before preparing this version.');
  const snapshot={client:snap.client,reporting:snap.reporting,statements:snap.statements,gate_status:snap.gate_status||null},digest=await digestOf(snapshot);
  let signed:any={signed_on:null,signer_name:null,report_reference:null};
  if(kind==='Final Signed')signed={signed_on:date(p.signed_on),signer_name:said(p.signer_name,2,160,'Enter the name of the person who signed'),report_reference:said(p.report_reference,3,200,'Enter the report reference')};
  const noAdj=kind==='Audit/Review Adjusted'&&p.no_adjustments===true;
  if(latest&&latest.snapshot_digest===digest&&latest.kind===kind&&kind==='Draft'&&latest.status==='Prepared')fail(409,'The statements are unchanged since the prepared draft.');
  const row=one(await tx`insert into erp_private.statement_versions(client_id,project_id,period_id,kind,seq,supersedes_version_id,supersede_reason,based_on_version_id,as_of,snapshot,snapshot_digest,ready_at_capture,basis_note,no_adjustments,signed_on,signer_name,report_reference,prepared_by)
   values(${l.client_id},${l.project_id},${l.period_id},${kind},${latest?latest.seq+1:1},${latest?.version_id??null},${reason},${base?.version_id??null},${asOf},${tx.json(snapshot)},${digest},${snap.ready===true},${basis},${noAdj},${signed.signed_on},${signed.signer_name},${signed.report_reference},${a.staff_id}) returning version_id,seq`);
  return {version_id:row.version_id,seq:row.seq,kind,snapshot_digest:digest,ready:snap.ready===true};
 }
 const v=one(await tx`select version_id,status,kind,prepared_by from erp_private.statement_versions where version_id=${uuid(p.version_id)} and period_id=${l.period_id}`);
 if(p.action==='ledger_fsver_lock'){
  if(v.status==='Locked')fail(409,'This version is already locked.');
  try{await tx`update erp_private.statement_versions set status='Locked',locked_by=${a.staff_id} where version_id=${v.version_id}`;}
  catch(e:any){const m=String(e?.message||'');if(/23514|never edited|Link |different Manager|Manager or Partner|signed version|superseded|not ready/.test(m)||e?.code==='23514')fail(409,m.replace(/^.*?(Link |A different|A Manager|The signed|This version|The statements)/,'$1'));throw e;}
  return {locked:true};
 }
 if(p.action==='ledger_fsver_link'){
  const kind=choice(p.link_kind,LINK_KINDS),target=uuid(p.target_id),note=p.note?text(p.note,500):null;
  const cols:any={audit_file_id:null,journal_id:null,kra_case_id:null,review_project_id:null};
  cols[{'Audit file':'audit_file_id','Adjustment journal':'journal_id','KRA notice':'kra_case_id','Review engagement':'review_project_id'}[kind as string] as string]=target;
  try{await tx`insert into erp_private.statement_version_links(version_id,client_id,project_id,link_kind,audit_file_id,journal_id,kra_case_id,review_project_id,note,linked_by) values(${v.version_id},${l.client_id},${l.project_id},${kind},${cols.audit_file_id},${cols.journal_id},${cols.kra_case_id},${cols.review_project_id},${note},${a.staff_id})`;}
  catch(e:any){const m=String(e?.message||'');if(e?.code==='23505'||/duplicate key/.test(m))fail(409,'This record is already linked to the version.');if(e?.code==='23514')fail(400,m);throw e;}
  return {linked:true};
 }
 // ledger_fsver_unlink
 const link=one(await tx`select link_id,ended_at from erp_private.statement_version_links where link_id=${uuid(p.link_id)} and version_id=${v.version_id}`);
 if(link.ended_at)fail(409,'This link has already ended.');
 if(v.status==='Locked')fail(409,'A locked version keeps its links.');
 await tx`update erp_private.statement_version_links set ended_at=now(),ended_by=${a.staff_id},end_reason=${said(p.reason,10,500,'Say why this link is ended')} where link_id=${link.link_id}`;
 return {unlinked:true};
}
