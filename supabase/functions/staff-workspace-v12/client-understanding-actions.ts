import {fail,text,uuid,revision,documentObjectKey} from './validation.mjs';
import {SECTIONS,cleanSections,missingSections,canPrepare,canFile,reviewProblem,understandingState,digestInput,factRows} from './client-understanding-rules.mjs';
import {fieldFor} from './client-master-rules.mjs';
import {permanentFilePdf} from './permanent-file-pdf.mjs';
import {clientFilingPrefix} from './engagement-setup-rules.mjs';
import {pdfLib} from './suite-actions.ts';
// Build 2867: "Understanding the Client" (versioned, reviewed by a different Manager or Partner) and the Permanent File PDF compiled from recorded facts only.
// Saving, submitting and approving the narrative never change the client's facts or any approval elsewhere. Filing the PDF puts one document in the client's Permanent File folder.
// Table rules are in 20261121180000_client_understanding.sql.
const ACTIONS=['client_understanding_read','client_understanding_save','client_understanding_submit','client_understanding_return','client_understanding_approve','client_pf_preview','client_pf_file'];
const day=(v:any)=>v?(v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10)):null;
const nairobi=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
const hex=async(s:string|Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof s==='string'?new TextEncoder().encode(s):s))].map(b=>b.toString(16).padStart(2,'0')).join('');

async function versions(tx:any,cid:string){
 return await tx`select u.understanding_id,u.version,u.status,u.sections,u.prepared_by,u.prepared_at,u.submitted_by,u.submitted_at,u.returned_at,u.return_note,u.approved_by,u.approved_at,u.sole_partner_approval,u.superseded_at,u.superseded_reason,u.revision,
  erp_private.staff_name(u.prepared_by) as prepared_by_name,erp_private.staff_name(u.submitted_by) as submitted_by_name,erp_private.staff_name(u.returned_by) as returned_by_name,erp_private.staff_name(u.approved_by) as approved_by_name,erp_private.staff_name(u.superseded_by) as superseded_by_name
  from erp_private.client_understanding u where u.client_id=${cid} order by u.version desc`;
}
async function liveFacts(tx:any,cid:string){
 return await tx`select f.field_key,f.value,f.status,f.source_kind,f.source_reference,f.verified_at,erp_private.staff_name(f.verified_by) as verified_by_name,d.doc_ref
  from erp_private.client_field_facts f left join erp_private.documents d on d.document_id=f.document_id where f.client_id=${cid} and f.status in('Recorded','Verified') order by f.field_key`;
}
async function amlStatus(tx:any,cid:string){
 const r=(await tx`select stage,decision,risk_rating,decided_at,next_review::text,edd_required from erp_private.client_aml_profiles where client_id=${cid}`)[0];
 return r?{stage:r.stage,decision:r.decision,risk_rating:r.risk_rating,decided_on:day(r.decided_at),next_review:day(r.next_review),edd_required:!!r.edd_required}:null;
}
async function issues(tx:any,cid:string){
 return await tx`select i.issue_id,i.document_id,i.understanding_id,i.facts_digest,i.fact_count,i.aml_stage,i.issued_at,d.doc_ref,d.file_name,erp_private.staff_name(i.issued_by) as issued_by_name,u.version as understanding_version
  from erp_private.permanent_file_issues i join erp_private.documents d on d.document_id=i.document_id join erp_private.client_understanding u on u.understanding_id=i.understanding_id where i.client_id=${cid} order by i.issued_at desc limit 20`;
}
const present=(x:any)=>({understanding_id:x.understanding_id,version:x.version,status:x.status,sections:x.sections||{},prepared_by:x.prepared_by,prepared_by_name:x.prepared_by_name,prepared_at:x.prepared_at,submitted_by:x.submitted_by,submitted_by_name:x.submitted_by_name,submitted_at:x.submitted_at,returned_by_name:x.returned_by_name,returned_at:x.returned_at,return_note:x.return_note,approved_by_name:x.approved_by_name,approved_at:x.approved_at,sole_partner_approval:x.sole_partner_approval,superseded_at:x.superseded_at,superseded_reason:x.superseded_reason,revision:String(x.revision)});

async function compile(tx:any,a:any,cid:string,firmId:any){
 const client=(await tx`select client_id,company_name,trading_name,kra_pin,legal_entity_type from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!client)fail(403,'This client is unavailable to your account.');
 const firms=await tx`select f.firm_id,f.legal_name,f.physical_address,f.phone,f.email from erp_private.client_firm_links l join erp_private.firms f on f.firm_id=l.firm_id where l.client_id=${cid} and l.deleted_at is null order by f.legal_name`;
 if(!firms.length)fail(400,'This client is not linked to a handling firm yet.');
 const fid=firmId?uuid(firmId):(firms.length===1?firms[0].firm_id:fail(400,'Choose the handling firm.'));
 const firm=firms.find((f:any)=>f.firm_id===fid)||fail(403,'That firm is not linked to this client.');
 const facts=await liveFacts(tx,cid),aml=await amlStatus(tx,cid),rows=await versions(tx,cid),approved=rows.find((r:any)=>r.status==='Approved')||null;
 const digest=await hex(digestInput({facts,understanding:approved,aml}));
 return {client,firm,firms,facts,aml,rows,approved,digest};
}
async function read(tx:any,a:any,cid:string){
 const c=await compile(tx,a,cid,null).catch((e:any)=>{if(String(e?.message||'').includes('Choose the handling firm'))return null;throw e;});
 if(!c){ // several firms: the narrative and facts do not depend on the firm, so read them without choosing one
  const client=(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];if(!client)fail(403,'This client is unavailable to your account.');
  const facts=await liveFacts(tx,cid),aml=await amlStatus(tx,cid),rows=await versions(tx,cid),approved=rows.find((r:any)=>r.status==='Approved')||null,digest=await hex(digestInput({facts,understanding:approved,aml}));
  return shape(tx,a,cid,{client,firms:await tx`select f.firm_id,f.legal_name from erp_private.client_firm_links l join erp_private.firms f on f.firm_id=l.firm_id where l.client_id=${cid} and l.deleted_at is null order by f.legal_name`,facts,aml,rows,approved,digest});
 }
 return shape(tx,a,cid,c);
}
async function shape(tx:any,a:any,cid:string,c:any){
 const iss=await issues(tx,cid),state=understandingState({rows:c.rows,issues:iss,digest:c.digest});
 return {client:{client_id:cid,name:c.client.company_name},sections:SECTIONS,firms:c.firms.map((f:any)=>({firm_id:f.firm_id,legal_name:f.legal_name})),
  approved:state.approved?present(state.approved):null,open:state.open?present(state.open):null,history:c.rows.filter((r:any)=>r.status==='Superseded').map(present),
  file:state.file,issues:iss.map((i:any)=>({issue_id:i.issue_id,document_id:i.document_id,doc_ref:i.doc_ref,file_name:i.file_name,issued_at:i.issued_at,issued_by_name:i.issued_by_name,understanding_version:i.understanding_version,fact_count:i.fact_count,aml_stage:i.aml_stage})),
  facts:{count:c.facts.length,verified:c.facts.filter((f:any)=>f.status==='Verified').length},aml:c.aml,
  can_prepare:canPrepare(a.category_code),can_file:canFile(a.category_code)&&!!state.approved,can_preview:canFile(a.category_code)};
}
async function render(tx:any,a:any,c:any,draft:boolean){
 const lib=pdfLib();if(!lib)fail(500,'PDF generation is not available.');
 const issuedAt=new Date(),u=c.approved;
 const bytes=await permanentFilePdf({draft,issued_at:issuedAt.toISOString(),issued_on:nairobi(),issued_by_name:(await tx`select erp_private.staff_name(${a.staff_id}) as n`)[0].n,digest:c.digest,
  firm:c.firm,client:{name:c.client.company_name,trading_name:c.client.trading_name,kra_pin:c.client.kra_pin,entity_type:c.client.legal_entity_type},
  facts:factRows(c.facts,fieldFor),
  understanding:u?{version:u.version,sections:u.sections||{},prepared_by_name:u.prepared_by_name,approved_by_name:u.approved_by_name,approved_on:day(u.approved_at),sole_partner_approval:u.sole_partner_approval}:null,aml:c.aml},lib);
 return bytes;
}
const b64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(s);};

export async function clientUnderstandingAction(tx:any,a:any,p:any,storage:any,bucket:()=>Promise<void>):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The understanding of the client is kept by staff with client access.');
 const cid=uuid(p.client_id);
 await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':understanding'},0))`;
 if(p.action==='client_understanding_read')return await read(tx,a,cid);
 if(p.action==='client_pf_preview'){
  if(!canFile(a.category_code))fail(403,'A Manager or Partner prepares the Permanent File.');
  const c=await compile(tx,a,cid,p.firm_id),bytes=await render(tx,a,c,!c.approved);
  return {file_name:`Permanent_File_${nairobi()}${c.approved?'':'_DRAFT'}.pdf`,mime_type:'application/pdf',base64:b64(bytes),draft:!c.approved};
 }
 if(p.action==='client_pf_file'){
  if(!canFile(a.category_code))fail(403,'A Manager or Partner files the Permanent File.');
  const c=await compile(tx,a,cid,p.firm_id);
  if(!c.approved)fail(409,'The Permanent File is filed after the understanding of the client is approved. Until then it can only be previewed.');
  const bytes=await render(tx,a,c,false),sha=await hex(bytes);
  const [allow]=await tx`select erp_private.document_allowed(${cid}::uuid,${c.firm.firm_id}::uuid,null::uuid,null::uuid,'Permanent File',true) as allowed`;
  if(!allow.allowed)fail(403,'This record or action is not available to your account.');
  const n=Number((await tx`select count(*)::int as n from erp_private.permanent_file_issues where client_id=${cid}`)[0].n)+1;
  const name=`Permanent_File_${nairobi()}_v${n}.pdf`,doc=crypto.randomUUID();
  const key=documentObjectKey(cid,c.firm.firm_id,doc,'application/pdf',clientFilingPrefix('Permanent File',c.client.company_name,cid));
  await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,import_purpose,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${doc},${cid},${c.firm.firm_id},null,null,'Permanent File','General',${name},${key},${bytes.length},${sha},'application/pdf',${a.staff_id})`;
  await tx`insert into erp_private.permanent_file_issues(client_id,document_id,understanding_id,facts_digest,fact_count,aml_stage,issued_by) values(${cid},${doc},${c.approved.understanding_id},${c.digest},${c.facts.length},${c.aml?.stage||null},${a.staff_id})`;
  await bucket();
  const up=await storage.upload(key,bytes,{contentType:'application/pdf',upsert:false});
  if(up.error)fail(502,'The file could not be stored. Nothing was recorded. Try again or ask your Manager.');
  await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${doc},${a.auth_user_id},'UPLOAD')`;
  return {ok:true,document_id:doc,file_name:name};
 }
 // The remaining actions change the narrative only.
 if(!canPrepare(a.category_code)&&p.action!=='client_understanding_return'&&p.action!=='client_understanding_approve')fail(403,'A Supervisor, Manager or Partner writes the understanding of the client.');
 const rows=await versions(tx,cid),open=rows.find((r:any)=>['Draft','Submitted'].includes(r.status))||null,approved=rows.find((r:any)=>r.status==='Approved')||null;
 if(p.action==='client_understanding_save'){
  const {sections,problems}=cleanSections(p.sections);if(problems.length)fail(400,problems[0]);
  if(!Object.keys(sections).length)fail(400,'Write at least one section before saving.');
  if(open){
   if(open.status!=='Draft')fail(409,'This version is waiting for review. Ask the reviewer to return it before it is edited.');
   if(open.prepared_by!==a.staff_id&&!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only the preparer, or a Manager or Partner, edits this draft.');
   if(String(open.revision)!==revision(p.revision))fail(409,'This draft changed. Refresh first.');
   await tx`update erp_private.client_understanding set sections=${tx.json(sections)} where understanding_id=${open.understanding_id}`;
   return {ok:true,version:open.version};
  }
  const v=(rows[0]?.version||0)+1;
  await tx`insert into erp_private.client_understanding(client_id,version,sections,prepared_by) values(${cid},${v},${tx.json(sections)},${a.staff_id})`;
  return {ok:true,version:v};
 }
 if(!open)fail(409,'There is no version waiting. Save a draft first.');
 if(String(open.revision)!==revision(p.revision))fail(409,'This version changed. Refresh first.');
 if(p.action==='client_understanding_submit'){
  if(open.status!=='Draft')fail(409,'This version has already been submitted.');
  const miss=missingSections(open.sections);if(miss.length)fail(400,'Complete these sections first (at least 20 characters each): '+miss.join(', ')+'.');
  await tx`update erp_private.client_understanding set status='Submitted',submitted_by=${a.staff_id},submitted_at=now() where understanding_id=${open.understanding_id}`;
  return {ok:true};
 }
 const sole=!!(await tx`select erp_private.sole_active_partner() as s`)[0].s;
 const bad=reviewProblem({row:{...open,status:open.status},staffId:a.staff_id,category:a.category_code,soleActivePartner:sole});if(bad)fail(403,bad);
 if(p.action==='client_understanding_return'){
  const note=text(p.note,500);if(note.trim().length<3)fail(400,'Say what needs to change (at least 3 characters).');
  await tx`update erp_private.client_understanding set status='Draft',return_note=${note},returned_by=${a.staff_id},returned_at=now(),submitted_by=null,submitted_at=null where understanding_id=${open.understanding_id}`;
  return {ok:true};
 }
 // approve
 const miss=missingSections(open.sections);if(miss.length)fail(400,'This version is missing: '+miss.join(', ')+'.');
 const selfApproved=open.prepared_by===a.staff_id||open.submitted_by===a.staff_id;
 if(approved)await tx`update erp_private.client_understanding set status='Superseded',superseded_by=${a.staff_id},superseded_at=now(),superseded_reason=${'Replaced by version '+open.version} where understanding_id=${approved.understanding_id}`;
 await tx`update erp_private.client_understanding set status='Approved',approved_by=${a.staff_id},approved_at=now(),sole_partner_approval=${selfApproved} where understanding_id=${open.understanding_id}`;
 return {ok:true,version:open.version,sole_partner_approval:selfApproved};
}
