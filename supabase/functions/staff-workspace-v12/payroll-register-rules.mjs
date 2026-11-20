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
// Inactive periods (build 2819). A person who is inactive for the whole month is left out of that month's draft; for part of it they stay in with a flag,
// because the ERP does not prorate pay by guesswork. Returning to active ends the period the day before the return date.
const addDay=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
export function inactiveSpan(c){
 const start=day(c.starts_on);let end=c.ends_on?day(c.ends_on):null;
 if(c.status==='Returned'&&c.returned_on){const r=addDay(day(c.returned_on),-1);end=end&&end<r?end:r;}
 return {start,end};
}
// 'full' when an inactive period covers the whole month, 'partial' when it covers some of it, otherwise null.
export function inactivity(changes,personId,b){
 let out=null;
 for(const c of changes||[]){
  if(c.person_id!==personId||c.kind!=='Inactive'||!['In force','Returned'].includes(c.status))continue;
  const sp=inactiveSpan(c);if(sp.end&&sp.end<sp.start)continue;
  if(sp.start>b.end||(sp.end&&sp.end<b.start))continue;
  if(sp.start<=b.start&&(!sp.end||sp.end>=b.end))return {state:'full',...sp,reason:c.reason};
  out={state:'partial',...sp,reason:c.reason};
 }
 return out;
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
export function draftLines(people,pays,ym,{changes=[],exclude=[]}={}){
 const b=monthBounds(ym);if(!b)return {lines:[],skipped:[],warnings:[],b:null};
 const lines=[],skipped=[],warnings=[],out=new Set(exclude||[]);
 for(const p of (people||[]).filter(x=>activeInMonth(x,b)).sort((x,y)=>String(x.name).localeCompare(String(y.name)))){
  if(out.has(p.person_id)){skipped.push({person_id:p.person_id,name:p.name,reason:'Left out of this month\'s draft by staff. They are still active on the register, so confirm this with the client.'});continue;}
  const inact=inactivity(changes,p.person_id,b);
  if(inact&&inact.state==='full'){skipped.push({person_id:p.person_id,name:p.name,reason:`Inactive from ${inact.start}${inact.end?' to '+inact.end:''}: ${inact.reason}`});continue;}
  const pay=payFor(pays,p.person_id,b);
  if(!pay){skipped.push({person_id:p.person_id,name:p.name,reason:'No pay is recorded for this person from a date on or before this month.'});continue;}
  if(inact&&inact.state==='partial')warnings.push({person_id:p.person_id,name:p.name,detail:`Inactive from ${inact.start}${inact.end?' to '+inact.end:''} for part of this month. The pay is not prorated automatically: check the gross figure before saving.`});
  lines.push({person_id:p.person_id,name:p.name,pin:p.kra_pin||'',employee_id:p.national_id||'',relationship:p.relationship,employment_type:p.employment_type,resident:p.resident||'',phone:p.phone||'',
   approval_reference:p.approval_reference||'',related_basis:p.related_basis||'',gross:pay.gross,taxable_benefits:pay.taxable_benefits,other_pension:pay.other_pension,mortgage_interest:pay.mortgage_interest,postretirement_medical:pay.postretirement_medical,
   other_deductions:'',date_paid:'',evidence_reference:'',pay_effective_from:day(pay.effective_from)});
 }
 return {lines,skipped,warnings,b};
}
// New staff, staff who left, and pay changes between the previous month's draft and this month's.
export function registerChanges(people,pays,ym,{changes=[]}={}){
 const b=monthBounds(ym),pb=monthBounds(previousMonth(ym));if(!b||!pb)return {new_staff:[],left:[],pay_changes:[],inactive:[],returned:[],pending_separations:[]};
 const out={new_staff:[],left:[],pay_changes:[],inactive:[],returned:[],pending_separations:[]};
 const sep=id=>(changes||[]).find(c=>c.person_id===id&&c.kind==='Separation'&&c.status==='Approved');
 for(const p of people||[]){
  const now=activeInMonth(p,b),before=activeInMonth(p,pb);
  const cur=payFor(pays,p.person_id,b),prev=payFor(pays,p.person_id,pb);
  const ia=inactivity(changes,p.person_id,b),ib=inactivity(changes,p.person_id,pb);
  if(now&&!before)out.new_staff.push({name:p.name,gross:cur?Number(cur.gross):null,started_on:day(p.started_on),by:p.created_by_name||''});
  else if(!now&&before&&p.left_on){const a=sep(p.person_id);out.left.push({name:p.name,left_on:day(p.left_on),reason:p.left_reason||'',requested_by:a?.requested_by_name||'',approved_by:a?.decided_by_name||''});}
  else if(now&&before){
   if(ia&&ia.state==='full'&&!(ib&&ib.state==='full'))out.inactive.push({name:p.name,from:ia.start,to:ia.end,reason:ia.reason});
   else if(ib&&ib.state==='full'&&!(ia&&ia.state==='full'))out.returned.push({name:p.name,reason:'Back on the payroll from '+(ia?ia.start:b.start)});
   else if(cur&&prev&&PAY_FIELDS.some(k=>Number(cur[k])!==Number(prev[k])))out.pay_changes.push({name:p.name,from:Number(prev.gross),to:Number(cur.gross),effective_from:day(cur.effective_from),reason:cur.reason||'',by:cur.created_by_name||''});
  }
 }
 for(const c of changes||[])if(c.kind==='Separation'&&c.status==='Requested')out.pending_separations.push({name:(people||[]).find(p=>p.person_id===c.person_id)?.name||'',effective_on:day(c.starts_on),reason:c.reason,requested_by:c.requested_by_name||''});
 return out;
}
// Months already submitted or approved that a register change dated on or before them would no longer match.
export function affectedMonths(imports,effectiveFrom){
 const eff=day(effectiveFrom);
 return (imports||[]).filter(i=>['Submitted','Confirmed'].includes(i.status)&&day(i.ends_on)>=eff).map(i=>({import_id:i.import_id,month:day(i.starts_on).slice(0,7),status:i.status})).sort((a,b)=>a.month.localeCompare(b.month));
}
