import {fail,text,uuid,choice} from './validation.mjs';
import {KINDS,KIND_CODES,kindOf,kindForRef,validateSchedule,scheduleReadiness,SCHEDULES_VERSION,MAX_LINES} from './annual-pack-schedules.mjs';
import {debtorsRead} from './debtors.ts';
import {payablesReport} from './payables.ts';
// Supporting schedules (build 2886). Staff declare a schedule behind a note (stock, receivables, payables, bank, loans, tax, payroll, equity); a Manager or Partner who did not declare it approves it (a sole
// Partner may approve their own, and it is recorded). Approved schedules are never edited: a correction is a new version. The tie-out to the trial balance is worked out when the notes are built, so
// a schedule can never claim to agree. A prefill from the debtors and supplier registers only proposes lines; nothing is saved until a person declares them. Nothing here posts a journal or changes a figure.
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const canDeclare=(a:any)=>['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code);
const dayOf=(d:any)=>String(d instanceof Date?d.toISOString():d).slice(0,10);
// jsonb does not keep the order of keys, so lines are compared by value.
const canon=(x:any):any=>Array.isArray(x)?x.map(canon):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canon(x[k])])):x;
const sameLines=(a:any,b:any)=>JSON.stringify(canon(a))===JSON.stringify(canon(b));
const ACTIONS=['ledger_schedules_read','ledger_schedule_declare','ledger_schedule_review','ledger_schedule_prefill'];

async function loadRows(tx:any,periodId:string){
 return await tx`select schedule_id,kind,version,evidence,lines,status,declared_by,declared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(declared_by) declared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.period_support_schedules where period_id=${periodId} and status in ('Draft','Approved','Returned') order by kind,version desc`;
}
const shape=(r:any)=>r&&{schedule_id:r.schedule_id,version:r.version,evidence:r.evidence,lines:r.lines,declared_name:r.declared_name,declared_at:r.declared_at,reviewed_name:r.reviewed_name,reviewed_at:r.reviewed_at,review_note:r.review_note,sole_partner_approval:r.sole_partner_approval};
// The schedules of one year, by kind and state. `forNotes` holds only the approved ones: the notes print nothing else.
export async function schedulesFor(tx:any,l:any){
 const rows=await loadRows(tx,l.period_id),approved:any={},draft:any={},returned:any={},forNotes:any={};
 for(const k of KIND_CODES){
  const mine=rows.filter((r:any)=>r.kind===k),ap=mine.find((r:any)=>r.status==='Approved'),dr=mine.find((r:any)=>r.status==='Draft'),rt=mine.find((r:any)=>r.status==='Returned'&&(!dr||r.version>dr.version)&&(!ap||r.version>ap.version));
  if(ap){approved[k]=shape(ap);forNotes[k]={version:ap.version,evidence:ap.evidence,lines:ap.lines,declared_name:ap.declared_name,reviewed_name:ap.reviewed_name};}
  if(dr)draft[k]={...shape(dr),declared_by:dr.declared_by};
  if(rt)returned[k]=shape(rt);
 }
 return {approved,draft,returned,forNotes};
}
async function refuseIfLocked(tx:any,periodId:string){
 if((await tx`select 1 from erp_private.period_audit_locks where period_id=${periodId} and ended_at is null`).length)fail(409,'The pack is locked by an audit, so its schedules cannot change. A Partner ends the lock first.');
}
const noteFor=(st:any,kind:string)=>{const k=kindOf(kind);return (st?.statements?.notes?.items||[]).find((n:any)=>k&&n.ref===k.ref)||null;};

// Lines proposed from a register that already exists. Only receivables and payables have one. The lines are returned, never saved.
async function prefillLines(tx:any,l:any,kind:string,allowed:Set<string>){
 const asOf=dayOf(l.ends_on),out:any[]=[];let evidence='';
 if(kind==='RECEIVABLES'){
  const d=await debtorsRead(tx,l,asOf);
  for(const b of d.bands)if(d.totals[b.key])out.push({category:'Trade receivables',description:`Customers owing ${b.label.toLowerCase()}`,account:'10060',reference:'',amount:d.totals[b.key]});
  evidence=`Debtors ageing from the sales register at ${asOf}, after receipts allocated to invoices.`;
 }else if(kind==='PAYABLES'){
  const r=await payablesReport(tx,l,asOf);
  for(const b of r.buckets)if(b.amount)out.push({category:'Trade payables',description:`Suppliers owed ${b.label.toLowerCase()}`,account:'20000',reference:'',amount:b.amount});
  const debit=Math.round(r.suppliers.reduce((n:number,s:any)=>n+Math.round(Number(s.debit_balance||0)*100),0))/100;
  if(debit)out.push({category:'Trade payables',description:'Suppliers in debit (paid more than invoiced)',account:'20000',reference:'',amount:-debit});
  if(r.unassigned.amount)out.push({category:'Trade payables',description:'Postings not matched to a supplier',account:'20000',reference:'',amount:r.unassigned.amount});
  if(r.opening.amount)out.push({category:'Trade payables',description:'Opening balance brought forward',account:'20000',reference:'',amount:r.opening.amount});
  evidence=`Supplier ledger rebuilt from the posted trade payables lines at ${asOf}.`;
 }else fail(400,'Only receivables and payables can be filled from a register. The other schedules are declared from their documents.');
 const usable=out.filter((x:any)=>allowed.has(x.account));
 return {lines:usable,evidence,left_out:out.length-usable.length};
}

export async function schedulesAction(tx:any,a:any,l:any,p:any,getStatements:(asOf:string)=>Promise<any>,asOf:string){
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The supporting schedules are for staff who prepare or review statements.');
 const open=l.status==='Open';
 if(p.action==='ledger_schedules_read'){
  const st=await getStatements(asOf),items=st.statements?.notes?.items||[],sch=await schedulesFor(tx,l);
  const locked=(await tx`select 1 from erp_private.period_audit_locks where period_id=${l.period_id} and ended_at is null`).length>0;
  const ready=scheduleReadiness({notes:items,rows:sch});
  const kinds=KINDS.map((k:any)=>{
   const n=items.find((x:any)=>x.ref===k.ref),r=ready.kinds.find((x:any)=>x.kind===k.code),dr=sch.draft[k.code];
   return {kind:k.code,title:k.title,categories:k.categories,source_hint:k.source,has_note:!!n,note_number:n?n.number:null,relevant:r?r.relevant:false,state:r?r.state:'No note',
    accounts:n?n.support_basis.accounts.map((x:any)=>({code:x.code,name:x.name,amount:x.amount})):[],approved:sch.approved[k.code]||null,draft:dr?{...dr,declared_by:undefined,declared_by_me:dr.declared_by===a.staff_id}:null,returned:sch.returned[k.code]||null,
    tie:n&&n.support?n.support.tie:null,can_prefill:['RECEIVABLES','PAYABLES'].includes(k.code),
    can_review:isLeader(a)&&open&&!locked&&!!dr&&(dr.declared_by!==a.staff_id||a.category_code==='PARTNER')};
  });
  return {version:SCHEDULES_VERSION,kinds,relevant:ready.relevant,ok:ready.ok,problems:ready.problems,locked,can_declare:canDeclare(a)&&open&&!locked,max_lines:MAX_LINES,
   note:'A schedule says what is inside each account of a note. It is declared with its source and approved by someone who did not declare it. The tie-out to the trial balance is worked out from the posted ledger every time; nothing is typed in to make it agree.'};
 }
 if(!open)fail(409,'This ledger year is closed. Its schedules can no longer be changed.');
 if(p.action==='ledger_schedule_prefill'){
  if(!canDeclare(a))fail(403,'Staff who prepare the statements declare the schedules.');
  const kind=choice(p.kind,KIND_CODES),st=await getStatements(asOf),n=noteFor(st,kind);
  if(!n)fail(400,'This year has no note for that schedule.');
  const pre=await prefillLines(tx,l,kind,new Set(n.support_basis.accounts.map((x:any)=>String(x.code))));
  if(!pre.lines.length)fail(400,'The register has nothing to propose for this year.');
  return {kind,lines:pre.lines,evidence:pre.evidence,left_out:pre.left_out,saved:false,note:'These lines are a proposal from the register. Read them, add what the register does not hold, and declare the schedule. Nothing is saved yet.'};
 }
 if(p.action==='ledger_schedule_declare'){
  if(!canDeclare(a))fail(403,'Staff who prepare the statements declare the schedules.');
  const kind=choice(p.kind,KIND_CODES),st=await getStatements(asOf),n=noteFor(st,kind);
  if(!n)fail(400,'This year has no note for that schedule.');
  const v=validateSchedule({kind,evidence:p.evidence,lines:Array.isArray(p.lines)?p.lines:[],accounts:n.support_basis.accounts.map((x:any)=>x.code)});
  if(v.error)fail(400,v.error);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':schedule:'+kind},0))`;
  await refuseIfLocked(tx,l.period_id);
  const cur=await tx`select status,evidence,lines from erp_private.period_support_schedules where period_id=${l.period_id} and kind=${kind} and status in ('Draft','Approved')`,ap=cur.find((r:any)=>r.status==='Approved');
  if(ap&&ap.evidence===v.evidence&&sameLines(ap.lines,v.lines)&&!cur.some((r:any)=>r.status==='Draft'))fail(409,'This is already approved as declared.');
  await tx`update erp_private.period_support_schedules set status='Superseded' where period_id=${l.period_id} and kind=${kind} and status='Draft'`;
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.period_support_schedules where period_id=${l.period_id} and kind=${kind}`)[0].v);
  return (await tx`insert into erp_private.period_support_schedules(period_id,project_id,client_id,kind,version,evidence,lines,declared_by) values(${l.period_id},${l.project_id},${l.client_id},${kind},${ver},${v.evidence},${tx.json(v.lines)},${a.staff_id}) returning schedule_id,kind,version,status`)[0];
 }
 // review
 if(!isLeader(a))fail(403,'A Manager or Partner approves or returns a schedule.');
 const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false),id=uuid(p.schedule_id);
 const d=(await tx`select schedule_id,period_id,kind,status,declared_by from erp_private.period_support_schedules where schedule_id=${id}`)[0];
 if(!d||d.period_id!==l.period_id||d.status!=='Draft')fail(409,'This schedule has changed. Refresh and review the latest one.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':schedule:'+d.kind},0))`;
 await refuseIfLocked(tx,l.period_id);
 if(decision==='Returned'){
  if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`update erp_private.period_support_schedules set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where schedule_id=${id}`;
  return {status:'Returned'};
 }
 const own=d.declared_by===a.staff_id;
 if(own&&(a.category_code!=='PARTNER'||p.sole_partner_approval!==true))fail(403,'Someone else approves a schedule you declared. If you are your firm’s only Partner, confirm that when you approve.');
 await tx`update erp_private.period_support_schedules set status='Superseded' where period_id=${l.period_id} and kind=${d.kind} and status='Approved'`;
 await tx`update erp_private.period_support_schedules set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where schedule_id=${id}`;
 return {status:'Approved',sole_partner_approval:own};
}
