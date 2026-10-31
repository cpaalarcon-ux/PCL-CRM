import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {readSourceSheet} from './source-reader.mjs';

const MODEL_SOURCE_NAME='Model-Audit-File(1).zip';
const MODEL_SOURCE_SHA='4428b990cb486a08c31ab9576da4979885fb05684e8bca52141b9730a9ffa33f';
const MODEL_DEMO_NAME='Model File Ltd — Audit Demonstration';
const MODEL_DEMO_WARNING='DEMONSTRATION DATA — NOT A REAL AUDIT / NOT FOR ISSUANCE';
const AREAS=['Permanent file','Acceptance and ethics','Planning','Risk assessment','Cash and bank','Trade receivables','Inventories','Property, plant and equipment','Trade payables','Borrowings','Taxation','Revenue','Payroll and expenses','Equity','Commitments and contingencies','Completion','Reporting and quality'];
const FS_LINES=['Assets','Liabilities','Equity','Revenue','Cost of sales','Operating expenses','Finance costs','Tax expense','Cash flows','Disclosure only','Not applicable'];
const one=(r:any[])=>{if(!r.length)fail(403,'Audit record or engagement unavailable.');return r[0];};
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Manager or Engagement Partner must complete this audit control.');};
const editor=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'An Audit Supervisor, Manager or Partner must complete this review.');};
const rev=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This audit record changed. Refresh the Audit workspace and try again.');};
const sha=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))).map(x=>x.toString(16).padStart(2,'0')).join('');
function rawCell(sheet:any,row:number,column:number){const value=sheet.getRow(row).getCell(column).value;if(value&&typeof value==='object'&&!(value instanceof Date)&&'result' in value)return value.result;return value;}
function amount(value:any,label:string){
 if(value&&typeof value==='object'&&!(value instanceof Date)&&'result' in value)value=value.result;
 if(value==null||String(value).trim()==='')return '0';
 const raw=String(value).trim().replace(/^(KES|KSh)\s*/i,'').replaceAll(',','');
 if(!/^\d+(?:\.\d{1,12})?$/.test(raw)||raw.split('.')[0].replace(/^0+/,'').length>18)fail(400,`${label} must be a non-negative number with up to 18 whole digits and 12 decimal places.`);
 return raw;
}
function scaled(v:string){const [whole,fraction='']=v.split('.');return BigInt(whole)*1000000000000n+BigInt((fraction+'000000000000').slice(0,12));}
function decimal(v:bigint){const whole=v/1000000000000n,fraction=(v%1000000000000n).toString().padStart(12,'0').replace(/0+$/,'');return fraction?`${whole}.${fraction}`:String(whole);}
function sourceOptions(p:any,sheet:any){
 const h=Math.trunc(Number(p.header_row)),first=Math.trunc(Number(p.first_data_row)),last=Math.trunc(Number(p.last_data_row)||sheet.rowCount),count=sheet.columnCount;
 if(!Number.isInteger(h)||h<1||h>=sheet.rowCount||h>200||!Number.isInteger(first)||first<=h||!Number.isInteger(last)||last<first||last>sheet.rowCount||last-first+1>25000)fail(400,'Choose a valid heading row and data range of at most 25,000 rows.');
 const map:any={};for(const key of ['legacy_account_code','legacy_account_name','debit','credit']){const n=Number(p[key]);if(!Number.isInteger(n)||n<1||n>count)fail(400,'Map account code, account name, debit and credit columns.');map[key]=n;}
 if(new Set(Object.values(map)).size!==4)fail(400,'Choose a different column for account code, account name, debit and credit.');
 return {header:h,first,last,map,headers:Array.from({length:count},(_,i)=>String(rawCell(sheet,h,i+1)??''))};
}
async function source(tx:any,p:any,storage:any){
 const file=one(await tx`select * from erp_private.audit_files where audit_file_id=${uuid(p.audit_file_id)} and file_status<>'Archived' for update`);
 const doc=one(await tx`select * from erp_private.documents where document_id=${uuid(p.source_document_id)} and category='Import Sources' and deleted_at is null and archived_at is null
  and (project_id=${file.project_id} or (project_id is null and client_id=${file.client_id} and handling_firm_id=${file.handling_firm_id} and import_purpose='Opening TB')) for share`);
 if(!/\.(xlsx|csv)$/i.test(doc.file_name)||!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'].includes(doc.mime_type))fail(400,'Choose an XLSX or UTF-8 CSV import source linked to this audit engagement, or its staged opening TB.');
 const fetched=await storage.download(doc.object_key);if(fetched.error||!fetched.data)fail(404,'The private trial-balance source is unavailable.');
 const bytes=new Uint8Array(await fetched.data.arrayBuffer());if(bytes.length>10*1024*1024)fail(400,'Audit trial-balance source files must be 10 MB or smaller.');
 const sourceInfo=await readSourceSheet(bytes,doc.file_name,p.sheet_name?text(p.sheet_name,200):null);
 if(sourceInfo.sheet.rowCount>25001||sourceInfo.sheet.columnCount>80)fail(400,'Use a worksheet with at most 25,000 data rows and 80 columns.');
 return {file,doc,sourceInfo};
}
function parseRows(sheet:any,config:any){
 const rows:any[]=[],codes=new Set<string>();let debit=0n,credit=0n;
 for(let r=config.first;r<=config.last;r++){
  const raw={code:rawCell(sheet,r,config.map.legacy_account_code),name:rawCell(sheet,r,config.map.legacy_account_name),debit:rawCell(sheet,r,config.map.debit),credit:rawCell(sheet,r,config.map.credit)};
  if(Object.values(raw).every(x=>x==null||String(x).trim()===''))continue;
  if(typeof raw.code==='number')fail(400,`Account code on source row ${r} is numeric. Format account codes as text in Excel so leading zeroes are preserved.`);const code=String(raw.code??'').trim(),name=String(raw.name??'').trim();if(!code||!name)fail(400,`Source row ${r} needs both an account code and account name. Preserve leading zeroes by storing account codes as text in Excel.`);
  const dr=amount(raw.debit,`Debit on source row ${r}`),cr=amount(raw.credit,`Credit on source row ${r}`);
  if(scaled(dr)>0n&&scaled(cr)>0n)fail(400,`Source row ${r} has both a debit and credit. Correct the source; the ERP will not net it silently.`);
  if(codes.has(code))fail(400,`Source account code ${code} appears more than once in the selected range. Remove totals or duplicate rows before importing.`);codes.add(code);
  debit+=scaled(dr);credit+=scaled(cr);if(debit>=10n**30n||credit>=10n**30n)fail(400,'A trial-balance total exceeds the supported 18 whole digits and 12 decimal places.');rows.push({source_row:r,legacy_account_code:code,legacy_account_name:name,source_debit:dr,source_credit:cr});
 }
 if(!rows.length)fail(400,'No account rows were found. Check the selected sheet, headings, columns and data range.');
 return {rows,debit:decimal(debit),credit:decimal(credit)};
}

export async function auditAction(tx:any,a:any,p:any,storage:any):Promise<any>{
 if(!String(p.action||'').startsWith('audit_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Intern accounts cannot access audit workpapers.');

 if(p.action==='audit_workspace'){
  const projects=await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,p.service_code,p.status,c.company_name,c.year_end_month,c.year_end_day,f.firm_code,af.audit_file_id,af.file_status as audit_file_status,af.ends_on as audit_file_ends_on,af.file_type as audit_file_type
   from erp_private.projects p join erp_private.clients c using(client_id) join erp_private.firms f on f.firm_id=p.handling_firm_id left join erp_private.audit_files af using(project_id)
   where p.service_code like 'AUD-%' and p.deleted_at is null and c.deleted_at is null and erp_private.project_allowed(p.project_id)
   order by c.company_name,p.project_name limit 300`;
  if(!p.project_id)return {projects};
  const project=one(await tx`select p.project_id,p.client_id,p.handling_firm_id,p.project_name,p.service_code,p.status,c.company_name,c.year_end_month,c.year_end_day,f.firm_code
   from erp_private.projects p join erp_private.clients c using(client_id) join erp_private.firms f on f.firm_id=p.handling_firm_id
   where p.project_id=${uuid(p.project_id)} and p.service_code like 'AUD-%' and erp_private.project_allowed(p.project_id)`);
  const file=(await tx`select * from erp_private.audit_files where project_id=${project.project_id}`)[0]||null;
  if(!file)return {projects,project,file:null,imports:[],tb_lines:[],workpapers:[],completion:[],readiness:{file_ready:false}};
  const imports=await tx`select * from erp_private.audit_tb_imports where audit_file_id=${file.audit_file_id} order by created_at desc`;
  const active=imports.filter((x:any)=>x.status!=='Superseded'),activeIds=active.map((x:any)=>x.audit_tb_import_id),activeImport=active[0]||null;
  const tb_lines=activeImport?await tx`select l.audit_tb_line_id,l.audit_tb_import_id,l.source_row,l.legacy_account_code,l.legacy_account_name,l.source_debit,l.source_credit,l.audit_account_id,l.audit_area,l.financial_statement_line,l.mapping_confidence,i.status as import_status,i.period_kind,i.revision as import_revision
   from erp_private.audit_tb_lines l join erp_private.audit_tb_imports i using(audit_tb_import_id) where l.audit_tb_import_id=${activeImport.audit_tb_import_id} order by l.source_row limit 100`:[];
  const tb_summaries=active.length?await tx`select l.audit_tb_import_id,count(*)::int total,count(*) filter(where l.audit_account_id is null)::int unmapped,coalesce(sum(l.source_debit),0) total_debit,coalesce(sum(l.source_credit),0) total_credit
   from erp_private.audit_tb_lines l where l.audit_tb_import_id=any(${tx.array(activeIds)}::uuid[]) group by l.audit_tb_import_id`:[];
  const workpapers=await tx`select * from erp_private.audit_workpapers where audit_file_id=${file.audit_file_id} order by audit_area,workpaper_ref limit 500`;
  const workpaper_versions=await tx`select v.audit_workpaper_id,v.version_number,v.action,v.snapshot,v.actor_id,v.created_at from erp_private.audit_workpaper_versions v where v.audit_file_id=${file.audit_file_id} order by v.audit_workpaper_id,v.version_number`;
  const completion=await tx`select * from erp_private.audit_completion_items where audit_file_id=${file.audit_file_id} order by item_key`;
  const checklist=await tx`select count(*)::int total,count(*) filter(where status='Reviewed')::int reviewed from erp_private.audit_completion_items where audit_file_id=${file.audit_file_id}`;
  const currentSummary=(await tx`select i.audit_tb_import_id,i.status,i.difference,i.difference=0 as balanced,count(l.audit_tb_line_id)::int total,count(l.audit_tb_line_id) filter(where l.audit_account_id is null)::int unmapped from erp_private.audit_tb_imports i left join erp_private.audit_tb_lines l using(audit_tb_import_id) where i.audit_file_id=${file.audit_file_id} and i.period_kind='Current' and i.status='Confirmed' group by i.audit_tb_import_id limit 1`)[0]||null;
  const templates=await tx`select * from erp_private.audit_templates where handling_firm_id=${file.handling_firm_id} order by audit_area,title,template_version desc`;
  return {projects,project,file,imports,tb_lines,tb_summaries,active_import_id:activeImport?.audit_tb_import_id||null,workpapers,workpaper_versions,completion,templates,readiness:{framework_approved:file.framework_status==='Approved',current_tb_balanced:!!currentSummary&&currentSummary.balanced,current_tb_confirmed:!!currentSummary,all_lines_mapped:!!currentSummary&&Number(currentSummary.total)>0&&Number(currentSummary.unmapped)===0,workpapers_present:workpapers.length>0,workpapers_resolved:workpapers.length>0&&workpapers.every((x:any)=>x.status==='Approved'),completion_total:checklist[0]?.total||0,completion_reviewed:checklist[0]?.reviewed||0}};
 }

 if(p.action==='audit_tb_lines'){
  const importId=uuid(p.audit_tb_import_id),offset=Math.max(0,Math.min(25000,Math.trunc(Number(p.offset)||0))),imp=one(await tx`select audit_tb_import_id from erp_private.audit_tb_imports where audit_tb_import_id=${importId}`);
  const summary=one(await tx`select count(*)::int total,count(*) filter(where audit_account_id is null)::int unmapped from erp_private.audit_tb_lines where audit_tb_import_id=${imp.audit_tb_import_id}`);
  const rows=await tx`select l.audit_tb_line_id,l.audit_tb_import_id,l.source_row,l.legacy_account_code,l.legacy_account_name,l.source_debit,l.source_credit,l.audit_account_id,l.audit_area,l.financial_statement_line,l.mapping_confidence,i.status as import_status,i.period_kind,i.revision as import_revision
   from erp_private.audit_tb_lines l join erp_private.audit_tb_imports i using(audit_tb_import_id) where l.audit_tb_import_id=${importId} order by l.source_row limit 100 offset ${offset}`;
  return {rows,total:summary.total,unmapped:summary.unmapped,offset,page_size:100};
 }

 if(p.action==='audit_file_save'){
  leader(a);const pid=uuid(p.project_id),project=one(await tx`select p.project_id,p.client_id,p.handling_firm_id,p.service_code,p.status,c.company_name,c.year_end_month,c.year_end_day,f.firm_code
   from erp_private.projects p join erp_private.clients c using(client_id) join erp_private.firms f on f.firm_id=p.handling_firm_id
   where p.project_id=${pid} and erp_private.project_allowed(p.project_id) for update of p`);
  if(!project.service_code.startsWith('AUD-'))fail(400,'Choose an audit engagement project.');
  const starts=date(p.starts_on),ends=date(p.ends_on);if(!starts||!ends||ends<starts)fail(400,'Enter the audit period start and end dates.');
  if(!project.year_end_month||!project.year_end_day)fail(400,'Complete the client financial year-end in Client settings before setting up an audit file.');
  const endYear=Number(ends.slice(0,4)),month=Number(project.year_end_month),clientDay=Number(project.year_end_day),endDay=Math.min(clientDay,new Date(Date.UTC(endYear,month,0)).getUTCDate());
  if(Number(ends.slice(5,7))!==month||Number(ends.slice(8,10))!==endDay)fail(400,'The audit year-end must match the financial year-end saved in the client profile.');
  const priorDay=Math.min(clientDay,new Date(Date.UTC(endYear-1,month,0)).getUTCDate()),priorYearEnd=new Date(Date.UTC(endYear-1,month-1,priorDay)),expectedStart=new Date(priorYearEnd.getTime()+86400000).toISOString().slice(0,10);if(starts!==expectedStart)fail(400,`Set the period start to ${expectedStart}, the day after the prior client year-end.`);
  const duration=(Date.parse(ends+'T00:00:00Z')-Date.parse(starts+'T00:00:00Z'))/86400000;if(duration<300||duration>400)fail(400,'Check the audit period: a financial reporting period should normally cover about one year.');
  const kind=choice(p.file_type,['First-year','Subsequent-year','Historical demonstration']),framework=text(p.reporting_framework,240),previous=p.previous_audit_file_id?uuid(p.previous_audit_file_id):null,isDemo=kind==='Historical demonstration';
  if(kind==='Subsequent-year'&&!previous)fail(400,'Choose the previous audit file to roll forward from.');
  if(kind!=='Subsequent-year'&&previous)fail(400,'Only a subsequent-year audit file can reference a prior file.');
  if(previous){const prior=one(await tx`select * from erp_private.audit_files where audit_file_id=${previous} and client_id=${project.client_id} and handling_firm_id=${project.handling_firm_id} and ends_on=${(new Date(Date.parse(starts+'T00:00:00Z')-86400000)).toISOString().slice(0,10)} and file_status in ('Approved','Completion','Archived')`);if(!prior)fail(400,'Choose the immediately preceding completed audit period for this client and handling firm.');}
  if(isDemo&&(project.company_name!==MODEL_DEMO_NAME||project.firm_code!=='PCL PMS Testing Firm'||ends!=='2006-12-31'))fail(400,'The historical demonstration is restricted to Model File Ltd — Audit Demonstration, the PCL PMS Testing Firm and the year ended 31 December 2006.');
  const existing=(await tx`select * from erp_private.audit_files where project_id=${pid} for update`)[0];
  let saved:any;
  if(existing){if(!['Draft','Returned'].includes(existing.file_status))fail(400,'This audit file has started review. Return it to the preparer before changing its setup.');const used=one(await tx`select (exists(select 1 from erp_private.audit_tb_imports where audit_file_id=${existing.audit_file_id}) or exists(select 1 from erp_private.audit_workpapers where audit_file_id=${existing.audit_file_id}) or exists(select 1 from erp_private.audit_completion_items where audit_file_id=${existing.audit_file_id} and status<>'Not started'))::boolean used`);if(used.used)fail(400,'This audit file already has recorded TB, workpaper or planning history. Keep its setup and correct individual items through their review controls.');rev(existing,p);saved=one(await tx`update erp_private.audit_files set starts_on=${starts},ends_on=${ends},file_type=${kind},reporting_framework=${framework},previous_audit_file_id=${previous},framework_status='Pending review',framework_approved_by=null,framework_approved_at=null,is_demonstration=${isDemo},demonstration_warning=${isDemo?MODEL_DEMO_WARNING:''},source_archive_name=${isDemo?MODEL_SOURCE_NAME:null},source_archive_sha256=${isDemo?MODEL_SOURCE_SHA:null},source_archive_read_only=${isDemo},file_status='Draft' where audit_file_id=${existing.audit_file_id} returning *`);}
  else saved=one(await tx`insert into erp_private.audit_files(project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,previous_audit_file_id,is_demonstration,demonstration_warning,source_archive_name,source_archive_sha256,source_archive_read_only,created_by)
   values(${pid},${project.client_id},${project.handling_firm_id},${starts},${ends},${kind},${framework},${previous},${isDemo},${isDemo?MODEL_DEMO_WARNING:''},${isDemo?MODEL_SOURCE_NAME:null},${isDemo?MODEL_SOURCE_SHA:null},${isDemo},${a.staff_id}) returning *`);
  const planning=[['acceptance','Acceptance, independence and continuance'],['engagement-terms','Engagement terms and responsibilities'],['strategy','Overall audit strategy and plan'],['materiality','Materiality and performance materiality'],['entity','Understanding the entity and environment'],['risk','Risk assessment, fraud and responses'],['controls','Internal controls relevant to the audit'],['team','Team, timing and budget'],['prior','Prior-year matters and carry-forward points']];
  const completionItems=[['final-analytics','Final analytical review'],['going-concern','Going concern assessment'],['subsequent-events','Subsequent events review'],['representation','Management representation letter'],['unadjusted','Unadjusted misstatements and disposition'],['discussions','Management and governance discussions'],['overall-conclusion','Overall audit conclusion']];
  await tx`insert into erp_private.audit_completion_items(audit_file_id,project_id,handling_firm_id,item_key,label)
   select ${saved.audit_file_id},${pid},${project.handling_firm_id},x.key,x.label from jsonb_to_recordset(${tx.json([...planning,...completionItems].map(([key,label])=>({key,label})))}::jsonb) x(key text,label text) on conflict(audit_file_id,item_key) do nothing`;
  return {ok:true,audit_file_id:saved.audit_file_id};
 }

 if(p.action==='audit_framework_approve'){
  if(a.category_code!=='PARTNER')fail(403,'Only the Engagement Partner can approve the reporting framework.');const f=one(await tx`select * from erp_private.audit_files where audit_file_id=${uuid(p.audit_file_id)} and file_status in ('Draft','Returned') for update`);rev(f,p);
  await tx`update erp_private.audit_files set framework_status='Approved',framework_approved_by=${a.staff_id},framework_approved_at=now() where audit_file_id=${f.audit_file_id}`;return {ok:true};
 }

 if(p.action==='audit_template_save'){
  leader(a);const project=one(await tx`select project_id,handling_firm_id from erp_private.projects where project_id=${uuid(p.project_id)} and service_code like 'AUD-%' and erp_private.project_allowed(project_id)`),firm=project.handling_firm_id;
  const fields={template_key:text(p.template_key,80),title:text(p.title,200),source_reference:text(p.source_reference,500),source_filename:text(p.source_filename||'',200,false),source_version:text(p.source_version||'',80,false),audit_area:choice(p.audit_area,AREAS),standards_reference:text(p.standards_reference,160),effective_from:date(p.effective_from),reporting_framework:text(p.reporting_framework,240),applicable_engagements:text(p.applicable_engagements,500),trigger_condition:text(p.trigger_condition,1000),required_evidence:text(p.required_evidence,1500),review_level:choice(p.review_level,['Supervisor','Manager','Partner','EQR if required']),template_text:text(p.template_text,8000)};
  if(!fields.effective_from)fail(400,'Choose the date this template becomes applicable.');
  if(p.audit_template_id){const old=one(await tx`select * from erp_private.audit_templates where audit_template_id=${uuid(p.audit_template_id)} and handling_firm_id=${firm} for update`);rev(old,p);if(old.status!=='Draft')fail(400,'Approved or retired templates are locked; create a new version.');
   await tx`update erp_private.audit_templates set template_key=${fields.template_key},title=${fields.title},source_reference=${fields.source_reference},source_filename=${fields.source_filename},source_version=${fields.source_version},audit_area=${fields.audit_area},standards_reference=${fields.standards_reference},effective_from=${fields.effective_from},reporting_framework=${fields.reporting_framework},applicable_engagements=${fields.applicable_engagements},trigger_condition=${fields.trigger_condition},required_evidence=${fields.required_evidence},review_level=${fields.review_level},template_text=${fields.template_text},status='Draft',rights_cleared=false,approved_by=null,approved_at=null where audit_template_id=${old.audit_template_id}`;return {ok:true};
  }
  const version=Math.max(1,Math.trunc(Number(p.template_version)||1));await tx`insert into erp_private.audit_templates(handling_firm_id,template_key,template_version,title,source_reference,source_filename,source_version,audit_area,standards_reference,effective_from,reporting_framework,applicable_engagements,trigger_condition,required_evidence,review_level,template_text,owner_id)
   values(${firm},${fields.template_key},${version},${fields.title},${fields.source_reference},${fields.source_filename},${fields.source_version},${fields.audit_area},${fields.standards_reference},${fields.effective_from},${fields.reporting_framework},${fields.applicable_engagements},${fields.trigger_condition},${fields.required_evidence},${fields.review_level},${fields.template_text},${a.staff_id})`;return {ok:true};
 }

 if(p.action==='audit_template_approve'){
  if(a.category_code!=='PARTNER')fail(403,'Only an Engagement Partner can approve a firm audit template.');const t=one(await tx`select * from erp_private.audit_templates where audit_template_id=${uuid(p.audit_template_id)} for update`);rev(t,p);if(t.status!=='Draft')fail(400,'Only a draft template can be approved.');if(p.rights_cleared!==true)fail(400,'Confirm that this text is newly authored or that reproduction/adaptation rights are cleared.');
  await tx`update erp_private.audit_templates set status='Approved',rights_cleared=true,approved_by=${a.staff_id},approved_at=now() where audit_template_id=${t.audit_template_id}`;return {ok:true};
 }

 if(p.action==='audit_tb_source_preview'){
  const {sourceInfo}=await source(tx,p,storage),sheet=sourceInfo.sheet,header=Math.trunc(Number(p.header_row));if(!Number.isInteger(header)||header<1||header>200||header>=sheet.rowCount)fail(400,'Choose a valid heading row.');
  return {sheet_name:sheet.name,row_count:sheet.rowCount,sheets:sourceInfo.sheets,headers:Array.from({length:sheet.columnCount},(_,i)=>String(rawCell(sheet,header,i+1)??'')),preview:Array.from({length:Math.min(5,sheet.rowCount-header)},(_,i)=>({row:header+i+1,values:Array.from({length:sheet.columnCount},(_,c)=>rawCell(sheet,header+i+1,c+1))}))};
 }

 if(p.action==='audit_tb_preview'||p.action==='audit_tb_import'){
  if(p.action==='audit_tb_import'&&a.category_code==='INTERN')fail(403,'A staff preparer must import the audit trial balance.');
  if(p.action==='audit_tb_import'&&p.confirmed!==true)fail(400,'Confirm the selected worksheet, period, columns, row range and source totals before importing.');
  const {file,doc,sourceInfo}=await source(tx,p,storage),sheet=sourceInfo.sheet;
  if(p.action==='audit_tb_preview'){
   const c=sourceOptions(p,sheet),preview=[];for(let r=c.first;r<=Math.min(c.last,c.first+9);r++){preview.push({source_row:r,values:Object.fromEntries(Object.entries(c.map).map(([k,col]:any)=>[k,rawCell(sheet,r,col)]))});}
   const parsed=parseRows(sheet,c);return {sheet_name:sheet.name,sheets:sourceInfo.sheets,headers:c.headers,preview,source_rows:parsed.rows.length,total_debit:parsed.debit,total_credit:parsed.credit,difference:decimal(scaled(parsed.debit)-scaled(parsed.credit)),balanced:parsed.debit===parsed.credit};
  }
  if(file.framework_status!=='Approved')fail(400,'Ask the Engagement Partner to confirm the financial reporting framework before importing the audit trial balance.');
  if(p.action==='audit_tb_import'&&!['Draft','Returned'].includes(file.file_status))fail(400,'Trial-balance imports are locked after the file is prepared for review.');
  const c=sourceOptions(p,sheet),parsed=parseRows(sheet,c),period=choice(p.period_kind,['Current','Comparative']);
  if(doc.import_purpose==='Opening TB'&&period!=='Comparative')fail(400,'A client-staged opening TB is comparative/prior-year data.');
  const previousEnd=period==='Comparative'?(file.previous_audit_file_id?(await tx`select ends_on from erp_private.audit_files where audit_file_id=${file.previous_audit_file_id}`)[0]?.ends_on:new Date(Date.parse(file.starts_on+'T00:00:00Z')-86400000).toISOString().slice(0,10)):file.ends_on,periodEnd=previousEnd;
  const signature=await sha(JSON.stringify({doc:doc.sha256,file:file.audit_file_id,sheet:sheet.name,period,periodEnd,c}));
  const duplicate=(await tx`select audit_tb_import_id from erp_private.audit_tb_imports where audit_file_id=${file.audit_file_id} and import_signature=${signature} and period_kind=${period} and status in ('Draft','Confirmed') order by created_at desc limit 1`)[0];if(duplicate)return {ok:true,audit_tb_import_id:duplicate.audit_tb_import_id,reused:true,row_count:0};
  const active=(await tx`select audit_tb_import_id,status from erp_private.audit_tb_imports where audit_file_id=${file.audit_file_id} and period_kind=${period} and status in ('Draft','Confirmed') for update`)[0];
  if(active)fail(409,'This period already has an active TB import. A Partner or Manager must supersede the old import with a reason before replacing it.');
  const maps=await tx`select audit_account_id,legacy_account_code,audit_area,financial_statement_line,mapping_confidence from erp_private.audit_account_mappings where handling_firm_id=${file.handling_firm_id} and active`;
  const byCode=new Map(maps.map((x:any)=>[x.legacy_account_code,x]));
  const importId=crypto.randomUUID();
  await tx`insert into erp_private.audit_tb_imports(audit_tb_import_id,audit_file_id,project_id,handling_firm_id,source_document_id,source_sha256,import_signature,sheet_name,period_ends_on,header_row,first_data_row,last_data_row,column_mapping,period_kind,source_row_count,total_debit,total_credit,imported_by)
   values(${importId},${file.audit_file_id},${file.project_id},${file.handling_firm_id},${doc.document_id},${doc.sha256},${signature},${sheet.name},${periodEnd},${c.header},${c.first},${c.last},${tx.json(c.map)},${period},${parsed.rows.length},${parsed.debit},${parsed.credit},${a.staff_id})`;
  const values=parsed.rows.map((r:any)=>{const m:any=byCode.get(r.legacy_account_code);return {...r,audit_account_id:m?.audit_account_id||null,audit_area:m?.audit_area||null,financial_statement_line:m?.financial_statement_line||null,mapping_confidence:m?.mapping_confidence||null};});
  for(let i=0;i<values.length;i+=500)await tx`insert into erp_private.audit_tb_lines(audit_tb_import_id,audit_file_id,project_id,handling_firm_id,source_row,legacy_account_code,legacy_account_name,source_debit,source_credit,audit_account_id,audit_area,financial_statement_line,mapping_confidence)
   select ${importId},${file.audit_file_id},${file.project_id},${file.handling_firm_id},x.source_row,x.legacy_account_code,x.legacy_account_name,x.source_debit,x.source_credit,x.audit_account_id,x.audit_area,x.financial_statement_line,x.mapping_confidence
   from jsonb_to_recordset(${tx.json(values.slice(i,i+500))}::jsonb) x(source_row integer,legacy_account_code text,legacy_account_name text,source_debit numeric,source_credit numeric,audit_account_id uuid,audit_area text,financial_statement_line text,mapping_confidence text)`;
  await tx`update erp_private.audit_tb_imports set superseded_by=${importId} where audit_tb_import_id=(select audit_tb_import_id from erp_private.audit_tb_imports where audit_file_id=${file.audit_file_id} and period_kind=${period} and status='Superseded' and superseded_by is null order by created_at desc limit 1)`;
  await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${doc.document_id},${a.auth_user_id},'AUDIT_TB_IMPORT')`;
  return {ok:true,audit_tb_import_id:importId,row_count:values.length,total_debit:parsed.debit,total_credit:parsed.credit,unmapped_count:values.filter((x:any)=>!x.audit_account_id).length,import_kind:period};
 }

 if(p.action==='audit_tb_map'){
  const line=one(await tx`select l.*,i.status as import_status,i.revision as import_revision,i.handling_firm_id as firm,f.file_status as file_status from erp_private.audit_tb_lines l join erp_private.audit_tb_imports i using(audit_tb_import_id) join erp_private.audit_files f using(audit_file_id) where l.audit_tb_line_id=${uuid(p.audit_tb_line_id)} for update of i,l,f`);
  if(line.import_status!=='Draft')fail(400,'Confirmed source rows are locked. Ask a Partner or Manager to supersede this import before correction.');if(!['Draft','Returned'].includes(line.file_status))fail(400,'Trial-balance mappings are locked after the audit file is prepared.');rev({revision:line.import_revision},p);
  const area=choice(p.audit_area,AREAS),fs=choice(p.financial_statement_line,FS_LINES),code=line.legacy_account_code,name=line.legacy_account_name,reason=text(p.change_reason||'',1000,false);
  const existing=(await tx`select * from erp_private.audit_account_mappings where handling_firm_id=${line.firm} and legacy_account_code=${code} for update`)[0];let mapped:any;
  if(existing){const changed=existing.legacy_account_name!==name||existing.audit_area!==area||existing.financial_statement_line!==fs||!existing.active;if(changed){leader(a);if(reason.length<10)fail(400,'This account mapping is already shared by the handling firm. A Manager or Partner must record a reason of at least 10 characters before changing it.');mapped=one(await tx`update erp_private.audit_account_mappings set legacy_account_name=${name},audit_area=${area},financial_statement_line=${fs},mapping_confidence='Confirmed',change_reason=${reason},confirmed_by=${a.staff_id},reviewer_id=null,reviewed_at=null,active=true where audit_account_id=${existing.audit_account_id} returning audit_account_id,mapping_confidence`);}else mapped=existing;
  }else mapped=one(await tx`insert into erp_private.audit_account_mappings(handling_firm_id,legacy_account_code,legacy_account_name,audit_area,financial_statement_line,mapping_confidence,confirmed_by)
   values(${line.firm},${code},${name},${area},${fs},'Confirmed',${a.staff_id}) returning audit_account_id,mapping_confidence`);
  await tx`update erp_private.audit_tb_lines set audit_account_id=${mapped.audit_account_id},audit_area=${area},financial_statement_line=${fs},mapping_confidence=${mapped.mapping_confidence} where audit_tb_line_id=${line.audit_tb_line_id}`;return {ok:true};
 }

 if(p.action==='audit_tb_confirm'){
  leader(a);const imp=one(await tx`select i.*,f.framework_status,f.file_status from erp_private.audit_tb_imports i join erp_private.audit_files f using(audit_file_id) where i.audit_tb_import_id=${uuid(p.audit_tb_import_id)} for update of i,f`);rev(imp,p);
  if(imp.status!=='Draft')fail(400,'Only a draft TB import can be confirmed.');if(!['Draft','Returned'].includes(imp.file_status))fail(400,'Trial-balance confirmation is locked after the file is prepared for review.');if(imp.framework_status!=='Approved')fail(400,'The reporting framework must be approved before trial-balance confirmation.');
  const lines=one(await tx`select count(*)::int total,count(*) filter(where audit_account_id is null)::int unmapped from erp_private.audit_tb_lines where audit_tb_import_id=${imp.audit_tb_import_id}`);
  if(lines.total!==imp.source_row_count)fail(409,'Imported line count changed. Review the source again.');if(lines.unmapped)fail(400,`${lines.unmapped} account(s) still need an audit area and financial-statement line.`);const diff=one(await tx`select ${imp.difference}::numeric=0 as balanced`);if(!diff.balanced)fail(400,`The trial balance is out by KES ${String(imp.difference)}. Correct the source; the ERP will not insert a balancing amount.`);
  if(imp.period_kind==='Current'&&(await tx`select audit_tb_import_id from erp_private.audit_tb_imports where audit_file_id=${imp.audit_file_id} and period_kind='Current' and status='Confirmed'`).length)fail(409,'A confirmed current-year TB already exists. Supersede it first.');
  const selfMapped=one(await tx`select count(*)::int count from erp_private.audit_account_mappings m where m.handling_firm_id=${imp.handling_firm_id} and m.mapping_confidence='Confirmed' and m.confirmed_by=${a.staff_id} and exists(select 1 from erp_private.audit_tb_lines l where l.audit_tb_import_id=${imp.audit_tb_import_id} and l.audit_account_id=m.audit_account_id)`);if(selfMapped.count)fail(403,'A staff member cannot approve account mappings they prepared. Ask another Manager or Partner to confirm this TB.');
  await tx`update erp_private.audit_account_mappings m set mapping_confidence='Reviewer-approved',reviewer_id=${a.staff_id},reviewed_at=now() where m.handling_firm_id=${imp.handling_firm_id} and m.mapping_confidence='Confirmed' and m.confirmed_by<>${a.staff_id} and exists(select 1 from erp_private.audit_tb_lines l where l.audit_tb_import_id=${imp.audit_tb_import_id} and l.audit_account_id=m.audit_account_id)`;
  await tx`update erp_private.audit_tb_lines l set mapping_confidence='Reviewer-approved' where l.audit_tb_import_id=${imp.audit_tb_import_id} and l.audit_account_id in(select m.audit_account_id from erp_private.audit_account_mappings m where m.handling_firm_id=${imp.handling_firm_id} and m.reviewer_id=${a.staff_id} and m.reviewed_at is not null)`;
  await tx`update erp_private.audit_tb_imports set status='Confirmed',confirmed_by=${a.staff_id},confirmed_at=now() where audit_tb_import_id=${imp.audit_tb_import_id}`;
  return {ok:true};
 }

 if(p.action==='audit_tb_supersede'){
  leader(a);const old=one(await tx`select i.* from erp_private.audit_tb_imports i join erp_private.audit_files f using(audit_file_id) where i.audit_tb_import_id=${uuid(p.audit_tb_import_id)} and i.status in ('Draft','Confirmed') and f.file_status in ('Draft','Returned') for update of i`);const reason=text(p.reason,1000);if(reason.length<10)fail(400,'Record why the source import is being replaced.');
  await tx`update erp_private.audit_tb_imports set status='Superseded',superseded_reason=${reason} where audit_tb_import_id=${old.audit_tb_import_id}`;
  return {ok:true,superseded_import_id:old.audit_tb_import_id,period_kind:old.period_kind};
 }

 if(p.action==='audit_workpaper_save'){
  const fid=uuid(p.audit_file_id),file=one(await tx`select * from erp_private.audit_files where audit_file_id=${fid} and file_status in ('Draft','Prepared','Returned')`);const area=choice(p.audit_area,AREAS),responsible=uuid(p.responsible_staff_id),evidence=p.evidence_document_id?uuid(p.evidence_document_id):null;
  if(responsible!==a.staff_id)fail(400,'For this release, save a workpaper under the signed-in preparer. Reassign through the project team first.');
  const assignment=await tx`select project_id from erp_private.project_assignments where project_id=${file.project_id} and staff_id=${a.staff_id} and deleted_at is null union select project_id from erp_private.projects where project_id=${file.project_id} and owner_staff_id=${a.staff_id}`;if(!assignment.length)fail(403,'You must be assigned to this audit engagement to prepare workpapers.');
  if(evidence)one(await tx`select document_id from erp_private.documents where document_id=${evidence} and project_id=${file.project_id} and category='Working Papers' and deleted_at is null and archived_at is null`);
  const values={workpaper_ref:text(p.workpaper_ref,40),audit_area:area,objective:text(p.objective,2000),assertion:text(p.assertion,300),linked_risk:text(p.linked_risk,2000),standard_reference:text(p.standard_reference,160),planned_procedure:text(p.planned_procedure,3000),responsible_staff_id:responsible,sample_population:text(p.sample_population||'',2000,false),selection_method:text(p.selection_method||'',500,false),work_performed:text(p.work_performed||'',4000,false),result:text(p.result||'',2000,false),evidence_reference:text(p.evidence_reference||'',1000,false),evidence_document_id:evidence,deviations:text(p.deviations||'',2000,false),professional_judgment:text(p.professional_judgment||'',2000,false),conclusion:text(p.conclusion||'',2000,false)};
  if(p.audit_workpaper_id){const old=one(await tx`select * from erp_private.audit_workpapers where audit_workpaper_id=${uuid(p.audit_workpaper_id)} for update`);rev(old,p);if(old.prepared_by!==a.staff_id||!['Draft','Returned'].includes(old.status))fail(403,'Only the preparer can change a draft or returned workpaper.');
   await tx`update erp_private.audit_workpapers set workpaper_ref=${values.workpaper_ref},audit_area=${values.audit_area},objective=${values.objective},assertion=${values.assertion},linked_risk=${values.linked_risk},standard_reference=${values.standard_reference},planned_procedure=${values.planned_procedure},responsible_staff_id=${values.responsible_staff_id},sample_population=${values.sample_population},selection_method=${values.selection_method},work_performed=${values.work_performed},result=${values.result},evidence_reference=${values.evidence_reference},evidence_document_id=${values.evidence_document_id},deviations=${values.deviations},professional_judgment=${values.professional_judgment},conclusion=${values.conclusion},status='Draft',reviewer_id=null,reviewed_at=null,review_note='' where audit_workpaper_id=${old.audit_workpaper_id}`;
   return {ok:true,audit_workpaper_id:old.audit_workpaper_id};
  }
  const row=one(await tx`insert into erp_private.audit_workpapers(audit_file_id,project_id,handling_firm_id,workpaper_ref,audit_area,objective,assertion,linked_risk,standard_reference,planned_procedure,responsible_staff_id,sample_population,selection_method,work_performed,result,evidence_reference,evidence_document_id,deviations,professional_judgment,conclusion,prepared_by)
   values(${fid},${file.project_id},${file.handling_firm_id},${values.workpaper_ref},${area},${values.objective},${values.assertion},${values.linked_risk},${values.standard_reference},${values.planned_procedure},${responsible},${values.sample_population},${values.selection_method},${values.work_performed},${values.result},${values.evidence_reference},${evidence},${values.deviations},${values.professional_judgment},${values.conclusion},${a.staff_id}) returning audit_workpaper_id`);return {ok:true,audit_workpaper_id:row.audit_workpaper_id};
 }

 if(p.action==='audit_workpaper_submit'){
  const w=one(await tx`select w.* from erp_private.audit_workpapers w join erp_private.audit_files f using(audit_file_id) where w.audit_workpaper_id=${uuid(p.audit_workpaper_id)} and f.file_status in ('Draft','Prepared','Returned') for update of w`);rev(w,p);
  if(w.prepared_by!==a.staff_id||!['Draft','Returned'].includes(w.status))fail(403,'Only the preparer can submit this draft or returned workpaper.');
  if(!w.work_performed||!w.result||!w.conclusion||(!w.evidence_reference&&!w.evidence_document_id))fail(400,'Complete the work performed, result, evidence and conclusion before submitting.');
  if(!w.sample_population||!w.selection_method)fail(400,'Record the population and selection method, or explain why sampling does not apply.');
  const snapshot={...w,status:'Submitted',prepared_by:a.staff_id,submitted_at:new Date().toISOString(),submitted_revision:Number(w.revision)+1};
  await tx`update erp_private.audit_workpapers set status='Submitted',submitted_at=now(),reviewer_id=null,reviewed_at=null,review_note='' where audit_workpaper_id=${w.audit_workpaper_id}`;
  await tx`insert into erp_private.audit_workpaper_versions(audit_workpaper_id,audit_file_id,project_id,handling_firm_id,version_number,action,snapshot,actor_id)
   values(${w.audit_workpaper_id},${w.audit_file_id},${w.project_id},${w.handling_firm_id},coalesce((select max(version_number)+1 from erp_private.audit_workpaper_versions where audit_workpaper_id=${w.audit_workpaper_id}),1),'Submitted',${tx.json(snapshot)},${a.staff_id})`;
  return {ok:true};
 }

 if(p.action==='audit_workpaper_review'){
  editor(a);const w=one(await tx`select w.*,f.file_status as audit_file_status from erp_private.audit_workpapers w join erp_private.audit_files f using(audit_file_id) where w.audit_workpaper_id=${uuid(p.audit_workpaper_id)} for update of w`);rev(w,p);if(w.status!=='Submitted')fail(400,'Only submitted work can be reviewed.');if(w.audit_file_status!=='In Review')fail(400,'Workpaper review is available after the audit file is sent for independent review.');if(w.prepared_by===a.staff_id)fail(403,'A preparer cannot review their own workpaper.');
  const decision=choice(p.decision,['Returned','Approved']);if(decision==='Approved'&&!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Engagement Partner can approve an audit workpaper.');
  const note=text(p.review_note,3000);const snapshot={...w,status:decision,review_note:note,reviewer_id:a.staff_id,reviewed_at:new Date().toISOString()};
  await tx`update erp_private.audit_workpapers set status=${decision},reviewer_id=${a.staff_id},reviewed_at=now(),review_note=${note} where audit_workpaper_id=${w.audit_workpaper_id}`;
  await tx`insert into erp_private.audit_workpaper_versions(audit_workpaper_id,audit_file_id,project_id,handling_firm_id,version_number,action,snapshot,actor_id)
   values(${w.audit_workpaper_id},${w.audit_file_id},${w.project_id},${w.handling_firm_id},coalesce((select max(version_number)+1 from erp_private.audit_workpaper_versions where audit_workpaper_id=${w.audit_workpaper_id}),1),${decision},${tx.json(snapshot)},${a.staff_id})`;return {ok:true};
 }

 if(p.action==='audit_completion_save'||p.action==='audit_completion_review'){
  const item=one(await tx`select i.*,f.file_status as audit_file_status from erp_private.audit_completion_items i join erp_private.audit_files f using(audit_file_id) where i.audit_completion_item_id=${uuid(p.audit_completion_item_id)} for update of i`),planning=['acceptance','engagement-terms','strategy','materiality','entity','risk','controls','team','prior'].includes(item.item_key);
  if(p.action==='audit_completion_review'){
   leader(a);rev(item,p);if((planning&&!['Draft','Returned'].includes(item.audit_file_status))||(!planning&&item.audit_file_status!=='Approved'))fail(400,planning?'Planning controls are locked after preparation.':'Closing controls are available after the audit file is approved.');if(item.status!=='Prepared')fail(400,'Only prepared completion items can be reviewed.');if(item.prepared_by===a.staff_id)fail(403,'The preparer cannot review their own completion work.');const note=text(p.note||item.note,3000);await tx`update erp_private.audit_completion_items set status='Reviewed',note=${note},reviewer_id=${a.staff_id},reviewed_at=now() where audit_completion_item_id=${item.audit_completion_item_id}`;return {ok:true};
  }
  if(a.category_code==='INTERN')fail(403,'Intern accounts cannot update audit completion items.');rev(item,p);if((planning&&!['Draft','Returned'].includes(item.audit_file_status))||(!planning&&item.audit_file_status!=='Approved'))fail(400,planning?'Planning controls are locked after preparation.':'Closing controls are available after the audit file is approved.');if(item.status==='Reviewed')fail(400,'Reviewed completion items are locked; ask the Partner to record a controlled correction.');
  const status=choice(p.status,['Not started','In progress','Prepared']),note=text(p.note||'',3000,status==='Prepared');const evidence=p.evidence_document_id?uuid(p.evidence_document_id):null;
  if(evidence)one(await tx`select document_id from erp_private.documents where document_id=${evidence} and project_id=${item.project_id} and category in ('Working Papers','Current Year Audit','Permanent File') and deleted_at is null`);
  await tx`update erp_private.audit_completion_items set status=${status},note=${note},evidence_document_id=${evidence},prepared_by=${status==='Prepared'?a.staff_id:null},reviewer_id=null,reviewed_at=null where audit_completion_item_id=${item.audit_completion_item_id}`;return {ok:true};
 }

 if(p.action==='audit_file_transition'){
  leader(a);const f=one(await tx`select * from erp_private.audit_files where audit_file_id=${uuid(p.audit_file_id)} for update`);rev(f,p);if(f.file_status==='Archived')fail(400,'Archived files are read-only.');
  const next=choice(p.file_status,['Prepared','In Review','Returned','Approved','Completion']);
  if(next==='Prepared'){
   if(!['Draft','Returned'].includes(f.file_status))fail(400,'Only a draft or returned audit file can be marked Prepared.');if(f.framework_status!=='Approved')fail(400,'Confirm the reporting framework first.');
   const planning=one(await tx`select count(*)::int total,count(*) filter(where status='Reviewed')::int reviewed from erp_private.audit_completion_items where audit_file_id=${f.audit_file_id} and item_key in ('acceptance','engagement-terms','strategy','materiality','entity','risk','controls','team','prior')`);if(!planning.total||planning.total!==planning.reviewed)fail(400,'Prepare and independently review all planning and acceptance controls before marking the file Prepared.');
   const current=one(await tx`select count(*)::int count from erp_private.audit_tb_imports i where i.audit_file_id=${f.audit_file_id} and i.period_kind='Current' and i.status='Confirmed' and i.difference=0 and i.source_row_count=(select count(*) from erp_private.audit_tb_lines l where l.audit_tb_import_id=i.audit_tb_import_id) and not exists(select 1 from erp_private.audit_tb_lines l where l.audit_tb_import_id=i.audit_tb_import_id and l.audit_account_id is null)`);if(!current.count)fail(400,'Confirm a balanced and fully mapped current-year trial balance first.');
   const drafts=one(await tx`select count(*)::int count from erp_private.audit_tb_imports where audit_file_id=${f.audit_file_id} and status='Draft'`);if(drafts.count)fail(400,'Confirm or supersede every draft trial-balance import before preparing the file.');
  }
  if(next==='In Review'){
   if(f.file_status!=='Prepared')fail(400,'Set the file to Prepared before sending it for review.');
   if(f.file_type==='Subsequent-year'){const comparative=one(await tx`select count(*)::int count from erp_private.audit_tb_imports i where i.audit_file_id=${f.audit_file_id} and i.period_kind='Comparative' and i.status='Confirmed' and i.difference=0 and i.source_row_count=(select count(*) from erp_private.audit_tb_lines l where l.audit_tb_import_id=i.audit_tb_import_id) and not exists(select 1 from erp_private.audit_tb_lines l where l.audit_tb_import_id=i.audit_tb_import_id and l.audit_account_id is null)`);if(!comparative.count)fail(400,'This subsequent-year audit needs a balanced, fully mapped comparative trial balance before review.');}
   const papers=one(await tx`select count(*)::int total,count(*) filter(where status in ('Draft','Returned'))::int open from erp_private.audit_workpapers where audit_file_id=${f.audit_file_id}`);if(!papers.total)fail(400,'Add and submit the relevant audit working papers before review.');
   const open=one(await tx`select count(*)::int count from erp_private.audit_workpapers where audit_file_id=${f.audit_file_id} and status in ('Draft','Returned')`);if(open.count)fail(400,'Submit or resolve every draft and returned workpaper before review.');
  }
  if(next==='Approved'){
   if(a.category_code!=='PARTNER')fail(403,'Only the Engagement Partner can approve the audit file.');if(f.file_status!=='In Review')fail(400,'The file must be In Review before approval.');const pending=one(await tx`select count(*)::int count from erp_private.audit_workpapers where audit_file_id=${f.audit_file_id} and status<>'Approved'`);if(pending.count)fail(400,'Approve or return all submitted audit workpapers before approving the file.');if(f.created_by===a.staff_id)fail(403,'The file preparer cannot approve their own file.');
  }
  if(next==='Completion'){
   if(a.category_code!=='PARTNER')fail(403,'Only the Engagement Partner can move an audit file to Completion.');if(f.file_status!=='Approved')fail(400,'The file must be approved before completion.');
   const tasks=one(await tx`select count(*)::int total,count(*) filter(where status='Reviewed')::int reviewed from erp_private.audit_completion_items where audit_file_id=${f.audit_file_id}`);if(!tasks.total||tasks.total!==tasks.reviewed)fail(400,'Review every completion item before closing the audit file.');
   const controls=(await tx`select e.eqr_required,e.eqr_document_id,e.eqr_cleared_by,e.eqr_reviewer_id from erp_private.engagement_controls e where e.project_id=${f.project_id}`)[0];if(controls?.eqr_required&&(!controls.eqr_document_id||!controls.eqr_cleared_by||controls.eqr_cleared_by!==controls.eqr_reviewer_id))fail(400,'The assigned independent EQR reviewer must record clearance before completion.');
  }
  if(next==='Returned'&&f.file_status!=='In Review')fail(400,'Only a file in independent review can be returned to its preparer.');const reason=text(p.reason||'',1000,next==='Returned');await tx`update erp_private.audit_files set file_status=${next},archive_reason=case when ${next}='Returned' then ${reason} else null end where audit_file_id=${f.audit_file_id}`;return {ok:true};
 }

 if(p.action==='audit_file_archive'){
  if(a.category_code!=='PARTNER')fail(403,'Only the Engagement Partner can archive a completed audit file.');const f=one(await tx`select * from erp_private.audit_files where audit_file_id=${uuid(p.audit_file_id)} for update`);rev(f,p);if(f.file_status!=='Completion')fail(400,'Complete the audit file before archiving it.');const reason=text(p.reason,1000);if(reason.length<10)fail(400,'Record the archive reason.');await tx`update erp_private.audit_files set file_status='Archived',archive_reason=${reason},archived_by=${a.staff_id},archived_at=now() where audit_file_id=${f.audit_file_id}`;return {ok:true};
 }
 return undefined;
}
