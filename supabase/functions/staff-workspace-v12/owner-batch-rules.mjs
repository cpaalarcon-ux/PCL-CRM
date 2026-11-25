// Owners and contacts from the client workbook: pure rules (checking every row of the "Beneficial Owners" and "Contacts" sheets). No database here.
// The owners and directors on the sheet are the client's beneficial owners. Every listed owner needs a share, and each client's shares must total 100%.
// An identity-document or passport number is never read or kept: the identity_reference column is used only when it holds a role word.
export const MAX_CLIENTS=200,MAX_OWNER_ROWS=1500,MAX_OWNERS_PER_CLIENT=20;
export const NOT_SIGHTED='Not recorded: identity document not yet sighted';
export const SHARE_TOLERANCE=0.02;
const PIN=/^[A-Z][0-9]{9}[A-Z]$/;
const ID_TYPES={'national id':'National ID','id card':'National ID','passport':'Passport','alien id':'Alien ID'};
const ROLES={'director':'Director','shareholder':'Shareholder','director and shareholder':'Director and shareholder','partner':'Partner','sole proprietor':'Sole proprietor','proprietor':'Sole proprietor','owner':'Owner','trustee':'Trustee','other controller':'Other controller'};
const PEP={'yes':'Yes','y':'Yes','no':'No','n':'No','unknown':'To confirm','to confirm':'To confirm','':'To confirm'};
const CONTACT_ROLES={'decision maker':'Decision Maker','influencer':'Influencer','day-to-day contact':'Day-to-Day Contact','accounts contact':'Billing Contact','billing contact':'Billing Contact'};
const s=v=>String(v??'').replace(/\s+/g,' ').trim();
const pinOf=v=>s(v).replace(/\s+/g,'').toUpperCase();
const round2=n=>Math.round(n*100)/100;
export const normPhone=v=>{const x=s(v).replace(/[\s()\-]/g,'');if(!x)return '';if(/^\+254[17]\d{8}$/.test(x))return x;if(/^0[17]\d{8}$/.test(x))return '+254'+x.slice(1);if(/^254[17]\d{8}$/.test(x))return '+'+x;if(/^[17]\d{8}$/.test(x))return '+254'+x;return null;};
// A share is read as written: "50%" and 50 both mean fifty per cent. Excel stores a percentage cell as a fraction (100% is 1), so when every share
// of a client is at most 1 and they add up to 1, they are read as fractions. Nothing else is guessed.
function shares(raw){
 const parsed=raw.map(v=>{const t=s(v);if(!t)return {blank:true};const pct=t.endsWith('%'),n=Number(pct?t.slice(0,-1):t);return Number.isFinite(n)?{n,pct}:{bad:t};});
 const nums=parsed.filter(p=>p.n!==undefined);
 const fractions=nums.length>0&&nums.length===parsed.length&&!nums.some(p=>p.pct)&&nums.every(p=>p.n>=0&&p.n<=1)&&Math.abs(nums.reduce((a,p)=>a+p.n,0)-1)<=0.0002;
 return parsed.map(p=>p.n===undefined?p:{value:fractions?round2(p.n*100):p.n});
}
// rows: [{row,values}] with the sheet's own column names (client_kra_pin, client_name, full_name, identity_reference, owner_kra_pin, ownership_percentage,
// control_basis, identity_type, nationality, direct_or_indirect, is_pep). Returns {errors,notices,clients}. Nothing is ignored silently.
export function checkOwnerRows(rows){
 const errors=[],notices=[],byClient=new Map();
 const err=(row,column,issue,suggestion=null)=>errors.push({row,column:'Beneficial Owners · '+column,issue,suggestion});
 const note=(row,column,issue)=>notices.push({row,column:'Beneficial Owners · '+column,issue,suggestion:null});
 if(rows.length>MAX_OWNER_ROWS)err(1,'Rows',`The sheet has ${rows.length} owner rows. Load up to ${MAX_OWNER_ROWS} at a time.`,'Split the workbook.');
 for(const {row,values:v} of rows.slice(0,MAX_OWNER_ROWS)){
  const pin=pinOf(v.client_kra_pin),name=s(v.full_name);
  if(!pin){err(row,'client_kra_pin','The client KRA PIN is blank.','Enter the PIN of the client this owner belongs to.');continue;}
  if(!PIN.test(pin)){err(row,'client_kra_pin',`${pin} is not a valid KRA PIN.`,'A KRA PIN is a letter, nine digits and a letter.');continue;}
  if(!name){err(row,'full_name','The owner has no name.','Enter the owner’s name or remove the row.');continue;}
  const c=byClient.get(pin)||{pin,name:s(v.client_name),row,owners:[]};byClient.set(pin,c);
  if(c.owners.some(o=>o.full_name.toLowerCase()===name.toLowerCase())){err(row,'full_name',`${name} is listed twice for ${c.name||pin}.`,'List each owner once for a client.');continue;}
  const opin=pinOf(v.owner_kra_pin);if(opin&&!PIN.test(opin))err(row,'owner_kra_pin',`${opin} is not a valid KRA PIN.`,'A KRA PIN is a letter, nine digits and a letter.');
  const hold=s(v.direct_or_indirect);if(hold&&!['direct','indirect'].includes(hold.toLowerCase()))err(row,'direct_or_indirect',`“${hold}” is not Direct or Indirect.`,'Choose Direct or Indirect.');
  const pepRaw=s(v.is_pep).toLowerCase(),pep=PEP[pepRaw];if(pep===undefined)err(row,'is_pep',`“${s(v.is_pep)}” is not Yes, No or Unknown.`,'Choose Yes, No or Unknown.');
  const idRaw=s(v.identity_type),idt=idRaw?ID_TYPES[idRaw.toLowerCase()]||null:null;if(idRaw&&!idt)note(row,'identity_type',`“${idRaw}” is not National ID, Passport or Alien ID. It was not recorded.`);
  // identity_reference: a role word is used as the role; anything else is never read or kept.
  const refRaw=s(v.identity_reference),role=ROLES[refRaw.toLowerCase()]||null;
  if(refRaw&&!role)note(row,'identity_reference',/\d{4,}/.test(refRaw)?'This looks like an identity-document number. It was ignored and nothing from it was read or kept.':`“${refRaw.slice(0,40)}” is not a role. It was ignored.`);
  const basis=s(v.control_basis),control=[role,basis&&basis.toLowerCase()!=='unknown'?basis:''].filter(Boolean).join(' · ')||'Owner or controller (as stated in the client workbook)';
  if(c.owners.length>=MAX_OWNERS_PER_CLIENT){err(row,'full_name',`${c.name||pin} has more than ${MAX_OWNERS_PER_CLIENT} owners in this file.`,'List the owners and controllers only.');continue;}
  c.owners.push({row,full_name:name.slice(0,160),kra_pin:opin||null,raw_share:v.ownership_percentage,control_basis:control.slice(0,1000),identity_type:idt,nationality:s(v.nationality).slice(0,80)||null,holding_type:hold?hold[0].toUpperCase()+hold.slice(1).toLowerCase():null,pep_status:pep||'To confirm'});
 }
 const clients=[...byClient.values()].filter(c=>c.owners.length);
 if(clients.length>MAX_CLIENTS)err(1,'Rows',`The sheet covers ${clients.length} clients. Load up to ${MAX_CLIENTS} at a time.`,'Split the workbook.');
 for(const c of clients){
  const sh=shares(c.owners.map(o=>o.raw_share));let total=0,complete=true;
  c.owners.forEach((o,i)=>{const p=sh[i];delete o.raw_share;
   if(p.blank){complete=false;err(o.row,'ownership_percentage',`${o.full_name}: the ownership share is blank.`,'Enter the share. The owners of a client must total 100%.');}
   else if(p.bad!==undefined){complete=false;err(o.row,'ownership_percentage',`“${p.bad}” is not a percentage.`,'Enter a number from 0 to 100.');}
   else if(p.value<0||p.value>100){complete=false;err(o.row,'ownership_percentage',`${p.value} is not a share from 0 to 100.`,'Enter a number from 0 to 100.');}
   else{o.ownership_percentage=p.value;total+=p.value;}});
  c.total=round2(total);
  if(complete&&Math.abs(total-100)>SHARE_TOLERANCE)err(c.row,'ownership_percentage',`${c.name||c.pin}: the owners’ shares add to ${round2(total)}%. They must total 100%.`,'Correct the shares, or add the owner who holds the rest.');
 }
 if(!clients.length&&!errors.length)errors.push({row:2,column:'Beneficial Owners',issue:'The Beneficial Owners sheet has no owners.',suggestion:'Enter at least one owner.'});
 return {errors,notices,clients};
}
// Contacts sheet (client_kra_pin, full_name, job_title, email_address, phone_number, role_in_decision). A row with no name is not a contact and is left out with a notice.
export function checkContactRows(rows){
 const errors=[],notices=[],contacts=[],seen=new Set();
 const err=(row,column,issue,suggestion=null)=>errors.push({row,column:'Contacts · '+column,issue,suggestion});
 for(const {row,values:v} of rows){
  const pin=pinOf(v.client_kra_pin),name=s(v.full_name),email=s(v.email_address),phoneRaw=s(v.phone_number),roleRaw=s(v.role_in_decision);
  if(!name){if(email||phoneRaw)notices.push({row,column:'Contacts · full_name',issue:'This row has an email or phone but no contact name. It was not loaded.',suggestion:null});continue;}
  if(!pin||!PIN.test(pin)){err(row,'client_kra_pin',pin?`${pin} is not a valid KRA PIN.`:'The client KRA PIN is blank.','A KRA PIN is a letter, nine digits and a letter.');continue;}
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))err(row,'email_address',`“${email}” is not a valid email address.`,'Check the address.');
  const phone=phoneRaw?normPhone(phoneRaw):'';if(phoneRaw&&phone===null)err(row,'phone_number',`“${phoneRaw}” is not a Kenyan phone number.`,'Use 07xx xxx xxx or +254 7xx xxx xxx.');
  if(!email&&!phoneRaw)err(row,'email_address','The contact has no email and no phone.','Enter an email or a phone number.');
  const role=roleRaw?CONTACT_ROLES[roleRaw.toLowerCase()]:null;if(roleRaw&&!role)err(row,'role_in_decision',`“${roleRaw}” is not a listed role.`,'Choose Decision maker, Influencer, Day-to-day contact or Accounts contact.');
  const key=pin+'|'+name.toLowerCase();if(seen.has(key)){err(row,'full_name',`${name} is listed twice for this client.`,'List each contact once for a client.');continue;}seen.add(key);
  contacts.push({row,pin,full_name:name.slice(0,160),job_title:s(v.job_title).slice(0,100)||null,email_address:email.toLowerCase()||null,phone_number:phone||null,role_in_decision:role||null});
 }
 return {errors,notices,contacts};
}
