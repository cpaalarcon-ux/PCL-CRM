export const timingRows=[];
const openedAreas=new Set();

export function clearWorkspaceTiming(){
 timingRows.length=0;
 openedAreas.clear();
}

export function recordWorkspaceTiming({action,started,role,area='',mode='',error=false}){
 if(!Number.isFinite(started)||!role)return;
 timingRows.unshift({action,role,area,mode,error,at:new Date(),seconds:Math.max(0,(performance.now()-started)/1000)});
 if(timingRows.length>100)timingRows.pop();
}

export function recordAreaOpening({started,role,area}){
 const mode=openedAreas.has(area)?'Repeat open':'First open';
 openedAreas.add(area);
 recordWorkspaceTiming({action:'open_area',started,role,area,mode});
}

export function summarizeWorkspaceTiming(rows){
 const groups=new Map();
 for(const r of rows){
  const key=JSON.stringify([r.action,r.role,r.area,r.mode]);
  if(!groups.has(key))groups.set(key,{action:r.action,role:r.role,area:r.area,mode:r.mode,samples:[],failed:0});
  const group=groups.get(key);
  if(r.error)group.failed++;
  else group.samples.push(r.seconds);
 }
 return [...groups.values()].map(({samples,...group})=>{
  samples.sort((a,b)=>a-b);
  const percentile=p=>samples.length?samples[Math.ceil(samples.length*p)-1]:null;
  return {...group,count:samples.length,p50:percentile(.5),p95:percentile(.95)};
 });
}
