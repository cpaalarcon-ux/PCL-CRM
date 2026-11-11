import {fail,uuid,text,choice,revision,date} from './validation.mjs';
import {dispatchNotePdf,DISPATCH_METHODS} from './physical-file-pdf.mjs';

// Physical file register (build 2781). The rules live in the database (20261111020000_physical_files.sql): the reference PHY-YYYY-NNN, the append-only movement log,
// the scanned-copy requirement before a file leaves or is archived, and the lock once a file is returned or archived. This module checks input and shapes the answers.
// pdf-lib is supplied by index.ts so modules loaded in tests do not need it.
let PDFLib:any=null;export function setPhysicalPdfLib(lib:any){PDFLib=lib;}
const ACTIONS=['physical_file_list','physical_file_read','physical_file_register','physical_file_move','physical_file_pending','physical_file_return','physical_file_archive','physical_file_copy','physical_file_documents','physical_file_dispatch_note'];
const one=(r:any[],m='That physical file is unavailable to your account.')=>{if(!r.length)fail(404,m);return r[0];};
const opt=(v:any,max:number)=>v===undefined||v===null||v===''?null:text(String(v),max);

export async function physicalFileAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Your role does not handle physical files.');

 if(p.action==='physical_file_list'){
  const cid=p.client_id?uuid(p.client_id):null,tid=p.ticket_id?uuid(p.ticket_id):null;
  return {files:await tx`select f.file_id,f.file_ref,f.client_id,f.firm_id,f.ticket_id,t.ticket_number,f.description,f.received_on,f.received_from,f.location,f.holder_id,coalesce(h.full_name,case when f.holder_id is null then null else 'A colleague' end) holder_name,f.status,f.digital_document_id,d.file_name digital_name,f.no_scan_reason,f.created_at,f.revision,c.company_name from erp_private.physical_files f join erp_private.clients c on c.client_id=f.client_id left join erp_private.client_support_tickets t on t.ticket_id=f.ticket_id left join erp_private.staff_members h on h.staff_id=f.holder_id left join erp_private.documents d on d.document_id=f.digital_document_id
   where (${cid}::uuid is null or f.client_id=${cid}) and (${tid}::uuid is null or f.ticket_id=${tid}) order by (f.status in('Returned to client','Archived')),f.created_at desc limit 300`};
 }
 if(p.action==='physical_file_documents'){
  return {documents:await tx`select document_id,file_name,category,uploaded_at from erp_private.documents where client_id=${uuid(p.client_id)} and handling_firm_id=${uuid(p.firm_id)} and deleted_at is null order by uploaded_at desc limit 200`};
 }
 if(p.action==='physical_file_read'){
  const f=one(await tx`select f.file_id,f.file_ref,f.client_id,f.firm_id,f.ticket_id,t.ticket_number,f.description,f.received_on,f.received_from,f.location,f.holder_id,coalesce(h.full_name,case when f.holder_id is null then null else 'A colleague' end) holder_name,f.status,f.digital_document_id,d.file_name digital_name,f.no_scan_reason,f.created_at,f.revision,c.company_name from erp_private.physical_files f join erp_private.clients c on c.client_id=f.client_id left join erp_private.client_support_tickets t on t.ticket_id=f.ticket_id left join erp_private.staff_members h on h.staff_id=f.holder_id left join erp_private.documents d on d.document_id=f.digital_document_id where f.file_id=${uuid(p.file_id)}`);
  const movements=await tx`select m.movement_id,m.kind,m.moved_at,coalesce(s.full_name,'A colleague') moved_by_name,m.from_holder,coalesce(fh.full_name,case when m.from_holder is null then null else 'A colleague' end) from_name,m.to_holder,coalesce(th.full_name,case when m.to_holder is null then null else 'A colleague' end) to_name,m.from_location,m.to_location,m.status_after,m.note,m.dispatch_note_no,m.dispatch_method,m.dispatch_recipient,m.dispatch_reference
   from erp_private.physical_file_movements m left join erp_private.staff_members s on s.staff_id=m.moved_by left join erp_private.staff_members fh on fh.staff_id=m.from_holder left join erp_private.staff_members th on th.staff_id=m.to_holder where m.file_id=${f.file_id} order by m.moved_at,m.movement_id`;
  return {file:f,movements};
 }
 if(p.action==='physical_file_register'){
  const cid=uuid(p.client_id),firm=uuid(p.firm_id),tid=p.ticket_id?uuid(p.ticket_id):null;
  one(await tx`select 1 from erp_private.client_firm_links where client_id=${cid} and firm_id=${firm} and deleted_at is null`,'That client is not linked to the chosen firm.');
  const r=await tx`insert into erp_private.physical_files(client_id,firm_id,ticket_id,description,received_on,received_from,location,created_by) values(${cid},${firm},${tid},${text(p.description,300)},coalesce(${p.received_on?date(p.received_on):null}::date,(now() at time zone 'Africa/Nairobi')::date),${opt(p.received_from,200)},${text(p.location,200)},${a.staff_id}) returning file_id,file_ref`;
  return {ok:true,file_id:r[0].file_id,file_ref:r[0].file_ref};
 }
 const f=one(await tx`select * from erp_private.physical_files where file_id=${uuid(p.file_id)} for update`);
 if(p.action==='physical_file_dispatch_note'){
  if(f.status!=='Returned to client')fail(400,'A dispatch note exists only once the file has been returned to the client.');
  if(!PDFLib)fail(500,'PDF generation is not available.');
  const m=one(await tx`select m.*,s.full_name moved_by_name from erp_private.physical_file_movements m left join erp_private.staff_members s on s.staff_id=m.moved_by where m.file_id=${f.file_id} and m.kind='Returned to client'`);
  const firm=one(await tx`select legal_name,kra_pin,phone,email,physical_address from erp_private.firms where firm_id=${f.firm_id}`),client=one(await tx`select company_name,kra_pin from erp_private.clients where client_id=${f.client_id}`);
  const tk=f.ticket_id?(await tx`select ticket_number from erp_private.client_support_tickets where ticket_id=${f.ticket_id}`)[0]:null,doc=f.digital_document_id?(await tx`select file_name from erp_private.documents where document_id=${f.digital_document_id}`)[0]:null;
  const bytes=await dispatchNotePdf({firm,client:{name:client.company_name,pin:client.kra_pin},file:{file_ref:f.file_ref,description:f.description,received_on:f.received_on,received_from:f.received_from,ticket_number:tk?.ticket_number||null,digital_name:doc?.file_name||null,no_scan_reason:f.no_scan_reason},movement:m},PDFLib);
  let b='';for(let k=0;k<bytes.length;k+=16384)b+=String.fromCharCode(...bytes.subarray(k,k+16384));
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'physical_files','DISPATCH_NOTE_PDF',${f.file_id},${tx.json({dispatch_note_no:m.dispatch_note_no})})`;
  return {file_name:String(m.dispatch_note_no).replace(/[^A-Za-z0-9]+/g,'_')+'.pdf',mime_type:'application/pdf',base64:btoa(b)};
 }
 if(String(f.revision)!==revision(p.revision))fail(409,'This file changed. Refresh first.');
 const note=opt(p.note,1000);
 if(p.action==='physical_file_copy'){
  const doc=p.document_id?uuid(p.document_id):null,why=p.no_scan_reason?text(p.no_scan_reason,500):null;
  if(!doc&&!why)fail(400,'Choose the scanned document, or write why the file has no scanned copy (at least 10 characters).');
  if(!doc&&why&&why.trim().length<10)fail(400,'Write why the file has no scanned copy (at least 10 characters).');
  await tx`update erp_private.physical_files set digital_document_id=${doc},no_scan_reason=${doc?null:why} where file_id=${f.file_id}`;return {ok:true};
 }
 const mv=async(kind:string,extra:any={})=>{await tx`insert into erp_private.physical_file_movements(file_id,kind,moved_by,status_after,note,to_holder,to_location,dispatch_method,dispatch_recipient,dispatch_reference) values(${f.file_id},${kind},${a.staff_id},${f.status},${note},${extra.to_holder||null},${extra.to_location||null},${extra.method||null},${extra.recipient||null},${extra.reference||null})`;return {ok:true};};
 if(p.action==='physical_file_move')return mv('Moved',{to_holder:p.to_holder?uuid(p.to_holder):null,to_location:opt(p.to_location,200)});
 if(p.action==='physical_file_pending')return mv('Pending dispatch',{to_location:opt(p.to_location,200)});
 if(p.action==='physical_file_archive')return mv('Archived',{to_location:text(p.to_location,200)});
 // physical_file_return
 return mv('Returned to client',{method:choice(p.dispatch_method,DISPATCH_METHODS),recipient:text(p.dispatch_recipient,200),reference:text(p.dispatch_reference,200)});
}
