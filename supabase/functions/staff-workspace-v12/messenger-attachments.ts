import {fail,fileType,text,uuid} from './validation.mjs';

export const attachmentLimit=8;
const maxBytes=10*1024*1024;
const documentTypes=new Set(['pdf','csv','xlsx','docx','png','jpg','jpeg']);
// Voice notes: recorded in the browser as WebM/Opus (Chrome, Firefox, Edge), Ogg, or MP4/M4A (Safari).
// The signature is checked, so a renamed file is refused. Other ERP uploads do not accept audio.
const audioTypes=new Set(['webm','ogg','m4a']);
export function audioType(name:string,bytes:Uint8Array){
 const ext=name.toLowerCase().split('.').pop()||'';
 if(bytes.length<5||bytes.length>maxBytes)fail(400,'A voice note must be up to 10 MB.');
 if(ext==='webm'&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3)return 'audio/webm';
 if(ext==='ogg'&&new TextDecoder().decode(bytes.slice(0,4))==='OggS')return 'audio/ogg';
 if(ext==='m4a'&&bytes.length>=12&&new TextDecoder().decode(bytes.slice(4,8))==='ftyp')return 'audio/mp4';
 fail(400,'This voice note could not be read. Record it again.');
}
const objectKey=(row:any)=>`messenger/${row.channel_id}/${row.author_id}/${row.attachment_id}`;

export async function lockAttachment(tx:any,id:string){
 await tx`select pg_advisory_xact_lock(hashtextextended(${'discussion-attachment:'+id},0))`;
}

export async function readAttachmentUpload(form:FormData){
 const file=form.get('file');
 if(!(file instanceof File)||file.size<5||file.size>maxBytes)fail(400,'Choose a file up to 10 MB.');
 const name=text(file.name,180).replace(/[\x00-\x1f/\\]/g,'_');
 const ext=name.toLowerCase().split('.').pop()||'';
 if(!documentTypes.has(ext)&&!audioTypes.has(ext))fail(400,'Choose a PDF, CSV, Excel, Word, PNG or JPEG file, or record a voice note.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 return {channel_id:uuid(form.get('channel_id')),attachment_id:uuid(form.get('attachment_id')),file_name:name,
  mime_type:audioTypes.has(ext)?audioType(name,bytes):fileType(name,bytes),size_bytes:bytes.length,bytes};
}

export async function storeAttachment(tx:any,a:any,file:any,digest:string,storage:any){
 const channel=(await tx`select channel_id from erp_private.discussion_channels where channel_id=${file.channel_id}::uuid`)[0];
 if(!channel)fail(403,'This conversation is unavailable.');
 await lockAttachment(tx,file.attachment_id);
 const old=(await tx`select * from erp_private.discussion_attachments where attachment_id=${file.attachment_id}::uuid`)[0];
 if(old){
  if(old.author_id!==a.staff_id||old.channel_id!==file.channel_id||old.file_name!==file.file_name||old.sha256!==digest)fail(409,'This upload reference is already in use.');
  return {attachment_id:old.attachment_id};
 }
 // A retry uses the same private object path even if the original response was lost.
 const key=objectKey({...file,author_id:a.staff_id});
 await tx`insert into erp_private.discussion_attachments(attachment_id,channel_id,author_id,file_name,mime_type,size_bytes,sha256)
  values(${file.attachment_id},${file.channel_id},${a.staff_id},${file.file_name},${file.mime_type},${file.size_bytes},${digest})`;
 const result=await storage.upload(key,file.bytes,{contentType:file.mime_type,upsert:true});
 if(result.error)fail(502,'The attachment could not be stored. Retry the upload.');
 return {attachment_id:file.attachment_id};
}

export async function downloadAttachment(tx:any,p:any,storage:any){
 const row=(await tx`select * from erp_private.discussion_attachments where attachment_id=${uuid(p.attachment_id)}::uuid and message_id is not null`)[0];
 if(!row)fail(403,'This attachment is unavailable to your account.');
 const result=await storage.download(objectKey(row));
 if(result.error||!result.data)fail(404,'The attachment is unavailable.');
 return {blob:result.data,name:row.file_name,mime:row.mime_type};
}

export async function discardAttachment(tx:any,a:any,p:any,storage:any){
 const id=uuid(p.attachment_id);
 await lockAttachment(tx,id);
 const row=(await tx`select * from erp_private.discussion_attachments where attachment_id=${id}::uuid and author_id=${a.staff_id} and message_id is null`)[0];
 if(!row)return {ok:true};
 const result=await storage.remove([objectKey(row)]);
 if(result.error)fail(502,'The attachment could not be removed. Try again.');
 await tx`delete from erp_private.discussion_attachments where attachment_id=${id}::uuid`;
 return {ok:true};
}
