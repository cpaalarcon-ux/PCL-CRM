import {pendingPurchases} from './purchase-pending.ts';
import ExcelJS from 'exceljs';
import {fail,uuid,text,choice,date} from './validation.mjs';
const groups=['All','Goods for resale','Construction raw materials','Other inventory','Expenditure','PPE','Unmapped'];
const rates=['All','16%','8%','0%','Exempt','Non-eTIMS','Unconfirmed'];
export async function purchaseLedgerAction(tx:any,a:any,p:any){
 if(!['purchase_ledger_read','purchase_ledger_export'].includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'Interns can access assigned tasks, not purchase ledgers.');
 const pid=uuid(p.project_id),project=(await tx`select project_id,client_id,handling_firm_id,project_name from erp_private.projects where project_id=${pid} and deleted_at is null`)[0];
 if(!project)fail(403,'This project is unavailable to your account.');
 const group=choice(p.ledger_group||'All',groups),rate=choice(p.vat_category||'All',rates),search='%'+text(p.search||'',160,false)+'%';
 const start=p.starts_on?date(p.starts_on):null,end=p.ends_on?date(p.ends_on):null;
 if(start&&end&&end<start)fail(400,'The end date must follow the start date.');
 const offset=Math.max(0,Math.min(1000000,Math.trunc(Number(p.offset)||0))),limit=p.action==='purchase_ledger_export'?20001:200;
 const rows=await tx`select * from erp_private.purchase_ledger_items
 where project_id=${pid} and (${group}='All' or ledger_group=${group}) and (${rate}='All' or vat_category=${rate})
 and (${start}::text is null or transaction_date>=${start}) and (${end}::text is null or transaction_date<=${end})
 and concat_ws(' ',supplier,supplier_pin,invoice,narration,account_code,account_name,construction_job,stock_class) ilike ${search}
 order by transaction_date,invoice,source_row,row_id limit ${limit} offset ${p.action==='purchase_ledger_export'?0:offset}`;
 const summary=await tx`select ledger_group,vat_category,account_code,account_name,count(*)::int rows,
 coalesce(sum(net_amount),0) net,coalesce(sum(vat_amount),0) vat,case when count(*) filter(where vat_amount is null)>0 then null else coalesce(sum(net_amount+vat_amount),0) end gross,
 count(*) filter(where vat_amount is null)::int missing_vat,
 count(*) filter(where review_status='Pending review')::int pending_review,
 count(*) filter(where posting_status='Posted' and not has_posted_reversal)::int posted
 from erp_private.purchase_ledger_items where project_id=${pid}
 and (${group}='All' or ledger_group=${group}) and (${rate}='All' or vat_category=${rate})
 and (${start}::text is null or transaction_date>=${start}) and (${end}::text is null or transaction_date<=${end})
 and concat_ws(' ',supplier,supplier_pin,invoice,narration,account_code,account_name,construction_job,stock_class) ilike ${search}
 group by ledger_group,vat_category,account_code,account_name order by ledger_group,account_code,vat_category`;
 const total=summary.reduce((n:number,r:any)=>n+r.rows,0);
 const pending_information=await pendingPurchases(tx,pid,start,end);
 const pendingNotice=pending_information.total?` ${pending_information.total} credit note(s) pending original invoice details are excluded from these figures: net KES ${pending_information.net.toFixed(2)}, VAT KES ${pending_information.vat.toFixed(2)}, gross KES ${pending_information.gross.toFixed(2)}. Pending totals cover the project/date window, before ledger, VAT and search filters. Complete them before relying on final totals.`:'';
 const disclosure='Purchase movements from classified import data. Mapping is not posting or VAT approval. These are not stock-on-hand balances. Posted accounting entries, stock issues/consumption and the approved asset register remain separate controls.'+pendingNotice;
 if(p.action==='purchase_ledger_read')return {project,pending_information,rows,summary,total,offset,page_size:200,groups,rates,disclosure};
 if(rows.length>20000)fail(400,'Narrow the date, account or ledger filters to export at most 20,000 rows.');
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Purchase ledger'),heads=['Date','Supplier','PIN','Invoice / note','Original invoice','Narration','Ledger','Stock class','Construction job / site','VAT category','Net KES','VAT KES','Gross KES','Account','Account name','Review','Posting status','Posting reference','Posted reversal','First-use status','First-use date','Source batch','Source row'];
 sheet.addRow([project.project_name]);sheet.addRow([disclosure]);sheet.addRow(heads);
 for(const r of rows)sheet.addRow([r.transaction_date,r.supplier,r.supplier_pin,r.invoice,r.original_invoice,r.narration,r.ledger_group,r.stock_class,r.construction_job,r.vat_category,r.net_amount==null?null:Number(r.net_amount),r.vat_amount==null?null:Number(r.vat_amount),r.net_amount==null||r.vat_amount==null?null:Number(r.net_amount)+Number(r.vat_amount),r.account_code,r.account_name,r.review_status,r.posting_status||'Not prepared',r.posting_reference,r.has_posted_reversal?'Yes':'No',r.first_use_status,r.first_use_date,r.batch_id,r.source_row]);
 sheet.eachRow((row:any,n:number)=>row.eachCell((c:any)=>{c.font={name:'Arial',size:9,bold:n===3};c.alignment={wrapText:true,vertical:'top'};if(n>3&&[11,12,13].includes(c.col))c.numFmt='#,##0.00;(#,##0.00)';}));
 sheet.columns.forEach((c:any)=>c.width=22);sheet.autoFilter={from:'A3',to:'W3'};
 const bytes=new Uint8Array(await book.xlsx.writeBuffer());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'purchase_ledger_items','EXPORT',${pid},${tx.json({ledger_group:group,vat_category:rate,starts_on:start,ends_on:end,rows:total})})`;
 return {file_name:'Purchase_Ledger.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:btoa(s),rows:total};
}
