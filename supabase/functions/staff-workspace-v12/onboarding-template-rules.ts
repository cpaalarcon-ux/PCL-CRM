// Client onboarding batch form v3.1: pure rules (reading the workbook grid, checking every row, building the confirmation wording). No database here.
// The form never collects an identity-document or passport number. A column that looks like one is ignored and never read.
import {normaliseDate} from './client-import-check.mjs';
export const MAX_CLIENTS=30,OWNER_LINES=5;
export const ID_TYPES=['National ID','Passport','Alien ID'];
export const OWNER_ROLES=['Director','Director and shareholder','Shareholder','Partner','Sole proprietor','Other controller'];
export const CONTACT_ROLES={'decision maker':'Decision Maker','influencer':'Influencer','day-to-day contact':'Day-to-Day Contact','accounts contact':'Billing Contact'};
export const PIN_RE=/^[A-Z][0-9]{9}[A-Z]$/;
export const NO_ID='Not recorded: identity document sighted, number not kept';
export const NOT_SIGHTED='Not recorded: identity document not yet sighted';
export const CHECKS=[['pep','PEP screening of each client and owner'],['sanctions','Sanctions screening of each client and owner'],['adverse_media','Adverse-media search'],['identity_sighted','Identity documents sighted'],['details_confirmed','Details confirmed from original documents and client interview'],['conflict','Conflict and independence check']];
const clean=v=>{if(v==null)return '';if(v instanceof Date)return v.toISOString().slice(0,10);if(typeof v==='object'){if('result' in v)return clean(v.result);if('formula' in v)return '';if(Array.isArray(v.richText))return v.richText.map(t=>t.text).join('').trim();if('text' in v)return clean(v.text);return '';}return String(v).replace(/\s+/g,' ').trim();};
// Read a worksheet into rows of strings. Formula cells give their saved result (blank when none).
export function grid(sheet){
 const cols=sheet.columnCount,heads=Array.from({length:cols},(_,i)=>clean(sheet.getRow(1).getCell(i+1).value).toLowerCase());
 
 return {heads,cell:(r,c)=>clean(sheet.getRow(r).getCell(c+1).value),rowCount:sheet.rowCount};
}
export const findCol=(heads,...needles)=>heads.findIndex(h=>needles.some(n=>h.includes(n)));
export const isIdHead=h=>/(id|identity|passport)\s*(no\.?|number|num)\b/.test(h)||/^(national id|passport)( number)?$/.test(h);
const yn=v=>{const s=String(v||'').trim().toLowerCase();return s==='yes'||s==='y'?'Yes':s==='no'||s==='n'?'No':null;};
export const toYesNo=yn;
const pct=v=>{const s=String(v??'').replace('%','').trim();if(s==='')return null;const n=Number(s);return Number.isFinite(n)?n:NaN;};
const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
export const normPin=v=>String(v||'').replace(/\s+/g,'').toUpperCase();
export const normPhone=v=>{const s=String(v||'').replace(/[\s()\-]/g,'');if(!s)return '';if(/^\+254[17]\d{8}$/.test(s))return s;if(/^0[17]\d{8}$/.test(s))return '+254'+s.slice(1);if(/^254[17]\d{8}$/.test(s))return '+'+s;return null;};
const err=(list,sheet,row,column,issue,suggestion=null)=>list.push({row,column:`${sheet} · ${column}`,issue,suggestion});

// Check the four tabs. aml/owners/contacts/tax are grid() readers. Returns {errors,notices,clients}. Nothing is ignored silently: every problem names the sheet, row and column.
export function checkOnboardingTabs({aml,owners,contacts,tax},{now=today()}={}){
 const errors=[],notices=[],clients=[];
 const a=aml.heads,o=owners.heads,c=contacts.heads,t=tax.heads;
 const A={name:0,pin:1,type:findCol(a,'type'),purpose:findCol(a,'purpose'),activity:findCol(a,'expected activity'),size:findCol(a,'expected size'),pep:findCol(a,'politically exposed'),funds:findCol(a,'source of funds'),confirmed:findCol(a,'details confirmed'),exception:findCol(a,'exception'),rating:findCol(a,'risk rating'),condition:findCol(a,'condition'),notes:findCol(a,'notes')};
 const O={line:findCol(o,'line'),name:findCol(o,'full name'),idtype:findCol(o,'id type'),pin:findCol(o,'owner kra pin'),nat:findCol(o,'nationality'),pct:findCol(o,'ownership'),role:findCol(o,'role'),hold:findCol(o,'holding'),sighted:findCol(o,'sighted?'),on:findCol(o,'sighted on'),by:findCol(o,'sighted by'),pep:findCol(o,'politically exposed'),notes:findCol(o,'notes')};
 const C={name:findCol(c,'contact full name','full name'),title:findCol(c,'job title'),email:findCol(c,'email'),phone:findCol(c,'phone'),role:findCol(c,'role in decisions','role'),notes:findCol(c,'notes')};
 const T={income:findCol(t,'income tax'),vat:findCol(t,'vat'),paye:findCol(t,'paye'),etims:findCol(t,'etims'),kyc:findCol(t,'kyc'),letter:findCol(t,'engagement letter'),notes:findCol(t,'notes')};
 for(const [nm,miss] of [['AML',['purpose','activity','size','pep','funds','confirmed'].filter(k=>A[k]<0)],['Owners',['name','pct','sighted','on','by'].filter(k=>O[k]<0)],['Contacts',['name','email','phone'].filter(k=>C[k]<0)],['Tax Profile',['income','vat','paye','etims','kyc','letter'].filter(k=>T[k]<0)]] as any){
  if(miss.length)errors.push({row:1,column:nm,issue:`The ${nm} tab does not have the expected columns (${miss.join(', ')}). Use the current onboarding form (v3.1).`,suggestion:null});
 }
 if(errors.length)return {errors,notices,clients};
 for(const [nm,h] of [['AML',a],['Owners',o],['Contacts',c],['Tax Profile',t]] as any)h.forEach((x:string,i:number)=>{if(isIdHead(x))notices.push({row:1,column:`${nm} · ${x}`,issue:'This column holds an identity-document number. It was ignored and nothing from it was read or kept.',suggestion:null});});
 const seen=new Set<string>();
 for(let r=2;r<=Math.min(aml.rowCount,MAX_CLIENTS+1);r++){
  const name=aml.cell(r,A.name),pin=normPin(aml.cell(r,A.pin));
  if(!name&&!pin&&!aml.cell(r,A.purpose)&&!aml.cell(r,A.activity))continue;
  if(!name)err(errors,'AML',r,'Client','The client name is blank.','Enter the client name as on the client record.');
  if(!pin)err(errors,'AML',r,'Client KRA PIN','The client KRA PIN is blank.','Enter a letter, nine digits and a letter.');
  else if(!PIN_RE.test(pin))err(errors,'AML',r,'Client KRA PIN',`${pin} is not a valid KRA PIN.`,'A KRA PIN is a letter, nine digits and a letter, for example P051234567A.');
  else if(seen.has(pin))err(errors,'AML',r,'Client KRA PIN',`${pin} appears twice in this file.`,'List each client once.');
  seen.add(pin);
  const pepv=aml.cell(r,A.pep),pepAns=yn(pepv),conf=aml.cell(r,A.confirmed),confAns=yn(conf);
  if(pepv&&!pepAns)err(errors,'AML',r,'Any owner politically exposed?',`“${pepv}” is not Yes or No.`,'Choose Yes or No.');
  if(conf&&!confAns)err(errors,'AML',r,'Details confirmed',`“${conf}” is not Yes or No.`,'Choose Yes or No.');
  const ac=aml.cell(r,A.type);if(ac&&!['Private Limited Company','General Partnership','Limited Liability Partnership','Sole Proprietor','Other'].includes(ac))notices.push({row:r,column:'AML · Type',issue:`“${ac}” is not one of the listed types. It was kept as written.`,suggestion:null});
  const first=2+OWNER_LINES*(r-2),own:any[]=[];let total=0;
  for(let k=0;k<OWNER_LINES;k++){
   const row=first+k,nameO=owners.cell(row,O.name);
   const rest=[O.idtype,O.pin,O.nat,O.pct,O.role,O.hold,O.sighted,O.on,O.by,O.pep].some(i=>i>=0&&owners.cell(row,i));
   if(!nameO){if(rest)err(errors,'Owners',row,'Full name','This line has details but no name.','Enter the owner’s name or clear the line.');continue;}
   const idt=owners.cell(row,O.idtype);if(idt&&!ID_TYPES.includes(idt))err(errors,'Owners',row,'ID type',`“${idt}” is not a listed ID type.`,'Choose National ID, Passport or Alien ID.');
   const opin=normPin(owners.cell(row,O.pin));if(opin&&!PIN_RE.test(opin))err(errors,'Owners',row,'Owner KRA PIN',`${opin} is not a valid KRA PIN.`,'A KRA PIN is a letter, nine digits and a letter.');
   const pv=pct(owners.cell(row,O.pct));if(pv===null)err(errors,'Owners',row,'Ownership %','The ownership percentage is blank.','Enter a percentage from 0 to 100.');else if(Number.isNaN(pv)||pv<0||pv>100)err(errors,'Owners',row,'Ownership %',`“${owners.cell(row,O.pct)}” is not a percentage from 0 to 100.`,'Enter a number from 0 to 100.');else total+=pv;
   const role=owners.cell(row,O.role);if(role&&!OWNER_ROLES.includes(role))err(errors,'Owners',row,'Role / control basis',`“${role}” is not a listed role.`,'Choose a role from the list.');
   const hold=owners.cell(row,O.hold);if(hold&&!['Direct','Indirect'].includes(hold))err(errors,'Owners',row,'Holding type',`“${hold}” is not Direct or Indirect.`,'Choose Direct or Indirect.');
   const sv=owners.cell(row,O.sighted),sighted=yn(sv);if(sv&&!sighted)err(errors,'Owners',row,'Identity document sighted?',`“${sv}” is not Yes or No.`,'Choose Yes or No.');
   const pe=owners.cell(row,O.pep),pepO=yn(pe);if(pe&&!pepO)err(errors,'Owners',row,'Politically exposed?',`“${pe}” is not Yes or No.`,'Choose Yes or No.');
   let on:string|null=null;const onRaw=owners.cell(row,O.on),by=owners.cell(row,O.by);
   if(onRaw){on=normaliseDate(onRaw);if(!on)err(errors,'Owners',row,'Sighted on',`“${onRaw}” is not a valid date.`,'Use DD/MM/YYYY.');else if(on>now)err(errors,'Owners',row,'Sighted on','The sighting date is in the future.','Use the date the document was actually sighted.');}
   if(sighted==='Yes'){if(!onRaw)err(errors,'Owners',row,'Sighted on','Say when the identity document was sighted.','Enter the date, DD/MM/YYYY.');if(by.length<2)err(errors,'Owners',row,'Sighted by','Say who sighted the identity document.','Enter the person’s name.');}
   own.push({line:owners.cell(row,O.line)||`Owner ${k+1}`,row,full_name:nameO.slice(0,160),identity_type:idt||null,kra_pin:opin||null,nationality:owners.cell(row,O.nat).slice(0,80)||null,ownership_percentage:Number.isFinite(pv as number)?pv:null,role:role||null,holding_type:hold||null,pep_status:pepO||'To confirm',sighted:sighted==='Yes',sighted_on:sighted==='Yes'?on:null,sighted_by:sighted==='Yes'?by.slice(0,120):null,notes:owners.cell(row,O.notes).slice(0,300)||null});
  }
  if(!own.length)err(errors,'Owners',first,'Full name',`${name||pin||'This client'} has no owner. At least one owner is required.`,'Fill Owner 1.');
  if(total>100.0001)err(errors,'Owners',first,'Ownership %',`${name||pin}: the ownership adds to ${Math.round(total*100)/100}, more than 100.`,'Correct the percentages so they do not exceed 100.');
  else if(own.length&&Math.abs(total-100)>0.0001)notices.push({row:first,column:'Owners · Ownership %',issue:`${name||pin}: the ownership adds to ${Math.round(total*100)/100}. The rest is held by someone not listed; say who in Notes.`,suggestion:null});
  const cn=contacts.cell(r,C.name),ce=contacts.cell(r,C.email),cp=contacts.cell(r,C.phone),cr=contacts.cell(r,C.role);let contact=null;
  if(cn||ce||cp||cr){
   if(!cn)err(errors,'Contacts',r,'Contact full name','The contact has details but no name.','Enter the contact’s name.');
   if(ce&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ce))err(errors,'Contacts',r,'Email',`“${ce}” is not a valid email address.`,'Check the address.');
   const ph=cp?normPhone(cp):'';if(cp&&ph===null)err(errors,'Contacts',r,'Phone',`“${cp}” is not a Kenyan phone number.`,'Use 07xx xxx xxx or +254 7xx xxx xxx.');
   if(cn&&!ce&&!cp)err(errors,'Contacts',r,'Email','The contact has no email and no phone.','Enter an email or a phone number.');
   if(cr&&!CONTACT_ROLES[cr.toLowerCase()])err(errors,'Contacts',r,'Role in decisions',`“${cr}” is not a listed role.`,'Choose a role from the list.');
   if(cn)contact={full_name:cn.slice(0,160),job_title:contacts.cell(r,C.title).slice(0,100)||null,email_address:ce||null,phone_number:ph||null,role_in_decision:cr?CONTACT_ROLES[cr.toLowerCase()]||null:null};
  }else notices.push({row:r,column:'Contacts · Contact full name',issue:`${name||pin} has no contact yet.`,suggestion:null});
  const taxAns={};
  for(const [k,label] of [['income','Income tax registered'],['vat','VAT registered'],['paye','PAYE registered'],['etims','eTIMS onboarded'],['kyc','KYC documents on file'],['letter','Engagement letter signed']] as any){
   const v=tax.cell(r,T[k]),y=yn(v);if(v&&!y)err(errors,'Tax Profile',r,label,`“${v}” is not Yes or No.`,'Choose Yes or No.');taxAns[k]=y;
  }
  // The MLRO-only columns are never taken from a preparer's file.
  if(aml.cell(r,A.rating)||aml.cell(r,A.condition))notices.push({row:r,column:'AML · Risk rating / Condition',issue:'The rating and the condition of acceptance are for the MLRO. They were ignored.',suggestion:null});
  clients.push({row:r,name,pin,type:aml.cell(r,A.type)||null,aml:{purpose:aml.cell(r,A.purpose).slice(0,1000),activity:aml.cell(r,A.activity).slice(0,1000),size:aml.cell(r,A.size).slice(0,500),pep:pepAns,funds:aml.cell(r,A.funds).slice(0,300),confirmed:confAns,exception:aml.cell(r,A.exception).slice(0,1000)||null,notes:aml.cell(r,A.notes).slice(0,500)||null},owners:own,contact,tax:taxAns});
 }
 if(!clients.length&&!errors.length)errors.push({row:2,column:'AML',issue:'The AML tab has no clients.',suggestion:'Enter at least one client.'});
 return {errors,notices,clients};
}

const dstr=(v:any)=>v?new Date(String(v).slice(0,10)+'T00:00:00Z'):null;
export const longDate=(v:any)=>{const d=dstr(v);return d?`${d.getUTCDate()} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getUTCMonth()]} ${d.getUTCFullYear()}`:null;};
export function addMonths(iso:string,n:number){const [y,m,d]=iso.split('-').map(Number);const t=new Date(Date.UTC(y,m-1+n,1));const last=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();t.setUTCDate(Math.min(d,last));return t.toISOString().slice(0,10);}
const isDate=(v:any)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
// The MLRO's batch checks. Partial saves are allowed; "complete" needs every check, the evidence reference, the register date, the conditions answer and the decision date.
export function cleanBatchChecks(input:any,{now=today()}:any={}){
 const errors:any[]=[],checks:any={},out:any={};
 const txt=(v:any,max:number)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max);
 for(const [k,label] of CHECKS){
  const x=input?.checks?.[k]||{},on=txt(x.on,10);
  const row={on:on||null,by:txt(x.by,120)||null,method:txt(x.method,300)||null,result:txt(x.result,300)||null};
  if(on&&!isDate(on))errors.push({key:`checks.${k}.on`,error:`${label}: the date is not valid.`});else if(on&&on>now)errors.push({key:`checks.${k}.on`,error:`${label}: the date is in the future.`});
  checks[k]=row;
 }
 out.checks=checks;
 for(const [k,label] of [['exposure_instruction_on','Date of the firm’s instruction on exposure'],['staff_register_checked_on','Staff register check date'],['decision_date','Date of decision']] as any){
  const v=txt(input?.[k],10);if(v&&!isDate(v))errors.push({key:k,error:`${label} is not a valid date.`});else if(v&&k!=='decision_date'&&v>now)errors.push({key:k,error:`${label} is in the future.`});out[k]=v||null;
 }
 out.evidence_reference=txt(input?.evidence_reference,300)||null;out.uncovered_clients=txt(input?.uncovered_clients,1000)||null;
 const cc=input?.conditions_cleared;out.conditions_cleared=cc===true||cc==='Yes'?true:cc===false||cc==='No'?false:null;
 if(out.decision_date){out.next_screening_due=addMonths(out.decision_date,4);out.full_review_due=addMonths(out.decision_date,24);}else{out.next_screening_due=null;out.full_review_due=null;}
 const complete=CHECKS.every(([k])=>checks[k].on&&checks[k].by&&checks[k].method&&checks[k].result)&&!!out.evidence_reference&&!!out.staff_register_checked_on&&out.conditions_cleared!==null&&!!out.decision_date&&!!out.uncovered_clients;
 return {ok:!errors.length,errors,value:out,complete};
}
export const MATRIX_TEXT='The firm’s client risk assessment matrix (version 1): cash-intensive activity 2 points; ownership of a company or partnership not yet verified 2 points; unexplained receipts 2 points; client not met face to face 2 points; identity confidence low 1 point. A score of 3 to 5 is Medium and 6 or more is High. A PEP, a sanctions match or adverse media makes a client High whatever the score.';
// The confirmation wording, the same as the MLRO Confirmation tab of the form. batch: stored batch; clients: [{n,name,pin,activity,rating,condition}].
export function confirmationText(batch:any,clients:any[]){
 const n=clients.length,count=r=>clients.filter(c=>c.rating===r).length,b=batch.checks||{},d=(v:any)=>longDate(v)||'[date]';
 const rows=CHECKS.map(([k,label])=>({label,on:d(b[k]?.on),by:`${b[k]?.by||'[name]'} / ${b[k]?.method||'[lists or method]'}`,result:b[k]?.result||'[result]'}));
 const conflict=b.conflict?.result==='Conflict recorded with safeguard';
 return {
  title:'MLRO CONFIRMATION OF CLIENT ONBOARDING CHECKS',
  subtitle:`Batch: ${batch.batch_ref}   |   Clients: ${n}`,
  sections:[
   {h:'1. Purpose and scope',p:[`This report records my assessment, as Money Laundering Reporting Officer, of the ${n} clients listed in the schedule, so that they can be onboarded in the ERP and work can proceed. It covers the risk rating of each client, the checks carried out, conflicts of interest, the basis on which the client details were confirmed, the timing of the next screening, and my decision. No identity-document number is recorded in this form or in the ERP; the KRA PIN is the identifier, and I confirm below that the identity documents were sighted.`]},
   {h:'2. Basis of the assessment',p:[MATRIX_TEXT,'Client, owner, contact, activity and tax records in this workbook; the original documents held on file for each client; the record of the client interview; and the screening results recorded in section 4.']},
   {h:'3. Assessment',p:[`Of the ${n} clients, ${count('Low')} are rated Low, ${count('Medium')} Medium and ${count('High')} High, as set out in the schedule. The ratings follow the matrix score and, where stated in the schedule, the firm’s assessment of exposure for this type of client.`]},
   {h:'4. Checks carried out',p:['The checks below were carried out before this report. I record them here from the evidence held at the reference given.'],table:rows,after:[`Screening evidence is kept at: ${batch.evidence_reference||'[reference]'}. Clients not covered by a check, and therefore not accepted under this report: ${batch.uncovered_clients||'[none / list]'}.`,'Confirmation of client details. For every client in the schedule, the client details recorded in the workbook (the legal name, the identity of the owner or owners, the activity and the tax records) have been confirmed from the original documents held on file and from the client interview, and the record of that confirmation is kept with the client file at the reference given above. No client has been accepted on unconfirmed details.']},
   {h:'5. Conflicts of interest and connected clients',p:[`Owner names were checked against the firm’s staff register on ${d(batch.staff_register_checked_on)}. ${conflict?'A conflict was identified and the safeguard is recorded in the working file.':'No owner name matches a partner or member of staff, and no conflict of interest arises.'} Where clients share an owner they are to be read together; the connected-client groupings are recorded in the working file and are kept under review. This report does not accept any related person or entity outside the schedule.`]},
   {h:'6. Decision',p:[`I have reviewed section 4. For each client in the schedule, PEP screening, sanctions screening, adverse-media searching, identity-document sighting, confirmation of client details and the conflict and independence check have been carried out and recorded with the date, the person, the method or lists used and the reference to the evidence held. On that basis I accept the ${n} clients in the schedule at the rating shown, with standard due diligence, on the following terms.`,
    batch.conditions_cleared===true?'No outstanding conditions. Every item previously recorded as a condition has been cleared and evidenced, and each client may be onboarded without further compliance action.':'Conditions. Each client is accepted on the condition shown against it in the schedule, to be cleared and evidenced.',
    `Next screening. The next PEP, sanctions and adverse-media screening for every client in this batch is to be carried out on or before ${d(batch.next_screening_due)} (four months from this decision), and sooner if the client’s ownership, activity or behaviour changes or new information comes to light. Until it is completed, each client is treated as under periodic review.`,
    `Review. Each client is to undergo a full periodic review by ${d(batch.full_review_due)} (two years from this decision), or sooner on a change of ownership, activity or behaviour, or on any unusual transaction pattern.`,
    'Exclusion and escalation. Any client for which a PEP, sanctions or adverse-media result is subsequently recorded is excluded from this acceptance, is to be rated High, and is to be referred for enhanced due diligence. This decision covers the clients in the schedule and no others.',
    'Onboarding. Each accepted client may now be onboarded in the ERP. The decision for each client is also to be entered in the ERP under my own sign-in (client file, Set-up, AML / POCAMLA profile).']},
  ],
  signature:[`Name of MLRO: ${batch.mlro_name||'[name]'}`,'Signature: ______________________________',`Date: ${d(batch.decision_date)}`,`Form status: ${batch.status}`],
  schedule:clients.map((c,i)=>({n:i+1,name:c.name,pin:c.pin,activity:c.activity||'',rating:c.rating||'',condition:c.rating?(c.condition||'[condition or None]'):''})),
 };
}
