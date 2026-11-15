import {fail,text,uuid,date,choice,revision} from './validation.mjs';
import {TEMPLATE_KEYS,KEY_LABEL,columnsFrom,fileProblem,inForce} from './template-library-rules.mjs';

// Template Library (build 2821). Managers and Partners upload versioned templates; a different Manager or Partner publishes; a published version is never edited and is
// replaced by a newer one. Imports record the version in force. Table rules are in 20261116120000_import_template_library.sql.
const ACTIONS=['template_library_list','template_library_create','template_library_revise','template_library_publish','template_library_retire','template_library_download'];
const LEADERS=['PARTNER','MANAGER'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const hex=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};

// The published version in force for a kind on a date, or null when the firm has not published one. Used when an import is saved.
export async function templateInForce(tx:any,key:string|null,on:string){
 if(!key)return null;
 const rows=await tx`select template_id,template_key,version,effective_from,effective_to,status from erp_private.import_templates where template_key=${key} and status='Published'`;
 return rows.find((r:any)=>inForce({...r,effective_from:day(r.effective_from),effective_to:r.effective_to?day(r.effective_to):null},day(on)))?.template_id||null;
}
const present=(r:any)=>({template_id:r.template_id,template_key:r.template_key,key_label:KEY_LABEL[r.template_key],name:r.name,version:r.version,status:r.status,importer_profile:r.importer_profile,required_columns:r.required_columns,validation_notes:r.validation_notes,effective_from:day(r.effective_from),effective_to:r.effective_to?day(r.effective_to):null,file_name:r.file_name,file_sha256:r.file_sha256,created_by:r.created_by,created_by_name:r.created_by_name,created_at:r.created_at,published_by_name:r.published_by_name,published_at:r.published_at,sole_partner_publish:r.sole_partner_publish,retired_by_name:r.retired_by_name,retired_at:r.retired_at,retired_reason:r.retired_reason,revision:String(r.revision),used_by:Number(r.used_by||0)});
async function listAll(tx:any){
 return await tx`select t.template_id,t.template_key,t.name,t.version,t.status,t.importer_profile,t.required_columns,t.validation_notes,t.effective_from,t.effective_to,t.file_name,t.file_sha256,t.created_by,erp_private.staff_name(t.created_by) created_by_name,t.created_at,erp_private.staff_name(t.published_by) published_by_name,t.published_at,t.sole_partner_publish,erp_private.staff_name(t.retired_by) retired_by_name,t.retired_at,t.retired_reason,t.revision,
  (select count(*) from erp_private.period_imports i where i.template_id=t.template_id)+(select count(*) from erp_private.bank_total_batches b where b.template_id=t.template_id) as used_by
  from erp_private.import_templates t order by t.template_key,t.version desc`;
}
function fields(p:any){
 const key=choice(p.template_key,TEMPLATE_KEYS),name=text(p.name,120,false).trim(),from=date(p.effective_from),to=p.effective_to?date(p.effective_to):null;
 if(name.length<3)fail(400,'Give the template a name (at least 3 characters).');
 if(!from)fail(400,'Say the first day the template applies.');
 if(to&&to<from)fail(400,'The last day cannot be before the first day.');
 const cols=columnsFrom(p.required_columns);if(cols.problem)fail(400,cols.problem);
 const profile=p.importer_profile?text(p.importer_profile,80,false).trim():null;
 return {key,name,from,to,cols:cols.columns,profile,notes:text(p.validation_notes||'',2000,false).trim()||null};
}
async function filePart(p:any,required:boolean){
 if(!p.file_base64&&!required)return null;
 const b64=String(p.file_base64||'').replace(/\s+/g,''),name=text(p.file_name||'',200,false).trim();
 const bad=fileProblem({name,base64:b64});if(bad)fail(400,bad);
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));}catch{fail(400,'The file could not be read. Choose it again.');}
 return {name,b64,sha:await hex(bytes!),mime:String(p.mime_type||'application/octet-stream').slice(0,120)};
}

export async function templateLibraryAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The template library is for staff with client access.');
 const leader=LEADERS.includes(a.category_code);
 if(p.action==='template_library_list'){
  const rows=await listAll(tx);
  return {templates:rows.map(present),keys:TEMPLATE_KEYS.map((k:string)=>({key:k,label:KEY_LABEL[k]})),can_manage:leader,me:a.staff_id,
   note:'Use the published version of each template for new uploads. Every import records the version that was in force. Drafts are seen only by Managers and Partners.'};
 }
 if(p.action==='template_library_download'){
  const t=one(await tx`select template_id,template_key,name,version,status,file_name,mime_type,file_sha256,file_base64 from erp_private.import_templates where template_id=${uuid(p.template_id)}`);
  if(t.status==='Draft'&&!leader)fail(403,'A draft is seen only by Managers and Partners.');
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'import_templates','TEMPLATE_DOWNLOADED',${String(t.template_id)},${tx.json({key:t.template_key,version:t.version,status:t.status})})`;
  return {file_name:t.file_name,mime_type:t.mime_type,base64:t.file_base64,sha256:t.file_sha256,version:t.version,status:t.status,name:t.name};
 }
 if(!leader)fail(403,'A Manager or Partner works with the template library.');
 if(p.action==='template_library_create'){
  const f=fields(p),file=await filePart(p,true)!;
  const [last]=await tx`select coalesce(max(version),0) v from erp_private.import_templates where template_key=${f.key}`;
  const [made]=await tx`insert into erp_private.import_templates(template_key,name,version,importer_profile,required_columns,validation_notes,effective_from,effective_to,file_name,mime_type,file_sha256,file_base64,created_by)
   values(${f.key},${f.name},${Number(last.v)+1},${f.profile},${tx.json(f.cols)},${f.notes},${f.from},${f.to},${file!.name},${file!.mime},${file!.sha},${file!.b64},${a.staff_id}) returning template_id,version`;
  return {ok:true,template_id:made.template_id,version:made.version};
 }
 const t=one(await tx`select * from erp_private.import_templates where template_id=${uuid(p.template_id)} for update`);
 if(String(t.revision)!==revision(p.revision))fail(409,'The template changed. Refresh first.');
 if(p.action==='template_library_revise'){
  if(t.status!=='Draft')fail(409,'A published template is never edited. Upload a new version.');
  if(t.created_by!==a.staff_id)fail(403,'Only the person who uploaded a draft revises it.');
  const f=fields({...p,template_key:t.template_key}),file=await filePart(p,false);
  await tx`update erp_private.import_templates set name=${f.name},importer_profile=${f.profile},required_columns=${tx.json(f.cols)},validation_notes=${f.notes},effective_from=${f.from},effective_to=${f.to} where template_id=${t.template_id}`;
  if(file)await tx`update erp_private.import_templates set file_name=${file.name},mime_type=${file.mime},file_sha256=${file.sha},file_base64=${file.b64} where template_id=${t.template_id}`;
  return {ok:true};
 }
 if(p.action==='template_library_retire'){
  if(t.status==='Retired')fail(409,'It is already retired.');
  const why=text(p.reason||'',500,false).trim();if(why.length<5)fail(400,'Say why it is retired (at least 5 characters).');
  await tx`update erp_private.import_templates set status='Retired',retired_by=${a.staff_id},retired_at=now(),retired_reason=${why} where template_id=${t.template_id}`;
  return {ok:true};
 }
 // template_library_publish
 if(t.status!=='Draft')fail(409,'Only a draft is published.');
 let sole=false;
 if(t.created_by===a.staff_id){
  sole=a.category_code==='PARTNER'&&(await tx`select erp_private.sole_active_partner() as sole`)[0]?.sole===true;
  if(!sole)fail(403,'A different Manager or Partner publishes a template you uploaded, unless you are your firm\'s only Partner.');
 }
 const prior=(await tx`select template_id from erp_private.import_templates where template_key=${t.template_key} and status='Published' for update`)[0];
 if(prior)await tx`update erp_private.import_templates set status='Retired',retired_by=${a.staff_id},retired_at=now(),retired_reason=${'Replaced by version '+t.version} where template_id=${prior.template_id}`;
 await tx`update erp_private.import_templates set status='Published',published_by=${a.staff_id},published_at=now(),sole_partner_publish=${sole} where template_id=${t.template_id}`;
 return {ok:true,replaced:!!prior,sole_partner_publish:sole};
}
