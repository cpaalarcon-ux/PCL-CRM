// Browser-safe role-area defaults used by the staff interface. Server-side authorization
// remains enforced separately by the Supabase function and database policies.
export const STAFF_ACCESS_AREAS = Object.freeze([
  {code:'clients',label:'Clients',view:'clients'},
  {code:'projects',label:'Projects & tasks',view:'projects'},
  {code:'time_hr',label:'Time & HR',view:'time'},
  {code:'documents',label:'Documents',view:'documents'},
  {code:'communications',label:'Communications',view:'communications'},
  {code:'billing_wip',label:'Billing & WIP',view:'finance'},
  {code:'audit',label:'Audit & assurance',view:'audit'},
  {code:'leads',label:'Leads',view:'leads'},
  {code:'staff_access',label:'Staff & access',view:'staff'},
  {code:'settings',label:'Settings',view:'firms'},
]);

const AREA_CODES=STAFF_ACCESS_AREAS.map(x=>x.code);
const LEADER_AREAS=['clients','projects','time_hr','documents','communications','billing_wip','audit','leads','staff_access','settings'];
const TEAM_AREAS=['clients','projects','time_hr','documents','communications','audit'];
const INTERN_AREAS=['projects','time_hr','documents','communications'];
const ADMIN_AREAS=['communications','staff_access'];

export function defaultStaffAreas(role){
  if(role==='PARTNER'||role==='MANAGER')return [...LEADER_AREAS];
  if(role==='SUPERVISOR'||role==='ASSISTANT')return [...TEAM_AREAS];
  if(role==='INTERN')return [...INTERN_AREAS];
  if(role==='ADMIN')return [...ADMIN_AREAS];
  return [];
}

export function effectiveStaffAreas(role,restricted=[]){
  const denied=new Set(Array.isArray(restricted)?restricted:[]);
  return defaultStaffAreas(role).filter(code=>!denied.has(code));
}

