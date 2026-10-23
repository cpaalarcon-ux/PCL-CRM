import {readWorkbookSheet} from './workbook-reader.mjs';
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
  const rows=await tx`select r.*,b.sheet_name,b.document_id from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} order by r.created_at,r.source_row,r.row_id limit 100 offset ${offset}`;
  return {rows:rows.map((r:any)=>({...r,warnings:rowWarnings(r)})),legal_categories:legalCategories,
   total:one(await tx`select count(*)::int count from erp_private.workbook_rows where project_id=${pid}`).count,
   categories:allCategories,
   rejections:await tx`select r.source_row,r.reason,b.sheet_name,b.dataset from erp_private.workbook_rejections r join erp_private.workbook_batches b using(batch_id) where b.project_id=${pid} order by b.created_at desc limit 100`};
 }
 if(p.action==='workbook_map'){
  const target=one(await tx`select project_id from erp_private.workbook_rows where row_id=${uuid(p.row_id)}`);await tx`select pg_advisory_xact_lock(hashtextextended(${target.project_id+':tax'},0))`;
  const route=Number(p.route),category=allCategories.find(c=>c.code===p.category_code&&c.route===route&&c.kind==='Purchase');
  if(!category)fail(400,'Choose a category for the selected purchase route.');
  const narration=text(p.narration,1000),asset=text(p.asset_details||'',1000,route===3);
  const details={legal_category:text(p.legal_category||'',100,false),legal_basis:text(p.legal_basis||'',2000,false),evidence:text(p.evidence||'',1000,false)};
  if(details.legal_category&&!legalCategories.includes(details.legal_category))fail(400,'Choose a workbook legal category.');
  const r=await tx`update erp_private.workbook_rows set route=${route},category_code=${category.code},narration=${narration},asset_details=${asset||null},review_details=${tx.json(details)}
   where row_id=${uuid(p.row_id)} and dataset in ('Purchases','Expenditure','Non-eTIMS') and revision=${revision(p.revision)} returning row_id`;
  if(!r.length)fail(409,'This purchase changed or is unavailable. Refresh first.');return {ok:true};
 }
 if(!['workbook_preview','workbook_commit'].includes(p.action))fail(404,'Unknown workbook action.');
 const d=one(await tx`select * from erp_private.documents where document_id=${uuid(p.document_id)} and deleted_at is null`);
 if(!d.project_id||d.mime_type!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Choose an XLSX document linked to a project.');
 const project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${d.project_id} and deleted_at is null`);
 if(project.status==='Archived')fail(400,'Archived projects cannot receive imports.');
 const result=await storage.download(d.object_key);if(result.error||!result.data)fail(404,'The original workbook is unavailable.');
 const bytes=new Uint8Array(await result.data.arrayBuffer());checkWorkbookZip(bytes);
 const {sheet,sheets}=await readWorkbookSheet(bytes,p.sheet_name?text(p.sheet_name,100):null);
 if(sheet.columnCount>80||sheet.rowCount>20000)fail(400,'Split the worksheet into at most 80 columns and 20,000 rows.');
 const template=detectTemplate(sheet);
 const header=Math.trunc(Number(p.header_row)||template?.blocks[0].header_row||1);
 if(header<1||header>sheet.rowCount||(!template&&header>200))fail(400,'Choose a valid header row.');
 const block=template?.blocks.find((b:any)=>b.header_row===header);
 if(template&&!block)fail(400,'Choose one of the recognised workbook sections.');
 const values=(i:number)=>sheetValues(sheet,i);
 await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${d.document_id},${a.auth_user_id},'DOWNLOAD')`;
 if(p.action==='workbook_preview')return {document_id:d.document_id,project_id:d.project_id,sheets,sheet_name:sheet.name,header_row:header,headers:block?.headers||values(header),template:template?{...template,selected:block}:null,
  preview:Array.from({length:Math.min(12,Math.max(0,(block?.last_row||sheet.rowCount)-header))},(_,i)=>({row:header+i+1,values:values(header+i+1).slice(0,block?.headers.length||sheet.columnCount)})),categories:allCategories};
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.project_id+':tax'},0))`;
 const dataset=template?template.dataset:choice(p.dataset,['Sales','Purchases','Bank','General']);
 if(template&&p.dataset&&p.dataset!==dataset)fail(400,'The import type must match the recognised workbook.');
 const start=date(p.period_start),end=date(p.period_end);
 if(!start||!end||end<start)fail(400,'Choose the import period.');const map=block?block.column_map:importMap(p.column_map,dataset),batch=crypto.randomUUID();
 const first=Math.trunc(Number(p.first_row)||block?.first_row||header+1),last=Math.trunc(Number(p.last_row)||block?.last_row||sheet.rowCount);
 if(first<=header||last<first||last>sheet.rowCount||last-first>=10000||block&&(first<block.first_row||last>block.last_row))fail(400,'Choose up to 10,000 data rows within the selected section.');
 const isCost=['Purchases','Expenditure','Non-eTIMS'].includes(dataset);
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':'+(isCost?'Cost':dataset)},0))`;
 let source=0,added=0,duplicates=0;const rejected:any[]=[],parsed:any[]=[];
 const canonical=(r:any)=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>!template||['date','invoice','party','party_pin','line_id','description','customs_entry','amount','vat','purchase_type','original_invoice'].includes(k)).sort(([a],[b])=>a.localeCompare(b))));
 let ignored=0;
 for(let i=first;i<=last;i++){
  const v=template?templateRow(sheet,i,template,block):values(i);if(!v){ignored++;continue;}
  const n=template?normalizeTemplate(v,template,block,start,end):normalizeImport(v,map,dataset,start,end);if(!n){ignored++;continue;}source++;
  if(n.issues.length){rejected.push({row:i,raw:n.raw,reason:n.issues.join(' ')});continue;}
  parsed.push({...n,source_row:i,row_key:await hash(n.key)});
 }
 const known=new Map<string,string>();
 for(let i=0;i<parsed.length;i+=500){const keys=parsed.slice(i,i+500).map(n=>n.row_key);
  const rows=await tx`select row_key,normalized from erp_private.workbook_rows where client_id=${project.client_id} and dataset=${dataset} and row_key=any(${tx.array(keys)}::text[])`;
  for(const row of rows)known.set(row.row_key,canonical(row.normalized));
 }
 const cross=new Set<string>();
 const refParty=(n:any)=>String(n.invoice||'').trim().toUpperCase()+'|'+String(n.party||'').trim().toUpperCase();
 if(isCost)for(let i=0;i<parsed.length;i+=500){
  const refs=[...new Set(parsed.slice(i,i+500).map(n=>String(n.row.invoice||'').toUpperCase()))];
  const others=await tx`select normalized from erp_private.workbook_rows where client_id=${project.client_id} and dataset in ('Purchases','Expenditure','Non-eTIMS') and dataset<>${dataset} and upper(normalized->>'invoice')=any(${tx.array(refs)}::text[])`;
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
   on conflict(client_id,dataset,row_key) do nothing returning row_id`;
  added+=inserted.length;duplicates+=accepted.slice(i,i+500).length-inserted.length;
 }
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by)
 values(${batch},${d.project_id},${d.document_id},${sheet.name},${header},${dataset},${start},${end},${tx.json(map)},${source},${added},${duplicates},${rejected.length},${a.staff_id})`;
 for(let i=0;i<rejected.length;i+=500)await tx`insert into erp_private.workbook_rejections(batch_id,source_row,reason,raw_values) select ${batch}::uuid,r.row,r.reason,r.raw from jsonb_to_recordset(${tx.json(rejected.slice(i,i+500))}::jsonb) as r(row integer,reason text,raw jsonb)`;
 await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${d.document_id},${a.auth_user_id},'DOWNLOAD')`;
 return {ok:true,batch_id:batch,ignored_count:ignored,dataset,source_count:source,new_count:added,duplicate_count:duplicates,rejected_count:rejected.length,rejections:rejected.slice(0,100).map(r=>({row:r.row,reason:r.reason}))};
}
