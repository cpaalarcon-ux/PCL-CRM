// Owner share amendments from the client workbook: pure rules for the "Owner Amendments" sheet. No database here.
// Each row changes the share of an owner who is already on the client's record. A row must say what the new share is and which evidence supports it
// (for example "CR12 dated 20 Nov 2026") and who sighted it and when. No identity-document number is read or kept.
export const MAX_AMEND_ROWS=600,MAX_AMEND_CLIENTS=200,SHARE_TOLERANCE=0.02;
const PIN=/^[A-Z][0-9]{9}[A-Z]$/;
const s=v=>String(v??'').replace(/\s+/g,' ').trim();
const pinOf=v=>s(v).replace(/\s+/g,'').toUpperCase();
const round2=n=>Math.round(n*100)/100;
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
// 2026-11-20, 20/11/2026 and 20 Nov 2026 are read; anything else is refused rather than guessed.
export function readDate(v){
 const t=s(v);let y,m,d,x;
 if((x=/^(\d{4})-(\d{2})-(\d{2})/.exec(t)))[,y,m,d]=x;
 else if((x=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t)))[,d,m,y]=x;
 else if((x=/^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(t))){d=x[1];m=MONTHS.indexOf(x[2].toLowerCase())+1;y=x[3];}
 else return null;
 y=Number(y);m=Number(m);d=Number(d);const dt=new Date(Date.UTC(y,m-1,d));
 if(!m||dt.getUTCFullYear()!==y||dt.getUTCMonth()!==m-1||dt.getUTCDate()!==d)return null;
 return dt.toISOString().slice(0,10);
}
function share(raw){
 const t=s(raw);if(!t)return {blank:true};const pct=t.endsWith('%'),n=Number(pct?t.slice(0,-1):t);return Number.isFinite(n)?{n,pct}:{bad:t};
}
// rows: [{row,values}] with the sheet's column names (client_kra_pin, client_name, full_name, ownership_percentage, evidence_reference, sighted_by, sighted_on).
export function checkAmendRows(rows,{today=new Date().toISOString().slice(0,10)}={}){
 const errors=[],notices=[],byClient=new Map();
 const err=(row,column,issue,suggestion=null)=>errors.push({row,column:'Owner Amendments · '+column,issue,suggestion});
 if(rows.length>MAX_AMEND_ROWS)err(1,'Rows',`The sheet has ${rows.length} rows. Load up to ${MAX_AMEND_ROWS} at a time.`,'Split the workbook.');
 // Excel stores a percentage cell as a fraction (100% is 1). Fractions are read as such only when every share in the sheet is at most 1.
 const parsed=rows.slice(0,MAX_AMEND_ROWS).map(r=>share(r.values.ownership_percentage));
 const nums=parsed.filter(p=>p.n!==undefined);
 const fractions=nums.length>0&&nums.length===parsed.length&&!nums.some(p=>p.pct)&&nums.every(p=>p.n>0&&p.n<=1);
 rows.slice(0,MAX_AMEND_ROWS).forEach(({row,values:v},i)=>{
  const pin=pinOf(v.client_kra_pin),name=s(v.full_name),p=parsed[i];
  if(!pin){err(row,'client_kra_pin','The client KRA PIN is blank.','Enter the PIN of the client.');return;}
  if(!PIN.test(pin)){err(row,'client_kra_pin',`${pin} is not a valid KRA PIN.`,'A KRA PIN is a letter, nine digits and a letter.');return;}
  if(!name){err(row,'full_name','The owner has no name.','Enter the name exactly as it is on the client record.');return;}
  let value=null;
  if(p.blank)err(row,'ownership_percentage',`${name}: the new share is blank.`,'Enter the share shown on the CR12 or register.');
  else if(p.bad!==undefined)err(row,'ownership_percentage',`“${p.bad}” is not a percentage.`,'Enter a number from 0.01 to 100.');
  else{value=fractions?round2(p.n*100):p.n;if(value<=0||value>100){err(row,'ownership_percentage',`${value} is not a share from 0.01 to 100.`,'Enter a number from 0.01 to 100.');value=null;}}
  const ref=s(v.evidence_reference);if(ref.length<5)err(row,'evidence_reference',`${name}: no evidence reference.`,'Say which document supports the share, for example “CR12 dated 20 Nov 2026”.');
  else if(/^[A-Z]?\d{7,}$/.test(ref.replace(/[\s-]/g,'')))err(row,'evidence_reference','This looks like an identity-document number. Do not enter one.','Name the document and its date instead.');
  const by=s(v.sighted_by);if(by.length<2)err(row,'sighted_by',`${name}: who sighted the evidence is blank.`,'Enter the name of the person who saw the document.');
  const on=readDate(v.sighted_on);if(!on)err(row,'sighted_on',`${name}: “${s(v.sighted_on)}” is not a date.`,'Use 2026-11-20 or 20 Nov 2026.');
  else if(on>today)err(row,'sighted_on',`${name}: the sighting date is in the future.`,'Enter the date the document was seen.');
  const c=byClient.get(pin)||{pin,name:s(v.client_name),row,owners:[]};byClient.set(pin,c);
  if(c.owners.some(o=>o.full_name.toLowerCase()===name.toLowerCase())){err(row,'full_name',`${name} is listed twice for ${c.name||pin}.`,'List each owner once for a client.');return;}
  c.owners.push({row,full_name:name.slice(0,160),share:value,evidence_reference:ref.slice(0,200),sighted_by:by.slice(0,120),sighted_on:on});
 });
 const clients=[...byClient.values()];
 if(clients.length>MAX_AMEND_CLIENTS)err(1,'Rows',`The sheet covers ${clients.length} clients. Load up to ${MAX_AMEND_CLIENTS} at a time.`,'Split the workbook.');
 if(!clients.length&&!errors.length)err(2,'Owner Amendments','The Owner Amendments sheet has no rows.','Enter at least one amendment.');
 return {errors,notices,clients};
}
// The shares a client would hold after the amendments: the owners named in the file take their new share, every other owner keeps the share on record.
export const resultingTotal=(otherTotal,owners)=>round2(Number(otherTotal||0)+owners.reduce((t,o)=>t+Number(o.share||0),0));
export const sharesTotal100=total=>Math.abs(total-100)<=SHARE_TOLERANCE;
