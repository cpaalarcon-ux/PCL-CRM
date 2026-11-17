// Build 2854: the client set-up grid. Pure rules for a screen laid out like the KRA iTax "Non-Individual Taxpayer profile".
// Nothing here talks to the server or decides an approval. The server (client_master_read, client_master_record_many, client_master_verify_many)
// stays the authority; this file only says where each fact sits on the page, how a typed cell is read back, and what status the page shows.

import {countyNames,constituencyNames,canonicalCounty,canonicalConstituency,locationProblem} from './staff-kenya-locations.mjs?v=20261122-loc-v1';

// The iTax page, section by section. A row is two label/value pairs. `key` is a client-master fact; `from` marks a cell that only shows a value kept elsewhere.
// Cells the server does not list for this client type are still shown, as optional, so the page looks the same for every client.
export const LAYOUT=[
 {id:'pin',title:'PIN Details',rows:[[{key:'kra_pin',label:'PIN'},{key:'company_name',label:'Taxpayer Name'}]]},
 {id:'basic',title:'Section A : Basic Information',groups:[
  {title:'Business Income Details',rows:[
   [{from:'legal_structure',label:'Business Type'},{from:'legal_subtype',label:'Business Sub Type'}],
   [{key:'registration_number',label:'Business Registration Certificate Number / Single Business Permit Number'},{key:'commencement_date',label:'Business Commencement Date'}],
   [{mirror:'company_name',label:'Business Name'},{key:'incorporation_date',label:'Business Registration Date'}],
   [{key:'year_end',label:'Accounting Period End (day/month)'},{key:'trading_name',label:'Trading / Business Name, if different from the registered name'}],
   [{key:'epz_effective_date',label:'EPZ Effective Date'},{key:'has_branches',label:'Does your business have any branches?'}],
   [{key:'legal_rep_declared',label:'Do you wish to declare a Legal Representative?'},{key:'legal_rep_pin',label:'Legal Representative PIN'}],
   [{key:'sez_effective_date',label:'SEZ Effective Date'},null]]},
  {title:'NSSF Details',rows:[[{key:'nssf_number',label:'NSSF Number'},null]]},
  {title:'Principal Physical Address',rows:[
   [{key:'lr_number',label:'LR Number'},{key:'building',label:'Building'}],
   [{key:'street_road',label:'Street / Road'},{key:'city_town',label:'City / Town'}],
   [{key:'county',label:'County'},{key:'district',label:'Constituency (sub-county)'}],
   [{key:'locality',label:'Tax Area / Locality'},{key:'descriptive_address',label:'Descriptive Address'}]]},
  {title:'Principal Postal Address',rows:[
   [{key:'postal_code',label:'Postal Code'},{key:'postal_town',label:'Town'}],
   [{key:'po_box',label:'P.O. Box'},null]]},
  {title:'Principal Contact Details',rows:[
   [{key:'telephone',label:'Telephone Number'},{key:'contact_phone',label:'Mobile Number (1)'}],
   [{key:'mobile_2',label:'Mobile Number (2)'},{key:'mobile_3',label:'Mobile Number (3)'}],
   [{key:'contact_email',label:'Main Email Address'},{key:'secondary_email',label:'Secondary Email Address'}],
   [{key:'website',label:'Website'},null]]}]}
];
// Facts a client type asks for that the iTax page has no cell for (main contact, authority to act, regulator and so on) are listed in one last section.
export const OTHER_TITLE='Other facts the firm asks for this client type';
export const gridKeys=()=>{const out=[];const walk=rows=>rows.forEach(r=>r.forEach(c=>{if(c&&c.key)out.push(c.key);}));for(const s of LAYOUT){if(s.rows)walk(s.rows);for(const g of s.groups||[])walk(g.rows);}return out;};

// ---- how a cell is typed and read back ----
export const DATE_KEYS=['commencement_date','incorporation_date','epz_effective_date','sez_effective_date','date_of_death'];
export const YESNO_KEYS=['has_branches','legal_rep_declared'];
export const DAYMONTH_KEYS=['year_end'];
// County and constituency are chosen from the IEBC list. The constituency list follows the county.
export const CHOICE_KEYS=['county','district'];
export const kindOf=key=>DATE_KEYS.includes(key)?'date':YESNO_KEYS.includes(key)?'yesno':DAYMONTH_KEYS.includes(key)?'daymonth':CHOICE_KEYS.includes(key)?'choice':'text';
// The names a choice cell offers. A constituency cell offers the constituencies of the county typed in the county cell, and nothing until a county is chosen.
export const choiceOptions=(key,countyText='')=>key==='county'?countyNames():key==='district'?constituencyNames(countyText):[];

const pad=n=>String(n).padStart(2,'0');
const realDate=(y,m,d)=>{const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d&&y>=1900;};
// iTax writes dates dd/mm/yyyy. The firm stores YYYY-MM-DD. dd-mm-yyyy, dd.mm.yyyy and d/m/yyyy are read the same way; YYYY-MM-DD is kept as typed.
export function dateToIso(text){
 const t=String(text??'').trim();if(!t)return '';
 let m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
 if(m){const [y,mo,d]=[+m[1],+m[2],+m[3]];return realDate(y,mo,d)?`${y}-${pad(mo)}-${pad(d)}`:null;}
 m=/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(t);
 if(m){const [d,mo,y]=[+m[1],+m[2],+m[3]];return realDate(y,mo,d)?`${y}-${pad(mo)}-${pad(d)}`:null;}
 return null;
}
export const isoToDate=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso??''));return m?`${m[3]}/${m[2]}/${m[1]}`:String(iso??'');};
// Year end is stored MM-DD and shown dd/mm. 29 February is allowed only as typed; nothing is guessed.
export function dayMonthToStored(text){
 const t=String(text??'').trim();if(!t)return '';
 let m=/^(\d{1,2})[/.\-\s](\d{1,2})$/.exec(t);
 if(m){const [d,mo]=[+m[1],+m[2]];return mo>=1&&mo<=12&&d>=1&&d<=31&&realDate(2024,mo,d)?`${pad(mo)}-${pad(d)}`:null;}
 return null;
}
export const storedToDayMonth=v=>{const m=/^(\d{2})-(\d{2})$/.exec(String(v??''));return m?`${m[2]}/${m[1]}`:String(v??'');};

// The text a cell shows for a stored value, and the stored value for the text a person typed. null means the typed text is not a valid value.
export function display(key,stored){const k=kindOf(key);return k==='date'?isoToDate(stored):k==='daymonth'?storedToDayMonth(stored):String(stored??'');}
export function toStored(key,typed,{county=''}={}){
 const t=String(typed??'').replace(/\s+/g,' ').trim(),k=kindOf(key);
 if(!t)return '';
 if(k==='choice')return (key==='county'?canonicalCounty(t):canonicalConstituency(county,t))||t;
 if(k==='date')return dateToIso(t);
 if(k==='daymonth')return dayMonthToStored(t);
 if(key==='kra_pin'||key==='legal_rep_pin')return t.toUpperCase();
 return t;
}

// What is wrong with a typed cell, in words. The server checks again; these are the same shapes so the person sees the problem before saving.
const PIN=/^[A-Z][0-9]{9}[A-Z]$/,EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,PHONE=v=>/^\+?\d{9,13}$/.test(v.replace(/[\s-]/g,''));
const CHECKS={
 kra_pin:[v=>PIN.test(v),'One letter, nine digits, one letter.'],legal_rep_pin:[v=>PIN.test(v),'One letter, nine digits, one letter.'],
 contact_email:[v=>EMAIL.test(v),'name@example.com'],secondary_email:[v=>EMAIL.test(v),'name@example.com'],
 contact_phone:[PHONE,'Digits only, 9 to 13.'],telephone:[PHONE,'Digits only, 9 to 13.'],mobile_2:[PHONE,'Digits only, 9 to 13.'],mobile_3:[PHONE,'Digits only, 9 to 13.'],
 postal_code:[v=>/^\d{3,6}$/.test(v),'Digits only, for example 50200.'],po_box:[v=>/^[A-Za-z0-9 /.-]{1,30}$/.test(v),'The box number, or None.'],
 nssf_number:[v=>/^[A-Za-z0-9/-]{3,20}$/.test(v),'Letters, digits, / and - only.'],
 has_branches:[v=>/^(Yes|No)$/.test(v),'Yes or No.'],legal_rep_declared:[v=>/^(Yes|No)$/.test(v),'Yes or No.'],
 website:[v=>/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(v),'For example www.example.co.ke'],
 
};
export function cellProblem(key,typed,{mandatory=false,hadValue=false,county=''}={}){
 const t=String(typed??'').replace(/\s+/g,' ').trim();
 if(!t)return hadValue?'A recorded value cannot be cleared. Replace it with the right value instead.':mandatory?'Required.':null;
 const k=kindOf(key);
 if(k==='date')return dateToIso(t)?null:'Use a real date as dd/mm/yyyy.';
 if(k==='daymonth')return dayMonthToStored(t)?null:'Use day/month, for example 31/12.';
 if(key==='county')return canonicalCounty(t)?null:'Choose one of the 47 counties from the list.';
 if(key==='district')return locationProblem(county,t);
 const stored=toStored(key,t),c=CHECKS[key];
 if(c&&!c[0](stored))return c[1];
 if(!c&&stored.length<2)return 'Too short.';
 if(stored.length>500)return 'Too long.';
 return null;
}

// ---- reading the server's answer ----
// rows: client_master_read rows ({key,label,hint,state,optional,extra,fact}). A row the server lists without `optional` or `extra` is mandatory.
export const isMandatory=row=>!!row&&!row.optional&&!row.extra;
export function indexRows(rows){const m=new Map();for(const r of rows||[])m.set(r.key,r);return m;}
// Every row the iTax layout has no cell for, in the server's order. They go in the last section.
export function otherRows(rows){const placed=new Set(gridKeys());return (rows||[]).filter(r=>!placed.has(r.key)&&!r.extra);}

// The status shown at the top of the page. It restates the firm's existing rules; it adds none.
//  DRAFT: a mandatory cell has no recorded value.  PENDING VERIFICATION: all recorded, some not yet verified by a different reviewer.
//  PENDING PARTNER APPROVAL: all verified, and the client is PEP or High risk and the Partner's enhanced due diligence is not yet approved.  VERIFIED: nothing left.
export function gridStatus({rows,eddNeeded=false,eddApproved=false,structureKnown=true}){
 const req=(rows||[]).filter(isMandatory);
 const filled=req.filter(r=>r.fact).length,verified=req.filter(r=>r.state==='Verified').length,differs=req.filter(r=>r.state==='Differs').length;
 let code='DRAFT';
 if(structureKnown&&req.length&&filled===req.length&&!differs)code=verified===req.length?(eddNeeded&&!eddApproved?'PENDING_PARTNER':'VERIFIED'):'PENDING_VERIFICATION';
 const label={DRAFT:'DRAFT',PENDING_VERIFICATION:'PENDING VERIFICATION',PENDING_PARTNER:'PENDING PARTNER APPROVAL',VERIFIED:'VERIFIED'}[code];
 const next={DRAFT:structureKnown?`${req.length-filled} mandatory cell${req.length-filled===1?'':'s'} still empty. Save a draft at any time; set-up is not done until every one is filled.`:'Set the legal structure first; it decides which cells are mandatory.',
  PENDING_VERIFICATION:'Every mandatory cell is filled. A different Supervisor, Manager or Partner checks the cells against the iTax profile and verifies them.',
  PENDING_PARTNER:'Every cell is verified. This client is PEP or High risk, so a Partner must approve the enhanced due diligence.',
  VERIFIED:'Every mandatory cell is filled and verified.'}[code];
 return {code,label,next,mandatory:req.length,filled,verified,differs,missing:req.filter(r=>!r.fact).map(r=>r.key)};
}

// The approval trail from the facts' own records. Names and dates are the ones the server stored; nothing is invented.
export function approvalTrail(rows){
 const prep=new Map(),ver=new Map();
 for(const r of rows||[]){const f=r.fact;if(!f)continue;
  if(f.recorded_by_name){const p=prep.get(f.recorded_by_name)||{name:f.recorded_by_name,first:f.recorded_at,last:f.recorded_at,n:0};p.n++;if(f.recorded_at<p.first)p.first=f.recorded_at;if(f.recorded_at>p.last)p.last=f.recorded_at;prep.set(f.recorded_by_name,p);}
  if(f.verified_at&&f.verified_by_name){const v=ver.get(f.verified_by_name)||{name:f.verified_by_name,first:f.verified_at,last:f.verified_at,n:0};v.n++;if(f.verified_at<v.first)v.first=f.verified_at;if(f.verified_at>v.last)v.last=f.verified_at;ver.set(f.verified_by_name,v);}}
 return {prepared:[...prep.values()],verified:[...ver.values()]};
}
