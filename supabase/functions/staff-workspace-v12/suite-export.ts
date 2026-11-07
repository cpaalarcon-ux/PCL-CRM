import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {fail,uuid} from './validation.mjs';
import {taxSummary} from './tax-review-actions.ts';
import {vat3File} from './vat3-export.ts';
import {one,leader} from './suite-actions.ts';
const clean=(v:any)=>typeof v==='object'&&v!==null?JSON.stringify(v):v??'';
const dateText=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const annualKinds=['Company','Individual','Partnership'];
function kraForm(kind:string,profile:any){
 if(kind==='Company')return 'IT2C · Company income tax return';
 if(kind==='Partnership')return 'IT2P · Partnership income tax return';
 if(kind==='Individual')return profile?.residency==='Non-resident'?'ITNR · Individual non-resident return':'IT1 · Individual resident return';
 if(kind==='VAT')return 'VAT3 · VAT return';
 if(kind==='PAYE')return 'PAYE return';
 return `${kind} · use the applicable KRA return or payment workflow`;
}
function returnLines(kind:string,result:any,profile:any){
 const confirm='Confirm the exact field in the current KRA return workbook for this period';
 if(annualKinds.includes(kind)){
  const rows:any[]=[
   ['Accounting profit / (loss)',result.accounting_profit,'Posted annual ledger and financial statements',confirm],
   ['Supported tax add-backs',result.addbacks,'Reviewed tax adjustments and linked evidence',confirm],
   ['Deductions / capital allowances',result.deductions,'Reviewed deductions and approved asset schedule',confirm],
   ['Losses utilised',result.losses,'Approved loss schedule',confirm],
   ['Chargeable / taxable income',result.chargeable,'Calculated from the above lines',confirm]
  ];
  if(kind==='Partnership')rows.push(['Partnership tax at entity level',result.tax_at_entity,'Partnership computation; see Partner allocations sheet','Confirm the partnership return treatment']);
  else rows.push(['Tax before credits',result.gross_tax,'ERP tax calculation using the effective approved rate',confirm],['Reliefs',result.reliefs,'Verified client profile and supported relief inputs',confirm],['Tax credits',result.credits,'Certified withholding / instalment credits',confirm],['Balance payable',result.payable??result.balance,'Calculated after reliefs and credits',confirm],['Overpayment',result.overpayment,'Calculated after reliefs and credits',confirm]);
  return rows.map(([label,value,basis,locator])=>[label,value??'',basis,locator,'Preparation mapping only']);
 }
 return Object.entries(result||{}).filter(([,v])=>v===null||['string','number','boolean'].includes(typeof v)).map(([key,value])=>[
  key.replaceAll('_',' ').replace(/\b\w/g,(x:string)=>x.toUpperCase()),value,
  'Tax case calculation and reviewed source rows',confirm,'Preparation mapping only'
 ]);
}
import {workbook} from './workbook-file.ts';
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
  const c=one(await tx`select * from erp_private.tax_cases where case_id=${id}`),project=one(await tx`select * from erp_private.projects where project_id=${c.project_id}`),client=one(await tx`select company_name,kra_pin,legal_entity_type from erp_private.clients where client_id=${project.client_id}`),staffIds=[c.prepared_by,c.reviewed_by].filter(Boolean),staff=staffIds.length?await tx`select staff_id,full_name from erp_private.staff_members where staff_id=any(${tx.array(staffIds)}::uuid[])`:[],staffNames=new Map(staff.map((x:any)=>[x.staff_id,x.full_name]));
  const locked=['Locked','Filed'].includes(c.status),snapshot=c.review_snapshot;
  const current=await taxSummary(tx,c),rows=current.rows;
  const calculated=locked?c.result:current.result,testing=calculated.testing_only===true,profile=locked?(snapshot?.profile||current.profile):current.profile,sourceApp=locked?(snapshot?.source_application||current.source_application):current.source_application;
  if(rows.length>10000)fail(400,'Split exports into smaller reviewed periods.');
  if(p.format==='vat3'){
   const f=await vat3File(c,client,staffNames,rows,calculated,locked);bytes=f.bytes;mime=f.mime;name=f.name;
   await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'exports','DOWNLOAD',${id},${tx.json({kind:'VAT3',name})})`;
   return {name,mime,base64:base64(bytes)};
  }
  const statusText=testing?'TESTING — NOT FOR FILING':c.status==='Filed'?'ERP filing status recorded — confirm the KRA acknowledgment in the linked task':locked?'Manager-reviewed working pack — complete the current KRA return separately':c.status==='Submitted'?'Submitted for internal review':'Draft — complete the preparation and review';
  const formName=kraForm(c.kind,profile),summary=Object.entries(calculated).filter(([,v])=>!Array.isArray(v)).map(([k,v])=>[k,clean(v)]),sheets:any[]=[
   ['Start Here',['Read before using this pack','Instruction'],[
    ['Purpose','Staff working pack to prepare and review figures for the applicable KRA obligation.'],
    ['Important','This workbook/PDF is not an official KRA return, submission file, or filing receipt. Do not upload this pack to iTax unless KRA specifically accepts this format.'],
    ['Next step',locked?'Use the current official KRA return for the period, enter the reviewed figures from Return Lines, complete KRA validation, and retain the acknowledgment and PRN in the linked filing task.':'Resolve the Review blockers, obtain independent review, and lock the computation before using it to complete a return.'],
    ['KRA return type',formName],
    ['KRA form version','Not embedded in the ERP. Confirm the official form version applicable to this tax period before filing.'],
    ['Changing a figure','Do not overwrite a reviewed amount. Reopen the computation through the authorised correction process, update the basis, and obtain review again.'],
    ['Source files','Imported TB, purchases, payroll and other working data are not supporting evidence by themselves. Link original evidence separately.']
   ]],
   ['Return Control',['Control','Value'],[
    ['Client',client.company_name],['KRA PIN',client.kra_pin||'Not recorded'],['Legal entity type',client.legal_entity_type||profile?.entity_type||'Not verified'],
    ['Project',project.project_name],['Obligation',c.kind],['Suggested KRA return',formName],['Tax period from',dateText(c.starts_on)],['Tax period through',dateText(c.ends_on)],
    ['ERP case status',c.status],['Use status',statusText],['Case reference',c.case_id],['Prepared by',staffNames.get(c.prepared_by)||'Not recorded'],['Reviewed by',staffNames.get(c.reviewed_by)||'Not recorded'],
    ['KRA filing date recorded',c.filing_date?dateText(c.filing_date):'Not recorded'],['Official KRA form version','Confirm current version for the period; not embedded in the ERP'],
    ['Income-tax year basis',annualKinds.includes(c.kind)?`${dateText(c.starts_on)} to ${dateText(c.ends_on)}`:'Not an annual income-tax case']
   ]],
   ['Summary',['Metric','Value'],[['Client',client.company_name],['Tax',c.kind],['Status',c.status],['Use',statusText],...summary,...(sourceApp?[['Source & Application status',sourceApp.balanced?'Balanced':'Review required'],['Source total KES',sourceApp.source_total],['Application total KES',sourceApp.application_total],['Source less application KES',sourceApp.difference],['Trial balance difference KES',sourceApp.trial_balance_difference],['Source / application tie-out KES',sourceApp.tie_out_difference]]:[])]],
   ['Return Lines',['ERP schedule line','Calculated value KES','Source / calculation basis','KRA field locator','Mapping status'],returnLines(c.kind,calculated,profile)],
   ['Control Checks',['Check','Status / value'],[
    ['Testing rate used',testing?'YES — NOT FOR FILING':'No testing rate identified'],['Source rows',current.source_count??rows.length],['Rejected rows',current.rejected_count??0],
    ['Unreviewed rows',current.unreviewed??0],['Unmapped rows',current.unmapped??0],['Trial balance difference KES',sourceApp?.trial_balance_difference??'Not available for this obligation'],
    ['Source & Application difference KES',sourceApp?.difference??'Not applicable / not available'],['Open preparation issues',(current.issues||[]).length],
    ...(current.pending_information?.total?[['Credit notes pending original invoice (excluded from this working)',current.pending_information.total],['Excluded credit notes: net KES',current.pending_information.net],['Excluded credit notes: VAT KES',current.pending_information.vat],['Excluded credit notes: gross KES',current.pending_information.gross],['Disclosure','These credit notes are not in the figures above and no liability or suspense balance is recorded for them. The totals are incomplete until the original invoice number and date are supplied.']]:[]),
    ...(current.issues||[]).map((issue:string)=>['Action required',issue])
   ]]
  ];
  for(const dataset of ['Sales','Purchases','Expenditure','Non-eTIMS','Bank','General']){const selected=rows.filter((r:any)=>r.dataset===dataset||locked&&snapshot.batches.find((b:any)=>b.batch_id===r.batch_id)?.dataset===dataset);if(selected.length)sheets.push([dataset,['Reference','Date','Party','Net / amount','VAT','Decision','Deductible %','VAT rule','Income treatment','Account code','Account name','Catalog version','Allocation source','Original values'],selected.map((r:any)=>[r.normalized.invoice||r.normalized.reference,r.normalized.date,r.normalized.party,r.normalized.amount,r.normalized.vat,r.decision||'',r.deductible_percentage??'',r.vat_rate_key||'',r.income_treatment||'',r.account_code||'',r.account_name||'',r.catalog_version||'',r.parent_row_id||'',r.raw_values||r.normalized])]);}
  if(current.pending_information?.total)sheets.push(['Pending credit notes',['Credit note','Date','Supplier','PIN','Net KES','VAT KES','Gross KES','Source file','Row'],current.pending_information.rows.map((r:any)=>[r.normalized?.invoice||'',r.normalized?.date||'',r.normalized?.party||'',r.normalized?.party_pin||'',r.normalized?.amount,r.normalized?.vat,r.normalized?.gross,r.file_name,r.source_row])]);
  if(sourceApp){const sections=[...sourceApp.sources,...sourceApp.applications,...(sourceApp.memo||[])];sheets.push(['Source & Application',['Section','Item','KES','Account detail'],sections.map((x:any)=>[x.section,x.label,x.amount,x.accounts])]);const details=sections.flatMap((x:any)=>x.accounts.map((a:any)=>[x.section,x.label,a.code,a.name,a.opening,a.closing,a.movement_debit,a.movement_credit,a.amount]));sheets.push(['S&A account detail',['Section','Item','Account code','Account name','Opening KES','Closing KES','Debit movement KES','Credit movement KES','Schedule amount KES'],details]);sheets.push(['S&A checks',['Control','KES / status'],[['Total sources',sourceApp.source_total],['Total applications',sourceApp.application_total],['Sources less applications',sourceApp.difference],['Closing trial-balance difference',sourceApp.trial_balance_difference],['Opening trial-balance difference',sourceApp.opening_trial_balance_difference],['Source / application tie-out',sourceApp.tie_out_difference],['Balanced',sourceApp.balanced?'Yes':'No'],...(sourceApp.issues||[]).map((x:string)=>['Review issue',x]),['Basis',sourceApp.basis]]]);sheets.push(['S&A evidence',['Requirement','Applicability','Status','Linked file'],(sourceApp.requirements||[]).map((x:any)=>[x.label,x.required?'Required by posted ledger activity':'No matching ledger activity recorded',x.status||'Check applicability',x.file_name||''])]);}
  if(current.reconciliation){const cr=current.reconciliation;sheets.push(['Sales bank review',['Field','Reviewed value'],Object.entries(cr).filter(([k])=>k!=='inputs'&&k!=='result')]);sheets.push(['Bank bridge',['Category','Amount KES','Reference','Note','Evidence'],(cr.result?.allocations||[]).map((x:any)=>[x.category,x.amount,x.reference,x.note,x.evidence_id])]);}
  if(calculated.employees)sheets.push(['Payroll',['Employee','Employment type','Gross','Deductions','Taxable pay','PAYE','Source PAYE','Difference'],calculated.employees.map((e:any)=>[e.name,e.employment_type||'Permanent',e.gross,e.allowed_deductions,e.taxable,e.paye,e.source_paye,e.variance])]);
  if(calculated.allocation)sheets.push(['Partner allocations',['Partner','Profit share %','Allocated income'],calculated.allocation.map((x:any)=>[x.name,x.share,x.amount])]);
  sheets.push(['Applied tax rules',['Code','Label','From','Through','Parameters','Official source','Approval'],(current.applied_rates||[]).map((r:any)=>[r.rate_key,r.label,dateText(r.effective_from),dateText(r.effective_to),r.parameters,r.source_url,r.approved_at])]);
  if(current.profile)sheets.push(['Client tax profile',['Field','Value'],Object.entries(current.profile).filter(([k])=>['entity_type','residency','regime','obligations','effective_from','effective_to','notes','verified_at'].includes(k))]);
  if(!locked)sheets.push(['Review blockers',['Issue'],current.issues.map((i:string)=>[i])]);
  const xlsx=await workbook(sheets);
  if(p.format==='xlsx'){
   bytes=xlsx;mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';name=`${testing?'TESTING_':locked?'Reviewed_':'DRAFT_'}${c.kind}_Filing_Pack_${id.slice(0,8)}.xlsx`;
  }else{
   const saLines=sourceApp?[`Source & Application of Funds: ${sourceApp.balanced?'BALANCED':'REVIEW REQUIRED'}`,`Total sources: KES ${sourceApp.source_total}`,`Total applications: KES ${sourceApp.application_total}`,`Source less application: KES ${sourceApp.difference}`,`Closing trial-balance difference: KES ${sourceApp.trial_balance_difference}`,`Opening trial-balance difference: KES ${sourceApp.opening_trial_balance_difference}`,`Source / application tie-out: KES ${sourceApp.tie_out_difference}`,sourceApp.basis,'Supporting documents:',...(sourceApp.requirements||[]).map((x:any)=>`${x.label}: ${x.status||'Check applicability'}${x.file_name?' | '+x.file_name:''}`),...(sourceApp.issues||[]).map((i:string)=>'SOURCE & APPLICATION REVIEW: '+i)]:[];
   const packLines=[
    `Client: ${client.company_name}`,
    `KRA PIN: ${client.kra_pin||'Not recorded'}`,
    `Project: ${project.project_name}`,
    `Obligation: ${c.kind}`,
    `Suggested KRA return: ${formName}`,
    `Period: ${dateText(c.starts_on)} to ${dateText(c.ends_on)}`,
    `ERP case status: ${c.status}`,
    `Pack status: ${statusText}`,
    'KRA template version: not embedded; confirm and use the official KRA version for this period.',
    'This is a staff preparation pack. It is not an official KRA return, iTax upload file or filing receipt.',
    'Use the Return Lines worksheet to transfer reviewed values to the current KRA return. Resolve all review blockers before filing.',
    'After filing, save the KRA acknowledgment, filing date and PRN/payment reference in the linked task.',
    ...returnLines(c.kind,calculated,profile).map((x:any)=>`${x[0]}: ${x[1]===null||x[1]===''?'Not available':x[1]} | Basis: ${x[2]} | ${x[3]}`),
    ...saLines,
    ...(current.issues||[]).map((i:string)=>'ACTION REQUIRED: '+i)
   ];
   zip.file('00_START_HERE.txt',[
    'PCL Practice Management System — TAX RETURN PREPARATION PACK',
    `Client: ${client.company_name} | ${client.kra_pin||'KRA PIN not recorded'}`,
    `Obligation: ${c.kind} | Period: ${dateText(c.starts_on)} to ${dateText(c.ends_on)}`,
    `Suggested KRA return: ${formName}`,
    'The ERP creates the reviewed preparation schedules. It does not submit this return to KRA.',
    'Open 01_Tax_Return_Preparation.pdf for the concise case summary.',
    'Open 02_Tax_Filing_Workpapers.xlsx and use Return Lines to populate the current official KRA return.',
    'Confirm the KRA form version that applies to this tax period. KRA field locators are deliberately not guessed.',
    'Do not upload this ZIP or the working-paper workbook to iTax unless KRA specifically accepts that file format.',
    'Retain the final KRA acknowledgment, filing date and PRN/payment reference in the linked filing task.',
    'Imported TB, purchase, payroll and other working files are working data, not supporting evidence by themselves.',
    testing?'TEST DATA ONLY — DO NOT FILE.':'',
    c.status==='Locked'?'The ERP review is locked. Any changed amount must go through the authorised correction and review process.':'',
    c.status==='Filed'?'ERP filing status is recorded. Verify that the KRA acknowledgment is attached to the linked task.':''
   ].filter(Boolean).join('\r\n'));
   zip.file('01_Tax_Return_Preparation.pdf',await pdf((testing?'TESTING — NOT FOR FILING | ':'')+c.kind+' return preparation pack',packLines));
   zip.file('02_Tax_Filing_Workpapers.xlsx',xlsx);
   const findings=locked?snapshot.findings:await tx`select summary,status,resolution from erp_private.tax_findings where project_id=${c.project_id} and (case_id=${c.case_id} or case_id is null)`;
   zip.file('03_Findings.pdf',await pdf('Findings',findings.map((f:any)=>`${f.status}: ${f.summary} | ${f.resolution||''}`)));
   if(locked){const docIds=[...new Set([...snapshot.batches.map((b:any)=>b.document_id),c.source_document_id].filter(Boolean))];docs=docIds.length?await tx`select * from erp_private.documents where document_id=any(${tx.array(docIds)}::uuid[])`:[];}
   name=`${testing?'TESTING':locked?'Reviewed':'DRAFT'}_${c.kind}_${id.slice(0,8)}.zip`;bytes=new Uint8Array();
  }
 }else if(p.kind==='ApprovalSummary'){
  if(a.category_code==='INTERN')fail(403,'A staff preparer must generate client approval documents.');
  const task=one(await tx`select * from erp_private.tasks where task_id=${id}`),control=one(await tx`select * from erp_private.task_procedures where task_id=${id}`),project=one(await tx`select * from erp_private.projects where project_id=${task.project_id}`),client=one(await tx`select company_name,kra_pin from erp_private.clients where client_id=${project.client_id}`),firm=one(await tx`select legal_name,kra_pin from erp_private.firms where firm_id=${project.handling_firm_id}`),contact=control.contact_id?(await tx`select full_name,email_address,phone_number from erp_private.client_contacts where contact_id=${control.contact_id} and client_id=${project.client_id} and deleted_at is null`)[0]:null;
  if(!['Awaiting client approval','Ready to file','Ready to deliver','Filed - pending payment','Delivered - pending closure','Closed'].includes(control.stage))fail(400,'Complete internal review before generating a client approval summary.');
  const c=control.case_id?(await tx`select * from erp_private.tax_cases where case_id=${control.case_id} and status in('Locked','Filed')`)[0]:null;
  bytes=await pdf((c?.result?.testing_only?'TESTING - NOT FOR FILING | ':'')+'FOR CLIENT APPROVAL - NOT A FILING RECEIPT',[`Firm: ${firm.legal_name}`,`Firm KRA PIN: ${firm.kra_pin||'Not recorded'}`,`Client: ${client.company_name}`,`Client KRA PIN: ${client.kra_pin||'Not recorded'}`,`Authorised representative: ${contact?.full_name||'Confirm from signed engagement letter'}`,`Representative email: ${contact?.email_address||'Not recorded'}`,`Project: ${project.project_name}`,`Work: ${task.task_name}`,`Work period: ${task.period_start?dateText(task.period_start)+' to '+dateText(task.period_end):'See task scope'}`,`Authority basis: ${control.details.authority_reference||'Confirm from signed engagement letter'}`,`Agreed communication method: ${control.details.protocol||'Confirm from client setup'}`,`Agreed approval cutoff: ${control.details.cutoff_on||'To be confirmed'}`,`Tax / service: ${c?.kind||control.profile}`,...(c?[`Tax period: ${dateText(c.starts_on)} to ${dateText(c.ends_on)}`,...Object.entries(c.result).filter(([,v])=>typeof v==='number'||typeof v==='string').map(([k,v])=>`${k.replaceAll('_',' ')}: ${v}`)]:[]),'Please review the approved draft and provide written authorisation through the agreed secure channel.','This summary does not submit a return, make a payment or replace the final deliverable.']);mime='application/pdf';name=`Client_Approval_${id.slice(0,8)}.pdf`;
 }else if(p.kind==='Procedure'){
  if(a.category_code==='INTERN')fail(403,'A staff preparer must generate client status reports.');
  const task=one(await tx`select * from erp_private.tasks where task_id=${id}`),project=one(await tx`select * from erp_private.projects where project_id=${task.project_id}`),client=(await tx`select company_name from erp_private.clients where client_id=${project.client_id}`)[0],control=one(await tx`select * from erp_private.task_procedures where task_id=${id}`);
  const cases=await tx`select kind,starts_on,ends_on,status,filing_date,result from erp_private.tax_cases where project_id=${project.project_id} and (${task.period_start}::date is null or starts_on<=${task.period_end}::date and ends_on>=${task.period_start}::date) and deleted_at is null order by starts_on,kind`;
  const tasks=await tx`select task_name,status,period_start,period_end,blocked_reason from erp_private.tasks where project_id=${project.project_id} and (${task.period_start}::date is null or period_start<=${task.period_end}::date and period_end>=${task.period_start}::date) and deleted_at is null order by due_at`;
  const lines=[`Client: ${client?.company_name||'Assigned client'}`,`Project: ${project.project_name}`,`Task: ${task.task_name}`,`Work period: ${dateText(task.period_start)} to ${dateText(task.period_end)}`,`Procedure: ${control.profile} | ${control.stage}`,`Payment: ${control.details.payment_outcome||'Not yet verified / not applicable'}`,`PRN: ${control.details.filing?.prn||control.details.filing?.no_prn_reason||'Not recorded'}`,...cases.map((c:any)=>`${c.kind} | ${dateText(c.starts_on)} to ${dateText(c.ends_on)} | ${c.status} | Filed: ${c.filing_date?dateText(c.filing_date):'Not recorded'} | Computation: ${JSON.stringify(c.result)}`),...tasks.filter((t:any)=>!['Completed','Cancelled'].includes(t.status)).map((t:any)=>`OUTSTANDING: ${t.task_name} | ${t.status} | ${t.blocked_reason||''}`)];
  zip.file('01_Status_Report.pdf',await pdf((control.details.filing?.test_only?'TESTING - NOT FOR FILING | ':'')+'Client service status report',lines));zip.file('02_Status_Register.xlsx',await workbook([['Tax periods',['Tax','From','Through','Status','Filed on','Reviewed computation'],cases.map((c:any)=>[c.kind,dateText(c.starts_on),dateText(c.ends_on),c.status,c.filing_date?dateText(c.filing_date):'',c.result])],['Tasks',['Task','Status','From','Through','Outstanding issue'],tasks.map((t:any)=>[t.task_name,t.status,dateText(t.period_start),dateText(t.period_end),t.blocked_reason||''])],['Procedure',['Field','Value'],Object.entries(control.details)]]));
  bytes=new Uint8Array();name=`Client_Status_${id.slice(0,8)}.zip`;
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
