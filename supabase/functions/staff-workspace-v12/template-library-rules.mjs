// Template Library (build 2821). Pure rules.
export const TEMPLATE_KEYS=['SALES','PURCHASES','VAT_WHT','BANK_ANALYSIS','PAYROLL','TRIAL_BALANCE','NON_ETIMS','OTHER'];
export const KEY_LABEL={SALES:'Sales',PURCHASES:'Purchases',VAT_WHT:'VAT and withholding',BANK_ANALYSIS:'Bank analysis',PAYROLL:'Payroll',TRIAL_BALANCE:'Trial balance',NON_ETIMS:'Non-eTIMS expenditure',OTHER:'Other'};
export const MAX_FILE_BYTES=2000000;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
// Staff type one column per line: "Column name | required or optional | example". The result is stored as data, not read as a formula.
export function columnsFrom(input){
 const lines=Array.isArray(input)?input:String(input||'').split(/\r?\n/);
 const out=[],seen=new Set();
 for(const raw of lines){
  const line=typeof raw==='string'?raw:`${raw?.name||''} | ${raw?.required===false?'optional':'required'} | ${raw?.example||''}`;
  if(!clean(line))continue;
  const [name,req,...ex]=line.split('|').map(clean);
  if(!name)return {problem:'Every column needs a name.'};
  if(name.length>80)return {problem:`The column name "${name.slice(0,30)}…" is too long.`};
  const key=name.toLowerCase();if(seen.has(key))return {problem:`The column "${name}" is listed twice.`};seen.add(key);
  const r=(req||'required').toLowerCase();if(!['required','optional'].includes(r))return {problem:`For "${name}" write required or optional after the name.`};
  out.push({name,required:r==='required',example:ex.join(' | ').slice(0,120)});
 }
 if(!out.length)return {problem:'List the columns the template must have, one per line.'};
 if(out.length>60)return {problem:'A template can list at most 60 columns.'};
 if(!out.some(c=>c.required))return {problem:'At least one column must be required.'};
 return {columns:out};
}
export function fileProblem({name,base64}){
 if(!clean(name))return 'Choose the template file.';
 if(!/\.(xlsx|xlsm|xls|csv)$/i.test(name))return 'The template must be an Excel or CSV file (.xlsx, .xlsm, .xls or .csv).';
 if(!base64||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return 'The file could not be read. Choose it again.';
 if(Math.floor(base64.length*3/4)>MAX_FILE_BYTES)return 'The template file is larger than 2 MB. Remove sample rows and try again.';
 return '';
}
// Is a published version in force on a date?
export function inForce(t,on){return t.status==='Published'&&t.effective_from<=on&&(!t.effective_to||t.effective_to>=on);}
// Where a published version is not in force the screen says so; an import is never blocked by the library in this build.
export function versionState(t,today){
 if(t.status==='Draft')return 'Waiting to be published';
 if(t.status==='Retired')return 'Retired';
 if(t.effective_from>today)return 'Published, starts '+t.effective_from;
 if(t.effective_to&&t.effective_to<today)return 'Published, ended '+t.effective_to;
 return 'In force';
}
