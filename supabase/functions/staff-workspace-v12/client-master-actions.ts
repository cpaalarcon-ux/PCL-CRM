import {fail,text,uuid,revision,choice} from './validation.mjs';
import {loadClientTemplate} from './client-template-data.ts';
import {FIELDS,SOURCE_KINDS,cleanValue,sourceProblem,readiness,canVerify,setupReport,elapsedMinutes,fieldFor} from './client-master-rules.mjs';
// Client master (build 2807): record each key fact with its source, verify it independently, and measure how long set-up takes.
// The rules are in client-master-rules.mjs and the table rules in 20261115120000_client_master_facts.sql. Nothing here changes the client record itself.
const ACTIONS=['client_master_read','client_master_record','client_master_verify','client_master_report','client_holder_record','client_holder_verify','client_holder_end'];
const KINDS=['Officer','Signatory'],BASES=['Resolution','Governing document','Establishing instrument','Court grant','Registration record'];
const REVIEWERS=['PARTNER','MANAGER','SUPERVISOR'];

async function load(tx:any,a:any,cid:string){
 const client=(await tx`select client_id,company_name,kra_pin,legal_entity_type from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!client)fail(403,'This client is unavailable to your account.');
 const facts=await tx`select f.*,rb.full_name as recorded_by_name,vb.full_name as verified_by_name,d.file_name as document_name from erp_private.client_field_facts f
  left join erp_private.staff_members rb on rb.staff_id=f.recorded_by left join erp_private.staff_members vb on vb.staff_id=f.verified_by left join erp_private.documents d on d.document_id=f.document_id
  where f.client_id=${cid} order by f.field_key,f.recorded_at desc`;
 const ms=await tx`select milestone,reached_at from erp_private.client_setup_milestones where client_id=${cid}`;
 const tpl=await loadClientTemplate(tx,a,cid,facts,client);
 return {client,facts,ms,tpl};
}
function view(a:any,{client,facts,ms,tpl}:any){
 // With a client-type template the template decides which facts are required; without one the older entity-type list applies.
 // A legal structure with no template is shown as missing a template, never guessed.
 const rd=tpl?.template
  ?{...tpl.checklist,rows:tpl.checklist.facts,required:tpl.checklist.counts.facts.required,verified:tpl.checklist.counts.facts.verified,ready:tpl.checklist.facts_ready,percent:tpl.checklist.counts.facts.required?Math.round(tpl.checklist.counts.facts.verified*100/tpl.checklist.counts.facts.required):0,exceptions:tpl.checklist.exceptions.filter((e:any)=>!/^(evidence|party|licence):/.test(e.key))}
  :readiness({entityType:client.legal_entity_type,facts,master:{company_name:client.company_name,kra_pin:client.kra_pin},...(tpl&&tpl.structure?{templateKnown:false,unknownIssue:'This legal structure has no client-type template yet. A Partner chooses which template applies.'}:{})});
 const started=ms.find((m:any)=>m.milestone==='Started')?.reached_at||null,ready=ms.find((m:any)=>m.milestone==='Ready')?.reached_at||null;
 const names=new Map(facts.map((f:any)=>[f.fact_id,f]));
 for(const r of rd.rows){if(r.fact){const f:any=names.get(r.fact.fact_id);r.fact.recorded_by_name=f.recorded_by_name;r.fact.verified_by_name=f.verified_by_name;r.fact.document_name=f.document_name;r.can_verify=canVerify({status:r.fact.status,recorded_by:r.fact.recorded_by,source_kind:r.fact.source_kind},a)&&!((tpl?.fields||[]).some((x:any)=>x.field_key===r.key&&x.partner_verified)&&a.category_code!=='PARTNER');}}
 const history=facts.filter((f:any)=>f.status==='Superseded').map((f:any)=>({field_key:f.field_key,value:f.value,source_kind:f.source_kind,recorded_by_name:f.recorded_by_name,recorded_at:f.recorded_at,superseded_at:f.superseded_at,superseded_reason:f.superseded_reason}));
 return {client:{client_id:client.client_id,company_name:client.company_name,legal_entity_type:client.legal_entity_type||null},...rd,history,started_at:started,ready_at:ready,minutes_to_ready:ready?elapsedMinutes(started,ready):null,
  template:tpl?.template?{template_code:tpl.template.template_code,name:tpl.template.name,controls:tpl.template.controls,structure:tpl.structure,subtype:tpl.subtype,evidence:tpl.checklist.evidence,parties:tpl.checklist.parties,licences:tpl.checklist.licences,restricted:!!tpl.checklist.restricted,file_ready:tpl.checklist.ready}:null,
  holders:(tpl?.holders||[]).map((h:any)=>({holder_id:h.holder_id,kind:h.kind,holder_name:h.holder_name,holder_position:h.holder_position,authority:h.authority,basis_kind:h.basis_kind,document_name:h.document_name||null,source_reference:h.source_reference||null,status:h.status,recorded_by_name:h.recorded_by_name,recorded_at:h.recorded_at,verified_by_name:h.verified_by_name||null,verified_at:h.verified_at||null,verification_note:h.verification_note||null,revision:h.revision,can_verify:h.status==='Recorded'&&REVIEWERS.includes(a.category_code)&&h.recorded_by!==a.staff_id,can_end:REVIEWERS.includes(a.category_code)})),
  holder_rules:tpl?.checklist?.holders||[],kinds:KINDS,basis_kinds:BASES,
  source_kinds:SOURCE_KINDS,fields:FIELDS.map((f:any)=>({key:f.key,label:f.label,hint:f.hint})),can_record:!['INTERN','ADMIN'].includes(a.category_code),
  note:'A fact is verified by a different Supervisor, Manager or Partner against its source. The client\'s own statement alone is never verified.'};
}
async function milestone(tx:any,a:any,cid:string,name:string,detail:any){
 await tx`insert into erp_private.client_setup_milestones(client_id,milestone,reached_by,detail) values(${cid},${name},${a.staff_id},${tx.json(detail)}) on conflict do nothing`;
}

export async function clientMasterAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The client master is kept by staff with client access.');

 if(p.action==='client_master_report'){
  if(!REVIEWERS.includes(a.category_code))fail(403,'A Supervisor, Manager or Partner reads the set-up report.');
  const rows=await tx`select c.client_id,c.company_name,s.reached_at as started_at,r.reached_at as ready_at,
    (select count(*)::int from erp_private.client_field_facts f where f.client_id=c.client_id and f.status<>'Superseded' and f.source_kind='Client statement') as statement_only
   from erp_private.client_setup_milestones s join erp_private.clients c on c.client_id=s.client_id and c.deleted_at is null
   left join erp_private.client_setup_milestones r on r.client_id=s.client_id and r.milestone='Ready'
   where s.milestone='Started' order by s.reached_at desc limit 500`;
  const baseline=p.baseline_minutes===undefined||p.baseline_minutes===''?null:Number(p.baseline_minutes);
  return {rows:rows.map((r:any)=>({client_id:r.client_id,company_name:r.company_name,started_at:r.started_at,ready_at:r.ready_at,minutes:r.ready_at?elapsedMinutes(r.started_at,r.ready_at):null,statement_only:r.statement_only})),summary:setupReport(rows,baseline)};
 }

 const cid=p.fact_id?uuid((await tx`select client_id from erp_private.client_field_facts where fact_id=${uuid(p.fact_id)}`)[0]?.client_id||fail(403,'This fact is unavailable to your account.')):p.holder_id?uuid((await tx`select client_id from erp_private.client_office_holders where holder_id=${uuid(p.holder_id)}`)[0]?.client_id||fail(403,'This record is unavailable to your account.')):uuid(p.client_id);
 await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-master'},0))`;
 const data=await load(tx,a,cid);
 if(p.action==='client_master_read')return view(a,data);

 // Officers and signatories (build 2813): separate records with the person, position, authority and the paper that supports them.
 if(p.action==='client_holder_record'){
  const kind=choice(p.kind,KINDS),basis=choice(p.basis_kind,BASES);
  const name=text(p.holder_name||'',120).trim(),position=text(p.holder_position||'',120).trim(),authority=text(p.authority||'',300).trim();
  if(name.length<2)fail(400,'Enter the person\'s name.');if(position.length<2)fail(400,'Enter the position.');if(authority.length<5)fail(400,'Say what they are authorised to do (at least 5 characters).');
  const documentId=p.document_id?uuid(p.document_id):null,ref=p.source_reference?text(p.source_reference,300).trim():null;
  if(!documentId&&(!ref||ref.length<3))fail(400,'Choose the uploaded document that supports this, or say where it can be found (for example the resolution number and date).');
  if(documentId&&!(await tx`select 1 from erp_private.documents where document_id=${documentId} and client_id=${cid} and deleted_at is null`).length)fail(400,'That document does not belong to this client.');
  if(!data.tpl?.template)fail(409,'This client has no client-type template, so the file does not ask for officers or signatories yet.');
  const dup=(await tx`select 1 from erp_private.client_office_holders where client_id=${cid} and kind=${kind} and lower(btrim(holder_name))=${name.toLowerCase()} and lower(btrim(holder_position))=${position.toLowerCase()} and status<>'Ended'`)[0];
  if(dup)fail(409,'This person is already recorded in that position. End the old record first if something changed.');
  const first=!data.ms.some((m:any)=>m.milestone==='Started');
  const made=(await tx`insert into erp_private.client_office_holders(client_id,kind,holder_name,holder_position,authority,basis_kind,document_id,source_reference,recorded_by) values(${cid},${kind},${name},${position},${authority},${basis},${documentId},${ref},${a.staff_id}) returning holder_id`)[0];
  if(first)await milestone(tx,a,cid,'Started',{first_field:'holder:'+kind});
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_office_holders','CLIENT_HOLDER_RECORDED',${made.holder_id},${tx.json({client_id:cid,kind,position,basis_kind:basis})})`;
  return view(a,await load(tx,a,cid));
 }
 if(p.action==='client_holder_verify'||p.action==='client_holder_end'){
  const h=(data.tpl?.holders||[]).find((x:any)=>x.holder_id===p.holder_id)||(await tx`select * from erp_private.client_office_holders where holder_id=${uuid(p.holder_id)}`)[0];
  if(!h)fail(403,'This record is unavailable to your account.');
  if(String(h.revision)!==revision(p.revision))fail(409,'The record changed. Refresh first.');
  if(h.status==='Ended')fail(409,'This record has already ended.');
  if(!REVIEWERS.includes(a.category_code))fail(403,'A Supervisor, Manager or Partner '+(p.action==='client_holder_verify'?'verifies':'ends')+' an officer or signatory.');
  if(p.action==='client_holder_verify'){
   if(h.status!=='Recorded')fail(409,'This record is already verified.');
   if(h.recorded_by===a.staff_id)fail(403,'A different person must verify a record you made.');
   const note=text(p.note||'',500,false).trim();if(note.length<3)fail(400,'Say what you checked it against (at least 3 characters).');
   await tx`update erp_private.client_office_holders set status='Verified',verified_by=${a.staff_id},verified_at=now(),verification_note=${note} where holder_id=${h.holder_id}`;
   await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_office_holders','CLIENT_HOLDER_VERIFIED',${h.holder_id},${tx.json({client_id:cid,kind:h.kind,note})})`;
  }else{
   const why=text(p.reason||'',500,false).trim();if(why.length<5)fail(400,'Say why it ends (at least 5 characters).');
   await tx`update erp_private.client_office_holders set status='Ended',ended_by=${a.staff_id},ended_at=now(),ended_reason=${why} where holder_id=${h.holder_id}`;
   await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_office_holders','CLIENT_HOLDER_ENDED',${h.holder_id},${tx.json({client_id:cid,kind:h.kind,reason:why})})`;
  }
  const after=await load(tx,a,cid),v=view(a,after);
  if(v.ready&&!after.ms.some((m:any)=>m.milestone==='Ready'))await milestone(tx,a,cid,'Ready',{required:v.required,verified:v.verified});
  return view(a,await load(tx,a,cid));
 }

 if(p.action==='client_master_record'){
  const key=text(p.field_key||'',60),f=fieldFor(key);if(!f)fail(400,'This is not a field on the client master checklist.');
  const cleaned=cleanValue(key,p.value);if(!cleaned.ok)fail(400,cleaned.error);
  const kind=choice(p.source_kind,SOURCE_KINDS),documentId=p.document_id?uuid(p.document_id):null,ref=p.source_reference?text(p.source_reference,300).trim():null;
  const bad=sourceProblem({source_kind:kind,document_id:documentId,source_reference:ref});if(bad)fail(400,bad);
  if(documentId&&!(await tx`select 1 from erp_private.documents where document_id=${documentId} and client_id=${cid} and deleted_at is null`).length)fail(400,'That document does not belong to this client.');
  const live=data.facts.find((x:any)=>x.field_key===key&&x.status!=='Superseded');
  if(live){
   if(live.value===cleaned.value&&live.source_kind===kind&&String(live.document_id||'')===String(documentId||'')&&String(live.source_reference||'')===String(ref||''))fail(409,'This fact is already recorded exactly like that.');
   const why=text(p.reason||'',500,false).trim();if(why.length<5)fail(400,'A fact is already recorded for '+f.label.toLowerCase()+'. Say why it is being replaced (at least 5 characters).');
   await tx`update erp_private.client_field_facts set status='Superseded',superseded_at=now(),superseded_by=${a.staff_id},superseded_reason=${why} where fact_id=${live.fact_id}`;
  }
  const first=!data.ms.some((m:any)=>m.milestone==='Started');
  const made=(await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,document_id,source_reference,recorded_by) values(${cid},${key},${cleaned.value},${kind},${documentId},${ref},${a.staff_id}) returning fact_id`)[0];
  if(first)await milestone(tx,a,cid,'Started',{first_field:key});
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_field_facts','CLIENT_FACT_RECORDED',${made.fact_id},${tx.json({client_id:cid,field_key:key,source_kind:kind,replaced:!!live})})`;
  return view(a,await load(tx,a,cid));
 }

 // client_master_verify
 const fact=data.facts.find((x:any)=>x.fact_id===p.fact_id);
 if(!fact)fail(403,'This fact is unavailable to your account.');
 if(String(fact.revision)!==revision(p.revision))fail(409,'The fact changed. Refresh first.');
 if(fact.status!=='Recorded')fail(409,fact.status==='Verified'?'This fact is already verified.':'This fact was replaced by a newer one.');
 if(!REVIEWERS.includes(a.category_code))fail(403,'A Supervisor, Manager or Partner verifies a fact.');
 if(fact.recorded_by===a.staff_id)fail(403,'A different person must verify a fact you recorded.');
 if(fact.source_kind==='Client statement')fail(409,'A client\'s own statement cannot be verified. Record the fact again with a document or register check as its source.');
 if((data.tpl?.fields||[]).some((f:any)=>f.field_key===fact.field_key&&f.partner_verified)&&a.category_code!=='PARTNER')fail(403,'A Partner classifies the legal form: only a Partner verifies this fact.');
 const note=text(p.note||'',500,false).trim();if(note.length<3)fail(400,'Say what you checked it against (at least 3 characters).');
 await tx`update erp_private.client_field_facts set status='Verified',verified_by=${a.staff_id},verified_at=now(),verification_note=${note} where fact_id=${fact.fact_id}`;
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_field_facts','CLIENT_FACT_VERIFIED',${fact.fact_id},${tx.json({client_id:cid,field_key:fact.field_key,note})})`;
 const after=await load(tx,a,cid),v=view(a,after);
 if(v.ready&&!after.ms.some((m:any)=>m.milestone==='Ready'))await milestone(tx,a,cid,'Ready',{required:v.required,verified:v.verified});
 return view(a,await load(tx,a,cid));
}
