import {fail,text,uuid} from './validation.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'This internal discussion is not available to your account.');return r[0];};
const visible=async(tx:any,id:string)=>one(await tx`select * from erp_private.discussion_channels where channel_id=${id}::uuid`);
export async function discussionAction(tx:any,a:any,p:any){
 if(!String(p.action).startsWith('discussion_'))return undefined;
 if(p.action==='discussion_candidates')return {candidates:await tx`select * from erp_private.discussion_candidates() order by full_name`};
 if(p.action==='discussion_list')return {channels:await tx`select c.*,coalesce(m.sequence,0) last_sequence,m.created_at last_message_at,
 (select count(*)::int from erp_private.discussion_messages x where x.channel_id=c.channel_id and x.author_id<>${a.staff_id} and x.sequence>coalesce(r.last_sequence,0)) unread,
 case when c.kind='Direct' then (select full_name from erp_private.staff_members where staff_id=case when c.dm_low=${a.staff_id} then c.dm_high else c.dm_low end) else c.title end display_title
 from erp_private.discussion_channels c left join lateral(select sequence,created_at from erp_private.discussion_messages where channel_id=c.channel_id order by sequence desc limit 1)m on true
 left join erp_private.discussion_reads r on r.channel_id=c.channel_id and r.staff_id=${a.staff_id} order by m.created_at desc nulls last,c.created_at desc limit 100`};
 if(p.action==='discussion_open'){
  if(p.kind==='Direct'){
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
 const c=await visible(tx,uuid(p.channel_id));
 if(p.action==='discussion_messages'){
  const before=p.before_sequence?Math.max(1,Math.trunc(Number(p.before_sequence))):null;
  const messages=await tx`select m.*,s.full_name author_name,d.file_name from erp_private.discussion_messages m left join erp_private.staff_members s on s.staff_id=m.author_id left join erp_private.documents d on d.document_id=m.document_id where m.channel_id=${c.channel_id} and (${before}::bigint is null or m.sequence<${before}) order by m.sequence desc limit 60`;
  const taskEvents=c.task_id?await tx`select event_id,event_type,reason,created_at from erp_private.task_events where task_id=${c.task_id} order by created_at desc limit 30`:[];
  const workflow=c.task_id?await tx`select event_id,action,message,from_stage,to_stage,created_at from erp_private.procedure_events where task_id=${c.task_id} order by created_at desc limit 30`:[];
  const closed=c.task_id?(await tx`select (w.stage='Closed' or t.status in('Completed','Cancelled')) closed from erp_private.task_procedures w join erp_private.tasks t using(task_id) where w.task_id=${c.task_id}`)[0]?.closed:c.project_id?(await tx`select status='Archived' closed from erp_private.projects where project_id=${c.project_id}`)[0]?.closed:false;
  return {channel:c,messages:messages.reverse(),task_events:taskEvents,procedure_events:workflow,read_only:!!closed,has_older:messages.length===60};
 }
 if(p.action==='discussion_send'){
  const rid=uuid(p.request_id),body=text(p.body,4000),reply=p.reply_to?uuid(p.reply_to):null,doc=p.document_id?uuid(p.document_id):null;
  const old=(await tx`select message_id,channel_id,body,reply_to,document_id from erp_private.discussion_messages where author_id=${a.staff_id} and request_id=${rid}`)[0];
  if(old){if(old.channel_id!==c.channel_id||old.body!==body||old.reply_to!==reply||old.document_id!==doc)fail(409,'This send request was already used for different content.');return {message_id:old.message_id,duplicate:true};}
  if(doc)one(await tx`select document_id from erp_private.documents where document_id=${doc} and project_id=${c.project_id} and deleted_at is null`);
  const m=one(await tx`insert into erp_private.discussion_messages(channel_id,request_id,author_id,body,reply_to,document_id) values(${c.channel_id},${rid},${a.staff_id},${body},${reply},${doc}) returning message_id,sequence`);
  await tx`select erp_private.discussion_notify(${m.message_id}::uuid)`;
  return m;
 }
 if(p.action==='discussion_read'){
  const sequence=Number(p.last_sequence);if(!Number.isSafeInteger(sequence)||sequence<0)fail(400,'Invalid read position.');
  const latest=(await tx`select coalesce(max(sequence),0)::text n from erp_private.discussion_messages where channel_id=${c.channel_id}`)[0];
  if(sequence>Number(latest.n))fail(400,'The read position must refer to delivered messages.');
  await tx`insert into erp_private.discussion_reads(channel_id,staff_id,last_sequence) values(${c.channel_id},${a.staff_id},${sequence}) on conflict(channel_id,staff_id) do update set last_sequence=greatest(discussion_reads.last_sequence,excluded.last_sequence),read_at=now()`;return {ok:true};
 }
 fail(404,'Unknown discussion action.');
}
