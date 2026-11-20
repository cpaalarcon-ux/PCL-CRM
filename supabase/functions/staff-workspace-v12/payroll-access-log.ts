import {fail,uuid} from './validation.mjs';
// Build 2835: a record of who opened payroll identity or salary data. `logPayrollRead` is called by the payroll reads in the same transaction, so a read that succeeds
// always leaves a row, and a row cannot exist for a read that did not happen. Table rules are in 20261116230000_payroll_access_log_and_target_register.sql.
export const SURFACES=['Payroll register','Payroll run','Payroll review','Client confirmation','Confirmation PDF','Payroll file','P9 cards'];
export async function logPayrollRead(tx:any,a:any,w:{client_id:string,project_id:string,import_id?:string|null,surface:string,detail?:string}){
 if(!SURFACES.includes(w.surface))throw new Error('Unknown payroll access surface.');
 await tx`insert into erp_private.payroll_access_log(client_id,project_id,import_id,surface,detail,read_by) values(${w.client_id},${w.project_id},${w.import_id??null},${w.surface},${w.detail?String(w.detail).slice(0,300):null},${a.staff_id})`;
}
const ACTIONS=['payroll_access_log_read'];
export async function payrollAccessLogAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner reads the payroll access log.');
 const cid=p.client_id?uuid(p.client_id):null,from=/^\d{4}-\d{2}-\d{2}$/.test(String(p.from||''))?String(p.from):null,to=/^\d{4}-\d{2}-\d{2}$/.test(String(p.to||''))?String(p.to):null;
 const rows=await tx`select l.log_id,l.client_id,c.company_name,l.project_id,pr.project_name,l.import_id,l.surface,l.detail,l.read_at,l.read_by,erp_private.staff_name(l.read_by) as read_by_name from erp_private.payroll_access_log l join erp_private.clients c on c.client_id=l.client_id join erp_private.projects pr on pr.project_id=l.project_id
  where (${cid}::uuid is null or l.client_id=${cid}::uuid) and (${from}::date is null or (l.read_at at time zone 'Africa/Nairobi')::date>=${from}::date) and (${to}::date is null or (l.read_at at time zone 'Africa/Nairobi')::date<=${to}::date) order by l.read_at desc limit 300`;
 const by=new Map<string,{name:string,reads:number}>();for(const r of rows){const k=r.read_by,x=by.get(k)||{name:r.read_by_name,reads:0};x.reads++;by.set(k,x);}
 return {rows:rows.map((r:any)=>({...r,read_at:new Date(r.read_at).toISOString()})),total:rows.length,limit:300,by_person:[...by.values()].sort((x,y)=>y.reads-x.reads),surfaces:SURFACES};
}
