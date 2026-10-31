import {fail,text,choice,date} from './validation.mjs';
export const round=v=>Math.round((v+Number.EPSILON)*100)/100;
export function number(v,min=0,max=1e12){if(v===''||v===null||v===undefined||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)fail(400,'Enter a valid number within the permitted range.');return Number(v);}
export const amount=v=>round(number(v));
export const day=v=>date(v)||fail(400,'Choose a date.');
export function range(start,end){start=day(start);end=day(end);if(end<start)fail(400,'End date must follow start date.');return [start,end];}
export function safeUrl(value,meeting=false){if(!value)return '';const v=text(value,1000);let u;try{u=new URL(v);}catch{fail(400,'Enter a complete HTTPS URL.');}if(u.protocol!=='https:'||u.username||u.password)fail(400,'Use an HTTPS URL without credentials.');if(meeting&&!['meet.google.com','teams.microsoft.com','teams.live.com','zoom.us'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))fail(400,'Use a Google Meet, Teams or Zoom meeting link.');return u.href;}
export function rateParameters(type,p){
 if(type==='PAYE'||type==='Individual income tax'){
  if(!Array.isArray(p.bands)||!p.bands.length||p.bands.length>12)fail(400,'Add the graduated tax bands.');
  let prior=0;const bands=p.bands.map((b,i)=>{const upper=b.upper===null?null:number(b.upper,0);if(upper===null&&i!==p.bands.length-1||upper!==null&&upper<=prior)fail(400,'Band limits must increase; only the final band is unlimited.');if(upper!==null)prior=upper;return {upper,rate:number(b.rate,0,100)};});
  if(bands.at(-1).upper!==null)fail(400,'The last band must be unlimited.');return {bands,personal_relief:amount(p.personal_relief??0)};
 }
 return {rate:number(p.rate,0,100)};
}
export function graduatedTax(income,parameters){let tax=0,lower=0;for(const b of parameters.bands){const upper=b.upper??Infinity;tax+=Math.max(0,Math.min(income,upper)-lower)*b.rate/100;lower=upper;}return round(tax);}
export function vatCalculation(p){const output=number(p.output,-1e12),input=number(p.eligible_input,-1e12),opening=amount(p.opening_credit??0),withholding=amount(p.withholding_credit??0),reverse=amount(p.reverse_charge??0),adjustments=number(p.adjustments??0,-1e12);
 const net=round(output+reverse-input-opening-withholding+adjustments);return {output,eligible_input:input,opening_credit:opening,withholding_credit:withholding,reverse_charge:reverse,adjustments,net,payable:Math.max(0,net),carry_forward:Math.max(0,-net)};
}
export function incomeCalculation(kind,p,rate){
 const profit=number(p.accounting_profit,-1e12),addbacks=amount(p.addbacks??0),deductions=amount(p.deductions??0),losses=amount(p.losses??0),chargeable=Math.max(0,round(profit+addbacks-deductions-losses));
 if(kind==='Partnership') {if(!Array.isArray(p.partners)||!p.partners.length)fail(400,'Add partner allocation percentages.');const partners=p.partners.map(x=>({name:text(x.name,160),share:number(x.share,0,100)}));if(Math.abs(partners.reduce((s,x)=>s+x.share,0)-100)>.00001)fail(400,'Partner allocation percentages must total 100%.');let remaining=chargeable;const allocation=partners.map((x,i)=>{const value=i===partners.length-1?remaining:round(chargeable*x.share/100);remaining=round(remaining-value);return {...x,amount:value};});return {accounting_profit:profit,addbacks,deductions,losses,chargeable,allocation,tax_at_entity:0};}
 const gross=kind==='Individual'?graduatedTax(chargeable,rate):round(chargeable*number(rate.rate,0,100)/100),relief=kind==='Individual'?amount(p.reliefs??0):0,credits=amount(p.credits??0),net=round(Math.max(0,gross-relief)-credits);return {accounting_profit:profit,addbacks,deductions,losses,chargeable,gross_tax:gross,reliefs:relief,credits,balance:net,payable:Math.max(0,net),overpayment:Math.max(0,-net)};
}
export function payrollCalculation(p,rate){if(!Array.isArray(p.employees)||!p.employees.length||p.employees.length>500)fail(400,'Enter at least one employee payroll row, up to 500.');
 const employees=p.employees.map(e=>{const gross=amount(e.gross),deductions=amount(e.allowed_deductions??0);if(deductions>gross)fail(400,'Payroll deductions exceed gross pay.');const taxable=round(gross-deductions),tax=graduatedTax(taxable,rate),personal=e.resident===true?amount(rate.personal_relief):0,other=amount(e.other_reliefs??0),paye=Math.max(0,round(tax-personal-other)),source=amount(e.source_paye??0);return {name:text(e.name,160),gross,allowed_deductions:deductions,taxable,gross_tax:tax,personal_relief:personal,other_reliefs:other,paye,source_paye:source,variance:round(paye-source)};});return {employees,paye:round(employees.reduce((s,e)=>s+e.paye,0)),variance:round(employees.reduce((s,e)=>s+e.variance,0)),exceptions:employees.filter(e=>Math.abs(e.variance)>.01).length};
}
export function busySeason(start,end){[start,end]=range(start,end);for(let y=Number(start.slice(0,4));y<=Number(end.slice(0,4));y++)if(start<=`${y}-04-30`&&end>=`${y}-01-15`)return true;return false;}
export function weekdays(start,end){[start,end]=range(start,end);if((Date.parse(end)-Date.parse(start))/86400000>366)fail(400,'Request at most one year at a time.');const days=[];for(let t=Date.parse(start+'T00:00:00Z');t<=Date.parse(end+'T00:00:00Z');t+=86400000){const d=new Date(t);if(d.getUTCDay()>0&&d.getUTCDay()<6)days.push(d.toISOString().slice(0,10));}return days;}
export function invoiceLines(lines){if(!Array.isArray(lines)||!lines.length||lines.length>50)fail(400,'Add between 1 and 50 invoice lines.');return lines.map(l=>{const quantity=number(l.quantity,.01,1e6),unit_price=amount(l.unit_price),vat_rate=number(l.vat_rate??0,0,100),net=round(quantity*unit_price),vat=round(net*vat_rate/100);return {description:text(l.description,300),quantity,unit_price,vat_rate,net,vat,total:round(net+vat)};});}
const addMonthsAnchored=(iso,months)=>{const [y,m,d]=iso.split('-').map(Number),monthIndex=y*12+(m-1)+months,year=Math.floor(monthIndex/12),month=((monthIndex%12)+12)%12,day=Math.min(d,new Date(Date.UTC(year,month+1,0)).getUTCDate());return new Date(Date.UTC(year,month,day)).toISOString().slice(0,10);};
export function recurringFeePeriods(startsOn,endsOn,frequency,through,limit=120){
 const start=day(startsOn),end=endsOn?day(endsOn):null,cutoff=day(through),step=({Monthly:1,Quarterly:3,Annually:12})[frequency];
 if(!step)fail(400,'Choose Monthly, Quarterly or Annually for a recurring fee.');
 if(end&&end<start)fail(400,'The recurring fee end date must be on or after its start date.');
 const periods=[];for(let i=0;i<limit;i++){
  const from=addMonthsAnchored(start,i*step);if(from>cutoff||end&&from>end)break;
  const next=addMonthsAnchored(start,(i+1)*step),last=new Date(Date.parse(next+'T00:00:00Z')-86400000).toISOString().slice(0,10),to=end&&end<last?end:last;
  periods.push({period_start:from,period_end:to});
 }
 return periods;
}
export const filingKinds=['VAT','PAYE','Company','Partnership','Individual'];
export const cleanCell=v=>{if(v&&typeof v==='object'&&'formula'in v)fail(400,'Import plain values for staff and client master data.');return String(v??'').trim();};
