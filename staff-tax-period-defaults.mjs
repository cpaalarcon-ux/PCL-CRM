const annualKinds=new Set(['Company','Individual','Partnership']);
const iso=(y,m,d)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const endOfMonth=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();

// Monthly obligations default to the latest complete calendar month. Annual
// income-tax obligations default to the client's most recently completed year.
// These are editable defaults: staff must confirm the client's actual period.
export function defaultTaxReportingPeriod(kind,client={},asOf){
 const today=String(asOf||'').slice(0,10),[yearText,monthText,dayText]=today.split('-');
 let year=Number(yearText),month=Number(monthText),day=Number(dayText);
 if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1)throw new Error('Use a valid as-of date.');
 if(annualKinds.has(kind)){
  const fyeMonth=Number(client.year_end_month),fyeDay=Number(client.year_end_day);
  if(Number.isInteger(fyeMonth)&&fyeMonth>=1&&fyeMonth<=12&&Number.isInteger(fyeDay)&&fyeDay>=1){
   const actualEndDay=Math.min(fyeDay,endOfMonth(year,fyeMonth));
   const candidate=iso(year,fyeMonth,actualEndDay),end=candidate<=today?candidate:iso(year-1,fyeMonth,Math.min(fyeDay,endOfMonth(year-1,fyeMonth)));
   const priorYear=Number(end.slice(0,4))-1,priorEnd=iso(priorYear,fyeMonth,Math.min(fyeDay,endOfMonth(priorYear,fyeMonth)));
   const start=new Date(Date.parse(priorEnd+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   return {starts_on:start,ends_on:end,basis:`Client financial year ending ${end}. Confirm it matches the verified reporting period.`};
  }
  const endYear=today.slice(5)>='12-31'?year:year-1;
  return {starts_on:`${endYear}-01-01`,ends_on:`${endYear}-12-31`,basis:'Client financial year-end is not set. Confirm the reporting period before saving.'};
 }
 // If today is the final day of a month, treat that month as the current
 // reporting period; otherwise use the latest fully completed month.
 const currentIsComplete=day===endOfMonth(year,month);
 if(!currentIsComplete){month--;if(month===0){month=12;year--;}}
 return {starts_on:iso(year,month,1),ends_on:iso(year,month,endOfMonth(year,month)),basis:'Defaults to the latest complete calendar month. Confirm the client’s reporting month; edit the dates if needed.'};
}

// The KRA return due date the ERP SUGGESTS when a tax period is set up: the 9th of the following month for PAYE and payroll levies, the 20th for VAT, TOT and MRI.
// Annual taxes are looked up on the server from the annual due-date rules (months after the period end); other taxes get no suggestion. A Tax Lead, Manager or Partner must confirm the date against the KRA iTax calendar; nothing here is a confirmed date.
export function suggestedKraDueDate(kind,endsOn){
 if(['Company','Individual','Partnership'].includes(kind))return {date:'',rule:'Looking up the firm\'s annual due-date rule for this period…'};
 const match=/^(\d{4})-(\d{2})-\d{2}$/.exec(String(endsOn||'')),payeKinds=['PAYE','NSSF','SHIF','Housing levy'],vatKinds=['VAT','TOT','MRI','Excise'];
 const day=payeKinds.includes(kind)?9:vatKinds.includes(kind)?20:0;
 if(!match||!day)return {date:'',rule:'No due date is suggested for this tax. Enter the KRA due date from the iTax calendar, or leave it blank and use the task-date fallback.'};
 let year=Number(match[1]),month=Number(match[2])+1;if(month>12){month=1;year++;}
 return {date:`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,rule:`Suggested: the ${day===9?'9th':'20th'} of the following month. Check it against the KRA iTax calendar before confirming.`};
}
