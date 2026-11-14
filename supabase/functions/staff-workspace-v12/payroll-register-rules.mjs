// The payroll register (build 2804). Pure rules: who is on the payroll in a month, what recurring pay applies, how a month's draft is built from the
// register, and what changed since the previous month. Variable items (casual date paid, other deductions, evidence for the month) are never carried forward.
import {RELATIONSHIPS} from './payroll-lines.mjs';
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const money=v=>{if(v===''||v==null)return 0;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?Math.round(n*100)/100:NaN;};
export const REGISTER_RELATIONSHIPS=RELATIONSHIPS.filter(x=>!['Owner','Partner'].includes(x));
export const PAY_FIELDS=['gross','taxable_benefits','other_pension','mortgage_interest','postretirement_medical'];
export const monthBounds=ym=>{if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(ym||'')))return null;const s=ym+'-01',e=new Date(Date.UTC(Number(ym.slice(0,4)),Number(ym.slice(5,7)),0)).toISOString().slice(0,10);return {start:s,end:e};};
export const previousMonth=ym=>{const d=new Date(Date.UTC(Number(ym.slice(0,4)),Number(ym.slice(5,7))-2,1));return d.toISOString().slice(0,7);};
// A person is on the month's payroll when they started on or before its last day and had not left before its first day.
export const activeInMonth=(p,b)=>day(p.started_on)<=b.end&&(!p.left_on||day(p.left_on)>=b.start);
// The pay that applies is the latest change taking effect on or before the last day of the month. A change dated inside the month applies to the whole month.
export function payFor(pays,personId,b){
 const list=(pays||[]).filter(x=>x.person_id===personId&&day(x.effective_from)<=b.end).sort((x,y)=>day(y.effective_from).localeCompare(day(x.effective_from)));
 return list[0]||null;
}
export function personIssues(x,{entityType=''}={}){
 const out=[],name=clean(x.name),pin=clean(x.kra_pin).toUpperCase().replace(/\s+/g,''),type=clean(x.employment_type||'Permanent'),rel=clean(x.relationship||'Employee');
 if(!name)out.push('Name is missing.');
 if(!REGISTER_RELATIONSHIPS.includes(rel))out.push(['Owner','Partner'].includes(rel)?'Owner and partner pay is routed to Drawings, so they are not added to the payroll register.':'Choose how this person relates to the client.');
 if(!['Permanent','Contract','Casual'].includes(type))out.push('Employment type must be Permanent, Contract or Casual.');
 if((type==='Casual')!==(rel==='Casual worker'))out.push('A casual worker must have the employment type Casual, and the other way round.');
 if(pin&&!/^[A-Z]\d{9}[A-Z]$/.test(pin))out.push('KRA PIN is not valid.');
 if(!pin&&type!=='Casual')out.push('KRA PIN is missing.');
 if(type==='Casual'){if(!clean(x.national_id))out.push('A casual worker needs an ID number.');if(!/^\+?\d{9,13}$/.test(clean(x.phone).replace(/[\s-]/g,'')))out.push('A casual worker needs a phone number.');}
 if(['Director','Shareholder','Family member'].includes(rel)&&clean(x.approval_reference).length<5)out.push('Record the board resolution, contract or agreement that sets the pay.');
 if(rel==='Family member'&&clean(x.related_basis).length<10)out.push('Describe the duties performed and the basis of the pay (at least 10 characters).');
 if(['Sole proprietor','Partnership'].includes(entityType)&&['Director','Shareholder'].includes(rel))out.push(`A ${entityType.toLowerCase()} has no ${rel.toLowerCase()}s. Choose Employee.`);
 return out;
}
export function payIssues(x){
 const out=[],v={};
 for(const k of PAY_FIELDS){const n=money(x[k]);if(Number.isNaN(n)||n<0)out.push(`${k.replaceAll('_',' ')} must be a number, not below zero.`);v[k]=n;}
 if(!(v.gross>0))out.push('Gross cash pay must be above zero.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(x.effective_from||'')))out.push('Say the date the pay takes effect.');
 if(clean(x.reason).length<10)out.push('Give the reason for the pay (at least 10 characters), for example the contract, offer letter or review.');
 return {issues:out,values:v};
}
// The month's draft lines in the shape of a typed payroll line. Recurring pay comes from the register; the month's own items are left blank.
export function draftLines(people,pays,ym){
 const b=monthBounds(ym);if(!b)return {lines:[],skipped:[],b:null};
 const lines=[],skipped=[];
 for(const p of (people||[]).filter(x=>activeInMonth(x,b)).sort((x,y)=>String(x.name).localeCompare(String(y.name)))){
  const pay=payFor(pays,p.person_id,b);
  if(!pay){skipped.push({person_id:p.person_id,name:p.name,reason:'No pay is recorded for this person from a date on or before this month.'});continue;}
  lines.push({person_id:p.person_id,name:p.name,pin:p.kra_pin||'',employee_id:p.national_id||'',relationship:p.relationship,employment_type:p.employment_type,resident:p.resident||'',phone:p.phone||'',
   approval_reference:p.approval_reference||'',related_basis:p.related_basis||'',gross:pay.gross,taxable_benefits:pay.taxable_benefits,other_pension:pay.other_pension,mortgage_interest:pay.mortgage_interest,postretirement_medical:pay.postretirement_medical,
   other_deductions:'',date_paid:'',evidence_reference:'',pay_effective_from:day(pay.effective_from)});
 }
 return {lines,skipped,b};
}
// New staff, staff who left, and pay changes between the previous month's draft and this month's.
export function registerChanges(people,pays,ym){
 const b=monthBounds(ym),pb=monthBounds(previousMonth(ym));if(!b||!pb)return {new_staff:[],left:[],pay_changes:[]};
 const out={new_staff:[],left:[],pay_changes:[]};
 for(const p of people||[]){
  const now=activeInMonth(p,b),before=activeInMonth(p,pb);
  const cur=payFor(pays,p.person_id,b),prev=payFor(pays,p.person_id,pb);
  if(now&&!before)out.new_staff.push({name:p.name,gross:cur?Number(cur.gross):null,started_on:day(p.started_on)});
  else if(!now&&before&&p.left_on)out.left.push({name:p.name,left_on:day(p.left_on),reason:p.left_reason||''});
  else if(now&&before&&cur&&prev&&PAY_FIELDS.some(k=>Number(cur[k])!==Number(prev[k])))out.pay_changes.push({name:p.name,from:Number(prev.gross),to:Number(cur.gross),effective_from:day(cur.effective_from),reason:cur.reason||''});
 }
 return out;
}
// Months already submitted or approved that a register change dated on or before them would no longer match.
export function affectedMonths(imports,effectiveFrom){
 const eff=day(effectiveFrom);
 return (imports||[]).filter(i=>['Submitted','Confirmed'].includes(i.status)&&day(i.ends_on)>=eff).map(i=>({import_id:i.import_id,month:day(i.starts_on).slice(0,7),status:i.status})).sort((a,b)=>a.month.localeCompare(b.month));
}
