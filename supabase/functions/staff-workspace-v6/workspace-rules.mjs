import {fail,date,text,choice,uuid} from './validation.mjs';
export const frequencies=['Once-off','Weekly','Monthly','Weekly + Monthly','Weekly + Monthly + Annually','Quarterly','Annually'];
export const obligations=['VAT','PAYE','TOT','Payroll'];
export const projectEditor=a=>['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code);
export const nairobiDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function scheduleInput(p){
 const starts=date(p.starts_on),ends=date(p.ends_on);
 if(!starts||!ends||ends<starts||new Date(ends)-new Date(starts)>5*366*86400000)fail(400,'Choose a valid schedule of up to five years.');
 const selected=Array.isArray(p.obligations)?[...new Set(p.obligations.map(x=>choice(x,obligations)))]:[];
 return {frequency:choice(p.frequency,frequencies),pack:choice(p.pack,['General','Tax Compilation']),starts_on:starts,ends_on:ends,
  enabled:p.enabled!==false,obligations:selected,assigned_to:uuid(p.assigned_to),reviewer_id:uuid(p.reviewer_id)};
}
export function defaultProjectName(client,service,starts){return `${client} - ${service} - ${(starts||nairobiDate()).slice(0,4)}`.slice(0,200);}
export function timeInput(p){
 const workDate=date(p.work_date),hours=Number(p.hours);
 if(!workDate||workDate>nairobiDate()||!Number.isFinite(hours)||hours<=0||hours>24||Math.abs(hours*100-Math.round(hours*100))>0.000001)fail(400,'Enter a past or current work date and hours between 0.01 and 24 (two decimals).');
 return {task_id:uuid(p.task_id),work_date:workDate,hours,description:text(p.description,2000),billable:p.billable!==false,status:choice(p.status||'Draft',['Draft','Submitted'])};
}
export function excelValue(v){
 if(v==null)return '';if(v instanceof Date)return v.toISOString().slice(0,10);
 if(typeof v==='string'||typeof v==='number'||typeof v==='boolean')return v;
 if(v.formula||v.sharedFormula)return excelValue(v.result);
 if(v.richText)return v.richText.map(x=>x.text).join('');
 if(v.text)return String(v.text);if(v.error)return String(v.error);return '';
}
export const importFields=['date','invoice','party','party_pin','line_id','description','amount','vat','reference','debit','credit','account','vat_category','original_invoice','original_invoice_date','document_type'];
export function importMap(input,dataset){
 const map={};for(const [k,v] of Object.entries(input||{})){if(!importFields.includes(k))fail(400,'Unknown mapping field.');if(v!==''&&v!=null){const n=Number(v);if(!Number.isInteger(n)||n<1||n>80)fail(400,'Map columns 1–80.');map[k]=n;}}
 if(new Set(Object.values(map)).size!==Object.values(map).length)fail(400,'Each source column can map to only one field.');
 const required=dataset==='Bank'?['date','reference']:dataset==='General'?[]:['date','invoice','amount'];
 if(required.some(k=>!map[k])||!Object.keys(map).length)fail(400,'Map the required columns.');
 if(dataset==='Bank'&&!map.debit&&!map.credit)fail(400,'Map debit and/or credit amounts.');return map;
}
export function money(v){
 if(v==null||!['string','number'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v))return null;
 let s=typeof v==='number'&&v!==0&&Math.abs(v)<1e-6?v.toFixed(20):String(v).trim();
 if(!s||s.length>100)return null;if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);
 if(s.includes(',')&&!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s))return null;
 s=s.replace(/,/g,'');const m=s.match(/^(-?)(\d+)(?:\.(\d+))?$/);if(!m)return null;
 const fraction=(m[3]||'').padEnd(3,'0');let cents=BigInt(m[2])*100n+BigInt(fraction.slice(0,2));
 if(fraction[2]>='5')cents++;if(cents>=100000000000000n)return null;
 const amount=Number(cents)/100;return amount===0?0:m[1]?-amount:amount;
}
export function excelDate(v){if(v instanceof Date)v=Number.isFinite(v.getTime())?v.toISOString().slice(0,10):'';if(typeof v==='number'&&v>0&&v<100000)v=new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);let s=String(v||'').trim(),m=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);if(m)s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;try{return date(s);}catch{return null;}}
export function normalizeImport(values,map,dataset,start,end){
 const raw=Object.fromEntries(Object.entries(map).map(([key,col])=>[key,values[col-1]??'']));
 const hasData=dataset==='General'?Object.values(raw).some(v=>String(v).trim()!==''):
  (dataset==='Bank'?['date','reference','debit','credit']:['date','invoice','party','party_pin']).some(k=>raw[k]!=null&&String(raw[k]).trim()!==''&&raw[k]!==0);
 if(!hasData)return null;
 const row={};for(const [key,value] of Object.entries(raw))row[key]=['amount','vat','debit','credit'].includes(key)?money(value):['date','original_invoice_date'].includes(key)?excelDate(value):String(value).trim();
 const issues=[];
 if(dataset!=='General'){
  if(!row.date||row.date<start||row.date>end)issues.push('Date is missing, invalid or outside the selected period.');
  if(dataset==='Bank'){
   if(!row.reference)issues.push('Bank reference is required.');
   if((row.debit||0)<0||(row.credit||0)<0||((row.debit||0)>0)===((row.credit||0)>0))issues.push('Enter one positive debit or credit.');
  }else{
   if(!row.invoice)issues.push('Invoice / CU reference is required.');
   if(row.amount===null)issues.push('Net amount is missing or invalid.');
   if(map.vat&&raw.vat!==''&&row.vat===null)issues.push('VAT amount is invalid.');
   if(map.original_invoice_date&&raw.original_invoice_date!==''&&!row.original_invoice_date)issues.push('Original invoice date is invalid.');
   if(row.original_invoice_date&&row.date&&row.original_invoice_date>row.date)issues.push('Original invoice date cannot be later than this document date.');
   if(row.party_pin&&!/^[A-Z]\d{9}[A-Z]$/i.test(row.party_pin))issues.push('Supplier / buyer PIN format is invalid.');
  }
 }
 const key=dataset==='General'?JSON.stringify(row):dataset==='Bank'?JSON.stringify([row.account||'',row.reference?.toUpperCase(),row.date,row.debit,row.credit]):JSON.stringify([row.invoice?.toUpperCase(),row.party_pin?.toUpperCase()||row.party?.toUpperCase()||'',row.line_id||'']);
 return {raw,row,issues,key};
}
// Bound ZIP expansion before passing a workbook to ExcelJS. No macros or external-link packages.
export function checkWorkbookZip(bytes){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)fail(400,'The XLSX archive is invalid.');
 const count=view.getUint16(end+10,true);let pos=view.getUint32(end+16,true),total=0;
 if(count>500||count===65535)fail(400,'This workbook has too many components.');
 for(let n=0;n<count;n++){
  if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)fail(400,'Invalid workbook directory.');
  const size=view.getUint32(pos+24,true),len=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true);
  if(pos+46+len+extra+comment>bytes.length)fail(400,'Invalid workbook component.');
  const name=new TextDecoder().decode(bytes.slice(pos+46,pos+46+len));
  if(/vbaProject|(^|\/)\.\.(\/|$)/i.test(name)||view.getUint16(pos+8,true)&1)fail(400,'Use an unencrypted XLSX without macros.');
  total+=size;if(total>25*1024*1024||size>12*1024*1024)fail(400,'Workbook expands beyond the supported limit. Split it into smaller workbooks.');
  pos+=46+len+extra+comment;
 }
 return total;
}
