// Expected time on tasks: pure rules. No database here.
// Firm decisions (26 Nov 2026): every task has an expected time; it is seen and set only by Engagement Partners and Managers a Partner has selected;
// the people doing the work are not shown it and are never blocked by it, so that recorded time is the time actually worked.
// Time over the expected hours is flagged to the people who may see it.
import {fail} from './validation.mjs';
export const MIN_EXPECTED=0.25,MAX_EXPECTED=2000;
const r2=n=>Math.round(Number(n||0)*100)/100;
export function expectedHours(v,required=true){
 if(v===undefined||v===null||v===''){if(required)fail(400,'Enter the expected hours.');return null;}
 const n=Number(v);
 if(!Number.isFinite(n)||n<MIN_EXPECTED||n>MAX_EXPECTED||Math.abs(n*100-Math.round(n*100))>0.000001)fail(400,`Expected hours must be between ${MIN_EXPECTED} and ${MAX_EXPECTED}, to two decimals.`);
 return n;
}
// The position of one task for the people who may see it. over_hours is 0 when the task is within its expected time.
export function taskPosition(expected,logged){
 if(expected===null||expected===undefined)return {expected_hours:null,logged_hours:r2(logged),over_hours:null,status:'No expected hours'};
 const e=Number(expected),l=Number(logged)||0,over=r2(Math.max(0,l-e));
 return {expected_hours:r2(e),logged_hours:r2(l),over_hours:over,percent_used:e>0?Math.round(l/e*1000)/10:null,status:over>0?'Over expected':'Within expected'};
}
// Monday-to-Friday dates in [from,to] that are not public holidays.
export function workingDates(from,to,holidays=[]){
 const out=[],skip=new Set(holidays);
 for(let t=Date.parse(from+'T00:00:00Z'),e=Date.parse(to+'T00:00:00Z');t<=e;t+=86400000){const d=new Date(t),iso=d.toISOString().slice(0,10),wd=d.getUTCDay();if(wd!==0&&wd!==6&&!skip.has(iso))out.push(iso);}
 return out;
}
// The day, the Monday-to-Sunday week and the calendar month that contain a date.
export function periods(date){
 const d=new Date(date+'T00:00:00Z'),iso=x=>x.toISOString().slice(0,10),wd=(d.getUTCDay()+6)%7;
 const mon=new Date(d.getTime()-wd*86400000),sun=new Date(mon.getTime()+6*86400000);
 const first=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0));
 return {day:{from:date,to:date},week:{from:iso(mon),to:iso(sun)},month:{from:iso(first),to:iso(last)}};
}
// One period's comparison. expected = working days not on leave x daily hours, capped at the weekly hours for a week.
// taskHours is null for someone who may not see task hours; the task figures are then left out entirely.
export function compare({range,daily,weekly,kind,holidays,leaveDates,logged,approved,attended,taskHours=null}){
 const days=workingDates(range.from,range.to,holidays),onLeave=days.filter(d=>leaveDates.includes(d)).length,worked=days.length-onLeave;
 let expected=worked*Number(daily);if(kind==='week')expected=Math.min(expected,Number(weekly));
 const out={from:range.from,to:range.to,working_days:days.length,leave_days:onLeave,expected_hours:r2(expected),logged_hours:r2(logged),approved_hours:r2(approved),attended_hours:r2(attended),
  variance_hours:r2(Number(logged||0)-expected),percent_of_expected:expected>0?Math.round(Number(logged||0)/expected*1000)/10:null};
 if(taskHours)Object.assign(out,{task_expected_hours:r2(taskHours.expected),tasks_without_hours:taskHours.missing});
 return out;
}
