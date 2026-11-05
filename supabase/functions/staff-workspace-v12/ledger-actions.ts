import ExcelJS from 'exceljs';
import {requireRightChart} from './legal-structure-actions.ts';
import {pendingPurchases} from './purchase-pending.ts';
import {chartCatalogue,approvedChart,chartMessage,requireChartAccount} from './client-chart.ts';
import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {digest} from './improvement-actions.ts';
import {chosenReviewer,mustBeAskedReviewer,reviewCandidates,notifyReviewers,notifyOutcome} from './review-queue.ts';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {loadCrosswalk,revenueAccount} from './sales-crosswalk.ts';
import {cashAmount,day,normaliseLines,journalIssues,costJournal,trialBalance,profitReport,sourceApplicationSchedule,assetCalculation,periodAssetCharge,staffReviewer,assetClassAllowed,payrollJournal,profitByActivity,isoWeek,DATA_CUTOFF} from './ledger-rules.mjs';
import {debtorsRead,receiptAction} from './debtors.ts';
import {stockRollsRead,stockJournalPlan} from './stock-journal.ts';
import {money} from './accounting-rules.mjs';
import {openingTbMappingMatches} from './opening-tb-mapping.mjs';
import {bankCloseChecks} from './bank-close.mjs';
import {confirmPeriodImport} from './period-import-actions.ts';

const one=(r:any[])=>{if(!r.length)fail(403,'This working paper is not available to your account.');return r[0];};
const leader=(a:any)=>{if(!staffReviewer(a))fail(403,'A Manager or Partner must approve client accounting.');};
const rev=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This working paper changed. Refresh before continuing.');};
const edit=(r:any,a:any)=>{if(!['Draft','Returned'].includes(r.status)||r.prepared_by!==a.staff_id&&!staffReviewer(a))fail(403,'Only the preparer or a Manager may edit an open draft.');};
const amount=(v:any,label:string,nullable=false)=>{if(nullable&&(v===''||v==null))return null;try{return cashAmount(v)/100;}catch{fail(400,'Enter a valid '+label+'.');}};
const num=(v:any,min:number,max:number)=>{if(v===''||v==null||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)fail(400,'Enter a number between '+min+' and '+max+'.');return Number(v);};
const sourceShape=(r:any)=>({row_id:r.row_id,revision:r.revision,dataset:r.dataset,normalized:r.normalized,account_code:r.account_code,route:r.route,review_details:r.review_details,decision:r.decision,source_revision:r.source_revision,deductible_percentage:r.deductible_percentage,income_treatment:r.income_treatment,reviewed_by:r.reviewed_by,vat_rate_key:r.vat_rate_key});
async function catalogue(tx:any){return await tx`select * from erp_private.account_catalog order by code`;}
// A client account mapping is usable while Pending review (Draft). It is reviewed once, at Gate B,
// when a different Manager or Partner approves and posts the journal that uses it.
async function clientAccountAllowed(tx:any,clientId:string,code:string,at:string){
 return (await tx`select mapping_id from erp_private.client_account_mappings where client_id=${clientId} and erp_account_code=${code} and status in ('Active','Draft') and effective_from<=${at} and (effective_to is null or effective_to>=${at}) limit 1`).length>0;
}
async function activateJournalMappings(tx:any,a:any,clientId:string,j:any,l:any,journalLines:any[]){
 const codes=[...new Set(journalLines.map((x:any)=>x.account_code).filter(Boolean).map(String))];
 const ids=[...new Set(((j.source_snapshot||{}).source_rows||[]).map((x:any)=>x.client_mapping_id).filter(Boolean))];
 const from=day(l.starts_on),to=j.kind==='Opening'?from:day(l.ends_on);
 if(!codes.length&&!ids.length)return [];
 const pending=await tx`select mapping_id,created_by,source_account_name,erp_account_code from erp_private.client_account_mappings where client_id=${clientId} and status='Draft'
  and (mapping_id=any(${tx.array(ids)}::uuid[]) or (erp_account_code=any(${tx.array(codes)}::text[]) and effective_from<=${to} and (effective_to is null or effective_to>=${from}))) order by mapping_id for update`;
 const own=pending.filter((m:any)=>m.created_by===a.staff_id);
 if(own.length)fail(403,`You set up the client account mapping for ${own.map((m:any)=>m.source_account_name+' → '+m.erp_account_code).join(', ')}. A different Manager or Partner must approve and post this journal.`);
 for(const m of pending)await tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where mapping_id=${m.mapping_id}`;
 return pending.map((m:any)=>m.mapping_id);
}
// Gate B: one reviewer action approves and posts the journal and, in the same transaction, confirms the
// submitted source it was built from (a sales/payroll period import, or a fixed asset's classification and
// class rate for a depreciation journal). No separate review is needed for items posted through a journal.
async function confirmJournalSources(tx:any,a:any,project:any,j:any,l:any,note:any){
 if(j.source_snapshot?.kind==='Period import'){
  const source=one(await tx`select * from erp_private.period_imports where import_id=${j.source_snapshot.import_id} and project_id=${j.project_id} for update`);
  if(source.status==='Submitted'){if(source.prepared_by===a.staff_id)fail(403,'You prepared the source summary for this journal. A different Manager or Partner must approve and post it.');await confirmPeriodImport(tx,a,project,source,note);}
 }
 if(j.kind==='Depreciation'){
  if((await tx`select x.asset_id from erp_private.ledger_assets x join erp_private.ledger_asset_charges c using(asset_id) where c.journal_id=${j.journal_id} and x.status not in ('Submitted','Approved')`).length)fail(409,'The asset for this depreciation was returned or reopened. Return this journal and recreate it after the asset is resubmitted.');
  const assets=await tx`select x.* from erp_private.ledger_assets x join erp_private.ledger_asset_charges c using(asset_id) where c.journal_id=${j.journal_id} and x.status='Submitted' for update of x`;
  for(const asset of assets){
   if([asset.prepared_by,asset.last_prepared_by].includes(a.staff_id))fail(403,'You prepared the asset classification for this depreciation. A different Manager or Partner must approve and post it.');
   const result=assetCalculation(asset,asset.rate_snapshot,l.starts_on,l.ends_on);if(result.issues.length)fail(400,result.issues.join(' '));
   if(String(note||'').trim().length<10)fail(400,'Record a review note of at least 10 characters covering the asset classification and class rate.');
   await tx`update erp_private.ledger_assets set status='Approved',reviewed_by=${a.staff_id},review_note=${text(note,5000)} where asset_id=${asset.asset_id}`;
  }
 }
}
async function period(tx:any,id:string,pid:string){return one(await tx`select * from erp_private.ledger_periods where period_id=${id} and project_id=${pid} for update`);}
async function lines(tx:any,id:string){return await tx`select * from erp_private.ledger_lines where journal_id=${id} order by line_no`;}
// Income and expense lines carry the business activity they belong to. When exactly one activity
// covers the journal date, untagged income and expense lines take it automatically.
async function activityDefaults(tx:any,j:any,items:any[]){
 const acts=await tx`select a.activity_id from erp_private.client_activities a join erp_private.ledger_periods l on l.client_id=a.client_id where l.period_id=${j.period_id} and a.effective_from<=${j.journal_date} and (a.effective_to is null or a.effective_to>=${j.journal_date})`;
 const only=acts.length===1?acts[0].activity_id:null;
 return items.map((r:any)=>{const pl=r.account_code&&String(r.account_code)>='40000';return {...r,activity_id:pl?(r.activity_id||only||null):null};});
}
async function writeLines(tx:any,j:any,items:any[]){
 items=await activityDefaults(tx,j,items);
 for(let i=0;i<items.length;i+=200){const values=items.slice(i,i+200).map((r:any,k:number)=>({...r,line_no:i+k+1}));
  await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,legacy_code,source_name,description,debit,credit,source_status,source_reference,activity_id)
  select ${j.journal_id}::uuid,${j.project_id}::uuid,x.line_no,x.account_code,coalesce(x.legacy_code,''),coalesce(x.source_name,''),coalesce(x.description,''),x.debit,x.credit,coalesce(x.source_status,'Unverified'),coalesce(x.source_reference,''),x.activity_id
  from jsonb_to_recordset(${tx.json(values)}::jsonb) x(line_no integer,account_code text,legacy_code text,source_name text,description text,debit numeric,credit numeric,source_status text,source_reference text,activity_id uuid)
  on conflict(journal_id,line_no) do update set account_code=excluded.account_code,legacy_code=excluded.legacy_code,source_name=excluded.source_name,description=excluded.description,debit=excluded.debit,credit=excluded.credit,source_status=excluded.source_status,source_reference=excluded.source_reference,activity_id=excluded.activity_id`;
 }
 await tx`update erp_private.ledger_lines set debit=0,credit=0,activity_id=null,description='Unused draft line retained in audit history' where journal_id=${j.journal_id} and line_no>${items.length}`;
}
async function newJournal(tx:any,a:any,l:any,kind:string,p:any,items:any[],snapshot:any={},generated=false){
 const id=crypto.randomUUID(),reference=text(p.reference||('GL-'+id.slice(0,8).toUpperCase()),100),at=date(p.journal_date||l.ends_on);
 if(at<day(l.starts_on)||at>day(l.ends_on))fail(400,'Use a journal date within this financial year.');
 if(kind==='Opening'&&at!==day(l.starts_on))fail(400,'Date opening balances on the first day of this financial year.');
 const j=one(await tx`insert into erp_private.ledger_journals(journal_id,period_id,project_id,kind,journal_date,reference,description,evidence,source_snapshot,generated,prepared_by,last_prepared_by,reversal_of)
 values(${id},${l.period_id},${l.project_id},${kind},${at},${reference},${text(p.description||'',2000,false)},${text(p.evidence||'',5000,false)},${tx.json(snapshot)},${generated},${a.staff_id},${a.staff_id},${p.reversal_of||null}) returning *`);
 await writeLines(tx,j,items);return {journal_id:id};
}
async function reviewedRows(tx:any,pid:string,ids:string[]){
 if(!Array.isArray(ids)||!ids.length||ids.length>2000||new Set(ids).size!==ids.length)fail(400,'Select 1–2,000 distinct source rows.');
 const parsed=ids.map(uuid);const r=await tx`select r.*,v.source_revision,v.decision,v.deductible_percentage,v.income_treatment,v.reviewed_by,v.vat_rate_key,b.period_start,b.period_end from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id) where r.project_id=${pid} and b.archived_at is null and r.row_id=any(${tx.array(parsed)}::uuid[]) and not r.is_split_parent order by r.row_id`;
 if(r.length!==parsed.length)fail(403,'All source rows must belong to this authorised project.');return r;
}
async function sourceCheck(tx:any,j:any){
 if(j.source_snapshot?.kind==='Period import'){const source=one(await tx`select * from erp_private.period_imports where import_id=${j.source_snapshot.import_id} and project_id=${j.project_id}`);if(!['Submitted','Confirmed'].includes(source.status)||source.source_hash!==j.source_snapshot.source_hash)fail(409,'The source summary changed or was superseded.');return;}
 if(j.source_snapshot?.kind==='Excel'&&j.kind==='Opening'){
  const source=await tx`select document_id from erp_private.documents where document_id=${uuid(j.source_snapshot.document_id)} and deleted_at is null and archived_at is null`;
  if(!source.length)fail(409,'The opening TB source was archived. Re-upload the approved source and prepare a new draft.');return;
 }
 if(j.source_snapshot?.kind!=='Workbook')return;
 const archived=await tx`select b.batch_id from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.row_id=any(${tx.array(j.source_snapshot.rows.map((x:any)=>x.row_id))}::uuid[]) and b.archived_at is not null`;
 if(archived.length)fail(409,'A source in this draft was archived. Return the draft to its preparer and create a corrected posting from active sources.');
 const r=await reviewedRows(tx,j.project_id,j.source_snapshot.rows.map((x:any)=>x.row_id));
 const clientId=(await tx`select client_id from erp_private.projects where project_id=${j.project_id}`)[0]?.client_id;
 const accounts=await tx`select code,route,category_code,status,is_legacy from erp_private.account_catalog`;
 for(const row of r.filter((x:any)=>['Purchases','Expenditure','Non-eTIMS'].includes(x.dataset)&&x.account_code)){
  const hint=row.normalized?.mapping_suggestion,confirmation=row.review_details?.mapping_confirmation,account=accounts.find((x:any)=>x.code===row.account_code),confirmed=['Uploaded routing and TB codes','Auto-mapped — chart verified'].includes(confirmation?.method)&&hint&&String(confirmation.tb_item_code)===String(row.account_code)&&String(hint.account_code)===String(row.account_code)&&String(confirmation.routing_code)===String(hint.category_code)&&String(account?.category_code)===String(hint.category_code)&&Number(account?.route)===Number(hint.route)&&account?.status==='Active'&&!account?.is_legacy;
  if(!confirmed&&!await clientAccountAllowed(tx,clientId,row.account_code,day(row.normalized.date||row.period_start)))fail(409,`ERP account ${row.account_code} is no longer approved for this client and source date, and its uploaded code confirmation is not valid. Review the client account setup and refresh the draft.`);
 }
 if(await digest(r.map(sourceShape))!==j.source_snapshot.digest)fail(409,'A source or its review changed. Refresh the generated draft before resubmitting.');
}
function salesLines(r:any,cross:any[]){
 if(r.dataset!=='Sales'||r.source_revision!==r.revision||r.decision!=='Confirmed')fail(400,'Sales sources need current independent confirmation.');
 const code=revenueAccount(cross,{rate_key:r.vat_rate_key},String(r.normalized.date||day(r.period_start)));
 if(!code)fail(400,'Confirm the sales category and applicable dated VAT treatment before posting.');
 const net=cashAmount(r.normalized.amount),vat=cashAmount(r.normalized.vat||0),signed=(account_code:string,n:number)=>({account_code,debit:Math.max(n,0)/100,credit:Math.max(-n,0)/100,source_status:'Confirmed',source_reference:r.row_id,description:r.normalized.invoice});
 return [signed('10060',net+vat),{...signed(code,-net),activity_id:r.review_details?.activity_id||null},...(vat?[signed('21020',-vat)]:[])];
}
async function checkPurchaseCredits(tx:any,rows:any[]){
 for(const r of rows.filter((x:any)=>x.dataset!=='Sales'&&Number(x.normalized.amount)<0)){
  if(!r.normalized.original_invoice)fail(400,'Credit '+r.normalized.invoice+' needs its original invoice reference.');
  const party=r.normalized.party_pin||r.normalized.party||'',original=await tx`select w.normalized from erp_private.workbook_rows w join erp_private.workbook_batches b using(batch_id) where w.client_id=${r.client_id} and b.archived_at is null and w.dataset in ('Purchases','Expenditure','Non-eTIMS') and not w.is_split_parent and upper(w.normalized->>'invoice')=${String(r.normalized.original_invoice).toUpperCase()} and coalesce(nullif(w.normalized->>'party_pin',''),w.normalized->>'party','')=${party}`;
  if(!original.length)fail(400,'Credit '+r.normalized.invoice+' is unmatched. Import the supported original purchase before posting.');
  const credits=await tx`select w.normalized from erp_private.workbook_rows w join erp_private.workbook_batches b using(batch_id) where w.client_id=${r.client_id} and b.archived_at is null and w.dataset in ('Purchases','Expenditure','Non-eTIMS') and not w.is_split_parent and upper(w.normalized->>'original_invoice')=${String(r.normalized.original_invoice).toUpperCase()} and coalesce(nullif(w.normalized->>'party_pin',''),w.normalized->>'party','')=${party}`;
  for(const field of ['amount','vat'])if(-credits.reduce((n:number,x:any)=>n+Math.min(Number(x.normalized[field]||0),0),0)>original.reduce((n:number,x:any)=>n+Math.max(Number(x.normalized[field]||0),0),0)+.01)fail(400,'Cumulative credits exceed the original purchase '+r.normalized.original_invoice+'.');
 }
}
async function generateSource(tx:any,a:any,l:any,p:any){
 const rows=await reviewedRows(tx,l.project_id,p.row_ids),kind=p.kind==='Sales'?'Sales':'Purchases';
 if(rows.some((r:any)=>day(r.normalized.date||r.period_start)<day(l.starts_on)||day(r.normalized.date||r.period_end)>day(l.ends_on)))fail(400,'The sources must fall inside this financial year.');
 if(rows.some((r:any)=>kind==='Sales'?r.dataset!=='Sales':!['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset)))fail(400,'Select the matching source type.');
 const claimed=await tx`select * from erp_private.ledger_sources where source_kind='Workbook row' and source_key=any(${tx.array(rows.map((r:any)=>r.row_id))}::text[])`;
 if(claimed.length){const ids=[...new Set(claimed.map((x:any)=>x.journal_id))];if(claimed.length===rows.length&&ids.length===1){const existing=one(await tx`select * from erp_private.ledger_journals where journal_id=${ids[0]}`);if(existing.period_id===l.period_id&&existing.source_snapshot.digest===await digest(rows.map(sourceShape)))return {journal_id:existing.journal_id,reused:true};}fail(409,'Some sources already belong to a journal. Select the remaining unposted rows.');}
 await checkPurchaseCredits(tx,rows);
 const cross=kind==='Sales'?await loadCrosswalk(tx):[],items=rows.flatMap((r:any)=>kind==='Sales'?salesLines(r,cross):costJournal(r)),snapshot={kind:'Workbook',rows:rows.map(sourceShape),digest:await digest(rows.map(sourceShape))};
 const result=await newJournal(tx,a,l,kind,p,items,snapshot,true);
 for(const r of rows)await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id,source_revision) values('Workbook row',${r.row_id},${result.journal_id},${l.project_id},${r.revision})`;
 return result;
}
// The client's previous financial year in the ERP (the year ending the day before this one starts).
// Without one, the prior year is represented by the approved opening balances.
async function priorYear(tx:any,l:any){
 const prev=(await tx`select * from erp_private.ledger_periods where client_id=${l.client_id} and ends_on=${day(l.starts_on)}::date-1 order by created_at desc limit 1`)[0];
 if(!prev)return {source:'Opening balances',label:`Approved opening balances at ${day(l.starts_on)}`,period:null,profit:null};
 const posted=await tx`select x.*,j.kind,j.reversal_of from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) where j.period_id=${prev.period_id} and j.status='Posted'`;
 const closing=new Set((await tx`select journal_id from erp_private.ledger_journals where period_id=${prev.period_id} and kind='Year close'`).map((r:any)=>r.journal_id));
 const lines=posted.filter((r:any)=>r.kind!=='Opening'&&r.kind!=='Year close'&&!closing.has(r.reversal_of));
 return {source:'Prior-year ledger',label:`Financial year ${day(prev.starts_on)} to ${day(prev.ends_on)}`,period:{period_id:prev.period_id,starts_on:day(prev.starts_on),ends_on:day(prev.ends_on)},profit:profitReport(lines)};
}
// Report windows inside the financial year: month, quarter (from the year start), year to date, year end.
function reportWindow(l:any,kind:string,asOf:string){
 const ys=day(l.starts_on),ye=day(l.ends_on);if(asOf<ys||asOf>ye)fail(400,'Choose an as-of date inside the financial year.');
 if(kind==='Year end'){if(asOf!==ye)fail(400,'A year-end report is as of the last day of the financial year.');return ys;}
 if(kind==='Year to date')return ys;
 const monthStart=asOf.slice(0,8)+'01';
 if(kind==='Month')return monthStart<ys?ys:monthStart;
 const months=(Number(asOf.slice(0,4))-Number(ys.slice(0,4)))*12+Number(asOf.slice(5,7))-Number(ys.slice(5,7)),q=Math.floor(months/3)*3;
 const d=new Date(ys+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+q);return d.toISOString().slice(0,10);
}
const PNL_LINES:[string,string][]=[['sales','Sales'],['cost_of_sales','Cost of sales'],['gross_profit','Gross profit'],['other_income','Other income'],['payroll','Staff costs'],['operating_expenses','Operating expenses'],['finance','Finance costs'],['depreciation','Depreciation'],['profit_before_tax','Profit before tax'],['income_tax','Income tax'],['profit_after_tax','Profit after tax']];
async function reportWorkbook({client,l,full,snapshot}:any){
 const book=new ExcelJS.Workbook(),money='#,##0.00;(#,##0.00);-',week=full.current_week;
 const head=(sheet:any,title:string,sub:string)=>{sheet.addRow([client.company_name+' · '+title]).font={name:'Arial',size:12,bold:true};sheet.addRow([sub]).font={name:'Arial',size:9,italic:true};sheet.addRow([]);};
 const style=(sheet:any,from:number)=>{sheet.eachRow((r:any,n:number)=>{if(n<from)return;r.eachCell((c:any)=>{c.font={name:'Arial',size:9,bold:n===from};if(typeof c.value==='number')c.numFmt=money;});});sheet.columns.forEach((c:any,i:number)=>c.width=i===0?34:18);};
 const cur=book.addWorksheet('Current period');head(cur,`${snapshot.report_kind} ${snapshot.starts_on} to ${snapshot.as_of}`,`Current period: ${week.label} (${week.starts_on} to ${week.ends_on}). Posted entries only. Data cut-off: periods ending ${DATA_CUTOFF} onwards.`);
 cur.addRow(['Line','This report (KES)','Year to date (KES)']);for(const [k,label] of PNL_LINES)cur.addRow([label,Number(snapshot.profit[k]||0),Number(full.profit[k]||0)]);style(cur,4);
 const act=book.addWorksheet('Profit by activity');head(act,'Profit and loss by business activity',`${snapshot.starts_on} to ${snapshot.as_of}. Unallocated = income and expense lines without an activity.`);
 const cols=snapshot.profit_by_activity.activities;act.addRow(['Line',...cols.map((c:any)=>`${c.activity_name} (${c.pack_code})`),'Unallocated','Total']);
 for(const [k,label] of PNL_LINES)act.addRow([label,...cols.map((c:any)=>Number(c[k]||0)),Number(snapshot.profit_by_activity.unallocated[k]||0),Number(snapshot.profit_by_activity.total[k]||0)]);style(act,4);
 const tb=book.addWorksheet('Trial balance');head(tb,`Trial balance as at ${snapshot.as_of}`,'Opening balances plus posted movements.');
 tb.addRow(['Code','Account','Opening','Debits','Credits','Closing debit','Closing credit']);for(const r of full.tb.filter((x:any)=>Number(x.opening)||Number(x.movement_debit)||Number(x.movement_credit)))tb.addRow([r.code,r.name,Number(r.opening),Number(r.movement_debit),Number(r.movement_credit),Number(r.debit),Number(r.credit)]);
 tb.addRow(['','Total','','','',full.tb.reduce((n:number,x:any)=>n+Number(x.debit||0),0),full.tb.reduce((n:number,x:any)=>n+Number(x.credit||0),0)]);style(tb,4);
 const prior=book.addWorksheet('Prior year');head(prior,'Prior year',full.prior_year.label);
 if(full.prior_year.profit){prior.addRow(['Line','Prior year (KES)','Current year to date (KES)']);for(const [k,label] of PNL_LINES)prior.addRow([label,Number(full.prior_year.profit[k]||0),Number(full.profit[k]||0)]);}
 else{prior.addRow(['Code','Account','Opening balance (KES)']);for(const r of full.tb.filter((x:any)=>Number(x.opening)))prior.addRow([r.code,r.name,Number(r.opening)]);}
 style(prior,4);
 const rv=book.addWorksheet('Reviews');head(rv,'Report reviews','Submitted reports with preparer and reviewer notes.');rv.addRow(['Report','From','As of','Status','Preparer note','Reviewed at','Review note']);
 for(const r of full.report_reviews)rv.addRow([r.report_kind,day(r.starts_on),day(r.as_of),r.status,r.prepared_note,r.reviewed_at?String(r.reviewed_at).slice(0,19):'',r.review_note||'']);style(rv,4);
 for(const s of book.worksheets)s.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
 const bytes=new Uint8Array(await book.xlsx.writeBuffer());let str='';for(let i=0;i<bytes.length;i+=16384)str+=String.fromCharCode(...bytes.subarray(i,i+16384));
 const safe=String(client.company_name).replace(/[^A-Za-z0-9]+/g,'_').slice(0,60);
 return {file_name:`${safe}_${snapshot.report_kind.replace(/ /g,'_')}_${snapshot.as_of}.xlsx`,mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:btoa(str)};
}
async function reportSnapshot(tx:any,l:any,kind:string,asOf:string){
 const starts=reportWindow(l,kind,asOf),full=await report(tx,l,asOf);
 const inWindow=await tx`select x.account_code,x.debit,x.credit,x.activity_id,j.kind,j.reversal_of from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) where j.period_id=${l.period_id} and j.status='Posted' and j.journal_date>=${starts} and j.journal_date<=${asOf}`;
 const closing=new Set(full.journals.filter((j:any)=>j.kind==='Year close').map((j:any)=>j.journal_id)),lines=inWindow.filter((r:any)=>r.kind!=='Opening'&&r.kind!=='Year close'&&!closing.has(r.reversal_of));
 const tbTotals={debit:full.tb.reduce((n:number,a:any)=>n+Number(a.debit||0),0),credit:full.tb.reduce((n:number,a:any)=>n+Number(a.credit||0),0)};
 return {full,snapshot:{report_kind:kind,starts_on:starts,as_of:asOf,profit:profitReport(lines),profit_by_activity:profitByActivity(lines,full.activities),year_to_date_profit:full.profit,trial_balance_totals:tbTotals,open_issues:full.issues}};
}
async function report(tx:any,l:any,to:string){
 if(to<day(l.starts_on)||to>day(l.ends_on))fail(400,'Choose an as-of date inside the financial year.');
 const posted=await tx`select x.*,j.kind,j.journal_date,j.reference,j.reversal_of from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) where j.period_id=${l.period_id} and j.status='Posted' and j.journal_date<=${to} order by j.journal_date,j.reference,x.line_no`;
 const accounts=await catalogue(tx),journals=await tx`select journal_id,kind,reference,journal_date,status,prepared_by,last_prepared_by,reviewed_by,review_note,revision from erp_private.ledger_journals where period_id=${l.period_id} order by created_at desc limit 500`;
 const opening=posted.filter((r:any)=>r.kind==='Opening'),movements=posted.filter((r:any)=>r.kind!=='Opening'),tb=trialBalance(accounts,opening,movements),closingIds=new Set(journals.filter((j:any)=>j.kind==='Year close').map((j:any)=>j.journal_id));
 const profitLines=posted.filter((r:any)=>r.kind!=='Opening'&&r.kind!=='Year close'&&!closingIds.has(r.reversal_of)),profit=profitReport(profitLines);
 const activities=await tx`select activity_id,activity_name,pack_code,is_primary,effective_from,effective_to from erp_private.client_activities where client_id=${l.client_id} order by is_primary desc,activity_name`;
 const profit_by_activity=profitByActivity(profitLines,activities),week=isoWeek(new Date().toISOString().slice(0,10));
 const current_week={...week,as_of:week.ends_on<day(l.starts_on)?null:week.ends_on>day(l.ends_on)?day(l.ends_on):week.ends_on};
 const prior_year=await priorYear(tx,l),report_reviews=await tx`select review_id,report_kind,starts_on,as_of,prepared_note,status,prepared_by,reviewed_by,reviewed_at,review_note,created_at,revision,requested_reviewer_id,erp_private.reviewer_label(requested_reviewer_id) requested_reviewer_name from erp_private.ledger_report_reviews where period_id=${l.period_id} order by created_at desc limit 100`;
 const pending=await tx`select r.row_id,r.source_row,r.dataset,r.account_code,r.normalized,r.revision,v.source_revision,v.decision,j.journal_id,j.status as journal_status from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id) left join erp_private.ledger_sources s on s.source_kind='Workbook row' and s.source_key=r.row_id::text left join erp_private.ledger_journals j on j.journal_id=s.journal_id
 where r.project_id=${l.project_id} and b.archived_at is null and not r.is_split_parent and r.dataset in ('Sales','Purchases','Expenditure','Non-eTIMS') and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${day(l.starts_on)} and coalesce(nullif(r.normalized->>'date',''),b.period_end::text)<=${to} and (j.status is distinct from 'Posted') order by r.created_at,r.source_row limit 2001`;
 const assets=await tx`select * from erp_private.ledger_assets where period_id=${l.period_id} order by created_at`,charges=await tx`select c.*,j.status as journal_status from erp_private.ledger_asset_charges c join erp_private.ledger_journals j using(journal_id) where c.project_id=${l.project_id} and c.starts_on>=${day(l.starts_on)} and c.ends_on<=${to}`;
 const ppe_sources=await tx`select r.row_id,r.account_code,r.first_use_date,r.narration,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.ledger_assets a on a.source_row_id=r.row_id where r.project_id=${l.project_id} and b.archived_at is null and r.route=3 and not r.is_split_parent and a.asset_id is null and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${day(l.starts_on)} and coalesce(nullif(r.normalized->>'date',''),b.period_end::text)<=${to} limit 2000`;
 const pendingImports=await tx`select i.import_id from erp_private.period_imports i where i.project_id=${l.project_id} and i.starts_on>=${day(l.starts_on)} and i.ends_on<=${to} and i.status<>'Superseded' and not exists(select 1 from erp_private.ledger_sources s join erp_private.ledger_journals j using(journal_id) where s.source_kind='Period import' and s.source_key=i.import_id::text and j.status='Posted')`;
 const pending_information=await pendingPurchases(tx,l.project_id,day(l.starts_on),to);
 const bankRows=await tx`select r.row_id,r.batch_id,r.source_row,r.account_code,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${l.project_id} and b.archived_at is null and not r.is_split_parent and r.dataset='Bank' and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${day(l.starts_on)} and coalesce(nullif(r.normalized->>'date',''),b.period_end::text)<=${to} order by r.source_row limit 20000`;
 const closeExplanations=await tx`select explanation_id,check_code,as_of,difference_cents,explanation,evidence_reference,status,prepared_by,reviewed_by,reviewed_at,review_note,revision from erp_private.bank_close_explanations where period_id=${l.period_id} and status in ('Submitted','Accepted') order by created_at desc`;
 const bankClose=bankCloseChecks({bankRows,tb,explanations:closeExplanations});
 const unmappedRow=(await tx`select count(*)::int n,coalesce(sum(case when r.normalized->>'amount' ~ '^-?[0-9]+([.][0-9]+)?$' then (r.normalized->>'amount')::numeric else 0 end),0) value from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${l.project_id} and b.archived_at is null and not r.is_split_parent and r.dataset in ('Purchases','Expenditure','Non-eTIMS') and (r.route is null or r.category_code is null or r.account_code is null) and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${day(l.starts_on)} and coalesce(nullif(r.normalized->>'date',''),b.period_end::text)<=${to}`)[0],unmapped={count:Number(unmappedRow.n),value:money(Number(unmappedRow.value))};
 const issues:string[]=bankClose.blocking.map((x:string)=>'Bank close – '+x);if(pending_information.total)issues.push(pending_information.total+' credit note(s) are Pending information and excluded from posted figures. Complete original invoice details before relying on final totals.');if(pendingImports.length)issues.push(pendingImports.length+' sales/payroll summary import(s) still await independent posting.');if(!journals.some((j:any)=>j.kind==='Opening'&&j.status==='Posted'))issues.push('Opening balances are not yet independently posted.');
 if(unmapped.count)issues.push(unmapped.count+' purchase/expenditure row(s) worth KES '+unmapped.value.toLocaleString('en-KE',{minimumFractionDigits:2})+' are not mapped to an account. Map them before the report is submitted.');
 const drafts=journals.filter((j:any)=>j.status!=='Posted');if(drafts.length)issues.push(drafts.length+' journal(s) await preparation or review.');
 if(pending.length)issues.push((pending.length>2000?'More than 2,000':pending.length)+' imported row(s) are not posted.');
 if(assets.some((x:any)=>x.status!=='Approved'))issues.push('Asset classifications or rate evidence still await approval.');
 if(ppe_sources.length)issues.push(ppe_sources.length+' PPE source(s) still need an asset and shared-rate record.');
 if(!journals.some((j:any)=>j.kind==='Stock'&&j.status==='Posted'))issues.push('Confirm stock / cost-of-sales completeness separately before relying on gross profit.');
 const balance=money(tb.reduce((sum:any,r:any)=>sum+r.net,0));if(balance!==0)issues.push('The trial balance is not balanced.');
 return {period:l,pending_information,unmapped,as_of:to,accounts,tb,profit,profit_by_activity,activities,current_week,prior_year,report_reviews,reviewers:await reviewCandidates(tx,(await tx`select client_id from erp_private.projects where project_id=${l.project_id}`)[0].client_id),data_cutoff:DATA_CUTOFF,journals,pending_sources:pending.slice(0,2000),pending_truncated:pending.length>2000,ppe_sources,assets,charges,issues,close_checks:bankClose.checks,close_explanations:closeExplanations,ready_to_close:false,disclosure:'Client working papers. Only independently posted entries feed profit. Stock completeness, tax adjustments and annual return readiness require separate review; year closure and KRA filing export are not enabled here.'};
}

export async function annualTaxLedgerControl(tx:any,projectId:string,start:string,end:string){
 const periods=await tx`select * from erp_private.ledger_periods where project_id=${projectId} and starts_on=${start} and ends_on=${end}`;
 if(periods.length!==1)return {source_application:null,profit_before_tax:null,issues:['Set up the client financial-year ledger for this exact annual tax period before preparing the Source & Application schedule.']};
 const l=periods[0],data=await report(tx,l,day(l.ends_on)),schedule=sourceApplicationSchedule(data.tb);
 return {period_id:l.period_id,source_application:schedule,profit_before_tax:data.profit.profit_before_tax,issues:[...data.issues,...schedule.issues],disclosure:data.disclosure};
}

export async function ledgerAction(tx:any,a:any,p:any,storage:any){
 if(!String(p.action).startsWith('ledger_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Interns can access assigned tasks, not client accounting working papers.');
 if(p.action==='ledger_rate_add'){
  if(a.category_code!=='PARTNER')fail(403,'The Engagement Partner must add a dated shared-rate version.');
  const code=text(p.class_code,30);if(!/^[A-Z][A-Z0-9_]{1,29}$/.test(code))fail(400,'Use an uppercase class code.');
  const from=date(p.effective_from),to=date(p.effective_to);if(to<from)fail(400,'Choose a valid rate window.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${code+':shared-rate'},0))`;
  if((await tx`select rate_id from erp_private.asset_class_rates where class_code=${code} and effective_from<=${to} and effective_to>=${from}`).length)fail(409,'This class already has a rate for these dates. Existing snapshots cannot be overwritten.');
  const exp=one(await tx`select code from erp_private.account_catalog where code=${text(p.expense_account,5)} and code between '67010' and '67070' and status='Active'`),contra=one(await tx`select code from erp_private.account_catalog where code=${text(p.contra_account,5)} and code between '15900' and '15980' and status='Active'`);
  return one(await tx`insert into erp_private.asset_class_rates(class_code,name,first_rate,annual_rate,later_basis_percentage,method,tax_cost_cap,expense_account,contra_account,effective_from,effective_to,source_reference,source_checked_on,scope,created_by) values(${code},${text(p.name,160)},${num(p.first_rate,0,100)},${num(p.annual_rate,0,100)},${num(p.later_basis_percentage,0,100)},'Equal instalments',${amount(p.tax_cost_cap,'statutory cost cap',true)},${exp.code},${contra.code},${from},${to},${text(p.source_reference,4000)},${date(p.source_checked_on)},${text(p.scope,2000)},${a.staff_id}) returning rate_id`);
 }
 const pid=uuid(p.project_id),project=one(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`);
 const rates=await tx`select * from erp_private.asset_class_rates order by class_code,effective_from desc`;
 if(p.action==='ledger_periods')return {periods:await tx`select * from erp_private.ledger_periods where project_id=${pid} order by starts_on desc`,rates,accounts:await chartCatalogue(tx,await catalogue(tx),project.client_id,new Date().toISOString().slice(0,10)),activities:await tx`select activity_id,activity_name,pack_code,is_primary,effective_from,effective_to from erp_private.client_activities where client_id=${project.client_id} order by is_primary desc,activity_name`,client:(await tx`select legal_entity_type,year_end_month,year_end_day from erp_private.clients where client_id=${project.client_id}`)[0]};
 await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':client-ledger'},0))`;
 if(p.action==='ledger_period_create'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${project.client_id}`);
  if(!['Limited company','Sole proprietor','Partnership','Non-profit organisation'].includes(c.legal_entity_type)||String(c.entity_evidence||'').trim().length<10||!c.year_end_month||!c.year_end_day)fail(400,'Confirm the client legal entity, supporting evidence and year-end in the profile first.');
  await requireRightChart(tx,project.client_id,'creating the client year');
  const start=date(p.starts_on),end=date(p.ends_on);if(end&&end<DATA_CUTOFF)fail(400,'The ERP holds data for periods ending 31 December 2025 onwards. Keep earlier periods in the client\u2019s previous records.');if(!start||!end||end<start||end.slice(5)!==String(c.year_end_month).padStart(2,'0')+'-'+String(c.year_end_day).padStart(2,'0'))fail(400,'Use the verified client year-end.');
  return one(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${pid},${project.client_id},${project.handling_firm_id},${start},${end},${c.legal_entity_type},${c.entity_evidence},${a.staff_id}) returning period_id`);
 }
 const l=await period(tx,uuid(p.period_id),pid);
 if(p.action==='ledger_read')return {...await report(tx,l,p.as_of?date(p.as_of):day(l.ends_on)),rates};
 if(p.action==='ledger_debtors_read')return await debtorsRead(tx,l,p.as_of?date(p.as_of):day(l.ends_on));
 if(p.action==='ledger_receipt_allocate'||p.action==='ledger_receipt_reverse')return await receiptAction(tx,a,l,p);
 if(p.action==='ledger_report_submit'){
  if(a.category_code==='INTERN')fail(403,'A staff preparer must submit financial reports.');
  const kind=choice(p.report_kind,['Month','Quarter','Year to date','Year end']),asOf=date(p.as_of),note=text(p.prepared_note,2000);if(!asOf)fail(400,'Choose the report date.');if(note.length<10)fail(400,'Add a preparer note of at least 10 characters.');
  const {full,snapshot}=await reportSnapshot(tx,l,kind,asOf);
  if(full.unmapped.count)fail(400,`${full.unmapped.count} purchase/expenditure row(s) worth KES ${full.unmapped.value.toLocaleString('en-KE',{minimumFractionDigits:2})} are not mapped. Map them (or ask a Manager to review the automatic mapping) before submitting this report.`);
  if((await tx`select 1 from erp_private.ledger_report_reviews where period_id=${l.period_id} and report_kind=${kind} and as_of=${asOf} and status='Submitted'`).length)fail(409,'This report is already waiting for review.');
  const made=one(await tx`insert into erp_private.ledger_report_reviews(project_id,period_id,report_kind,starts_on,as_of,snapshot,snapshot_digest,prepared_note,prepared_by,requested_reviewer_id) values(${l.project_id},${l.period_id},${kind},${snapshot.starts_on},${asOf},${tx.json(snapshot)},${await digest(snapshot)},${note},${a.staff_id},${await chosenReviewer(tx,a,(await tx`select client_id from erp_private.projects where project_id=${l.project_id}`)[0].client_id,p.requested_reviewer_id)}) returning review_id,status,requested_reviewer_id`);
  await notifyReviewers(tx,l.client_id,`${kind} report as at ${asOf}`,'review:report:'+made.review_id,made.requested_reviewer_id);
  return {review_id:made.review_id,status:made.status};
 }
 if(p.action==='ledger_report_review'){
  leader(a);const r=one(await tx`select * from erp_private.ledger_report_reviews where review_id=${uuid(p.review_id)} and period_id=${l.period_id} for update`);rev(r,p);
  if(r.status!=='Submitted')fail(400,'Only a submitted report can be approved or returned.');if(r.prepared_by===a.staff_id)fail(403,'A different Manager or Partner must review this report.');await mustBeAskedReviewer(tx,a,r.requested_reviewer_id);
  const status=choice(p.status,['Approved','Returned']),note=text(p.review_note,2000);if(note.length<10)fail(400,'Enter a review note of at least 10 characters.');
  if(status==='Approved'){const {snapshot}=await reportSnapshot(tx,l,r.report_kind,day(r.as_of));if(await digest(snapshot)!==r.snapshot_digest)fail(409,'The posted figures changed after this report was submitted. Return it so the preparer submits the current figures.');}
  await tx`update erp_private.ledger_report_reviews set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where review_id=${r.review_id}`;await notifyOutcome(tx,r.prepared_by,l.client_id,`${r.report_kind} report`,status,note,'outcome:report:'+r.review_id+':'+status);return {ok:true,status};
 }
 if(p.action==='ledger_report_export'){
  const asOf=date(p.as_of)||day(l.ends_on),kind=p.report_kind?choice(p.report_kind,['Month','Quarter','Year to date','Year end']):'Year to date';
  const {full,snapshot}=await reportSnapshot(tx,l,kind,asOf),client=one(await tx`select company_name,kra_pin,legal_entity_type from erp_private.clients where client_id=${l.client_id}`);
  return await reportWorkbook({client,l,full,snapshot});
 }
 if(p.action==='ledger_account_read'){
  const code=text(p.account_code,5),to=p.as_of?date(p.as_of):day(l.ends_on);if(to<day(l.starts_on)||to>day(l.ends_on))fail(400,'Choose an as-of date inside this financial year.');return {lines:await tx`select x.*,j.reference,j.kind,j.journal_date,j.status,j.reviewed_by from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) where j.period_id=${l.period_id} and x.account_code=${code} and j.status='Posted' and j.journal_date<=${to} order by j.journal_date,j.reference,x.line_no limit 2001`};
 }
 if(p.action==='ledger_journal_read'){
  const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id}`),items=await lines(tx,j.journal_id);
  const chartAccounts=await chartCatalogue(tx,await catalogue(tx),l.client_id,day(j.journal_date||l.starts_on));
  const needsCheck=(await tx`select erp_private.is_junior_preparer(${j.prepared_by}) a,erp_private.is_junior_preparer(${j.last_prepared_by}) b`)[0],checker=j.checked_by?(await tx`select erp_private.reviewer_label(${j.checked_by}) n`)[0]?.n:null;
  return {journal:j,check:{needed:!!(needsCheck.a||needsCheck.b),checked_by:j.checked_by,checked_by_name:checker,checked_at:j.checked_at,check_note:j.check_note},lines:items,accounts:chartAccounts,issues:journalIssues(items,chartAccounts,{kind:j.kind,entityType:l.entity_type,sourceSnapshot:j.source_snapshot})};
 }
 if(p.action==='ledger_asset_read'){const asset=one(await tx`select * from erp_private.ledger_assets where asset_id=${uuid(p.asset_id)} and period_id=${l.period_id}`);return {asset,rate:asset.rate_snapshot,calculation:assetCalculation(asset,asset.rate_snapshot,l.starts_on,l.ends_on)};}
 if(l.status!=='Open')fail(400,'This client year is closed. Its posted snapshot remains available.');
 if(p.action==='ledger_close_explanation_save'||p.action==='ledger_close_explanation_review'){
  // The difference is always recomputed on the server; the client never supplies the amount.
  const asOf=p.as_of?date(p.as_of):day(l.ends_on),current=(await report(tx,l,asOf)).close_checks.find((c:any)=>c.code==='STATEMENT_TO_LEDGER');
  if(p.action==='ledger_close_explanation_save'){
   if(!current?.difference_cents)fail(400,'There is no statement-to-ledger difference to explain.');
   const explanation=text(p.explanation,4000),evidence=text(p.evidence_reference,500);
   if(explanation.length<20)fail(400,'Explain the difference in at least 20 characters, for example which items are in transit and when they clear.');
   await tx`update erp_private.bank_close_explanations set status='Withdrawn' where period_id=${l.period_id} and check_code='STATEMENT_TO_LEDGER' and status='Submitted' and prepared_by=${a.staff_id}`;
   return one(await tx`insert into erp_private.bank_close_explanations(project_id,period_id,check_code,as_of,difference_cents,explanation,evidence_reference,prepared_by) values(${pid},${l.period_id},'STATEMENT_TO_LEDGER',${asOf},${current.difference_cents},${explanation},${evidence},${a.staff_id}) returning explanation_id,difference_cents`);
  }
  leader(a);const e=one(await tx`select * from erp_private.bank_close_explanations where explanation_id=${uuid(p.explanation_id)} and period_id=${l.period_id} for update`);rev(e,p);
  if(e.status!=='Submitted'||e.prepared_by===a.staff_id)fail(403,'A different Manager or Partner must review this explanation.');
  const status=choice(p.status,['Accepted','Returned']),note=text(p.review_note,2000);if(note.length<10)fail(400,'Record a review conclusion of at least 10 characters.');
  if(status==='Accepted'&&Number(e.difference_cents)!==Number(current?.difference_cents||0))fail(409,'The difference has changed since this explanation was recorded. Return it and record a new one.');
  await tx`update erp_private.bank_close_explanations set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where explanation_id=${e.explanation_id}`;
  return {ok:true,status};
 }
 if(project.status==='Archived')fail(400,'Archived projects cannot change client working papers.');
 if(p.action==='ledger_stock_read')return await stockRollsRead(tx,l);
 if(p.action==='ledger_stock_propose'){
  const plan=await stockJournalPlan(tx,l,p.control_id),items=normaliseLines(plan.lines,await catalogue(tx),{});
  return await newJournal(tx,a,l,'Stock',{reference:plan.reference,journal_date:plan.journal_date,description:plan.description,evidence:plan.evidence},items,plan.snapshot);
 }
 if(p.action==='ledger_journal_save'){
  const accounts=await catalogue(tx),kind=choice(p.kind,['Opening','Payroll','Adjustment','Stock']),items=normaliseLines(p.lines,accounts,{allowUnmapped:true,opening:kind==='Opening',payroll:kind==='Payroll'});
  if(kind==='Opening')for(const line of items.filter((x:any)=>x.account_code))if(!await clientAccountAllowed(tx,project.client_id,line.account_code,day(l.starts_on)))fail(400,`ERP account ${line.account_code} is not approved for this client’s opening balance date. Add it under Clients → Client accounts; it is reviewed when this journal is approved and posted.`);
  if(p.journal_id){const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);edit(j,a);if(j.generated||j.kind!==kind)fail(400,'Generated source entries must be refreshed or reversed, not manually overwritten.');
   await writeLines(tx,j,items);await tx`update erp_private.ledger_journals set journal_date=${date(p.journal_date)},reference=${text(p.reference,100)},description=${text(p.description||'',2000,false)},evidence=${text(p.evidence||'',5000,false)},last_prepared_by=${a.staff_id},status='Draft' where journal_id=${j.journal_id}`;return {journal_id:j.journal_id};
  }return await newJournal(tx,a,l,kind,p,items);
 }
 if(p.action==='ledger_period_import_create'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':period-import'},0))`;
  const source=one(await tx`select * from erp_private.period_imports where import_id=${uuid(p.import_id)} and project_id=${pid}`);
  if(!['Submitted','Confirmed'].includes(source.status)||day(source.starts_on)<day(l.starts_on)||day(source.ends_on)>day(l.ends_on))fail(400,'Choose a submitted or confirmed import within this financial year. The import is reviewed when its journal is approved and posted.');
  const used=(await tx`select journal_id from erp_private.ledger_sources where source_kind='Period import' and source_key=${source.import_id}`)[0];if(used)return {...used,reused:true};
  let items:any[]=[];
  if(source.kind==='Sales'){
   const cross=await loadCrosswalk(tx),codes:any=Object.fromEntries(['16%','8%','0%','Exempt'].map(k=>[k,revenueAccount(cross,{vat_category:k},day(source.ends_on))]));
   if(source.payload.groups.some((g:any)=>(cashAmount(g.net)||cashAmount(g.vat))&&!codes[g.vat_category]))fail(400,'No approved revenue account is set for this sales category and date.');
   const signed=(code:string,value:number,description:string)=>({account_code:code,debit:Math.max(value,0)/100,credit:Math.max(-value,0)/100,source_status:'Confirmed',source_reference:source.import_id,description});
   for(const g of source.payload.groups){const net=cashAmount(g.net),vat=cashAmount(g.vat);if(net||vat)items.push(signed('10060',net+vat,'Sales summary '+g.vat_category),signed(codes[g.vat_category],-net,'Net sales '+g.vat_category),...(vat?[signed('21020',-vat,'Output VAT '+g.vat_category)]:[]));}
  }else{const t=source.payload.totals;items=payrollJournal({gross_pay:t.gross,paye:t.paye,shif:t.shif,employee_ahl:t.employee_ahl,employee_nssf:t.employee_nssf,employee_pension:t.employee_pension,other_deductions:t.other_deductions,employer_ahl:t.employer_ahl,employer_nssf:t.employer_nssf,employer_nita:t.nita,evidence:source.import_id});}
  if(!items.length)fail(400,'A zero summary needs no accounting entry.');
  if(source.activity_id)items=items.map((x:any)=>String(x.account_code||'')>='40000'?{...x,activity_id:source.activity_id}:x);
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
  const cross=j.kind==='Sales'?await loadCrosswalk(tx):[],rows=await reviewedRows(tx,pid,j.source_snapshot.rows.map((r:any)=>r.row_id)),items=rows.flatMap((r:any)=>j.kind==='Sales'?salesLines(r,cross):costJournal(r));
  await writeLines(tx,j,items);await tx`update erp_private.ledger_journals set source_snapshot=${tx.json({kind:'Workbook',rows:rows.map(sourceShape),digest:await digest(rows.map(sourceShape))})},last_prepared_by=${a.staff_id},status='Draft' where journal_id=${j.journal_id}`;return {journal_id:j.journal_id};
 }
 if(p.action==='ledger_journal_check'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Supervisor, Manager or Partner must check this entry.');
  const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);
  if(j.status!=='Submitted')fail(400,'Only a submitted entry can be checked.');
  if([j.prepared_by,j.last_prepared_by].includes(a.staff_id))fail(403,'You prepared or edited this entry. A different Supervisor, Manager or Partner must check it.');
  if(j.checked_by)fail(409,'This entry has already been checked.');
  const outcome=choice(p.outcome,['Checked','Returned']),note=text(p.check_note,5000);if(note.length<10)fail(400,'Enter a check note of at least 10 characters.');
  const what=`${j.kind==='Opening'?'opening balances':j.kind.toLowerCase()+' journal'} ${j.reference}`;
  if(outcome==='Returned'){await tx`update erp_private.ledger_journals set status='Returned',reviewed_by=${a.staff_id},review_note=${note} where journal_id=${j.journal_id}`;await notifyOutcome(tx,j.last_prepared_by||j.prepared_by,l.client_id,what,'Returned',note,'outcome:journal:'+j.journal_id+':'+Date.now());return {ok:true,status:'Returned',journal_id:j.journal_id};}
  await tx`update erp_private.ledger_journals set checked_by=${a.staff_id},checked_at=now(),check_note=${note} where journal_id=${j.journal_id}`;
  await notifyReviewers(tx,l.client_id,`${what} (checked, ready to approve)`,'review:journal-checked:'+j.journal_id+':'+Date.now());
  return {ok:true,status:'Checked',journal_id:j.journal_id};
 }
 if(['ledger_journal_submit','ledger_journal_review'].includes(p.action)){
  const j=one(await tx`select * from erp_private.ledger_journals where journal_id=${uuid(p.journal_id)} and period_id=${l.period_id} for update`);rev(j,p);
  if(p.action==='ledger_journal_submit'){edit(j,a);const currentLines=await lines(tx,j.journal_id),issues=journalIssues(currentLines,await chartCatalogue(tx,await catalogue(tx),l.client_id,day(j.journal_date||l.starts_on)),{kind:j.kind,entityType:l.entity_type,sourceSnapshot:j.source_snapshot});if(j.kind==='Opening')for(const line of currentLines.filter((x:any)=>x.account_code))if(!await clientAccountAllowed(tx,project.client_id,line.account_code,day(l.starts_on)))issues.push(`Line ${line.line_no}: ERP account ${line.account_code} is not approved for this client’s opening balance date.`);if(issues.length)fail(400,issues.join(' '));await sourceCheck(tx,j);await tx`update erp_private.ledger_journals set status='Submitted',last_prepared_by=${a.staff_id},updated_at=now() where journal_id=${j.journal_id}`;await notifyReviewers(tx,l.client_id,`${j.kind==='Opening'?'opening balances':j.kind.toLowerCase()+' journal'} ${j.reference}`,'review:journal:'+j.journal_id+':'+Date.now());}
  else{leader(a);if(j.status!=='Submitted'||[j.prepared_by,j.last_prepared_by].includes(a.staff_id))fail(403,'A different Manager or Partner must review the submitted journal.');const status=choice(p.status,['Posted','Returned']);let activated:string[]=[];if(status==='Posted'){const jr=(await tx`select erp_private.is_junior_preparer(${j.prepared_by}) a,erp_private.is_junior_preparer(${j.last_prepared_by}) b`)[0];if(jr.a||jr.b){if(!j.checked_by)fail(409,'This entry was prepared by an Assistant. A Supervisor, Manager or Partner must check it before it can be approved and posted.');if(j.checked_by===a.staff_id)fail(403,'You checked this entry. A different Manager or Partner must approve and post it.');}}if(status==='Posted'){const chart=await approvedChart(tx,l.client_id,day(j.journal_date||l.starts_on)),outside=chart?(await lines(tx,j.journal_id)).filter((x:any)=>x.account_code&&(Number(x.debit)||Number(x.credit))&&!chart.codes.has(x.account_code)):[];if(outside.length)fail(400,`Return this journal: ${[...new Set(outside.map((x:any)=>x.account_code))].map((c:any)=>chartMessage(c)).join(' ')}`);await sourceCheck(tx,j);await confirmJournalSources(tx,a,project,j,l,p.review_note);activated=await activateJournalMappings(tx,a,project.client_id,j,l,await lines(tx,j.journal_id));}await tx`update erp_private.ledger_journals set status=${status},reviewed_by=${a.staff_id},review_note=${text(p.review_note,5000)} where journal_id=${j.journal_id}`;await notifyOutcome(tx,j.last_prepared_by||j.prepared_by,l.client_id,`${j.kind==='Opening'?'opening balances':j.kind.toLowerCase()+' journal'} ${j.reference}`,status,text(p.review_note,5000),'outcome:journal:'+j.journal_id+':'+Date.now());return {ok:true,journal_id:j.journal_id,activated_mapping_count:activated.length};}
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
  const asset=one(await tx`select * from erp_private.ledger_assets where asset_id=${uuid(p.asset_id)} and period_id=${l.period_id}`);if(!['Submitted','Approved'].includes(asset.status))fail(400,'Submit the asset classification and class rate first. They are reviewed when the depreciation journal is approved and posted.');const start=date(p.starts_on),end=date(p.ends_on);if(start<day(l.starts_on)||end>day(l.ends_on)||end<start)fail(400,'Choose charge dates within the financial year.');
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
  const accounts=await catalogue(tx),items:any[]=[],sourceRows:any[]=[],sourceControls:any[]=[],chosenGroups=new Map<string,any>(),retargets=new Map<string,string>(),chartChecked=new Set<string>(),accountChoices=p.account_overrides&&typeof p.account_overrides==='object'?p.account_overrides:{},choiceConfirmed=p.mapping_confirmations&&typeof p.mapping_confirmations==='object'?p.mapping_confirmations:{},clientMappings=kind==='Opening'?await tx`select mapping_id,source_account_code,source_account_name,erp_account_code,effective_from,effective_to,status,created_by from erp_private.client_account_mappings where client_id=${project.client_id} and status in ('Active','Draft') and effective_from<=${day(l.starts_on)} and (effective_to is null or effective_to>=${day(l.starts_on)})`:[];
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
   // The preparer's confirmed choice on the import screen (a source account → an ERP account) is applied here. It creates a client account
   // mapping that is Pending review (Draft) and is activated when a different Manager or Partner approves and posts the opening journal (an Assistant's work is checked by a Supervisor first).
   const picked=kind==='Opening'&&String(accountChoices[String(r)]??'').trim()&&(choiceConfirmed[String(r)]===true||choiceConfirmed[String(r)]==='true')?String(accountChoices[String(r)]).trim():'';
   if(picked){
    const chosenAccount=accounts.find(x=>x.code===picked);
    if(!chosenAccount||chosenAccount.status!=='Active'||chosenAccount.is_legacy)fail(400,`Source row ${r}: ERP account ${picked} is not an active detailed account.`);
    if(!chartChecked.has(picked)){await requireChartAccount(tx,project.client_id,picked,day(l.starts_on));chartChecked.add(picked);}
    if(sourceMapping&&sourceMapping.erp_account_code!==picked){
     if(!(sourceMapping.status==='Draft'&&sourceMapping.created_by===a.staff_id))fail(400,`Source row ${r}: ${sourceCode||name} is already mapped to ERP account ${sourceMapping.erp_account_code} by a reviewed client mapping. A Manager must end that mapping before a different account is used.`);
     retargets.set(sourceMapping.mapping_id,picked);
    }
    if(!sourceMapping){
     const group=sourceCode.toLowerCase()+'|'+name.toLowerCase(),seen=chosenGroups.get(group);
     if(seen&&seen.code!==picked)fail(400,`Source rows ${seen.rows[0]} and ${r} are the same source account ${sourceCode||name} but use different ERP accounts. Choose one ERP account for the source account.`);
     if(seen)seen.rows.push(r);else chosenGroups.set(group,{code:picked,rows:[r],sourceCode,name});
    }
   }
   if(sourceMapping&&explicitCode&&!picked&&sourceMapping.erp_account_code!==explicitCode)fail(400,`Source row ${r}: ERP TB item code ${explicitCode} differs from the approved client mapping ${sourceMapping.erp_account_code}.`);
   const targetCode=kind==='Opening'?picked||sourceMapping?.erp_account_code||'':explicitCode||legacyCode,account=accounts.find(x=>x.code===targetCode),suppliedRouting=String(read('routing_code')||'').trim().toUpperCase();
   if(suppliedRouting&&account&&!picked&&suppliedRouting!==String(account.category_code||'').toUpperCase())fail(400,`Source row ${r}: routing code does not match ERP TB item code ${targetCode}.`);
   const mappingIssue=kind==='Opening'&&!sourceMapping&&!picked?'No approved client account mapping matches this source code/name for the financial-year start. Choose the ERP account for this row and confirm it.':'';
   items.push({account_code:targetCode||null,legacy_code:sourceCode||legacy,source_name:name,debit:Math.max(net,0),credit:Math.max(-net,0),source_status:kind==='Opening'?(!negative&&openingConfirmed?'Confirmed':'Unverified'):!negative&&read('source_status')==='Confirmed'?'Confirmed':'Unverified',source_reference:kind==='Opening'?`${doc.file_name} | ${sheet.name} | row ${r}`:String(read('source_reference')||doc.file_name),description:'Excel row '+r+(negative?' - sign presentation normalised; confirm original source':'' )});
   sourceRows.push({source_row:r,original_debit:debit,original_credit:credit,source_name:name,legacy_code:sourceCode||legacy,source_tb_item_code:explicitCode,tb_item_code:targetCode||'',routing_code:suppliedRouting||String(account?.category_code||''),account_code:targetCode||'',client_mapping_id:sourceMapping?.mapping_id||null,mapping_issue:mappingIssue,group_key:picked&&!sourceMapping?sourceCode.toLowerCase()+'|'+name.toLowerCase():undefined});
  }
  const key=await digest({document:doc.sha256,sheet:sheet.name,header,kind,period:l.period_id,...(kind==='Opening'?{upload:doc.document_id}:{})}),existing=(await tx`select journal_id from erp_private.ledger_sources where source_kind=${kind+' workbook'} and source_key=${key}`)[0];if(existing)return {...existing,reused:true,imported_count:0,duplicate_count:items.length};
  // A corrected upload replaces an unposted opening draft in place (its old lines are zeroed and kept in the audit history). Once the draft is
  // submitted or posted it is locked: the reviewer returns it first, or a reviewed adjustment corrects a posted opening.
  const openingDraft=kind==='Opening'?(await tx`select * from erp_private.ledger_journals where period_id=${l.period_id} and kind='Opening' limit 1 for update`)[0]:null;
  if(openingDraft){
   if(openingDraft.status==='Submitted')fail(409,'The opening balance entry is waiting for independent review. Ask the reviewer to return it, then upload the corrected TB.');
   if(openingDraft.status==='Posted')fail(409,'The opening balance entry is already posted. Posted opening corrections require a reviewed adjustment.');
   if(openingDraft.source_snapshot?.kind!=='Excel')fail(409,'An opening balance entry already exists for this financial year. Open it from Entry register and edit the draft there.');
   edit(openingDraft,a);
  }
  if(kind==='Opening'){
   for(const [id,code] of retargets)await tx`update erp_private.client_account_mappings set erp_account_code=${code} where mapping_id=${id} and status='Draft' and created_by=${a.staff_id}`;
   for(const [group,g] of chosenGroups){
    const clash=await tx`select mapping_id from erp_private.client_account_mappings where client_id=${project.client_id} and coalesce(nullif(btrim(source_account_code),''),'name:'||lower(btrim(source_account_name)))=${g.sourceCode||('name:'+String(g.name||'').trim().toLowerCase())} and status in ('Draft','Active') and effective_from<=${day(l.starts_on)} and (effective_to is null or effective_to>=${day(l.starts_on)}) limit 1`;
    if(clash.length)fail(409,`A saved account setup already covers ${g.sourceCode?'source code '+g.sourceCode:'source account '+g.name}. Ask a Manager to review the existing client account mapping.`);
    const made=one(await tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,status,created_by) values(${project.client_id},${g.sourceCode||null},${g.name},${g.code},${day(l.starts_on)},'Draft',${a.staff_id}) returning mapping_id`);
    for(const row of sourceRows)if(row.group_key===group){row.client_mapping_id=made.mapping_id;}
   }
   for(const row of sourceRows)delete row.group_key;
  }
  if(!items.length)fail(400,'No nonzero account rows were found. Check that you selected the prior-year closing columns, not a comparison or total column.');const parsed=normaliseLines(items,accounts,{allowUnmapped:true,opening:kind==='Opening',payroll:kind==='Payroll'});
  const totals=parsed.reduce((t:any,line:any)=>({debit:t.debit+cashAmount(line.debit),credit:t.credit+cashAmount(line.credit)}),{debit:0,credit:0});
  const snapshot={kind:'Excel',document_id:doc.document_id,document_sha256:doc.sha256,sheet_name:sheet.name,header_row:header,column_map:map,source_rows:sourceRows,source_controls:sourceControls,import_totals:{debit_kes:totals.debit/100,credit_kes:totals.credit/100,difference_kes:(totals.debit-totals.credit)/100},...(kind==='Opening'?{source_confirmation:{confirmed:true,confirmed_by:a.staff_id,evidence_reference:sourceEvidence,source_closing_date:new Date(new Date(day(l.starts_on)+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10),currency:'KES'}}:{})};
  let j:any;
  if(openingDraft){await writeLines(tx,openingDraft,parsed);await tx`update erp_private.ledger_journals set source_snapshot=${tx.json(snapshot)},evidence=${text(p.evidence||'',5000,false)},description=${text(p.description||'',2000,false)},last_prepared_by=${a.staff_id},status='Draft' where journal_id=${openingDraft.journal_id}`;j={journal_id:openingDraft.journal_id,replaced:true};}
  else j=await newJournal(tx,a,l,kind,p,parsed,snapshot);
  await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id) values(${kind+' workbook'},${key},${j.journal_id},${pid})`;return {...j,source_count:items.length,imported_count:items.length,duplicate_count:0,totals:{debit_kes:totals.debit/100,credit_kes:totals.credit/100,difference_kes:(totals.debit-totals.credit)/100},source_controls:sourceControls};
 }
 fail(404,'Unknown client working-paper action.');
}
