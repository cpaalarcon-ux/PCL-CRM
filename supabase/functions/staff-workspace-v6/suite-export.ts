import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {fail,uuid} from './validation.mjs';
import {taxSummary} from './tax-review-actions.ts';
import {one,leader} from './suite-actions.ts';
const clean=(v:any)=>typeof v==='object'&&v!==null?JSON.stringify(v):v??'';
const dateText=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
async function workbook(sheets:any[]){const book=new ExcelJS.Workbook();for(const [name,headers,rows] of sheets){const sheet=book.addWorksheet(name.slice(0,31));sheet.addRow(headers);for(const r of rows)sheet.addRow(r.map(clean));sheet.eachRow((r:any)=>{r.eachCell((c:any)=>{c.font={name:'Arial',size:9};c.alignment={wrapText:true,vertical:'top'};});});sheet.columns.forEach((c:any)=>c.width=24);sheet.getRow(1).font={name:'Arial',size:9,bold:true};sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};}return new Uint8Array(await book.xlsx.writeBuffer());}
async function pdf(title:string,lines:string[]){const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica);let page=doc.addPage(),y=790;
 for(const original of [title,'',...lines])for(const line0 of String(original).split('\n')){
  let line=line0.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7e]/g,' ');
  while(line.length||line0===''){const chunk=line.slice(0,98);line=line.slice(98);if(y<45){page=doc.addPage();y=790;}page.drawText(chunk,{x:40,y,size:9,font});y-=14;if(!line)break;}
 }return await doc.save();}
async function docx(title:string,lines:string[]){const z=new JSZip(),xml=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
 z.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 z.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 z.file('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+[title,...lines].map(t=>'<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">'+xml(t)+'</w:t></w:r></w:p>').join('')+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>');return z.generateAsync({type:'uint8array'});}
const base64=(bytes:Uint8Array)=>{let str='';for(let i=0;i<bytes.length;i+=16384)str+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(str);};
export async function suiteExport(tx:any,a:any,p:any,storage:any){
 if(p.action!=='suite_export')return undefined;
 const id=uuid(p.record_id),zip=new JSZip();let name='',bytes:Uint8Array,mime='application/zip';let docs:any[]=[];
 if(p.kind==='Tax'){
  const c=one(await tx`select * from erp_private.tax_cases where case_id=${id}`),project=one(await tx`select * from erp_private.projects where project_id=${c.project_id}`),client=one(await tx`select company_name from erp_private.clients where client_id=${project.client_id}`);
  const locked=['Locked','Filed'].includes(c.status),snapshot=c.review_snapshot;
  const current=await taxSummary(tx,c),rows=current.rows;
  const calculated=locked?c.result:current.result;
  if(rows.length>10000)fail(400,'Split exports into smaller reviewed periods.');
  const summary=Object.entries(calculated).filter(([,v])=>!Array.isArray(v)).map(([k,v])=>[k,clean(v)]),sheets:any[]=[['Summary',['Metric','Value'],[['Client',client.company_name],['Tax',c.kind],['Status',c.status],['Use',locked?'Reviewed compilation; verify filing separately':'DRAFT - NOT FOR FILING'],...summary]]];
  for(const dataset of ['Sales','Purchases','Expenditure','Non-eTIMS','Bank','General']){const selected=rows.filter((r:any)=>r.dataset===dataset||locked&&snapshot.batches.find((b:any)=>b.batch_id===r.batch_id)?.dataset===dataset);if(selected.length)sheets.push([dataset,['Reference','Date','Party','Net / amount','VAT','Decision','Deductible %','VAT rule','Income treatment','Original values'],selected.map((r:any)=>[r.normalized.invoice||r.normalized.reference,r.normalized.date,r.normalized.party,r.normalized.amount,r.normalized.vat,r.decision||'',r.deductible_percentage??'',r.vat_rate_key||'',r.income_treatment||'',r.normalized])]);}
  if(calculated.employees)sheets.push(['Payroll',['Employee','Gross','Deductions','Taxable pay','PAYE','Source PAYE','Difference'],calculated.employees.map((e:any)=>[e.name,e.gross,e.allowed_deductions,e.taxable,e.paye,e.source_paye,e.variance])]);
  if(calculated.allocation)sheets.push(['Partner allocations',['Partner','Profit share %','Allocated income'],calculated.allocation.map((x:any)=>[x.name,x.share,x.amount])]);
  sheets.push(['Applied tax rules',['Code','Label','From','Through','Parameters','Official source','Approval'],(current.applied_rates||[]).map((r:any)=>[r.rate_key,r.label,dateText(r.effective_from),dateText(r.effective_to),r.parameters,r.source_url,r.approved_at])]);
  if(current.profile)sheets.push(['Client tax profile',['Field','Value'],Object.entries(current.profile).filter(([k])=>['entity_type','residency','regime','obligations','effective_from','effective_to','notes','verified_at'].includes(k))]);
  if(!locked)sheets.push(['Review blockers',['Issue'],current.issues.map((i:string)=>[i])]);
  const xlsx=await workbook(sheets);if(p.format==='xlsx'){bytes=xlsx;mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';name=`${c.kind}_${id.slice(0,8)}.xlsx`;}
  else {zip.file('01_Summary_Report.pdf',await pdf((locked?'':'DRAFT - NOT FOR FILING | ')+c.kind+' compilation',[client.company_name,`Period ${dateText(c.starts_on)} to ${dateText(c.ends_on)}`,`Status: ${c.status}`,...summary.map(([k,v])=>`${k}: ${v}`),...(current.applied_rates||[]).map((r:any)=>`Applied ${r.rate_key} | ${dateText(r.effective_from)} to ${dateText(r.effective_to)} | ${JSON.stringify(r.parameters)} | ${r.source_url}`),...(!locked?current.issues.map((i:string)=>'REVIEW: '+i):[])]));zip.file('02_Working_Papers.xlsx',xlsx);
   const findings=locked?snapshot.findings:await tx`select summary,status,resolution from erp_private.tax_findings where project_id=${c.project_id} and (case_id=${c.case_id} or case_id is null)`;zip.file('03_Findings.pdf',await pdf('Findings',findings.map((f:any)=>`${f.status}: ${f.summary} | ${f.resolution||''}`)));
   if(locked){const docIds=[...new Set([...snapshot.batches.map((b:any)=>b.document_id),c.source_document_id].filter(Boolean))];docs=docIds.length?await tx`select * from erp_private.documents where document_id=any(${tx.array(docIds)}::uuid[])`:[];}
   name=`${locked?'Reviewed':'DRAFT'}_${c.kind}_${id.slice(0,8)}.zip`;bytes=new Uint8Array();
  }
 }else if(p.kind==='KYC'){
  leader(a);const client=one(await tx`select * from erp_private.clients where client_id=${id}`),kyc=(await tx`select * from erp_private.client_compliance where client_id=${id}`)[0]||{},owners=await tx`select full_name,ownership_percentage,control_basis from erp_private.beneficial_owners where client_id=${id} and deleted_at is null`;
  const lines=[`Client: ${client.company_name}`,`KRA PIN: ${client.kra_pin||'Missing'}`,`Sector: ${client.primary_sector||'Missing'}`,`Branch: ${client.branch_location||'Missing'}`,`Risk: ${kyc.risk_rating||'Not assessed'}`,`KYC verified: ${kyc.verified_by?'Yes':'No'}`,`Next review: ${kyc.review_due||'Missing'}`,`Notes: ${kyc.notes||''}`,...owners.map((o:any)=>`Owner/controller: ${o.full_name} | ${o.ownership_percentage}% | ${o.control_basis}`)];
  zip.file('KYC_Form.pdf',await pdf('KYC review record',lines));zip.file('KYC_Form.docx',await docx('KYC review record',lines));zip.file('KYC_Summary.xlsx',await workbook([['KYC',['Field','Value'],lines.map(l=>{const at=l.indexOf(':');return [l.slice(0,at),l.slice(at+1).trim()];})]]));
  docs=await tx`select * from erp_private.documents where client_id=${id} and category='Permanent File' and deleted_at is null`;name=`KYC_${id.slice(0,8)}.zip`;bytes=new Uint8Array();
 }else fail(400,'Choose a supported export.');
 if(mime==='application/zip'){
  if(docs.reduce((n,d)=>n+Number(d.file_size_bytes),0)>20*1024*1024)fail(400,'Attachments exceed the 20 MB package limit. Download the large original files separately.');
  for(const d of docs){const r=await storage.download(d.object_key);if(r.error||!r.data)fail(404,'A source attachment is unavailable; the package was not generated.');zip.file('Attachments/'+d.document_id+'_'+d.file_name.replace(/[^a-zA-Z0-9._-]/g,'_'),await r.data.arrayBuffer());await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${d.document_id},${a.auth_user_id},'DOWNLOAD')`;}
  bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}});
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'exports','DOWNLOAD',${id},${tx.json({kind:p.kind,name})})`;
 return {name,mime,base64:base64(bytes)};
}
