import {stockCategoryOptions} from './stock-category-options.ts';
import {detectImportProfile,profilePurchase} from './import-profiles.mjs';
import {purchaseUploadProfile,purchaseUploadRows,purchaseUploadMap,purchaseUploadHeaders,purchaseUploadRates,purchaseUploadValues,purchaseDisplayValues,purchasePendingMatch,purchaseUploadId,normalizePurchaseUpload,purchaseUploadSummary,importRowRange} from './purchase-upload.mjs';
import {pendingPurchases} from './purchase-pending.ts';
import {readSourceSheet} from './source-reader.mjs';
import categories from './purchase-categories.json' with {type:'json'};
import {fail,text,uuid,choice,date,revision} from './validation.mjs';
import {checkWorkbookZip,importMap,normalizeImport} from './workspace-rules.mjs';
import {detectTemplate,sheetValues,templateRow,normalizeTemplate,rowWarnings,workbookCategories,legalCategories} from './workbook-templates.mjs';
const allCategories=[...workbookCategories,...categories.filter(c=>c.kind==='Purchase')];
const one=(r:any[])=>{if(!r.length)fail(403,'Document or project unavailable.');return r[0];};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function workbookAction(tx:any,a:any,p:any,storage:any):Promise<any>{
 if(!String(p.action).startsWith('workbook_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'A staff preparer must import and map working papers.');
 if(p.action==='workbook_rows'){
  const pid=uuid(p.project_id),offset=Math.max(0,Math.min(100000,Math.trunc(Number(p.offset)||0)));
  one(await tx`select project_id from erp_private.projects where project_id=${pid}`);
  const search='%'+text(p.search||'',160,false)+'%',mapping=choice(p.mapping||'All',['All','Unmapped','Inventory','Expenditure','PPE']),dataset=choice(p.dataset||'All',['Costs','All','Purchases','Expenditure','Non-eTIMS','Sales','POS','Bank']),rate=choice(p.vat_category||'All',['All','16%','8%','0%','Exempt','Non-eTIMS','Unconfirmed']);
  const rows=await tx`select r.*,b.sheet_name,b.document_id,b.period_start,b.period_end,v.decision,v.source_revision from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id)
   where r.project_id=${pid} and b.archived_at is null and not r.is_split_parent and (${dataset}='All' or ${dataset}='Costs' and r.dataset in ('Purchases','Expenditure','Non-eTIMS') or r.dataset=${dataset})
   and (${mapping}='All' or ${mapping}='Unmapped' and r.account_code is null or r.account_code is not null and r.route=case ${mapping} when 'Inventory' then 1 when 'Expenditure' then 2 when 'PPE' then 3 else 0 end)
   and (${rate}='All' or (case when r.dataset='Non-eTIMS' then 'Non-eTIMS' else coalesce(r.normalized->>'vat_category','Unconfirmed') end)=${rate})
   and concat_ws(' ',r.normalized->>'invoice',r.normalized->>'reference',r.normalized->>'party',r.normalized->>'party_pin',r.normalized->>'description') ilike ${search}
   order by r.created_at,r.source_row,r.row_id limit 100 offset ${offset}`;
  const total=one(await tx`select count(*)::int count from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and b.archived_at is null and not r.is_split_parent
   and (${dataset}='All' or ${dataset}='Costs' and r.dataset in ('Purchases','Expenditure','Non-eTIMS') or r.dataset=${dataset})
   and (${mapping}='All' or ${mapping}='Unmapped' and r.account_code is null or r.account_code is not null and r.route=case ${mapping} when 'Inventory' then 1 when 'Expenditure' then 2 when 'PPE' then 3 else 0 end)
   and (${rate}='All' or (case when r.dataset='Non-eTIMS' then 'Non-eTIMS' else coalesce(r.normalized->>'vat_category','Unconfirmed') end)=${rate})
   and concat_ws(' ',r.normalized->>'invoice',r.normalized->>'reference',r.normalized->>'party',r.normalized->>'party_pin',r.normalized->>'description') ilike ${search}`).count;
  const clientId=one(await tx`select client_id from erp_private.projects where project_id=${pid}`).client_id;
  const clientAccountMappings=await tx`select erp_account_code,effective_from,effective_to from erp_private.client_account_mappings where client_id=${clientId} and status='Active' order by erp_account_code,effective_from`,clientAccountCodes=[...new Set(clientAccountMappings.map((m:any)=>m.erp_account_code))],clientAccounts=clientAccountCodes.length?await tx`select * from erp_private.account_catalog where code=any(${tx.array(clientAccountCodes)}::text[]) order by code`:[];
  return {stock_categories:await stockCategoryOptions(tx,clientId),policies:await tx`select * from erp_private.stock_policy_versions where client_id=(select client_id from erp_private.projects where project_id=${pid}) order by effective_from desc`,activities:await tx`select * from erp_private.client_activities where client_id=(select client_id from erp_private.projects where project_id=${pid}) order by activity_name`,accounts:clientAccounts,client_account_mappings:clientAccountMappings,policy:(await tx`select * from erp_private.accounting_policies where client_id=(select client_id from erp_private.projects where project_id=${pid})`)[0]||null,rows:rows.map((r:any)=>({...r,warnings:rowWarnings(r)})),legal_categories:legalCategories,total,
   categories:allCategories,pending_information:await pendingPurchases(tx,pid),
   rejections:await tx`select r.source_row,r.reason,b.sheet_name,b.dataset from erp_private.workbook_rejections r join erp_private.workbook_batches b using(batch_id) where b.project_id=${pid} and b.archived_at is null and not r.raw_values ? '_pending_purchase' order by b.created_at desc limit 100`};
 }
 if(p.action==='workbook_map'){
  const target=one(await tx`select r.project_id from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.row_id=${uuid(p.row_id)} and b.archived_at is null`);await tx`select pg_advisory_xact_lock(hashtextextended(${target.project_id+':tax'},0))`;
  const route=Number(p.route),category=allCategories.find(c=>c.code===p.category_code&&c.route===route&&c.kind==='Purchase');
  if(!category)fail(400,'Choose a category for the selected purchase route.');
  const narration=text(p.narration,1000),asset=text(p.asset_details||'',1000,route===3);
  const details={legal_category:text(p.legal_category||'',100,false),legal_basis:text(p.legal_basis||'',2000,false),evidence:text(p.evidence||'',1000,false)};
  if(details.legal_category&&!legalCategories.includes(details.legal_category))fail(400,'Choose a workbook legal category.');
  const r=await tx`update erp_private.workbook_rows set route=${route},category_code=${category.code},narration=${narration},asset_details=${asset||null},review_details=${tx.json(details)}
   where row_id=${uuid(p.row_id)} and dataset in ('Purchases','Expenditure','Non-eTIMS') and revision=${revision(p.revision)} and exists(select 1 from erp_private.workbook_batches b where b.batch_id=workbook_rows.batch_id and b.archived_at is null) returning row_id`;
  if(!r.length)fail(409,'This purchase changed or is unavailable. Refresh first.');return {ok:true};
 }
 if(!['workbook_preview','workbook_commit'].includes(p.action))fail(404,'Unknown workbook action.');
 const d=one(await tx`select * from erp_private.documents where document_id=${uuid(p.document_id)} and deleted_at is null and archived_at is null for share`);
 if(!d.project_id||!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/zip'].includes(d.mime_type))fail(400,'Choose a CSV, XLSX or ZIP document linked to a project.');
 const project=one(await tx`select p.project_id,p.client_id,p.status,c.company_name,c.kra_pin from erp_private.projects p join erp_private.clients c using(client_id) where p.project_id=${d.project_id} and p.deleted_at is null`);
 if(project.status==='Archived')fail(400,'Archived projects cannot receive imports.');
 const result=await storage.download(d.object_key);if(result.error||!result.data)fail(404,'The original workbook is unavailable.');
 const bytes=new Uint8Array(await result.data.arrayBuffer());
 const sourceInfo:any=await readSourceSheet(bytes,d.file_name,p.sheet_name?text(p.sheet_name,500):null);const {sheet,sheets}=sourceInfo;
 if(sheet.columnCount>80||sheet.rowCount>20000)fail(400,'Split the worksheet into at most 80 columns and 20,000 rows.');
 const standard=purchaseUploadProfile(sheet,p.upload_format===purchaseUploadId),standardData=standard?purchaseUploadRows(sheet):null;
 const purchaseAccounts=standard?await tx`select code,name,route,category_code,status,is_legacy from erp_private.account_catalog order by code`:[],purchaseClientMappings=standard?await tx`select erp_account_code,effective_from,effective_to from erp_private.client_account_mappings where client_id=${project.client_id} and status='Active' order by erp_account_code,effective_from`:[];
 const template=standard?null:detectTemplate(sheet),profile=standard||detectImportProfile(sheet);
 if(standard&&p.header_row!=null&&Number(p.header_row)!==1)fail(400,'The standard purchase template reserves row 1 for headings. Transactions start on row 2.');
 const header=standard?1:p.header_row===0||p.header_row==='0'?0:Math.trunc(Number(p.header_row)||template?.blocks[0].header_row||profile?.header_row||(sourceInfo.headerless?0:1));
 if(header<0||header>sheet.rowCount||(!template&&header>200))fail(400,'Choose a valid header row.');
 const block=template?.blocks.find((b:any)=>b.header_row===header);
 if(template&&!block)fail(400,'Choose one of the recognised workbook sections.');
 const values=(i:number)=>sheetValues(sheet,i);
 const previewTotal=standard?standardData.rows.length:Math.max(0,(block?.last_row||sheet.rowCount)-header),previewOffset=Math.max(0,Math.min(previewTotal,Math.trunc(Number(p.preview_offset)||0))),previewPageSize=standard?10:200;
 await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${d.document_id},${a.auth_user_id},'DOWNLOAD')`;
 if(p.action==='workbook_preview')return {client_id:project.client_id,client_name:project.company_name,client_pin:project.kra_pin,document_id:d.document_id,project_id:d.project_id,sheets,sheet_name:sheet.name,header_row:header,headers:standard?purchaseUploadHeaders:block?.headers||(header===0?Array.from({length:sheet.columnCount},(_,i)=>'Column '+(i+1)):values(header)),import_profile:profile,source_inventory:sourceInfo.inventory||null,source_adapter:sourceInfo.adapter||'XLSX',template:template?{...template,selected:block}:null,
  standard_purchase:standard?{id:purchaseUploadId,template_version:profile.version,rates:purchaseUploadRates,ignored_count:standardData.ignored,approved_client_account_count:new Set(purchaseClientMappings.map((m:any)=>m.erp_account_code)).size,summary:p.vat_category&&p.period_start&&p.period_end?purchaseUploadSummary(standardData.rows,choice(p.vat_category,purchaseUploadRates),date(p.period_start),date(p.period_end),purchaseAccounts,purchaseClientMappings):null}:null,
  preview_total:previewTotal,preview_offset:previewOffset,preview_page_size:previewPageSize,
  preview:standard?standardData.rows.slice(previewOffset,previewOffset+previewPageSize).map(r=>({row:r.source_row,values:r.values,display_values:purchaseDisplayValues(r.values)})):Array.from({length:Math.min(previewPageSize,previewTotal-previewOffset)},(_,i)=>({row:header+previewOffset+i+1,values:values(header+previewOffset+i+1).slice(0,block?.headers.length||sheet.columnCount)})),categories:allCategories};
 if((standard||['text/csv','application/zip'].includes(d.mime_type))&&p.confirmed_client_id!==project.client_id)fail(400,'Confirm the legal client before committing this source.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.project_id+':tax'},0))`;
 const dataset=template?template.dataset:profile?.recognised?profile.dataset:choice(p.dataset,['Sales','POS','Purchases','Bank','General']);
 if(['Sales','Payroll'].includes(dataset))fail(400,'Use Sales totals / Payroll imports to confirm this source without creating invoice records.');
 if(profile&&!profile.recognised)fail(400,'Review the changed source format: '+(profile.errors||[]).join(' '));
 if(template&&p.dataset&&p.dataset!==dataset)fail(400,'The import type must match the recognised workbook.');
 if(sourceInfo.section&&!profile?.recognised&&!p.section_contract_confirmed)fail(400,'Confirm the selected KRA CSV section column mapping. A section name alone is not a validated filing contract.');
 const start=date(p.period_start),end=date(p.period_end);
 if(!start||!end||end<start)fail(400,'Choose the import period.');const map=block?block.column_map:profile?.recognised?profile.column_map:importMap(p.column_map,dataset),batch=crypto.randomUUID();
 if(!one(await tx`select erp_private.tax_period_open(${project.project_id}::uuid,${start}::date,${end}::date) as open`).open)fail(400,'Return the submitted tax case before adding source rows. Locked periods cannot receive imports.');
 const first=standard?2:Number(p.first_row||block?.first_row||header+1),last=standard?sheet.rowCount:Number(p.last_row||block?.last_row||sheet.rowCount);
 if(!standard)importRowRange({header,first,last,rowCount:sheet.rowCount,block});
 if(standard&&!standardData.rows.length)fail(400,'No purchase transactions found. Keep the headings in row 1 and paste transactions from row 2.');
 if(standard&&!purchaseUploadRates.includes(p.vat_category))fail(400,'Select the VAT category in the ERP: 16%, 8%, 0% or Exempt.');
 const selectedRate=standard?p.vat_category:null;
 const signatureData={digest:d.sha256,sheet:sheet.name,header,dataset,start,end,first,last,map,profile:profile?.id||null,vat_category:selectedRate,allow_pending_credit_details:p.allow_pending_credit_details===true};
 const legacySignature=await hash(JSON.stringify({version:6,...signatureData}));
 const priorSignature=await hash(JSON.stringify({version:7,document_id:d.document_id,...signatureData}));
 const signature=await hash(JSON.stringify({version:8,document_id:d.document_id,...signatureData}));
 const previous=(await tx`select b.* from erp_private.workbook_import_requests r join erp_private.workbook_batches b using(batch_id) where r.project_id=${project.project_id} and r.signature in (${signature},${priorSignature},${legacySignature}) and b.archived_at is null order by (r.signature=${signature}) desc,(r.signature=${priorSignature}) desc limit 1`)[0];
 if(previous){const pending=await pendingPurchases(tx,project.project_id,null,null,previous.batch_id),history=Number((await tx`select count(*)::int n from erp_private.workbook_rejections where batch_id=${previous.batch_id} and raw_values ? '_pending_purchase'`)[0].n);return {ok:true,batch_id:previous.batch_id,duplicate_upload:true,dataset:previous.dataset,source_count:previous.source_count,new_count:0,duplicate_count:previous.new_count+previous.duplicate_count+history-pending.total,pending_count:pending.total,rejected_count:previous.rejected_count-history,rejections:[]};}
 const isCost=['Purchases','Expenditure','Non-eTIMS'].includes(dataset);
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':'+(isCost?'Cost':dataset)},0))`;
 let source=0,added=0,duplicates=0;const rejected:any[]=[],parsed:any[]=[];
 const canonical=(r:any)=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>!template&&!standard||['date','invoice','party','party_pin','line_id','description','customs_entry','amount','vat','purchase_type','original_invoice','original_invoice_date'].includes(k)||standard&&k==='vat_category').sort(([a],[b])=>a.localeCompare(b))));
 let ignored=0;
 for(let i=first;i<=last;i++){
  const v=standard?purchaseUploadValues(sheet,i):template?templateRow(sheet,i,template,block):values(i);if(!v||standard&&!v.some(v=>String(v??'').trim())){ignored++;continue;}
  const n=standard?normalizePurchaseUpload(v,selectedRate,start,end,purchaseAccounts,purchaseClientMappings):template?normalizeTemplate(v,template,block,start,end):profile?.recognised?profilePurchase(v,profile,start,end):normalizeImport(v,map,dataset,start,end);if(!n){ignored++;continue;}source++;
  if(n.issues.length){rejected.push({row:i,raw:n.raw,reason:n.issues.join(' ')});continue;}
  if(standard&&n.pending.length){rejected.push({row:i,raw:{...n.raw,_pending_purchase:{key:await hash(n.key),match:purchasePendingMatch(n.row),row:n.row}},reason:'Pending information: '+n.pending.join(' '),pending:true});continue;}
  parsed.push({...n,source_row:i,row_key:await hash(n.key)});
 }
 const pendingCount=rejected.filter(r=>r.pending).length;
 // Stage each valid row even when another row needs correction. The rejected rows
 // remain attached to this import batch with their original values and row numbers.
 // Staff can fix and re-upload them without blocking the clean rows.
 if(pendingCount&&p.allow_pending_credit_details!==true)fail(400,`Confirm that ${pendingCount} credit note(s) will be retained as Pending information, outside posting, until the original invoice details are supplied.`);
 const known=new Map<string,string>();
 for(let i=0;i<parsed.length;i+=500){const keys=parsed.slice(i,i+500).map(n=>n.row_key);
  const rows=await tx`select r.row_key,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.client_id=${project.client_id} and b.archived_at is null and r.parent_row_id is null and r.dataset=${dataset} and r.row_key=any(${tx.array(keys)}::text[])`;
  for(const row of rows)known.set(row.row_key,canonical(row.normalized));
 }
 const cross=new Set<string>();
 const refParty=(n:any)=>String(n.invoice||'').trim().toUpperCase()+'|'+String(n.party||'').trim().toUpperCase();
 if(isCost)for(let i=0;i<parsed.length;i+=500){
  const refs=[...new Set(parsed.slice(i,i+500).map(n=>String(n.row.invoice||'').toUpperCase()))];
  const others=await tx`select w.normalized from erp_private.workbook_rows w join erp_private.workbook_batches b using(batch_id) where w.client_id=${project.client_id} and b.archived_at is null and w.parent_row_id is null and w.dataset in ('Purchases','Expenditure','Non-eTIMS') and w.dataset<>${dataset} and upper(w.normalized->>'invoice')=any(${tx.array(refs)}::text[])`;
  for(const r of others)cross.add(refParty(r.normalized));
 }
 const accepted:any[]=[];
 for(const n of parsed){
  if(cross.has(refParty(n.row))){rejected.push({row:n.source_row,raw:n.raw,reason:'This supplier reference already exists in another cost dataset. Review the existing entry to avoid counting expenditure twice.'});continue;}
  const existing=known.get(n.row_key),fingerprint=canonical(n.row);
  if(existing!==undefined){if(existing===fingerprint)duplicates++;else rejected.push({row:n.source_row,raw:n.raw,reason:'An existing reference has different values. Review the original entry; imports never overwrite it.'});continue;}
  known.set(n.row_key,fingerprint);accepted.push({source_row:n.source_row,row_key:n.row_key,raw_values:n.raw,normalized:n.row,route:n.route||null,category_code:n.category_code||null,narration:n.narration||null});
 }
 for(let i=0;i<accepted.length;i+=500){
  const inserted=await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,category_code,narration)
   select ${batch}::uuid,${d.project_id}::uuid,${project.client_id}::uuid,${dataset},r.source_row,r.row_key,r.raw_values,r.normalized,r.route,r.category_code,r.narration
   from jsonb_to_recordset(${tx.json(accepted.slice(i,i+500))}::jsonb) as r(source_row integer,row_key text,raw_values jsonb,normalized jsonb,route integer,category_code text,narration text)
   on conflict(batch_id,row_key) do nothing returning row_id`;
  added+=inserted.length;duplicates+=accepted.slice(i,i+500).length-inserted.length;
 }
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by)
 values(${batch},${d.project_id},${d.document_id},${sheet.name},${header},${dataset},${start},${end},${tx.json(map)},${source},${added},${duplicates},${rejected.length},${a.staff_id})`;
 await tx`insert into erp_private.workbook_import_requests(project_id,signature,batch_id,document_id) values(${project.project_id},${signature},${batch},${d.document_id})`;
 for(let i=0;i<rejected.length;i+=500)await tx`insert into erp_private.workbook_rejections(batch_id,source_row,reason,raw_values) select ${batch}::uuid,r.row,r.reason,r.raw from jsonb_to_recordset(${tx.json(rejected.slice(i,i+500))}::jsonb) as r(row integer,reason text,raw jsonb)`;
 await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${d.document_id},${a.auth_user_id},'DOWNLOAD')`;
 const outstanding=pendingCount?(await pendingPurchases(tx,project.project_id,null,null,batch)).total:0;
 return {ok:true,batch_id:batch,ignored_count:ignored,dataset,source_count:source,new_count:added,duplicate_count:duplicates+pendingCount-outstanding,pending_count:outstanding,rejected_count:rejected.length-pendingCount,rejections:rejected.filter(r=>!r.pending).slice(0,100).map(r=>({row:r.row,reason:r.reason}))};
}
