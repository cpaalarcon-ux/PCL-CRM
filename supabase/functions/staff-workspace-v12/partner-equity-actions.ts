import {fail,text,uuid,choice} from './validation.mjs';
import {validatePartnerEquity,buildPartnerEquity,partnerEquityMatrix,PARTNER_EQUITY_VERSION} from './annual-pack-partner-equity.mjs';
import {shareStateFor} from './partner-shares-actions.ts';
// The partners' capital and current accounts (build 2888). Staff declare, for every partner in the approved profit shares, the opening capital, the capital introduced or withdrawn, the opening
// current account and the drawings; a Manager or Partner who did not declare it approves (a sole Partner may approve their own, and it is recorded). Approved records are never edited: a correction is
// a new version. The share of profit is worked out from the approved shares and the tie-out to the statement of changes in equity is worked out when the pack is built, so a record can never claim to agree.
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const canDeclare=(a:any)=>['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code);
const ACTIONS=['ledger_partner_equity_read','ledger_partner_equity_declare','ledger_partner_equity_review'];
const canon=(x:any):any=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const same=(a:any,b:any)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
const shape=(r:any)=>r&&{equity_id:r.equity_id,version:r.version,evidence:r.evidence,rows:r.lines,declared_name:r.declared_name,declared_at:r.declared_at,reviewed_name:r.reviewed_name,reviewed_at:r.reviewed_at,review_note:r.review_note,sole_partner_approval:r.sole_partner_approval};

export async function partnerEquityFor(tx:any,l:any){
 const rows=await tx`select equity_id,version,evidence,lines,status,declared_by,declared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(declared_by) declared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.period_partner_equity where period_id=${l.period_id} and status in ('Draft','Approved','Returned') order by version desc`;
 const ap=rows.find((r:any)=>r.status==='Approved'),dr=rows.find((r:any)=>r.status==='Draft'),rt=rows.find((r:any)=>r.status==='Returned'&&(!dr||r.version>dr.version)&&(!ap||r.version>ap.version));
 return {approved:shape(ap)||null,draft:dr?{...shape(dr),declared_by:dr.declared_by}:null,returned:shape(rt)||null};
}
async function refuseIfLocked(tx:any,periodId:string){
 if((await tx`select 1 from erp_private.period_audit_locks where period_id=${periodId} and ended_at is null`).length)fail(409,'The pack is locked by an audit, so the partners’ accounts cannot change. A Partner ends the lock first.');
}
export async function partnerEquityAction(tx:any,a:any,l:any,p:any,getStatements:(asOf:string)=>Promise<any>,asOf:string){
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The partners’ accounts are for staff who prepare or review statements.');
 const open=l.status==='Open';
 const isP=(await tx`select legal_entity_type from erp_private.clients where client_id=${l.client_id}`)[0]?.legal_entity_type==='Partnership';
 if(!isP)fail(400,'The partners’ capital and current accounts are for a partnership. This client is not recorded as one.');
 const sh=await shareStateFor(tx,l.period_id),partners=sh.status==='approved'?sh.lines.map((x:any)=>x.partner_name):[];
 if(p.action==='ledger_partner_equity_read'){
  const st=await getStatements(asOf),S=st.statements,rec=await partnerEquityFor(tx,l);
  const locked=(await tx`select 1 from erp_private.period_audit_locks where period_id=${l.period_id} and ended_at is null`).length>0;
  const built=S.partner_equity||null,dr=rec.draft;
  const rows=S.changes_in_equity?.current?.rows||[];
  return {version:PARTNER_EQUITY_VERSION,partners,shares_status:sh.status,approved:rec.approved,draft:dr?{...dr,declared_by:undefined,declared_by_me:dr.declared_by===a.staff_id}:null,returned:rec.returned,
   statement:built,matrix:built&&built.built?partnerEquityMatrix(built):null,tie:built&&built.built?built.tie:null,problems:S.partner_equity_check?S.partner_equity_check.problems:[],
   equity_rows:rows.map((r:any)=>({move:r.move,label:r.label,total:r.total})),unit_label:S.presentation?.unit_label||'KES',locked,
   can_declare:canDeclare(a)&&open&&!locked&&partners.length>0,can_review:isLeader(a)&&open&&!locked&&!!dr&&(dr.declared_by!==a.staff_id||a.category_code==='PARTNER'),
   note:'Enter, for each partner named in the approved profit shares, the balances from the partners’ accounts. The share of profit is worked out from the approved shares. The totals must agree, to the cent, with the statement of changes in equity.'};
 }
 if(!open)fail(409,'This ledger year is closed. The partners’ accounts can no longer be changed.');
 if(p.action==='ledger_partner_equity_declare'){
  if(!canDeclare(a))fail(403,'Staff who prepare the statements declare the partners’ accounts.');
  const v=validatePartnerEquity({evidence:p.evidence,rows:Array.isArray(p.rows)?p.rows:[],partners});
  if(v.error)fail(400,v.error);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':partner-equity'},0))`;
  await refuseIfLocked(tx,l.period_id);
  const cur=await tx`select status,evidence,lines from erp_private.period_partner_equity where period_id=${l.period_id} and status in ('Draft','Approved')`,ap=cur.find((r:any)=>r.status==='Approved');
  if(ap&&ap.evidence===v.evidence&&same(ap.lines,v.rows)&&!cur.some((r:any)=>r.status==='Draft'))fail(409,'This is already approved as declared.');
  await tx`update erp_private.period_partner_equity set status='Superseded' where period_id=${l.period_id} and status='Draft'`;
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.period_partner_equity where period_id=${l.period_id}`)[0].v);
  return (await tx`insert into erp_private.period_partner_equity(period_id,project_id,client_id,version,evidence,lines,declared_by) values(${l.period_id},${l.project_id},${l.client_id},${ver},${v.evidence},${tx.json(v.rows)},${a.staff_id}) returning equity_id,version,status`)[0];
 }
 // review
 if(!isLeader(a))fail(403,'A Manager or Partner approves or returns the partners’ accounts.');
 const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false),id=uuid(p.equity_id);
 const d=(await tx`select equity_id,period_id,status,declared_by from erp_private.period_partner_equity where equity_id=${id}`)[0];
 if(!d||d.period_id!==l.period_id||d.status!=='Draft')fail(409,'This record has changed. Refresh and review the latest one.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':partner-equity'},0))`;
 await refuseIfLocked(tx,l.period_id);
 if(decision==='Returned'){
  if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`update erp_private.period_partner_equity set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where equity_id=${id}`;
  return {status:'Returned'};
 }
 const own=d.declared_by===a.staff_id;
 if(own&&(a.category_code!=='PARTNER'||p.sole_partner_approval!==true))fail(403,'Someone else approves what you declared. If you are your firm’s only Partner, confirm that when you approve.');
 await tx`update erp_private.period_partner_equity set status='Superseded' where period_id=${l.period_id} and status='Approved'`;
 await tx`update erp_private.period_partner_equity set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where equity_id=${id}`;
 return {status:'Approved',sole_partner_approval:own};
}
