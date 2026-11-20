import {fail,uuid} from './validation.mjs';
import {logPayrollRead} from './payroll-access-log.ts';
import {buildP9,p9Csv,p9FileName,P9_COLUMNS} from './p9-rules.mjs';
// Build 2877: P9 tax deduction cards for a calendar year, from the confirmed payroll months only. Preparing never changes anything. Releasing (release=true) is allowed only when every
// card is complete and agrees with the payroll runs; each released card is recorded insert-only with a hash of the file. The files hold personal data and are not kept.
const ACTIONS=['statutory_file_p9_read','statutory_file_p9_prepare'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const hex=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(n=>n.toString(16).padStart(2,'0')).join('');
const money=(c:number)=>Math.round(c)/100;

async function confirmedMonths(tx:any,clientId:string,year:number){
 const rows=await tx`select import_id,starts_on,ends_on,revision,payload from erp_private.period_imports where client_id=${clientId} and kind='Payroll' and status='Confirmed' and starts_on>=${year+'-01-01'}::date and starts_on<=${year+'-12-31'}::date order by starts_on,revision desc`;
 const seen=new Map<string,any>(),dup:string[]=[];
 for(const r of rows){const m=day(r.starts_on).slice(0,7);if(seen.has(m)){dup.push(m);continue;}seen.set(m,{month:m,import_id:r.import_id,employees:r.payload?.employees||[],calculated:r.payload?.calculated||[],rules:r.payload?.rules||[]});}
 return {months:[...seen.values()],dup};
}
export async function p9Action(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Tax deduction cards are prepared by staff with client access.');
 const project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`),cid=project.client_id;
 const client=one(await tx`select company_name,kra_pin from erp_private.clients where client_id=${cid}`);
 if(p.action==='statutory_file_p9_read'){
  const years=await tx`select extract(year from starts_on)::int y,count(*)::int n from erp_private.period_imports where client_id=${cid} and kind='Payroll' and status='Confirmed' group by 1 order by 1 desc`;
  const released=await tx`select release_id,tax_year,employee_name,employee_pin,generated_at,erp_private.reviewer_label(generated_by) generated_by_name from erp_private.p9_releases where client_id=${cid} order by generated_at desc limit 40`;
  return {years:years.map((x:any)=>({year:Number(x.y),confirmed_months:Number(x.n)})),released:released.map((x:any)=>({...x,generated_at:day(x.generated_at)})),columns:P9_COLUMNS.map(([l,t])=>({letter:l,label:t}))};
 }
 const year=Number(p.year);if(!Number.isInteger(year)||year<2015||year>2100)fail(400,'Choose the year of the cards.');
 const empty=Array.isArray(p.empty_months)?p.empty_months.map(String).filter((m:string)=>/^\d{4}-\d{2}$/.test(m)&&m.startsWith(String(year))).slice(0,12):[];
 await logPayrollRead(tx,a,{client_id:cid,project_id:project.project_id,import_id:null,surface:'P9 cards',detail:`P9 prepared for ${year}`});
 const {months,dup}=await confirmedMonths(tx,cid,year);
 const people=await tx`select person_id,name,kra_pin,national_id,surname,other_names from erp_private.client_payroll_people where client_id=${cid} order by created_at`;
 const built:any=buildP9({year,months,people,client:{name:client.company_name,pin:client.kra_pin},emptyMonths:empty});
 for(const m of dup)built.issues.push(`${m}: more than one confirmed payroll exists for this month. Withdraw the extra one first.`);
 if(!client.kra_pin)built.issues.push('The client has no KRA PIN on its record, so the employer PIN on the card is blank. Add it to the client first.');
 built.ready=built.issues.length===0&&built.employees.length>0;
 const only=p.pin?String(p.pin).toUpperCase():null;
 const out:any={year,client:built.client,ready:built.ready,issues:built.issues,notes:built.notes,coverage:built.coverage,columns:P9_COLUMNS.map(([l,t])=>({letter:l,label:t})),
  employees:built.employees.filter((e:any)=>!only||e.pin===only).map((e:any)=>({pin:e.pin,name:e.name,surname:e.surname,other_names:e.other_names,months_on_payroll:e.months_on_payroll,totals:Object.fromEntries(Object.entries(e.totals).map(([k,v])=>[k,money(v as number)])),
   rows:e.rows.map((r:any)=>r&&Object.fromEntries(P9_COLUMNS.map(([l])=>[l,r[l]===null?null:money(r[l])]))),issues:e.issues}))};
 if(p.release===true){
  if(!built.ready)fail(409,'The cards are not ready to release: '+built.issues.slice(0,3).join(' ')+(built.issues.length>3?` (and ${built.issues.length-3} more)`:''));
  if(project.status==='Archived')fail(400,'Archived projects retain read-only history.');
  const files:any[]=[];
  for(const card of built.employees.filter((e:any)=>!only||e.pin===only)){
   const c={...card,year},csv=p9Csv(c,built.client),sha=await hex(csv);
   await tx`insert into erp_private.p9_releases(client_id,project_id,tax_year,employee_pin,employee_name,months_on_payroll,total_chargeable_pay,total_paye,notes,content_sha256,generated_by)
    values(${cid},${project.project_id},${year},${card.pin},${card.name},${card.months_on_payroll},${money(card.totals.K)},${money(card.totals.O)},${tx.json(built.notes)},${sha},${a.staff_id})`;
   files.push({file_name:p9FileName(c,built.client),csv,sha256:sha,pin:card.pin});
  }
  out.released=true;out.files=files;
 }
 return out;
}
