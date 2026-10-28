import {pendingPurchases} from './purchase-pending.ts';
import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {digest} from './improvement-actions.ts';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {cashAmount,day,normaliseLines,journalIssues,costJournal,trialBalance,profitReport,assetCalculation,periodAssetCharge,staffReviewer,assetClassAllowed,payrollJournal} from './ledger-rules.mjs';
import {money} from './accounting-rules.mjs';

const one=(r:any[])=>{if(!r.length)fail(403,'This working paper is not available to your account.');return r[0];};
const leader=(a:any)=>{if(!staffReviewer(a))fail(403,'A Manager or Partner must approve client accounting.');};
const rev=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This working paper changed. Refresh before continuing.');};
const edit=(r:any,a:any)=>{if(!['Draft','Returned'].includes(r.status)||r.prepared_by!==a.staff_id&&!staffReviewer(a))fail(403,'Only the preparer or a Manager may edit an open draft.');};
const amount=(v:any,label:string,nullable=false)=>{if(nullable&&(v===''||v==null))return null;try{return cashAmount(v)/100;}catch{fail(400,'Enter a valid '+label+'.');}};
const num=(v:any,min:number,max:number)=>{if(v===''||v==null||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)fail(400,'Enter a number between '+min+' and '+max+'.');return Number(v);};
const sourceShape=(r:any)=>({row_id:r.row_id,revision:r.revision,dataset:r.dataset,normalized:r.normalized,account_code:r.account_code,route:r.route,review_details:r.review_details,decision:r.decision,source_revision:r.source_revision,deductible_percentage:r.deductible_percentage,income_treatment:r.income_treatment,reviewed_by:r.reviewed_by,vat_rate_key:r.vat_rate_key});
async function catalogue(tx:any){return await tx`select * from erp_private.account_catalog order by code`;}
async function period(tx:any,id:string,pid:string){return one(await tx`select * from erp_private.ledger_periods where period_id=${id} and project_id=${pid} for update`);}
async function lines(tx:any,id:string){return await tx`select * from erp_private.ledger_lines where journal_id=${id} order by line_no`;}
async function writeLines(tx:any,j:any,items:any[]){
 for(let i=0;i<items.length;i+=200){const values=items.slice(i,i+200).map((r:any,k:number)=>({...r,line_no:i+k+1}));
  await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,legacy_code,source_name,description,debit,credit,source_status,source_reference)
  select ${j.journal_id}::uuid,${j.project_id}::uuid,x.line_no,x.account_code,coalesce(x.legacy_code,''),coalesce(x.source_name,''),coalesce(x.description,''),x.debit,x.credit,coalesce(x.source_status,'Unverified'),coalesce(x.source_reference,'')
  from jsonb_to_recordset(${tx.json(values)}::jsonb) x(line_no integer,account_code text,legacy_code text,source_name text,description text,debit numeric,credit numeric,source_status text,source_reference text)
  on conflict(journal_id,line_no) do update set account_code=excluded.account_code,legacy_code=excluded.legacy_code,source_name=excluded.source_name,description=excluded.description,debit=excluded.debit,credit=excluded.credit,source_status=excluded.source_status,source_reference=excluded.source_reference`;
 }
 await tx`update erp_private.ledger_lines set debit=0,credit=0,description='Unused draft line retained in audit history' where journal_id=${j.journal_id} and line_no>${items.length}`;
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
 if(j.source_snapshot?.kind==='Period import'){const source=one(await tx`select * from erp_private.period_imports where import_id=${j.source_snapshot.import_id} and project_id=${j.project_id}`);if(source.status!=='Confirmed'||source.source_hash!==j.source_snapshot.source_hash)fail(409,'The source summary changed or was superseded.');return;}
 if(j.source_snapshot?.kind==='Excel'&&j.kind==='Opening'){
  const source=await tx`select document_id from erp_private.documents where document_id=${uuid(j.source_snapshot.document_id)} and deleted_at is null and archived_at is null`;
  if(!source.length)fail(409,'The opening TB source was archived. Re-upload the approved source and prepare a new draft.');return;
 }
 if(j.source_snapshot?.kind!=='Workbook')return;
 const archived=await tx`select b.batch_id from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.row_id=any(${tx.array(j.source_snapshot.rows.map((x:any)=>x.row_id))}::uuid[]) and b.archived_at is not null`;
 if(archived.length)fail(409,'A source in this draft was archived. Return the draft to its preparer and create a corrected posting from active sources.');
 const r=await reviewedRows(tx,j.project_id,j.source_snapshot.rows.map((x:any)=>x.row_id));
 if(await digest(r.map(sourceShape))!==j.source_snapshot.digest)fail(409,'A source or its review changed. Refresh the generated draft before resubmitting.');
}
function salesLines(r:any){
 if(r.dataset!=='Sales'||r.source_revision!==r.revision||r.decision!=='Confirmed')fail(400,'Sales sources need current independent confirmation.');
 const code=({KE_VAT_STANDARD:'40000',KE_VAT_ZERO:'40020',KE_VAT_EXEMPT:'40030',KE_VAT_PETROLEUM_8:'40010'} as any)[r.vat_rate_key];
 if(!code)fail(400,'Confirm the sales category and applicable dated VAT treatment before posting.');
 const net=cashAmount(r.normalized.amount),vat=cashAmount(r.normalized.vat||0),signed=(account_code:string,n:number)=>({account_code,debit:Math.max(n,0)/100,credit:Math.max(-n,0)/100,source_status:'Confirmed',source_reference:r.row_id,description:r.normalized.invoice});
 return [signed('10060',net+vat),signed(code,-net),...(vat?[signed('21020',-vat)]:[])];
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
 const items=rows.flatMap((r:any)=>kind==='Sales'?salesLines(r):costJournal(r)),snapshot={kind:'Workbook',rows:rows.map(sourceShape),digest:await digest(rows.map(sourceShape))};
 const result=await newJournal(tx,a,l,kind,p,items,snapshot,true);
 for(const r of rows)await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id,source_revision) values('Workbook row',${r.row_id},${result.journal_id},${l.project_id},${r.revision})`;
 return result;
}
async function report(tx:any,l:any,to:string){
 if(to<day(l.starts_on)||to>day(l.ends_on))fail(400,'Choose an as-of date inside the financial year.');
 const posted=await tx`select x.*,j.kind,j.journal_date,j.reference,j.reversal_of from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) where j.period_id=${l.period_id} and j.status='Posted' and j.journal_date<=${to} order by j.journal_date,j.reference,x.line_no`;
 const accounts=await catalogue(tx),journals=await tx`select journal_id,kind,reference,journal_date,status,prepared_by,last_prepared_by,reviewed_by,review_note,revision from erp_private.ledger_journals where period_id=${l.period_id} order by created_at desc limit 500`;
 const opening=posted.filter((r:any)=>r.kind==='Opening'),movements=posted.filter((r:any)=>r.kind!=='Opening'),tb=trialBalance(accounts,opening,movements),closingIds=new Set(journals.filter((j:any)=>j.kind==='Year close').map((j:any)=>j.journal_id));
 const profit=profitReport(posted.filter((r:any)=>r.kind!=='Opening'&&r.kind!=='Year close'&&!closingIds.has(r.reversal_of)));
 const pending=await tx`select r.row_id,r.source_row,r.dataset,r.account_code,r.normalized,r.revision,v.source_revision,v.decision,j.journal_id,j.status as journal_status from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v using(row_id) left join erp_private.ledger_sources s on s.source_kind='Workbook row' and s.source_key=r.row_id::text left join erp_private.ledger_journals j on j.journal_id=s.journal_id
 where r.project_id=${l.project_id} and b.archived_at is null and not r.is_split_parent and r.dataset in ('Sales','Purchases','Expenditure','Non-eTIMS') and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${day(l.starts_on)} and coalesce(nullif(r.normalized->>'date',''),b.period_end::text)<=${to} and (j.status is distinct from 'Posted') order by r.created_at,r.source_row limit 2001`;
 const assets=await tx`select * from erp_private.ledger_assets where period_id=${l.period_id} order by created_at`,charges=await tx`select c.*,j.status as journal_status from erp_private.ledger_asset_charges c join erp_private.ledger_journals j using(journal_id) where c.project_id=${l.project_id} and c.starts_on>=${day(l.starts_on)} and c.ends_on<=${to}`;
 const ppe_sources=await tx`select r.row_id,r.account_code,r.first_use_date,r.narration,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.ledger_assets a on a.source_row_id=r.row_id where r.project_id=${l.project_id} and b.archived_at is null and r.route=3 and not r.is_split_parent and a.asset_id is null and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${day(l.starts_on)} and coalesce(nullif(r.normalized->>'date',''),b.period_end::text)<=${to} limit 2000`;
 const pendingImports=await tx`select i.import_id from erp_private.period_imports i where i.project_id=${l.project_id} and i.starts_on>=${day(l.starts_on)} and i.ends_on<=${to} and i.status<>'Superseded' and not exists(select 1 from erp_private.ledger_sources s join erp_private.ledger_journals j using(journal_id) where s.source_kind='Period import' and s.source_key=i.import_id::text and j.status='Posted')`;
 const pending_information=await pendingPurchases(tx,l.project_id,day(l.starts_on),to);
 const issues=[];if(pending_information.total)issues.push(pending_information.total+' credit note(s) are Pending information and excluded from posted figures. Complete original invoice details before relying on final totals.');if(pendingImports.length)issues.push(pendingImports.length+' sales/payroll summary import(s) still await independent posting.');if(!journals.some((j:any)=>j.kind==='Opening'&&j.status==='Posted'))issues.push('Opening balances are not yet independently posted.');
 const drafts=journals.filter((j:any)=>j.status!=='Posted');if(drafts.length)issues.push(drafts.length+' journal(s) await preparation or review.');
 if(pending.length)issues.push((pending.length>2000?'More than 2,000':pending.length)+' imported row(s) are not posted.');
 if(assets.some((x:any)=>x.status!=='Approved'))issues.push('Asset classifications or rate evidence still await approval.');
 if(ppe_sources.length)issues.push(ppe_sources.length+' PPE source(s) still need an asset and shared-rate record.');
 if(!journals.some((j:any)=>j.kind==='Stock'&&j.status==='Posted'))issues.push('Confirm stock / cost-of-sales completeness separately before relying on gross profit.');
 const balance=money(tb.reduce((sum:any,r:any)=>sum+r.net,0));if(balance!==0)issues.push('The trial balance is not balanced.');
 return {period:l,pending_information,as_of:to,accounts,tb,profit,journals,pending_sources:pending.slice(0,2000),pending_truncated:pending.length>2000,ppe_sources,assets,charges,issues,ready_to_close:false,disclosure:'Client working papers. Only independently posted entries feed profit. Stock completeness, tax adjustments and annual return readiness require separate review; year closure and KRA filing export are not enabled here.'};
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
 if(p.action==='ledger_periods')return {periods:await tx`select * from erp_private.ledger_periods where project_id=${pid} order by starts_on desc`,rates,accounts:await catalogue(tx),client:(await tx`select legal_entity_type,year_end_month,year_end_day from erp_private.clients where client_id=${project.client_id}`)[0]};
 await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':client-ledger'},0))`;
 if(p.action==='ledger_period_create'){
  leader(a);const c=one(await tx`select * from erp_private.clients where client_id=${project.client_id}`);
  if(!['Limited company','Sole proprietor','Partnership'].includes(c.legal_entity_type)||String(c.entity_evidence||'').trim().length<10||!c.year_end_month||!c.year_end_day)fail(400,'Confirm the client legal entity, supporting evidence and year-end in the profile first.');
  const start=date(p.starts_on),end=date(p.ends_on);if(!start||!end||end<start||end.slice(5)!==String(c.year_end_month).padStart(2,'0')+'-'+String(c.year_end_day).padStart(2,'0'))fail(400,'Use the verified client year-end.');
  return one(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${pid},${project.client_id},${project.handling_firm_id},${start},${end},${c.legal_entity_type},${c.entity_evidence},${a.staff_id}) returning period_id`);
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
  if(p.action==='ledger_journal_submit'){edit(j,a);const issues=journalIssues(await lines(tx,j.journal_id),await catalogue(tx),{kind:j.kind,entityType:l.entity_type,sourceSnapshot:j.source_snapshot});if(issues.length)fail(400,issues.join(' '));await sourceCheck(tx,j);await tx`update erp_private.ledger_journals set status='Submitted',last_prepared_by=${a.staff_id} where journal_id=${j.journal_id}`;}
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
  const accounts=await catalogue(tx),items:any[]=[],sourceRows:any[]=[],sourceControls:any[]=[];
  for(let r=header+1;r<=sheet.rowCount;r++){
   const read=(k:string)=>col(k)?get(r,col(k)!):null,name=String(read('source_name')||'').trim(),legacy=String(read('legacy_code')||'').trim();
   if(!name&&!legacy)continue;
   if(/^difference in books$/i.test(name)){const d=amount(read('debit')??0,'debit at source row '+r),c=amount(read('credit')??0,'credit at source row '+r);sourceControls.push({type:'difference_in_books',source_row:r,difference_kes:Number(d)-Number(c)});continue;}
   if(/^(total|subtotal|grand total|net total|balance check)\b/i.test(name)||/^(total|subtotal|grand total|net total|balance check)\b/i.test(legacy))continue;
   if(items.length>=2000)fail(400,'Split imports into at most 2,000 nonblank source rows.');
   const debit=amount(read('debit')??0,'debit at source row '+r),credit=amount(read('credit')??0,'credit at source row '+r);if(!Number(debit)&&!Number(credit))continue;
   const net=Number(debit)-Number(credit),negative=Number(debit)<0||Number(credit)<0,explicitCode=String(read('tb_item_code')||'').trim(),legacyCode=String(read('account_code')||'').trim(),targetCode=explicitCode||legacyCode;
   if(explicitCode&&legacyCode&&explicitCode!==legacyCode)fail(400,`Source row ${r}: ERP TB item code and master account code do not match.`);
   const account=accounts.find(x=>x.code===targetCode),suppliedRouting=String(read('routing_code')||'').trim().toUpperCase();
   if(suppliedRouting&&account&&suppliedRouting!==String(account.category_code||'').toUpperCase())fail(400,`Source row ${r}: routing code does not match ERP TB item code ${targetCode}.`);
   items.push({account_code:targetCode||null,legacy_code:legacy,source_name:name,debit:Math.max(net,0),credit:Math.max(-net,0),source_status:kind==='Opening'?(!negative&&openingConfirmed?'Confirmed':'Unverified'):!negative&&read('source_status')==='Confirmed'?'Confirmed':'Unverified',source_reference:kind==='Opening'?`${doc.file_name} | ${sheet.name} | row ${r}`:String(read('source_reference')||doc.file_name),description:'Excel row '+r+(negative?' - sign presentation normalised; confirm original source':'' )});
   sourceRows.push({source_row:r,original_debit:debit,original_credit:credit,source_name:name,legacy_code:legacy,tb_item_code:targetCode||'',routing_code:suppliedRouting||String(account?.category_code||''),account_code:targetCode||''});
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
