// View Staff dropdown: the people the signed-in person may look at. Assistants get none (they only ever see themselves).
export async function viewStaffAction(tx:any,a:any,p:any){
 if(p.action!=='view_staff_options')return undefined;
 const people=['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code)?await tx`select staff_id,full_name,category_code from erp_private.view_staff_options()`:[];
 return {role:a.category_code,default_scope:a.category_code==='SUPERVISOR'?'team':['PARTNER','MANAGER'].includes(a.category_code)?'all':'me',people};
}
