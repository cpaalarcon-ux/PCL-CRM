import {fail,text,uuid,choice,date} from './validation.mjs';
import {nextNumber} from './suite-actions.ts';

// Step 8: Incoming Review and linked documents (the internal side).
// The database repeats every rule below (see 20261109265000_incoming_review.sql); these checks give friendly messages.
// The queue is for Supervisors, Managers and Partners. Assistants, Interns and administrators never see it.
// Live WhatsApp and mailbox connections need outside accounts and are not part of this step: staff log a received file by hand
// (the file upload itself is handled in index.ts, which then calls incoming_register).
// Rights are not in the staff rights catalogue: who may do what is decided here and in the database.
const ACTIONS=['incoming_list','incoming_clients','incoming_options','incoming_candidates','incoming_choose_client','incoming_set_handling','incoming_accept','incoming_archive','incoming_kyc_approve',
 'incoming_settings_read','incoming_setting_set','incoming_setting_confirm','document_links','document_link_add','document_link_remove','client_timeline','incoming_badge'];
const RESOLUTIONS=['Rejected','Replacement requested','Duplicate','Withdrawn'];
const reviewer=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'Your account cannot use Incoming Review.');};
const partnerOf=(a:any,m:string)=>{if(a.category_code!=='PARTNER')fail(403,m);};
const one=(r:any[],m='This record is not available to your account.')=>{if(!r.length)fail(403,m);return r[0];};
const optUuid=(v:any)=>v?uuid(v):null;
const iso=(v:any)=>v instanceof Date?v.toISOString():String(v??'');
const optDate=(v:any)=>{const d=date(String(v||''));return d||null;};

export async function incomingAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;

 if(p.action==='incoming_list'){
  reviewer(a);
  const archived=p.archived===true;
  const items=await tx`select * from erp_private.incoming_list(${archived})`;
  const counts=await tx`select erp_private.incoming_counts() c`;
  return {items,counts:counts[0].c,settings:await tx`select setting_key,label,int_value,text_value,rule_status,source_note,confirmed_at,revision from erp_private.incoming_settings order by setting_key`};
 }
 if(p.action==='incoming_badge'){
  // The menu count. The database applies the same visibility and role rules as the queue; a role that may not review gets zero.
  const [b]=await tx`select erp_private.incoming_badge() b`;
  return {waiting:Number(b.b.waiting||0),overdue:Number(b.b.overdue||0)};
 }
 if(p.action==='incoming_clients'){
  // The clients this reviewer may handle external communication for.
  reviewer(a);
  return {clients:await tx`select client_id,company_name from erp_private.clients where deleted_at is null and erp_private.client_allowed(client_id) and erp_private.comm_external_allowed(client_id) order by company_name limit 2000`};
 }
 if(p.action==='incoming_options'){
  // What a reviewer can link an accepted file to for one client. Every list goes through the same checks as the database.
  reviewer(a);
  const client=uuid(p.client_id);
  one(await tx`select 1 from erp_private.clients where client_id=${client} and deleted_at is null and erp_private.client_allowed(client_id) and erp_private.comm_external_allowed(client_id)`,'That client is not available to you.');
  const firms=await tx`select f.firm_id,f.firm_code,f.legal_name from erp_private.firms f where erp_private.firm_allowed(f.firm_id) and erp_private.kra_firm_handles(${client}::uuid,f.firm_id) order by f.firm_code`;
  const projects=await tx`select p.project_id,p.project_name,p.service_code,p.handling_firm_id,p.status from erp_private.projects p where p.client_id=${client} and p.deleted_at is null and p.status<>'Archived' and erp_private.project_allowed(p.project_id) order by p.project_name`;
  const tasks=projects.length?await tx`select t.task_id,t.task_name,t.project_id from erp_private.tasks t where t.project_id=any(${tx.array(projects.map((x:any)=>x.project_id))}::uuid[]) and t.deleted_at is null and t.status not in('Completed','Cancelled') and erp_private.task_allowed(t.task_id) order by t.task_name limit 400`:[];
  const cases=await tx`select k.case_id,k.notice_reference,k.status,k.handling_firm_id from erp_private.kra_cases k where k.client_id=${client} and erp_private.kra_case_allowed(k.case_id) order by k.deadline_date desc limit 100`;
  const communications=await tx`select c.communication_id,c.reference,c.channel,c.direction,c.subject,c.communication_date,c.firm_id from erp_private.communications c where c.client_id=${client} and c.deleted_at is null order by c.communication_date desc,c.created_at desc limit 80`;
  const leader=['PARTNER','MANAGER'].includes(a.category_code);
  return {firms,projects,tasks,kra_cases:cases,communications,
   categories:leader?['Correspondence','KRA Notices','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports','Permanent File','Signed Engagement Letters']:['Correspondence','KRA Notices','Current Year Audit','Tax Returns','Working Papers','PBC Documents'],
   project_required:leader?[]:['Current Year Audit','Tax Returns','Working Papers','PBC Documents']};
 }
 if(p.action==='incoming_settings_read'){
  reviewer(a);
  return {settings:await tx`select setting_key,label,int_value,text_value,rule_status,source_note,confirmed_at,revision from erp_private.incoming_settings order by setting_key`};
 }
 if(p.action==='incoming_candidates'){
  reviewer(a);
  return {candidates:await tx`select * from erp_private.incoming_candidates(${uuid(p.item_id)})`};
 }
 if(p.action==='incoming_choose_client'){
  reviewer(a);
  await tx`select erp_private.incoming_choose_client(${uuid(p.item_id)},${uuid(p.client_id)})`;
  return {ok:true};
 }
 if(p.action==='incoming_set_handling'){
  reviewer(a);
  const level=choice(p.confidentiality,['Normal','Restricted']);
  await tx`select erp_private.incoming_set_handling(${uuid(p.item_id)},${level},${p.is_kyc===true})`;
  return {ok:true};
 }
 if(p.action==='incoming_accept'){
  reviewer(a);
  const item=uuid(p.item_id),client=uuid(p.client_id),firm=uuid(p.firm_id);
  const cat=p.category?choice(p.category,['Correspondence','KRA Notices','Permanent File','Signed Engagement Letters','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports']):null;
  const ps=optDate(p.period_start),pe=optDate(p.period_end);
  if(Boolean(ps)!==Boolean(pe))fail(400,'Give both ends of the period, or leave both empty.');
  const conf=p.confidentiality?choice(p.confidentiality,['Normal','Restricted']):null;
  const existingComm=optUuid(p.communication_id),create=p.create_communication===true&&!existingComm;
  if(existingComm&&p.create_communication===true)fail(400,'Link an existing communication or create a new one, not both.');
  let ref:string|null=null,req:string|null=null;
  if(create){
   // The communication is dated by the day the file was received, so the reference comes from the same numbering as every other communication.
   const it=one(await tx`select received_at from erp_private.incoming_items where item_id=${item}`,'That incoming file is not available to you.');
   const day=new Date(new Date(it.received_at).getTime()+3*3600*1000).toISOString().slice(0,10);
   ref=await nextNumber(tx,firm,'COM',day);req=crypto.randomUUID();
  }
  const r=await tx`select erp_private.incoming_accept(${item},${client},${firm},${cat},${optUuid(p.project_id)},${optUuid(p.task_id)},${optUuid(p.kra_case_id)},${ps},${pe},${conf},${existingComm},${create},${ref},${req},${p.confirm_duplicate===true},${p.note?text(p.note,1000):null}) r`;
  const out=r[0].r;
  await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${out.document_id},${a.auth_user_id},'UPLOAD')`;
  return out;
 }
 if(p.action==='incoming_archive'){
  reviewer(a);
  const r=await tx`select erp_private.incoming_archive(${uuid(p.item_id)},${choice(p.resolution,RESOLUTIONS)},${text(p.reason,1000)}) r`;
  return r[0].r;
 }
 if(p.action==='incoming_kyc_approve'){
  // The existing approval: a Manager or Partner other than the person who accepted the file moves it from KYC Pending into the Permanent File.
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can approve a KYC file.');
  await tx`select erp_private.kyc_promote_document(${uuid(p.document_id)},${uuid(p.client_id)})`;
  return {ok:true};
 }
 if(p.action==='incoming_setting_set'){
  partnerOf(a,'Only a Partner can change an incoming-file setting.');
  const row=one(await tx`select * from erp_private.incoming_settings where setting_key=${text(p.setting_key,60)}`,'That setting does not exist.');
  if(String(row.revision)!==String(p.revision))fail(409,'This setting changed. Refresh first.');
  if(row.int_value!==null){
   const n=Number(p.value);if(!Number.isInteger(n))fail(400,'Enter a whole number of days.');
   await tx`update erp_private.incoming_settings set int_value=${n} where setting_key=${row.setting_key}`;
  }else await tx`update erp_private.incoming_settings set text_value=${text(p.value,40)} where setting_key=${row.setting_key}`;
  return {ok:true};
 }
 if(p.action==='incoming_setting_confirm'){
  partnerOf(a,'Only a Partner can confirm an incoming-file setting.');
  const row=one(await tx`select * from erp_private.incoming_settings where setting_key=${text(p.setting_key,60)}`,'That setting does not exist.');
  if(String(row.revision)!==String(p.revision))fail(409,'This setting changed. Refresh first.');
  const note=text(p.source_note,500);if(note.length<10)fail(400,'Say who confirmed this and where it is written (at least 10 characters).');
  await tx`update erp_private.incoming_settings set rule_status='Confirmed',confirmed_by=${a.staff_id},source_note=${note} where setting_key=${row.setting_key}`;
  return {ok:true};
 }

 if(p.action==='document_links'){
  reviewer(a);
  const doc=uuid(p.document_id);
  const document=one(await tx`select document_id,client_id,file_name,category,handling_firm_id from erp_private.documents where document_id=${doc} and deleted_at is null`,'That document is not available to your account.');
  const links=await tx`select l.link_id,l.communication_id,l.project_id,l.task_id,l.kra_case_id,l.period_start,l.period_end,l.note,l.created_at,l.removed_at,l.removal_reason,
    c.reference as communication_reference,c.channel as communication_channel,pr.project_name,t.task_name,k.notice_reference
   from erp_private.document_links l
   left join erp_private.communications c on c.communication_id=l.communication_id
   left join erp_private.projects pr on pr.project_id=l.project_id
   left join erp_private.tasks t on t.task_id=l.task_id
   left join erp_private.kra_cases k on k.case_id=l.kra_case_id
   where l.document_id=${doc} order by l.created_at`;
  return {links,document};
 }
 if(p.action==='document_link_add'){
  reviewer(a);
  const ps=optDate(p.period_start),pe=optDate(p.period_end);
  if(Boolean(ps)!==Boolean(pe))fail(400,'Give both ends of the period.');
  const r=await tx`select erp_private.document_link_add(${uuid(p.document_id)},${optUuid(p.communication_id)},${optUuid(p.project_id)},${optUuid(p.task_id)},${optUuid(p.kra_case_id)},${ps},${pe},${p.note?text(p.note,500):null}) r`;
  return r[0].r;
 }
 if(p.action==='document_link_remove'){
  reviewer(a);
  const r=await tx`select erp_private.document_link_remove(${uuid(p.link_id)},${text(p.reason,1000)}) r`;
  return r[0].r;
 }

 if(p.action==='client_timeline'){
  // One list for a client: its communications (email, WhatsApp, letters, calls, meetings, notes) and the documents filed for it.
  // Both reads go through row security, so each person sees only what they may see.
  const client=uuid(p.client_id);
  one(await tx`select 1 from erp_private.clients where client_id=${client} and deleted_at is null`,'That client is not available to your account.');
  const comms=await tx`select communication_id,reference,channel,direction,sender_address,subject,communication_date,status,project_id,issued_at is not null as issued,created_at
   from erp_private.communications where client_id=${client} and deleted_at is null order by communication_date desc,created_at desc limit 200`;
  const docs=await tx`select document_id,file_name,category,source_type,confidentiality,communication_id,project_id,task_id,uploaded_at,archived_at is not null as archived
   from erp_private.documents where client_id=${client} and deleted_at is null order by uploaded_at desc limit 300`;
  const links=docs.length?await tx`select document_id,communication_id from erp_private.document_links where removed_at is null and communication_id is not null and document_id = any(${tx.array(docs.map((d:any)=>d.document_id))}::uuid[])`:[];
  const byComm=new Map<string,any[]>();
  const add=(cid:string,d:any)=>{if(!byComm.has(cid))byComm.set(cid,[]);if(!byComm.get(cid)!.some((x:any)=>x.document_id===d.document_id))byComm.get(cid)!.push(d);};
  for(const d of docs)if(d.communication_id)add(d.communication_id,d);
  for(const l of links){const d=docs.find((x:any)=>x.document_id===l.document_id);if(d)add(l.communication_id,d);}
  const events=comms.map((c:any)=>({kind:'Communication',id:c.communication_id,at:c.communication_date,created_at:c.created_at,reference:c.reference,channel:c.channel,direction:c.direction,sender_address:c.sender_address,
   title:c.subject,status:c.status,issued:c.issued,project_id:c.project_id,documents:(byComm.get(c.communication_id)||[]).map((d:any)=>({document_id:d.document_id,file_name:d.file_name,category:d.category}))}));
  const loose=docs.filter((d:any)=>!d.communication_id&&!links.some((l:any)=>l.document_id===d.document_id));
  for(const d of loose)events.push({kind:'Document',id:d.document_id,at:d.uploaded_at,created_at:d.uploaded_at,reference:null,channel:null,direction:null,sender_address:null,title:d.file_name,status:d.archived?'Archived':'Filed',
   issued:false,project_id:d.project_id,documents:[{document_id:d.document_id,file_name:d.file_name,category:d.category}],source_type:d.source_type,category:d.category,confidentiality:d.confidentiality} as any);
  const day=(v:any)=>iso(v).slice(0,10);
  events.sort((x:any,y:any)=>day(y.at).localeCompare(day(x.at))||iso(y.created_at).localeCompare(iso(x.created_at)));
  return {events:events.slice(0,300).map((e:any)=>({...e,at:day(e.at)}))};
 }
 return undefined;
}
