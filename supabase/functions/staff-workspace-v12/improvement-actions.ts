import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {entityInput,partnerRatios,stockValues,suggestionFor,exportReadiness,packs,streams,asDay} from './improvement-rules.mjs';
import {money} from './accounting-rules.mjs';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
const one=(r:any[])=>{if(!r.length)fail(403,'Record unavailable to this account.');return r[0];};
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Partner or Manager must maintain client configuration.');};
const reviewer=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'Independent Supervisor, Manager or Partner review required.');};
const fresh=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This record changed. Refresh before saving.');};
const range=(p:any)=>{const s=date(p.starts_on),e=date(p.ends_on);if(!s||!e||e<s||Date.parse(e)-Date.parse(s)>367*86400000)fail(400,'Choose a valid period of up to 367 days.');return [s,e];};
const isoDay=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const nextStockDay=(v:any)=>{const day=isoDay(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';const d=new Date(`${day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const stockPolicyEvidence=(p:any)=>{
 if(p.evidence_type||p.evidence_reference||p.evidence_other){if(!p.evidence_type)fail(400,'Choose the optional policy evidence type before adding a reference.');const types=['Client inventory policy','Approved accounting manual','Management or Board approval','Stock-system settings or report','Stock count or valuation working paper','Other'];const type=choice(p.evidence_type,types),other=type==='Other'?text(p.evidence_other,200):'',reference=text(p.evidence_reference||'',500,false);if(type==='Other'&&other.length<3)fail(400,'Describe the other evidence type.');return `${type==='Other'?`Other — ${other}`:type}${reference?`: ${reference}`:''}`;}
 return text(p.evidence||'',2000,false);
};
export const digest=async(v:any)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(v))))).map(n=>n.toString(16).padStart(2,'0')).join('');
const headerKey=(v:any)=>String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
const workbookCell=(sheet:any,row:number,column:number)=>{
 const value=sheet.getRow(row).getCell(column).value;
 if(value&&typeof value==='object'&&('formula' in value||'sharedFormula' in value))return {formula:true,value:'Formula'};
 const raw=value&&typeof value==='object'&&'result' in value?value.result:value;
 return {formula:false,value:raw instanceof Date?raw.toISOString().slice(0,10):raw};
};
async function openingTBMappingPreview(tx:any,a:any,p:any,storage:any){
 if(!storage)fail(503,'Opening TB mapping suggestions are unavailable. Refresh and try again.');
 const cid=uuid(p.client_id),docId=uuid(p.document_id),from=date(p.effective_from);
 if(!from)fail(400,'Choose the date these account mappings should begin.');
 const client=one(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`);
 const doc=one(await tx`select document_id,file_name,object_key,sha256,handling_firm_id from erp_private.documents where document_id=${docId} and client_id=${cid} and project_id is null and category='Import Sources' and import_purpose='Opening TB' and archived_at is null and deleted_at is null`);
 const file=await storage.download(doc.object_key);if(file.error||!file.data)fail(404,'The staged opening TB workbook is unavailable.');
 await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${doc.document_id},${a.auth_user_id},'DOWNLOAD')`;
 const bytes=new Uint8Array(await file.data.arrayBuffer());checkWorkbookZip(bytes);
 let read=await readWorkbookSheet(bytes,p.sheet_name?text(p.sheet_name,100):null),sheets=read.sheets||[];
 if(!p.sheet_name){
  const named=sheets.find((s:any)=>/opening\s*tb|trial\s*balance|^b02a\b/i.test(s.name));
  if(named)read=await readWorkbookSheet(bytes,named.name);
  else if(sheets.length>1)return {needs_sheet:true,sheets:sheets.map((s:any)=>s.name),file_name:doc.file_name,document_id:doc.document_id,effective_from:from};
 }
 const sheet=read.sheet;
 if(sheet.rowCount>2001)fail(400,'An opening TB mapping sheet can contain at most 2,000 account rows. Split the workbook and try again.');
 const headerRow=1,headers=Array.from({length:sheet.columnCount},(_,i)=>workbookCell(sheet,headerRow,i+1).value),normalized=headers.map(headerKey);
 const find=(names:string[])=>normalized.findIndex((v:string)=>names.includes(v))+1;
 const cols={source_code:find(['source account code','account code','legacy code']),source_name:find(['source account name','account name']),routing:find(['erp routing code','routing code']),tb_code:find(['erp tb item code','tb item code','erp account code'])};
 if(Object.values(cols).some(x=>!x))fail(400,'Use the opening TB template headings: Source account code, Source account name, ERP routing code and ERP TB item code.');
 const accounts=await tx`select code,name,category_code,route from erp_private.account_catalog where status='Active' and not is_legacy order by code`;
 const existing=await tx`select mapping_id,source_account_code,source_account_name,erp_account_code,effective_from,effective_to,status,revision from erp_private.client_account_mappings where client_id=${cid} and status in ('Draft','Active') order by mapping_id`;
 const groups=new Map<string,any>();let blankRows=0;
 for(let row=2;row<=sheet.rowCount;row++){
  const values=Object.fromEntries(Object.entries(cols).map(([key,col])=>[key,workbookCell(sheet,row,Number(col))]));
  if(Object.values(values).every((x:any)=>!x.formula&&!String(x.value??'').trim()))continue;
  const issue:string[]=[];
  if(Object.values(values).some((x:any)=>x.formula))issue.push('Mapping columns must contain values, not formulas.');
  const code=String((values as any).source_code.value??'').trim(),name=String((values as any).source_name.value??'').trim(),routing=String((values as any).routing.value??'').trim().toUpperCase(),target=String((values as any).tb_code.value??'').trim();
  if(/^(total|subtotal|grand total|net total|balance check|difference in books)\b/i.test(code)||/^(total|subtotal|grand total|net total|balance check|difference in books)\b/i.test(name))continue;
  if(!code)issue.push('Source account code is missing.');
  if(!name)issue.push('Source account name is missing.');
  if(!routing)issue.push('ERP routing code is missing.');
  if(!/^\d{5}$/.test(target))issue.push('ERP TB item code must be a five-digit account code.');
  const account=accounts.find((x:any)=>x.code===target);
  if(target&&!account)issue.push(`ERP TB item code ${target} is not an active ERP account.`);
  if(account&&routing!==String(account.category_code||'').toUpperCase())issue.push(`Routing code ${routing} does not match account ${target} (${account.category_code}).`);
  if(!code&&!name){blankRows++;continue;}
  const key=code.toLowerCase();
  const item={source_row:row,source_rows:[row],source_account_code:code,source_account_name:name,routing_code:routing,erp_account_code:target,erp_account_name:account?.name||'',category_code:account?.category_code||'',issue:issue.join(' '),state:issue.length?'Exception':'Ready',ready:!issue.length};
  if(!groups.has(key)){groups.set(key,item);continue;}
  const prior=groups.get(key);
  if(prior.erp_account_code===target&&prior.source_account_name.toLowerCase()===name.toLowerCase()&&!prior.issue&&!issue.length){prior.source_rows.push(row);continue;}
  prior.ready=false;prior.state='Exception';prior.issue='This source account code appears more than once with different account details or mapping codes.';
  prior.conflicting_rows=[...(prior.conflicting_rows||prior.source_rows),row];
 }
 const proposals=[...groups.values()].map((item:any)=>{
  if(!item.ready)return item;
  const overlaps=existing.filter((m:any)=>String(m.source_account_code||'').trim().toLowerCase()===item.source_account_code.toLowerCase()&&(!m.effective_to||String(m.effective_to).slice(0,10)>=from));
  if(overlaps.length){const different=overlaps.some((m:any)=>m.erp_account_code!==item.erp_account_code),active=overlaps.some((m:any)=>m.status==='Active');item.ready=false;item.state=different?'Date conflict':active?'Already mapped':'Awaiting review';item.issue=different?'A saved mapping for this source account overlaps the selected date range but points to a different ERP account. Review the dated setup.':active?'This account is already mapped for the selected start date.':'A draft mapping already exists for this account and start date.';}
  return item;
 });
 const fingerprint=await digest({document_sha256:doc.sha256,sheet:sheet.name,effective_from:from,headers,proposals,existing:existing.map((m:any)=>[m.mapping_id,m.revision,m.status,m.effective_from,m.effective_to,m.erp_account_code])});
 return {needs_sheet:false,document_id:doc.document_id,file_name:doc.file_name,sheet_name:sheet.name,effective_from:from,client_name:client.company_name,proposals,ready_count:proposals.filter((x:any)=>x.ready).length,exception_count:proposals.filter((x:any)=>!x.ready).length,blank_rows:blankRows,preview_fingerprint:fingerprint};
}
async function project(tx:any,id:any){return one(await tx`select * from erp_private.projects where project_id=${uuid(id)} and deleted_at is null`);}
async function evidence(tx:any,id:any,pid:string){return one(await tx`select document_id from erp_private.documents where document_id=${uuid(id)} and project_id=${pid} and deleted_at is null`);}
async function stockSource(tx:any,c:any){
 const rows=await tx`select r.row_id,r.revision,r.account_code,r.normalized,r.review_details,r.route,v.decision,v.source_revision,v.deductible_percentage from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id) where r.project_id=${c.project_id} and b.archived_at is null and b.period_start>=${asDay(c.starts_on)} and b.period_end<=${asDay(c.ends_on)} and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') order by r.row_id limit 10001`;
 if(rows.length>10000)fail(400,'Use a stock period with at most 10,000 source rows.');
 const selected=rows.filter((r:any)=>r.review_details?.activity_id===c.activity_id&&r.review_details?.stock_class===c.stock_class&&r.route===1);
 const cost=(r:any)=>money(Number(r.normalized.amount||0)+(r.decision==='Eligible'?Number(r.normalized.vat||0)*(1-Number(r.deductible_percentage||0)/100):r.decision==='Excluded'?Number(r.normalized.vat||0):0));
 const landed=(r:any)=>['50030','50040','50050'].includes(r.account_code);
 return {rows,fingerprint:await digest(rows),selected_count:selected.length,resale_purchases:money(selected.filter((r:any)=>!landed(r)).reduce((s:number,r:any)=>s+cost(r),0)),landed_costs:money(selected.filter(landed).reduce((s:number,r:any)=>s+cost(r),0)),unreviewed:selected.filter((r:any)=>r.source_revision!==r.revision||!['Eligible','Excluded'].includes(r.decision)).length,unallocated:rows.filter((r:any)=>!r.account_code||r.route===1&&(!r.review_details?.activity_id||!r.review_details?.stock_class)).length};
}
export async function improvementAction(tx:any,a:any,p:any,storage?:any){
 if(!String(p.action).startsWith('v3_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Client configuration and working-paper controls are unavailable to Interns.');
 if(p.action==='v3_client_mapping_readiness'){
  leader(a);
  return await tx`select c.client_id,
   (select count(*)::int from erp_private.client_activities x where x.client_id=c.client_id) as activity_count,
   (select count(*)::int from erp_private.stock_policy_versions x where x.client_id=c.client_id) as stock_method_count,
   (select count(*)::int from erp_private.stock_categories x where x.client_id=c.client_id) as category_count,
   (select count(*)::int from erp_private.client_account_mappings x where x.client_id=c.client_id and x.status='Active') as approved_account_count,
   (select count(*)::int from erp_private.client_account_mappings x where x.client_id=c.client_id and x.status='Draft') as pending_account_count
   from erp_private.clients c where c.deleted_at is null order by c.company_name limit 1000`;
 }
 if(p.action==='v3_client_read'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null`);
  return {client:c,activities:await tx`select * from erp_private.client_activities where client_id=${c.client_id} order by effective_from desc`,partners:await tx`select * from erp_private.partner_interests where client_id=${c.client_id} order by effective_from desc,partner_name`,periods:await tx`select * from erp_private.client_periods where client_id=${c.client_id} order by ends_on desc`,policies:await tx`select * from erp_private.stock_policy_versions where client_id=${c.client_id} order by effective_from desc`,stock_policy_block_dates:await tx`select s.activity_id,max(s.ends_on)::text as last_control_end from erp_private.stock_controls s join erp_private.projects p using(project_id) where p.client_id=${c.client_id} and s.status in ('Submitted','Approved') group by s.activity_id`,stock_categories:await tx`select * from erp_private.stock_categories where client_id=${c.client_id} order by activity_id,inventory_use,stock_class`,account_mappings:await tx`select m.*,a.name as erp_account_name,a.route,a.category_code,a.statement from erp_private.client_account_mappings m join erp_private.account_catalog a on a.code=m.erp_account_code where m.client_id=${c.client_id} order by m.status,m.source_account_name,m.effective_from desc`};
 }
 if(p.action==='v3_client_accounts_read'){
  leader(a);const cid=uuid(p.client_id),client=one(await tx`select client_id,company_name,year_end_month,year_end_day from erp_private.clients where client_id=${cid} and deleted_at is null`);
  return {client,accounts:await tx`select code,name,account_group,route,category_code,statement,tax_note from erp_private.account_catalog where status='Active' and not is_legacy order by code`,mappings:await tx`select m.*,a.name as erp_account_name,a.account_group,a.route,a.category_code,a.statement,a.tax_note from erp_private.client_account_mappings m join erp_private.account_catalog a on a.code=m.erp_account_code where m.client_id=${cid} order by case m.status when 'Draft' then 0 when 'Active' then 1 else 2 end,m.source_account_name,m.effective_from desc`,opening_sources:await tx`select document_id,file_name,handling_firm_id,uploaded_at,sha256 from erp_private.documents where client_id=${cid} and project_id is null and category='Import Sources' and import_purpose='Opening TB' and archived_at is null and deleted_at is null order by uploaded_at desc`};
 }
 if(p.action==='v3_client_account_mapping_tb_preview'){
  leader(a);return await openingTBMappingPreview(tx,a,p,storage);
 }
 if(p.action==='v3_client_account_mapping_tb_save'){
  leader(a);const cid=uuid(p.client_id),items=Array.isArray(p.source_rows)?p.source_rows:[],selected=[...new Set(items.map((x:any)=>Number(x)))];
  if(!selected.length||selected.length>2000||selected.some((x:number)=>!Number.isInteger(x)||x<2||x>2001))fail(400,'Select one or more valid opening TB account rows.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-accounts'},0))`;
  const preview=await openingTBMappingPreview(tx,a,p,storage);
  if(preview.needs_sheet)fail(400,'Choose the opening TB worksheet and preview again.');
  if(preview.preview_fingerprint!==text(p.preview_fingerprint,100))fail(409,'The TB or client mappings changed after preview. Refresh the preview before saving.');
  const chosen=preview.proposals.filter((x:any)=>selected.includes(x.source_row));
  if(chosen.length!==selected.length||chosen.some((x:any)=>!x.ready))fail(400,'Only valid, unmapped TB rows can be saved as drafts. Review the exceptions and select valid rows.');
  // Locking serializes changes for this client. Check every selected account
  // in one query, then insert the full batch in one statement instead of
  // issuing a round trip per TB row.
  const chosenJson=tx.json(chosen.map((item:any)=>({source_account_code:item.source_account_code,source_account_name:item.source_account_name,erp_account_code:item.erp_account_code})));
  const overlaps=await tx`select m.mapping_id from jsonb_to_recordset(${chosenJson}::jsonb) x(source_account_code text,source_account_name text,erp_account_code text)
   join erp_private.client_account_mappings m on m.client_id=${cid} and m.status in ('Draft','Active')
    and (m.effective_to is null or m.effective_to>=${preview.effective_from})
    and ((nullif(trim(x.source_account_code),'') is not null and m.source_account_code=x.source_account_code)
      or (nullif(trim(x.source_account_code),'') is null and m.source_account_code is null and lower(trim(m.source_account_name))=lower(trim(x.source_account_name))))
   limit 1`;
  if(overlaps.length)fail(409,'One of these source accounts was mapped after preview. Refresh the suggestions and try again.');
  const inserted=await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,effective_to,status,created_by)
   select ${cid},x.source_account_code,x.source_account_name,x.erp_account_code,${preview.effective_from},null,'Draft',${a.staff_id}
   from jsonb_to_recordset(${chosenJson}::jsonb) x(source_account_code text,source_account_name text,erp_account_code text)
   returning mapping_id`;
  return {ok:true,draft_count:inserted.length};
 }
 if(p.action==='v3_client_account_mapping_add'){
  leader(a);const cid=uuid(p.client_id),sourceCode=text(p.source_account_code||'',100,false)||null,sourceName=text(p.source_account_name,160),target=text(p.erp_account_code,5),from=date(p.effective_from),to=p.effective_to?date(p.effective_to):null;
  if(!sourceName||!from||to&&to<from)fail(400,'Enter a source account name and a valid effective date range.');
  one(await tx`select client_id from erp_private.clients where client_id=${cid} and deleted_at is null`);
  const account=one(await tx`select code from erp_private.account_catalog where code=${target} and status='Active' and not is_legacy`);
  await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-accounts'},0))`;
  if((await tx`select mapping_id from erp_private.client_account_mappings where client_id=${cid} and coalesce(source_account_code,'')=coalesce(${sourceCode},'') and status in ('Draft','Active') and effective_from<=coalesce(${to},'infinity'::date) and coalesce(effective_to,'infinity'::date)>=${from} limit 1`).length)fail(409,'A saved account setup already covers this source code and date. Choose a non-overlapping range or review the existing setup.');
  return one(await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,effective_to,status,created_by) values(${cid},${sourceCode},${sourceName},${account.code},${from},${to},'Draft',${a.staff_id}) returning mapping_id`);
 }
 if(p.action==='v3_client_account_mapping_approve'){
  leader(a);const row=one(await tx`select * from erp_private.client_account_mappings where mapping_id=${uuid(p.mapping_id)} for update`);fresh(row,p);
  if(row.status!=='Draft')fail(409,'Only a pending client account setup can be approved.');
  if(row.created_by===a.staff_id)fail(403,'A different Manager or Partner must approve this setup.');
  await tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where mapping_id=${row.mapping_id}`;
  return {ok:true};
 }
 if(p.action==='v3_client_account_mapping_approve_batch'){
  leader(a);const cid=uuid(p.client_id),items=Array.isArray(p.items)?p.items:[];
  if(!items.length||items.length>2000)fail(400,'Select between 1 and 2,000 pending mappings to approve.');
  const expected=new Map(items.map((x:any)=>[uuid(x.mapping_id),revision(x.revision)]));
  if(expected.size!==items.length)fail(400,'A mapping was selected more than once. Refresh and try again.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-accounts'},0))`;
  const rows=await tx`select * from erp_private.client_account_mappings where client_id=${cid} and mapping_id=any(${tx.array([...expected.keys()])}::uuid[]) order by mapping_id for update`;
  if(rows.length!==expected.size)fail(409,'One or more selected mappings are no longer available. Refresh the list.');
  for(const row of rows){
   fresh(row,{revision:expected.get(row.mapping_id)});
   if(row.status!=='Draft')fail(409,`${row.source_account_name} is no longer a pending mapping. Refresh the list.`);
   if(row.created_by===a.staff_id)fail(403,'A different Manager or Partner must approve every selected mapping. Remove your own drafts and try again.');
  }
  for(const row of rows)await tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where mapping_id=${row.mapping_id}`;
  return {ok:true,approved_count:rows.length};
 }
 if(p.action==='v3_client_account_mapping_end'){
  leader(a);const row=one(await tx`select * from erp_private.client_account_mappings where mapping_id=${uuid(p.mapping_id)} for update`);fresh(row,p);
  const to=date(p.effective_to);
  if(row.status!=='Active'||row.effective_to&&to>=asDay(row.effective_to)||to<asDay(row.effective_from))fail(400,'Choose an earlier valid end date for this active mapping.');
  await tx`update erp_private.client_account_mappings set effective_to=${to} where mapping_id=${row.mapping_id}`;
  return {ok:true};
 }
 if(p.action==='v3_identity_save'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${uuid(p.client_id)} and deleted_at is null for update`);fresh(c,p);const v=entityI…11147 tokens truncated…,${start},${end},${c.legal_entity_type},${c.entity_evidence},${a.staff_id}) returning period_id`);
 }
 const l=await period(tx,uuid(p.period_id),pid);
 if(p.action==='ledger_read')return {...await report(tx,l,p.as_of?date(p.as_of):day(l.ends_on)),rates};
 if(p.action==='ledger_account_read'){
  const code=text(p.account_code,5),to=p.as_of?date(p.as_of):day(l.ends_on);if(to<day(l.starts_on)||to>day(l.ends_on))fail(400,'Choose an as-of date inside this financial year.');return {lines:await tx`select x.*,j.reference,j.kind,j.journal_date,j.status,j.reviewed_by from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) where j.period_id=${l.period_id} and x.account_code=${code} and j.status='Posted' and j.journal_date<=${to} order by j.journal_date,j.reference,x.line_no limit 2001`};
 }
 if(p.action==='ledger_journal_read'){
  const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id}`),items=await lines(tx,j.journal_id);
  return {journal:j,lines:items,accounts:await catalogue(tx),issues:journalIssues(items,await catalogue(tx),{kind:j.kind,entityType:l.entity_type,sourceSnapshot:j.source_snapshot})};
 }
 if(p.action==='ledger_asset_read'){const asset=one(await tx`select * from erp_private.ledger_assets where asset_id=${uuid(p.asset_id)} and period_id=${l.period_id}`);return {asset,rate:asset.rate_snapshot,calculation:assetCalculation(asset,asset.rate_snapshot,l.starts_on,l.ends_on)};}
 if(l.status!=='Open')fail(400,'This client year is closed. Its posted snapshot remains available.');
 if(project.status==='Archived')fail(400,'Archived projects cannot change client working papers.');
 if(p.action==='ledger_journal_save'){
  const accounts=await catalogue(tx),kind=choice(p.kind,['Opening','Payroll','Adjustment','Stock']),items=normaliseLines(p.lines,accounts,{allowUnmapped:true,opening:kind==='Opening',payroll:kind==='Payroll'});
  if(kind==='Opening')for(const line of items.filter((x:any)=>x.account_code))if(!await clientAccountAllowed(tx,project.client_id,line.account_code,day(l.starts_on)))fail(400,`ERP account ${line.account_code} is not approved for this client’s opening balance date. Set it up under Clients → Client accounts first.`);
  if(p.journal_id){const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);edit(j,a);if(j.generated||j.kind!==kind)fail(400,'Generated source entries must be refreshed or reversed, not manually overwritten.');
   await writeLines(tx,j,items);await tx`update erp_private.ledger_journals set journal_date=${date(p.journal_date)},reference=${text(p.reference,100)},description=${text(p.description||'',2000,false)},evidence=${text(p.evidence||'',5000,false)},last_prepared_by=${a.staff_id},status='Draft' where journal_id=${j.journal_id}`;return {journal_id:j.journal_id};
  }return await newJournal(tx,a,l,kind,p,items);
 }
 if(p.action==='ledger_period_import_create'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':period-import'},0))`;
  const source=one(await tx`select * from erp_private.period_imports where import_id=${uuid(p.import_id)} and project_id=${pid}`);
  if(source.status!=='Confirmed'||day(source.starts_on)<day(l.starts_on)||day(source.ends_on)>day(l.ends_on))fail(400,'Choose an independently confirmed import within this financial year.');
  const used=(await tx`select journal_id from erp_private.ledger_sources where source_kind='Period import' and source_key=${source.import_id}`)[0];if(used)return {...used,reused:true};
  let items:any[]=[];
  if(source.kind==='Sales'){
   const codes:any={'16%':'40000','8%':'40010','0%':'40020',Exempt:'40030'};
   const signed=(code:string,value:number,description:string)=>({account_code:code,debit:Math.max(value,0)/100,credit:Math.max(-value,0)/100,source_status:'Confirmed',source_reference:source.import_id,description});
   for(const g of source.payload.groups){const net=cashAmount(g.net),vat=cashAmount(g.vat);if(net||vat)items.push(signed('10060',net+vat,'Sales summary '+g.vat_category),signed(codes[g.vat_category],-net,'Net sales '+g.vat_category),...(vat?[signed('21020',-vat,'Output VAT '+g.vat_category)]:[]));}
  }else{const t=source.payload.totals;items=payrollJournal({gross_pay:t.gross,paye:t.paye,shif:t.shif,employee_ahl:t.employee_ahl,employee_nssf:t.employee_nssf,employee_pension:t.employee_pension,other_deductions:t.other_deductions,employer_ahl:t.employer_ahl,employer_nssf:t.employer_nssf,employer_nita:t.nita,evidence:source.import_id});}
  if(!items.length)fail(400,'A zero summary needs no accounting entry.');
  const result=await newJournal(tx,a,l,source.kind,{journal_date:day(source.ends_on),reference:source.kind.toUpperCase()+'-'+day(source.starts_on)+'-'+source.import_id.slice(0,8),evidence:'Confirmed import '+source.import_id+'; '+source.review_note,description:'Reviewed '+source.kind.toLowerCase()+' category/control totals'},items,{kind:'Period import',import_id:source.import_id,source_hash:source.source_hash},true);
  await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id,source_revision) values('Period import',${source.import_id},${result.journal_id},${pid},${source.revision})`;return result;
 }
 if(p.action==='ledger_generate_sources')return await generateSource(tx,a,l,p);
 if(p.action==='ledger_payroll_create'){
  const items=payrollJournal(p),snapshot={kind:'Payroll control',inputs:{...p,action:undefined}};
  if(p.journal_id){const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);edit(j,a);if(j.kind!=='Payroll'||j.source_snapshot.kind!=='Payroll control')fail(400,'Edit a draft payroll control entry.');await writeLines(tx,j,items);await tx`update erp_private.ledger_journals set reference=${text(p.reference,100)},journal_date=${date(p.journal_date)},evidence=${text(p.evidence,5000)},source_snapshot=${tx.json(snapshot)},last_prepared_by=${a.staff_id},status='Draft' where journal_id=${j.journal_id}`;return {journal_id:j.journal_id};}
  return await newJournal(tx,a,l,'Payroll',p,items,snapshot,true);
 }
 if(p.action==='ledger_journal_metadata'){
  const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);edit(j,a);const at=date(p.journal_date);if(j.kind==='Depreciation'&&at!==day(j.journal_date))fail(400,'The depreciation date follows its reserved calculation period.');
  await tx`update erp_private.ledger_journals set reference=${text(p.reference,100)},journal_date=${at},description=${text(p.description||'',2000,false)},evidence=${text(p.evidence,5000)},last_prepared_by=${a.staff_id},status='Draft' where journal_id=${j.journal_id}`;return {journal_id:j.journal_id};
 }
 if(p.action==='ledger_journal_refresh'){
  const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);edit(j,a);
  if(j.source_snapshot.kind!=='Workbook')fail(400,'Only a generated workbook journal can refresh its sources.');
  const rows=await reviewedRows(tx,pid,j.source_snapshot.rows.map((r:any)=>r.row_id)),items=rows.flatMap((r:any)=>j.kind==='Sales'?salesLines(r):costJournal(r));
  await writeLines(tx,j,items);await tx`update erp_private.ledger_journals set source_snapshot=${tx.json({kind:'Workbook',rows:rows.map(sourceShape),digest:await digest(rows.map(sourceShape))})},last_prepared_by=${a.staff_id},status='Draft' where journal_id=${j.journal_id}`;return {journal_id:j.journal_id};
 }
 if(['ledger_journal_submit','ledger_journal_review'].includes(p.action)){
  const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);
  if(p.action==='ledger_journal_submit'){edit(j,a);const currentLines=await lines(tx,j.journal_id),issues=journalIssues(currentLines,await catalogue(tx),{kind:j.kind,entityType:l.entity_type,sourceSnapshot:j.source_snapshot});if(j.kind==='Opening')for(const line of currentLines.filter((x:any)=>x.account_code))if(!await clientAccountAllowed(tx,project.client_id,line.account_code,day(l.starts_on)))issues.push(`Line ${line.line_no}: ERP account ${line.account_code} is not approved for this client’s opening balance date.`);if(issues.length)fail(400,issues.join(' '));await sourceCheck(tx,j);await tx`update erp_private.ledger_journals set status='Submitted',last_prepared_by=${a.staff_id} where journal_id=${j.journal_id}`;}
  else{leader(a);if(j.status!=='Submitted'||[j.prepared_by,j.last_prepared_by].includes(a.staff_id))fail(403,'A different Manager or Partner must review the submitted journal.');const status=choice(p.status,['Posted','Returned']);if(status==='Posted')await sourceCheck(tx,j);await tx`update erp_private.ledger_journals set status=${status},reviewed_by=${a.staff_id},review_note=${text(p.review_note,5000)} where journal_id=${j.journal_id}`;}
  return {ok:true,journal_id:j.journal_id};
 }
 if(p.action==='ledger_reverse'){
  leader(a);const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id}`);if(j.status!=='Posted'||j.kind==='Opening'||j.kind==='Reversal')fail(400,'Choose a posted movement journal. Opening corrections use an evidenced adjustment.');
  const original=await lines(tx,j.journal_id);return await newJournal(tx,a,l,'Reversal',{...p,reversal_of:j.journal_id},original.map((r:any)=>({...r,debit:r.credit,credit:r.debit,source_reference:j.reference})),{kind:'Reversal',original_journal_id:j.journal_id},true);
 }
 if(p.action==='ledger_asset_save'){
  const rate=one(rates.filter((r:any)=>r.rate_id===uuid(p.rate_id))),assetAccount=one((await catalogue(tx)).filter((x:any)=>x.code===String(p.asset_account)&&x.route===3&&x.status==='Active'&&!x.is_legacy));
  if(!assetClassAllowed(assetAccount.code,rate.class_code))fail(400,'Select the shared-rate class matching this asset account. Special assets require a supported separate adjustment.');
  const accountRate={...rate,expense_account:assetAccount.code==='15008'?'67060':rate.expense_account,contra_account:assetAccount.code==='15008'?'15970':rate.contra_account};
  let cost=amount(p.cost,'capitalised cost'),source=p.source_row_id?one(await reviewedRows(tx,pid,[uuid(p.source_row_id)])):null;
  if(source){costJournal(source);if(source.route!==3||source.account_code!==assetAccount.code)fail(400,'Map this purchase to the same PPE class account first.');const entry=costJournal(source)[0];cost=Number(entry.debit)-Number(entry.credit);if(cost<0)fail(400,'Asset credits and disposals need a controlled adjustment, not a new asset.');}
  const values={asset_name:text(p.asset_name,200),asset_account:assetAccount.code,first_use_date:source?.first_use_date?day(source.first_use_date):date(p.first_use_date),cost,business_percentage:num(p.business_percentage,0,100),noncommercial_vehicle:p.noncommercial_vehicle===true||p.noncommercial_vehicle==='true',opening_book_value:amount(p.opening_book_value,'opening carrying amount',true),opening_tax_value:amount(p.opening_tax_value,'opening tax value',true),complex_case:p.complex_case===true||p.complex_case==='true'};
  if(!values.first_use_date)fail(400,'Confirm the date first brought into use.');const calculation=assetCalculation(values,accountRate,l.starts_on,l.ends_on),evidence=text(p.evidence,5000);
  if(p.asset_id){const r=one(await tx`select * from erp_private.ledger_assets where asset_id=${uuid(p.asset_id)} and period_id=${l.period_id} for update`);rev(r,p);edit(r,a);if(r.source_row_id!==(source?.row_id||null))fail(400,'An asset source cannot be reassigned.');await tx`update erp_private.ledger_assets set asset_name=${values.asset_name},asset_account=${values.asset_account},first_use_date=${values.first_use_date},cost=${cost},business_percentage=${values.business_percentage},noncommercial_vehicle=${values.noncommercial_vehicle},opening_book_value=${values.opening_book_value},opening_tax_value=${values.opening_tax_value},complex_case=${values.complex_case},rate_id=${rate.rate_id},rate_snapshot=${tx.json(accountRate)},evidence=${evidence},last_prepared_by=${a.staff_id},status='Draft' where asset_id=${r.asset_id}`;return {asset_id:r.asset_id,calculation};}
  const result=one(await tx`insert into erp_private.ledger_assets(period_id,project_id,source_row_id,asset_name,asset_account,first_use_date,cost,business_percentage,noncommercial_vehicle,opening_book_value,opening_tax_value,complex_case,rate_id,rate_snapshot,evidence,prepared_by,last_prepared_by) values(${l.period_id},${pid},${source?.row_id||null},${values.asset_name},${values.asset_account},${values.first_use_date},${cost},${values.business_percentage},${values.noncommercial_vehicle},${values.opening_book_value},${values.opening_tax_value},${values.complex_case},${rate.rate_id},${tx.json(accountRate)},${evidence},${a.staff_id},${a.staff_id}) returning asset_id`);return {...result,calculation};
 }
 if(['ledger_asset_submit','ledger_asset_review','ledger_asset_read'].includes(p.action)){
  const asset=one(await tx`select * from erp_private.ledger_assets where asset_id=${uuid(p.asset_id)} and period_id=${l.period_id} for update`),rate=asset.rate_snapshot,result=assetCalculation(asset,rate,l.starts_on,l.ends_on);
  if(p.action==='ledger_asset_read')return {asset,rate,calculation:result};rev(asset,p);
  if(p.action==='ledger_asset_submit'){edit(asset,a);if(result.issues.length)fail(400,result.issues.join(' '));await tx`update erp_private.ledger_assets set status='Submitted',last_prepared_by=${a.staff_id} where asset_id=${asset.asset_id}`;}
  else{leader(a);if(asset.status!=='Submitted'||[asset.prepared_by,asset.last_prepared_by].includes(a.staff_id))fail(403,'A different Manager or Partner must review this asset.');const status=choice(p.status,['Approved','Returned']);if(status==='Approved'&&result.issues.length)fail(400,result.issues.join(' '));await tx`update erp_private.ledger_assets set status=${status},reviewed_by=${a.staff_id},review_note=${text(p.review_note,5000)} where asset_id=${asset.asset_id}`;}
  return {ok:true};
 }
 if(p.action==='ledger_depreciation_create'){
  const asset=one(await tx`select * from erp_private.ledger_assets where asset_id=${uuid(p.asset_id)} and period_id=${l.period_id}`);if(asset.status!=='Approved')fail(400,'Obtain independent asset and class-rate approval first.');const start=date(p.starts_on),end=date(p.ends_on);if(start<day(l.starts_on)||end>day(l.ends_on)||end<start)fail(400,'Choose charge dates within the financial year.');
  const result=periodAssetCharge(assetCalculation(asset,asset.rate_snapshot,l.starts_on,l.ends_on),asset,l.starts_on,l.ends_on,start,end);if(result.issues.length||result.book_period==null||result.tax_period_projection==null)fail(400,result.issues.join(' ')||'Complete the asset calculation.');
  if(!result.book_period)fail(400,'No book depreciation arises for these dates.');
  const posted=await tx`select c.*,j.status from erp_private.ledger_asset_charges c join erp_private.ledger_journals j using(journal_id) where c.asset_id=${asset.asset_id} order by c.starts_on`;
  if(posted.some((x:any)=>day(x.starts_on)<=end&&day(x.ends_on)>=start))fail(409,'A depreciation charge already covers these dates. Open the existing journal.');
  const remaining=money(Number(result.book_annual)-posted.reduce((sum:number,x:any)=>sum+Number(x.book_charge),0)),charge=money(Math.min(result.book_period,remaining));if(charge<=0)fail(400,'The annual book charge has already been allocated.');
  const j=await newJournal(tx,a,l,'Depreciation',{...p,journal_date:end},[{account_code:asset.rate_snapshot.expense_account,debit:charge,credit:0,source_status:'Confirmed',source_reference:asset.asset_id},{account_code:asset.rate_snapshot.contra_account,debit:0,credit:charge,source_status:'Confirmed',source_reference:asset.asset_id}],{kind:'Depreciation',asset,calculation:result},true);
  await tx`insert into erp_private.ledger_asset_charges(asset_id,journal_id,project_id,starts_on,ends_on,snapshot,book_charge,tax_projection) values(${asset.asset_id},${j.journal_id},${pid},${start},${end},${tx.json({asset,rate:asset.rate_snapshot,result})},${charge},${result.tax_period_projection})`;return j;
 }
 if(['ledger_import_preview','ledger_import_commit'].includes(p.action)){
  const requestedKind=String(p.kind||''),documentId=uuid(p.document_id);
  const doc=one(await tx`select * from erp_private.documents where document_id=${documentId} and deleted_at is null and archived_at is null
   and (project_id=${pid} or (${requestedKind==='Opening'} and project_id is null and client_id=${project.client_id} and handling_firm_id=${project.handling_firm_id} and category='Import Sources' and import_purpose='Opening TB')) for share`);
  if(doc.mime_type!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Choose an XLSX opening TB or payroll source.');
  const fetched=await storage.download(doc.object_key);if(fetched.error||!fetched.data)fail(404,'Source workbook unavailable.');await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${doc.document_id},${a.auth_user_id},'DOWNLOAD')`;const bytes=new Uint8Array(await fetched.data.arrayBuffer());checkWorkbookZip(bytes);const {sheet,sheets}=await readWorkbookSheet(bytes,p.sheet_name?text(p.sheet_name,100):null);
  const header=Math.trunc(Number(p.header_row)||1);if(header<1||header>200||header>sheet.rowCount)fail(400,'Select the header row.');
  const get=(r:number,c:number)=>{const value=sheet.getRow(r).getCell(c).value;return value&&typeof value==='object'&&!(value instanceof Date)&&'result' in value?value.result:value;};
  const headers=Array.from({length:sheet.columnCount},(_,i)=>String(get(header,i+1)||''));
  if(p.action==='ledger_import_preview')return {sheets,sheet_name:sheet.name,header_row:header,headers,preview:Array.from({length:Math.min(8,sheet.rowCount-header)},(_,i)=>({source_row:header+i+1,values:headers.map((_:any,c:number)=>get(header+i+1,c+1))}))};
  const kind=choice(p.kind,['Opening','Payroll']),map=p.column_map||{},col=(key:string)=>{const n=Number(map[key]);if(!Number.isInteger(n)||n<1||n>sheet.columnCount)return null;return n;},openingConfirmed=p.confirm_opening_source===true||p.confirm_opening_source==='true',sourceEvidence=String(p.evidence||'').trim();
  if(kind==='Opening')await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':opening-balance'},0))`;
  if(kind==='Opening'&&!openingConfirmed)fail(400,'Confirm the approved prior-year trial balance before importing opening balances.');
  if(kind==='Opening'&&sourceEvidence.length<3)fail(400,'Enter the source workbook and approval reference once for this opening-balance upload.');
  if(!col('source_name')||!col('debit')||!col('credit'))fail(400,'Map account name, debit and credit columns.');
  const accounts=await catalogue(tx),items:any[]=[],sourceRows:any[]=[],sourceControls:any[]=[],clientMappings=kind==='Opening'?await tx`select mapping_id,source_account_code,source_account_name,erp_account_code,effective_from,effective_to from erp_private.client_account_mappings where client_id=${project.client_id} and status='Active' and effective_from<=${day(l.starts_on)} and (effective_to is null or effective_to>=${day(l.starts_on)})`:[];
  for(let r=header+1;r<=sheet.rowCount;r++){
   const read=(k:string)=>col(k)?get(r,col(k)!):null,name=String(read('source_name')||'').trim(),legacy=String(read('legacy_code')||'').trim();
   if(!name&&!legacy)continue;
   if(/^difference in books$/i.test(name)){const d=amount(read('debit')??0,'debit at source row '+r),c=amount(read('credit')??0,'credit at source row '+r);sourceControls.push({type:'difference_in_books',source_row:r,difference_kes:Number(d)-Number(c)});continue;}
   if(/^(total|subtotal|grand total|net total|balance check)\b/i.test(name)||/^(total|subtotal|grand total|net total|balance check)\b/i.test(legacy))continue;
   if(items.length>=2000)fail(400,'Split imports into at most 2,000 nonblank source rows.');
   const debit=amount(read('debit')??0,'debit at source row '+r),credit=amount(read('credit')??0,'credit at source row '+r);if(!Number(debit)&&!Number(credit))continue;
   const net=Number(debit)-Number(credit),negative=Number(debit)<0||Number(credit)<0,explicitCode=String(read('tb_item_code')||'').trim(),legacyCode=String(read('account_code')||'').trim(),sourceCode=kind==='Opening'?legacy:legacyCode;
   if(kind!=='Opening'&&explicitCode&&legacyCode&&explicitCode!==legacyCode)fail(400,`Source row ${r}: ERP TB item code and master account code do not match.`);
   const sourceMatches=kind==='Opening'?openingTbMappingMatches(clientMappings,sourceCode,name):[],sourceMapping=sourceMatches.length===1?sourceMatches[0]:null;
   if(sourceMatches.length>1)fail(400,`Source row ${r}: more than one approved client account mapping matches this source. Ask a Manager to resolve the duplicate client setup.`);
   if(sourceMapping&&explicitCode&&sourceMapping.erp_account_code!==explicitCode)fail(400,`Source row ${r}: ERP TB item code ${explicitCode} differs from the approved client mapping ${sourceMapping.erp_account_code}.`);
   const targetCode=kind==='Opening'?sourceMapping?.erp_account_code||'':explicitCode||legacyCode,account=accounts.find(x=>x.code===targetCode),suppliedRouting=String(read('routing_code')||'').trim().toUpperCase();
   if(suppliedRouting&&account&&suppliedRouting!==String(account.category_code||'').toUpperCase())fail(400,`Source row ${r}: routing code does not match ERP TB item code ${targetCode}.`);
   const mappingIssue=kind==='Opening'&&!sourceMapping?'No approved client account mapping matches this source code/name for the financial-year start.':'';
   items.push({account_code:targetCode||null,legacy_code:sourceCode||legacy,source_name:name,debit:Math.max(net,0),credit:Math.max(-net,0),source_status:kind==='Opening'?(!negative&&openingConfirmed?'Confirmed':'Unverified'):!negative&&read('source_status')==='Confirmed'?'Confirmed':'Unverified',source_reference:kind==='Opening'?`${doc.file_name} | ${sheet.name} | row ${r}`:String(read('source_reference')||doc.file_name),description:'Excel row '+r+(negative?' - sign presentation normalised; confirm original source':'' )});
   sourceRows.push({source_row:r,original_debit:debit,original_credit:credit,source_name:name,legacy_code:sourceCode||legacy,source_tb_item_code:explicitCode,tb_item_code:targetCode||'',routing_code:suppliedRouting||String(account?.category_code||''),account_code:targetCode||'',client_mapping_id:sourceMapping?.mapping_id||null,mapping_issue:mappingIssue});
  }
  const key=await digest({document:doc.sha256,sheet:sheet.name,header,kind,period:l.period_id}),existing=(await tx`select journal_id from erp_private.ledger_sources where source_kind=${kind+' workbook'} and source_key=${key}`)[0];if(existing)return {...existing,reused:true,imported_count:0,duplicate_count:items.length};
  if(kind==='Opening'&&(await tx`select journal_id from erp_private.ledger_journals where period_id=${l.period_id} and kind='Opening' limit 1`)[0])fail(409,'An opening balance entry already exists for this financial year. Open it from Entry register. Edit an unposted draft there; posted opening corrections require a reviewed adjustment.');
  if(!items.length)fail(400,'No nonzero account rows were found. Check that you selected the prior-year closing columns, not a comparison or total column.');const parsed=normaliseLines(items,accounts,{allowUnmapped:true,opening:kind==='Opening',payroll:kind==='Payroll'});
  const totals=parsed.reduce((t:any,line:any)=>({debit:t.debit+cashAmount(line.debit),credit:t.credit+cashAmount(line.credit)}),{debit:0,credit:0});
  const j=await newJournal(tx,a,l,kind,p,parsed,{kind:'Excel',document_id:doc.document_id,document_sha256:doc.sha256,sheet_name:sheet.name,header_row:header,column_map:map,source_rows:sourceRows,source_controls:sourceControls,import_totals:{debit_kes:totals.debit/100,credit_kes:totals.credit/100,difference_kes:(totals.debit-totals.credit)/100},...(kind==='Opening'?{source_confirmation:{confirmed:true,confirmed_by:a.staff_id,evidence_reference:sourceEvidence}}:{})});
  await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id) values(${kind+' workbook'},${key},${j.journal_id},${pid})`;return {...j,source_count:items.length,imported_count:items.length,duplicate_count:0,totals:{debit_kes:totals.debit/100,credit_kes:totals.credit/100,difference_kes:(totals.debit-totals.credit)/100},source_controls:sourceControls};
 }
 fail(404,'Unknown client working-paper action.');
}
