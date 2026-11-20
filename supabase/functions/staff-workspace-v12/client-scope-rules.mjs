// Build 2864: engagement scope. Pure rules, no database. The scope start is the first period the firm is engaged to work on; the engagement date is when it was appointed
// (it may be backdated to the signed letter). Nothing here decides for the Partner: it only checks that the dates make sense and words the notes.
const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s))?String(s):null;
const long=s=>{const d=iso(s);return d?new Date(d+'T00:00:00Z').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}):'';};
export function scopeProblem({engagement,start,end,today}){
 if(!iso(engagement))return 'Enter the engagement date: the date the engagement letter was signed. It may be in the past.';
 if(!iso(start))return 'Enter the date the engagement scope starts.';
 if(engagement>today)return 'The engagement date cannot be in the future.';
 if(engagement<'2000-01-01'||start<'2000-01-01')return 'Enter dates from the year 2000 onwards.';
 if(end&&!iso(end))return 'Enter a valid scope end date, or leave it empty.';
 if(end&&end<start)return 'The scope cannot end before it starts.';
 return null;
}
// A scope that begins before the appointment date is the late-filing case, and it is a Partner's decision.
export const backdatedScope=(engagement,start)=>!!iso(engagement)&&!!iso(start)&&start<engagement;
export function overrideProblem({from,to,reason}){
 if(!iso(from)||!iso(to))return 'Choose the first and last day of the period.';
 if(to<from)return 'The period cannot end before it starts.';
 if(Date.parse(to)-Date.parse(from)>3660*86400000)return 'An override covers at most ten years.';
 if(String(reason||'').trim().length<5)return 'Say why this work is being done (at least 5 characters), for example "Client engaged us to file outstanding 2024 returns".';
 return null;
}
// The banner on a client who traded long before we were engaged: earlier years are not covered unless a Partner approves them.
export function preEngagementNote(commencement,scopeStart,engagement){
 const c=iso(String(commencement||'').slice(0,10)),s=iso(scopeStart);
 if(!c||!s||Date.parse(s)-Date.parse(c)<366*86400000)return '';
 return `This client has been operating since ${long(c)}. Our engagement${iso(engagement)?` began on ${long(engagement)}, and it`:''} covers work from ${long(s)}. Earlier years are not covered unless a Partner approves a scope override.`;
}
// The line that heads the engagement page.
export function scopeHeadline(scope){
 if(!scope)return 'Engagement scope not recorded. Work is not limited by date until a Manager or Partner records it.';
 return `Engagement scope: from ${long(scope.scope_start_date)}${scope.scope_end_date?' to '+long(scope.scope_end_date):''}. Appointed on ${long(scope.engagement_date)}.`;
}
