// Statutory export profiles (build 2830). Pure rules; no database, no clock.
// Exact payroll and ledger values never change. A profile decides only how a file is formatted when it is created: the template version, the rounding rule, the
// accepted ID types and how the employer housing levy is shown. A month uses the profile in force on its last day, so a later change cannot alter an old run.
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
export const RETURNS={
 NSSF:{label:'NSSF monthly return',authority:'NSSF',layout_code:'NSSF_MONTHLY_7COL_V1',roundable:['GROSS PAY'],ids:false,housing:false},
 SHIF:{label:'SHIF monthly contributions',authority:'SHA',layout_code:'SHA_SHIF_9COL_V1',roundable:['CONTRIBUTION AMOUNT'],ids:true,housing:false},
 PAYE_P10:{label:'PAYE return (P10)',authority:'KRA',layout_code:'KRA_P10_SIMPLIFIED_V30_0_3_SECTION_B',roundable:[],ids:false,housing:true}
};
export const RETURN_CODES=Object.keys(RETURNS);
export const ROUNDING_RULES={EXACT_2DP:'Exact amounts, two decimals',ROUND_UP_WHOLE:'Round up to the nearest shilling in the export only'};
export const ID_TYPES=['National ID','Passport','Alien ID'];
export const HOUSING_MODES={SEPARATE_SHEET:'Employer share shown separately with the employee share and the total (Sheet M)',NOT_DECLARED:'Not shown in this file'};
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
// Validates a draft. Returns {problem} or {values}.
export function profileFields(p){
 const rc=clean(p.return_code),def=RETURNS[rc];
 if(!def)return {problem:'Choose the return.'};
 const tv=clean(p.template_version);if(tv.length<1||tv.length>80)return {problem:'Say which template version this profile is for (up to 80 characters).'};
 const from=day(p.effective_from),to=p.effective_to?day(p.effective_to):null;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from))return {problem:'Say the first day the profile applies.'};
 if(to&&(!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<from))return {problem:'The last day cannot be before the first day.'};
 const rule=clean(p.rounding_rule||'EXACT_2DP');if(!ROUNDING_RULES[rule])return {problem:'Choose a rounding rule.'};
 const cols=[...new Set((Array.isArray(p.rounded_columns)?p.rounded_columns:String(p.rounded_columns||'').split(',')).map(clean).filter(Boolean))];
 if(rule==='ROUND_UP_WHOLE'){if(!cols.length)return {problem:'Choose the columns that are rounded up.'};const bad=cols.find(c=>!def.roundable.includes(c));if(bad)return {problem:`"${bad}" cannot be rounded in the ${def.label}. Roundable columns: ${def.roundable.join(', ')||'none'}.`};}
 else if(cols.length)return {problem:'Exact amounts do not round any column. Clear the column list or choose the round-up rule.'};
 const ids=[...new Set((Array.isArray(p.accepted_id_types)?p.accepted_id_types:String(p.accepted_id_types||'').split(',')).map(clean).filter(Boolean))];
 if(ids.some(i=>!ID_TYPES.includes(i)))return {problem:'Accepted ID types are National ID, Passport and Alien ID.'};
 if(def.ids&&!ids.length)return {problem:'Choose at least one accepted ID type.'};
 if(!def.ids&&ids.length)return {problem:'ID types apply to the SHIF file only.'};
 const housing=clean(p.employer_housing_levy||'NOT_DECLARED');if(!HOUSING_MODES[housing])return {problem:'Choose how the employer housing levy is shown.'};
 if(housing==='SEPARATE_SHEET'&&!def.housing)return {problem:'The employer housing levy sheet applies to the PAYE return only.'};
 const notes=clean(p.notes);if(notes.length>2000)return {problem:'Notes are too long (2,000 characters at most).'};
 return {values:{return_code:rc,authority:def.authority,layout_code:def.layout_code,template_version:tv,rounding_rule:rule,rounded_columns:cols,accepted_id_types:ids,employer_housing_levy:housing,notes:notes||null,effective_from:from,effective_to:to}};
}
// The published profile in force for a return on a date (the last day of the payroll month). Null when there is none.
export function profileInForce(profiles,returnCode,on){
 const d=day(on);
 return (profiles||[]).filter(x=>x.return_code===returnCode&&x.status==='Published'&&day(x.effective_from)<=d&&(!x.effective_to||day(x.effective_to)>=d)).sort((a,b)=>b.version-a.version)[0]||null;
}
// Rounds up to the next whole shilling. Money is held in cents, so there is no floating point drift.
export const roundUpCents=c=>Math.ceil(Number(c)/100)*100;
// Applies a profile's rounding to the rows of a file. columns: header names; rows: arrays; amounts are numbers in shillings.
// Returns {rows, rounding:{[column]:{exact,rounded,difference}} (shillings, from whole cents)}; the exact amounts are never lost.
export function applyRounding(columns,rows,profile){
 if(!profile||profile.rounding_rule!=='ROUND_UP_WHOLE'||!(profile.rounded_columns||[]).length)return {rows,rounding:{}};
 const idx=profile.rounded_columns.map(c=>[c,columns.indexOf(c)]).filter(([,i])=>i>=0),acc={};
 for(const [c] of idx)acc[c]={exact:0,rounded:0};
 const out=rows.map(r=>{const n=r.slice();for(const [c,i] of idx){const exact=Math.round(Number(n[i])*100),rounded=roundUpCents(exact);acc[c].exact+=exact;acc[c].rounded+=rounded;n[i]=rounded/100;}return n;});
 const rounding={};for(const [c,v] of Object.entries(acc))rounding[c]={exact:v.exact/100,rounded:v.rounded/100,difference:(v.rounded-v.exact)/100};
 return {rows:out,rounding};
}
