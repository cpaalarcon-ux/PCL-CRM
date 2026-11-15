import {fail,uuid,choice} from './validation.mjs';
import {parseKraCsv,compareVersions,reconcileSales,matchPurchases,applyReviews,sectionFromName,SALES_SECTIONS,PURCHASE_SECTIONS,SECTION_LABELS,RATE_OF,DISPOSITIONS,RECON_TOLERANCE} from './kra-csv-rules.mjs';
import {parseCSV} from './source-reader.mjs';
// Build 2831a: KRA VAT CSV evidence. Each upload is retained exactly as received (a corrected file for the same month and section is a new version that
// supersedes the old one with a reason), parsed into text-preserving lines, and compared with the approved registers. Nothing here posts or edits a register.
const ACTIONS=['kra_csv_read','kra_csv_upload','kra_csv_review','kra_csv_original'];
const MAX_CHARS=3_000_000;
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const monthOf=(v:any)=>{const m=String(v||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))fail(400,'Choose the month as YYYY-MM.');return m;};
const num=(v:any)=>v==null?v:Number(v);
const lineOut=(l:any)=>({...l,net:Number(l.net),vat:Number(l.vat),invoice_date:day(l.invoice_date)});

async function latestBatches(tx:any,cid:string,month:string,side:string){
 const batches=await tx`select distinct on (section) batch_id,section,version,file_name,content_sha256,line_count,totals,issues,supersede_reason,uploaded_at,erp_private.reviewer_label(uploaded_by) as uploaded_by_name from erp_private.kra_csv_batches where client_id=${cid} and side=${side} and period_month=${month+'-01'} order by section,version desc`;
 const ids=batches.map((b:any)=>b.batch_id),lines=ids.length?await tx`select batch_id,line_no,invoice_no,original_invoice,invoice_date,party_pin,party_name,description,net,vat,vat_derived,vat_category,document_type from erp_private.kra_csv_lines where batch_id=any(${ids}::uuid[]) order by batch_id,line_no`:[];
 const uploaded:any={};for(const b of batches)uploaded[b.section]={...b,uploaded_at:b.uploaded_at,totals:b.totals,lines:lines.filter((l:any)=>l.batch_id===b.batch_id).map(lineOut)};
 return uploaded;
}
async function previousLines(tx:any,batch:any){
 const prev=(await tx`select batch_id from erp_private.kra_csv_batches where client_id=(select client_id from erp_private.kra_csv_batches where batch_id=${batch.batch_id}) and batch_id=(select supersedes_batch_id from erp_private.kra_csv_batches where batch_id=${batch.batch_id})`)[0];
 if(!prev)return null;
 return (await tx`select invoice_no,party_pin,net,vat,invoice_date from erp_private.kra_csv_lines where batch_id=${prev.batch_id} order by line_no`).map(lineOut);
}
async function salesGroups(tx:any,cid:string,month:string){
 const imports=await tx`select import_id,starts_on,ends_on,payload from erp_private.period_imports where client_id=${cid} and kind='Sales' and status='Confirmed' and starts_on<=((${month+'-01'}::date+interval '1 month')::date-1) and ends_on>=${month+'-01'}::date`;
 const groups:any[]=[];for(const i of imports)for(const g of (i.payload?.groups||[])){const ym=g.month||day(i.starts_on).slice(0,7);if(ym===month)groups.push({vat_category:g.vat_category,net:g.net,vat:g.vat});}
 return {groups,imports:imports.length};
}
async function purchaseRows(tx:any,cid:string,month:string){
 const rows=await tx`select row_id,normalized from erp_private.workbook_rows where client_id=${cid} and dataset='Purchases' and normalized->>'date' like ${month+'%'}`;
 return rows.map((r:any)=>({row_id:r.row_id,invoice:r.normalized.invoice,party_pin:r.normalized.party_pin,party:r.normalized.party,date:r.normalized.date,amount:r.normalized.amount,vat:r.normalized.vat,vat_category:r.normalized.vat_category}));
}
async function reviewsFor(tx:any,cid:string,month:string,side:string){
 return await tx`select scope_key,evidence_hash,disposition,reason,reviewed_at,erp_private.reviewer_label(reviewed_by) as reviewed_by_name from erp_private.kra_csv_reviews where client_id=${cid} and side=${side} and period_month=${month+'-01'} order by reviewed_at`;
}
async function reconcile(tx:any,cid:string,month:string,side:'Sales'|'Purchases'){
 const uploaded=await latestBatches(tx,cid,month,side),reviews=await reviewsFor(tx,cid,month,side);
 if(side==='Sales'){const {groups,imports}=await salesGroups(tx,cid,month),r=reconcileSales({uploaded,groups,month}),applied=applyReviews(r.differences,reviews);return {uploaded,result:{...r,...applied,register_imports:imports}};}
 const r=matchPurchases({uploaded,rows:await purchaseRows(tx,cid,month),month}),applied=applyReviews(r.differences,reviews);return {uploaded,result:{...r,...applied}};
}
const summary=(b:any)=>b?{batch_id:b.batch_id,version:b.version,file_name:b.file_name,sha256:b.content_sha256,line_count:b.line_count,totals:b.totals,warnings:b.issues,supersede_reason:b.supersede_reason,uploaded_at:b.uploaded_at,uploaded_by:b.uploaded_by_name}:null;

export async function kraCsvAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'KRA CSV evidence is handled by staff with client access.');
 const project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`),cid=project.client_id;
 if(p.action==='kra_csv_original'){
  const b=one(await tx`select batch_id,file_name,content_text,content_sha256,section,version,period_month from erp_private.kra_csv_batches where batch_id=${uuid(p.batch_id)} and client_id=${cid}`);
  return {file_name:b.file_name,content_text:b.content_text,sha256:b.content_sha256,section:b.section,version:b.version,month:day(b.period_month).slice(0,7)};
 }
 const month=monthOf(p.month);
 if(p.action==='kra_csv_read'){
  const sales=await reconcile(tx,cid,month,'Sales'),purchases=await reconcile(tx,cid,month,'Purchases'),all={...sales.uploaded,...purchases.uploaded};
  const changes:any={};for(const s of [...SALES_SECTIONS,...PURCHASE_SECTIONS]){const b=all[s];if(b&&b.version>1){const prev=await previousLines(tx,b);if(prev){const c=compareVersions(prev,b.lines);changes[s]={from_version:b.version-1,to_version:b.version,added:c.added.slice(0,100),removed:c.removed.slice(0,100),changed:c.changed.slice(0,100),unchanged:c.unchanged,added_count:c.added.length,removed_count:c.removed.length,changed_count:c.changed.length,reason:b.supersede_reason};}}}
  return {month,tolerance:RECON_TOLERANCE,dispositions:DISPOSITIONS,
   sections:[...SALES_SECTIONS,...PURCHASE_SECTIONS].map(s=>({section:s,label:SECTION_LABELS[s],side:SALES_SECTIONS.includes(s)?'Sales':'Purchases',rate:RATE_OF[s],current:summary(all[s])})),
   sales:{...sales.result,differences:sales.result.differences},purchases:{...purchases.result,differences:purchases.result.differences.slice(0,300),difference_count:purchases.result.differences.length},version_changes:changes};
 }
 if(project.status==='Archived')fail(400,'Archived projects retain read-only history.');
 if(p.action==='kra_csv_upload'){
  const text=String(p.csv_text??'');if(!text.trim())fail(400,'Choose the CSV file.');if(text.length>MAX_CHARS)fail(400,'The CSV is larger than 3 MB. Split it by section.');
  const fileName=String(p.file_name||'').trim().slice(0,200)||'KRA.csv';
  const section=(p.section?choice(String(p.section).toUpperCase(),[...SALES_SECTIONS,...PURCHASE_SECTIONS]):sectionFromName(fileName))||fail(400,'The section could not be read from the file name. Choose the section (B, C, D1, E, F, G, H or I).');
  const side=SALES_SECTIONS.includes(section)?'Sales':'Purchases';
  let rows:string[][];try{rows=parseCSV(new TextEncoder().encode(text));}catch(e){fail(400,(e as Error).message||'The CSV could not be read.');}
  const parsed=parseKraCsv({rows,section,month});if(parsed.blocking.length)fail(400,parsed.blocking.slice(0,4).join(' ')+(parsed.blocking.length>4?` (and ${parsed.blocking.length-4} more)`:''));
  const sha=await hex(text),latest=(await tx`select batch_id,version,content_sha256 from erp_private.kra_csv_batches where client_id=${cid} and side=${side} and section=${section} and period_month=${month+'-01'} order by version desc limit 1`)[0];
  if(latest&&latest.content_sha256===sha)fail(409,`This exact file is already retained as version ${latest.version} for ${month}.`);
  const reason=String(p.supersede_reason||'').trim();if(latest&&reason.length<10)fail(400,`A file is already retained for ${SECTION_LABELS[section]} in ${month}. Say why this file replaces it (at least 10 characters).`);
  const batch=one(await tx`insert into erp_private.kra_csv_batches(client_id,project_id,side,section,period_month,version,supersedes_batch_id,supersede_reason,file_name,content_text,content_sha256,line_count,totals,issues,uploaded_by)
   values(${cid},${project.project_id},${side},${section},${month+'-01'},${latest?latest.version+1:1},${latest?latest.batch_id:null},${latest?reason:null},${fileName},${text},${sha},${parsed.lines.length},${tx.json(parsed.totals)},${tx.json(parsed.warnings.slice(0,200))},${a.staff_id}) returning batch_id,version`);
  for(let i=0;i<parsed.lines.length;i+=500){const part=parsed.lines.slice(i,i+500);
   await tx`insert into erp_private.kra_csv_lines(batch_id,client_id,line_no,invoice_no,original_invoice,invoice_date,party_pin,party_name,description,net,vat,vat_derived,vat_category,document_type,raw)
    select ${batch.batch_id}::uuid,${cid}::uuid,x.line_no,x.invoice_no,x.original_invoice,x.invoice_date,x.party_pin,x.party_name,x.description,x.net,x.vat,x.vat_derived,x.vat_category,x.document_type,x.raw
    from jsonb_to_recordset(${tx.json(part)}::jsonb) as x(line_no int,invoice_no text,original_invoice text,invoice_date date,party_pin text,party_name text,description text,net numeric,vat numeric,vat_derived boolean,vat_category text,document_type text,raw jsonb)`;}
  let changes:any=null;if(latest){const prev=(await tx`select invoice_no,party_pin,net,vat,invoice_date from erp_private.kra_csv_lines where batch_id=${latest.batch_id} order by line_no`).map(lineOut),c=compareVersions(prev,parsed.lines);changes={from_version:latest.version,to_version:batch.version,added:c.added.length,removed:c.removed.length,changed:c.changed.length,unchanged:c.unchanged};}
  return {retained:true,batch_id:batch.batch_id,section,label:SECTION_LABELS[section],month,version:batch.version,line_count:parsed.lines.length,totals:parsed.totals,warnings:parsed.warnings.slice(0,50),warning_count:parsed.warnings.length,sha256:sha,changes};
 }
 // kra_csv_review: the decision must be on a difference that exists right now, with the evidence it was made on.
 const side=choice(String(p.side||''),['Sales','Purchases']) as 'Sales'|'Purchases',disposition=choice(String(p.disposition||''),DISPOSITIONS),reason=String(p.reason||'').trim();
 if(reason.length<10)fail(400,'Say what you found or decided (at least 10 characters).');
 const now=await reconcile(tx,cid,month,side),diff=now.result.differences.find((d:any)=>d.scope_key===String(p.scope_key||'')&&d.evidence_key===String(p.evidence_key||''));
 if(!diff)fail(409,'That difference has changed or no longer exists. Refresh the reconciliation.');
 const rec=one(await tx`insert into erp_private.kra_csv_reviews(client_id,project_id,side,period_month,scope_key,difference_kind,evidence_hash,disposition,reason,reviewed_by) values(${cid},${project.project_id},${side},${month+'-01'},${diff.scope_key},${diff.kind},${diff.evidence_key},${disposition},${reason.slice(0,500)},${a.staff_id}) returning review_id`);
 return {recorded:true,review_id:rec.review_id};
}
