import {fail,uuid,text,choice,date,revision} from './validation.mjs';
import {assertSupportedPeriod} from './supported-period.ts';
import {readSourceSheet} from './source-reader.mjs';
import {detectImportProfile,salesTotals,payrollRows,rateKeys} from './import-profiles.mjs';
import {keys,pickRate,payrollFromRules} from './tax-registry.mjs';
import {preferredRates,stagingRates} from './testing-rates.mjs';
import {digest} from './improvement-actions.ts';
const one=(r:any[])=>{if(!r.length)fail(403,'This import is unavailable to your account.');return r[0];};
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const reviewer=(a:any)=>['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code);
// Option A: a tax case may use a submitted sales/payroll summary; approving the case confirms it.
// A submitted replacement hides the confirmed import it replaces so nothing is counted twice.
export function effectiveImports(rows:any[]){const replaced=new Set(rows.filter((r:any)=>r.status==='Submitted').flatMap((r:any)=>r.replaces_ids||[]));return rows.filter((r:any)=>!replaced.has(r.import_id));}
export async function summarySalesRows(tx:any,pid:string,start:string,end:string,{includeSubmitted=false}:{includeSubmitted?:boolean}={}){
 const statuses=includeSubmitted?['Confirmed','Submitted']:['Confirmed'];
 const imports=effectiveImports(await tx`select * from erp_private.period_imports where project_id=${pid} and kind='Sales' and status=any(${tx.array(statuses)}::text[]) and starts_on>=${start} and ends_on<=${end} order by starts_on,import_id`);
 return imports.flatMap((s:any)=>s.payload.groups.map((g:any,i:number)=>({row_id:s.import_id+':'+g.vat_category,import_id:s.import_id,revision:s.revision,source_revision:s.revision,dataset:'Sales',source_row:i+1,normalized:{date:day(s.ends_on),invoice:'Sales summary '+day(s.starts_on)+' '+g.vat_category,amount:g.net,vat:g.vat,vat_category:g.vat_category},decision:'Confirmed',review_details:{activity_id:s.activity_id||null},vat_rate_key:(rateKeys as any)[g.vat_category],reviewed_by:s.reviewed_by,uploaded_by:s.prepared_by,period_start:day(s.starts_on),period_end:day(s.ends_on),is_period_summary:true})));
}
async function coverage(tx:any,cid:string,kind:string,start:string,end:string){
 return await tx`select import_id,project_id,starts_on,ends_on,status from erp_private.period_imports where client_id=${cid} and kind=${kind} and status<>'Superseded' and starts_on<=${end} and ends_on>=${start} order by starts_on,import_id`;
}
async function replacementSafe(tx:any,ids:string[]){
 if(!ids.length)return;
 const linked=await tx`select j.journal_id,j.status from erp_private.ledger_sources s join erp_private.ledger_journals j using(journal_id) where s.source_kind='Period import' and s.source_key=any(${tx.array(ids)}::text[]) and not exists(select 1 from erp_private.ledger_journals v where v.reversal_of=j.journal_id and v.status='Posted')`;
 if(linked.length)fail(409,'A covered summary already has an accounting entry. Complete its reviewed reversal before replacing it; open drafts must be resolved first.');
}
// One import belongs to one business activity. When exactly one activity covers the period it is
// used automatically; with several, the preparer chooses, or leaves it blank (Unallocated).
async function importActivity(tx:any,clientId:string,start:string,end:string,requested:any){
 const acts=await tx`select activity_id,activity_name from erp_private.client_activities where client_id=${clientId} and effective_from<=${end} and (effective_to is null or effective_to>=${start})`;
 if(requested){const id=uuid(requested);if(!acts.some((x:any)=>x.activity_id===id))fail(400,'Choose a business activity of this client that covers the import period.');return id;}
 return acts.length===1?acts[0].activity_id:null;
}
async function prepare(tx:any,a:any,project:any,p:any,storage:any){
 const kind=choice(p.kind,['Sales','Payroll']),start=date(p.starts_on),end=date(p.ends_on);
 if(!start||!end||end<start||Date.parse(end)-Date.parse(start)>366*86400000)fail(400,'Choose the reporting period.');
 await assertSupportedPeriod(tx,project.client_id,start);
 if(kind==='Payroll'&&(start.slice(8)!=='01'||new Date(Date.parse(end)+86400000).toISOString().slice(8,10)!=='01'||start.slice(0,7)!==end.slice(0,7)))fail(400,'Payroll must cover one complete calendar month.');
 const doc=one(await tx`select * from erp_private.documents where document_id=${uuid(p.document_id)} and project_id=${project.project_id} and deleted_at is null and archived_at is null for share`);
 if(!['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/zip'].includes(doc.mime_type))fail(400,'Choose CSV, Excel or ZIP import data.');
 const downloaded=await storage.download(doc.object_key);if(downloaded.error||!downloaded.data)fail(404,'The import source is unavailable.');
 const bytes=new Uint8Array(await downloaded.data.arrayBuffer()),first=await readSourceSheet(bytes,doc.file_name,p.sheet_name||null),sheets:any[]=[];
 const available:any[]=[];const selection=Array.isArray(p.members)?p.members:p.sheet_name?[p.sheet_name]:null;
 for(const item of first.sheets.filter((s:any)=>!s.unsupported)){
  // Read each selected sheet once. The bounded reader rejects macros and unsafe archives.
  const out=item.name===first.sheet.name?first:await readSourceSheet(bytes,doc.file_name,item.name),profile:any=detectImportProfile(out.sheet);
  if(profile?.id==='INVOICE-HEADERS-v1'&&kind==='Sales')profile.dataset='Sales';
  available.push({name:out.sheet.name,profile:profile?.name||'Review format',kind:profile?.dataset||null,recognised:!!profile?.recognised});
  if(selection&&!selection.includes(out.sheet.name))continue;
  if(profile?.recognised&&profile.dataset===kind)sheets.push({sheet:out.sheet,profile});
  else if(selection?.includes(out.sheet.name)||kind==='Sales'&&/SEC_(B|C|D|D1|E)_/i.test(out.sheet.name))fail(400,'Review the source layout for '+out.sheet.name+'. It cannot be recognised safely.');
 }
 if(!sheets.length){const candidates=available.filter(x=>x.kind===kind&&x.recognised).map(x=>x.name);fail(400,candidates.length?`No ${kind.toLowerCase()} worksheet was selected. Choose: ${candidates.join(', ')}.`:`No recognised ${kind.toLowerCase()} worksheet was found. Check that the approved template and employee worksheet were uploaded.`);}
 if(kind==='Payroll'&&sheets.length!==1)fail(400,`More than one payroll worksheet was recognised (${sheets.map(s=>s.sheet.name).join(', ')}). Choose one worksheet and preview again.`);
 let payload:any;
 if(kind==='Sales'){
  payload=salesTotals(sheets,start,end);
  if(sheets.some(s=>s.profile.summary)){
   if(!['After credit notes','Before credit notes'].includes(p.credit_basis))payload.issues.push('Confirm whether the sales totals already include credit notes.');
   if(p.credit_basis==='Before credit notes'){
    const credits=p.credits||{};
    for(const g of payload.groups){const entry=credits[g.vat_category];if(!entry||entry.net===''||entry.vat===''||![entry.net,entry.vat].every(v=>Number.isFinite(Number(v))&&Number(v)>=0)) {payload.issues.push('Enter the credit-note net and VAT reductions for '+g.vat_category+'. Use zero where none.');continue;}g.credit_net=round(Number(entry.net));g.credit_vat=round(Number(entry.vat));if(['0%','Exempt'].includes(g.vat_category)&&g.credit_vat)payload.issues.push('Zero-rated / exempt credits cannot reduce VAT.');g.net=round(g.net-g.credit_net);g.vat=round(g.vat-g.credit_vat);g.gross=round(g.net+g.vat);}
   }
   payload.original_credit_basis=p.credit_basis;
  }
 }else{
  const source:any=payrollRows(sheets[0].sheet,sheets[0].profile),availableRules=stagingRates(await tx`select * from erp_private.tax_rates where status in('Approved','Testing') and deleted_at is null`,typeof Deno==='undefined'?'https://yfjiculexbzpkvtapudk.supabase.co':Deno.env.get('SUPABASE_URL')||''),rules:any={};
  payload={...source,employees:[],calculated:[],differences:[],rules:[],totals:{}};
  for(const key of keys.PAYE){try{rules[key]=pickRate(preferredRates(availableRules,key,start,end),key,start,end);payload.rules.push(rules[key]);}catch(e){payload.issues.push((e as Error).message);}}
  for(const r of source.rows){
   // Residence: the file's own column wins; then the staff member's choice for the row; a Kenyan national ID (7 or 8 digits) is assumed Resident
   // once the preparer confirms the assumption; anything else (passport, alien ID, no ID) has to be chosen by hand.
   const chosen=p.residency_choices?.[String(r.source_row)],nationalId=/^\d{7,8}$/.test(String(r.employee_id||'').replace(/\s+/g,''));
   let resident:boolean|null,basis:string;
   if(r.resident!=null){resident=r.resident;basis='Stated in the file';}
   else if(chosen==='Resident'||chosen==='Non-resident'){resident=chosen==='Resident';basis='Chosen by staff';}
   else if(nationalId){resident=true;basis='Assumed Resident from national ID';if(p.residents_confirmed!==true)payload.issues.push(`Row ${r.source_row}: ${r.name} is assumed Resident from the national ID. Tick the residence confirmation to accept, or choose Non-resident for this employee.`);}
   else{resident=null;basis='Needs choice';payload.issues.push(`Row ${r.source_row}: choose Resident or Non-resident for ${r.name}. The ID is not a Kenyan national ID (a passport, alien ID or blank), so the ERP does not assume.`);}
   if(r.insurance_relief>0)payload.issues.push(`Row ${r.source_row}: insurance relief needs a supported premium in the payroll tax computation.`);
   const e:any={name:r.name,pin:r.pin,employee_id:r.employee_id,gross:r.gross,taxable_benefits:r.benefits||0,resident:resident===true,residency_basis:basis,source_row:r.source_row,other_pension:r.other_pension||0,postretirement_medical:r.postretirement_medical||0,mortgage_interest:r.mortgage_interest||0,source_paye:r.paye??0,evidence_reference:doc.file_name};
   payload.employees.push(e);
   if(r.issues.length||resident===null||Object.keys(rules).length!==keys.PAYE.length)continue;
   try{const c:any=payrollFromRules({employees:[e]},rules).employees[0];c.net_pay=round(c.net_before_other_deductions-(r.other_deductions||0));c.other_deductions=r.other_deductions||0;c.source_row=r.source_row;payload.calculated.push(c);
    for(const [s,k] of [['gross','gross'],['taxable','taxable'],['gross_tax','gross_tax'],['personal_relief','personal_relief'],['paye','paye'],['employee_nssf','employee_nssf'],['employee_ahl','employee_ahl'],['shif','shif'],['net','net_pay']])if(r[s]==null)payload.differences.push({row:r.source_row,field:s,source:null,calculated:c[k],difference:null});else if(Math.abs(Number(r[s])-c[k])>.011)payload.differences.push({row:r.source_row,field:s,source:r[s],calculated:c[k],difference:round(c[k]-r[s])});
   }catch(e){payload.issues.push(`Row ${r.source_row}: ${(e as Error).message}`);}
  }
  // Rounding: a tax or deduction amount within KES 1 of the file is a rounding difference, not a mistake, while the month's rounding on amounts
  // payable to KRA, NSSF, SHA and the housing levy stays within the Partner-set cap. Gross pay is never tolerated.
  const cap=Number((await tx`select monthly_cap_kes from erp_private.payroll_tolerance`)[0]?.monthly_cap_kes??50),perEmployee=1,payable=['paye','employee_nssf','employee_ahl','shif'];
  const small=(d:any)=>d.source!=null&&d.field!=='gross'&&Math.abs(d.difference)<=perEmployee+.0001,rounding=payload.differences.filter(small);
  const used=round(rounding.filter((d:any)=>payable.includes(d.field)).reduce((n:number,d:any)=>n+Math.abs(d.difference),0)),within=used<=cap+.0001;
  payload.tolerance={per_employee:perEmployee,monthly_cap:cap,used,within,small:rounding.length,applied:within?rounding.length:0};
  if(within&&rounding.length){payload.rounding=rounding;payload.differences=payload.differences.filter((d:any)=>!small(d));}else payload.rounding=[];
  payload.residency={stated:payload.employees.filter((e:any)=>e.residency_basis==='Stated in the file').length,assumed:payload.employees.filter((e:any)=>e.residency_basis==='Assumed Resident from national ID').length,chosen:payload.employees.filter((e:any)=>e.residency_basis==='Chosen by staff').length,needs_choice:payload.employees.filter((e:any)=>e.residency_basis==='Needs choice').length};
  payload.testing=payload.rules.some((r:any)=>r.approval_scope==='Testing');
  for(const key of ['gross','taxable','gross_tax','paye','shif','employee_nssf','employee_ahl','employer_nssf','employer_ahl','nita','net_pay','other_deductions'])payload.totals[key]=round(payload.calculated.reduce((n:number,c:any)=>n+Number(c[key]||0),0));
  payload.totals.employee_pension=round(payload.employees.reduce((n:number,e:any)=>n+Number(e.other_pension||0),0));
  payload.source_count=source.rows.length;
 }
 const members=sheets.map(s=>({name:s.sheet.name,profile:s.profile.id})),hash=await digest({sha:doc.sha256,kind,start,end,members,credit_basis:p.credit_basis,credits:p.credits,residents_confirmed:p.residents_confirmed,residency_choices:p.residency_choices||null,payload});
 await tx`insert into erp_private.document_access_events(document_id,actor_auth_id,action) values(${doc.document_id},${a.auth_user_id},'DOWNLOAD')`;
 return {kind,starts_on:start,ends_on:end,document_id:doc.document_id,payload,source_hash:hash,source_members:members,available,overlaps:await coverage(tx,project.client_id,kind,start,end)};
}
function cleanNote(v:any){return String(v||'').trim();}
// Confirms a submitted period import. Used by the stand-alone review (tax-only use) and by
// Gate B: posting the journal built from a submitted import confirms that import in the same action.
export async function confirmPeriodImport(tx:any,a:any,project:any,r:any,note:any,{exceptCaseId=null}:{exceptCaseId?:string|null}={}){
 const pid=project.project_id;
 if(r.status!=='Submitted')fail(409,'Only a submitted import can be confirmed.');
 if(r.prepared_by===a.staff_id||!reviewer(a))fail(403,'A different Supervisor, Manager or Partner must review the source summary.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
 const open=exceptCaseId
  ?!(await tx`select 1 from erp_private.tax_cases c where c.project_id=${pid} and c.case_id<>${exceptCaseId} and c.status in ('Submitted','Locked','Filed') and c.starts_on<=${r.ends_on} and c.ends_on>=${r.starts_on} union all select 1 from erp_private.sales_reconciliations x where x.project_id=${pid} and x.review_type='Monthly' and x.status in ('Submitted','Locked') and x.starts_on<=${r.ends_on} and x.ends_on>=${r.starts_on} limit 1`).length
  :(await tx`select erp_private.tax_period_open(${pid}::uuid,${r.starts_on}::date,${r.ends_on}::date) open`)[0].open;
 if(!open)fail(409,'The tax period is submitted or locked.');
 const overlaps=(await coverage(tx,project.client_id,r.kind,day(r.starts_on),day(r.ends_on))).filter((o:any)=>o.import_id!==r.import_id);
 if(overlaps.length!==r.replaces_ids.length||overlaps.some((o:any)=>!r.replaces_ids.includes(o.import_id)))fail(409,'Period coverage changed. Create a fresh replacement.');
 await replacementSafe(tx,r.replaces_ids);
 await tx`select set_config('erp.period_import_replacement','confirmed',true)`;
 if(r.replaces_ids.length)await tx`update erp_private.period_imports set status='Superseded' where import_id=any(${tx.array(r.replaces_ids)}::uuid[])`;
 await tx`update erp_private.period_imports set status='Confirmed',reviewed_by=${a.staff_id},review_note=${text(note,4000)} where import_id=${r.import_id}`;
}
export async function periodImportAction(tx:any,a:any,p:any,storage:any){
 if(!String(p.action).startsWith('period_import_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
 const pid=uuid(p.project_id),project=one(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`);
 if(p.action==='period_import_list')return {payroll_cap:Number((await tx`select monthly_cap_kes from erp_private.payroll_tolerance`)[0]?.monthly_cap_kes??50),activities:await tx`select activity_id,activity_name,pack_code,effective_from,effective_to from erp_private.client_activities where client_id=${project.client_id} order by activity_name`,imports:await tx`select i.import_id,i.kind,i.starts_on,i.ends_on,i.status,i.prepared_by,i.reviewed_by,i.revision,i.created_at,i.activity_id,a.activity_name from erp_private.period_imports i left join erp_private.client_activities a using(activity_id) where i.project_id=${pid} order by i.created_at desc limit 500`,documents:await tx`select document_id,file_name from erp_private.documents where project_id=${pid} and deleted_at is null and archived_at is null and mime_type in ('text/csv','application/zip','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') order by uploaded_at desc`,periods:await tx`select period_id,starts_on,ends_on from erp_private.ledger_periods where project_id=${pid} and status='Open'`};
 if(p.action==='period_import_tolerance'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can change the payroll rounding cap.');
  const cap=Number(p.monthly_cap_kes),why=text(p.reason||'',500,false).trim();
  if(!Number.isFinite(cap)||cap<0||cap>1000)fail(400,'The cap must be between KES 0 and KES 1,000.');if(why.length<10)fail(400,'Give the reason for the change (at least 10 characters).');
  const before=(await tx`select monthly_cap_kes from erp_private.payroll_tolerance`)[0];
  const done=await tx`update erp_private.payroll_tolerance set monthly_cap_kes=${Math.round(cap*100)/100},reason=${why},updated_by=${a.staff_id},updated_at=now() where singleton returning monthly_cap_kes`;
  if(!done.length)fail(403,'The cap could not be changed.');
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values) values(${a.auth_user_id},current_user,'payroll_tolerance','PAYROLL_ROUNDING_CAP_CHANGED',${pid},${tx.json({monthly_cap_kes:before?.monthly_cap_kes})},${tx.json({monthly_cap_kes:cap,reason:why})})`;
  return {ok:true,monthly_cap_kes:Number(done[0].monthly_cap_kes)};
 }
 if(p.action==='period_import_read')return {record:one(await tx`select * from erp_private.period_imports where import_id=${uuid(p.import_id)} and project_id=${pid}`)};
 if(project.status==='Archived')fail(400,'Archived projects retain read-only accounting history.');
 if(p.action==='period_import_preview')return await prepare(tx,a,project,p,storage);
 if(p.action==='period_import_save'){
  if(p.confirmed_client_id!==project.client_id)fail(400,'Confirm the legal client before importing.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':period-import'},0))`;
  const x=await prepare(tx,a,project,p,storage);
  const existing=(await tx`select import_id from erp_private.period_imports where project_id=${pid} and source_hash=${x.source_hash}`)[0];if(existing)return {...existing,reused:true};
  if(x.source_hash!==p.preview_hash)fail(409,'The source or calculations changed. Preview and confirm again.');
  if(x.payload.issues.length)fail(400,'Resolve the displayed import exceptions before confirming.');
  if(x.kind==='Payroll'&&p.use_calculated!==true)fail(400,'Review the source and ERP calculations, then confirm the displayed ERP calculations before saving.');
  const reasons:any={};
  if(x.kind==='Payroll'){
   for(const [k,v] of Object.entries(p.difference_reasons||{}))if(typeof v==='string'&&v.trim().length>=5)reasons[String(k).slice(0,40)]=v.trim().slice(0,500);
   const uncovered=x.payload.differences.filter((d:any)=>d.source==null||!reasons[d.row+':'+d.field]);
   if(uncovered.length&&cleanNote(p.notes).length<10)fail(400,uncovered.some((d:any)=>d.source==null)?'The file has missing amounts. Add a short note explaining them before saving.':'Give a reason for each payroll difference (at least 5 characters), or add a short note covering them, before saving.');
   x.payload.review_attestations={use_calculated_confirmed:true,source_comparison_reviewed:true,difference_reasons:reasons,
    ...(x.payload.residency.assumed?{residency_assumed:{confirmed:true,employees:x.payload.residency.assumed,confirmed_by:a.staff_id,confirmed_at:new Date().toISOString()}}:{})};
  }
  if(!(await tx`select erp_private.tax_period_open(${pid}::uuid,${x.starts_on}::date,${x.ends_on}::date) open`)[0].open)fail(409,'Return submitted tax work before replacing its inputs. Locked tax periods require a controlled amendment.');
  if(x.kind==='Sales'&&(await tx`select r.row_id from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.client_id=${project.client_id} and r.dataset='Sales' and b.archived_at is null and b.period_start<=${x.ends_on} and b.period_end>=${x.starts_on} limit 1`).length)fail(409,'This period has legacy invoice-based sales. Reconcile and migrate those sources before adding category totals.');
  const ids=Array.isArray(p.replaces_ids)?p.replaces_ids.map(uuid):[];
  if(x.kind==='Payroll'&&x.payload.residency.assumed)await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'period_imports','PAYROLL_RESIDENCY_ASSUMED',${pid},${tx.json({employees:x.payload.residency.assumed,period:x.starts_on})})`;
  if(x.overlaps.some((o:any)=>o.project_id!==pid||day(o.starts_on)<x.starts_on||day(o.ends_on)>x.ends_on))fail(409,'The new summary must fully cover the periods it replaces in this project. Partial overlaps are not added.');
  if(ids.length!==x.overlaps.length||x.overlaps.some((o:any)=>!ids.includes(o.import_id)))fail(409,'Explicitly confirm replacement of every overlapping summary.');
  await replacementSafe(tx,ids);
  const activityId=await importActivity(tx,project.client_id,x.starts_on,x.ends_on,p.activity_id);
  return one(await tx`insert into erp_private.period_imports(project_id,client_id,document_id,kind,starts_on,ends_on,payload,source_hash,source_members,replaces_ids,prepared_by,activity_id,notes) values(${pid},${project.client_id},${x.document_id},${x.kind},${x.starts_on},${x.ends_on},${tx.json(x.payload)},${x.source_hash},${tx.json(x.source_members)},${tx.array(ids)}::uuid[],${a.staff_id},${activityId},${text(p.notes||'',4000,false)}) returning import_id`);
 }
 await tx`select pg_advisory_xact_lock(hashtextextended(${project.client_id+':period-import'},0))`;
 const r=one(await tx`select * from erp_private.period_imports where import_id=${uuid(p.import_id)} and project_id=${pid} for update`);
 if(String(r.revision)!==revision(p.revision))fail(409,'The import changed. Refresh first.');
 if(p.action==='period_import_submit'){
  if(r.prepared_by!==a.staff_id||!['Draft','Returned'].includes(r.status))fail(403,'The preparer must submit this draft.');
  await tx`update erp_private.period_imports set status='Submitted' where import_id=${r.import_id}`;return {ok:true};
 }
 if(p.action==='period_import_review'){
  if(!reviewer(a)||r.prepared_by===a.staff_id||r.status!=='Submitted')fail(403,'A different Supervisor, Manager or Partner must review.');
  const status=choice(p.status,['Confirmed','Returned']);
  if(status==='Confirmed'){await confirmPeriodImport(tx,a,project,r,p.review_note);return {ok:true};}
  if(!(await tx`select erp_private.tax_period_open(${pid}::uuid,${r.starts_on}::date,${r.ends_on}::date) open`)[0].open)fail(409,'This summary is in submitted or locked tax work. Return the tax case first.');
  await tx`update erp_private.period_imports set status=${status},reviewed_by=${a.staff_id},review_note=${text(p.review_note,4000)} where import_id=${r.import_id}`;return {ok:true};
 }
 if(p.action==='period_import_payroll_tax'){
  if(r.kind!=='Payroll'||!['Submitted','Confirmed'].includes(r.status))fail(400,'Submit the payroll summary first. It is confirmed when the PAYE computation is approved.');
  await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
  const cases=await tx`select * from erp_private.tax_cases where project_id=${pid} and kind='PAYE' and starts_on<=${r.ends_on} and ends_on>=${r.starts_on}`;
  let c=cases[0];if(c&&(day(c.starts_on)!==day(r.starts_on)||day(c.ends_on)!==day(r.ends_on)||!['Draft','Returned'].includes(c.status)||c.prepared_by!==a.staff_id))fail(409,'Use the assigned preparer and matching open PAYE period.');
  if(!c)c=one(await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,prepared_by) values(${pid},'PAYE',${r.starts_on},${r.ends_on},${a.staff_id}) returning *`);
  const employees=r.payload.employees.map((e:any,i:number)=>({...e,source_paye:r.payload.calculated[i].paye}));
  if(c.inputs?.period_import_id&&c.inputs.period_import_id!==r.import_id&&!r.replaces_ids.includes(c.inputs.period_import_id))fail(409,'This PAYE case already uses another payroll import. Review its replacement first.');
  await tx`update erp_private.tax_cases set inputs=${tx.json({...c.inputs,employees,period_import_id:r.import_id})} where case_id=${c.case_id}`;return {case_id:c.case_id};
 }
 fail(404,'Unknown period import action.');
}
