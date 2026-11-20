const iso=(year,month,day)=>`${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
const monthEnd=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();

// Tax months use complete calendar months; the saved client year-end anchors
// quarterly and annual tasks. Never seed a recurring schedule with today's
// mid-month date.
export function currentReportingMonth(client={},asOf){
 const date=String(asOf||'').slice(0,10),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
 if(!match)throw new Error('Use a valid reporting date.');
 const year=Number(match[1]),month=Number(match[2]);
 if(month<1||month>12||Number(match[3])<1||Number(match[3])>monthEnd(year,month))throw new Error('Use a valid reporting date.');
 const starts_on=iso(year,month,1),ends_on=iso(year,month,monthEnd(year,month));
 const fyMonth=Number(client.year_end_month),fyDay=Number(client.year_end_day);
 const financialYearEnd=fyMonth>=1&&fyMonth<=12&&fyDay>=1
  ? `${String(Math.min(fyDay,monthEnd(year,fyMonth))).padStart(2,'0')}/${String(fyMonth).padStart(2,'0')}`
  : null;
 return {starts_on,ends_on,label:new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${starts_on}T00:00:00Z`)),financial_year_end:financialYearEnd};
}

export function nextReportingMonthStart(previousEnd,client={},asOf){
 const current=currentReportingMonth(client,asOf).starts_on;
 const end=String(previousEnd||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(end))return current;
 const date=new Date(`${end}T00:00:00Z`);if(Number.isNaN(date.getTime())||date.toISOString().slice(0,10)!==end)return current;date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);
 const next=iso(date.getUTCFullYear(),date.getUTCMonth()+1,1);
 return next>current?next:current;
}

export function previousReportingMonthStart(periodStart){
 const value=String(periodStart||'').slice(0,10);
 if(!/^\d{4}-\d{2}-01$/.test(value))return '';
 const date=new Date(`${value}T00:00:00Z`);date.setUTCMonth(date.getUTCMonth()-1);
 return iso(date.getUTCFullYear(),date.getUTCMonth()+1,1);
}

export function monthEndDate(month){
 if(!/^\d{4}-\d{2}$/.test(String(month||'')))return '';
 const [year,period]=month.split('-').map(Number);
 if(period<1||period>12)return '';
 return iso(year,period,monthEnd(year,period));
}

