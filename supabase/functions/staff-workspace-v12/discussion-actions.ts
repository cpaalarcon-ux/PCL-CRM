import {fail,text,uuid} from './validation.mjs';
import {callAction} from './call-actions.ts';
import {attachmentLimit,lockAttachment} from './messenger-attachments.ts';
export const REACTIONS=['👍','❤️','😂','😮','🙏','✅'];
const one=(r:any[])=>{if(!r.length)fail(403,'This internal discussion is not available to your account.');return r[0];};
const admin=(a:any)=>{if(a.category_code!=='ADMIN')fail(403,'Only a System Administrator can manage chat groups.');};
const visible=async(tx:any,id:string)=>one(await tx`select * from erp_private.discussion_channels where channel_id=${id}::uuid`);
export async function discussionAction(tx:any,a:any,p:any,canArea:(area:string)=>boolean|Promise<boolean>=()=>true){
 const taskLink=async(id:string)=>await canArea('projects')?(await tx`select task_id,task_name from erp_private.tasks where task_id=${id}::uuid and deleted_at is null`)[0]:null;
 const documentLink=async(id:string)=>await canArea('documents')?(await tx`select document_id,file_name from erp_private.documents where document_id=${id}::uuid and deleted_at is null`)[0]:null;
 if(!String(p.action).startsWith('discussion_'))return undefined;
 if(String(p.action).startsWith('discussion_call_')){const call=await callAction(tx,a,p);if(call!==undefined)return call;fail(400,'Unknown call action.');}
 if(p.action==='discussion_candidates')return {candidates:await tx`select * from erp_private.discussion_candidates() order by full_name`};
 if(p.action==='discussion_list')return {channels:await tx`select c.*,coalesce(m.sequence,0) last_sequence,m.created_at last_message_at,left(coalesce(nullif(m.body,''),case when m.shared_task_id is not null then 'Shared task' when m.shared_document_id is not null then 'Shared document' when m.sequence is not null then 'Attachment' end),120) last_body,m.author_id last_author_id,(select p.full_name from erp_private.chat_people(c.channel_id) p where p.staff_id=m.author_id) last_author_name,
 (select count(*)::int from erp_private.discussion_messages x where x.channel_id=c.channel_id and x.author_id<>${a.staff_id} and x.sequence>coalesce(r.last_sequence,0)) unread,
 case when c.kind='Direct' then (select p.full_name from erp_private.chat_people(c.channel_id) p where p.staff_id=case when c.dm_low=${a.staff_id} then c.dm_high else c.dm_low end) else c.title end display_title
 from erp_private.discussion_channels c left join lateral(select sequence,created_at,body,author_id,shared_task_id,shared_document_id from erp_private.discussion_messages where channel_id=c.channel_id order by sequence desc limit 1)m on true
 left join erp_private.discussion_reads r on r.channel_id=c.channel_id and r.staff_id=${a.staff_id} order by m.created_at desc nulls last,c.created_at desc limit 100`};
 if(p.action==='discussion_open'){
  if(p.kind==='Direct'){
   if(a.category_code==='INTERN')fail(403,'Interns can reply to a conversation but cannot start one.');
   const target=uuid(p.staff_id);if(target===a.staff_id)fail(400,'Choose another staff member.');
   // Sharing a firm permits starting a direct conversation; it never permits
   // inspecting an existing conversation between two other members.
   const candidate=one(await tx`select staff_id from erp_private.discussion_candidates() where staff_id=${target} limit 1`);
   const [lo,hi]=[a.staff_id,candidate.staff_id].sort();
   await tx`insert into erp_private.discussion_channels(kind,dm_low,dm_high,title,created_by) values('Direct',${lo},${hi},'Private staff conversation',${a.staff_id}) on conflict do nothing`;
   return {channel:one(await tx`select * from erp_private.discussion_channels where dm_low=${lo} and dm_high=${hi} and kind='Direct'`)};
  }
  const task=p.task_id?one(await tx`select task_id,project_id,task_name from erp_private.tasks where task_id=${uuid(p.task_id)} and deleted_at is null`):null;
  const project=task?{project_id:task.project_id,project_name:task.task_name}:one(await tx`select project_id,project_name from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`);
  const kind=task?'Task':'Project';
  await tx`insert into erp_private.discussion_channels(kind,project_id,task_id,title,created_by) values(${kind},${project.project_id},${task?.task_id||null},${String(task?.task_name||project.project_name).slice(0,200)},${a.staff_id}) on conflict do nothing`;
  return {channel:one(await tx`select * from erp_private.discussion_channels where kind=${kind} and project_id=${project.project_id} and (${task?.task_id||null}::uuid is null or task_id=${task?.task_id||null})`)};
 }
 if(p.action==='discussion_staff_directory'){admin(a);return {staff:await tx`select * from erp_private.chat_staff_directory()`};}
 if(p.action==='discussion_group_overview'){
  const rows=await tx`select * from erp_private.chat_group_overview(${p.channel_id?uuid(p.channel_id):null}::uuid)`,groups:any[]=[];
  for(const r of rows){let g=groups.find(x=>x.channel_id===r.channel_id);if(!g){g={channel_id:r.channel_id,title:r.title,created_at:r.created_at,members:[]};groups.push(g);}g.members.push({staff_id:r.staff_id,full_name:r.full_name,category_code:r.category_code});}
  return {groups};
 }
 if(p.action==='discussion_group_create'){
  admin(a);const members=Array.isArray(p.member_ids)?[...new Set(p.member_ids.map((x:any)=>uuid(x)))]:[];if(members.length<2)fail(400,'Choose at least two members.');if(members.length>100)fail(400,'A group can have at most 100 members.');
  const title=text(p.title,100).trim();if(title.length<2)fail(400,'Name the group (at least 2 characters).');
  const [r]=await tx`select erp_private.chat_group_create(${title},${tx.array(members)}::uuid[]) id`;return {ok:true,channel_id:r.id};
 }
 if(p.action==='discussion_group_members_set'){
  admin(a);const list=(v:any)=>Array.isArray(v)?[...new Set(v.map((x:any)=>uuid(x)))]:[];
  await tx`select erp_private.chat_group_members_set(${uuid(p.channel_id)}::uuid,${tx.array(list(p.add))}::uuid[],${tx.array(list(p.remove))}::uuid[])`;return {ok:true};
 }
 const c=await visible(tx,uuid(p.channel_id));
 if(p.action==='discussion_shared_link'){
  const m=one(await tx`select shared_task_id,shared_document_id from erp_private.discussion_messages where channel_id=${c.channel_id} and message_id=${uuid(p.message_id)}::uuid`);
  const record=m.shared_task_id?await taskLink(m.shared_task_id):m.shared_document_id?await documentLink(m.shared_document_id):null;
  if(!record)fail(403,'You do not have access to this ERP record.');
  return record;
 }
 if(p.action==='discussion_messages'){
  const before=p.before_sequence?Math.max(1,Math.trunc(Number(p.before_sequence))):null;
  const [showTasks,showDocuments]=await Promise.all([canArea('projects'),canArea('documents')]);
  const messages=await tx`select m.message_id,m.channel_id,m.sequence,m.author_id,m.body,m.reply_to,m.document_id,m.created_at,s.full_name author_name,d.file_name,
   (case when m.shared_task_id is not null then 'task' when m.shared_document_id is not null then 'document' end) shared_kind,
   coalesce(t.task_name,sd.file_name) shared_title,
   coalesce(files.items,'[]'::jsonb) attachments,
   left(rm.body,140) reply_body,rs.full_name reply_author_name,coalesce(rm.has_attachments,false) reply_has_files,
   coalesce(rx.items,'[]'::jsonb) reactions
   from (select * from erp_private.discussion_messages where channel_id=${c.channel_id} and (${before}::bigint is null or sequence<${before}) order by sequence desc limit 60) m
   left join erp_private.chat_people(${c.channel_id}) s on s.staff_id=m.author_id
   left join erp_private.documents d on d.document_id=m.document_id
   left join erp_private.discussion_messages rm on rm.message_id=m.reply_to and rm.channel_id=m.channel_id
   left join erp_private.chat_people(${c.channel_id}) rs on rs.staff_id=rm.author_id
   left join lateral(select jsonb_agg(jsonb_build_object('emoji',g.emoji,'count',g.n,'mine',g.mine,'names',to_jsonb(g.names)) order by g.first_at,g.emoji) items
    from (select r.emoji,count(*)::int n,bool_or(r.staff_id=${a.staff_id}) mine,min(r.created_at) first_at,(array_agg(coalesce(pp.full_name,'Staff') order by r.created_at))[1:8] names
     from erp_private.discussion_reactions r left join erp_private.chat_people(${c.channel_id}) pp on pp.staff_id=r.staff_id
     where r.message_id=m.message_id group by r.emoji) g) rx on true
   left join erp_private.tasks t on ${showTasks}::boolean and t.task_id=m.shared_task_id and t.deleted_at is null
   left join erp_private.documents sd on ${showDocuments}::boolean and sd.document_id=m.shared_document_id and sd.deleted_at is null
   left join lateral(select jsonb_agg(jsonb_build_object('attachment_id',f.attachment_id,'file_name',f.file_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes) order by f.created_at,f.attachment_id) items
    from erp_private.discussion_attachments f where f.message_id=m.message_id) files on true order by m.sequence desc`;
  const taskEvents=c.task_id?await tx`select event_id,event_type,reason,created_at from erp_private.task_events where task_id=${c.task_id} order by created_at desc limit 30`:[];
  const workflow=c.task_id?await tx`select event_id,action,message,from_stage,to_stage,created_at from erp_private.procedure_events where task_id=${c.task_id} order by created_at desc limit 30`:[];
  const closed=c.task_id?(await tx`select (w.stage='Closed' or t.status in('Completed','Cancelled')) closed from erp_private.task_procedures w join erp_private.tasks t using(task_id) where w.task_id=${c.task_id}`)[0]?.closed:c.project_id?(await tx`select status='Archived' closed from erp_private.projects where project_id=${c.project_id}`)[0]?.closed:false;
  // Read ticks: where each person in a one-to-one chat or group has read up to. Task and project discussions have no fixed members, so no ticks.
  const reads=['Direct','Group'].includes(c.kind)?await tx`select staff_id,last_sequence::text last_sequence from erp_private.chat_read_positions(${c.channel_id})`:[];
  return {channel:c,messages:messages.reverse(),task_events:taskEvents,procedure_events:workflow,read_only:!!closed,has_older:messages.length===60,read_positions:reads};
 }
 if(p.action==='discussion_send'){
  const rid=uuid(p.request_id),body=text(p.body??'',4000,false),reply=p.reply_to?uuid(p.reply_to):null,doc=p.document_id?uuid(p.document_id):null;
  const task=p.shared_task_id?uuid(p.shared_task_id):null,sharedDoc=p.shared_document_id?uuid(p.shared_document_id):null;
  if(p.attachment_ids!=null&&(!Array.isArray(p.attachment_ids)||p.attachment_ids.length>attachmentLimit))fail(400,'Send up to eight attachments at a time.');
  const ids=[...new Set<string>((p.attachment_ids||[]).map(uuid))].sort();
  if(!body&&!task&&!sharedDoc&&!ids.length)fail(400,'Write a message or attach a file or ERP record.');
  if(task&&sharedDoc)fail(400,'Share one ERP record at a time.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${'discussion-send:'+a.staff_id+':'+rid},0))`;
  const old=(await tx`select * from erp_private.discussion_messages where author_id=${a.staff_id} and request_id=${rid}`)[0];
  if(old){
   const saved=(await tx`select attachment_id from erp_private.discussion_attachments where message_id=${old.message_id} order by attachment_id`).map((r:any)=>r.attachment_id);
   if(old.channel_id!==c.channel_id||old.body!==body||old.reply_to!==reply||old.document_id!==doc||old.shared_task_id!==task||old.shared_document_id!==sharedDoc||JSON.stringify(saved)!==JSON.stringify(ids))fail(409,'This send request was already used for different content.');
   return {message_id:old.message_id,duplicate:true};
  }
  if(task&&!await taskLink(task)||sharedDoc&&!await documentLink(sharedDoc))fail(403,'You do not have access to share this ERP record.');
  if(doc)one(await tx`select document_id from erp_private.documents where document_id=${doc} and project_id=${c.project_id} and deleted_at is null`);
  for(const id of ids){
   await lockAttachment(tx,id);
   const pending=(await tx`select attachment_id from erp_private.discussion_attachments where attachment_id=${id} and channel_id=${c.channel_id} and author_id=${a.staff_id} and message_id is null`)[0];
   if(!pending)fail(409,'An attachment is unavailable. Remove it or upload it again.');
  }
  const m=one(await tx`insert into erp_private.discussion_messages(channel_id,request_id,author_id,body,reply_to,document_id,shared_task_id,shared_document_id,has_attachments)
   values(${c.channel_id},${rid},${a.staff_id},${body},${reply},${doc},${task},${sharedDoc},${ids.length>0}) returning message_id,sequence`);
  for(const id of ids)await tx`update erp_private.discussion_attachments set message_id=${m.message_id} where attachment_id=${id}`;
  await tx`select erp_private.discussion_notify(${m.message_id}::uuid)`;
  return m;
 }
 if(p.action==='discussion_react'){
  // A reaction is a light, removable mark beside an immutable message. Allowed marks are fixed; a closed discussion takes no new ones.
  const emoji=String(p.emoji||''),on=p.on!==false;
  if(!REACTIONS.includes(emoji))fail(400,'Choose one of the available reactions.');
  const mid=uuid(p.message_id);
  one(await tx`select message_id from erp_private.discussion_messages where message_id=${mid}::uuid and channel_id=${c.channel_id}`);
  if(on){
   await tx`insert into erp_private.discussion_reactions(message_id,channel_id,staff_id,emoji) values(${mid},${c.channel_id},${a.staff_id},${emoji}) on conflict do nothing`;
  }else{
   await tx`delete from erp_private.discussion_reactions where message_id=${mid}::uuid and channel_id=${c.channel_id} and staff_id=${a.staff_id} and emoji=${emoji}`;
  }
  return {ok:true};
 }
 if(p.action==='discussion_read'){
  const sequence=Number(p.last_sequence);if(!Number.isSafeInteger(sequence)||sequence<0)fail(400,'Invalid read position.');
  const latest=(await tx`select coalesce(max(sequence),0)::text n from erp_private.discussion_messages where channel_id=${c.channel_id}`)[0];
  if(sequence>Number(latest.n))fail(400,'The read position must refer to delivered messages.');
  await tx`insert into erp_private.discussion_reads(channel_id,staff_id,last_sequence) values(${c.channel_id},${a.staff_id},${sequence}) on conflict(channel_id,staff_id) do update set last_sequence=greatest(discussion_reads.last_sequence,excluded.last_sequence),read_at=now()`;return {ok:true};
 }
 fail(404,'Unknown discussion action.');
}
