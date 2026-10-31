import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {fileType,fail,text,uuid,choice,staffInput,login} from './validation.mjs';
import {cleanCell} from './suite-rules.mjs';
import {one,leader} from './suite-actions.ts';
const fields:any={Clients:['company_name','kra_pin','primary_sector','branch_location','client_category'],Staff:['staff_identifier','login_id','full_name','category_code','employment_type','billing_status','branch_location','contract_start_date','contract_end_date']};
export async function masterImport(tx:any,a:any,f:FormData){
 leader(a);const dataset=choice(f.get('dataset'),['Clients','Staff']),file=f.get('file');if(!(file instanceof File))fail(400,'Choose an Excel workbook.');
 const bytes=new Uint8Array(await file.arrayBuffer());if(fileType(file.name,bytes)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Use an XLSX workbook.');checkWorkbookZip(bytes);
 const {sheet,sheets}=await readWorkbookSheet(bytes,f.get('sheet_name')||null),header=Number(f.get('header_row')||1);if(!Number.isInteger(header)||header<1||header>200)fail(400,'Choose a header row from 1 to 200.');
 const row=(n:number)=>Array.from({length:sheet.columnCount},(_,i)=>sheet.getRow(n).getCell(i+1).value);
 if(f.get('action')==='master_preview')return {dataset,sheets,sheet_name:sheet.name,header_row:header,fields:fields[dataset],headers:row(header).map(cleanCell),rows:sheet.rowCount,preview:Array.from({length:Math.min(8,Math.max(0,sheet.rowCount-header))},(_,i)=>({row:header+i+1,values:row(header+i+1).map(cleanCell)}))};
 const firm=uuid(f.get('firm_id'));one(await tx`select firm_id from erp_private.firms where firm_id=${firm}`);
 let map:any;try{map=JSON.parse(String(f.get('column_map')));}catch{fail(400,'Map the columns first.');}
 for(const [k,v] of Object.entries(map)){if(!fields[dataset].includes(k)||!Number.isInteger(v)||Number(v)<1||Number(v)>sheet.columnCount)fail(400,'Invalid column mapping.');}
 if(!map[dataset==='Clients'?'company_name':'full_name']||dataset==='Staff'&&(!map.staff_identifier||!map.login_id))fail(400,'Map the required name and staff/login identifiers.');
 const first=Number(f.get('first_row')||header+1),last=Number(f.get('last_row')||sheet.rowCount);if(!Number.isInteger(first)||!Number.isInteger(last)||first<=header||last<first||last>sheet.rowCount||last-first>1999)fail(400,'Select up to 2,000 data rows.');
 let source=0,added=0,duplicates=0;const rejected:any[]=[];
 for(let i=first;i<=last;i++){
  const raw=row(i);if(raw.every(v=>v==null||String(v).trim()===''))continue;source++;
  try{await tx.savepoint(async(rtx:any)=>{
   const v:any=Object.fromEntries(Object.entries(map).map(([key,col])=>[key,cleanCell(raw[Number(col)-1])]));
   if(dataset==='Clients'){
    const name=text(v.company_name,200),pin=v.kra_pin?text(v.kra_pin,11).toUpperCase():null;if(pin&&!/^[A-Z][0-9]{9}[A-Z]$/.test(pin))fail(400,'Invalid KRA PIN.');
    const existing=await rtx`select client_id,company_name,kra_pin from erp_private.clients where deleted_at is null and ((${pin}::text is not null and kra_pin=${pin}) or lower(btrim(company_name))=lower(btrim(${name})))`;
    if(existing.length){if(existing.length>1||pin&&existing[0].kra_pin&&existing[0].kra_pin!==pin)fail(400,'Conflicting client identity; review manually.');await rtx`insert into erp_private.client_firm_links(client_id,firm_id) values(${existing[0].client_id},${firm}) on conflict do nothing`;duplicates++;return;}
    const sector=v.primary_sector||null;if(sector&&!(await rtx`select sector_id from erp_private.sectors where name=${sector} and deleted_at is null`).length)fail(400,'Unknown sector; add it first or leave it blank.');
    const branch=v.branch_location?choice(v.branch_location,['Nairobi','Bungoma','Kisii','Other']):null,cat=v.client_category?choice(v.client_category,['Corporate','Non-Profit','Public Entity','Individual']):null;
    const cid=crypto.randomUUID();await rtx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,record_status,owner_staff_id) values(${cid},${name},${pin},${sector},${branch},${cat},'Existing',${a.staff_id})`;
    await rtx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${firm})`;
   }else{
    const identifier=text(v.staff_identifier,80).toUpperCase(),loginId=login(v.login_id),old=await rtx`select staff_id,staff_identifier,login_id from erp_private.staff_members where lower(staff_identifier)=lower(${identifier}) or lower(login_id)=lower(${loginId})`;
    if(old.length){if(old.length!==1||old[0].staff_identifier.toUpperCase()!==identifier||old[0].login_id!==loginId)fail(400,'Conflicting staff/login identifiers.');duplicates++;return;}
    const values=staffInput({...v,category_code:v.category_code||'ASSISTANT',employment_type:v.employment_type||'Permanent',billing_status:v.billing_status||'Billable'},a);
    const sid=crypto.randomUUID();await rtx`insert into erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,manager_id,employment_type,billing_status,branch_location,contract_start_date,contract_end_date) values(${sid},${identifier},${loginId},${values.full_name},${values.category_code},${a.staff_id},${values.employment_type},${values.billing_status},${values.branch_location},${values.contract_start_date},${values.contract_end_date})`;
    await rtx`insert into erp_private.staff_firm_access(staff_id,firm_id) values(${sid},${firm})`;
   }added++;
  });}catch(e:any){if(!e.status)console.error('Master import row rejected',{code:e.code||'INTERNAL',type:e.name||'Error'});rejected.push({row:i,reason:e.status?e.message:e.code==='23505'?'An existing record uses this identity; ask the Partner to review.':'Check the required values and permitted staff category.'});}
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'master_imports','IMPORT',${crypto.randomUUID()},${tx.json({dataset,file_name:file.name,sheet:sheet.name,source_count:source,new_count:added,duplicate_count:duplicates,rejected_count:rejected.length})})`;
 return {source_count:source,new_count:added,duplicate_count:duplicates,rejected_count:rejected.length,rejections:rejected};
}
