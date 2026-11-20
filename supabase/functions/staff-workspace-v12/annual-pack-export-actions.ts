import {fail,text,date,choice} from './validation.mjs';
import {digestOf} from './statement-version-rules.mjs';
import {assemblePack} from './annual-pack-assembly.mjs';
import {packPdf} from './annual-pack-pdf.mjs';
import {packWorkbook} from './annual-pack-workbook.mjs';
import {pagesFor} from './client-pages-actions.ts';
import {wordingFor} from './wording-actions.ts';
import {loadAudit} from './audit-lock-actions.ts';
import {registerPack} from './report-notes-actions.ts';
// Pack assembly and export (build 2885). One model, built from the same statements, pages, wording and audit lock the screens use, is drawn as a PDF or a workbook. The status word and the watermark
// come from the annual gate and the audit lock; nothing here changes a figure or approves anything. A signed external auditor's report is read from the client's private document vault, checked
// against the fingerprint recorded when the pack was locked, and added to the PDF exactly as signed. If it does not match, it is not attached and the pack says so.
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const hex=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
async function loadAttachment(tx:any,l:any,lock:any,storage:any){
 if(!lock||lock.mode!=='External audit'||!lock.document_id)return {attachment:null,bytes:null};
 const doc=(await tx`select document_id,file_name,object_key,sha256,mime_type from erp_private.documents where document_id=${lock.document_id} and client_id=${l.client_id} and deleted_at is null`)[0];
 if(!doc)return {attachment:{verified:false,file_name:'',reason:'the signed report is no longer in the client’s document vault.'},bytes:null};
 if(!storage)return {attachment:{verified:false,file_name:doc.file_name,reason:'private storage is not available.'},bytes:null};
 const got=await storage.download(doc.object_key);
 if(got.error||!got.data)return {attachment:{verified:false,file_name:doc.file_name,reason:'the file could not be read from private storage.'},bytes:null};
 const bytes=new Uint8Array(await got.data.arrayBuffer()),sha=await hex(bytes);
 if(sha!==lock.document_sha256||(doc.sha256&&sha!==doc.sha256))return {attachment:{verified:false,file_name:doc.file_name,reason:'the file does not match the fingerprint recorded when the pack was locked.'},bytes:null};
 return {attachment:{verified:true,document_id:doc.document_id,file_name:doc.file_name,sha256:sha},bytes};
}
export async function packAssembleModel(tx:any,l:any,ann:any,storage:any,asOf:string){
 const st=ann.st,form=st.client?.legal_form;
 const base={statements:st.statements,client:{name:st.client?.name||'',legal_form:form},reporting:st.reporting,as_of:asOf};
 const pg=await pagesFor(tx,l,base),wd=await wordingFor(tx,l,base),au=await loadAudit(tx,l);
 const lock=au.lock&&{...au.lock,report_date:day(au.lock.report_date),locked_at:au.lock.locked_at};
 const att=await loadAttachment(tx,l,lock,storage);
 const model=assemblePack({client:st.client,reporting:st.reporting,statements:st.statements,wording:{sections:wd.asm.sections},pages:pg.built,gate:ann.gate,audit:st.statements.audit,lock,asOf,attachment:att.attachment});
 // The wording's own problems are open checks of the pack already; they are not repeated here.
 const fingerprint=await digestOf({m:model,att:att.attachment&&att.attachment.sha256||null});
 return {model,fingerprint,attachmentBytes:att.bytes,lockId:lock&&lock.lock_id||null};
}
export async function packAssembleAction(tx:any,a:any,l:any,p:any,deps:{annualGateFor:(tx:any,l:any,asOf:string)=>Promise<any>,storage:any,pdfLib:()=>any,ExcelJS:any}){
 if(!['ledger_pack_assemble_read','ledger_pack_assemble'].includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The assembled pack is for staff who prepare or review statements.');
 const asOf=p.as_of?date(p.as_of):day(l.ends_on),ann=await deps.annualGateFor(tx,l,asOf),built=await packAssembleModel(tx,l,ann,deps.storage,asOf),m=built.model;
 const summary={status_word:m.status.word,watermark:m.status.watermark,open_checks:m.status.open_checks,complete:m.complete,problems:m.problems,numbering:m.numbering,note_index:m.note_index,
  contents:m.sections.map((s:any)=>({code:s.code,title:s.title,ready:s.ready})),attachments:m.attachments.map((x:any)=>({file_name:x.file_name,sha256:x.sha256})),fingerprint:built.fingerprint};
 if(p.action==='ledger_pack_assemble_read')return summary;
 const format=choice(p.format,['pdf','xlsx']),safeName=String(m.client.name||'client').replace(/[^A-Za-z0-9]+/g,'_').slice(0,60),word=m.status.word.replace(/ /g,'_');
 let bytes:Uint8Array,mime:string;
 if(format==='pdf'){
  const lib=deps.pdfLib();if(!lib)fail(500,'The PDF writer is not available.');
  bytes=await packPdf(m,lib,{attachmentBytes:built.attachmentBytes,fingerprint:built.fingerprint,issuedAt:asOf+'T00:00:00Z'});mime='application/pdf';
 }else{
  const book=packWorkbook(m,deps.ExcelJS,{fingerprint:built.fingerprint});bytes=new Uint8Array(await book.xlsx.writeBuffer());mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 }
 let str='';for(let i=0;i<bytes.length;i+=16384)str+=String.fromCharCode(...bytes.subarray(i,i+16384));
 const file_name=`${safeName}_Annual_pack_${asOf}_${word}.${format}`;
 // Build 2890: the produced pack is registered by its fingerprint. It is final only when no check is open; a live, current audit lock signs it.
 const pack_id=await registerPack(tx,a,l,{pack_kind:'Annual filing pack',report_kind:null,as_of:asOf,file_format:format,file_name,status_word:m.status.word,fingerprint:built.fingerprint,is_final:!m.status.open_checks.length&&m.status.word!=='Draft',lock:{lock_id:built.lockId,stale:m.status.word!=='Audited'}});
 return {...summary,format,file_name,mime_type:mime,base64:btoa(str),pack_id};
}
