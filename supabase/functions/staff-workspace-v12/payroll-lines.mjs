// Manual payroll lines: typed in by staff when the client has no payroll file. They feed the same ERP calculation,
// preview, independent review and posting path as an uploaded file, so every rule here is a logic check and needs no rate.
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const money=v=>{if(v===''||v==null)return null;const n=Number(String(v).replace(/,/g,''));return Number.isFinite(n)?Math.round(n*100)/100:NaN;};

export const RELATIONSHIPS=['Employee','Casual worker','Director','Shareholder','Owner','Partner','Family member'];
export const RELATIONSHIP_HELP={
 'Employee':'An ordinary employee with no ownership or family link to the client.',
 'Casual worker':'Paid by the day or job. Needs an ID number, phone number and the date paid.',
 'Director':'A director paid a salary or fees through payroll. Needs the approving board resolution or contract.',
 'Shareholder':'A shareholder who is also employed. Needs the contract or board resolution that sets the pay.',
 'Owner':'The owner of a sole proprietorship. Not allowed on payroll: owner withdrawals are Drawings.',
 'Partner':'A partner in a partnership. Not allowed on payroll: partner withdrawals are Drawings.',
 'Family member':'A relative of an owner, director, partner or shareholder. Needs the duties performed and the basis of the pay.'
};
const NO_PAYROLL={Owner:'Sole proprietor',Partner:'Partnership'};
const OWNERLESS=['Sole proprietor','Partnership'];
export const MANUAL_BASIS_MIN=10;

export function relationshipIssues({entityType='',lines=[]}){
 const issues=[];
 for(const l of lines){
  const at=`Line ${l.source_row}: ${l.name||'unnamed'}`;
  const rel=l.relationship;
  if(!RELATIONSHIPS.includes(rel)){issues.push(`${at}: choose how this person relates to the client.`);continue;}
  if(rel==='Owner'||rel==='Partner'){
   if(NO_PAYROLL[rel]===entityType)issues.push(`${at} is ${rel==='Owner'?'the owner of this sole proprietorship':'a partner of this partnership'}. Owner and partner payments must be routed to Drawings, not payroll.`);
   else issues.push(`${at}: “${rel}” applies only to a ${NO_PAYROLL[rel].toLowerCase()} client. For this client choose Director, Shareholder or Employee.`);
  }
  if(['Director','Shareholder'].includes(rel)&&OWNERLESS.includes(entityType))issues.push(`${at}: a ${entityType.toLowerCase()} has no ${rel.toLowerCase()}s. Choose Employee, or route owner and partner pay to Drawings.`);
  if(['Director','Shareholder','Family member'].includes(rel)&&clean(l.approval_reference).length<5)issues.push(`${at} (${rel}): record the ${rel==='Family member'?'agreement or contract':'board resolution or contract'} that sets the pay.`);
  if(rel==='Family member'&&clean(l.related_basis).length<10)issues.push(`${at} (Family member): describe the duties performed and the basis of the pay (at least 10 characters).`);
  if(rel==='Casual worker'&&l.employment_type!=='Casual')issues.push(`${at}: a casual worker must have the employment type Casual.`);
  if(rel!=='Casual worker'&&l.employment_type==='Casual')issues.push(`${at}: employment type Casual requires the relationship Casual worker.`);
 }
 return issues;
}

// Turns typed lines into the same row shape the file reader produces (see import-profiles.mjs payrollRows).
export function manualPayrollRows(lines){
 const rows=[],issues=[],pins=new Set(),ids=new Set();
 if(!Array.isArray(lines)||!lines.length)return {rows,issues:['Add at least one payroll line.']};
 if(lines.length>500)return {rows,issues:['A payroll entry supports up to 500 people.']};
 lines.forEach((raw,idx)=>{
  const i=idx+1,errors=[];
  const name=clean(raw.name),pin=clean(raw.pin).toUpperCase().replace(/\s+/g,'');
  const typeText=clean(raw.employment_type||'Permanent').toLowerCase(),types={permanent:'Permanent',casual:'Casual',contract:'Contract'};
  const employment_type=types[typeText]??'Unknown';
  const r={source_row:i,name,pin,employee_id:clean(raw.employee_id),resident:raw.resident==='Resident'?true:raw.resident==='Non-resident'?false:null,employment_type,
   phone:clean(raw.phone).replace(/[\s-]/g,''),date_paid:clean(raw.date_paid)||null,relationship:clean(raw.relationship),approval_reference:clean(raw.approval_reference),related_basis:clean(raw.related_basis),
   evidence_reference:clean(raw.evidence_reference),manual:true};
  for(const [k,src] of [['basic','basic'],['allowances','allowances'],['gross','gross'],['benefits','taxable_benefits'],['other_pension','other_pension'],['postretirement_medical','postretirement_medical'],['mortgage_interest','mortgage_interest'],['other_deductions','other_deductions']]){
   const v=money(raw[src]);if(Number.isNaN(v)){errors.push(`${src.replaceAll('_',' ')} must be a number.`);r[k]=null;}else r[k]=v;
  }
  if(r.gross==null&&r.basic!=null)r.gross=Math.round(((r.basic||0)+(r.allowances||0))*100)/100;
  if(!name)errors.push('Name is missing.');
  if(employment_type==='Unknown')errors.push('Employment type must be Permanent, Casual or Contract.');
  const casual=employment_type==='Casual';
  if(!/^[A-Z]\d{9}[A-Z]$/.test(pin)&&!(casual&&!pin))errors.push('KRA PIN is missing or invalid.');
  if(pin&&pins.has(pin))errors.push('Duplicate KRA PIN.');if(pin)pins.add(pin);
  if(casual){
   if(!r.employee_id)errors.push('A casual worker needs an ID number.');else if(ids.has(r.employee_id))errors.push('Duplicate ID number.');ids.add(r.employee_id);
   if(!/^\+?\d{9,13}$/.test(r.phone))errors.push('A casual worker needs a phone number.');
   if(!r.date_paid||!/^\d{4}-\d{2}-\d{2}$/.test(r.date_paid))errors.push('A casual worker needs the date paid (YYYY-MM-DD).');
  }
  if(r.gross==null||r.gross<0)errors.push('Gross pay is missing or invalid.');
  for(const [k,v] of Object.entries(r))if(typeof v==='number'&&v<0)errors.push(`${k.replaceAll('_',' ')} cannot be negative.`);
  if(r.evidence_reference.length<3)errors.push('Record the evidence for this line (payslip number, payment proof or signed register).');
  r.issues=errors;rows.push(r);issues.push(...errors.map(x=>`Line ${i}: ${x}`));
 });
 return {rows,issues};
}
