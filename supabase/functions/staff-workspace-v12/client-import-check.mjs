// Checks a client import workbook before anything is saved (pure rules; the caller supplies the approved sector list).
// Each problem names the row, the column, what is wrong and, where one is safe, a suggestion. An error blocks the import; a notice says what will be
// changed on the way in (for example a DD/MM/YYYY date saved as YYYY-MM-DD). A sector or activity is never guessed when the source is ambiguous.
export const BRANCHES=['Nairobi','Bungoma','Kisii','Other'];
export const CATEGORIES=['Corporate','Non-Profit','Public Entity','Individual'];
const PIN=/^[A-Z][0-9]{9}[A-Z]$/;
// Source labels that mean one approved sector without doubt. Anything else is left for a person to decide from the evidence.
const ALIASES={'supply of goods':'Wholesale & Retail','wholesale and retail':'Wholesale & Retail','wholesale':'Wholesale & Retail','retail':'Wholesale & Retail','trade':'Wholesale & Retail','hospitality':'Hospitality & Tourism','hotel':'Hospitality & Tourism','tourism':'Hospitality & Tourism','agriculture':'Agribusiness','agribusiness':'Agribusiness','ict':'Information Technology','it':'Information Technology','technology':'Information Technology','building and construction':'Construction','construction and building works':'Construction','finance':'Financial Services','health':'Healthcare','transport':'Transport & Logistics','logistics':'Transport & Logistics','professional':'Professional Services','consultancy':'Professional Services','mining':'Mining & Quarrying','real estate':'Real Estate','property':'Real Estate'};
const key=v=>String(v??'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();
function distance(a,b){const m=a.length,n=b.length;if(Math.abs(m-n)>2)return 9;let prev=Array.from({length:n+1},(_,j)=>j);for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}return prev[n];}
// Returns the approved sector a value means, or null. Exact (any case), a known alias, or a near miss of one letter or two (a typo).
export function suggestSector(value,sectors){
 const k=key(value);if(!k)return null;
 const exact=sectors.find(s=>key(s)===k);if(exact)return exact;
 const alias=ALIASES[k];if(alias&&sectors.includes(alias))return alias;
 const near=sectors.filter(s=>distance(key(s),k)<=2);return near.length===1?near[0]:null;
}
const realDate=(y,m,d)=>{const t=new Date(Date.UTC(y,m-1,d));return t.getUTCFullYear()===y&&t.getUTCMonth()===m-1&&t.getUTCDate()===d&&y>=1900&&t.getTime()<=Date.now();};
// YYYY-MM-DD (with or without a time), or DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY. Kenyan order: day first. Returns YYYY-MM-DD, or null when it is not a real past date.
export function normaliseDate(value){
 const s=String(value??'').trim();let y,m,d,r;
 if((r=/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s)))[y,m,d]=[+r[1],+r[2],+r[3]];
 else if((r=/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s)))[d,m,y]=[+r[1],+r[2],+r[3]];
 else return null;
 return realDate(y,m,d)?`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
// MM-DD, or text such as "31 December" or "31/12". Returns MM-DD or null.
export function normaliseYearEnd(value){
 const s=String(value??'').trim().toLowerCase();let m,d,r;
 if((r=/^(\d{1,2})-(\d{1,2})$/.exec(s)))[m,d]=[+r[1],+r[2]];
 else if((r=/^(\d{1,2})[\/.](\d{1,2})$/.exec(s)))[d,m]=[+r[1],+r[2]];
 else if((r=/^(\d{1,2})\s+([a-z]{3,})$/.exec(s))&&MONTHS.filter(x=>x.startsWith(r[2])).length===1)[d,m]=[+r[1],MONTHS.findIndex(x=>x.startsWith(r[2]))+1];
 else return null;
 const last=new Date(Date.UTC(2001,m,0)).getUTCDate();return m>=1&&m<=12&&d>=1&&d<=last?`${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
const pretty=codes=>codes.map(c=>`"${c}"`).join(' or ');
// rows: [{row, values:{company_name,kra_pin,primary_sector,branch_location,client_category,incorporation_date,year_end,activity_code,pack_code}}]
// ctx: {sectors:[approved names], activitySectors:{activity_code: sector}}
export function checkClientRows(rows,ctx){
 const errors=[],notices=[],seen=new Map();
 const err=(row,column,issue,suggestion=null)=>errors.push({row,column,issue,suggestion});
 const note=(row,column,issue,suggestion=null)=>notices.push({row,column,issue,suggestion});
 for(const {row,values:v} of rows){
  const name=String(v.company_name??'').trim(),pin=String(v.kra_pin??'').trim().toUpperCase();
  if(!name)err(row,'Client name','The client name is empty.');
  if(pin){
   if(!PIN.test(pin))err(row,'KRA PIN',`"${v.kra_pin}" is not a KRA PIN. It is a letter, nine digits and a letter.`);
   else if(seen.has(pin))err(row,'KRA PIN',`${pin} is already on row ${seen.get(pin)} of this sheet.`);
   else seen.set(pin,row);
  }
  // Sector (and the activity pack, which is a sector name).
  for(const [col,label] of [['primary_sector','Sector'],['pack_code','Activity pack']]){
   const raw=String(v[col]??'').trim();if(!raw)continue;
   if(ctx.sectors.includes(raw))continue;
   const fix=suggestSector(raw,ctx.sectors);
   err(row,label,`"${raw}" is not one of the ${ctx.sectors.length} approved sectors.`+(fix?'':' Choose it from the source evidence; it is not guessed.'),fix);
  }
  // Activity code against the sector it belongs to.
  const code=String(v.activity_code??'').trim().toLowerCase();
  if(code){
   if(!(code in ctx.activitySectors))err(row,'Activity code',`"${v.activity_code}" is not an activity code the ERP knows.`,null);
   else{
    const sector=ctx.sectors.includes(String(v.pack_code??'').trim())?String(v.pack_code).trim():ctx.sectors.includes(String(v.primary_sector??'').trim())?String(v.primary_sector).trim():suggestSector(v.pack_code||v.primary_sector,ctx.sectors);
    if(sector&&ctx.activitySectors[code]!==sector){
     const fit=Object.keys(ctx.activitySectors).filter(c=>ctx.activitySectors[c]===sector&&c!=='other');
     err(row,'Activity code',`"${code}" belongs to ${ctx.activitySectors[code]}, but this client is in ${sector}.`,fit.length?pretty(fit):null);
    }
   }
  }
  // Lists.
  for(const [col,label,list] of [['branch_location','Branch',BRANCHES],['client_category','Client category',CATEGORIES]]){
   const raw=String(v[col]??'').trim();if(!raw||list.includes(raw))continue;
   const fix=list.find(x=>x.toLowerCase()===raw.toLowerCase())||null;
   err(row,label,`"${raw}" is not one of: ${list.join(', ')}.`,fix);
  }
  // Dates.
  const inc=String(v.incorporation_date??'').trim();
  if(inc){const iso=normaliseDate(inc);
   if(!iso)err(row,'Incorporation date',`"${inc}" is not a real date in the past. Use DD/MM/YYYY or YYYY-MM-DD.`);
   else if(iso!==inc)note(row,'Incorporation date',`"${inc}" will be saved as ${iso}.`,iso);}
  const ye=String(v.year_end??'').trim();
  if(ye){const mmdd=normaliseYearEnd(ye);
   if(!mmdd)err(row,'Year end',`"${ye}" is not a year end. Use MM-DD, for example 12-31.`);
   else if(mmdd!==ye)note(row,'Year end',`"${ye}" will be saved as ${mmdd}.`,mmdd);}
 }
 return {errors,notices,checked:rows.length};
}
