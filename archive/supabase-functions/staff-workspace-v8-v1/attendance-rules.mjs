export function automaticBreakMinutes(attendance,presence,now=Date.now()){
 const elapsed=Math.max(0,now-Date.parse(attendance.clock_in)),open=presence?.break_started_at?Math.max(0,now-Date.parse(presence.break_started_at)):0;
 return Math.min(Math.floor(elapsed/60000),Math.floor((Number(attendance.recorded_break_seconds||0)*1000+open)/60000));
}
export function lateClockIn(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(now).map(p=>[p.type,p.value]));
 return !['Sat','Sun'].includes(parts.weekday)&&parts.hour+':'+parts.minute>'08:15';
}
