export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
/** @type {(status: number, message: string) => never} */
export const fail=(status,message)=>{throw new HttpError(status,message);};
export const text=(v,max=160,required=true)=>{if(typeof v!=="string" || v.length>max || (required&&!v.trim()))fail(400,"Check the required text fields.");return v.trim();};
export const uuid=v=>{if(typeof v!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v))fail(400,"Invalid record reference.");return v;};
export const choice=(v,options)=>{if(!options.includes(v))fail(400,"Choose a valid option.");return v;};
export const date=v=>{if(!v)return null;const d=new Date(v+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)fail(400,"Enter a valid date.");return v;};
export const password=v=>{if(typeof v!=="string"||v.length<14||v.length>128||!/[a-z]/.test(v)||!/[A-Z]/.test(v)||!/[0-9]/.test(v))fail(400,"Use 14–128 characters with uppercase, lowercase and a number.");return v;};
export const login=v=>{v=text(v,80).toLowerCase();if(!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(v))fail(400,"Use a valid staff login ID.");return v;};
export const revision=v=>{const s=String(v);if(!/^[1-9][0-9]{0,17}$/.test(s))fail(400,'Refresh this record before saving.');return s;};
export const categories=['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN'];
export const sectors=['Agribusiness','Financial Services','Energy','Healthcare','NGO','Public Sector','SME/Startup','Legal','Education'];
export const branches=['Nairobi','Bungoma','Kisii','Other'];
export const statuses=['Pending','In Progress','In Review','Blocked','Completed','Cancelled'];
export function staffInput(p,actor,old=null){
 const category=choice(p.category_code,categories), employment=choice(p.employment_type,['Permanent','Contract','Internship','Consultant']);
 if(actor.category_code==='MANAGER' && (['PARTNER','MANAGER'].includes(category)||old&&['PARTNER','MANAGER'].includes(old.category_code)))fail(403,'Only the Engagement Partner can manage Partner or Manager accounts.');
 const start=date(p.contract_start_date),end=date(p.contract_end_date);
 if((employment==='Contract'||employment==='Internship'||category==='INTERN')&&!end)fail(400,'A contract end date is required.');
 if(start&&end&&start>end)fail(400,'The contract end date must follow its start date.');
 return {full_name:text(p.full_name),category_code:category,employment_type:employment,branch_location:p.branch_location?choice(p.branch_location,branches):null,contract_start_date:start,contract_end_date:end,billing_status:choice(p.billing_status||'Billable',['Billable','Partially billable','Non-billable'])};
}
export function fileType(name,bytes){
 if(bytes.length<5||bytes.length>10*1024*1024)fail(400,'Upload a file between 5 bytes and 10 MB.');
 const ext=name.toLowerCase().split('.').pop();
 if(ext==='pdf'&&new TextDecoder().decode(bytes.slice(0,5))==='%PDF-')return 'application/pdf';
 if(ext==='xlsx'&&bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4)return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 if(ext==='png'&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x))return 'image/png';
 if(['jpg','jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 fail(400,'Use a PDF, XLSX, PNG or JPEG matching its file extension.');
}
export function allowedOrigin(origin){return ['https://backend-staging-foundation.pcl-crm.pages.dev','https://pcl-crm.pages.dev','https://pcl.phamalarcon.com'].includes(origin);}
