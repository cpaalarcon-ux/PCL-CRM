import {fail,text,uuid,choice} from './validation.mjs';
import {buildClientPages,validateDeclaration,fieldsFor,pageTitle,draftStatement,servedInYear,longDate,PAGE_CODES,PAGES_VERSION} from './annual-pack-client-pages.mjs';
import {shareStateFor} from './partner-shares-actions.ts';
// Client-specific pages (build 2884): entity information, the report of the directors or partners and the statement of responsibilities are declared per ledger year and approved by a Manager or Partner who
// did not declare them. The cover and the key figures are built from verified client facts and the statements. People named come from the client's own records. The server owns every rule.
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const canDeclare=(a:any)=>['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code);
const FACT_KEYS=['registration_number','incorporation_date','registered_address','po_box','postal_code','postal_town'];

async function loadRows(tx:any,periodId:string){
 return await tx`select page_id,code,version,state,fields,reason,status,declared_by,declared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(declared_by) declared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.period_client_pages where period_id=${periodId} and status in ('Draft','Approved','Returned') order by code,version desc`;
}
const shape=(r:any)=>r&&{page_id:r.page_id,version:r.version,state:r.state,fields:r.fields||{},reason:r.reason||null,declared_name:r.declared_name,declared_at:r.declared_at,reviewed_name:r.reviewed_name,reviewed_at:r.reviewed_at,review_note:r.review_note,sole_partner_approval:r.sole_partner_approval};
function recordsFrom(rows:any[]){
 const out:any={};
 for(const code of PAGE_CODES){
  const mine=rows.filter((r:any)=>r.code===code),ap=mine.find((r:any)=>r.status==='Approved')||null,dr=mine.find((r:any)=>r.status==='Draft')||null,ret=mine.find((r:any)=>r.status==='Returned'&&(!dr||r.version>dr.version)&&(!ap||r.version>ap.version))||null;
  out[code]={approved:ap&&{state:ap.state==='Declared'?'Declared':'Not applicable',fields:ap.fields||{},reason:ap.reason||null},draft:dr,returned:ret,rows:{ap,dr,ret}};
 }
 return out;
}
// What the pages are built from: only verified client facts, the people on the client's records, and approved records.
async function loadInputs(tx:any,l:any,clientName:string){
 const facts:any={company_name:clientName||null};
 for(const f of await tx`select field_key,value from erp_private.client_field_facts where client_id=${l.client_id} and status='Verified' and field_key=any(${FACT_KEYS})`)facts[f.field_key]=String(f.value).trim();
 const directors=await tx`select full_name,appointed_on,ceased_on from erp_private.client_page_directors(${l.client_id})`;
 const officers=await tx`select holder_name,holder_position,kind from erp_private.client_office_holders where client_id=${l.client_id} and status='Verified' order by kind,recorded_at`;
 const sh=await shareStateFor(tx,l.period_id),partners=sh.status==='approved'?sh.lines.map((x:any)=>x.partner_name):[];
 const pa=(await tx`select body from erp_private.period_disclosures where period_id=${l.period_id} and code='PRINCIPAL_ACTIVITY' and status='Approved' and state='Text'`)[0];
 const day=(d:any)=>String(d instanceof Date?d.toISOString():d).slice(0,10);
 return {facts,directors:directors.map((d:any)=>({full_name:d.full_name,appointed_on:day(d.appointed_on),ceased_on:d.ceased_on?day(d.ceased_on):null})),officers,partners,principalActivity:pa?.body||null};
}
const dayOf=(d:any)=>String(d instanceof Date?d.toISOString():d).slice(0,10);
function candidatesFor(form:string,inp:any,l:any){
 const start=dayOf(l.starts_on),end=dayOf(l.ends_on),names=new Set<string>();
 if(form==='Company')for(const d of servedInYear(inp.directors,start,end))names.add(d.full_name);
 if(form==='Partnership')for(const n of inp.partners)names.add(n);
 if(form==='Sole proprietor'&&inp.facts.company_name)names.add(inp.facts.company_name);
 for(const o of inp.officers)names.add(o.holder_name);
 return [...names];
}
// For the pack: the built pages for a year. st = {statements,client:{name,legal_form},reporting}.
export async function pagesFor(tx:any,l:any,st:any){
 const form=st.client?.legal_form,inp=await loadInputs(tx,l,st.client?.name||''),recs=recordsFrom(await loadRows(tx,l.period_id));
 const built=buildClientPages({form,entity:st.client?.name,period:{starts_on:dayOf(l.starts_on),ends_on:dayOf(l.ends_on)},facts:inp.facts,directors:inp.directors,partners:inp.partners,officers:inp.officers,
  records:Object.fromEntries(PAGE_CODES.map((c:string)=>[c,{approved:recs[c].approved,draft:recs[c].draft,returned:recs[c].returned}])),principalActivity:inp.principalActivity,statements:st.statements,reporting:st.reporting});
 return {built,recs,inp,form};
}
async function refuseIfLocked(tx:any,periodId:string){
 if((await tx`select 1 from erp_private.period_audit_locks where period_id=${periodId} and ended_at is null`).length)fail(409,'The pack is locked by an audit, so its pages cannot change. A Partner ends the lock first.');
}
export async function pagesAction(tx:any,a:any,l:any,p:any,getStatements:(asOf:string)=>Promise<any>,asOf:string){
 if(!['ledger_pages_read','ledger_page_declare','ledger_page_review'].includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The client pages are for staff who prepare or review statements.');
 const open=l.status==='Open';
 if(p.action==='ledger_pages_read'){
  const st=await getStatements(asOf),pg=await pagesFor(tx,l,{statements:st.statements,client:st.client,reporting:st.reporting}),form=pg.form;
  const locked=(await tx`select 1 from erp_private.period_audit_locks where period_id=${l.period_id} and ended_at is null`).length>0;
  const cands=candidatesFor(form,pg.inp,l),secretary=pg.inp.officers.some((o:any)=>/secretary/i.test(o.holder_position));
  const declared=PAGE_CODES.map((code:string)=>{
   const r=pg.recs[code],dr=r.rows.dr;
   return {code,title:pageTitle(code,form),fields:fieldsFor(code,form,{secretaryOnRecord:secretary}),can_be_not_applicable:code!=='ENTITY_INFO',
    state:dr?'Waiting for approval':r.rows.ap?'Approved':r.rows.ret?'Returned':'Not declared',approved:shape(r.rows.ap),draft:shape(dr),returned:shape(r.rows.ret),declared_by_me:!!dr&&dr.declared_by===a.staff_id,
    can_review:isLeader(a)&&open&&!locked&&!!dr&&(dr.declared_by!==a.staff_id||a.category_code==='PARTNER')&&(dr.state!=='Not applicable'||a.category_code==='PARTNER'),
    prefill:code==='RESPONSIBILITIES'?{statement:draftStatement({form,entity:st.client?.name,yearEnd:longDate(dayOf(l.ends_on)),framework:st.reporting?.framework,edition:st.reporting?.edition}),signatory_choices:cands,
     note:'This text is a draft to read and change. Only the text a reviewer approves is printed.'}:null};
  });
  return {version:PAGES_VERSION,form,pages:pg.built.pages,declared,complete:pg.built.complete,problems:pg.built.problems,candidates:cands,locked,can_declare:canDeclare(a)&&open&&!locked,
   note:'The cover and the key figures are built from verified client facts and the statements. The other pages are declared for the year and approved by someone who did not declare them. Nothing here changes a figure.'};
 }
 if(!open)fail(409,'This ledger year is closed. Its pages can no longer be changed.');
 if(p.action==='ledger_page_declare'){
  if(!canDeclare(a))fail(403,'Staff who prepare the statements declare the client pages.');
  const code=text(p.code,40,true);if(!PAGE_CODES.includes(code))fail(400,'That page is not one that is declared.');
  const st=await getStatements(asOf),form=st.client?.legal_form,inp=await loadInputs(tx,l,st.client?.name||'');
  const secretary=inp.officers.some((o:any)=>/secretary/i.test(o.holder_position));
  const v=validateDeclaration({code,form,state:text(p.state,30,true),reason:p.reason===undefined?null:text(p.reason,500),fields:p.fields&&typeof p.fields==='object'?p.fields:{},period:{ends_on:dayOf(l.ends_on)},candidates:candidatesFor(form,inp,l),secretaryOnRecord:secretary});
  if(v.error)fail(400,v.error);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':page:'+code},0))`;
  await refuseIfLocked(tx,l.period_id);
  const state=p.state,fields=v.fields||{},reason=v.reason||null;
  const cur=await tx`select status,state,fields,reason from erp_private.period_client_pages where period_id=${l.period_id} and code=${code} and status in ('Draft','Approved')`,ap=cur.find((r:any)=>r.status==='Approved');
  if(ap&&ap.state===state&&JSON.stringify(ap.fields)===JSON.stringify(fields)&&(ap.reason||null)===reason&&!cur.some((r:any)=>r.status==='Draft'))fail(409,'This is already approved as declared.');
  await tx`update erp_private.period_client_pages set status='Superseded' where period_id=${l.period_id} and code=${code} and status='Draft'`;
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.period_client_pages where period_id=${l.period_id} and code=${code}`)[0].v);
  return (await tx`insert into erp_private.period_client_pages(period_id,project_id,client_id,code,version,state,fields,reason,declared_by) values(${l.period_id},${l.project_id},${l.client_id},${code},${ver},${state},${tx.json(fields)},${reason},${a.staff_id}) returning page_id,code,version,status`)[0];
 }
 // review
 if(!isLeader(a))fail(403,'A Manager or Partner approves or returns a client page.');
 const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false),id=uuid(p.page_id);
 const d=(await tx`select page_id,period_id,code,state,status,declared_by from erp_private.period_client_pages where page_id=${id}`)[0];
 if(!d||d.period_id!==l.period_id||d.status!=='Draft')fail(409,'This page has changed. Refresh and review the latest one.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':page:'+d.code},0))`;
 await refuseIfLocked(tx,l.period_id);
 if(decision==='Returned'){
  if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`update erp_private.period_client_pages set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where page_id=${id}`;
  return {status:'Returned'};
 }
 if(d.state==='Not applicable'&&a.category_code!=='PARTNER')fail(403,'A Partner approves a page that is declared as not applicable.');
 const own=d.declared_by===a.staff_id;
 if(own&&(a.category_code!=='PARTNER'||p.sole_partner_approval!==true))fail(403,'Someone else approves a page you declared. If you are your firm’s only Partner, confirm that when you approve.');
 await tx`update erp_private.period_client_pages set status='Superseded' where period_id=${l.period_id} and code=${d.code} and status='Approved'`;
 await tx`update erp_private.period_client_pages set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where page_id=${id}`;
 return {status:'Approved',sole_partner_approval:own};
}
