import {fail,text,uuid,choice} from './validation.mjs';
import {FRAMEWORKS} from './annual-pack-rules.mjs';
import {WORDING_DEFAULTS,WORDING_VERSION,DISCLOSURES,DISCLOSURE_CODES,disclosureDef,defaultDef,variantKey,variantKeys,builtInVariant,applicableEntries,requiredDisclosures,assembleWording,validateDeclaration,validateWordingBody} from './annual-pack-wording.mjs';
// Standard wording library and client-specific disclosures (build 2878). A Manager or Partner prepares library wording and a Partner approves it, a different Partner from the preparer unless the firm
// has only one Partner. Disclosures are declared by staff for a ledger year and approved by a Manager or Partner who did not declare them (the sole Partner may approve their own, and it is recorded).
// Approved rows are never edited, only superseded. The server owns every rule; the screens draw what it returns.
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const canDeclare=(a:any)=>['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code);
const SME='IFRS for SMEs Accounting Standard';

function basis(p:any){
 const framework=text(p.framework??SME,80,true),edition=text(p.edition??'',80,true);
 if(!FRAMEWORKS[framework]||!FRAMEWORKS[framework].includes(edition))fail(400,'Choose a reporting framework and one of its editions.');
 return {framework,edition};
}
const view=(w:any)=>w&&{wording_id:w.wording_id,version:w.version,status:w.status,body:w.body,origin:w.origin,prepared_name:w.prepared_name,prepared_at:w.prepared_at,reviewed_name:w.reviewed_name,reviewed_at:w.reviewed_at,review_note:w.review_note,sole_partner_approval:w.sole_partner_approval};

// ---------- library (firm-wide) ----------
async function loadLibrary(tx:any,framework:string,edition:string){
 return await tx`select wording_id,code,legal_form,version,title,body,origin,status,prepared_by,prepared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(prepared_by) prepared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.standard_wording where framework=${framework} and edition=${edition} and status in ('Draft','Approved','Returned') order by code,legal_form,version desc`;
}
// code -> variant -> the approved row (used by the pack).
export async function approvedLibrary(tx:any,framework:string,edition:string){
 const rows=await tx`select wording_id,code,legal_form,version,body,status from erp_private.standard_wording where framework=${framework} and edition=${edition} and status='Approved'`;
 const out:any={};for(const r of rows){(out[r.code]=out[r.code]||{})[r.legal_form]=r;}return out;
}
async function prepareOne(tx:any,a:any,framework:string,edition:string,code:string,variant:string,body:string|null){
 const d=defaultDef(code);if(!d)fail(400,'That wording is not one the library holds.');
 if(!variantKeys(code).includes(variant))fail(400,'That wording has no such variant.');
 const builtIn=builtInVariant(code,variant) as string,use=body===null?builtIn:String(body).trim();
 const bad=validateWordingBody(code,use);if(bad)fail(400,bad);
 await tx`select pg_advisory_xact_lock(hashtextextended(${'wording:'+framework+edition+code+variant},0))`;
 const cur=await tx`select wording_id,status,body from erp_private.standard_wording where code=${code} and framework=${framework} and edition=${edition} and legal_form=${variant} and status in ('Draft','Approved')`;
 const appr=cur.find((r:any)=>r.status==='Approved');
 if(appr&&appr.body===use&&!cur.some((r:any)=>r.status==='Draft'))fail(409,`"${d.title}" is already approved with this text.`);
 await tx`update erp_private.standard_wording set status='Superseded' where code=${code} and framework=${framework} and edition=${edition} and legal_form=${variant} and status='Draft'`;
 const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.standard_wording where code=${code} and framework=${framework} and edition=${edition} and legal_form=${variant}`)[0].v);
 return (await tx`insert into erp_private.standard_wording(code,framework,edition,version,legal_form,title,body,origin,wording_version,prepared_by) values(${code},${framework},${edition},${ver},${variant},${d.title},${use},${use===builtIn?'Built-in draft':'Edited'},${WORDING_VERSION},${a.staff_id}) returning wording_id,code,version`)[0];
}
export async function wordingLibraryAction(tx:any,a:any,p:any):Promise<any>{
 if(!['wording_library_read','wording_library_prepare','wording_library_prepare_all','wording_library_review'].includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The wording library is for staff who prepare or review statements.');
 if(p.action==='wording_library_read'){
  const {framework,edition}=basis(p),rows=await loadLibrary(tx,framework,edition),builtIn=framework===SME;
  const entries:any[]=[];
  if(builtIn)for(const d of WORDING_DEFAULTS)for(const v of variantKeys(d.code)){
   const mine=rows.filter((r:any)=>r.code===d.code&&r.legal_form===v),ap=mine.find((r:any)=>r.status==='Approved')||null,dr=mine.find((r:any)=>r.status==='Draft')||null,ret=mine.find((r:any)=>r.status==='Returned'&&(!dr||r.version>dr.version))||null;
   entries.push({code:d.code,variant:v,title:d.title,group:d.group,applies_when:d.applies_when,forms:d.forms||null,review_hint:d.review_hint||null,built_in:builtInVariant(d.code,v),
    state:dr?'Waiting for a Partner':ap?'Approved':ret?'Returned':'Not prepared',approved:view(ap),draft:view(dr),returned:view(ret),drafted_by_me:!!dr&&dr.prepared_by===a.staff_id});
  }
  return {framework,edition,has_built_in:builtIn,entries,can_prepare:isLeader(a),can_review:a.category_code==='PARTNER',
   note:builtIn?'The built-in text is a draft to start from. Only wording a Partner has approved for this edition is used in a pack.':`There is no built-in wording for ${framework}.`,
   approved_count:entries.filter(e=>e.state==='Approved').length,total:entries.length};
 }
 if(p.action==='wording_library_prepare'){
  if(!isLeader(a))fail(403,'A Manager or Partner prepares the standard wording.');
  const {framework,edition}=basis(p);if(framework!==SME)fail(400,`There is no built-in wording for ${framework}.`);
  const code=text(p.code,40,true),variant=text(p.variant,20,true),body=p.body===undefined||p.body===null||p.body===''?null:text(p.body,4000,true);
  return await prepareOne(tx,a,framework,edition,code,variant,body);
 }
 if(p.action==='wording_library_prepare_all'){
  if(!isLeader(a))fail(403,'A Manager or Partner prepares the standard wording.');
  const {framework,edition}=basis(p);if(framework!==SME)fail(400,`There is no built-in wording for ${framework}.`);
  const have=await tx`select code,legal_form from erp_private.standard_wording where framework=${framework} and edition=${edition} and status in ('Draft','Approved')`,seen=new Set(have.map((r:any)=>r.code+'|'+r.legal_form));
  let n=0;for(const d of WORDING_DEFAULTS)for(const v of variantKeys(d.code)){if(seen.has(d.code+'|'+v))continue;await prepareOne(tx,a,framework,edition,d.code,v,null);n++;}
  return {prepared:n};
 }
 // review
 if(a.category_code!=='PARTNER')fail(403,'Only a Partner can approve or return the standard wording.');
 const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false);
 const ids=(Array.isArray(p.wording_ids)?p.wording_ids:[p.wording_id]).map((x:any)=>uuid(x));
 if(!ids.length||ids.length>60)fail(400,'Choose between 1 and 60 wording entries.');
 if(decision==='Returned'&&note.length<10)fail(400,'Give a reason of at least 10 characters.');
 const out:any[]=[];
 for(const id of [...new Set(ids)] as string[]){
  const w=(await tx`select wording_id,code,framework,edition,legal_form,title,status,prepared_by from erp_private.standard_wording where wording_id=${id}`)[0];
  if(!w||w.status!=='Draft')fail(409,'This wording has changed. Refresh and review the latest draft.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${'wording:'+w.framework+w.edition+w.code+w.legal_form},0))`;
  if(decision==='Returned'){await tx`update erp_private.standard_wording set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where wording_id=${id}`;out.push({code:w.code,status:'Returned'});continue;}
  const own=w.prepared_by===a.staff_id;
  if(own&&p.sole_partner_approval!==true)fail(403,`A different Partner approves wording you prepared ("${w.title}"). If you are your firm’s only Partner, confirm that when you approve.`);
  await tx`update erp_private.standard_wording set status='Superseded' where code=${w.code} and framework=${w.framework} and edition=${w.edition} and legal_form=${w.legal_form} and status='Approved'`;
  await tx`update erp_private.standard_wording set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where wording_id=${id}`;
  out.push({code:w.code,status:'Approved',sole_partner_approval:own});
 }
 return {reviewed:out};
}

// ---------- the year (disclosures and the assembled wording) ----------
async function loadDeclarations(tx:any,periodId:string){
 return await tx`select disclosure_id,code,version,state,body,status,declared_by,declared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(declared_by) declared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.period_disclosures where period_id=${periodId} and status in ('Draft','Approved','Returned') order by code,version desc`;
}
// The row the pack reads for each code: the approved one while there is one, otherwise the newest draft or returned one.
function pickDeclarations(rows:any[]){
 const out:any={};
 for(const r of rows){const cur=out[r.code];if(!cur||(r.status==='Approved'&&cur.status!=='Approved')||(cur.status!=='Approved'&&r.version>cur.version))out[r.code]=r;}
 return out;
}
async function loadOrder(tx:any,periodId:string):Promise<string[]>{
 const r=(await tx`select codes from erp_private.period_disclosure_order where period_id=${periodId}`)[0];return r?r.codes:[];
}
async function refuseIfLocked(tx:any,periodId:string){
 if((await tx`select 1 from erp_private.period_audit_locks where period_id=${periodId} and ended_at is null`).length)fail(409,'The pack is locked by an audit, so its disclosures cannot change. A Partner ends the lock first.');
}
// What the pack needs: the assembled wording for a built statements object (st = result of statementsFrom, or the parts it returns).
export async function wordingFor(tx:any,l:any,st:any){
 const refs=(st.statements?.notes?.items||[]).map((n:any)=>n.ref),form=st.client?.legal_form,reporting=st.reporting||{};
 const library=await approvedLibrary(tx,reporting.framework,reporting.edition),declRows=await loadDeclarations(tx,l.period_id),declarations=pickDeclarations(declRows),order=await loadOrder(tx,l.period_id);
 const asm=assembleWording({form,noteRefs:refs,entity:st.client?.name,asOf:st.as_of,reporting,library,declarations,order});
 return {asm,refs,declRows,declarations,order};
}

export async function wordingAction(tx:any,a:any,l:any,p:any,getStatements:(asOf:string)=>Promise<any>,asOf:string){
 const A=['ledger_wording_read','ledger_disclosure_declare','ledger_disclosure_review','ledger_disclosure_order'];
 if(!A.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Wording and disclosures are for staff who prepare or review statements.');
 if(p.action==='ledger_wording_read'){
  const st=await getStatements(asOf),w=await wordingFor(tx,l,st),req=requiredDisclosures({noteRefs:w.refs}),open=l.status==='Open';
  const locked=(await tx`select 1 from erp_private.period_audit_locks where period_id=${l.period_id} and ended_at is null`).length>0;
  const dis=req.map((d:any)=>{
   const rows=w.declRows.filter((r:any)=>r.code===d.code),ap=rows.find((r:any)=>r.status==='Approved')||null,dr=rows.find((r:any)=>r.status==='Draft')||null,ret=rows.find((r:any)=>r.status==='Returned'&&(!dr||r.version>dr.version)&&(!ap||r.version>ap.version))||null;
   const v=(r:any)=>r&&{disclosure_id:r.disclosure_id,version:r.version,state:r.state,body:r.body,declared_name:r.declared_name,declared_at:r.declared_at,reviewed_name:r.reviewed_name,reviewed_at:r.reviewed_at,review_note:r.review_note,sole_partner_approval:r.sole_partner_approval};
   return {code:d.code,title:d.title,hint:d.hint,allow_nothing:d.allow_nothing,inline:d.code.startsWith('POLICY_'),state:dr?'Waiting for approval':ap?'Approved':ret?'Returned':'Not declared',approved:v(ap),draft:v(dr),returned:v(ret),
    can_review:isLeader(a)&&open&&!locked&&!!dr&&(dr.declared_by!==a.staff_id||a.category_code==='PARTNER'),declared_by_me:!!dr&&dr.declared_by===a.staff_id};
  });
  const order=w.asm.order;
  return {sections:w.asm.sections,problems:w.asm.problems,complete:w.asm.complete,disclosures:dis.sort((x:any,y:any)=>order.indexOf(x.code)-order.indexOf(y.code)),order,
   framework:st.reporting?.framework||null,edition:st.reporting?.edition||null,legal_form:st.client?.legal_form||null,locked,
   can_declare:canDeclare(a)&&open&&!locked,can_order:isLeader(a)&&open&&!locked,
   note:'The wording sits before and after the numbered system notes. It is built from the library wording a Partner approved for this edition and the disclosures approved for this year; it never changes a figure.'};
 }
 if(l.status!=='Open')fail(409,'This ledger year is closed. Its disclosures can no longer be changed.');
 if(p.action==='ledger_disclosure_declare'){
  if(!canDeclare(a))fail(403,'Staff who prepare the statements declare disclosures.');
  const code=text(p.code,40,true),state=text(p.state,30,true),body=state==='Nothing to report'?null:text(p.body,4000,true);
  const bad=validateDeclaration({code,state,body});if(bad)fail(400,bad);
  const st=await getStatements(asOf),refs=(st.statements?.notes?.items||[]).map((n:any)=>n.ref);
  if(!requiredDisclosures({noteRefs:refs}).some((d:any)=>d.code===code))fail(400,`"${disclosureDef(code)?.title}" is not needed for this client year: the year has no ${disclosureDef(code)?.required} note.`);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':disclosure:'+code},0))`;
  await refuseIfLocked(tx,l.period_id);
  const cur=await tx`select status,state,body from erp_private.period_disclosures where period_id=${l.period_id} and code=${code} and status in ('Draft','Approved')`;
  const ap=cur.find((r:any)=>r.status==='Approved');
  if(ap&&ap.state===state&&(ap.body||null)===(body||null)&&!cur.some((r:any)=>r.status==='Draft'))fail(409,'This is already approved as declared.');
  await tx`update erp_private.period_disclosures set status='Superseded' where period_id=${l.period_id} and code=${code} and status='Draft'`;
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.period_disclosures where period_id=${l.period_id} and code=${code}`)[0].v);
  return (await tx`insert into erp_private.period_disclosures(period_id,project_id,client_id,code,version,state,body,declared_by) values(${l.period_id},${l.project_id},${l.client_id},${code},${ver},${state},${body},${a.staff_id}) returning disclosure_id,code,version,status`)[0];
 }
 if(p.action==='ledger_disclosure_review'){
  if(!isLeader(a))fail(403,'A Manager or Partner approves or returns a disclosure.');
  const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false),id=uuid(p.disclosure_id);
  const d=(await tx`select disclosure_id,period_id,code,status,declared_by from erp_private.period_disclosures where disclosure_id=${id}`)[0];
  if(!d||d.period_id!==l.period_id||d.status!=='Draft')fail(409,'This disclosure has changed. Refresh and review the latest one.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':disclosure:'+d.code},0))`;
  await refuseIfLocked(tx,l.period_id);
  if(decision==='Returned'){
   if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
   await tx`update erp_private.period_disclosures set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where disclosure_id=${id}`;
   return {status:'Returned'};
  }
  const own=d.declared_by===a.staff_id;
  if(own&&(a.category_code!=='PARTNER'||p.sole_partner_approval!==true))fail(403,'Someone else approves a disclosure you declared. If you are your firm’s only Partner, confirm that when you approve.');
  await tx`update erp_private.period_disclosures set status='Superseded' where period_id=${l.period_id} and code=${d.code} and status='Approved'`;
  await tx`update erp_private.period_disclosures set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where disclosure_id=${id}`;
  return {status:'Approved',sole_partner_approval:own};
 }
 // order
 if(!isLeader(a))fail(403,'A Manager or Partner sets the order of the disclosures.');
 await refuseIfLocked(tx,l.period_id);
 const codes=(Array.isArray(p.codes)?p.codes:[]).map((c:any)=>text(c,40,true));
 if(!codes.length||codes.some((c:string)=>!DISCLOSURE_CODES.includes(c))||new Set(codes).size!==codes.length)fail(400,'List each disclosure once, using the ones shown.');
 await tx`insert into erp_private.period_disclosure_order(period_id,project_id,client_id,codes,updated_by) values(${l.period_id},${l.project_id},${l.client_id},${codes},${a.staff_id}) on conflict (period_id) do update set codes=excluded.codes,updated_by=excluded.updated_by,updated_at=now()`;
 return {order:codes};
}
