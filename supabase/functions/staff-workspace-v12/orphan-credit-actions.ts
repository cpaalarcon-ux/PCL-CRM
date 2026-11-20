import ExcelJS from 'exceljs';
import {pendingPurchases} from './purchase-pending.ts';
import {ageingReport,clientRequestText} from './credit-ageing.mjs';
import {fail,uuid,date} from './validation.mjs';
// Purchase credit notes that have no original invoice yet.
// - purchase_ledger_credit_ageing: ageing by bucket and supplier, plus when the client was last asked (read for anyone with the project).
// - purchase_ledger_credit_request: prepares the request to the client (message and list to fill in) and logs it. The ERP does not send
//   anything; the preparer sends it. No liability or suspense balance is created: the credit notes stay outside mapping, posting and totals.
const nairobiToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
const LIMIT=2000;
async function load(tx:any,a:any,p:any){
 if(a.category_code==='INTERN')fail(403,'Interns can access assigned tasks, not purchase ledgers.');
 const pid=uuid(p.project_id),project=(await tx`select p.project_id,p.client_id,p.project_name,c.company_name from erp_private.projects p join erp_private.clients c using(client_id) where p.project_id=${pid} and p.deleted_at is null`)[0];
 if(!project)fail(403,'This project is unavailable to your account.');
 const start=p.starts_on?date(p.starts_on):null,end=p.ends_on?date(p.ends_on):null;
 if(start&&end&&end<start)fail(400,'The end date must follow the start date.');
 const pending=await pendingPurchases(tx,pid,start,end,null,LIMIT),asOf=nairobiToday();
 return {project,pending,report:ageingReport(pending.rows,asOf),asOf,pid};
}
export async function orphanCreditAction(tx:any,a:any,p:any){
 if(!['purchase_ledger_credit_ageing','purchase_ledger_credit_request'].includes(p.action))return undefined;
 const {project,pending,report,asOf,pid}=await load(tx,a,p);
 const last=(await tx`select r.requested_at,r.credit_count,r.gross_amount,s.full_name from erp_private.credit_note_requests r left join erp_private.staff_members s on s.staff_id=r.requested_by where r.project_id=${pid} order by r.requested_at desc limit 1`)[0]||null;
 const truncated=pending.total>pending.rows.length;
 if(p.action==='purchase_ledger_credit_ageing')return {project:{project_id:pid,project_name:project.project_name},total:pending.total,net:pending.net,vat:pending.vat,gross:pending.gross,truncated,report,last_request:last,
  disclosure:`${pending.total} credit note(s) with no original invoice are outside mapping, posting and VAT totals: net KES ${pending.net.toFixed(2)}, VAT KES ${pending.vat.toFixed(2)}, gross KES ${pending.gross.toFixed(2)}. No suspense liability is recorded.`};
 if(!pending.total)fail(400,'No credit notes are waiting for original invoice details.');
 if(truncated)fail(400,`There are ${pending.total} pending credit notes. Choose a date range with at most ${LIMIT} so the whole list goes to the client.`);
 const firm=(await tx`select f.legal_name from erp_private.projects p join erp_private.firms f on f.firm_id=p.handling_firm_id where p.project_id=${pid}`)[0]?.legal_name||'our firm';
 const message=clientRequestText(project.company_name,report.rows,asOf,firm);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Credit notes');
 sheet.addRow([`${project.company_name}: credit notes needing the original invoice, as at ${asOf}`]);
 sheet.addRow(['Fill the last two columns only. Dates as YYYY-MM-DD.']);
 sheet.addRow(['Credit note no.','Credit note date','Supplier','Supplier PIN','Net KES','VAT KES','Gross KES','Days outstanding','Original invoice number','Original invoice date']);
 for(const r of report.rows)sheet.addRow([r.credit_note,r.credit_date,r.party,r.party_pin,r.net,r.vat,r.gross,r.age_days,'','']);
 sheet.eachRow((row:any,n:number)=>row.eachCell((c:any)=>{c.font={name:'Arial',size:10,bold:n<=3};c.alignment={wrapText:true,vertical:'top'};if(n>3&&[5,6,7].includes(c.col))c.numFmt='#,##0.00;(#,##0.00)';if(n>3&&c.col>=9){c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};}}));
 sheet.columns.forEach((c:any)=>c.width=22);
 const bytes=new Uint8Array(await book.xlsx.writeBuffer());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
 const oldest=report.rows.map((r:any)=>r.credit_date).filter(Boolean).sort()[0]||null;
 const req=(await tx`insert into erp_private.credit_note_requests(project_id,requested_by,credit_count,net_amount,vat_amount,gross_amount,oldest_credit_date,items,message)
  values(${pid},${a.staff_id},${report.rows.length},${pending.net},${pending.vat},${pending.gross},${oldest},${tx.json(report.rows.map((r:any)=>({credit_note:r.credit_note,credit_date:r.credit_date,party:r.party,party_pin:r.party_pin,gross:r.gross})))},${message}) returning request_id,requested_at`)[0];
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'credit_note_requests','CREDIT_NOTE_REQUEST_PREPARED',${req.request_id},${tx.json({project_id:pid,credits:report.rows.length,gross:pending.gross})})`;
 return {request_id:req.request_id,requested_at:req.requested_at,count:report.rows.length,message,file_name:'Credit_notes_needing_original_invoice.xlsx',mime_type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',base64:btoa(s),
  note:'Prepared and logged. Nothing has been sent to the client; send the message with the list attached.'};
}
