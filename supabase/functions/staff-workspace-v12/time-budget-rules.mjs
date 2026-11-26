// Expected time on tasks: pure rules. No database here.
// Firm decision (26 Nov 2026): hours logged on a task may not pass the hours allocated to it. The entry is refused; a Supervisor, Manager or Partner
// increases the allocation, with a reason, before more time can be logged.
import {fail} from './validation.mjs';
export const MIN_ALLOCATED=0.25,MAX_ALLOCATED=2000;
const fmt=n=>String(Math.round(Number(n)*100)/100);
export function allocatedHours(v,required=true){
 if(v===undefined||v===null||v===''){if(required)fail(400,'Enter the hours allocated to this task.');return null;}
 const n=Number(v);
 if(!Number.isFinite(n)||n<MIN_ALLOCATED||n>MAX_ALLOCATED||Math.abs(n*100-Math.round(n*100))>0.000001)fail(400,`Allocated hours must be between ${MIN_ALLOCATED} and ${MAX_ALLOCATED}, to two decimals.`);
 return n;
}
// allocated: the task's allocated hours or null. logged: hours already on the task, not counting the entry being edited. adding: the hours being saved.
export function hoursBlock(allocated,logged,adding){
 if(allocated===null||allocated===undefined)return null;
 const a=Number(allocated),l=Number(logged)||0,left=Math.max(0,Math.round((a-l)*100)/100);
 if(l+Number(adding)<=a+0.000001)return null;
 return left>0
  ?`This task has ${fmt(a)} allocated hours and ${fmt(l)} are already logged, so ${fmt(left)} remain. Log up to ${fmt(left)} hours, or ask your Supervisor to increase the allocated hours first.`
  :`All ${fmt(a)} hours allocated to this task have been logged. Ask your Supervisor to increase the allocated hours before logging more time.`;
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
export function compare({range,daily,weekly,kind,holidays,leaveDates,allocated,logged,approved,attended}){
 const days=workingDates(range.from,range.to,holidays),onLeave=days.filter(d=>leaveDates.includes(d)).length,worked=days.length-onLeave;
 let expected=worked*Number(daily);if(kind==='week')expected=Math.min(expected,Number(weekly));
 const r=n=>Math.round(Number(n||0)*100)/100;
 return {from:range.from,to:range.to,working_days:days.length,leave_days:onLeave,expected_hours:r(expected),allocated_hours:r(allocated),logged_hours:r(logged),approved_hours:r(approved),attended_hours:r(attended),
  variance_hours:r(Number(logged||0)-expected),percent_of_expected:expected>0?Math.round(Number(logged||0)/expected*1000)/10:null};
}
